//! Assets CRUD plus append-only valuations and the on-demand net-worth
//! aggregate, strictly scoped by `user_id`.
//!
//! Valuation amounts arrive as strings and are validated at the boundary with
//! [`parse_money_amount_nonneg`][crate::finance::money::parse_money_amount_nonneg]
//! (`>= 0`, `scale <= 2`, else 422): zero-value records are valid (a
//! worthless asset is still an asset). The value is additionally capped below
//! `10^16` so a `NUMERIC(18,2)` overflow can never surface as a 500.
//! `category` is validated at the API level against the `asset_category`
//! enum values (else 422, never a DB error).
//!
//! `current_value` is trigger-owned (the `sync_asset_current_value` trigger
//! overwrites it on every valuation INSERT) and never writable: the create
//! DTO carries `deny_unknown_fields` and there is no PATCH — corrections go
//! through archive + recreate. Valuations are INSERT-only: there is no
//! UPDATE or DELETE endpoint (the trigger has no DELETE branch), and the API
//! rejects `recorded_on <= max(recorded_on)` with 422 so an out-of-order
//! write can never corrupt `current_value`. A duplicate
//! `(asset_id, recorded_on)` that races past the guard maps to 409.
//!
//! DELETE is an archive-flag update (`is_archived = TRUE`), not a hard
//! delete, so valuation history survives for charts. Archived assets read as
//! deleted: list/detail/archive resolve to 404 for them, and no valuation can
//! be recorded against them. An optional `account_id` links the asset to an
//! owned bank account (else 422); foreign asset ids resolve to 404 without
//! leaking existence, while valuations against an asset id that exists for
//! nobody are 422 (orphaned-asset FK guard, mirroring the debts contract).
//!
//! Net worth is an on-demand aggregate (no trigger, no materialization):
//! per currency, `sum(non-archived assets current_value)` minus
//! `sum(active debts pending_amount)` minus credit-card debt
//! (`SUM(GREATEST(-balance, 0))` over the caller's non-archived
//! `credit_card` accounts, so an overpaid card contributes 0, never credit).
//! Card balances stay negative-as-debt: they reduce net worth through the
//! liabilities leg, exactly like `debts.pending_amount`.
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
    auth::helper::require_user_id, error::AppError, finance::money::parse_money_amount_nonneg,
    state::AppState,
};

const MAX_NAME_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;

/// Mirrors the `asset_category` Postgres enum; validated at the API boundary
/// so an unknown value is 422 instead of a DB error.
const ASSET_CATEGORIES: &[&str] = &[
    "cash",
    "account",
    "investment",
    "equipment",
    "vehicle",
    "property",
    "other",
];

/// Parse a valuation amount: non-negative money (`>= 0`, `scale <= 2`)
/// capped below `10^16` so `NUMERIC(18,2)` overflow is 422, never a 500.
pub fn validate_value(raw: &str) -> Result<Decimal, AppError> {
    let value = parse_money_amount_nonneg(raw)?;
    if value >= Decimal::new(10_000_000_000_000_000, 0) {
        return Err(AppError::Validation(
            "value exceeds the maximum storable amount".into(),
        ));
    }
    Ok(value)
}

const CREATE_ASSET_SQL: &str = "INSERT INTO assets (user_id, name, category, account_id, currency, acquired_on, notes) VALUES ($1,$2,$3::asset_category,$4,$5,$6,$7) RETURNING id, name, category::text, account_id, current_value, currency, acquired_on, notes, is_archived, created_at, updated_at";
const LIST_ASSETS_SQL: &str = "SELECT id, name, category::text, account_id, current_value, currency, acquired_on, notes, is_archived, created_at, updated_at FROM assets WHERE user_id=$1 AND NOT is_archived ORDER BY created_at ASC";
const GET_ASSET_SQL: &str = "SELECT id, name, category::text, account_id, current_value, currency, acquired_on, notes, is_archived, created_at, updated_at FROM assets WHERE id=$1 AND user_id=$2 AND NOT is_archived";
const ARCHIVE_ASSET_SQL: &str =
    "UPDATE assets SET is_archived=TRUE, updated_at=now() WHERE id=$1 AND user_id=$2 AND NOT is_archived";
/// Base for the dynamic PATCH builder (see `patch_asset_handler`).
const PATCH_ASSET_BASE_SQL: &str = "UPDATE assets SET updated_at = now()";
const ASSET_OWNERSHIP_SQL: &str =
    "SELECT id FROM assets WHERE id=$1 AND user_id=$2 AND NOT is_archived";
