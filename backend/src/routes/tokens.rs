//! Personal API tokens (long-lived `pd_` Bearer credentials), scoped by `user_id`.
//!
//! Creation (`POST /api/tokens`) requires an active *session* Bearer token:
//! a leaked API token must never mint new credentials. Listing and revoking
//! accept either a session or an API token (see
//! [`middleware::resolve_token_user_id`][crate::auth::middleware::resolve_token_user_id]).
//! The raw secret is returned exactly once in the create response; every
//! other surface (list, revoke, database) only ever carries the SHA-256 hash
//! or the display prefix.
//!
//! Registered in `main.rs` (`POST/GET /tokens`, `DELETE /tokens/{id}`).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::{helper::require_session_user_id, middleware, tokens as token_crypto},
    error::AppError,
    state::AppState,
};

/// Display prefix of every issued token (`"pd_"` + base64url randomness).
pub const TOKEN_PREFIX: &str = "pd_";
/// First 8 characters of the raw secret (e.g. `"pd_X7aQ2"`): enough to tell
/// tokens apart in the UI, useless for authentication.
pub const PREFIX_LEN: usize = 8;
/// Maximum name length, mirroring `chk_api_token_name_len` (`1..=80` chars).
pub const MAX_NAME_LEN: usize = 80;
/// Maximum lifetime accepted by `expires_in_days` (`1..=3650`, ~10 years).
pub const MAX_EXPIRES_IN_DAYS: i64 = 3650;

const CREATE_TOKEN_SQL: &str = "INSERT INTO api_tokens (user_id, name, token_hash, prefix, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, prefix, scopes, expires_at, created_at";
const LIST_TOKENS_SQL: &str = "SELECT id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC, id DESC";
const REVOKE_TOKEN_SQL: &str = "UPDATE api_tokens SET revoked_at=COALESCE(revoked_at, now()) WHERE id=$1 AND user_id=$2 RETURNING id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTokenRequest {
    pub name: String,
    /// Optional lifetime in whole days (`1..=3650`); omitted means no expiry.
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CreateTokenResponse {
    pub id: Uuid,
    pub name: String,
    /// The raw secret, returned exactly once. It is never stored and never
    /// appears in any other response.
    pub token: String,
    pub prefix: String,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ApiTokenResponse {
    pub id: Uuid,
    pub name: String,
    pub prefix: String,
    pub scopes: serde_json::Value,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl
    From<(
        Uuid,
        String,
        String,
        serde_json::Value,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        Option<DateTime<Utc>>,
        DateTime<Utc>,
    )> for ApiTokenResponse
{
    fn from(
        row: (
            Uuid,
            String,
            String,
            serde_json::Value,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
            DateTime<Utc>,
        ),
    ) -> Self {
        Self {
            id: row.0,
            name: row.1,
            prefix: row.2,
            scopes: row.3,
            expires_at: row.4,
            last_used_at: row.5,
            revoked_at: row.6,
            created_at: row.7,
        }
    }
}

/// Trimmed names of `1..=80` chars (mirrors the DB CHECK, but 422s before any
/// write instead of surfacing a 500 on constraint violation).
pub fn validate_token_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim().to_string();
    let len = name.chars().count();
    if name.is_empty() {
        return Err(AppError::Validation("token name must not be empty".into()));
    }
    if len > MAX_NAME_LEN {
        return Err(AppError::Validation(format!(
            "token name must be at most {MAX_NAME_LEN} characters"
        )));
    }
    Ok(name)
}

/// Whole-day lifetimes of `1..=3650`; omitted means the token never expires.
pub fn validate_expires_in_days(raw: Option<i64>) -> Result<Option<i64>, AppError> {
    match raw {
        None => Ok(None),
        Some(days) if (1..=MAX_EXPIRES_IN_DAYS).contains(&days) => Ok(Some(days)),
        Some(_) => Err(AppError::Validation(format!(
            "expires_in_days must be between 1 and {MAX_EXPIRES_IN_DAYS}"
        ))),
    }
}

/// Mint a raw secret: `"pd_"` + 256-bit base64url randomness. Only its
/// SHA-256 hash is stored; the raw value is shown to the caller once.
pub fn mint_raw_token() -> String {
    format!("{TOKEN_PREFIX}{}", token_crypto::generate_token())
}

/// Display prefix: the first 8 characters of the raw secret.
pub fn token_prefix(raw: &str) -> String {
    raw.chars().take(PREFIX_LEN).collect()
}

fn map_token_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if db.code().as_deref() == Some("23505") {
            return AppError::Conflict("a token with this name already exists".into());
        }
    }
    AppError::Internal
}

