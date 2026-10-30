use axum::{extract::State, http::HeaderMap, http::StatusCode, response::IntoResponse};

use crate::{auth::middleware, error::AppError, state::AppState};

pub async fn logout_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let hash = middleware::bearer_hash(&token);

    // A4: the revoking UPDATE requires an active owner, so a deactivated
    // user's logout is the same generic 401 as every other authed route and
    // no session row is written.
    let res = sqlx::query(
        "UPDATE sessions s SET revoked_at = now() \
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() \
           AND EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.is_active)",
    )
    .bind(&hash)
    .execute(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;

    if res.rows_affected() == 0 {
        // Check if an active-owner session exists at all -> 401 generic,
        // else treat as success (idempotent but spec says revoke).
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id \
             WHERE s.token_hash = $1 AND u.is_active",
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::rate_limit::LoginRateLimiter;
    use std::sync::Arc;
    use uuid::Uuid;

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

    async fn seed_user_and_session(pool: &sqlx::PgPool, active: bool) -> (Uuid, String) {
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name, is_active) VALUES ($1,$2,$3,$4) RETURNING id",
        )
        .bind(format!("logout-{}@example.com", Uuid::new_v4()))
        .bind("not-a-real-hash")
        .bind("logout test")
        .bind(active)
        .fetch_one(pool)
        .await
        .expect("seed user");
        let raw = crate::auth::tokens::generate_token();
        let hash = crate::auth::tokens::hash_token(&raw);
        sqlx::query(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')",
        )
        .bind(user_id)
        .bind(&hash)
        .execute(pool)
        .await
        .expect("seed session");
        (user_id, raw)
    }

    async fn session_revoked(pool: &sqlx::PgPool, raw: &str) -> bool {
        let hash = middleware::bearer_hash(raw);
        let revoked: Option<chrono::DateTime<chrono::Utc>> =
            sqlx::query_scalar("SELECT revoked_at FROM sessions WHERE token_hash = $1")
                .bind(&hash)
                .fetch_one(pool)
                .await
                .expect("read revoked_at");
        revoked.is_some()
    }

    async fn cleanup(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    #[tokio::test]
    async fn deactivated_user_logout_is_401_and_revokes_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP deactivated_user_logout_is_401_and_revokes_nothing: no DATABASE_URL");
            return;
        };
        let (user_id, raw) = seed_user_and_session(&pool, false).await;
        let err = match logout_handler(State(state(pool.clone())), headers(&raw)).await {
            Ok(_) => panic!("a deactivated user's logout must be 401"),
            Err(err) => err,
        };
        assert_eq!(
            err.into_response().status(),
            StatusCode::UNAUTHORIZED,
            "logout must use the same 401 envelope as every authed route"
        );
        assert!(
            !session_revoked(&pool, &raw).await,
            "a deactivated user's logout must not revoke the session row"
        );
        cleanup(&pool, user_id).await;
    }

    #[tokio::test]
    async fn active_user_logout_is_204_and_revokes() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP active_user_logout_is_204_and_revokes: no DATABASE_URL");
            return;
        };
        let (user_id, raw) = seed_user_and_session(&pool, true).await;
        let res = logout_handler(State(state(pool.clone())), headers(&raw))
            .await
            .expect("an active session must log out");
        assert_eq!(res.into_response().status(), StatusCode::NO_CONTENT);
        assert!(session_revoked(&pool, &raw).await);
        cleanup(&pool, user_id).await;
    }

    #[tokio::test]
    async fn second_logout_is_idempotent_204() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP second_logout_is_idempotent_204: no DATABASE_URL");
            return;
        };
        let (user_id, raw) = seed_user_and_session(&pool, true).await;
        let _ = logout_handler(State(state(pool.clone())), headers(&raw))
            .await
            .expect("first logout");
        let res = logout_handler(State(state(pool.clone())), headers(&raw))
            .await
            .expect("second logout stays idempotent");
        assert_eq!(res.into_response().status(), StatusCode::NO_CONTENT);
        cleanup(&pool, user_id).await;
    }
}
