//! Finance transaction CRUD (income/expense only), scoped by `user_id`.
//!
//! Amounts arrive as strings and are validated by
//! [`parse_money_amount`][crate::finance::money::parse_money_amount]
//! (`> 0`, `scale <= 2`, else 422). Core fields (`amount`, `account_id`,
//! `type`) are immutable after creation: PATCH only accepts
//! description/notes/category (unknown fields → 422 via
//! `deny_unknown_fields`). Deletes rely on the DB trigger to reverse the
//! balance effect. Transfers are owned by PR3 and rejected here.
//!
//! Route registration happens in PR4; this module only declares handlers.

// Allowed until PR4 registers routes; covered by unit tests.
#![allow(dead_code)]

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id, error::AppError, finance::money::parse_money_amount,
    state::AppState,
};

/// Transaction kinds accepted here. `transfer` legs are created atomically by
/// PR3 (`POST /transfers`), never by this endpoint.
pub const TRANSACTION_TYPES: &[&str] = &["income", "expense"];

const MAX_TEXT_LEN: usize = 2000;
const MAX_PAYMENT_METHOD_LEN: usize = 64;

const CREATE_TRANSACTION_SQL: &str = "INSERT INTO transactions (user_id, account_id, type, amount, occurred_on, category_id, description, notes, payment_method) VALUES ($1,$2,$3::transaction_type,$4,$5,$6,$7,$8,$9) RETURNING id, account_id, type::text, amount, currency, occurred_on, category_id, description, notes, created_at, updated_at";
const DELETE_TRANSACTION_SQL: &str = "DELETE FROM transactions WHERE id=$1 AND user_id=$2";
const ACCOUNT_OWNERSHIP_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";

