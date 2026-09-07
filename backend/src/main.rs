mod auth;
mod config;
mod db;
mod error;
mod finance;
mod routes;
mod state;

use std::{net::SocketAddr, sync::Arc};

use axum::{
    http::StatusCode,
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde_json::json;
use tower_http::{
    cors::{Any, CorsLayer},
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    services::{ServeDir, ServeFile},
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

/// All API routes, mounted under `/api` by [`build_router`].
/// Slice 0 (p6-frontend-dashboard) adds the dashboard reads
/// (`GET /transactions` + stats, `GET /habits/today`, `PATCH /me/preferences`)
/// and upgrades `GET /budgets` to the collection-with-status shape.
fn api_routes() -> Router<AppState> {
    Router::new()
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
            "/accounts/:id",
            get(routes::accounts::get_account_handler)
                .patch(routes::accounts::patch_account_handler),
        )
        .route(
            "/transactions",
            post(routes::transactions::create_transaction_handler)
                .get(routes::transactions::list_transactions_handler),
        )
        .route(
            "/transactions/stats/by-category",
            get(routes::transactions::transactions_by_category_handler),
        )
        .route(
            "/transactions/stats/monthly-flow",
            get(routes::transactions::transactions_monthly_flow_handler),
        )
        .route(
            "/transactions/:id",
            patch(routes::transactions::patch_transaction_handler)
                .delete(routes::transactions::delete_transaction_handler),
        )
        .route(
            "/transfers",
            post(routes::transfers::create_transfer_handler),
        )
        .route(
            "/budgets",
            post(routes::budgets::create_budget_handler).get(routes::budgets::list_budgets_handler),
        )
        .route("/budgets/:id", get(routes::budgets::get_budget_handler))
        .route(
            "/budgets/:id/status",
            get(routes::budgets::budget_status_handler),
        )
        .route(
            "/savings-goals",
            post(routes::savings::create_goal_handler).get(routes::savings::list_goals_handler),
        )
        .route(
            "/savings-goals/:id",
            get(routes::savings::get_goal_handler).delete(routes::savings::delete_goal_handler),
        )
        .route(
            "/savings-goals/:id/movements",
            post(routes::savings::create_movement_handler),
        )
        .route(
            "/savings-goals/:id/movements/:mid",
            delete(routes::savings::delete_movement_handler),
        )
        .route(
            "/debts",
            post(routes::debts::create_debt_handler).get(routes::debts::list_debts_handler),
        )
        .route(
            "/debts/:id",
            get(routes::debts::get_debt_handler).delete(routes::debts::delete_debt_handler),
        )
        .route(
            "/debts/:id/payments",
            post(routes::debts::create_payment_handler),
        )
        .route(
            "/habits",
            post(routes::habits::create_habit_handler).get(routes::habits::list_habits_handler),
        )
        .route(
            "/habits/today",
            get(routes::habits::today_habits_handler),
        )
        .route(
            "/habits/:id",
            get(routes::habits::get_habit_handler)
                .patch(routes::habits::patch_habit_handler)
                .delete(routes::habits::delete_habit_handler),
        )
        .route("/habits/:id/logs", post(routes::habits::create_log_handler))
        .route(
            "/habits/:id/logs/:date",
            patch(routes::habits::patch_log_handler),
        )
        .route(
            "/habits/:id/streak",
            get(routes::habits::get_streak_handler),
        )
        .route(
            "/goals",
            post(routes::goals::create_goal_handler).get(routes::goals::list_goals_handler),
        )
        .route(
            "/goals/:id",
            get(routes::goals::get_goal_handler)
                .patch(routes::goals::patch_goal_handler)
                .delete(routes::goals::delete_goal_handler),
        )
        .route(
            "/tasks",
            post(routes::tasks::create_task_handler).get(routes::tasks::list_tasks_handler),
        )
        .route(
            "/tasks/:id",
            get(routes::tasks::get_task_handler)
                .patch(routes::tasks::patch_task_handler)
                .delete(routes::tasks::delete_task_handler),
        )
        .route(
            "/events",
            post(routes::events::create_event_handler).get(routes::events::list_events_handler),
        )
        .route(
            "/events/:id",
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
            "/notes/:id",
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
            "/subscriptions/:id",
            get(routes::subscriptions::get_subscription_handler)
                .patch(routes::subscriptions::patch_subscription_handler)
                .delete(routes::subscriptions::delete_subscription_handler),
        )
        .route(
            "/assets",
            post(routes::assets::create_asset_handler).get(routes::assets::list_assets_handler),
        )
        .route(
            "/assets/:id",
            get(routes::assets::get_asset_handler).delete(routes::assets::delete_asset_handler),
        )
        .route(
            "/assets/:id/valuations",
            post(routes::assets::create_valuation_handler),
        )
        .route("/net-worth", get(routes::assets::get_net_worth_handler))
        .fallback(api_fallback_handler)
}

/// Root router: health probes stay at `/`, the API nests under `/api`, and
/// static assets (the exported frontend) serve same-origin with an SPA
/// fallback to `index.html` so the client router owns non-API misses.
fn build_router(state: AppState, static_dir: Option<String>) -> Router {
    let api: Router<AppState> = Router::new()
        .route("/health", get(routes::health::health_handler))
        .route("/ready", get(routes::ready::ready_handler))
        .nest("/api", api_routes());
    let api = api.with_state(state);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let with_cors = api.layer(cors);

    if let Some(dir) = static_dir {
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
        Router::new()
            .merge(with_cors)
            .fallback_service(svc)
    } else {
        with_cors
    }
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

    // -- Task 0.13 RED: /api nest does not exist yet --
    #[tokio::test]
    async fn protected_routes_live_under_api_prefix() {
        // No Authorization header: reaching the handler yields 401 (not 404),
        // which proves the /api nest routes to the API router.
        let app = build_router(lazy_state(), None);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/api/budgets")
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
                    .uri("/budgets")
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
