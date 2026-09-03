use axum::{extract::State, http::HeaderMap, http::StatusCode, response::IntoResponse};

use crate::{auth::middleware, error::AppError, state::AppState};

pub async fn logout_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let hash = middleware::bearer_hash(&token);

    let res = sqlx::query(
        "UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
    )
    .bind(&hash)
    .execute(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    if res.rows_affected() == 0 {
        // Check if session exists at all -> 401 generic, else treat as success (idempotent but spec says revoke)
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM sessions WHERE token_hash = $1",
        )
        .bind(&hash)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
        if exists == 0 {
            return Err(AppError::Auth);
        }
    }
    Ok(StatusCode::NO_CONTENT)
}