type TransactionRow = (
    Uuid,
    Uuid,
    String,
    Decimal,
    String,
    NaiveDate,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTransactionRequest {
    pub account_id: Uuid,
    #[serde(rename = "type")]
    pub transaction_type: String,
    /// Wire-format money string, e.g. `"50.00"` (never a JSON number).
    pub amount: String,
    /// Calendar date `YYYY-MM-DD`.
    pub occurred_on: String,
    pub category_id: Option<Uuid>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub payment_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchTransactionRequest {
    pub description: Option<String>,
    pub notes: Option<String>,
    pub category_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct TransactionResponse {
    pub id: Uuid,
    pub account_id: Uuid,
    #[serde(rename = "type")]
    pub transaction_type: String,
    /// Serialized as a string (e.g. `"50.00"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub amount: Decimal,
    pub currency: String,
    pub occurred_on: NaiveDate,
    pub category_id: Option<Uuid>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl
    From<(
        Uuid,
        Uuid,
        String,
        Decimal,
        String,
        NaiveDate,
        Option<Uuid>,
        Option<String>,
        Option<String>,
        DateTime<Utc>,
        DateTime<Utc>,
    )> for TransactionResponse
{
    fn from(
        row: (
            Uuid,
            Uuid,
            String,
            Decimal,
            String,
            NaiveDate,
            Option<Uuid>,
            Option<String>,
            Option<String>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            account_id,
            transaction_type,
            amount,
            currency,
            occurred_on,
            category_id,
            description,
            notes,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            account_id,
            transaction_type,
            amount,
            currency,
            occurred_on,
            category_id,
            description,
            notes,
            created_at,
            updated_at,
        }
    }
}

/// Validate the transaction kind: only `income`/`expense` here (422 otherwise,
/// including `transfer` which belongs to `POST /transfers`).
pub fn validate_transaction_type(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if TRANSACTION_TYPES.contains(&normalized) {
        Ok(normalized.to_string())
    } else if normalized == "transfer" {
        Err(AppError::Validation(
            "transfers require POST /transfers".into(),
        ))
    } else {
        Err(AppError::Validation(
            "transaction type must be income or expense".into(),
        ))
    }
}

/// Parse `occurred_on` as a calendar date (strict `YYYY-MM-DD`), else 422.
pub fn validate_occurred_on(raw: &str) -> Result<NaiveDate, AppError> {
    let trimmed = raw.trim();
    let well_formed =
        trimmed.len() == 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-';
    if !well_formed {
        return Err(AppError::Validation(
            "occurred_on must be a calendar date YYYY-MM-DD".into(),
        ));
    }
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("occurred_on must be a calendar date YYYY-MM-DD".into()))
}

/// Validate PATCH text lengths (description/notes caps).
pub fn validate_transaction_patch(body: &PatchTransactionRequest) -> Result<(), AppError> {
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    Ok(())
}

fn validate_optional_text(
    value: Option<&str>,
    max: usize,
    field: &'static str,
) -> Result<(), AppError> {
    if let Some(text) = value {
        if text.len() > max || text.contains('\0') {
            return Err(AppError::Validation(format!(
                "{field} must be at most {max} characters"
            )));
        }
    }
    Ok(())
}

/// Verify the account is owned by the user (else 404, no existence oracle).
pub async fn ensure_account_owned(
    pool: &sqlx::PgPool,
    account_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(ACCOUNT_OWNERSHIP_SQL)
        .bind(account_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    owned.map(|_| ()).ok_or(AppError::NotFound)
}

/// Verify the category is owned AND `kind='finance'` (else 422 per design:
/// FK + kind mismatch + unowned all map to 422, never 404).
pub async fn ensure_finance_category(
    pool: &sqlx::PgPool,
    category_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let kind: Option<String> = sqlx::query_scalar(CATEGORY_LOOKUP_SQL)
        .bind(category_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    match kind.as_deref() {
        Some("finance") => Ok(()),
        _ => Err(AppError::Validation(
            "category must be an owned finance category".into(),
        )),
    }
}

pub async fn create_transaction_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTransactionRequest>,
) -> Result<(StatusCode, Json<TransactionResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let transaction_type = validate_transaction_type(&body.transaction_type)?;
    let amount = parse_money_amount(&body.amount)?;
    let occurred_on = validate_occurred_on(&body.occurred_on)?;
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    validate_optional_text(
        body.payment_method.as_deref(),
        MAX_PAYMENT_METHOD_LEN,
        "payment_method",
    )?;
    ensure_account_owned(&state.pool, body.account_id, user_id).await?;
    if let Some(category_id) = body.category_id {
        ensure_finance_category(&state.pool, category_id, user_id).await?;
    }
    let row = sqlx::query_as::<_, TransactionRow>(CREATE_TRANSACTION_SQL)
        .bind(user_id)
        .bind(body.account_id)
        .bind(&transaction_type)
        .bind(amount)
        .bind(occurred_on)
        .bind(body.category_id)
        .bind(body.description.as_deref())
        .bind(body.notes.as_deref())
        .bind(body.payment_method.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok((StatusCode::CREATED, Json(TransactionResponse::from(row))))
}

pub async fn patch_transaction_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchTransactionRequest>,
) -> Result<Json<TransactionResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_transaction_patch(&body)?;
    if let Some(category_id) = body.category_id {
        ensure_finance_category(&state.pool, category_id, user_id).await?;
    }
    if body.description.is_none() && body.notes.is_none() && body.category_id.is_none() {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    let mut qb: sqlx::QueryBuilder<sqlx::Postgres> =
        sqlx::QueryBuilder::new("UPDATE transactions SET updated_at = now()");
    if let Some(description) = &body.description {
        qb.push(", description = ");
        qb.push_bind(description);
    }
    if let Some(notes) = &body.notes {
        qb.push(", notes = ");
        qb.push_bind(notes);
    }
    if let Some(category_id) = body.category_id {
        qb.push(", category_id = ");
        qb.push_bind(category_id);
    }
    qb.push(" WHERE id = ");
    qb.push_bind(id);
    qb.push(" AND user_id = ");
    qb.push_bind(user_id);
    qb.push(" RETURNING id, account_id, type::text, amount, currency, occurred_on, category_id, description, notes, created_at, updated_at");
    let row = qb
        .build_query_as::<TransactionRow>()
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(TransactionResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn delete_transaction_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_TRANSACTION_SQL)
        .bind(id)
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
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
    fn accepts_income_and_expense_types() {
        assert_eq!(validate_transaction_type("income").unwrap(), "income");
        assert_eq!(validate_transaction_type("expense").unwrap(), "expense");
    }

    #[test]
    fn rejects_transfer_and_unknown_types_as_422() {
        // `transfer` must go through POST /transfers (atomic two-leg txn).
        for raw in ["transfer", "TRANSFER", "", "refund", " income "] {
            if raw.trim() == "income" {
                continue;
            }
            assert_422(validate_transaction_type(raw).unwrap_err());
        }
    }

    #[test]
    fn accepts_iso_calendar_date() {
        assert_eq!(
            validate_occurred_on("2026-09-01").unwrap(),
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
        );
    }

    #[test]
    fn rejects_bad_dates_as_422() {
        for raw in [
            "",
            "2026-13-01",
            "2026-02-30",
            "01/09/2026",
            "2026-9-1",
            "not-a-date",
        ] {
            assert_422(validate_occurred_on(raw).unwrap_err());
        }
    }

    #[test]
    fn amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({
            "account_id": Uuid::new_v4(),
            "type": "expense",
            "amount": 50.00,
            "occurred_on": "2026-09-01"
        });
        assert!(
            serde_json::from_value::<CreateTransactionRequest>(payload).is_err(),
            "numeric amount must fail deserialization"
        );
        let ok: CreateTransactionRequest = serde_json::from_value(json!({
            "account_id": Uuid::new_v4(),
            "type": "expense",
            "amount": "50.00",
            "occurred_on": "2026-09-01"
        }))
        .unwrap();
        assert_eq!(ok.amount, "50.00");
    }

    #[test]
    fn amount_serializes_as_string_never_float() {
        let resp = TransactionResponse {
            id: Uuid::new_v4(),
            account_id: Uuid::new_v4(),
            transaction_type: "expense".into(),
            amount: Decimal::new(5000, 2),
            currency: "COP".into(),
            occurred_on: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            category_id: None,
            description: None,
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("50.00".into()));
    }

    #[test]
    fn patch_rejects_core_field_edits_as_422() {
        for payload in [
            json!({"amount": "99.99"}),
            json!({"account_id": Uuid::new_v4()}),
            json!({"type": "income"}),
        ] {
            assert!(
                serde_json::from_value::<PatchTransactionRequest>(payload).is_err(),
                "core-field edit must fail deserialization"
            );
        }
        let ok: PatchTransactionRequest =
            serde_json::from_value(json!({"description": "lunch"})).unwrap();
        assert_eq!(ok.description.as_deref(), Some("lunch"));
    }

    #[test]
    fn patch_rejects_oversized_text_as_422() {
        let body = PatchTransactionRequest {
            description: Some("d".repeat(2001)),
            notes: None,
            category_id: None,
        };
        assert_422(validate_transaction_patch(&body).unwrap_err());
    }

    #[test]
    fn transaction_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_TRANSACTION_SQL,
            DELETE_TRANSACTION_SQL,
            ACCOUNT_OWNERSHIP_SQL,
            CATEGORY_LOOKUP_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "transaction SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            DELETE_TRANSACTION_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_TRANSACTION_SQL}"
        );
        assert!(
            CATEGORY_LOOKUP_SQL.contains("kind::text"),
            "category check must read kind, got: {CATEGORY_LOOKUP_SQL}"
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
        let email = format!("tx-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("tx test")
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

    #[tokio::test]
    async fn create_expense_201_then_delete_204() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_expense_201_then_delete_204: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let body = Json(CreateTransactionRequest {
            account_id,
            transaction_type: "expense".into(),
            amount: "50.00".into(),
            occurred_on: "2026-09-01".into(),
            category_id: None,
            description: Some("groceries".into()),
            notes: None,
            payment_method: None,
        });
        let (status, created) =
            create_transaction_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect("create expense is 201");
        assert_eq!(status, StatusCode::CREATED);
        let status =
            delete_transaction_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn transaction_on_foreign_account_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP transaction_on_foreign_account_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_account: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Vault','bank') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let body = Json(CreateTransactionRequest {
            account_id: foreign_account,
            transaction_type: "expense".into(),
            amount: "10.00".into(),
            occurred_on: "2026-09-01".into(),
            category_id: None,
            description: None,
            notes: None,
            payment_method: None,
        });
        let err = create_transaction_handler(State(state_b.clone()), headers_b, body)
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

    #[tokio::test]
    async fn non_finance_category_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP non_finance_category_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let habit_cat: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'habit','Exercise') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed habit category");
        let body = Json(CreateTransactionRequest {
            account_id,
            transaction_type: "expense".into(),
            amount: "10.00".into(),
            occurred_on: "2026-09-01".into(),
            category_id: Some(habit_cat),
            description: None,
            notes: None,
            payment_method: None,
        });
        let err = create_transaction_handler(State(state.clone()), headers, body)
            .await
            .expect_err("habit-kind category must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }
}
