//! Debts CRUD plus payments, strictly scoped by `user_id`.
//!
//! Amounts arrive as strings and are validated at the boundary with
//! [`parse_money_amount`][crate::finance::money::parse_money_amount]
//! (`> 0`, `scale <= 2`, else 422) for both `original_amount` and payment
//! `amount`. Derived columns (`pending_amount`, `status`) are trigger-owned
//! and never writable: both DTOs carry `deny_unknown_fields` and there is no
//! PATCH. A new debt starts with `pending_amount = original_amount` and
//! `status = 'active'`; payments are guarded at the API level (never rely on
//! the trigger clamp): `status != 'active'` → 422 and `amount > pending` →
//! 422 (overpayment forbidden). A `transaction_id` outside the owned ledger
//! is 422; foreign debt ids resolve to 404 without leaking existence, while
//! payments against a debt id that exists for nobody are 422 (orphaned-debt
//! FK guard, mirroring the savings movements contract).
//!
//! Registered in `routes/mod.rs` (wiring in `main.rs` lands in Phase 6).

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

const MAX_NAME_LEN: usize = 200;
const MAX_CREDITOR_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;
const MAX_METHOD_LEN: usize = 100;

const CREATE_DEBT_SQL: &str = "INSERT INTO debts (user_id, name, creditor, original_amount, pending_amount, currency, start_date, due_date, installment, interest_rate, notes) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name, creditor, original_amount, pending_amount, currency, start_date, due_date, installment, interest_rate, status::text, notes, created_at, updated_at";
const LIST_DEBTS_SQL: &str = "SELECT id, name, creditor, original_amount, pending_amount, currency, start_date, due_date, installment, interest_rate, status::text, notes, created_at, updated_at FROM debts WHERE user_id=$1 ORDER BY created_at ASC";
const GET_DEBT_SQL: &str = "SELECT id, name, creditor, original_amount, pending_amount, currency, start_date, due_date, installment, interest_rate, status::text, notes, created_at, updated_at FROM debts WHERE id=$1 AND user_id=$2";
const DELETE_DEBT_SQL: &str = "DELETE FROM debts WHERE id=$1 AND user_id=$2";
const DEBT_OWNERSHIP_SQL: &str = "SELECT id FROM debts WHERE id=$1 AND user_id=$2";
const DEBT_EXISTS_SQL: &str = "SELECT id FROM debts WHERE id=$1";
const DEBT_STATE_SQL: &str =
    "SELECT pending_amount, status::text FROM debts WHERE id=$1 AND user_id=$2";
const CREATE_PAYMENT_SQL: &str = "INSERT INTO debt_payments (user_id, debt_id, amount, paid_on, payment_method, transaction_id, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, debt_id, amount, paid_on, payment_method, transaction_id, notes, created_at";
const TRANSACTION_OWNERSHIP_SQL: &str = "SELECT id FROM transactions WHERE id=$1 AND user_id=$2";

