use axum::http::HeaderMap;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{auth::tokens::hash_token, error::AppError};

/// Extract Bearer token from `Authorization` header.
/// Returns `None` if missing or not `Bearer <token>` (case-sensitive prefix).
pub fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?;
    if token.trim().is_empty() {
        return None;
    }
    Some(token.to_string())
}

/// Hash a bearer token for DB lookup: `hex(SHA-256(token))`.
pub fn bearer_hash(token: &str) -> String {
    hash_token(token)
}

/// Active session lookup: unrevoked and unexpired.
const SESSION_LOOKUP_SQL: &str = "SELECT s.user_id FROM sessions s WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()";
/// Active API-token lookup: unrevoked and (no expiry or still valid).
const API_TOKEN_LOOKUP_SQL: &str = "SELECT user_id FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())";
/// Touch an API token on successful use (never leaks whether the token
/// existed: a miss simply yields 401 without writing anything).
const API_TOKEN_TOUCH_SQL: &str =
    "UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1";

/// Resolve the authenticated user id from a raw Bearer token.
///
/// Sessions take priority over API tokens: the session table is checked
/// first, and only a session miss falls through to `api_tokens`. A matched
/// API token gets `last_used_at = now()` before its `user_id` is returned.
/// Unknown, expired, and revoked tokens all map to `AppError::Auth` (401)
/// so callers never learn whether a token ever existed; database failures
/// map to `AppError::Internal`.
pub async fn resolve_token_user_id(
    pool: &PgPool,
    raw_token: &str,
) -> Result<Uuid, AppError> {
    let hash = bearer_hash(raw_token);
    let session_user: Option<(Uuid,)> = sqlx::query_as(SESSION_LOOKUP_SQL)
        .bind(&hash)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if let Some((user_id,)) = session_user {
        return Ok(user_id);
    }
    let api_user: Option<(Uuid,)> = sqlx::query_as(API_TOKEN_LOOKUP_SQL)
        .bind(&hash)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    let Some((user_id,)) = api_user else {
        return Err(AppError::Auth);
    };
    sqlx::query(API_TOKEN_TOUCH_SQL)
        .bind(&hash)
        .execute(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(user_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    fn headers_with(auth: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(auth).unwrap(),
        );
        h
    }

    #[test]
    fn extract_valid_bearer() {
        let h = headers_with("Bearer abc123");
        assert_eq!(extract_bearer(&h).as_deref(), Some("abc123"));
    }

    #[test]
    fn missing_header_returns_none() {
        let h = HeaderMap::new();
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn wrong_scheme_returns_none() {
        let h = headers_with("Basic abc123");
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn bearer_lowercase_returns_none() {
        let h = headers_with("bearer abc123");
        assert!(extract_bearer(&h).is_none());
    }

    #[test]
    fn empty_token_returns_none() {
        let h = headers_with("Bearer ");
        assert!(extract_bearer(&h).is_none());
        let h2 = headers_with("Bearer    ");
        assert!(extract_bearer(&h2).is_none());
    }

    #[test]
    fn bearer_hash_is_sha256_hex() {
        let h = bearer_hash("abc");
        assert_eq!(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(h.len(), 64);
    }
}
