//! Finance accounts CRUD + soft-archive, strictly scoped by `user_id`.
//!
//! Every query carries `AND user_id = $N` (via [`require_user_id`]) so a
//! foreign id resolves to 404 without leaking existence. Duplicate names per
//! user surface as 409 via pgcode `23505`; unknown account types as 422.
//!
//! Registered in `main.rs` (PR4 wiring).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id,
    error::AppError,
    finance::money::parse_money_amount,
    state::AppState,
};

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

const CREATE_ACCOUNT_SQL: &str = "INSERT INTO accounts (user_id, name, type, currency, credit_limit, statement_day, payment_due_day, notes, color, icon) VALUES ($1,$2,$3::account_type,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name, type::text, currency, balance, credit_limit, statement_day, payment_due_day, notes, color, icon, is_archived, created_at, updated_at";
const LIST_ACCOUNTS_SQL: &str = "SELECT id, name, type::text, currency, balance, credit_limit, statement_day, payment_due_day, notes, color, icon, is_archived, created_at, updated_at FROM accounts WHERE user_id=$1 AND NOT is_archived ORDER BY created_at ASC";
const GET_ACCOUNT_SQL: &str = "SELECT id, name, type::text, currency, balance, credit_limit, statement_day, payment_due_day, notes, color, icon, is_archived, created_at, updated_at FROM accounts WHERE id=$1 AND user_id=$2";
/// Statement-balance aggregate: linked expenses on or before the billing
/// cutoff (served by `idx_tx_card_user_date`; a second query by design, so
/// the row stays within the sqlx 16-column cap and LIST avoids N+1).
const STATEMENT_BALANCE_SQL: &str = "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE credit_card_account_id=$1 AND user_id=$2 AND type='expense' AND occurred_on <= $3";

