use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use serde_json::json;
use tokio::time::{Duration, timeout};

use crate::state::AppState;

pub async fn ready_handler(State(state): State<AppState>) -> impl IntoResponse {
    let check = timeout(Duration::from_secs(2), sqlx::query("SELECT 1").execute(&state.pool)).await;

    match check {
        Ok(Ok(_)) => (StatusCode::OK, Json(json!({ "status": "ready" }))).into_response(),
        _ => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "status": "not-ready" })),
        )
            .into_response(),
    }
}
