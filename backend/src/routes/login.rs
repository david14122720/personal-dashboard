use axum::{extract::State, http::HeaderMap, Json};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::{password::verify_password, tokens},
    error::AppError,
    state::AppState,
};

/// Look up a user by email. `$1` is cast to `citext` so the comparison is
/// case-insensitive, matching the `CITEXT` column type (a plain `text` bind
/// would otherwise resolve `citext = text` case-sensitively).
const LOGIN_LOOKUP_SQL: &str =
    "SELECT id, password_hash, is_active FROM users WHERE email = $1::citext";

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub expires_at: chrono::DateTime<Utc>,
}

fn client_ip(headers: &HeaderMap) -> std::net::IpAddr {
    // Prefer X-Forwarded-For first IP, fallback to X-Real-Ip, else loopback
    if let Some(v) = headers.get("x-forwarded-for").and_then(|h| h.to_str().ok()) {
        if let Some(first) = v.split(',').next() {
            if let Ok(ip) = first.trim().parse() {
                return ip;
            }
        }
    }
    if let Some(v) = headers.get("x-real-ip").and_then(|h| h.to_str().ok()) {
        if let Ok(ip) = v.trim().parse() {
            return ip;
        }
    }
    std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))
}

pub async fn login_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, AppError> {
    let email = body.email.trim().to_string();
    let password = body.password;

    if email.is_empty() || password.is_empty() {
        return Err(AppError::Validation("email and password required".into()));
    }
    if email.len() > 320 || password.len() > 1024 {
        return Err(AppError::Validation("invalid input".into()));
    }

    // Rate limit before DB work
    let ip = client_ip(&headers);
    if let Some(retry) = state.rate_limiter.check(ip) {
        let secs = retry.as_secs().max(1);
        return Err(AppError::RateLimited(secs));
    }

    // Fetch user by CITEXT email
    let row = sqlx::query_as::<_, (uuid::Uuid, String, bool)>(LOGIN_LOOKUP_SQL)
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    let Some((user_id, hash, is_active)) = row else {
        return Err(AppError::Auth);
    };
    if !is_active || !verify_password(&password, &hash) {
        return Err(AppError::Auth);
    }

    let token = tokens::generate_token();
    let token_hash = tokens::hash_token(&token);
    let expires_at = Utc::now() + Duration::hours(state.session_ttl_hours as i64);

    let ip_str = ip.to_string();
    sqlx::query(
        "INSERT INTO sessions (user_id, token_hash, expires_at, ip_address) VALUES ($1,$2,$3,$4::inet)",
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires_at)
    .bind(&ip_str)
    .execute(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    Ok(Json(LoginResponse { token, expires_at }))
}

#[cfg(test)]
mod tests {
    use super::LOGIN_LOOKUP_SQL;

    #[test]
    fn login_lookup_binds_email_as_citext() {
        // Regression: the email lookup predicate MUST cast `$1` to `citext` so
        // that `citext = citext` comparison is case-insensitive. If it binds a
        // plain `text` value, PG falls back to case-sensitive comparison and
        // login fails for any casing other than the stored one.
        assert!(
            LOGIN_LOOKUP_SQL.contains("WHERE email = $1::citext"),
            "login lookup must use CITEXT-aware comparison, got: {LOGIN_LOOKUP_SQL}"
        );
    }
}
