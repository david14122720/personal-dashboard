mod auth;
mod config;
mod db;
mod error;
mod finance;
mod routes;
mod state;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    http::{HeaderName, HeaderValue, StatusCode},
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde_json::json;
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use config::Config;
use state::AppState;

/// JSON 404 for unknown `/api/*` suffixes (never the SPA shell).
async fn api_fallback_handler() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error": {"code": "NOT_FOUND", "message": "Not found"}})),
    )
}

/// Production budget for a single `/api` request. Generous enough that an
/// Argon2id login is never cut off (DD4 / SEC-003).
const API_TIMEOUT: Duration = Duration::from_secs(15);

/// Test-only slow handler used to prove the `/api` timeout (DD4).
#[cfg(test)]
async fn test_slow_handler() -> &'static str {
    tokio::time::sleep(Duration::from_secs(2)).await;
    "slow"
}

/// Test-only handler that finishes well under an injected budget.
#[cfg(test)]
async fn test_fast_handler() -> &'static str {
    tokio::time::sleep(Duration::from_millis(25)).await;
    "fast"
}

/// All API routes, mounted under `/api` by [`build_router`].
/// Slice S1 removed the `/transfers` routes (`routes::transfers` deleted);
/// transfers are now recorded as two manual balance edits.
/// Slice S2 removed the `/budgets` routes (`routes::budgets` deleted);
/// no budget endpoint, UI, LED or MCP tool remains.
/// Slice S3a removed the `/transactions` routes (`routes::transactions`
/// deleted, migration 0011 drops the table); `accounts.balance` is now
/// written by hand via `PATCH /api/accounts/{id}`.
fn api_routes() -> Router<AppState> {
    let router = Router::new()
        .route("/login", post(routes::login::login_handler))
        .route("/logout", post(routes::logout::logout_handler))
        .route("/me", get(routes::me::me_handler))
        .route(
            "/me/preferences",
            patch(routes::me::patch_preferences_handler),
        )
        .route(
            "/accounts",
            post(routes::accounts::create_account_handler)
                .get(routes::accounts::list_accounts_handler),
        )
        .route(
            "/accounts/{id}",
            get(routes::accounts::get_account_handler)
                .patch(routes::accounts::patch_account_handler)
                .delete(routes::accounts::delete_account_handler),
        )
        .route(
            "/categories",
            get(routes::categories::list_categories_handler),
        )
        // S-A (finance-simplify-movements): movements ledger + atomic
        // balance effect. One request runs one transaction; the frontend
        // never orchestrates a double write.
        .route(
            "/movements",
            post(routes::movements::create_movement_handler)
                .get(routes::movements::list_movements_handler),
        )
        .route(
            "/movements/{id}",
            get(routes::movements::get_movement_handler)
                .patch(routes::movements::patch_movement_handler)
                .delete(routes::movements::delete_movement_handler),
        )
        // S-G (finance-simplify-movements): `/savings-goals*` and `/debts*`
        // routes removed with their tables (gated migration 0013). No
        // savings/debts endpoint, UI, or MCP tool remains.
        .route(
            "/habits",
            post(routes::habits::create_habit_handler).get(routes::habits::list_habits_handler),
        )
        .route(
            "/habits/today",
            get(routes::habits::today_habits_handler),
        )
        .route(
            "/habits/logs",
            get(routes::habits::list_logs_range_handler),
        )
        .route(
            "/habits/{id}",
            get(routes::habits::get_habit_handler)
                .patch(routes::habits::patch_habit_handler)
                .delete(routes::habits::delete_habit_handler),
        )
        .route("/habits/{id}/logs", post(routes::habits::create_log_handler))
        .route(
            "/habits/{id}/logs/{date}",
            patch(routes::habits::patch_log_handler)
                .delete(routes::habits::delete_log_handler),
        )
        .route(
            "/habits/{id}/streak",
            get(routes::habits::get_streak_handler),
        )
        .route(
            "/goals",
            post(routes::goals::create_goal_handler).get(routes::goals::list_goals_handler),
        )
        .route(
            "/goals/{id}",
            get(routes::goals::get_goal_handler)
                .patch(routes::goals::patch_goal_handler)
                .delete(routes::goals::delete_goal_handler),
        )
        .route(
            "/tasks",
            post(routes::tasks::create_task_handler).get(routes::tasks::list_tasks_handler),
        )
        .route(
            "/tasks/{id}",
            get(routes::tasks::get_task_handler)
                .patch(routes::tasks::patch_task_handler)
                .delete(routes::tasks::delete_task_handler),
        )
        .route(
            "/events",
            post(routes::events::create_event_handler).get(routes::events::list_events_handler),
        )
        .route(
            "/events/{id}",
            get(routes::events::get_event_handler)
                .patch(routes::events::patch_event_handler)
                .delete(routes::events::delete_event_handler),
        )
        .route(
            "/notes",
            post(routes::notes::create_note_handler).get(routes::notes::list_notes_handler),
        )
        .route("/notes/search", get(routes::notes::search_notes_handler))
        .route(
            "/notes/{id}",
            get(routes::notes::get_note_handler)
                .patch(routes::notes::patch_note_handler)
                .delete(routes::notes::delete_note_handler),
        )
        .route(
            "/subscriptions",
            post(routes::subscriptions::create_subscription_handler)
                .get(routes::subscriptions::list_subscriptions_handler),
        )
        .route(
            "/subscriptions/{id}",
            get(routes::subscriptions::get_subscription_handler)
                .patch(routes::subscriptions::patch_subscription_handler)
                .delete(routes::subscriptions::delete_subscription_handler),
        )
        // S-B (finance-simplify-movements): dedicated pay action. One
        // transaction inserts the audit movement, debits the account, stamps
        // `last_paid_on` and advances `next_billing_on`.
        .route(
            "/subscriptions/{id}/pay",
            post(routes::subscriptions::pay_subscription_handler),
        )
        .route(
            "/assets",
            post(routes::assets::create_asset_handler).get(routes::assets::list_assets_handler),
        )
        .route(
            "/assets/{id}",
            get(routes::assets::get_asset_handler)
                .patch(routes::assets::patch_asset_handler)
                .delete(routes::assets::delete_asset_handler),
        )
        .route(
            "/assets/{id}/valuations",
            post(routes::assets::create_valuation_handler),
        )
        .route("/net-worth", get(routes::assets::get_net_worth_handler))
        .route(
            "/tokens",
            post(routes::tokens::create_token_handler)
                .get(routes::tokens::list_tokens_handler),
        )
        .route("/tokens/{id}", delete(routes::tokens::delete_token_handler));
    // Test-only routes proving the `/api` timeout placement (DD4) and the
    // header layer's coverage of API error responses.
    #[cfg(test)]
    let router = router
        .route("/__test__/slow", get(test_slow_handler))
        .route("/__test__/fast", get(test_fast_handler));
    router.fallback(api_fallback_handler)
}