pub async fn create_token_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTokenRequest>,
) -> Result<(StatusCode, Json<CreateTokenResponse>), AppError> {
    // Session-only (JD-A-001/JD-B-001): API tokens must never mint new credentials.
    let user_id = require_session_user_id(&headers, &state.pool).await?;
    let name = validate_token_name(&body.name)?;
    let lifetime_days = validate_expires_in_days(body.expires_in_days)?;
    let raw = mint_raw_token();
    let hash = token_crypto::hash_token(&raw);
    let prefix = token_prefix(&raw);
    let expires_at = lifetime_days.map(|days| Utc::now() + Duration::days(days));
    let row = sqlx::query_as::<_, (Uuid, String, String, serde_json::Value, Option<DateTime<Utc>>, DateTime<Utc>)>(
        CREATE_TOKEN_SQL,
    )
    .bind(user_id)
    .bind(&name)
    .bind(&hash)
    .bind(&prefix)
    .bind(expires_at)
    .fetch_one(&state.pool)
    .await
    .map_err(map_token_db_err)?;
    Ok((
        StatusCode::CREATED,
        Json(CreateTokenResponse {
            id: row.0,
            name: row.1,
            token: raw,
            prefix: row.2,
            expires_at: row.4,
        }),
    ))
}

pub async fn list_tokens_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ApiTokenResponse>>, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let user_id = middleware::resolve_token_user_id(&state.pool, &token).await?;
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            serde_json::Value,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
            DateTime<Utc>,
        ),
    >(LIST_TOKENS_SQL)
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(ApiTokenResponse::from).collect()))
}