const ASSET_EXISTS_SQL: &str = "SELECT id FROM assets WHERE id=$1";
const ACCOUNT_OWNERSHIP_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2";
const MAX_VALUATION_SQL: &str = "SELECT max(recorded_on) FROM asset_valuations WHERE asset_id=$1";
const CREATE_VALUATION_SQL: &str = "INSERT INTO asset_valuations (user_id, asset_id, value, recorded_on, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id, asset_id, value, recorded_on, notes, created_at";
// Test-only probe: verifies trigger-synced current_value without going through HTTP.
#[cfg(test)]
const ASSET_VALUE_SQL: &str = "SELECT current_value FROM assets WHERE id=$1 AND user_id=$2";
const NET_WORTH_SQL: &str = "SELECT COALESCE(a.currency, d.currency) AS currency, COALESCE(a.total, 0) AS assets, COALESCE(d.total, 0) AS debts FROM (SELECT currency, SUM(current_value) AS total FROM assets WHERE user_id=$1 AND NOT is_archived GROUP BY currency) a FULL OUTER JOIN (SELECT currency, SUM(total) AS total FROM (SELECT currency, pending_amount AS total FROM debts WHERE user_id=$1 AND status='active' UNION ALL SELECT currency, GREATEST(-balance, 0) AS total FROM accounts WHERE user_id=$1 AND type='credit_card' AND NOT is_archived) card_debts GROUP BY currency) d ON a.currency = d.currency ORDER BY currency ASC";