/// Root router: health probes stay at `/`, the API nests under `/api`, and
/// static assets (the exported frontend) serve same-origin with an SPA
/// fallback to `index.html` so the client router owns non-API misses.
/// Assemble the serving router. `api_routes` and `api_timeout` are parameters
/// so tests can mount extra routes and inject a short budget (DD4): the
/// production signature stays [`build_router`]-shaped.
fn assemble(
    state: AppState,
    static_dir: Option<String>,
    api_routes: Router<AppState>,
    api_timeout: Duration,
) -> Router {
    // SEC-003: the budget covers the whole `/api` subtree (including its JSON
    // 404 fallback) and nothing else: `/health`, `/ready` and `ServeDir` are
    // deliberately outside it, and the layer is never applied outermost.
    // `TimeoutLayer::with_status_code` is used instead of the deprecated
    // `TimeoutLayer::new`, which would answer 408 instead of the spec's 504.
    let api_routes = api_routes.layer(TimeoutLayer::with_status_code(
        StatusCode::GATEWAY_TIMEOUT,
        api_timeout,
    ));
    let api: Router<AppState> = Router::new()
        .route("/health", get(routes::health::health_handler))
        .route("/ready", get(routes::ready::ready_handler))
        .nest("/api", api_routes);
    let api = api.with_state(state);

    let app = if let Some(dir) = static_dir {
        tracing::info!("serving static dir: {dir}");
        // The API router must be MERGED, not parked in a fallback chain:
        // `tower_http::ServeDir` answers 405 (allow: GET, HEAD) for POST/PUT/
        // DELETE/PATCH without ever consulting its own fallback, so wiring
        // the API under ServeDir's fallback silently breaks every mutating
        // endpoint when static serving is on. Merged routes win over the
        // fallback for /api/* (unknown /api/* suffixes still hit the JSON
        // 404 in `api_routes`), and ServeDir's own `fallback` serves
        // `index.html` (200) for the SPA router on non-API misses.
        let svc = ServeDir::new(&dir).fallback(ServeFile::new(format!("{dir}/index.html")));
        Router::new().merge(api).fallback_service(svc)
    } else {
        api
    };

    // SEC-006: app-owned security headers. `overriding` guarantees exactly
    // one copy of each header even if a handler ever sets one. The layer sits
    // on the outer assembled router, so API JSON, error responses (401/404),
    // the SPA fallback and `ServeDir` are all covered; the request-id/trace
    // layers stay outermost in `main`. `Permissions-Policy` is edge-owned
    // (`edge-security-headers`) and the CSP is `frame-ancestors 'none'` only:
    // the full-CSP/`script-src` decision is deferred.
    app.layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("frame-ancestors 'none'"),
    ))
}

