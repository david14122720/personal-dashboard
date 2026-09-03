mod auth;
mod config;
mod db;
mod error;
mod routes;
mod state;

use std::{net::SocketAddr, sync::Arc};

use axum::{
    routing::{get, post},
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