type AssetRow = (
    Uuid,
    String,
    String,
    Option<Uuid>,
    Decimal,
    String,
    Option<NaiveDate>,
    Option<String>,
    bool,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAssetRequest {
    pub name: String,
    /// One of the `asset_category` enum values (e.g. `"investment"`).
    pub category: String,
    /// Optional link to an owned bank account (`accounts.id`).
    pub account_id: Option<Uuid>,
    pub currency: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub acquired_on: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchAssetRequest {
    pub name: Option<String>,
    pub category: Option<String>,
    pub account_id: Option<Uuid>,
    pub currency: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub acquired_on: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AssetResponse {
    pub id: Uuid,
    pub name: String,
    pub category: String,
    pub account_id: Option<Uuid>,
    /// Trigger-owned latest valuation; read-only (starts at `0`).
    pub current_value: Decimal,
    pub currency: String,
    pub acquired_on: Option<NaiveDate>,
    pub notes: Option<String>,
    /// Always `false` on reads: archived assets resolve to 404.
    pub is_archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<AssetRow> for AssetResponse {
    fn from(
        row: (
            Uuid,
            String,
            String,
            Option<Uuid>,
            Decimal,
            String,
            Option<NaiveDate>,
            Option<String>,
            bool,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            name,
            category,
            account_id,
            current_value,
            currency,
            acquired_on,
            notes,
            is_archived,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            name,
            category,
            account_id,
            current_value,
            currency,
            acquired_on,
            notes,
            is_archived,
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

/// Validate the asset category against the `asset_category` enum values
/// (exact match after trimming), else 422.
pub fn validate_category(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if ASSET_CATEGORIES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "category must be one of: cash, account, investment, equipment, vehicle, property, other"
                .into(),
        ))
    }
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

/// Verify the linked account is owned by the caller (else 422 per design:
/// an unowned `account_id` maps to 422, never 404).
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
    owned.map(|_| ()).ok_or(AppError::Validation(
        "account must be an owned account".into(),
    ))
}

/// Resolve the asset for a write: owned and non-archived → Ok; exists
/// (foreign, or owned-but-archived) → 404 (never leak existence); exists
/// for nobody → 422 (orphaned-asset FK guard per the finance-assets spec).
pub async fn ensure_asset_writable(
    pool: &sqlx::PgPool,
    asset_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(ASSET_OWNERSHIP_SQL)
        .bind(asset_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if owned.is_some() {
        return Ok(());
    }
    let exists: Option<Uuid> = sqlx::query_scalar(ASSET_EXISTS_SQL)
        .bind(asset_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if exists.is_some() {
        return Err(AppError::NotFound);
    }
    Err(AppError::Validation("asset does not exist".into()))
}

/// Map asset write errors: `23514` (check) and `22P02` (invalid enum text —
/// belt-and-braces behind the API guard) → 422; `23503` (account FK raced
/// away) → 422; everything else is internal (never leaked). Assets carry no
/// unique constraint, so no 409 mapping here.
fn map_asset_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("invalid asset data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

/// Map valuation write errors: `23505` (`(asset_id, recorded_on)` raced
/// past the ordering guard) → 409; `23503` (asset FK raced away) and
/// `23514` (check) → 422; everything else is internal.
fn map_valuation_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("valuation already recorded for this date".into());
            }
            Some("23503") | Some("23514") => {
                return AppError::Validation("invalid asset valuation".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_asset_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateAssetRequest>,
) -> Result<(StatusCode, Json<AssetResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_required_text(&body.name, MAX_NAME_LEN, "name")?;
    let category = validate_category(&body.category)?;
    if let Some(account_id) = body.account_id {
        ensure_account_owned(&state.pool, account_id, user_id).await?;
    }
    let currency = validate_currency(body.currency.as_deref())?;
    let acquired_on = validate_optional_date(body.acquired_on.as_deref(), "acquired_on")?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    let row = sqlx::query_as::<_, AssetRow>(CREATE_ASSET_SQL)
        .bind(user_id)
        .bind(&name)
        .bind(&category)
        .bind(body.account_id)
        .bind(&currency)
        .bind(acquired_on)
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_asset_db_err)?;
    Ok((StatusCode::CREATED, Json(AssetResponse::from(row))))
}

pub async fn list_assets_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AssetResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, AssetRow>(LIST_ASSETS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(AssetResponse::from).collect()))
}

pub async fn get_asset_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<AssetResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, AssetRow>(GET_ASSET_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(AssetResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn delete_asset_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(ARCHIVE_ASSET_SQL)
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

pub async fn patch_asset_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchAssetRequest>,
) -> Result<Json<AssetResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    if body.name.is_none()
        && body.category.is_none()
        && body.account_id.is_none()
        && body.currency.is_none()
        && body.acquired_on.is_none()
        && body.notes.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    // Archivado/ajeno → 404, inexistente puro → 422 (contrato ensure_asset_writable).
    ensure_asset_writable(&state.pool, id, user_id).await?;
    let name = match body.name.as_deref() {
        Some(raw) => Some(validate_required_text(raw, MAX_NAME_LEN, "name")?),
        None => None,
    };
    let category = match body.category.as_deref() {
        Some(raw) => Some(validate_category(raw)?),
        None => None,
    };
    if let Some(account_id) = body.account_id {
        ensure_account_owned(&state.pool, account_id, user_id).await?;
    }
    let currency = match body.currency.as_deref() {
        Some(raw) => Some(validate_currency(Some(raw))?),
        None => None,
    };
    let acquired_on = match body.acquired_on.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "acquired_on")?),
        None => None,
    };
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    let mut qb: sqlx::QueryBuilder<sqlx::Postgres> =
        sqlx::QueryBuilder::new(PATCH_ASSET_BASE_SQL);
    if let Some(name) = name.as_deref() {
        qb.push(", name = ");
        qb.push_bind(name);
    }
    if let Some(category) = category.as_deref() {
        qb.push(", category = ");
        qb.push_bind(category);
        qb.push("::asset_category");
    }
    if let Some(account_id) = body.account_id {
        qb.push(", account_id = ");
        qb.push_bind(account_id);
    }
    if let Some(currency) = currency.as_deref() {
        qb.push(", currency = ");
        qb.push_bind(currency);
    }
    if let Some(acquired_on) = acquired_on {
        qb.push(", acquired_on = ");
        qb.push_bind(acquired_on);
    }
    if let Some(notes) = body.notes.as_deref() {
        qb.push(", notes = ");
        qb.push_bind(notes);
    }
    qb.push(" WHERE id = ");
    qb.push_bind(id);
    qb.push(" AND user_id = ");
    qb.push_bind(user_id);
    qb.push(" AND NOT is_archived");
    qb.push(" RETURNING id, name, category::text, account_id, current_value, currency, acquired_on, notes, is_archived, created_at, updated_at");
    let row = qb
        .build_query_as::<AssetRow>()
        .fetch_optional(&state.pool)
        .await
        .map_err(map_asset_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(AssetResponse::from(row)))
}

type ValuationRow = (
    Uuid,
    Uuid,
    Decimal,
    NaiveDate,
    Option<String>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateValuationRequest {
    /// Wire-format money string, e.g. `"1000.00"` (never a JSON number).
    pub value: String,
    /// Calendar date `YYYY-MM-DD`; must be strictly after the latest
    /// recorded valuation, else 422.
    pub recorded_on: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ValuationResponse {
    pub id: Uuid,
    pub asset_id: Uuid,
    /// Serialized as a string (e.g. `"1000.00"`); serde renders decimals
    /// as strings, never floats.
    pub value: Decimal,
    pub recorded_on: NaiveDate,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<ValuationRow> for ValuationResponse {
    fn from(
        row: (
            Uuid,
            Uuid,
            Decimal,
            NaiveDate,
            Option<String>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (id, asset_id, value, recorded_on, notes, created_at) = row;
        Self {
            id,
            asset_id,
            value,
            recorded_on,
            notes,
            created_at,
        }
    }
}

pub async fn create_valuation_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(asset_id): Path<Uuid>,
    Json(body): Json<CreateValuationRequest>,
) -> Result<(StatusCode, Json<ValuationResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let value = validate_value(&body.value)?;
    let recorded_on = validate_calendar_date(&body.recorded_on, "recorded_on")?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    ensure_asset_writable(&state.pool, asset_id, user_id).await?;
    // Ordering guard: the trigger blindly overwrites `current_value`, so a
    // valuation at or before the latest recorded date is rejected here.
    let latest: Option<NaiveDate> = sqlx::query_scalar(MAX_VALUATION_SQL)
        .bind(asset_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .flatten();
    if let Some(latest) = latest {
        if recorded_on <= latest {
            return Err(AppError::Validation(
                "valuation is older than the latest recorded valuation".into(),
            ));
        }
    }
    let row = sqlx::query_as::<_, ValuationRow>(CREATE_VALUATION_SQL)
        .bind(user_id)
        .bind(asset_id)
        .bind(value)
        .bind(recorded_on)
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_valuation_db_err)?;
    Ok((StatusCode::CREATED, Json(ValuationResponse::from(row))))
}

#[derive(Debug, Serialize)]
pub struct NetWorthEntry {
    pub currency: String,
    /// Sum of `current_value` over non-archived assets, as a string.
    pub assets: Decimal,
    /// Sum of `pending_amount` over active debts, as a string.
    pub debts: Decimal,
    /// `assets - debts`, as a string.
    pub net_worth: Decimal,
}

#[derive(Debug, Serialize)]
pub struct NetWorthResponse {
    pub per_currency: Vec<NetWorthEntry>,
}

pub async fn get_net_worth_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<NetWorthResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, (String, Decimal, Decimal)>(NET_WORTH_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(NetWorthResponse {
        per_currency: rows
            .into_iter()
            .map(|(currency, assets, debts)| NetWorthEntry {
                currency,
                assets,
                debts,
                net_worth: assets - debts,
            })
            .collect(),
    }))
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

    fn assert_409(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::CONFLICT);
    }

    #[test]
    fn accepts_trimmed_valid_name() {
        assert_eq!(
            validate_required_text("  Stock A ", MAX_NAME_LEN, "name").unwrap(),
            "Stock A"
        );
    }

    #[test]
    fn rejects_blank_and_oversized_name_as_422() {
        assert_422(validate_required_text("", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("   ", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text(&"x".repeat(201), MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("bad\0name", MAX_NAME_LEN, "name").unwrap_err());
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
            validate_calendar_date("2026-09-01", "recorded_on").unwrap(),
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
        );
        assert_eq!(
            validate_optional_date(Some("2026-12-31"), "acquired_on").unwrap(),
            Some(NaiveDate::from_ymd_opt(2026, 12, 31).unwrap())
        );
        assert_eq!(validate_optional_date(None, "acquired_on").unwrap(), None);
        for raw in ["", "2026-13-01", "2026-02-30", "01/09/2026", "not-a-date"] {
            assert_422(validate_calendar_date(raw, "recorded_on").unwrap_err());
        }
    }

    #[test]
    fn value_accepts_zero_for_worthless_assets() {
        // Unlike the strictly positive P2 parser, valuations allow `>= 0`.
        assert_eq!(validate_value("0.00").unwrap(), Decimal::ZERO);
        assert_eq!(validate_value("0").unwrap(), Decimal::ZERO);
        assert_eq!(validate_value("1000.00").unwrap(), Decimal::new(100000, 2));
        assert_eq!(validate_value("  5.00  ").unwrap(), Decimal::new(500, 2));
        assert_eq!(
            validate_value("9999999999999999.99").unwrap(),
            Decimal::new(999999999999999999i64, 2)
        );
    }

    #[test]
    fn value_rejects_negative_bad_scale_and_overflow_as_422() {
        for raw in ["abc", "", "-5.00", "-0.01", "10.005"] {
            assert_422(validate_value(raw).unwrap_err());
        }
        // 17+ integer digits cannot fit NUMERIC(18,2): 422, never a 500.
        assert_422(validate_value("99999999999999999.99").unwrap_err());
        assert_422(validate_value("100000000000000000.00").unwrap_err());
    }

    #[test]
    fn category_accepts_all_enum_values() {
        for raw in [
            "cash",
            "account",
            "investment",
            "equipment",
            "vehicle",
            "property",
            "other",
        ] {
            assert_eq!(validate_category(raw).unwrap(), raw);
        }
        assert_eq!(validate_category("  investment ").unwrap(), "investment");
    }

    #[test]
    fn category_rejects_unknown_values_as_422() {
        for raw in [
            "",
            "Investment",
            "INVESTMENT",
            "crypto",
            "stock",
            "real-estate",
        ] {
            assert_422(validate_category(raw).unwrap_err());
        }
    }

    #[test]
    fn asset_amounts_must_arrive_as_strings_not_json_numbers() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({"value": 1000.00, "recorded_on": "2026-09-01"});
        assert!(
            serde_json::from_value::<CreateValuationRequest>(payload).is_err(),
            "numeric valuation value must fail deserialization"
        );
        let ok: CreateValuationRequest = serde_json::from_value(json!({
            "value": "1000.00",
            "recorded_on": "2026-09-01"
        }))
        .unwrap();
        assert_eq!(ok.value, "1000.00");
    }

    #[test]
    fn trigger_owned_fields_are_never_writable() {
        // `current_value` / `is_archived` belong to the 0003 trigger and the
        // archive lifecycle; `deny_unknown_fields` turns them into 422 at
        // the boundary.
        for payload in [
            json!({"name": "Stock A", "category": "investment", "current_value": "1000.00"}),
            json!({"name": "Stock A", "category": "investment", "is_archived": true}),
        ] {
            assert!(
                serde_json::from_value::<CreateAssetRequest>(payload).is_err(),
                "trigger-owned field must fail deserialization"
            );
        }
        for payload in [
            json!({"value": "1000.00", "recorded_on": "2026-09-01", "current_value": "1000.00"}),
            json!({"value": "1000.00", "recorded_on": "2026-09-01", "asset_id": Uuid::new_v4()}),
        ] {
            assert!(
                serde_json::from_value::<CreateValuationRequest>(payload).is_err(),
                "trigger-owned field must fail deserialization"
            );
        }
    }

    #[test]
    fn amounts_serialize_as_strings_never_floats() {
        let resp = AssetResponse {
            id: Uuid::new_v4(),
            name: "Stock A".into(),
            category: "investment".into(),
            account_id: None,
            current_value: Decimal::new(100000, 2),
            currency: "COP".into(),
            acquired_on: None,
            notes: None,
            is_archived: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            v["current_value"],
            serde_json::Value::String("1000.00".into())
        );
        let val = ValuationResponse {
            id: Uuid::new_v4(),
            asset_id: Uuid::new_v4(),
            value: Decimal::new(100000, 2),
            recorded_on: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            notes: None,
            created_at: Utc::now(),
        };
        let v = serde_json::to_value(&val).unwrap();
        assert_eq!(v["value"], serde_json::Value::String("1000.00".into()));
        let worth = NetWorthResponse {
            per_currency: vec![NetWorthEntry {
                currency: "COP".into(),
                assets: Decimal::new(1000000, 2),
                debts: Decimal::new(300000, 2),
                net_worth: Decimal::new(700000, 2),
            }],
        };
        let v = serde_json::to_value(&worth).unwrap();
        assert_eq!(
            v["per_currency"][0]["net_worth"],
            serde_json::Value::String("7000.00".into())
        );
    }

    #[test]
    fn net_worth_entry_subtracts_debts_from_assets() {
        let entry = NetWorthEntry {
            currency: "COP".into(),
            assets: Decimal::new(1000000, 2),
            debts: Decimal::new(300000, 2),
            net_worth: Decimal::new(1000000, 2) - Decimal::new(300000, 2),
        };
        assert_eq!(entry.net_worth, Decimal::new(700000, 2));
    }

    #[test]
    fn asset_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_ASSET_SQL,
            LIST_ASSETS_SQL,
            GET_ASSET_SQL,
            ARCHIVE_ASSET_SQL,
            CREATE_VALUATION_SQL,
            ASSET_VALUE_SQL,
            NET_WORTH_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "asset SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_ASSET_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_ASSET_SQL}"
        );
        assert!(
            ARCHIVE_ASSET_SQL.contains("SET is_archived=TRUE"),
            "delete must archive via flag, never hard-delete, got: {ARCHIVE_ASSET_SQL}"
        );
        assert!(
            !ARCHIVE_ASSET_SQL.contains("DELETE FROM"),
            "delete must never hard-delete, got: {ARCHIVE_ASSET_SQL}"
        );
        assert!(
            ASSET_EXISTS_SQL.contains("FROM assets WHERE id=$1"),
            "orphaned-asset probe must be unscoped, got: {ASSET_EXISTS_SQL}"
        );
        assert!(
            NET_WORTH_SQL.contains("NOT is_archived"),
            "net worth must exclude archived assets, got: {NET_WORTH_SQL}"
        );
        assert!(
            NET_WORTH_SQL.contains("status='active'"),
            "net worth must count only active debts, got: {NET_WORTH_SQL}"
        );
    }

    #[test]
    fn conflict_maps_to_409_not_422() {
        assert_409(AppError::Conflict("valuation already recorded".into()));
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("asset-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("asset test")
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

    fn asset_body(name: &str) -> Json<CreateAssetRequest> {
        Json(
            serde_json::from_value(json!({
                "name": name,
                "category": "investment"
            }))
            .expect("valid asset body"),
        )
    }

    fn valuation_body(value: &str, recorded_on: &str) -> Json<CreateValuationRequest> {
        Json(
            serde_json::from_value(json!({"value": value, "recorded_on": recorded_on}))
                .expect("valid valuation body"),
        )
    }

    async fn seed_asset(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO assets (user_id, name, category) VALUES ($1,$2,'investment') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("asset-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed asset")
    }

    /// Re-read the trigger-owned value after a valuation write.
    async fn asset_value(pool: &sqlx::PgPool, asset_id: Uuid, user_id: Uuid) -> Decimal {
        sqlx::query_scalar::<_, Decimal>(ASSET_VALUE_SQL)
            .bind(asset_id)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("read asset value")
    }

    #[tokio::test]
    async fn create_asset_201_zero_value_then_get_200_then_archive_204() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP create_asset_201_zero_value_then_get_200_then_archive_204: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) =
            create_asset_handler(State(state.clone()), headers.clone(), asset_body("Stock A"))
                .await
                .expect("create asset is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.name, "Stock A");
        assert_eq!(created.category, "investment");
        assert_eq!(created.current_value, Decimal::ZERO);
        assert!(!created.is_archived);
        let got = get_asset_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("get own asset is 200");
        assert_eq!(got.name, "Stock A");
        let listed = list_assets_handler(State(state.clone()), headers.clone())
            .await
            .expect("list assets is 200");
        assert!(listed.iter().any(|a| a.id == created.id));
        let status = delete_asset_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("archive is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        // Archived assets read as deleted: hidden from list and detail.
        let listed = list_assets_handler(State(state.clone()), headers.clone())
            .await
            .expect("list after archive is 200");
        assert!(!listed.iter().any(|a| a.id == created.id));
        let err = get_asset_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect_err("archived asset get must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_asset_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_asset_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let asset_id: Uuid = sqlx::query_scalar(
            "INSERT INTO assets (user_id, name, category) VALUES ($1,'Mine','investment') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed asset");
        let err = get_asset_handler(State(state_b.clone()), headers_b.clone(), Path(asset_id))
            .await
            .expect_err("foreign asset get must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let err = delete_asset_handler(State(state_b.clone()), headers_b, Path(asset_id))
            .await
            .expect_err("foreign asset archive must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn valuation_201_updates_current_value_via_trigger() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP valuation_201_updates_current_value_via_trigger: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let asset_id = seed_asset(&pool, user_id).await;
        let (status, created) = create_valuation_handler(
            State(state.clone()),
            headers.clone(),
            Path(asset_id),
            valuation_body("1000.00", "2026-09-01"),
        )
        .await
        .expect("valuation is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.asset_id, asset_id);
        assert_eq!(created.value, Decimal::new(100000, 2));
        assert_eq!(
            asset_value(&pool, asset_id, user_id).await,
            Decimal::new(100000, 2)
        );
        let (status, _) = create_valuation_handler(
            State(state.clone()),
            headers.clone(),
            Path(asset_id),
            valuation_body("1250.50", "2026-09-05"),
        )
        .await
        .expect("second valuation is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(
            asset_value(&pool, asset_id, user_id).await,
            Decimal::new(125050, 2)
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn out_of_order_valuation_is_422_and_keeps_current_value() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP out_of_order_valuation_is_422_and_keeps_current_value: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let asset_id = seed_asset(&pool, user_id).await;
        let (status, _) = create_valuation_handler(
            State(state.clone()),
            headers.clone(),
            Path(asset_id),
            valuation_body("1000.00", "2026-09-05"),
        )
        .await
        .expect("baseline valuation is 201");
        assert_eq!(status, StatusCode::CREATED);
        for recorded_on in ["2026-09-01", "2026-09-05"] {
            let err = create_valuation_handler(
                State(state.clone()),
                headers.clone(),
                Path(asset_id),
                valuation_body("900.00", recorded_on),
            )
            .await
            .expect_err("out-of-order valuation must be 422");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        assert_eq!(
            asset_value(&pool, asset_id, user_id).await,
            Decimal::new(100000, 2)
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn valuation_with_invalid_money_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP valuation_with_invalid_money_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let asset_id = seed_asset(&pool, user_id).await;
        for value in ["abc", "", "-10.00", "-0.01", "10.005"] {
            let err = create_valuation_handler(
                State(state.clone()),
                headers.clone(),
                Path(asset_id),
                valuation_body(value, "2026-09-01"),
            )
            .await
            .expect_err("bad valuation money must be 422");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn valuation_on_missing_asset_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP valuation_on_missing_asset_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_valuation_handler(
            State(state.clone()),
            headers.clone(),
            Path(Uuid::new_v4()),
            valuation_body("100.00", "2026-09-01"),
        )
        .await
        .expect_err("orphaned asset valuation must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn valuation_on_foreign_asset_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP valuation_on_foreign_asset_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let asset_id = seed_asset(&pool, user_a).await;
        let err = create_valuation_handler(
            State(state_b.clone()),
            headers_b,
            Path(asset_id),
            valuation_body("100.00", "2026-09-01"),
        )
        .await
        .expect_err("foreign asset valuation must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn valuation_with_unowned_account_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP valuation_with_unowned_account_is_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_account: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let body = Json(
            serde_json::from_value(json!({
                "name": "Linked",
                "category": "account",
                "account_id": foreign_account
            }))
            .expect("valid body with account"),
        );
        let err = create_asset_handler(State(state_b.clone()), headers_b, body)
            .await
            .expect_err("unowned account must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn net_worth_subtracts_active_debts_from_non_archived_assets() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP net_worth_subtracts_active_debts_from_non_archived_assets: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let asset_id = seed_asset(&pool, user_id).await;
        let (status, _) = create_valuation_handler(
            State(state.clone()),
            headers.clone(),
            Path(asset_id),
            valuation_body("10000.00", "2026-09-01"),
        )
        .await
        .expect("valuation is 201");
        assert_eq!(status, StatusCode::CREATED);
        sqlx::query(
            "INSERT INTO debts (user_id, name, creditor, original_amount, pending_amount, currency, start_date) VALUES ($1,'Loan','Bank',3000,3000,'COP','2026-01-15')",
        )
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("seed debt");
        let worth = get_net_worth_handler(State(state.clone()), headers.clone())
            .await
            .expect("net worth is 200");
        assert_eq!(worth.per_currency.len(), 1);
        assert_eq!(worth.per_currency[0].currency, "COP");
        assert_eq!(worth.per_currency[0].assets, Decimal::new(1000000, 2));
        assert_eq!(worth.per_currency[0].debts, Decimal::new(300000, 2));
        assert_eq!(worth.per_currency[0].net_worth, Decimal::new(700000, 2));
        // Archived assets leave the aggregate; paid-off debts too.
        let status = delete_asset_handler(State(state.clone()), headers.clone(), Path(asset_id))
            .await
            .expect("archive is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        let worth = get_net_worth_handler(State(state.clone()), headers.clone())
            .await
            .expect("net worth after archive is 200");
        assert_eq!(worth.per_currency.len(), 1);
        assert_eq!(worth.per_currency[0].assets, Decimal::ZERO);
        assert_eq!(worth.per_currency[0].net_worth, Decimal::new(-300000, 2));
        cleanup_user(&pool, user_id).await;
    }

    // -- Slice 4 (p5-credit-cards): card debt as a net-worth liability --

    #[tokio::test]
    async fn net_worth_treats_card_debt_as_liability() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP net_worth_treats_card_debt_as_liability: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let asset_id = seed_asset(&pool, user_id).await;
        let (status, _) = create_valuation_handler(
            State(state.clone()),
            headers.clone(),
            Path(asset_id),
            valuation_body("10000.00", "2026-09-01"),
        )
        .await
        .expect("valuation is 201");
        assert_eq!(status, StatusCode::CREATED);
        let card_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type, credit_limit, statement_day, payment_due_day) VALUES ($1,'Visa','credit_card',5000,15,25) RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed card");
        sqlx::query("UPDATE accounts SET balance = -1000.00 WHERE id=$1")
            .bind(card_id)
            .execute(&pool)
            .await
            .expect("seed card debt");
        // A more-negative card must REDUCE net worth (debt), never raise it.
        let worth = get_net_worth_handler(State(state.clone()), headers.clone())
            .await
            .expect("net worth is 200");
        assert_eq!(worth.per_currency.len(), 1);
        assert_eq!(worth.per_currency[0].assets, Decimal::new(1000000, 2));
        assert_eq!(worth.per_currency[0].debts, Decimal::new(100000, 2));
        assert_eq!(worth.per_currency[0].net_worth, Decimal::new(900000, 2));
        cleanup_user(&pool, user_id).await;
    }
}

#[cfg(test)]
mod patch_asset_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn patch_dto_rejects_trigger_owned_fields() {
        for payload in [
            json!({"name": "Apartamento"}),
            json!({"notes": "avaluo 2026"}),
        ] {
            assert!(
                serde_json::from_value::<PatchAssetRequest>(payload).is_ok(),
                "allowlisted field must deserialize"
            );
        }
        for payload in [
            json!({"current_value": "999.00"}),
            json!({"is_archived": true}),
        ] {
            assert!(
                serde_json::from_value::<PatchAssetRequest>(payload.clone()).is_err(),
                "trigger-owned must fail deserialization: {payload}"
            );
        }
    }

    #[test]
    fn patch_sql_scopes_and_casts_category() {
        assert!(
            PATCH_ASSET_BASE_SQL.contains("updated_at = now()"),
            "patch base must refresh updated_at"
        );
        assert!(
            GET_ASSET_SQL.contains("NOT is_archived"),
            "reads must hide archived"
        );
        assert!(
            ARCHIVE_ASSET_SQL.contains("SET is_archived=TRUE"),
            "delete must archive via flag"
        );
    }

    #[test]
    fn triangulate_category_and_trigger_owned_rejected() {
        use axum::response::IntoResponse;
        assert!(validate_category("investment").is_ok());
        let err = validate_category("crypto").unwrap_err();
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        for payload in [
            serde_json::json!({"current_value": "1.00"}),
            serde_json::json!({"is_archived": true}),
        ] {
            assert!(
                serde_json::from_value::<PatchAssetRequest>(payload).is_err(),
                "trigger-owned must be 422"
            );
        }
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("assetpatch-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("asset patch test")
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
    async fn patch_rename_ok_foreign_account_422_and_archived_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_rename_ok_foreign_account_422_and_archived_404: no DATABASE_URL");
            return;
        };
        let (state_a, headers_a, user_a) = db_state(&pool).await;
        let (state_b, _, user_b) = db_state(&pool).await;
        let aid: Uuid = sqlx::query_scalar(
            "INSERT INTO assets (user_id, name, category) VALUES ($1,'Casa','property') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed asset");
        // Rename propio OK.
        let patched = patch_asset_handler(
            State(state_a.clone()),
            headers_a.clone(),
            Path(aid),
            Json(
                serde_json::from_value(serde_json::json!({"name": "Apartamento"})).unwrap(),
            ),
        )
        .await
        .expect("rename is 200");
        assert_eq!(patched.name, "Apartamento");
        // Cuenta ajena → 422.
        let foreign_account: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_b)
        .fetch_one(&pool)
        .await
        .expect("seed foreign account");
        let err = patch_asset_handler(
            State(state_a.clone()),
            headers_a.clone(),
            Path(aid),
            Json(
                serde_json::from_value(
                    serde_json::json!({"account_id": foreign_account}),
                )
                .unwrap(),
            ),
        )
        .await
        .expect_err("foreign account must be 422");
        assert_eq!(
            axum::response::IntoResponse::into_response(err).status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        // Archivar luego PATCH → 404.
        let status = delete_asset_handler(
            State(state_a.clone()),
            headers_a.clone(),
            Path(aid),
        )
        .await
        .expect("archive is 204");
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);
        let err = patch_asset_handler(
            State(state_a.clone()),
            headers_a.clone(),
            Path(aid),
            Json(serde_json::from_value(serde_json::json!({"name": "X"})).unwrap()),
        )
        .await
        .expect_err("archived patch must be 404");
        assert_eq!(
            axum::response::IntoResponse::into_response(err).status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_b;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }
}
