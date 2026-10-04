//! Finance accounts CRUD + soft-archive, strictly scoped by `user_id`.
//!
//! Every query carries `AND user_id = $N` (via [`require_user_id`]) so a
//! foreign id resolves to 404 without leaking existence. Duplicate names per
//! user surface as 409 via pgcode `23505`.
//!
//! Accounts carry no type and no credit-card field (W1 of
//! `2026-10-04-accounts-transfers-login-calendar`, migration 0016 removes the
//! whole layer): the create allowlist is `name` plus the optional `currency`,
//! `notes`, `color` and `icon`, and any removed field is an unknown-field
//! 422. The balance stays the single money source, written only by the
//! movement transaction and the manual `PATCH /api/accounts/{id}`.
//!
//! Registered in `main.rs` (PR4 wiring).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id,
    error::AppError,
    finance::money::parse_balance_amount,
    state::AppState,
};

/// Account kinds were removed with the whole credit-card layer (W1,
/// migration 0016): no type constant, validator or enum survives here.

const MAX_NAME_LEN: usize = 200;
const MAX_NOTES_LEN: usize = 2000;
const MAX_COLOR_LEN: usize = 32;
const MAX_ICON_LEN: usize = 64;

const CREATE_ACCOUNT_SQL: &str = "INSERT INTO accounts (user_id, name, currency, notes, color, icon) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, currency, balance, notes, color, icon, is_archived, created_at, updated_at";
const LIST_ACCOUNTS_SQL: &str = "SELECT id, name, currency, balance, notes, color, icon, is_archived, created_at, updated_at FROM accounts WHERE user_id=$1 AND NOT is_archived ORDER BY created_at ASC";
const GET_ACCOUNT_SQL: &str = "SELECT id, name, currency, balance, notes, color, icon, is_archived, created_at, updated_at FROM accounts WHERE id=$1 AND user_id=$2";

/// Account row: the 10 surviving account columns (sqlx 0.8 FromRow tuple cap
/// is 16) — id, name, currency, balance, notes, color, icon, is_archived,
/// created_at, updated_at. The removed type/card columns are never selected.
type AccountRow = (
    Uuid,
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
    pub currency: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchAccountRequest {
    /// Manual balance as a decimal string (e.g. `"980000.00"`,
    /// `"-750.50"`): signed, `scale <= 2`, `|x| < 10^9`, else 422.
    /// User-asserted data — no trigger or aggregate rewrites it.
    pub balance: Option<String>,
    pub notes: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub is_archived: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct AccountResponse {
    pub id: Uuid,
    pub name: String,
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
            Decimal,
            Option<String>,
            Option<String>,
            Option<String>,
            bool,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (id, name, currency, balance, notes, color, icon, is_archived, created_at, updated_at) =
            row;
        Self {
            id,
            name,
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

/// Validate PATCH body: metadata lengths plus the optional manual
/// `balance` (signed, `scale <= 2`, `|x| < 10^9`, else 422 via
/// [`parse_balance_amount`]).
pub fn validate_account_patch(body: &PatchAccountRequest) -> Result<(), AppError> {
    if let Some(raw) = body.balance.as_deref() {
        parse_balance_amount(raw)?;
    }
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
    let currency = validate_currency(body.currency.as_deref())?;
    validate_metadata_lengths(
        body.notes.as_deref(),
        body.color.as_deref(),
        body.icon.as_deref(),
    )?;
    let row = sqlx::query_as::<_, AccountRow>(CREATE_ACCOUNT_SQL)
        .bind(user_id)
        .bind(&name)
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
    let Some(row) = row else {
        return Err(AppError::NotFound);
    };
    Ok(Json(AccountResponse::from(row)))
}

pub async fn patch_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchAccountRequest>,
) -> Result<Json<AccountResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_account_patch(&body)?;
    if body.balance.is_none()
        && body.notes.is_none()
        && body.color.is_none()
        && body.icon.is_none()
        && body.is_archived.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    // Parse once for validation (already done) and bind the decimal value.
    let balance = body
        .balance
        .as_deref()
        .map(parse_balance_amount)
        .transpose()?;
    let mut qb: sqlx::QueryBuilder<sqlx::Postgres> =
        sqlx::QueryBuilder::new("UPDATE accounts SET updated_at = now()");
    if let Some(balance) = balance {
        qb.push(", balance = ");
        qb.push_bind(balance);
    }
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
    qb.push(" RETURNING id, name, currency, balance, notes, color, icon, is_archived, created_at, updated_at");
    let row = qb
        .build_query_as::<AccountRow>()
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(AccountResponse::from(r)))
        .ok_or(AppError::NotFound)
}

// -- S-A (finance-simplify-movements): physical delete with a movement guard --

const DELETE_ACCOUNT_SQL: &str = "DELETE FROM accounts WHERE id=$1 AND user_id=$2";
const ACCOUNT_OWNERSHIP_CHECK_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2";
/// Live-reference probe for the delete guard: counts the caller's movements
/// that reference the account as the origin (`account_id`) or as a transfer
/// destination (`transfer_account_id`). Both FKs are `ON DELETE RESTRICT`.
/// Never touches a removed table.
const ACCOUNT_MOVEMENT_COUNT_SQL: &str =
    "SELECT count(*) FROM movements WHERE (account_id=$1 OR transfer_account_id=$1) AND user_id=$2";

fn map_account_delete_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        // Backstop for the `ON DELETE RESTRICT` references from
        // `movements.account_id` and `movements.transfer_account_id` (or any
        // future blocking reference): the application check below catches
        // the normal case, the constraints catch the race — both map to the
        // same Spanish 409, never a 500.
        if db.code().as_deref() == Some("23503") {
            return AppError::Conflict(
                "la cuenta tiene movimientos y no se puede eliminar".into(),
            );
        }
    }
    AppError::Internal
}