pub async fn delete_token_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ApiTokenResponse>, AppError> {
    let token = middleware::extract_bearer(&headers).ok_or(AppError::Auth)?;
    let user_id = middleware::resolve_token_user_id(&state.pool, &token).await?;
    // Soft revoke: `COALESCE` keeps the original timestamp so a repeated
    // DELETE is an idempotent 200, not a state change. The `user_id`
    // predicate makes foreign ids a 404 without leaking ownership.
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            serde_json::Value,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
            Option<DateTime<Utc>>,
            DateTime<Utc>,
        ),
    >(REVOKE_TOKEN_SQL)
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(ApiTokenResponse::from(r)))
        .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tokens_tests {
    use super::*;
    use axum::response::IntoResponse;
    use serde_json::json;

    fn assert_401(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    fn assert_404(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::NOT_FOUND);
    }

    fn assert_409(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::CONFLICT);
    }

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    fn lazy_state() -> AppState {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool construction must succeed"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(LoginRateLimiter::new()),
        }
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    fn headers_for(raw: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {raw}").parse().unwrap(),
        );
        headers
    }

    async fn db_user_with_session(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("apitoken-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("api token test")
        .fetch_one(pool)
        .await
        .expect("seed user");
        let raw = token_crypto::generate_token();
        let hash = token_crypto::hash_token(&raw);
        sqlx::query(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now() + interval '1 hour')",
        )
        .bind(user_id)
        .bind(&hash)
        .execute(pool)
        .await
        .expect("seed session");
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(LoginRateLimiter::new()),
        };
        (state, headers_for(&raw), user_id)
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    // -- Pure unit tests (no DB) --

    #[test]
    fn minted_raw_token_has_pd_prefix_and_8_char_display_prefix() {
        let raw = mint_raw_token();
        assert!(raw.starts_with(TOKEN_PREFIX), "raw must start with pd_");
        assert_eq!(raw.len(), TOKEN_PREFIX.len() + 43);
        let prefix = token_prefix(&raw);
        assert_eq!(prefix.len(), PREFIX_LEN);
        assert_eq!(&raw[..PREFIX_LEN], prefix);
        assert!(prefix.starts_with(TOKEN_PREFIX));
    }

    #[test]
    fn minted_tokens_are_unique() {
        let raws: std::collections::HashSet<_> = (0..50).map(|_| mint_raw_token()).collect();
        assert_eq!(raws.len(), 50);
    }

    #[test]
    fn token_name_allows_1_to_80_chars_trimmed() {
        assert_eq!(validate_token_name("  cli  ").unwrap(), "cli");
        assert_eq!(validate_token_name("x").unwrap(), "x");
        assert_eq!(validate_token_name(&"y".repeat(80)).unwrap(), "y".repeat(80));
        assert_422(validate_token_name("").unwrap_err());
        assert_422(validate_token_name("   ").unwrap_err());
        assert_422(validate_token_name(&"z".repeat(81)).unwrap_err());
    }

    #[test]
    fn expires_in_days_allows_1_to_3650_or_absent() {
        assert_eq!(validate_expires_in_days(None).unwrap(), None);
        assert_eq!(validate_expires_in_days(Some(1)).unwrap(), Some(1));
        assert_eq!(
            validate_expires_in_days(Some(3650)).unwrap(),
            Some(3650)
        );
        for bad in [Some(0), Some(-7), Some(3651), Some(i64::MAX)] {
            assert_422(validate_expires_in_days(bad).unwrap_err());
        }
    }

    #[test]
    fn create_request_rejects_unknown_fields() {
        let payload = json!({"name": "cli", "expires_in_days": 30, "scopes": ["admin"]});
        assert!(
            serde_json::from_value::<CreateTokenRequest>(payload).is_err(),
            "unknown fields must fail deserialization (deny_unknown_fields)"
        );
        let ok: CreateTokenRequest = serde_json::from_value(json!({"name": "cli"})).unwrap();
        assert_eq!(ok.expires_in_days, None);
    }

    #[test]
    fn token_sql_scopes_every_statement_by_user_id() {
        for sql in [CREATE_TOKEN_SQL, LIST_TOKENS_SQL, REVOKE_TOKEN_SQL] {
            assert!(
                sql.contains("user_id"),
                "token SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            REVOKE_TOKEN_SQL.contains("id=$1 AND user_id=$2"),
            "revoke must scope id+user_id, got: {REVOKE_TOKEN_SQL}"
        );
        assert!(
            REVOKE_TOKEN_SQL.contains("COALESCE(revoked_at, now())"),
            "revoke must be idempotent, got: {REVOKE_TOKEN_SQL}"
        );
        assert!(
            LIST_TOKENS_SQL.contains("ORDER BY created_at DESC"),
            "list must order newest first, got: {LIST_TOKENS_SQL}"
        );
    }

    #[test]
    fn list_shape_carries_no_secret_material() {
        // The list/revoke shape must never serialize a raw secret or hash:
        // only `prefix` (display) travels outside the create response.
        let item = ApiTokenResponse {
            id: Uuid::new_v4(),
            name: "cli".into(),
            prefix: "pd_Ab12Cd".into(),
            scopes: json!([]),
            expires_at: None,
            last_used_at: None,
            revoked_at: None,
            created_at: Utc::now(),
        };
        let v = serde_json::to_value(&item).unwrap();
        for forbidden in ["token", "token_hash", "hash", "secret"] {
            assert!(
                v.get(forbidden).is_none(),
                "list shape must not contain `{forbidden}`"
            );
        }
        assert_eq!(v["prefix"], json!("pd_Ab12Cd"));
    }

    #[tokio::test]
    async fn unauthenticated_create_list_and_delete_are_401() {
        let body = Json(CreateTokenRequest {
            name: "cli".into(),
            expires_in_days: None,
        });
        let err = create_token_handler(State(lazy_state()), HeaderMap::new(), body)
            .await
            .expect_err("missing session must be 401");
        assert_401(err);
        let err = list_tokens_handler(State(lazy_state()), HeaderMap::new())
            .await
            .expect_err("missing bearer must be 401");
        assert_401(err);
        let err = delete_token_handler(State(lazy_state()), HeaderMap::new(), Path(Uuid::new_v4()))
            .await
            .expect_err("missing bearer must be 401");
        assert_401(err);
    }

    // -- DB-backed tests (skip honestly without DATABASE_URL) --

    #[tokio::test]
    async fn tokens_create_list_revoke_roundtrip() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP tokens_create_list_revoke_roundtrip: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_user_with_session(&pool).await;
        // Create: 201 with the raw secret returned once.
        let (status, created) = create_token_handler(
            State(state.clone()),
            headers.clone(),
            Json(CreateTokenRequest {
                name: "cli".into(),
                expires_in_days: Some(30),
            }),
        )
        .await
        .expect("create is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert!(created.token.starts_with(TOKEN_PREFIX));
        assert_eq!(created.prefix, created.token[..PREFIX_LEN].to_string());
        assert!(created.expires_at.is_some());
        // Duplicate names collide per user: 409.
        let err = create_token_handler(
            State(state.clone()),
            headers.clone(),
            Json(CreateTokenRequest {
                name: "cli".into(),
                expires_in_days: None,
            }),
        )
        .await
        .expect_err("duplicate name must be 409");
        assert_409(err);
        // List: the token appears with metadata but WITHOUT the raw secret.
        let listed = list_tokens_handler(State(state.clone()), headers.clone())
            .await
            .expect("list is 200")
            .0;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].name, "cli");
        assert_eq!(listed[0].prefix, created.prefix);
        assert_eq!(listed[0].scopes, json!([]));
        assert_eq!(listed[0].revoked_at, None);
        let v = serde_json::to_value(&listed).unwrap();
        assert!(
            v[0].get("token").is_none(),
            "raw secret must appear only in the create response"
        );
        // Revoke: 200 with revoked_at set; repeat is an idempotent 200.
        let revoked = delete_token_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("revoke is 200")
            .0;
        assert!(revoked.revoked_at.is_some());
        let again = delete_token_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("repeated revoke stays 200")
            .0;
        assert_eq!(again.revoked_at, revoked.revoked_at);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn tokens_are_scoped_per_user() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP tokens_are_scoped_per_user: no DATABASE_URL");
            return;
        };
        let (state_a, headers_a, user_a) = db_user_with_session(&pool).await;
        let (state_b, headers_b, user_b) = db_user_with_session(&pool).await;
        let (_, created) = create_token_handler(
            State(state_a.clone()),
            headers_a.clone(),
            Json(CreateTokenRequest {
                name: "mine".into(),
                expires_in_days: None,
            }),
        )
        .await
        .expect("user A creates a token");
        // User B lists only their own (empty) set and gets 404 on A's id.
        let listed_b = list_tokens_handler(State(state_b.clone()), headers_b.clone())
            .await
            .expect("user B list is 200")
            .0;
        assert!(listed_b.is_empty(), "user B must not see user A's tokens");
        let err = delete_token_handler(State(state_b.clone()), headers_b.clone(), Path(created.id))
            .await
            .expect_err("user B revoking user A's token must be 404");
        assert_404(err);
        // Same name in a different account does NOT collide.
        let (status, _created_b) = create_token_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Json(CreateTokenRequest {
                name: "mine".into(),
                expires_in_days: None,
            }),
        )
        .await
        .expect("same name under another user is 201");
        assert_eq!(status, StatusCode::CREATED);
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn tokens_api_token_authenticates_and_touches_last_used() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP tokens_api_token_authenticates_and_touches_last_used: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_user_with_session(&pool).await;
        let (_, created) = create_token_handler(
            State(state.clone()),
            headers.clone(),
            Json(CreateTokenRequest {
                name: "automation".into(),
                expires_in_days: None,
            }),
        )
        .await
        .expect("create is 201");
        // The raw secret resolves to the owner and stamps last_used_at.
        let got = middleware::resolve_token_user_id(&state.pool, &created.token)
            .await
            .expect("valid api token resolves");
        assert_eq!(got, user_id);
        let last_used: Option<DateTime<Utc>> =
            sqlx::query_scalar("SELECT last_used_at FROM api_tokens WHERE id=$1")
                .bind(created.id)
                .fetch_one(&pool)
                .await
                .expect("read last_used_at");
        assert!(
            last_used.is_some(),
            "successful api-token use must stamp last_used_at"
        );
        // Listing with the API token itself works (session-or-token surface).
        let listed = list_tokens_handler(State(state.clone()), headers_for(&created.token))
            .await
            .expect("list with api token is 200")
            .0;
        assert_eq!(listed.len(), 1);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn tokens_expired_api_token_is_rejected() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP tokens_expired_api_token_is_rejected: no DATABASE_URL");
            return;
        };
        let (state, _, user_id) = db_user_with_session(&pool).await;
        let raw = mint_raw_token();
        let hash = token_crypto::hash_token(&raw);
        sqlx::query(
            "INSERT INTO api_tokens (user_id, name, token_hash, prefix, expires_at) VALUES ($1,'old',$2,'pd_old', now() - interval '1 hour')",
        )
        .bind(user_id)
        .bind(&hash)
        .execute(&pool)
        .await
        .expect("seed expired api token");
        let err = middleware::resolve_token_user_id(&state.pool, &raw)
            .await
            .expect_err("expired api token must be 401");
        assert_401(err);
        let err = list_tokens_handler(State(state.clone()), headers_for(&raw))
            .await
            .expect_err("expired api token must not list");
        assert_401(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn tokens_revoked_api_token_is_rejected() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP tokens_revoked_api_token_is_rejected: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_user_with_session(&pool).await;
        let (_, created) = create_token_handler(
            State(state.clone()),
            headers.clone(),
            Json(CreateTokenRequest {
                name: "doomed".into(),
                expires_in_days: None,
            }),
        )
        .await
        .expect("create is 201");
        let _revoked = delete_token_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("revoke is 200");
        let err = middleware::resolve_token_user_id(&state.pool, &created.token)
            .await
            .expect_err("revoked api token must be 401");
        assert_401(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn tokens_session_takes_priority_over_api_token() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP tokens_session_takes_priority_over_api_token: no DATABASE_URL");
            return;
        };
        let (state, _, user_a) = db_user_with_session(&pool).await;
        let (_, _, user_b) = db_user_with_session(&pool).await;
        // Same hash in both tables (different owners): the session owner wins
        // and the api token's last_used_at stays untouched.
        let raw = token_crypto::generate_token();
        let hash = token_crypto::hash_token(&raw);
        sqlx::query(
            "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now() + interval '1 hour')",
        )
        .bind(user_a)
        .bind(&hash)
        .execute(&pool)
        .await
        .expect("seed session");
        sqlx::query(
            "INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES ($1,'clash',$2,'pd_clash')",
        )
        .bind(user_b)
        .bind(&hash)
        .execute(&pool)
        .await
        .expect("seed clashing api token");
        let got = middleware::resolve_token_user_id(&state.pool, &raw)
            .await
            .expect("clashing token resolves via session first");
        assert_eq!(got, user_a, "sessions must take priority over api tokens");
        let last_used: Option<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT last_used_at FROM api_tokens WHERE token_hash=$1",
        )
        .bind(&hash)
        .fetch_one(&pool)
        .await
        .expect("read last_used_at");
        assert!(
            last_used.is_none(),
            "session-priority resolution must not touch the api token"
        );
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn tokens_create_requires_session_not_api_token() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP tokens_create_requires_session_not_api_token: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_user_with_session(&pool).await;
        let (_, created) = create_token_handler(
            State(state.clone()),
            headers.clone(),
            Json(CreateTokenRequest {
                name: "parent".into(),
                expires_in_days: None,
            }),
        )
        .await
        .expect("create is 201");
        // An API token must never mint new credentials: 401, nothing written.
        let err = create_token_handler(
            State(state.clone()),
            headers_for(&created.token),
            Json(CreateTokenRequest {
                name: "child".into(),
                expires_in_days: None,
            }),
        )
        .await
        .expect_err("api token must not create tokens");
        assert_401(err);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM api_tokens WHERE user_id=$1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("count tokens");
        assert_eq!(count, 1, "rejected create must write nothing");
        cleanup_user(&pool, user_id).await;
    }
}
