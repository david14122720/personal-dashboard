//! Finance accounts CRUD + soft-archive, strictly scoped by `user_id`.
//!
//! Every query carries `AND user_id = $N` (via [`require_user_id`]) so a
//! foreign id resolves to 404 without leaking existence. Duplicate names per
//! user surface as 409 via pgcode `23505`; unknown account types as 422.
//!
//! Route registration happens in PR4; this module only declares handlers.

// Allowed until PR4 registers routes; covered by unit tests.
#![allow(dead_code)]

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::helper::require_user_id, error::AppError, state::AppState};

/// Account kinds accepted at the API boundary (mirrors `account_type` enum).
pub const ACCOUNT_TYPES: &[&str] = &[
    "bank",
    "savings",
    "cash",
    "digital_wallet",
    "credit_card",
    "investment",
    "other",
];

const MAX_NAME_LEN: usize = 200;
const MAX_NOTES_LEN: usize = 2000;
const MAX_COLOR_LEN: usize = 32;
const MAX_ICON_LEN: usize = 64;

const CREATE_ACCOUNT_SQL: &str = "INSERT INTO accounts (user_id, name, type, currency, notes, color, icon) VALUES ($1,$2,$3::account_type,$4,$5,$6,$7) RETURNING id, name, type::text, currency, balance, notes, color, icon, is_archived, created_at, updated_at";
const LIST_ACCOUNTS_SQL: &str = "SELECT id, name, type::text, currency, balance, notes, color, icon, is_archived, created_at, updated_at FROM accounts WHERE user_id=$1 AND NOT is_archived ORDER BY created_at ASC";
const GET_ACCOUNT_SQL: &str = "SELECT id, name, type::text, currency, balance, notes, color, icon, is_archived, created_at, updated_at FROM accounts WHERE id=$1 AND user_id=$2";

type AccountRow = (
    Uuid,
    String,
    String,
    String,
    Decimal,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAccountRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub currency: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchAccountRequest {
    pub notes: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub is_archived: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AccountResponse {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub currency: String,
    /// Serialized as a string (e.g. `"50.00"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub balance: Decimal,
    pub notes: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub is_archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl
    From<(
        Uuid,
        String,
        String,
        String,
        Decimal,
        Option<String>,
        Option<String>,
        Option<String>,
        bool,
        DateTime<Utc>,
        DateTime<Utc>,
    )> for AccountResponse
{
    fn from(
        row: (
            Uuid,
            String,
            String,
            String,
            Decimal,
            Option<String>,
            Option<String>,
            Option<String>,
            bool,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            name,
            account_type,
            currency,
            balance,
            notes,
            color,
            icon,
            is_archived,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            name,
            account_type,
            currency,
            balance,
            notes,
            color,
            icon,
            is_archived,
            created_at,
            updated_at,
        }
    }
}

/// Validate an account name: 1-200 chars after trimming, no null bytes.
pub fn validate_account_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN || name.contains('\0') {
        return Err(AppError::Validation(
            "account name must be 1-200 characters".into(),
        ));
    }
    Ok(name.to_string())
}

/// Validate an account type against the `account_type` enum values.
pub fn validate_account_type(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if ACCOUNT_TYPES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "account type must be one of: bank, savings, cash, digital_wallet, credit_card, investment, other"
                .into(),
        ))
    }
}

/// Normalize a currency code (default `COP`); must be 3 ASCII letters.
pub fn validate_currency(raw: Option<&str>) -> Result<String, AppError> {
    let Some(raw) = raw else {
        return Ok("COP".to_string());
    };
    let code = raw.trim().to_uppercase();
    if code.len() == 3 && code.bytes().all(|b| b.is_ascii_alphabetic()) {
        Ok(code)
    } else {
        Err(AppError::Validation(
            "currency must be a 3-letter code".into(),
        ))
    }
}

/// Validate PATCH metadata lengths (notes/color/icon caps).
pub fn validate_account_patch(body: &PatchAccountRequest) -> Result<(), AppError> {
    validate_metadata_lengths(
        body.notes.as_deref(),
        body.color.as_deref(),
        body.icon.as_deref(),
    )
}

