use axum::http::HeaderMap;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{auth::middleware, error::AppError};

// Allowed until finance routes (PR2+) call it; covered by unit tests.
#[allow(dead_code)]
/// Resolve the authenticated user id from the `Authorization: Bearer` session token.
///
/// Returns `AppError::Auth` (401) when the header is missing/malformed or when
/// no active, unexpired session matches the token. Database failures map to
/// `AppError::Internal` so infrastructure problems are never confused with
/// bad credentials. Never leaks whether a token ever existed (unknown,
/// expired, and revoked tokens all map to 401).
pub async fn require_user_id(headers: &HeaderMap, pool: &PgPool) -> Result<Uuid, AppError> {
    let token = middleware::extract_bearer(headers).ok_or(AppError::Auth)?;
    let hash = middleware::bearer_hash(&token);
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT s.user_id FROM sessions s
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await
    .map_err(|_| AppError::Internal)?;
    row.map(|(user_id,)| user_id).ok_or(AppError::Auth)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};
    use axum::response::IntoResponse;

    /// Lazy pool that never connects — safe for tests that must fail
    /// before touching the database (missing/malformed headers).
    fn lazy_pool() -> PgPool {
        PgPool::connect_lazy("postgres://localhost:1/unused")
            .expect("lazy pool construction must succeed")
    }

    fn headers_with(auth: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            HeaderValue::from_str(auth).unwrap(),
        );
        h
    }

    /// Real pool from `DATABASE_URL`, or `None` when no database is
    /// available (local unit runs). DB-backed tests skip honestly instead
    /// of failing without infrastructure.
    fn test_pool() -> Option<PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    fn assert_unauthorized(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn missing_header_is_401() {
        let pool = lazy_pool();
        let err = require_user_id(&HeaderMap::new(), &pool).await.unwrap_err();
        assert_unauthorized(err);
    }

    #[tokio::test]
    async fn wrong_scheme_is_401() {
        let pool = lazy_pool();
        let err = require_user_id(&headers_with("Basic abc123"), &pool)
            .await
            .unwrap_err();
        assert_unauthorized(err);
    }

    #[tokio::test]
    async fn empty_bearer_token_is_401() {
        let pool = lazy_pool();
        let err = require_user_id(&headers_with("Bearer "), &pool)
            .await
            .unwrap_err();
        assert_unauthorized(err);
    }

    #[tokio::test]
    async fn unknown_token_is_401() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unknown_token_is_401: no DATABASE_URL");
            return;
        };
        let err = require_user_id(&headers_with("Bearer does-not-exist"), &pool)
            .await
            .unwrap_err();
        assert_unauthorized(err);
    }

    #[tokio::test]
    async fn expired_session_is_401() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP expired_session_is_401: no DATABASE_URL");
            return;
        };
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(format!("helper-expired-{}@example.com", Uuid::new_v4()))
        .bind("not-a-real-hash")
        .bind("helper test")
        .fetch_one(&pool)
        .await
        .expect("seed user");
        let raw = crate::auth::tokens::generate_token();
        let hash = crate::auth::tokens::hash_token(&raw);
        sqlx::query(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 hour')",
        )
        .bind(user_id)
        .bind(&hash)
        .execute(&pool)
        .await
        .expect("seed expired session");
        let err = require_user_id(&headers_with(&format!("Bearer {raw}")), &pool)
            .await
            .unwrap_err();
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("cleanup user");
        assert_unauthorized(err);
    }

    #[tokio::test]
    async fn valid_session_returns_user_id() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP valid_session_returns_user_id: no DATABASE_URL");
            return;
        };
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(format!("helper-valid-{}@example.com", Uuid::new_v4()))
        .bind("not-a-real-hash")
        .bind("helper test")
        .fetch_one(&pool)
        .await
        .expect("seed user");
        let raw = crate::auth::tokens::generate_token();
        let hash = crate::auth::tokens::hash_token(&raw);
        sqlx::query(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
        )
        .bind(user_id)
        .bind(&hash)
        .execute(&pool)
        .await
        .expect("seed valid session");
        let got = require_user_id(&headers_with(&format!("Bearer {raw}")), &pool)
            .await
            .expect("valid session resolves");
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("cleanup user");
        assert_eq!(got, user_id);
    }
}