/// Account row: 11 legacy columns + 3 card columns = 14 (sqlx 0.8 FromRow
/// tuple cap is 16). Derived card metrics (`used/available/usage/alert`)
/// are computed in Rust from `balance` + `credit_limit` — still a single
/// row fetch, so no N+1 — instead of SQL CASE, which would push the row
/// past the 16-column cap.
type AccountRow = (
    Uuid,
    String,
    String,
    String,
    Decimal,
    Option<Decimal>,
    Option<i16>,
    Option<i16>,
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
    /// Wire-format money string (e.g. `"5000.00"`); required iff
    /// `type` is `credit_card`, forbidden otherwise.
    pub credit_limit: Option<String>,
    /// Billing-cycle days (1-31); required iff `type` is `credit_card`.
    pub statement_day: Option<i16>,
    pub payment_due_day: Option<i16>,
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
    /// Card limit (`None` for non-card accounts); serialized as a string.
    pub credit_limit: Option<Decimal>,
    /// Billing-cycle days (`None` for non-card accounts).
    pub statement_day: Option<i16>,
    pub payment_due_day: Option<i16>,
    /// Derived card metrics (`None` for non-card accounts): `used` is the
    /// absolute debt, `available` is `limit - used`, `usage_pct` is
    /// `used / limit * 100`, and `alert_level` is `ok` (<70), `warn`
    /// (70-90) or `high` (>=90). Computed from the same row (no extra query).
    pub used_balance: Option<Decimal>,
    pub available_balance: Option<Decimal>,
    pub usage_pct: Option<Decimal>,
    pub alert_level: Option<String>,
    /// Cycle-to-date debt: negated `SUM` of linked expenses with
    /// `occurred_on <= cutoff` (`None` for non-cards and for list/patch
    /// reads, which skip the second query to avoid N+1).
    pub statement_balance: Option<Decimal>,
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
        Option<Decimal>,
        Option<i16>,
        Option<i16>,
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
            Option<Decimal>,
            Option<i16>,
            Option<i16>,
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
            credit_limit,
            statement_day,
            payment_due_day,
            notes,
            color,
            icon,
            is_archived,
            created_at,
            updated_at,
        ) = row;
        let (used_balance, available_balance, usage_pct, alert_level) =
            match credit_limit {
                Some(limit) => {
                    let (used, available, usage, alert) = compute_card_metrics(balance, limit);
                    (Some(used), Some(available), Some(usage), Some(alert))
                }
                None => (None, None, None, None),
            };
        Self {
            id,
            name,
            account_type,
            currency,
            balance,
            credit_limit,
            statement_day,
            payment_due_day,
            used_balance,
            available_balance,
            usage_pct,
            alert_level,
            // Populated by `get_account_handler` only (second query).
            statement_balance: None,
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

/// Validate credit-card fields against the account type (pre-DB guard ahead
/// of the `chk_card_*` CHECKs, so failures are 422 with a message).
///
/// - `credit_card` requires a `credit_limit` wire string (`> 0`, scale <= 2
///   via [`parse_money_amount`]) and both cycle days (1-31); returns the
///   parsed limit for binding.
/// - Any other type rejects all three fields (blank limit strings count as
///   absent, mirroring optional-field frontend behavior).
pub fn validate_card_fields(
    account_type: &str,
    credit_limit: Option<&str>,
    statement_day: Option<i16>,
    payment_due_day: Option<i16>,
) -> Result<Option<Decimal>, AppError> {
    let present_limit = credit_limit.filter(|s| !s.trim().is_empty());
    if account_type == "credit_card" {
        let Some(raw) = present_limit else {
            return Err(AppError::Validation(
                "credit_limit is required for credit_card accounts".into(),
            ));
        };
        let limit = parse_money_amount(raw)?;
        for (day, field) in [
            (statement_day, "statement_day"),
            (payment_due_day, "payment_due_day"),
        ] {
            match day {
                Some(d) if (1..=31).contains(&d) => {}
                _ => {
                    return Err(AppError::Validation(format!(
                        "{field} is required for credit_card accounts and must be 1-31"
                    )));
                }
            }
        }
        Ok(Some(limit))
    } else {
        if present_limit.is_some() || statement_day.is_some() || payment_due_day.is_some() {
            return Err(AppError::Validation(
                "credit_limit, statement_day and payment_due_day require type credit_card"
                    .into(),
            ));
        }
        Ok(None)
    }
}

/// Days in a calendar month (proleptic Gregorian via `chrono`).
fn days_in_month(year: i32, month: u32) -> i64 {
    let first_of_next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };
    first_of_next
        .and_then(|d| d.pred_opt())
        .map(|d| d.day() as i64)
        .unwrap_or(28)
}

/// Clamp a billing-cycle day to the last day of `(year, month)`: a
/// `statement_day` of 31 in February means the 28th (29th in leap years).
/// Pure Rust by design — SQL date/bigint arithmetic needs `::int` casts
/// and trigger WHEN clauses reject OLD/NEW refs, so the cutoff stays a bind
/// param, never SQL date math.
pub fn clamp_day(day: i16, year: i32, month: u32) -> i16 {
    let max = days_in_month(year, month);
    (day as i64).min(max) as i16
}

/// Most-recent statement date at or before `today`, derived from the stored
/// day-of-month and clamped to short months (a 31st in February means the
/// 28th/29th). Pure Rust: the cutoff travels as a bind param, never as SQL
/// date math.
pub fn statement_cutoff(statement_day: i16, today: NaiveDate) -> NaiveDate {
    let this_month = NaiveDate::from_ymd_opt(
        today.year(),
        today.month(),
        clamp_day(statement_day, today.year(), today.month()) as u32,
    )
    .expect("clamped statement day is a valid date");
    if this_month <= today {
        return this_month;
    }
    let (year, month) = if today.month() == 1 {
        (today.year() - 1, 12)
    } else {
        (today.year(), today.month() - 1)
    };
    NaiveDate::from_ymd_opt(year, month, clamp_day(statement_day, year, month) as u32)
        .expect("clamped statement day is a valid date")
}

