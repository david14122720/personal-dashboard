//! Session management (A5): list the caller's sessions and revoke every
//! session except the presenting one.
//!
//! Session-only: personal API tokens get 401, mirroring
//! `require_session_user_id` (sessions mint credentials, tokens never manage
//! them). `token_hash` is never selected into the response row and never
//! serialized; `current` is computed in SQL from the presenting hash.

use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    auth::{helper::require_session_user_id, middleware},
    error::AppError,
    state::AppState,
};

/// Caller-scoped list, newest first. `current` is computed from the
/// presenting token's hash; the hash itself is never a selected column.
/// Only rows that are still live are listed: a revoked or expired session
/// is not a session the caller can manage, and listing it would contradict
/// the revoke action that just answered 204 (live-verification finding
/// 2026-10-04).
const LIST_SESSIONS_SQL: &str = "SELECT id, created_at, expires_at, revoked_at, user_agent, ip_address::text, (token_hash = $2) AS current FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC, id DESC";

/// Revoke every active session of the caller except the presenting one.
/// Idempotent: a second call affects zero rows and still answers 204.
const REVOKE_OTHER_SESSIONS_SQL: &str = "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL AND expires_at > now()";

#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub current: bool,
}

/// `GET /api/sessions`: the caller's sessions, newest first, with `current`
/// true only for the presenting session. Session bearer only: an API token
/// gets the same generic 401 as everywhere else.
pub async fn list_sessions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<SessionResponse>>, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let user_id = require_session_user_id(&headers, &state.pool).await?;
    let hash = middleware::bearer_hash(&token);
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            DateTime<Utc>,
            DateTime<Utc>,
            Option<DateTime<Utc>>,
            Option<String>,
            Option<String>,
            bool,
        ),
    >(LIST_SESSIONS_SQL)
    .bind(user_id)
    .bind(&hash)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(id, created_at, expires_at, revoked_at, user_agent, ip_address, current)| {
                    SessionResponse {
                        id,
                        created_at,
                        expires_at,
                        revoked_at,
                        user_agent,
                        ip_address,
                        current,
                    }
                },
            )
            .collect(),
    ))
}

