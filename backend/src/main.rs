mod config;
mod db;
mod error;
mod routes;
mod state;

use axum::{Router, routing::get};
use tower_http::{
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

    let state = AppState {
        pool,
        session_ttl_hours: config.session_ttl_hours,
    };

    let api = Router::new()
        .route("/health", get(routes::health::health_handler))
        .route("/ready", get(routes::ready::ready_handler))
        .with_state(state);

    // x-request-id outermost: SetRequestId (outer) -> Propagate -> Trace -> routes
    // STATIC_DIR hook: when set, ServeDir fallback after API routes.
    let app = if let Some(dir) = config.static_dir.clone() {
        tracing::info!("serving static dir: {dir}");
        let svc = tower_http::services::ServeDir::new(dir).not_found_service(api);
        Router::new()
            .fallback_service(svc)
            .layer(TraceLayer::new_for_http())
            .layer(PropagateRequestIdLayer::x_request_id())
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
    } else {
        api.layer(TraceLayer::new_for_http())
            .layer(PropagateRequestIdLayer::x_request_id())
            .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
    };

    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        eprintln!("bind error on {addr}: {e}");
        std::process::exit(1);
    });
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await.unwrap();
}
