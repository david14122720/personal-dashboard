use axum::{extract::State, http::HeaderMap, Json};
use serde::Serialize;
use uuid::Uuid;

use crate::{auth::middleware, error::AppError, state::AppState};

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub preferences: Preferences,
}

#[derive(Debug, Serialize)]
pub struct Preferences {
    pub currency_code: String,
    pub locale: String,
    pub timezone: String,
    pub dashboard_layout: serde_json::Value,
}

pub async fn me_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let hash = middleware::bearer_hash(&token);

    // Join sessions -> users -> user_preferences, only active session
    let row = sqlx::query_as::<_, (Uuid, String, String, Option<String>, Option<String>, Option<String>, Option<serde_json::Value>)>(
        r#"SELECT u.id, u.email, u.display_name,
                  p.currency_code, p.locale, p.timezone, p.dashboard_layout
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN user_preferences p ON p.user_id = u.id
           WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()"#,
    )
    .bind(&hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    let Some((id, email, display_name, currency, locale, timezone, layout)) = row else {
        return Err(AppError::Auth);
    };

    Ok(Json(MeResponse {
        id,
        email,
        display_name,
        preferences: Preferences {
            currency_code: currency.unwrap_or_else(|| "COP".into()),
            locale: locale.unwrap_or_else(|| "es-CO".into()),
            timezone: timezone.unwrap_or_else(|| "America/Bogota".into()),
            dashboard_layout: layout.unwrap_or(serde_json::json!({})),
        },
    }))
}