/// Statement debt for a card: negated cycle-to-date spend (`-SUM`), so it
/// reads as debt like the cached `balance` (e.g. `-150.00`).
pub async fn statement_balance_for_card(
    pool: &sqlx::PgPool,
    card_id: Uuid,
    user_id: Uuid,
    cutoff: NaiveDate,
) -> Result<Decimal, AppError> {
    let spent: Decimal = sqlx::query_scalar(STATEMENT_BALANCE_SQL)
        .bind(card_id)
        .bind(user_id)
        .bind(cutoff)
        .fetch_one(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(-spent)
}
/// Derive card health metrics from the cached `balance` (negative = debt)
/// and the `credit_limit`. Returns
/// `(used_balance, available_balance, usage_pct, alert_level)` where
/// `alert_level` is `ok` (usage < 70), `warn` (70 <= usage < 90) or `high`
/// (usage >= 90). `usage_pct` is rounded to 2 decimals for stable wire output.
pub fn compute_card_metrics(
    balance: Decimal,
    limit: Decimal,
) -> (Decimal, Decimal, Decimal, String) {
    use rust_decimal::RoundingStrategy;
    let used = (-balance).max(Decimal::ZERO);
    let available = limit + balance;
    let usage = if limit > Decimal::ZERO {
        (used / limit * Decimal::new(100, 0)).round_dp_with_strategy(
            2,
            RoundingStrategy::MidpointAwayFromZero,
        )
    } else {
        Decimal::ZERO
    };
    let alert = if usage >= Decimal::new(90, 0) {
        "high"
    } else if usage >= Decimal::new(70, 0) {
        "warn"
    } else {
        "ok"
    }
    .to_string();
    (used, available, usage, alert)
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
    let credit_limit = validate_card_fields(
        &account_type,
        body.credit_limit.as_deref(),
        body.statement_day,
        body.payment_due_day,
    )?;
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
        .bind(credit_limit)
        .bind(body.statement_day)
        .bind(body.payment_due_day)
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
    let mut response = AccountResponse::from(row);
    // Second, index-backed query for cards only (list/patch skip it: N+1).
    if response.credit_limit.is_some() {
        if let Some(day) = response.statement_day {
            let cutoff = statement_cutoff(day, Utc::now().date_naive());
            response.statement_balance = Some(
                statement_balance_for_card(&state.pool, response.id, user_id, cutoff).await?,
            );
        }
    }
    Ok(Json(response))
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
    qb.push(" RETURNING id, name, type::text, currency, balance, credit_limit, statement_day, payment_due_day, notes, color, icon, is_archived, created_at, updated_at");
    let row = qb
        .build_query_as::<AccountRow>()
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(AccountResponse::from(r)))
        .ok_or(AppError::NotFound)
}

// -- S1 (captura manual): borrado fisico de cuentas sin movimientos --

const DELETE_ACCOUNT_SQL: &str = "DELETE FROM accounts WHERE id=$1 AND user_id=$2";
const ACCOUNT_OWNERSHIP_CHECK_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2";
/// Movements that block a physical delete: primary legs plus card-linked
/// purchases. Scoped by `user_id` so foreign activity never blocks.
const ACCOUNT_MOVEMENT_COUNT_SQL: &str = "SELECT COUNT(*) FROM transactions WHERE user_id=$1 AND (account_id=$2 OR credit_card_account_id=$2)";

fn map_account_delete_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        // `account_id` is ON DELETE RESTRICT: a movement created between the
        // pre-check and the DELETE surfaces here. Map it to the same clear
        // 409 as the pre-check instead of leaking a 500.
        if db.code().as_deref() == Some("23503") {
            return AppError::Conflict(
                "account has movements and cannot be deleted".into(),
            );
        }
    }
    AppError::Internal
}

