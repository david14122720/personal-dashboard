mod auth;
mod config;
mod db;
mod error;
mod finance;
mod routes;
mod state;

use std::{net::SocketAddr, sync::Arc};

use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use config::Config;
use state::AppState;

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

    let api = Router::new()
        .route("/health", get(routes::health::health_handler))
        .route("/ready", get(routes::ready::ready_handler))
        .route("/login", post(routes::login::login_handler))
        .route("/logout", post(routes::logout::logout_handler))
        .route("/me", get(routes::me::me_handler))
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
            post(routes::transactions::create_transaction_handler),
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
        .with_state(state);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Layer order outermost -> innermost: RequestId -> Trace -> CORS -> routes
    // Axum layers: last .layer is outermost, so reverse order
    let with_cors = api.layer(cors);

    let app = if let Some(dir) = config.static_dir.clone() {
        tracing::info!("serving static dir: {dir}");
        let svc = tower_http::services::ServeDir::new(dir).not_found_service(with_cors);
        Router::new()
            .fallback_service(svc)
            .layer(TraceLayer::new_for_http())
            .layer(PropagateRequestIdLayer::x_request_id())
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
    } else {
        with_cors
            .layer(TraceLayer::new_for_http())
            .layer(PropagateRequestIdLayer::x_request_id())
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
    };

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