type DebtRow = (
    Uuid,
    String,
    String,
    Decimal,
    Decimal,
    String,
    NaiveDate,
    Option<NaiveDate>,
    Option<Decimal>,
    Option<Decimal>,
    String,
    Option<String>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateDebtRequest {
    pub name: String,
    pub creditor: String,
    /// Wire-format money string, e.g. `"500.00"` (never a JSON number).
    pub original_amount: String,
    pub currency: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub start_date: String,
    /// Calendar date `YYYY-MM-DD`.
    pub due_date: Option<String>,
    /// Wire-format money string (`> 0`), e.g. `"50.00"`.
    pub installment: Option<String>,
    /// Wire-format rate string, e.g. `"19.990"` (0–999.999).
    pub interest_rate: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DebtResponse {
    pub id: Uuid,
    pub name: String,
    pub creditor: String,
    /// Serialized as a string (e.g. `"500.00"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub original_amount: Decimal,
    /// Trigger-owned remainder; read-only (starts equal to `original_amount`).
    pub pending_amount: Decimal,
    pub currency: String,
    pub start_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    pub installment: Option<Decimal>,
    pub interest_rate: Option<Decimal>,
    /// Trigger-owned lifecycle flag; read-only (`active` at creation).
    pub status: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<DebtRow> for DebtResponse {
    fn from(
        row: (
            Uuid,
            String,
            String,
            Decimal,
            Decimal,
            String,
            NaiveDate,
            Option<NaiveDate>,
            Option<Decimal>,
            Option<Decimal>,
            String,
            Option<String>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            name,
            creditor,
            original_amount,
            pending_amount,
            currency,
            start_date,
            due_date,
            installment,
            interest_rate,
            status,
            notes,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            name,
            creditor,
            original_amount,
            pending_amount,
            currency,
            start_date,
            due_date,
            installment,
            interest_rate,
            status,
            notes,
            created_at,
            updated_at,
        }
    }
}

/// Validate a required short text field: 1-`max` chars after trimming, no
/// null bytes.
pub fn validate_required_text(
    raw: &str,
    max: usize,
    field: &'static str,
) -> Result<String, AppError> {
    let value = raw.trim();
    if value.is_empty() || value.len() > max || value.contains('\0') {
        return Err(AppError::Validation(format!(
            "{field} must be 1-{max} characters"
        )));
    }
    Ok(value.to_string())
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

/// Parse a calendar date (strict `YYYY-MM-DD`), else 422.
pub fn validate_calendar_date(raw: &str, field: &'static str) -> Result<NaiveDate, AppError> {
    let trimmed = raw.trim();
    let well_formed =
        trimmed.len() == 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-';
    if !well_formed {
        return Err(AppError::Validation(format!(
            "{field} must be a calendar date YYYY-MM-DD"
        )));
    }
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| AppError::Validation(format!("{field} must be a calendar date YYYY-MM-DD")))
}

/// Parse an optional calendar date (`YYYY-MM-DD`), else 422.
pub fn validate_optional_date(
    raw: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveDate>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    validate_calendar_date(raw, field).map(Some)
}

/// Parse an optional installment as positive money (`> 0`, `scale <= 2`),
/// else 422.
pub fn validate_optional_installment(raw: Option<&str>) -> Result<Option<Decimal>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    parse_money_amount(raw).map(Some)
}

/// Parse an optional interest rate: 0–999.999 with at most 3 decimals
/// (`NUMERIC(6,3)` in the schema), else 422.
pub fn validate_optional_interest_rate(raw: Option<&str>) -> Result<Option<Decimal>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    let rate = trimmed.parse::<Decimal>().map_err(|_| {
        AppError::Validation("interest_rate must be a number with at most 3 decimals".into())
    })?;
    if rate < Decimal::ZERO || rate.scale() > 3 || rate >= Decimal::new(1000, 0) {
        return Err(AppError::Validation(
            "interest_rate must be between 0 and 999.999".into(),
        ));
    }
    Ok(Some(rate))
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

/// Map debt write errors: `23514` (check) → 422; everything else is internal
/// (never leaked). No unique constraint exists on debts, so no 409 mapping.
fn map_debt_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if db.code().as_deref() == Some("23514") {
            return AppError::Validation("invalid debt data".into());
        }
    }
    AppError::Internal
}

pub async fn create_debt_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateDebtRequest>,
) -> Result<(StatusCode, Json<DebtResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_required_text(&body.name, MAX_NAME_LEN, "name")?;
    let creditor = validate_required_text(&body.creditor, MAX_CREDITOR_LEN, "creditor")?;
    let original_amount = parse_money_amount(&body.original_amount)?;
    let currency = validate_currency(body.currency.as_deref())?;
    let start_date = validate_calendar_date(&body.start_date, "start_date")?;
    let due_date = validate_optional_date(body.due_date.as_deref(), "due_date")?;
    let installment = validate_optional_installment(body.installment.as_deref())?;
    let interest_rate = validate_optional_interest_rate(body.interest_rate.as_deref())?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    let row = sqlx::query_as::<_, DebtRow>(CREATE_DEBT_SQL)
        .bind(user_id)
        .bind(&name)
        .bind(&creditor)
        .bind(original_amount)
        .bind(&currency)
        .bind(start_date)
        .bind(due_date)
        .bind(installment)
        .bind(interest_rate)
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_debt_db_err)?;
    Ok((StatusCode::CREATED, Json(DebtResponse::from(row))))
}

pub async fn list_debts_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<DebtResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, DebtRow>(LIST_DEBTS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(DebtResponse::from).collect()))
}