fn validate_metadata_lengths(
    notes: Option<&str>,
    color: Option<&str>,
    icon: Option<&str>,
) -> Result<(), AppError> {
    if let Some(notes) = notes {
        if notes.len() > MAX_NOTES_LEN || notes.contains('\0') {
            return Err(AppError::Validation(
                "notes must be at most 2000 characters".into(),
            ));
        }
    }
    if let Some(color) = color {
        if color.len() > MAX_COLOR_LEN || color.contains('\0') {
            return Err(AppError::Validation(
                "color must be at most 32 characters".into(),
            ));
        }
    }
    if let Some(icon) = icon {
        if icon.len() > MAX_ICON_LEN || icon.contains('\0') {
            return Err(AppError::Validation(
                "icon must be at most 64 characters".into(),
            ));
        }
    }
    Ok(())
}

/// Map account write errors: `23505` (UNIQUE user_id,name) → 409,
/// `23514` (check) → 422; everything else is internal (never leaked).
fn map_account_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("account name already exists".into());
            }
            Some("23514") => {
                return AppError::Validation("invalid account data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateAccountRequest>,
) -> Result<(StatusCode, Json<AccountResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_account_name(&body.name)?;
    let account_type = validate_account_type(&body.account_type)?;
    let currency = validate_currency(body.currency.as_deref())?;
    validate_metadata_lengths(
        body.notes.as_deref(),
        body.color.as_deref(),
        body.icon.as_deref(),
    )?;
    let row = sqlx::query_as::<_, AccountRow>(CREATE_ACCOUNT_SQL)
        .bind(user_id)
        .bind(&name)
        .bind(&account_type)
        .bind(&currency)
        .bind(body.notes.as_deref())
        .bind(body.color.as_deref())
        .bind(body.icon.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_account_db_err)?;
    Ok((StatusCode::CREATED, Json(AccountResponse::from(row))))
}

pub async fn list_accounts_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AccountResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, AccountRow>(LIST_ACCOUNTS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(AccountResponse::from).collect()))
}