/// Root router: health probes stay at `/`, the API nests under `/api`, and
/// static assets (the exported frontend) serve same-origin with an SPA
/// fallback to `index.html` so the client router owns non-API misses.
fn build_router(state: AppState, static_dir: Option<String>) -> Router {
    assemble(state, static_dir, api_routes(), API_TIMEOUT)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("config error: {e}");
        std::process::exit(1);
    });

    let pool = db::create_pool(&config.database_url).expect("failed to create pool");

    // One-shot CLI: --create-user <email> <password> <display_name>
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 2 && args[1] == "--create-user" {
        if args.len() != 5 {
            eprintln!("usage: --create-user <email> <password> <display_name>");
            std::process::exit(2);
        }
        let email = args[2].clone();
        let password = args[3].clone();
        let display_name = args[4].clone();
        let hash = auth::password::hash_password(&password).unwrap_or_else(|e| {
            eprintln!("hash error: {e}");
            std::process::exit(1);
        });
        // Insert user + default preferences
        let res = sqlx::query(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind(&hash)
        .bind(&display_name)
        .fetch_one(&pool)
        .await;
        match res {
            Ok(row) => {
                use sqlx::Row;
                let id: uuid::Uuid = row.get("id");
                let _ = sqlx::query("INSERT INTO user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
                    .bind(id)
                    .execute(&pool)
                    .await;
                println!("created user {email} id={id}");
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("create user failed: {e}");
                std::process::exit(1);
            }
        }
    }

    let state = AppState {
        pool,
        session_ttl_hours: config.session_ttl_hours,
        rate_limiter: Arc::new(auth::rate_limit::LoginRateLimiter::new()),
    };

    // Layer order outermost -> innermost: RequestId -> Trace -> CORS -> routes
    // Axum layers: last .layer is outermost, so reverse order
    let app = build_router(state, config.static_dir.clone())
        .layer(TraceLayer::new_for_http())
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid));

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        eprintln!("bind error on {addr}: {e}");
        std::process::exit(1);
    });
    tracing::info!("listening on {addr}");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}