/// Delete an owned account (204) unless it has movements (409).
///
/// The surviving `movements.account_id` and `movements.transfer_account_id`
/// references are blocking (`ON DELETE RESTRICT`): deleting an owned account
/// that is the origin or the destination of at least one movement returns 409
/// Conflict with a Spanish message and leaves the account and its balance
/// unchanged. Foreign/missing ids resolve to 404 without leaking existence.
/// (`assets.account_id` is `ON DELETE SET NULL`, so assets never block.)
pub async fn delete_account_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let owned: Option<Uuid> = sqlx::query_scalar(ACCOUNT_OWNERSHIP_CHECK_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if owned.is_none() {
        return Err(AppError::NotFound);
    }
    let movement_count: i64 = sqlx::query_scalar(ACCOUNT_MOVEMENT_COUNT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .unwrap_or(0);
    if movement_count > 0 {
        return Err(AppError::Conflict(
            "la cuenta tiene movimientos y no se puede eliminar".into(),
        ));
    }
    let res = sqlx::query(DELETE_ACCOUNT_SQL)
        .bind(id)
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(map_account_delete_err)?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
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
    fn create_accepts_name_plus_optional_metadata_only() {
        // W1: name is the only required field; currency/notes/color/icon are
        // optional and the removed type/card fields never parse.
        let ok: CreateAccountRequest =
            serde_json::from_value(json!({"name": "Cuenta principal"})).unwrap();
        assert_eq!(ok.name, "Cuenta principal");
        assert!(ok.currency.is_none());
        let full: CreateAccountRequest = serde_json::from_value(json!({
            "name": "Cuenta principal",
            "currency": "COP",
            "notes": "n",
            "color": "#fff",
            "icon": "wallet"
        }))
        .unwrap();
        assert_eq!(full.currency.as_deref(), Some("COP"));
        assert_eq!(full.icon.as_deref(), Some("wallet"));
    }

    #[test]
    fn create_rejects_removed_type_and_card_fields_as_422() {
        // `deny_unknown_fields` is the boundary guard: axum maps the
        // deserialization error to 422 and the handler never runs, so no
        // account can be created with a removed field.
        for payload in [
            json!({"name": "Cuenta", "type": "bank"}),
            json!({"name": "Visa", "type": "credit_card"}),
            json!({"name": "Cuenta", "credit_limit": "5000.00"}),
            json!({"name": "Cuenta", "statement_day": 15}),
            json!({"name": "Cuenta", "payment_due_day": 25}),
            json!({"name": "Cuenta", "used_balance": "10.00"}),
            json!({"name": "Cuenta", "alert_level": "warn"}),
        ] {
            assert!(
                serde_json::from_value::<CreateAccountRequest>(payload.clone()).is_err(),
                "removed field must fail deserialization: {payload}"
            );
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
    fn patch_accepts_balance_but_rejects_structural_edits_as_422() {
        // `balance` is an accepted PATCH field (S3a manual balance); the
        // structural fields stay rejected by `deny_unknown_fields` (422 at
        // the JSON boundary; axum maps data errors to 422). `type` and the
        // card fields were never PATCHable and are unknown beyond W1.
        let ok: PatchAccountRequest =
            serde_json::from_value(json!({"balance": "-750.50"})).unwrap();
        assert_eq!(ok.balance.as_deref(), Some("-750.50"));
        let ok: PatchAccountRequest =
            serde_json::from_value(json!({"notes": "hi", "is_archived": true})).unwrap();
        assert_eq!(ok.notes.as_deref(), Some("hi"));
        assert_eq!(ok.is_archived, Some(true));
        for payload in [
            json!({"name": "Hacked"}),
            json!({"type": "bank"}),
            json!({"credit_limit": "5.00"}),
            json!({"statement_day": 15}),
            json!({"payment_due_day": 25}),
        ] {
            assert!(
                serde_json::from_value::<PatchAccountRequest>(payload).is_err(),
                "structural edit must fail deserialization"
            );
        }
        // Money travels as a string: a JSON number never reaches the parser.
        assert!(
            serde_json::from_value::<PatchAccountRequest>(json!({"balance": 5.00})).is_err(),
            "numeric balance must fail deserialization"
        );
    }

    #[test]
    fn patch_balance_validation_rejects_bad_values_as_422() {
        for raw in ["1000000000.00", "10.005", "abc", ""] {
            let body = PatchAccountRequest {
                balance: Some(raw.to_string()),
                notes: None,
                color: None,
                icon: None,
                is_archived: None,
            };
            assert_422(validate_account_patch(&body).unwrap_err());
        }
        let body = PatchAccountRequest {
            balance: Some("-750.50".to_string()),
            notes: None,
            color: None,
            icon: None,
            is_archived: None,
        };
        validate_account_patch(&body).expect("valid balance passes");
        let body = PatchAccountRequest {
            balance: Some("2500000.00".to_string()),
            notes: None,
            color: None,
            icon: None,
            is_archived: None,
        };
        validate_account_patch(&body).expect("1e9-scale balance passes");
    }

    #[test]
    fn patch_rejects_oversized_metadata_as_422() {
        let body = PatchAccountRequest {
            balance: None,
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
        // The wire shape carries no type and no card key (W1).
        for removed in [
            "type",
            "credit_limit",
            "statement_day",
            "payment_due_day",
            "used_balance",
            "available_balance",
            "usage_pct",
            "alert_level",
            "statement_balance",
        ] {
            assert!(
                v.get(removed).is_none(),
                "AccountResponse must not carry `{removed}`, got: {v}"
            );
        }
        assert_eq!(v.as_object().map(|o| o.len()), Some(10));
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

    #[test]
    fn account_delete_sql_never_references_removed_tables() {
        for sql in [
            DELETE_ACCOUNT_SQL,
            ACCOUNT_OWNERSHIP_CHECK_SQL,
            ACCOUNT_MOVEMENT_COUNT_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "account delete SQL must scope by user_id, got: {sql}"
            );
            for token in [
                "transactions",
                "budgets",
                "savings_goals",
                "savings_goal_movements",
                "debts",
                "debt_payments",
            ] {
                assert!(
                    !sql.contains(token),
                    "account delete SQL must never reference removed table `{token}`, got: {sql}"
                );
            }
        }
        assert!(
            DELETE_ACCOUNT_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_ACCOUNT_SQL}"
        );
        assert!(
            ACCOUNT_MOVEMENT_COUNT_SQL.contains("movements"),
            "delete guard must probe the live movements reference, got: {ACCOUNT_MOVEMENT_COUNT_SQL}"
        );
        assert!(
            ACCOUNT_MOVEMENT_COUNT_SQL.contains("transfer_account_id"),
            "delete guard must also block an account used only as a transfer destination, got: {ACCOUNT_MOVEMENT_COUNT_SQL}"
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
        json!({"name": name})
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
            "INSERT INTO accounts (user_id, name) VALUES ($1,'Mine') RETURNING id",
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

    // -- W1 (accounts-transfers-login-calendar): no type, no card layer --

    #[test]
    fn account_sql_never_selects_removed_columns() {
        for sql in [CREATE_ACCOUNT_SQL, LIST_ACCOUNTS_SQL, GET_ACCOUNT_SQL] {
            for removed in [
                "type",
                "credit_limit",
                "statement_day",
                "payment_due_day",
                "used_balance",
                "available_balance",
                "alert_level",
                "statement_balance",
            ] {
                assert!(
                    !sql.contains(removed),
                    "account SQL must not reference removed column `{removed}`, got: {sql}"
                );
            }
            assert!(
                !sql.contains("::account_type"),
                "account SQL must not cast to the dropped account_type enum, got: {sql}"
            );
        }
        // The 10 surviving columns travel on every read, in one stable order.
        for kept in [
            "id",
            "name",
            "currency",
            "balance",
            "notes",
            "color",
            "icon",
            "is_archived",
            "created_at",
            "updated_at",
        ] {
            assert!(
                LIST_ACCOUNTS_SQL.contains(kept) && GET_ACCOUNT_SQL.contains(kept),
                "account reads must keep `{kept}`, got: {LIST_ACCOUNTS_SQL} / {GET_ACCOUNT_SQL}"
            );
        }
    }

    #[tokio::test]
    async fn post_account_is_201_without_removed_fields() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP post_account_is_201_without_removed_fields: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let body = || {
            Json(
                serde_json::from_value(json!({"name": "Cuenta principal", "currency": "cop"}))
                    .expect("name-only create body"),
            )
        };
        let (status, created) = create_account_handler(State(state.clone()), headers, body())
            .await
            .expect("name-only create is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.name, "Cuenta principal");
        assert_eq!(created.currency, "COP");
        let v = serde_json::to_value(&created.0).unwrap();
        for removed in [
            "type",
            "credit_limit",
            "statement_day",
            "payment_due_day",
            "used_balance",
            "available_balance",
            "usage_pct",
            "alert_level",
            "statement_balance",
        ] {
            assert!(
                v.get(removed).is_none(),
                "response must not carry removed key `{removed}`, got: {v}"
            );
        }
        // Money still travels as a string; a default-zero row decodes to a
        // zero decimal (`rust_decimal` normalizes the numeric scale).
        assert_eq!(created.balance, Decimal::ZERO);
        assert!(
            v["balance"].is_string(),
            "balance must travel as a string, got: {v}"
        );
        cleanup_user(&pool, user_id).await;
    }

    // -- S3a (ledger removal): the statement helpers are gone; the balance
    // stays the single money source --

    #[tokio::test]
    async fn get_account_reports_surviving_fields_only() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP get_account_reports_surviving_fields_only: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Manual',-350.00) RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let got = get_account_handler(State(state.clone()), headers, Path(account_id))
            .await
            .expect("get own account is 200");
        assert_eq!(got.balance, Decimal::new(-35000, 2));
        assert_eq!(got.name, "Manual");
        let v = serde_json::to_value(&got.0).unwrap();
        for removed in ["type", "credit_limit", "statement_day", "payment_due_day"] {
            assert!(v.get(removed).is_none(), "removed key `{removed}` in {v}");
        }
        cleanup_user(&pool, user_id).await;
    }

        #[tokio::test]
        async fn delete_empty_account_is_204() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP delete_empty_account_is_204: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            let account_id: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name) VALUES ($1,'Temp') RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed account");
            let status = delete_account_handler(State(state.clone()), headers.clone(), Path(account_id))
                .await
                .expect("delete empty is 204");
            assert_eq!(status, StatusCode::NO_CONTENT);
            let gone: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM accounts WHERE id=$1")
                    .bind(account_id)
                    .fetch_optional(&pool)
                    .await
                    .expect("probe delete");
            assert!(gone.is_none());
            cleanup_user(&pool, user_id).await;
        }

        // -- S-A (finance-simplify-movements): the delete guard blocks
        // accounts with movements (409) and lets the rest go (204) --

        #[tokio::test]
        async fn delete_account_without_movements_is_204() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP delete_account_without_movements_is_204: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            // A balance arranged directly on the surviving table plus live
            // rows in surviving companions (category, subscription): none of
            // them blocks the delete — only movements do.
            let account_id: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Wallet',25000) RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed account");
            sqlx::query(
                "INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Mercado')",
            )
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("seed category");
            sqlx::query(
                "INSERT INTO subscriptions (user_id, name, price, currency, frequency) VALUES ($1,'Music',999,'COP','monthly')",
            )
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("seed subscription");
            let status = delete_account_handler(State(state.clone()), headers.clone(), Path(account_id))
                .await
                .expect("delete without movements is 204");
            assert_eq!(status, StatusCode::NO_CONTENT);
            let gone: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM accounts WHERE id=$1")
                    .bind(account_id)
                    .fetch_optional(&pool)
                    .await
                    .expect("probe delete");
            assert!(gone.is_none());
            cleanup_user(&pool, user_id).await;
        }

        #[tokio::test]
        async fn delete_account_with_movements_is_409() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP delete_account_with_movements_is_409: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            let account_id: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Wallet',75000) RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed account");
            let category_id: Uuid = sqlx::query_scalar(
                "INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Mercado') RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed category");
            // Hermetic fixture: the movement goes through the surviving
            // `movements` table (never a removed table).
            sqlx::query(
                "INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on) VALUES ($1,$2,$3,'expense',25000,'2026-09-24')",
            )
            .bind(user_id)
            .bind(account_id)
            .bind(category_id)
            .execute(&pool)
            .await
            .expect("seed movement");
            let err = delete_account_handler(State(state.clone()), headers.clone(), Path(account_id))
                .await
                .expect_err("delete with movements must be 409");
            let resp = err.into_response();
            assert_eq!(resp.status(), axum::http::StatusCode::CONFLICT);
            let bytes = axum::body::to_bytes(resp.into_body(), 8192)
                .await
                .expect("conflict body is readable");
            let v: serde_json::Value =
                serde_json::from_slice(&bytes).expect("conflict body is JSON");
            let message = v["error"]["message"].as_str().unwrap_or_default();
            assert!(
                message.contains("movimientos"),
                "409 must carry the Spanish block message, got: {message}"
            );
            // The account still exists with its balance unchanged.
            let balance: rust_decimal::Decimal =
                sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
                    .bind(account_id)
                    .fetch_one(&pool)
                    .await
                    .expect("account survives the blocked delete");
            assert_eq!(balance, rust_decimal::Decimal::new(7_500_000, 2));
            // `movements.account_id` is ON DELETE RESTRICT: movements go
            // before the user cascade on cleanup.
            sqlx::query("DELETE FROM movements WHERE user_id=$1")
                .bind(user_id)
                .execute(&pool)
                .await
                .expect("cleanup movements");
            cleanup_user(&pool, user_id).await;
        }

        #[tokio::test]
        async fn delete_transfer_destination_is_409() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP delete_transfer_destination_is_409: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            let origin: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Origen',75000) RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed origin account");
            let destination: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Destino',50000) RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed destination account");
            // Hermetic fixture: ONE transfer ledger row (origin -> destination).
            sqlx::query(
                "INSERT INTO movements (user_id, account_id, transfer_account_id, direction, amount, occurred_on) VALUES ($1,$2,$3,'transfer',25000,'2026-10-04')",
            )
            .bind(user_id)
            .bind(origin)
            .bind(destination)
            .execute(&pool)
            .await
            .expect("seed transfer");
            // The destination is blocked exactly like an origin account: both
            // answer the same Spanish 409.
            for blocked in [origin, destination] {
                let err =
                    delete_account_handler(State(state.clone()), headers.clone(), Path(blocked))
                        .await
                        .expect_err("a transfer leg must block the delete");
                let resp = err.into_response();
                assert_eq!(resp.status(), axum::http::StatusCode::CONFLICT);
                let bytes = axum::body::to_bytes(resp.into_body(), 8192)
                    .await
                    .expect("conflict body is readable");
                let v: serde_json::Value =
                    serde_json::from_slice(&bytes).expect("conflict body is JSON");
                let message = v["error"]["message"].as_str().unwrap_or_default();
                assert!(
                    message.contains("movimientos"),
                    "409 must carry the Spanish block message, got: {message}"
                );
            }
            // Both accounts survive with their balances unchanged.
            for (account_id, expected) in [
                (origin, rust_decimal::Decimal::new(7_500_000, 2)),
                (destination, rust_decimal::Decimal::new(5_000_000, 2)),
            ] {
                let balance: rust_decimal::Decimal =
                    sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
                        .bind(account_id)
                        .fetch_one(&pool)
                        .await
                        .expect("account survives the blocked delete");
                assert_eq!(balance, expected);
            }
            // `movements.account_id`/`transfer_account_id` are ON DELETE
            // RESTRICT: movements go before the user cascade on cleanup.
            sqlx::query("DELETE FROM movements WHERE user_id=$1")
                .bind(user_id)
                .execute(&pool)
                .await
                .expect("cleanup movements");
            cleanup_user(&pool, user_id).await;
        }

        #[tokio::test]
        async fn patch_balance_round_trip() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP patch_balance_round_trip: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            let account_id: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Cash',-500) RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed account");
            let body: Json<PatchAccountRequest> = Json(
                serde_json::from_value(json!({"balance": "-750.50"}))
                    .expect("valid balance body"),
            );
            let patched =
                patch_account_handler(State(state.clone()), headers.clone(), Path(account_id), body)
                    .await
                    .expect("balance PATCH is 200")
                    .0;
            assert_eq!(
                patched.balance,
                Decimal::new(-75050, 2),
                "response must serialize the stored balance"
            );
            let v = serde_json::to_value(&patched).unwrap();
            assert_eq!(v["balance"], serde_json::Value::String("-750.50".into()));
            let got = get_account_handler(State(state.clone()), headers, Path(account_id))
                .await
                .expect("get after PATCH is 200");
            assert_eq!(got.balance, Decimal::new(-75050, 2));
            cleanup_user(&pool, user_id).await;
        }

        #[tokio::test]
        async fn patch_balance_bad_values_are_422_and_leave_balance_untouched() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP patch_balance_bad_values_are_422_and_leave_balance_untouched: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            let account_id: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name, balance) VALUES ($1,'Cash',100) RETURNING id",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("seed account");
            for raw in ["1000000000.00", "10.005", "abc"] {
                let body: Json<PatchAccountRequest> = Json(
                    serde_json::from_value(json!({"balance": raw}))
                        .expect("deserializable balance body"),
                );
                let err = patch_account_handler(
                    State(state.clone()),
                    headers.clone(),
                    Path(account_id),
                    body,
                )
                .await
                .expect_err("bad balance must be 422");
                assert_eq!(
                    err.into_response().status(),
                    axum::http::StatusCode::UNPROCESSABLE_ENTITY
                );
            }
            let got = get_account_handler(State(state.clone()), headers, Path(account_id))
                .await
                .expect("get after rejected PATCH is 200");
            assert_eq!(got.balance, Decimal::new(10000, 2));
            cleanup_user(&pool, user_id).await;
        }

        #[tokio::test]
        async fn patch_balance_foreign_is_404_and_missing_token_is_401() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP patch_balance_foreign_is_404_and_missing_token_is_401: no DATABASE_URL");
                return;
            };
            let (state_a, _, user_a) = db_state(&pool).await;
            let (state_b, headers_b, user_b) = db_state(&pool).await;
            let account_id: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name) VALUES ($1,'Mine') RETURNING id",
            )
            .bind(user_a)
            .fetch_one(&pool)
            .await
            .expect("seed account");
            let body: Json<PatchAccountRequest> = Json(
                serde_json::from_value(json!({"balance": "-750.50"}))
                    .expect("valid balance body"),
            );
            let err = patch_account_handler(State(state_b.clone()), headers_b, Path(account_id), body)
                .await
                .expect_err("foreign balance PATCH must be 404");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::NOT_FOUND
            );
            let body: Json<PatchAccountRequest> = Json(
                serde_json::from_value(json!({"balance": "-750.50"}))
                    .expect("valid balance body"),
            );
            let err = patch_account_handler(
                State(state_a.clone()),
                HeaderMap::new(),
                Path(account_id),
                body,
            )
            .await
            .expect_err("balance PATCH without token must be 401");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNAUTHORIZED
            );
            let _ = state_a;
            cleanup_user(&pool, user_a).await;
            cleanup_user(&pool, user_b).await;
        }

        #[tokio::test]
        async fn delete_foreign_account_is_404() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP delete_foreign_account_is_404: no DATABASE_URL");
                return;
            };
            let (state_a, _, user_a) = db_state(&pool).await;
            let (state_b, headers_b, user_b) = db_state(&pool).await;
            let account_id: Uuid = sqlx::query_scalar(
                "INSERT INTO accounts (user_id, name) VALUES ($1,'Mine') RETURNING id",
            )
            .bind(user_a)
            .fetch_one(&pool)
            .await
            .expect("seed account");
            let err = delete_account_handler(State(state_b.clone()), headers_b, Path(account_id))
                .await
                .expect_err("foreign delete must be 404");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::NOT_FOUND
            );
            let _ = state_a;
            cleanup_user(&pool, user_a).await;
            cleanup_user(&pool, user_b).await;
        }
}