/// Delete an owned account (204). Physical delete only when the account has
/// no movements; otherwise 409 with a clear message (mirrors the
/// debts/savings physical-delete convention: owned id missing -> 404, never
/// leaking foreign existence). Only COP is used; no conversion applies.
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
    let movements: i64 = sqlx::query_scalar(ACCOUNT_MOVEMENT_COUNT_SQL)
        .bind(user_id)
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if movements > 0 {
        return Err(AppError::Conflict(
            "account has movements and cannot be deleted".into(),
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
            credit_limit: None,
            statement_day: None,
            payment_due_day: None,
            used_balance: None,
            available_balance: None,
            usage_pct: None,
            alert_level: None,
            statement_balance: None,
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

    #[test]
    fn delete_sql_scopes_and_blocks_movements() {
        for sql in [
            DELETE_ACCOUNT_SQL,
            ACCOUNT_OWNERSHIP_CHECK_SQL,
            ACCOUNT_MOVEMENT_COUNT_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "account delete SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            DELETE_ACCOUNT_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_ACCOUNT_SQL}"
        );
        assert!(
            ACCOUNT_MOVEMENT_COUNT_SQL.contains("credit_card_account_id"),
            "movement guard must cover card-linked purchases, got: {ACCOUNT_MOVEMENT_COUNT_SQL}"
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

    // -- Slice 2 (p5-credit-cards): card validation, clamping, metrics --

    #[test]
    fn card_requires_limit_and_both_days() {
        assert_422(
            validate_card_fields("credit_card", None, Some(15), Some(25)).unwrap_err(),
        );
        assert_422(
            validate_card_fields("credit_card", Some("5000.00"), None, Some(25)).unwrap_err(),
        );
        assert_422(
            validate_card_fields("credit_card", Some("5000.00"), Some(15), None).unwrap_err(),
        );
    }

    #[test]
    fn card_rejects_non_positive_or_bad_scale_limit_as_422() {
        for raw in ["0.00", "0", "-10.00", "10.005", "abc", ""] {
            assert_422(
                validate_card_fields("credit_card", Some(raw), Some(15), Some(25)).unwrap_err(),
            );
        }
    }

    #[test]
    fn card_rejects_out_of_range_days_as_422() {
        for day in [0, 32, -1, 100] {
            assert_422(
                validate_card_fields("credit_card", Some("5000.00"), Some(day), Some(25))
                    .unwrap_err(),
            );
            assert_422(
                validate_card_fields("credit_card", Some("5000.00"), Some(15), Some(day))
                    .unwrap_err(),
            );
        }
    }

    #[test]
    fn non_card_rejects_any_card_field_as_422() {
        assert_422(
            validate_card_fields("savings", Some("5000.00"), None, None).unwrap_err(),
        );
        assert_422(validate_card_fields("bank", None, Some(15), None).unwrap_err());
        assert_422(validate_card_fields("cash", None, None, Some(25)).unwrap_err());
    }

    #[test]
    fn valid_card_fields_parse_limit() {
        let limit =
            validate_card_fields("credit_card", Some("5000.00"), Some(15), Some(25)).unwrap();
        assert_eq!(limit, Some(Decimal::new(500000, 2)));
        assert_eq!(validate_card_fields("bank", None, None, None).unwrap(), None);
    }

    #[test]
    fn clamp_day_clamps_to_month_end() {
        assert_eq!(clamp_day(31, 2026, 2), 28);
        assert_eq!(clamp_day(31, 2024, 2), 29);
        assert_eq!(clamp_day(31, 2026, 4), 30);
        assert_eq!(clamp_day(31, 2026, 1), 31);
        assert_eq!(clamp_day(15, 2026, 2), 15);
    }

    #[test]
    fn card_metrics_compute_used_available_usage() {
        let (used, available, usage, alert) =
            compute_card_metrics(Decimal::new(-30000, 2), Decimal::new(100000, 2));
        assert_eq!(used, Decimal::new(30000, 2));
        assert_eq!(available, Decimal::new(70000, 2));
        assert_eq!(usage, Decimal::new(30, 0));
        assert_eq!(alert, "ok");
    }

    #[test]
    fn card_metrics_alert_thresholds() {
        let limit = Decimal::new(100000, 2);
        let (_, _, _, alert) = compute_card_metrics(Decimal::new(-69000, 2), limit);
        assert_eq!(alert, "ok");
        let (_, _, _, alert) = compute_card_metrics(Decimal::new(-70000, 2), limit);
        assert_eq!(alert, "warn");
        let (_, _, _, alert) = compute_card_metrics(Decimal::new(-89990, 2), limit);
        assert_eq!(alert, "warn");
        let (_, _, _, alert) = compute_card_metrics(Decimal::new(-90000, 2), limit);
        assert_eq!(alert, "high");
        let (_, _, _, alert) = compute_card_metrics(Decimal::new(-91000, 2), limit);
        assert_eq!(alert, "high");
    }

    #[test]
    fn card_metrics_treat_positive_balance_as_zero_used() {
        let (used, available, usage, alert) =
            compute_card_metrics(Decimal::new(5000, 2), Decimal::new(100000, 2));
        assert_eq!(used, Decimal::ZERO);
        assert_eq!(available, Decimal::new(105000, 2));
        assert_eq!(usage, Decimal::ZERO);
        assert_eq!(alert, "ok");
    }

    #[test]
    fn create_rejects_card_only_fields_as_422() {
        // `statement_balance` is computed server-side; `used_balance` too.
        for payload in [
            json!({"name": "Visa", "type": "credit_card", "credit_limit": "5000.00", "statement_balance": "10.00"}),
            json!({"name": "Visa", "type": "bank", "used_balance": "10.00"}),
        ] {
            assert!(
                serde_json::from_value::<CreateAccountRequest>(payload).is_err(),
                "computed card metric must fail deserialization"
            );
        }
        let ok: CreateAccountRequest = serde_json::from_value(json!({
            "name": "Visa", "type": "credit_card",
            "credit_limit": "5000.00", "statement_day": 15, "payment_due_day": 25
        }))
        .unwrap();
        assert_eq!(ok.credit_limit.as_deref(), Some("5000.00"));
    }

    fn card_body(name: &str, limit: Option<&str>) -> Json<CreateAccountRequest> {
        let mut v = json!({"name": name, "type": "credit_card", "statement_day": 15, "payment_due_day": 25});
        if let Some(limit) = limit {
            v["credit_limit"] = json!(limit);
        }
        Json(serde_json::from_value(v).unwrap())
    }

    #[tokio::test]
    async fn post_card_without_limit_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP post_card_without_limit_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_account_handler(State(state.clone()), headers, card_body("Visa", None))
            .await
            .expect_err("card without limit must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn post_non_card_with_limit_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP post_non_card_with_limit_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let body = Json(
            serde_json::from_value(json!({
                "name": "Savings", "type": "savings", "credit_limit": "5000.00"
            }))
            .unwrap(),
        );
        let err = create_account_handler(State(state.clone()), headers, body)
            .await
            .expect_err("non-card with limit must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn post_valid_card_is_201_with_persisted_fields() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP post_valid_card_is_201_with_persisted_fields: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) =
            create_account_handler(State(state.clone()), headers, card_body("Visa", Some("5000.00")))
                .await
                .expect("valid card create is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.account_type, "credit_card");
        assert_eq!(created.credit_limit, Some(Decimal::new(500000, 2)));
        assert_eq!(created.statement_day, Some(15));
        assert_eq!(created.payment_due_day, Some(25));
        assert_eq!(created.balance, Decimal::ZERO);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn get_card_reports_usage_pct_and_alert_level() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP get_card_reports_usage_pct_and_alert_level: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, created) =
            create_account_handler(State(state.clone()), headers.clone(), card_body("Visa", Some("1000.00")))
                .await
                .expect("valid card create is 201");
        sqlx::query("UPDATE accounts SET balance = -910.00 WHERE id=$1")
            .bind(created.id)
            .execute(&pool)
            .await
            .expect("seed card debt");
        let got = get_account_handler(State(state.clone()), headers, Path(created.id))
            .await
            .expect("get own card is 200");
        assert_eq!(got.used_balance, Some(Decimal::new(91000, 2)));
        assert_eq!(got.available_balance, Some(Decimal::new(9000, 2)));
        assert_eq!(got.usage_pct, Some(Decimal::new(91, 0)));
        assert_eq!(got.alert_level.as_deref(), Some("high"));
        cleanup_user(&pool, user_id).await;
    }

    // -- Slice 4 (p5-credit-cards): statement cutoff aggregate --

    #[test]
    fn statement_cutoff_uses_this_month_once_reached() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 20).unwrap();
        assert_eq!(
            statement_cutoff(15, today),
            NaiveDate::from_ymd_opt(2026, 9, 15).unwrap()
        );
        // Statement day itself counts as reached.
        let today = NaiveDate::from_ymd_opt(2026, 9, 15).unwrap();
        assert_eq!(
            statement_cutoff(15, today),
            NaiveDate::from_ymd_opt(2026, 9, 15).unwrap()
        );
    }

    #[test]
    fn statement_cutoff_falls_back_to_previous_month() {
        let today = NaiveDate::from_ymd_opt(2026, 9, 10).unwrap();
        assert_eq!(
            statement_cutoff(15, today),
            NaiveDate::from_ymd_opt(2026, 8, 15).unwrap()
        );
    }

    #[test]
    fn statement_cutoff_clamps_to_month_end() {
        // 31st in February (2026 is not a leap year): this-month candidate
        // clamps to the 28th and is reached on the 28th itself.
        let today = NaiveDate::from_ymd_opt(2026, 2, 28).unwrap();
        assert_eq!(
            statement_cutoff(31, today),
            NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()
        );
        // Earlier in February: previous month keeps its full 31 days.
        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        assert_eq!(
            statement_cutoff(31, today),
            NaiveDate::from_ymd_opt(2026, 1, 31).unwrap()
        );
    }

    #[test]
    fn statement_cutoff_crosses_year_boundary() {
        let today = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
        assert_eq!(
            statement_cutoff(20, today),
            NaiveDate::from_ymd_opt(2025, 12, 20).unwrap()
        );
    }

    #[tokio::test]
    async fn get_card_reports_statement_vs_current_balance() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP get_card_reports_statement_vs_current_balance: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, card) =
            create_account_handler(State(state.clone()), headers.clone(), card_body("Visa", Some("5000.00")))
                .await
                .expect("valid card create is 201");
        let cash: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed cash account");
        // Statement day is the 15th: seed two in-cycle purchases and one
        // post-cutoff purchase, all anchored to the runtime cutoff so the
        // test is date-independent. Purchases go through raw SQL; the 0002
        // trigger still posts both legs (card debt) on INSERT.
        let cutoff = statement_cutoff(15, Utc::now().date_naive());
        let in_cycle = [cutoff - chrono::Duration::days(5), cutoff - chrono::Duration::days(3)];
        let next_cycle = cutoff + chrono::Duration::days(5);
        for (date, amount) in [(in_cycle[0], "100.00"), (in_cycle[1], "50.00"), (next_cycle, "200.00")] {
            sqlx::query(
                "INSERT INTO transactions (user_id, account_id, type, amount, occurred_on, credit_card_account_id) VALUES ($1,$2,'expense',$3,$4,$5)",
            )
            .bind(user_id)
            .bind(cash)
            .bind(amount.parse::<Decimal>().unwrap())
            .bind(date)
            .bind(card.id)
            .execute(&pool)
            .await
            .expect("seed linked expense");
        }
        let got = get_account_handler(State(state.clone()), headers, Path(card.id))
            .await
            .expect("get own card is 200");
        assert_eq!(got.balance, Decimal::new(-35000, 2));
        assert_eq!(got.statement_balance, Some(Decimal::new(-15000, 2)));
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
                "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Temp','cash') RETURNING id",
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

        #[tokio::test]
        async fn delete_account_with_movements_is_409() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP delete_account_with_movements_is_409: no DATABASE_URL");
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
            sqlx::query(
                "INSERT INTO transactions (user_id, account_id, type, amount, occurred_on) VALUES ($1,$2,'expense',10,'2026-09-01')",
            )
            .bind(user_id)
            .bind(account_id)
            .execute(&pool)
            .await
            .expect("seed movement");
            let err = delete_account_handler(State(state.clone()), headers.clone(), Path(account_id))
                .await
                .expect_err("account with movements must be 409");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::CONFLICT
            );
            let still: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM accounts WHERE id=$1 AND user_id=$2")
                    .bind(account_id)
                    .bind(user_id)
                    .fetch_optional(&pool)
                    .await
                    .expect("account must survive blocked delete");
            assert!(still.is_some());
            cleanup_user(&pool, user_id).await;
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
                "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Mine','cash') RETURNING id",
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