#[cfg(test)]
mod api_nest_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn lazy_state() -> AppState {
        use std::sync::Arc;
        AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool construction must succeed"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(auth::rate_limit::LoginRateLimiter::new()),
        }
    }

    /// SEC-006: the four app-owned headers must be present with exactly these
    /// values, and the app must not emit `Permissions-Policy` (edge-owned) nor
    /// a `script-src` directive (deferred CSP decision).
    fn assert_security_headers(res: &axum::http::Response<Body>, context: &str) {
        let headers = res.headers();
        assert_eq!(
            headers
                .get("x-content-type-options")
                .unwrap_or_else(|| panic!("{context}: missing x-content-type-options")),
            "nosniff",
            "{context}: x-content-type-options"
        );
        assert_eq!(
            headers
                .get("x-frame-options")
                .unwrap_or_else(|| panic!("{context}: missing x-frame-options")),
            "DENY",
            "{context}: x-frame-options"
        );
        assert_eq!(
            headers
                .get("referrer-policy")
                .unwrap_or_else(|| panic!("{context}: missing referrer-policy")),
            "no-referrer",
            "{context}: referrer-policy"
        );
        let csp = headers
            .get("content-security-policy")
            .unwrap_or_else(|| panic!("{context}: missing content-security-policy"));
        assert_eq!(
            csp, "frame-ancestors 'none'",
            "{context}: content-security-policy"
        );
        assert!(
            !csp.to_str().unwrap().contains("script-src"),
            "{context}: CSP must not contain script-src"
        );
        assert!(
            headers.get("permissions-policy").is_none(),
            "{context}: the app must not emit the edge-owned Permissions-Policy"
        );
    }

    // -- Task 0.13 RED: /api nest does not exist yet --
    #[tokio::test]
    async fn protected_routes_live_under_api_prefix() {
        // No Authorization header: reaching the handler yields 401 (not 404),
        // which proves the /api nest routes to the API router.
        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/accounts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn legacy_root_paths_are_gone() {
        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/accounts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn api_unknown_suffix_is_json_404() {
        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/no-such-route")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["error"]["code"], serde_json::Value::String("NOT_FOUND".into()));
    }

    #[tokio::test]
    async fn p9_finanzas_write_routes_are_wired() {
        // Slice S3a: transactions gone with the ledger; budgets gone (S2).
        // S-G (finance-simplify-movements): savings-goals and debts gone
        // with gated migration 0013. Las rutas supervivientes deben existir:
        // sin sesion llegan al handler (401), no a 404/405.
        let _app = build_router(lazy_state(), None);
        let id = uuid::Uuid::new_v4();
        let pid = uuid::Uuid::new_v4();
        for (method, uri) in [
            ("PATCH", format!("/api/assets/{id}")),
            // S-A (finance-simplify-movements): the movements ledger must
            // be reachable — without a session every route answers 401.
            ("GET", "/api/movements".to_string()),
            ("GET", format!("/api/movements/{id}")),
            ("PATCH", format!("/api/movements/{id}")),
            ("DELETE", format!("/api/movements/{id}")),
        ] {
            let app = build_router(lazy_state(), None);
            let res = app
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(&uri)
                        .header("content-type", "application/json")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                res.status(),
                StatusCode::UNAUTHORIZED,
                "{method} {uri} must reach the handler (401), proving the route is wired"
            );
        }
        // S3a atomicity: the manual balance write lands in the same slice
        // as the removal. Axum deserializes `Json` before the handler runs
        // `require_user_id`, so a 401 (not 422) proves `balance` is an
        // accepted PATCH field on a mounted route.
        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/accounts/{id}"))
                    .header("content-type", "application/json")
                    .body(Body::from("{\"balance\": \"-750.50\"}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::UNAUTHORIZED,
            "PATCH /api/accounts/{{id}} with balance must reach the handler (401), proving the balance write is wired"
        );
        // S-A atomicity: the movement write lands in the same slice as the
        // ledger removal it reverses. Axum deserializes `Json` before the
        // handler runs `require_user_id`, so a 401 (not 422) on a VALID
        // body proves `POST /api/movements` is mounted and its DTO accepts
        // exactly the movement fields; `{}` alone would 422 on the missing
        // fields instead of proving the wiring.
        let app = build_router(lazy_state(), None);
        let movement_body = serde_json::json!({
            "direction": "expense",
            "amount": "25000.00",
            "account_id": id,
            "category_id": id,
            "occurred_on": "2026-09-24"
        });
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/movements")
                    .header("content-type", "application/json")
                    .body(Body::from(movement_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::UNAUTHORIZED,
            "POST /api/movements with a valid body must reach the handler (401), proving the route is wired"
        );
        // S-B atomicity: the pay action lands in the same chain as the
        // ledger it writes to. Axum deserializes `Json` before the handler
        // runs `require_user_id`, so a 401 (not 422) on a VALID body proves
        // `POST /api/subscriptions/{id}/pay` is mounted and its DTO accepts
        // exactly `{account_id}`; `{}` alone would 422 on the missing field
        // instead of proving the wiring.
        let app = build_router(lazy_state(), None);
        let pay_body = serde_json::json!({ "account_id": id });
        let res = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/subscriptions/{id}/pay"))
                    .header("content-type", "application/json")
                    .body(Body::from(pay_body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            StatusCode::UNAUTHORIZED,
            "POST /api/subscriptions/{{id}}/pay with a valid body must reach the handler (401), proving the route is wired"
        );
        // Removed routes resolve to the JSON 404 fallback, never to a
        // handler: no /api/transactions, /api/transfers or /api/budgets
        // path may survive S3a; no /api/savings-goals* or /api/debts* path
        // may survive S-G (movements + pay still mounted above).
        for (method, uri) in [
            ("GET", "/api/savings-goals".to_string()),
            ("POST", "/api/savings-goals".to_string()),
            ("GET", format!("/api/savings-goals/{id}")),
            ("PATCH", format!("/api/savings-goals/{id}")),
            ("DELETE", format!("/api/savings-goals/{id}")),
            ("POST", format!("/api/savings-goals/{id}/movements")),
            (
                "DELETE",
                format!("/api/savings-goals/{id}/movements/{pid}"),
            ),
            ("GET", "/api/debts".to_string()),
            ("POST", "/api/debts".to_string()),
            ("GET", format!("/api/debts/{id}")),
            ("PATCH", format!("/api/debts/{id}")),
            ("DELETE", format!("/api/debts/{id}")),
            ("GET", format!("/api/debts/{id}/payments")),
            ("POST", format!("/api/debts/{id}/payments")),
            ("DELETE", format!("/api/debts/{id}/payments/{pid}")),
            ("GET", "/api/transactions".to_string()),
            ("POST", "/api/transactions".to_string()),
            (
                "GET",
                "/api/transactions/stats/by-category".to_string(),
            ),
            (
                "GET",
                "/api/transactions/stats/monthly-flow".to_string(),
            ),
            ("PATCH", format!("/api/transactions/{id}")),
            ("DELETE", format!("/api/transactions/{id}")),
            ("GET", "/api/transfers".to_string()),
            ("GET", "/api/budgets".to_string()),
        ] {
            let app = build_router(lazy_state(), None);
            let res = app
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(&uri)
                        .header("content-type", "application/json")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                res.status(),
                StatusCode::NOT_FOUND,
                "{method} {uri} must be gone (404), proving the removal"
            );
        }
        // The wiring pair in one assertion: the PATCH DTO accepts
        // `balance` while the transaction routes above are gone.
        let body: crate::routes::accounts::PatchAccountRequest =
            serde_json::from_value(serde_json::json!({"balance": "-750.50"}))
                .expect("PATCH accounts must accept balance");
        assert_eq!(body.balance.as_deref(), Some("-750.50"));
        let _ = app;
    }

    #[tokio::test]
    async fn habits_logs_range_route_is_wired_before_id_capture() {
        // GET /api/habits/logs sin sesion debe llegar al handler (401):
        // ni 404 (ruta ausente) ni 422 (captura por /habits/{id} con Uuid).
        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/habits/logs?from=2026-09-01&to=2026-09-30")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn no_cors_headers_on_api_response() {
        // SEC-002: same-origin only. A cross-origin caller must get no
        // `Access-Control-*` headers, and a preflight-shaped OPTIONS must not
        // be answered with an allow decision. A same-origin request (no
        // Origin header) still reaches the handler normally.
        const CORS_HEADERS: [&str; 6] = [
            "access-control-allow-origin",
            "access-control-allow-methods",
            "access-control-allow-headers",
            "access-control-expose-headers",
            "access-control-max-age",
            "access-control-allow-credentials",
        ];

        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/accounts")
                    .header("origin", "http://evil.example")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        for name in CORS_HEADERS {
            assert!(
                res.headers().get(name).is_none(),
                "cross-origin response must not emit {name}"
            );
        }

        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/accounts")
                    .header("origin", "http://evil.example")
                    .header("access-control-request-method", "POST")
                    .header(
                        "access-control-request-headers",
                        "authorization,content-type",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        for name in CORS_HEADERS {
            assert!(
                res.headers().get(name).is_none(),
                "preflight-shaped OPTIONS must not emit {name}"
            );
        }

        // Same-origin: no Origin header, normal handler outcome, still no
        // CORS headers (they were never needed for same-origin access).
        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/accounts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        assert!(res.headers().get("access-control-allow-origin").is_none());
    }

    #[tokio::test]
    async fn api_nest_times_out_but_probes_and_static_do_not() {
        // The production budget is 15 s: far above an Argon2id login, so a
        // real login is never cut off by the timeout layer.
        assert_eq!(API_TIMEOUT, Duration::from_secs(15));
        let dir = std::env::temp_dir().join(format!("s1-timeout-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<html>spa-shell</html>").unwrap();
        std::fs::write(dir.join("asset.txt"), "static-body").unwrap();

        let budget = Duration::from_millis(250);
        let app = assemble(
            lazy_state(),
            Some(dir.to_string_lossy().into_owned()),
            api_routes(),
            budget,
        );

        // A slow `/api` request is in flight while probes and static serving
        // are exercised; none of those may be affected by the API timeout.
        let slow = tokio::spawn({
            let app = app.clone();
            async move {
                app.oneshot(
                    Request::builder()
                        .uri("/api/__test__/slow")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap()
            }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;

        let health = app
            .clone()
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            health.status(),
            StatusCode::OK,
            "GET /health must stay outside the API timeout"
        );

        let ready = app
            .clone()
            .oneshot(Request::builder().uri("/ready").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            ready.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "GET /ready must answer with its own status, never the API timeout"
        );

        let asset = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/asset.txt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            asset.status(),
            StatusCode::OK,
            "ServeDir must stay outside the API timeout"
        );
        let bytes = axum::body::to_bytes(asset.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), b"static-body".as_slice());

        let slow = slow.await.unwrap();
        assert_eq!(
            slow.status(),
            StatusCode::GATEWAY_TIMEOUT,
            "a handler stalling past the budget must return 504"
        );

        // A handler finishing under the budget is never cut off (an
        // Argon2id-length login must not be affected by the 15s budget).
        let fast = app
            .oneshot(
                Request::builder()
                    .uri("/api/__test__/fast")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(fast.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(fast.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(bytes.as_ref(), b"fast".as_slice());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn security_headers_on_static_api_error_and_fallback() {
        let dir = std::env::temp_dir().join(format!("s1-headers-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<html>spa-shell</html>").unwrap();
        std::fs::write(dir.join("asset.txt"), "static-body").unwrap();

        let app = build_router(lazy_state(), Some(dir.to_string_lossy().into_owned()));

        // (i) ServeDir static asset.
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/asset.txt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_security_headers(&res, "static asset");

        // (ii) API JSON error envelope (401).
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/accounts")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        assert_security_headers(&res, "401 API response");
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["error"]["code"], "UNAUTHORIZED");

        // (iii) API 404 error response (JSON fallback inside /api).
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/no-such-route")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
        assert_security_headers(&res, "404 API response");

        // (iv) SPA fallback document served by ServeDir.
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/dashboard/finance")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_security_headers(&res, "SPA fallback");
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(String::from_utf8(bytes.to_vec())
            .unwrap()
            .contains("spa-shell"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn health_stays_at_root_and_spa_fallback_serves_index() {
        let dir = std::env::temp_dir().join(format!("p6-spa-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<html>spa-shell</html>").unwrap();
        let app = build_router(lazy_state(), Some(dir.to_string_lossy().into_owned()));
        // Health probes stay at the root (never under /api).
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        // Unknown non-API paths fall back to index.html for the SPA router.
        let app = build_router(lazy_state(), Some(dir.to_string_lossy().into_owned()));
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/dashboard/finance")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(String::from_utf8(bytes.to_vec()).unwrap().contains("spa-shell"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