/// `DELETE /api/sessions`: revoke every active session of the caller except
/// the presenting one. Always 204, including when nothing needed revoking.
pub async fn delete_sessions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<StatusCode, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let user_id = require_session_user_id(&headers, &state.pool).await?;
    let hash = middleware::bearer_hash(&token);
    sqlx::query(REVOKE_OTHER_SESSIONS_SQL)
        .bind(user_id)
        .bind(&hash)
        .execute(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{rate_limit::LoginRateLimiter, tokens as token_crypto};
    use axum::response::IntoResponse;
    use std::sync::Arc;

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    fn state(pool: sqlx::PgPool) -> AppState {
        AppState {
            pool,
            session_ttl_hours: 24,
            rate_limiter: Arc::new(LoginRateLimiter::new()),
        }
    }

    fn headers(raw: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {raw}").parse().unwrap(),
        );
        h
    }

    /// Seed one user with `n` active sessions. Session `i` is created `i`
    /// minutes after the first, so `created_at DESC` ordering is observable.
    async fn seed_user_with_sessions(pool: &sqlx::PgPool, n: usize) -> (Uuid, Vec<String>) {
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(format!("sessions-{}@example.com", Uuid::new_v4()))
        .bind("not-a-real-hash")
        .bind("sessions test")
        .fetch_one(pool)
        .await
        .expect("seed user");
        let mut raws = Vec::new();
        for i in 0..n {
            let raw = token_crypto::generate_token();
            let hash = token_crypto::hash_token(&raw);
            sqlx::query(
                "INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address, created_at) \
                 VALUES ($1, $2, now() + interval '1 hour', $3, $4::inet, now() + ($5 * interval '1 minute'))",
            )
            .bind(user_id)
            .bind(&hash)
            .bind("sessions-test-agent/1.0")
            .bind("192.0.2.7")
            .bind(i as i32)
            .execute(pool)
            .await
            .expect("seed session");
            raws.push(raw);
        }
        (user_id, raws)
    }

    async fn cleanup(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    async fn session_active(pool: &sqlx::PgPool, raw: &str) -> bool {
        let hash = middleware::bearer_hash(raw);
        let revoked: Option<DateTime<Utc>> =
            sqlx::query_scalar("SELECT revoked_at FROM sessions WHERE token_hash = $1")
                .bind(&hash)
                .fetch_one(pool)
                .await
                .expect("read revoked_at");
        revoked.is_none()
    }

    #[test]
    fn list_sql_computes_current_without_selecting_the_hash() {
        assert!(
            LIST_SESSIONS_SQL.contains("(token_hash = $2) AS current"),
            "current must be computed in SQL from the presenting hash, got: {LIST_SESSIONS_SQL}"
        );
        assert!(
            !LIST_SESSIONS_SQL.contains("SELECT token_hash")
                && !LIST_SESSIONS_SQL.contains("token_hash,"),
            "the hash must never be a selected response column, got: {LIST_SESSIONS_SQL}"
        );
        assert!(LIST_SESSIONS_SQL.contains("WHERE user_id = $1"));
        assert!(
            LIST_SESSIONS_SQL.contains("revoked_at IS NULL")
                && LIST_SESSIONS_SQL.contains("expires_at > now()"),
            "the list must exclude revoked and expired sessions, got: {LIST_SESSIONS_SQL}"
        );
        assert!(LIST_SESSIONS_SQL.contains("ORDER BY created_at DESC"));
        assert!(REVOKE_OTHER_SESSIONS_SQL.contains("token_hash <> $2"));
        assert!(REVOKE_OTHER_SESSIONS_SQL.contains("WHERE user_id = $1"));
        assert!(REVOKE_OTHER_SESSIONS_SQL.contains("revoked_at IS NULL"));
    }

    #[test]
    fn response_shape_carries_no_hash_field() {
        let row = SessionResponse {
            id: Uuid::new_v4(),
            created_at: Utc::now(),
            expires_at: Utc::now(),
            revoked_at: None,
            user_agent: None,
            ip_address: None,
            current: true,
        };
        let body = serde_json::to_string(&row).expect("serialize");
        assert!(!body.contains("token_hash"), "body leaked token_hash: {body}");
        assert!(body.contains("\"current\":true"));
    }

    #[tokio::test]
    async fn list_returns_the_callers_sessions_newest_first_without_secrets() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP list_returns_the_callers_sessions_newest_first_without_secrets: no DATABASE_URL");
            return;
        };
        let (user_id, raws) = seed_user_with_sessions(&pool, 2).await;
        let res = list_sessions_handler(State(state(pool.clone())), headers(&raws[1]))
            .await
            .expect("list must succeed");
        let rows = res.0;
        assert_eq!(rows.len(), 2, "both sessions belong to the caller");
        assert_eq!(
            rows[0].current, true,
            "the newest row is the presenting session"
        );
        assert_eq!(rows.iter().filter(|r| r.current).count(), 1);
        assert!(
            rows[0].created_at > rows[1].created_at,
            "rows must be ordered created_at DESC"
        );
        let body = serde_json::to_string(&rows).expect("serialize");
        assert!(!body.contains("token_hash"), "list leaked token_hash: {body}");
        for raw in &raws {
            assert!(
                !body.contains(&middleware::bearer_hash(raw)),
                "list leaked a token hash value"
            );
        }
        cleanup(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_revokes_every_other_session_and_spares_the_caller() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP delete_revokes_every_other_session_and_spares_the_caller: no DATABASE_URL"
            );
            return;
        };
        let (user_id, raws) = seed_user_with_sessions(&pool, 3).await;
        let res = delete_sessions_handler(State(state(pool.clone())), headers(&raws[1]))
            .await
            .expect("delete must succeed");
        assert_eq!(res, StatusCode::NO_CONTENT);
        assert!(
            session_active(&pool, &raws[1]).await,
            "the presenting session must never be revoked"
        );
        for other in [&raws[0], &raws[2]] {
            assert!(
                !session_active(&pool, other).await,
                "every other session must be revoked"
            );
        }
        // Idempotent: a second call still answers 204 and spares the caller.
        let res = delete_sessions_handler(State(state(pool.clone())), headers(&raws[1]))
            .await
            .expect("second delete must succeed");
        assert_eq!(res, StatusCode::NO_CONTENT);
        assert!(session_active(&pool, &raws[1]).await);

        // The list is the caller's view of the revoke: revoked rows must not
        // survive it (live-verification finding 2026-10-04).
        let listed = list_sessions_handler(State(state(pool.clone())), headers(&raws[1]))
            .await
            .expect("list must succeed")
            .0;
        assert_eq!(
            listed.len(),
            1,
            "only the presenting session may remain listed, got: {:?}",
            listed.iter().map(|s| (s.id, s.current)).collect::<Vec<_>>()
        );
        assert!(
            listed[0].current,
            "the surviving row must be the presenting session"
        );
        cleanup(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_with_only_the_presenting_session_is_idempotent() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_with_only_the_presenting_session_is_idempotent: no DATABASE_URL");
            return;
        };
        let (user_id, raws) = seed_user_with_sessions(&pool, 1).await;
        for _ in 0..2 {
            let res = delete_sessions_handler(State(state(pool.clone())), headers(&raws[0]))
                .await
                .expect("delete must succeed");
            assert_eq!(res, StatusCode::NO_CONTENT);
        }
        assert!(session_active(&pool, &raws[0]).await);
        cleanup(&pool, user_id).await;
    }

    #[tokio::test]
    async fn api_tokens_cannot_list_or_delete_sessions() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP api_tokens_cannot_list_or_delete_sessions: no DATABASE_URL");
            return;
        };
        let (user_id, raws) = seed_user_with_sessions(&pool, 1).await;
        let raw_token = format!("pd_{}", token_crypto::generate_token());
        let hash = token_crypto::hash_token(&raw_token);
        sqlx::query(
            "INSERT INTO api_tokens (user_id, name, token_hash, prefix, expires_at, revoked_at) VALUES ($1, $2, $3, $4, NULL, NULL)",
        )
        .bind(user_id)
        .bind("sessions test token")
        .bind(&hash)
        .bind("pd_sessi")
        .execute(&pool)
        .await
        .expect("seed api token");

        let err = list_sessions_handler(State(state(pool.clone())), headers(&raw_token))
            .await
            .expect_err("an API token must not list sessions");
        assert_eq!(err.into_response().status(), StatusCode::UNAUTHORIZED);
        let err = delete_sessions_handler(State(state(pool.clone())), headers(&raw_token))
            .await
            .expect_err("an API token must not delete sessions");
        assert_eq!(err.into_response().status(), StatusCode::UNAUTHORIZED);
        assert!(
            session_active(&pool, &raws[0]).await,
            "a rejected API token must not touch any session row"
        );
        cleanup(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_sessions_are_not_touched() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_sessions_are_not_touched: no DATABASE_URL");
            return;
        };
        let (caller_id, caller_raws) = seed_user_with_sessions(&pool, 2).await;
        let (other_id, other_raws) = seed_user_with_sessions(&pool, 2).await;
        let res = delete_sessions_handler(State(state(pool.clone())), headers(&caller_raws[0]))
            .await
            .expect("delete must succeed");
        assert_eq!(res, StatusCode::NO_CONTENT);
        for other in &other_raws {
            assert!(
                session_active(&pool, other).await,
                "another user's sessions must never be revoked"
            );
        }
        // The list is scoped too, and it reflects the revoke: the caller's
        // revoked sibling is gone while the foreign user keeps both.
        let rows = list_sessions_handler(State(state(pool.clone())), headers(&caller_raws[0]))
            .await
            .expect("list must succeed")
            .0;
        assert_eq!(
            rows.len(),
            1,
            "the caller's revoked sibling must not be listed, got: {:?}",
            rows.iter().map(|s| (s.id, s.current)).collect::<Vec<_>>()
        );
        assert!(rows[0].current, "the surviving row is the presenting session");
        let foreign_rows = list_sessions_handler(State(state(pool.clone())), headers(&other_raws[0]))
            .await
            .expect("foreign list must succeed")
            .0;
        assert_eq!(
            foreign_rows.len(),
            2,
            "the other user's sessions must be untouched by the caller's revoke"
        );
        cleanup(&pool, caller_id).await;
        cleanup(&pool, other_id).await;
    }
}