pub async fn get_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<AccountResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, AccountRow>(GET_ACCOUNT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(AccountResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn patch_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchAccountRequest>,
) -> Result<Json<AccountResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_account_patch(&body)?;
    if body.notes.is_none()
        && body.color.is_none()
        && body.icon.is_none()
        && body.is_archived.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    let mut qb: sqlx::QueryBuilder<sqlx::Postgres> =
        sqlx::QueryBuilder::new("UPDATE accounts SET updated_at = now()");
    if let Some(notes) = &body.notes {
        qb.push(", notes = ");
        qb.push_bind(notes);
    }
    if let Some(color) = &body.color {
        qb.push(", color = ");
        qb.push_bind(color);
    }
    if let Some(icon) = &body.icon {
        qb.push(", icon = ");
        qb.push_bind(icon);
    }
    if let Some(is_archived) = body.is_archived {
        qb.push(", is_archived = ");
        qb.push_bind(is_archived);
    }
    qb.push(" WHERE id = ");
    qb.push_bind(id);
    qb.push(" AND user_id = ");
    qb.push_bind(user_id);
    qb.push(" RETURNING id, name, type::text, currency, balance, notes, color, icon, is_archived, created_at, updated_at");
    let row = qb
        .build_query_as::<AccountRow>()
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(AccountResponse::from(r)))
        .ok_or(AppError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use serde_json::json;

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn accepts_all_documented_account_types() {
        for t in ACCOUNT_TYPES {
            assert_eq!(validate_account_type(t).unwrap(), t.to_string());
        }
    }

    #[test]
    fn rejects_unknown_account_type_as_422() {
        for raw in ["spaceship", "BANK", "", "bank "] {
            // NOTE: "bank " trims to "bank" and is accepted; keep only true rejects.
            if raw.trim() == "bank" {
                continue;
            }
            assert_422(validate_account_type(raw).unwrap_err());
        }
    }

    #[test]
    fn accepts_trimmed_valid_name() {
        assert_eq!(validate_account_name("  Main Bank ").unwrap(), "Main Bank");
    }

    #[test]
    fn rejects_blank_and_oversized_names_as_422() {
        assert_422(validate_account_name("").unwrap_err());
        assert_422(validate_account_name("   ").unwrap_err());
        assert_422(validate_account_name(&"x".repeat(201)).unwrap_err());
        assert_422(validate_account_name("bad\0name").unwrap_err());
    }

    #[test]
    fn currency_defaults_to_cop_and_uppercases() {
        assert_eq!(validate_currency(None).unwrap(), "COP");
        assert_eq!(validate_currency(Some("usd")).unwrap(), "USD");
    }

    #[test]
    fn rejects_bad_currency_as_422() {
        for raw in ["US", "USDD", "U1D", ""] {
            assert_422(validate_currency(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn patch_rejects_core_field_edits_as_422() {
        // `deny_unknown_fields` turns amount/name/type edits into 422 at the
        // JSON boundary (axum maps data errors to 422).
        for payload in [
            json!({"balance": "5.00"}),
            json!({"name": "Hacked"}),
            json!({"type": "bank"}),
        ] {
            assert!(
                serde_json::from_value::<PatchAccountRequest>(payload).is_err(),
                "core-field edit must fail deserialization"
            );
        }
        let ok: PatchAccountRequest =
            serde_json::from_value(json!({"notes": "hi", "is_archived": true})).unwrap();
        assert_eq!(ok.notes.as_deref(), Some("hi"));
        assert_eq!(ok.is_archived, Some(true));
    }

    #[test]
    fn patch_rejects_oversized_metadata_as_422() {
        let body = PatchAccountRequest {
            notes: Some("n".repeat(2001)),
            color: None,
            icon: None,
            is_archived: None,
        };
        assert_422(validate_account_patch(&body).unwrap_err());
    }

    #[test]
    fn balance_serializes_as_string_never_float() {
        let resp = AccountResponse {
            id: Uuid::new_v4(),
            name: "Main".into(),
            account_type: "bank".into(),
            currency: "COP".into(),
            balance: Decimal::new(5000, 2),
            notes: None,
            color: None,
            icon: None,
            is_archived: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["balance"], serde_json::Value::String("50.00".into()));
    }

    #[test]
    fn account_sql_scopes_every_query_by_user_id() {
        for sql in [CREATE_ACCOUNT_SQL, LIST_ACCOUNTS_SQL, GET_ACCOUNT_SQL] {
            assert!(
                sql.contains("user_id"),
                "account SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            LIST_ACCOUNTS_SQL.contains("NOT is_archived"),
            "list must hide archived accounts, got: {LIST_ACCOUNTS_SQL}"
        );
        assert!(
            GET_ACCOUNT_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_ACCOUNT_SQL}"
        );
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("acct-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("acct test")
        .fetch_one(pool)
        .await
        .expect("seed user");
        let raw = crate::auth::tokens::generate_token();
        let hash = crate::auth::tokens::hash_token(&raw);
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
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {raw}").parse().unwrap(),
        );
        (state, headers, user_id)
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    fn create_body(name: &str) -> serde_json::Value {
        json!({"name": name, "type": "bank"})
    }

    #[tokio::test]
    async fn duplicate_account_name_is_409() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP duplicate_account_name_is_409: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let body = || Json(serde_json::from_value(create_body("Savings")).unwrap());
        let (status, _) = create_account_handler(State(state.clone()), headers.clone(), body())
            .await
            .expect("first create is 201");
        assert_eq!(status, StatusCode::CREATED);
        let err = create_account_handler(State(state.clone()), headers.clone(), body())
            .await
            .expect_err("duplicate name must be 409");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::CONFLICT
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_account_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_account_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Mine','cash') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let err = get_account_handler(State(state_b.clone()), headers_b, Path(account_id))
            .await
            .expect_err("foreign account must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }
}