pub async fn get_debt_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<DebtResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, DebtRow>(GET_DEBT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(DebtResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn delete_debt_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_DEBT_SQL)
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

type PaymentRow = (
    Uuid,
    Uuid,
    Decimal,
    NaiveDate,
    Option<String>,
    Option<Uuid>,
    Option<String>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreatePaymentRequest {
    /// Wire-format money string, e.g. `"100.00"` (never a JSON number).
    pub amount: String,
    /// Calendar date `YYYY-MM-DD`.
    pub paid_on: String,
    pub payment_method: Option<String>,
    pub transaction_id: Option<Uuid>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PaymentResponse {
    pub id: Uuid,
    pub debt_id: Uuid,
    /// Serialized as a string (e.g. `"100.00"`); serde renders decimals as
    /// strings, never floats.
    pub amount: Decimal,
    pub paid_on: NaiveDate,
    pub payment_method: Option<String>,
    pub transaction_id: Option<Uuid>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<PaymentRow> for PaymentResponse {
    fn from(
        row: (
            Uuid,
            Uuid,
            Decimal,
            NaiveDate,
            Option<String>,
            Option<Uuid>,
            Option<String>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (id, debt_id, amount, paid_on, payment_method, transaction_id, notes, created_at) = row;
        Self {
            id,
            debt_id,
            amount,
            paid_on,
            payment_method,
            transaction_id,
            notes,
            created_at,
        }
    }
}

/// Resolve the debt for a payment write: owned → Ok; exists for another
/// user → 404 (never leak existence); exists for nobody → 422
/// (orphaned-debt FK guard per the finance-debts spec).
pub async fn ensure_debt_writable(
    pool: &sqlx::PgPool,
    debt_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(DEBT_OWNERSHIP_SQL)
        .bind(debt_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if owned.is_some() {
        return Ok(());
    }
    let exists: Option<Uuid> = sqlx::query_scalar(DEBT_EXISTS_SQL)
        .bind(debt_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if exists.is_some() {
        return Err(AppError::NotFound);
    }
    Err(AppError::Validation("debt does not exist".into()))
}

/// Verify the linked transaction is owned by the caller (else 422 per
/// design: unowned `transaction_id` maps to 422, never 404).
pub async fn ensure_transaction_owned(
    pool: &sqlx::PgPool,
    transaction_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(TRANSACTION_OWNERSHIP_SQL)
        .bind(transaction_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    owned.map(|_| ()).ok_or(AppError::Validation(
        "transaction must be an owned transaction".into(),
    ))
}

/// Map payment write errors: `23503` (FK: debt vanished mid-flight or
/// transaction deleted) → 422; `23514` (check) → 422; everything else is
/// internal. The overpayment and paid-off guards fire at the API level
/// before INSERT, so reaching the trigger clamp is a 422, never silent.
fn map_payment_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23503") => {
                return AppError::Validation("invalid debt payment reference".into());
            }
            Some("23514") => {
                return AppError::Validation("invalid debt payment amount".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_payment_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(debt_id): Path<Uuid>,
    Json(body): Json<CreatePaymentRequest>,
) -> Result<(StatusCode, Json<PaymentResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let amount = parse_money_amount(&body.amount)?;
    let paid_on = validate_calendar_date(&body.paid_on, "paid_on")?;
    validate_optional_text(
        body.payment_method.as_deref(),
        MAX_METHOD_LEN,
        "payment_method",
    )?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    ensure_debt_writable(&state.pool, debt_id, user_id).await?;
    let (pending, status): (Decimal, String) = sqlx::query_as(DEBT_STATE_SQL)
        .bind(debt_id)
        .bind(user_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if status != "active" {
        return Err(AppError::Validation(
            "payments are only allowed on active debts".into(),
        ));
    }
    if amount > pending {
        return Err(AppError::Validation(
            "payment exceeds the pending amount".into(),
        ));
    }
    if let Some(transaction_id) = body.transaction_id {
        ensure_transaction_owned(&state.pool, transaction_id, user_id).await?;
    }
    let row = sqlx::query_as::<_, PaymentRow>(CREATE_PAYMENT_SQL)
        .bind(user_id)
        .bind(debt_id)
        .bind(amount)
        .bind(paid_on)
        .bind(body.payment_method.as_deref())
        .bind(body.transaction_id)
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_payment_db_err)?;
    Ok((StatusCode::CREATED, Json(PaymentResponse::from(row))))
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
    fn accepts_trimmed_valid_name_and_creditor() {
        assert_eq!(
            validate_required_text("  Car Loan ", MAX_NAME_LEN, "name").unwrap(),
            "Car Loan"
        );
        assert_eq!(
            validate_required_text("  Test Bank ", MAX_CREDITOR_LEN, "creditor").unwrap(),
            "Test Bank"
        );
    }

    #[test]
    fn rejects_blank_and_oversized_texts_as_422() {
        assert_422(validate_required_text("", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("   ", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text(&"x".repeat(201), MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("bad\0name", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("", MAX_CREDITOR_LEN, "creditor").unwrap_err());
        assert_422(
            validate_required_text(&"x".repeat(201), MAX_CREDITOR_LEN, "creditor").unwrap_err(),
        );
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
    fn accepts_iso_dates_and_rejects_bad_dates_as_422() {
        assert_eq!(
            validate_calendar_date("2026-01-15", "start_date").unwrap(),
            NaiveDate::from_ymd_opt(2026, 1, 15).unwrap()
        );
        assert_eq!(
            validate_optional_date(Some("2026-12-31"), "due_date").unwrap(),
            Some(NaiveDate::from_ymd_opt(2026, 12, 31).unwrap())
        );
        assert_eq!(validate_optional_date(None, "due_date").unwrap(), None);
        for raw in ["", "2026-13-01", "2026-02-30", "15/01/2026", "not-a-date"] {
            assert_422(validate_calendar_date(raw, "start_date").unwrap_err());
            assert_422(validate_calendar_date(raw, "paid_on").unwrap_err());
        }
    }

    #[test]
    fn installment_must_be_positive_money_as_422() {
        assert_eq!(
            validate_optional_installment(Some("50.00")).unwrap(),
            Some(Decimal::new(5000, 2))
        );
        assert_eq!(validate_optional_installment(None).unwrap(), None);
        for raw in ["abc", "", "0.00", "0", "-5.00", "10.005"] {
            assert_422(validate_optional_installment(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn interest_rate_accepts_zero_to_999_with_3_decimals() {
        assert_eq!(
            validate_optional_interest_rate(Some("19.990")).unwrap(),
            Some(Decimal::new(19990, 3))
        );
        assert_eq!(
            validate_optional_interest_rate(Some("0")).unwrap(),
            Some(Decimal::ZERO)
        );
        assert_eq!(validate_optional_interest_rate(None).unwrap(), None);
    }

    #[test]
    fn interest_rate_rejects_out_of_range_as_422() {
        for raw in ["abc", "", "-0.01", "-5", "19.9999", "1000", "9999.99"] {
            assert_422(validate_optional_interest_rate(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn debt_amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({
            "name": "Car Loan",
            "creditor": "Bank",
            "original_amount": 500.00,
            "start_date": "2026-01-15"
        });
        assert!(
            serde_json::from_value::<CreateDebtRequest>(payload).is_err(),
            "numeric original_amount must fail deserialization"
        );
        let ok: CreateDebtRequest = serde_json::from_value(json!({
            "name": "Car Loan",
            "creditor": "Bank",
            "original_amount": "500.00",
            "start_date": "2026-01-15"
        }))
        .unwrap();
        assert_eq!(ok.original_amount, "500.00");
    }

    #[test]
    fn payment_amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({"amount": 100.00, "paid_on": "2026-02-01"});
        assert!(
            serde_json::from_value::<CreatePaymentRequest>(payload).is_err(),
            "numeric payment amount must fail deserialization"
        );
        let ok: CreatePaymentRequest = serde_json::from_value(json!({
            "amount": "100.00",
            "paid_on": "2026-02-01"
        }))
        .unwrap();
        assert_eq!(ok.amount, "100.00");
    }

    #[test]
    fn trigger_owned_fields_are_never_writable() {
        // `pending_amount` / `status` belong to the 0003 trigger;
        // `deny_unknown_fields` turns them into 422 at the boundary.
        for payload in [
            json!({
                "name": "Car Loan", "creditor": "Bank",
                "original_amount": "500.00", "start_date": "2026-01-15",
                "pending_amount": "500.00"
            }),
            json!({
                "name": "Car Loan", "creditor": "Bank",
                "original_amount": "500.00", "start_date": "2026-01-15",
                "status": "active"
            }),
        ] {
            assert!(
                serde_json::from_value::<CreateDebtRequest>(payload).is_err(),
                "trigger-owned field must fail deserialization"
            );
        }
        for payload in [
            json!({"amount": "100.00", "paid_on": "2026-02-01", "pending_amount": "400.00"}),
            json!({"amount": "100.00", "paid_on": "2026-02-01", "status": "paid_off"}),
        ] {
            assert!(
                serde_json::from_value::<CreatePaymentRequest>(payload).is_err(),
                "trigger-owned field must fail deserialization"
            );
        }
    }

    #[test]
    fn amounts_serialize_as_strings_never_floats() {
        let resp = DebtResponse {
            id: Uuid::new_v4(),
            name: "Car Loan".into(),
            creditor: "Bank".into(),
            original_amount: Decimal::new(50000, 2),
            pending_amount: Decimal::new(40000, 2),
            currency: "COP".into(),
            start_date: NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
            due_date: None,
            installment: None,
            interest_rate: None,
            status: "active".into(),
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            v["original_amount"],
            serde_json::Value::String("500.00".into())
        );
        assert_eq!(
            v["pending_amount"],
            serde_json::Value::String("400.00".into())
        );
        let pay = PaymentResponse {
            id: Uuid::new_v4(),
            debt_id: Uuid::new_v4(),
            amount: Decimal::new(10000, 2),
            paid_on: NaiveDate::from_ymd_opt(2026, 2, 1).unwrap(),
            payment_method: None,
            transaction_id: None,
            notes: None,
            created_at: Utc::now(),
        };
        let v = serde_json::to_value(&pay).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("100.00".into()));
    }

    #[test]
    fn debt_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_DEBT_SQL,
            LIST_DEBTS_SQL,
            GET_DEBT_SQL,
            DELETE_DEBT_SQL,
            CREATE_PAYMENT_SQL,
            DEBT_STATE_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "debt SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_DEBT_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_DEBT_SQL}"
        );
        assert!(
            DELETE_DEBT_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_DEBT_SQL}"
        );
        assert!(
            DEBT_EXISTS_SQL.contains("FROM debts WHERE id=$1"),
            "orphaned-debt probe must be unscoped, got: {DEBT_EXISTS_SQL}"
        );
        assert!(
            CREATE_DEBT_SQL.contains("pending_amount"),
            "create must seed pending_amount from the original, got: {CREATE_DEBT_SQL}"
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
        let email = format!("debt-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("debt test")
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

    fn create_body(name: &str) -> Json<CreateDebtRequest> {
        Json(
            serde_json::from_value(json!({
                "name": name,
                "creditor": "Test Bank",
                "original_amount": "500.00",
                "start_date": "2026-01-15"
            }))
            .expect("valid debt body"),
        )
    }

    fn payment_body(amount: &str) -> Json<CreatePaymentRequest> {
        Json(
            serde_json::from_value(json!({"amount": amount, "paid_on": "2026-02-01"}))
                .expect("valid payment body"),
        )
    }

    async fn seed_debt(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO debts (user_id, name, creditor, original_amount, pending_amount, currency, start_date) VALUES ($1,$2,'Test Bank',500,500,'COP','2026-01-15') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("debt-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed debt")
    }

    /// Re-read the trigger-owned state after a payment write.
    async fn debt_state(pool: &sqlx::PgPool, debt_id: Uuid, user_id: Uuid) -> (Decimal, String) {
        sqlx::query_as::<_, (Decimal, String)>(DEBT_STATE_SQL)
            .bind(debt_id)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("read debt state")
    }

    async fn seed_owned_transaction(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .expect("seed account");
        sqlx::query_scalar(
            "INSERT INTO transactions (user_id, account_id, type, amount, occurred_on) VALUES ($1,$2,'expense',100, '2026-02-01') RETURNING id",
        )
        .bind(user_id)
        .bind(account_id)
        .fetch_one(pool)
        .await
        .expect("seed transaction")
    }

    #[tokio::test]
    async fn create_debt_201_pending_equals_original_then_get_200_then_delete_204() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP create_debt_201_pending_equals_original_then_get_200_then_delete_204: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) = create_debt_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Car Loan"),
        )
        .await
        .expect("create debt is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.original_amount, Decimal::new(50000, 2));
        assert_eq!(created.pending_amount, Decimal::new(50000, 2));
        assert_eq!(created.status, "active");
        let got = get_debt_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("get own debt is 200");
        assert_eq!(got.name, "Car Loan");
        let listed = list_debts_handler(State(state.clone()), headers.clone())
            .await
            .expect("list debts is 200");
        assert!(listed.iter().any(|d| d.id == created.id));
        let status = delete_debt_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_debt_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_debt_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let debt_id: Uuid = sqlx::query_scalar(
            "INSERT INTO debts (user_id, name, creditor, original_amount, pending_amount, currency, start_date) VALUES ($1,'Mine','Bank',500,500,'COP','2026-01-15') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed debt");
        let err = get_debt_handler(State(state_b.clone()), headers_b.clone(), Path(debt_id))
            .await
            .expect_err("foreign debt get must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let err = delete_debt_handler(State(state_b.clone()), headers_b, Path(debt_id))
            .await
            .expect_err("foreign debt delete must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn payment_201_reduces_pending_via_trigger() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP payment_201_reduces_pending_via_trigger: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let debt_id = seed_debt(&pool, user_id).await;
        let (status, created) = create_payment_handler(
            State(state.clone()),
            headers.clone(),
            Path(debt_id),
            payment_body("100.00"),
        )
        .await
        .expect("payment is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.debt_id, debt_id);
        let (pending, status) = debt_state(&pool, debt_id, user_id).await;
        assert_eq!(pending, Decimal::new(40000, 2));
        assert_eq!(status, "active");
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn full_payoff_flips_status_to_paid_off_via_trigger() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP full_payoff_flips_status_to_paid_off_via_trigger: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let debt_id = seed_debt(&pool, user_id).await;
        let (status, _) = create_payment_handler(
            State(state.clone()),
            headers.clone(),
            Path(debt_id),
            payment_body("450.00"),
        )
        .await
        .expect("first payment is 201");
        assert_eq!(status, StatusCode::CREATED);
        let (_, status) = debt_state(&pool, debt_id, user_id).await;
        assert_eq!(status, "active");
        let (status, _) = create_payment_handler(
            State(state.clone()),
            headers.clone(),
            Path(debt_id),
            payment_body("50.00"),
        )
        .await
        .expect("payoff payment is 201");
        assert_eq!(status, StatusCode::CREATED);
        let (pending, status) = debt_state(&pool, debt_id, user_id).await;
        assert_eq!(pending, Decimal::ZERO);
        assert_eq!(status, "paid_off");
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn overpayment_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP overpayment_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let debt_id = seed_debt(&pool, user_id).await;
        let err = create_payment_handler(
            State(state.clone()),
            headers.clone(),
            Path(debt_id),
            payment_body("600.00"),
        )
        .await
        .expect_err("overpayment must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let (pending, status) = debt_state(&pool, debt_id, user_id).await;
        assert_eq!(pending, Decimal::new(50000, 2));
        assert_eq!(status, "active");
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn payment_on_paid_off_debt_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP payment_on_paid_off_debt_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let debt_id = seed_debt(&pool, user_id).await;
        let (status, _) = create_payment_handler(
            State(state.clone()),
            headers.clone(),
            Path(debt_id),
            payment_body("500.00"),
        )
        .await
        .expect("payoff is 201");
        assert_eq!(status, StatusCode::CREATED);
        let err = create_payment_handler(
            State(state.clone()),
            headers.clone(),
            Path(debt_id),
            payment_body("10.00"),
        )
        .await
        .expect_err("payment on paid_off debt must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn payment_with_invalid_money_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP payment_with_invalid_money_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let debt_id = seed_debt(&pool, user_id).await;
        for amount in ["abc", "0.00", "0", "-10.00", "10.005"] {
            let err = create_payment_handler(
                State(state.clone()),
                headers.clone(),
                Path(debt_id),
                payment_body(amount),
            )
            .await
            .expect_err("bad payment money must be 422");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn payment_on_missing_debt_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP payment_on_missing_debt_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_payment_handler(
            State(state.clone()),
            headers.clone(),
            Path(Uuid::new_v4()),
            payment_body("10.00"),
        )
        .await
        .expect_err("orphaned debt payment must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn payment_on_foreign_debt_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP payment_on_foreign_debt_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let debt_id = seed_debt(&pool, user_a).await;
        let err = create_payment_handler(
            State(state_b.clone()),
            headers_b,
            Path(debt_id),
            payment_body("10.00"),
        )
        .await
        .expect_err("foreign debt payment must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn payment_with_unowned_transaction_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP payment_with_unowned_transaction_is_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_tx = seed_owned_transaction(&pool, user_a).await;
        let debt_id = seed_debt(&pool, user_b).await;
        let body = Json(
            serde_json::from_value(json!({
                "amount": "10.00",
                "paid_on": "2026-02-01",
                "transaction_id": foreign_tx
            }))
            .expect("valid body with transaction"),
        );
        let err = create_payment_handler(State(state_b.clone()), headers_b, Path(debt_id), body)
            .await
            .expect_err("unowned transaction must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }
}
