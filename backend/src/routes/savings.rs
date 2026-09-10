//! Savings goals CRUD plus signed movements, strictly scoped by `user_id`.
//!
//! Amounts arrive as strings and are validated at the boundary: goals use
//! [`parse_money_amount`][crate::finance::money::parse_money_amount]
//! (`> 0`, `scale <= 2`, else 422) while movements use
//! [`parse_signed_amount`][crate::finance::money::parse_signed_amount]
//! (`!= 0`, `scale <= 2`, else 422; positive = deposit, negative =
//! withdrawal). Derived columns (`saved_amount`, `is_completed`,
//! `completed_at`) are trigger-owned and never writable: both DTOs carry
//! `deny_unknown_fields` and there is no PATCH. Duplicate goal names per user
//! surface as 409 via pgcode `23505`; a `category_id` outside the owned
//! `finance` kind or an unowned `transaction_id` is 422; foreign goal ids
//! resolve to 404 without leaking existence, while movements against a
//! goal id that exists for nobody are 422 (orphaned-goal FK guard).
//!
//! Registered in `routes/mod.rs` (wiring in `main.rs` lands in Phase 6).
//!
//! Registered in `main.rs` (Phase 6 wiring).

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
    auth::helper::require_user_id,
    error::AppError,
    finance::money::{parse_money_amount, parse_signed_amount},
    state::AppState,
};

const MAX_NAME_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;
const MAX_COLOR_LEN: usize = 32;

const CREATE_GOAL_SQL: &str = "INSERT INTO savings_goals (user_id, name, description, target_amount, currency, target_date, category_id, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, description, target_amount, saved_amount, currency, target_date, category_id, color, is_completed, completed_at, created_at, updated_at";
const LIST_GOALS_SQL: &str = "SELECT id, name, description, target_amount, saved_amount, currency, target_date, category_id, color, is_completed, completed_at, created_at, updated_at FROM savings_goals WHERE user_id=$1 ORDER BY created_at ASC";
const GET_GOAL_SQL: &str = "SELECT id, name, description, target_amount, saved_amount, currency, target_date, category_id, color, is_completed, completed_at, created_at, updated_at FROM savings_goals WHERE id=$1 AND user_id=$2";
const DELETE_GOAL_SQL: &str = "DELETE FROM savings_goals WHERE id=$1 AND user_id=$2";
/// Base for the dynamic PATCH builder (see `patch_goal_handler`).
const PATCH_GOAL_BASE_SQL: &str = "UPDATE savings_goals SET updated_at = now()";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";
const CREATE_MOVEMENT_SQL: &str = "INSERT INTO savings_goal_movements (user_id, savings_goal_id, amount, occurred_on, transaction_id, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, savings_goal_id, amount, occurred_on, transaction_id, notes, created_at";
const DELETE_MOVEMENT_SQL: &str =
    "DELETE FROM savings_goal_movements WHERE id=$1 AND savings_goal_id=$2 AND user_id=$3";
const GOAL_OWNERSHIP_SQL: &str = "SELECT id FROM savings_goals WHERE id=$1 AND user_id=$2";
const GOAL_EXISTS_SQL: &str = "SELECT id FROM savings_goals WHERE id=$1";
const TRANSACTION_OWNERSHIP_SQL: &str = "SELECT id FROM transactions WHERE id=$1 AND user_id=$2";
// Test-only probe: verifies trigger-refreshed balance without going through HTTP.
#[cfg(test)]
const GOAL_BALANCE_SQL: &str =
    "SELECT saved_amount, is_completed FROM savings_goals WHERE id=$1 AND user_id=$2";

type GoalRow = (
    Uuid,
    String,
    Option<String>,
    Decimal,
    Decimal,
    String,
    Option<NaiveDate>,
    Option<Uuid>,
    Option<String>,
    bool,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateGoalRequest {
    pub name: String,
    /// Wire-format money string, e.g. `"100.00"` (never a JSON number).
    pub target_amount: String,
    pub currency: Option<String>,
    pub description: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub target_date: Option<String>,
    pub category_id: Option<Uuid>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchGoalRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    /// Wire-format money string (`> 0`), e.g. `"2000000.00"`.
    pub target_amount: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub target_date: Option<String>,
    pub category_id: Option<Uuid>,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GoalResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    /// Serialized as a string (e.g. `"100.00"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub target_amount: Decimal,
    /// Trigger-owned running total; read-only (starts at 0).
    pub saved_amount: Decimal,
    pub currency: String,
    pub target_date: Option<NaiveDate>,
    pub category_id: Option<Uuid>,
    pub color: Option<String>,
    /// Trigger-owned completion flag; read-only.
    pub is_completed: bool,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<GoalRow> for GoalResponse {
    fn from(
        row: (
            Uuid,
            String,
            Option<String>,
            Decimal,
            Decimal,
            String,
            Option<NaiveDate>,
            Option<Uuid>,
            Option<String>,
            bool,
            Option<DateTime<Utc>>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            name,
            description,
            target_amount,
            saved_amount,
            currency,
            target_date,
            category_id,
            color,
            is_completed,
            completed_at,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            name,
            description,
            target_amount,
            saved_amount,
            currency,
            target_date,
            category_id,
            color,
            is_completed,
            completed_at,
            created_at,
            updated_at,
        }
    }
}

/// Validate a goal name: 1-200 chars after trimming, no null bytes.
pub fn validate_goal_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.len() > MAX_NAME_LEN || name.contains('\0') {
        return Err(AppError::Validation(
            "goal name must be 1-200 characters".into(),
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

/// Parse an optional `target_date` as a calendar date (`YYYY-MM-DD`), else 422.
pub fn validate_target_date(raw: Option<&str>) -> Result<Option<NaiveDate>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    let well_formed =
        trimmed.len() == 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-';
    if !well_formed {
        return Err(AppError::Validation(
            "target_date must be a calendar date YYYY-MM-DD".into(),
        ));
    }
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map(Some)
        .map_err(|_| AppError::Validation("target_date must be a calendar date YYYY-MM-DD".into()))
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

/// JD-SAVE: decide completion from saved vs target, mirroring the PATCH
/// UPDATE recalc (`saved>=target → completed + COALESCE(completed_at,now())`,
/// else reopen with `completed_at=NULL`). Pure helper for unit tests; the
/// handler applies the same logic atomically in SQL.
#[cfg(test)]
pub fn decide_goal_completion(
    saved: Decimal,
    target: Decimal,
    prev_completed_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> (bool, Option<DateTime<Utc>>) {
    if saved >= target {
        (true, prev_completed_at.or(Some(now)))
    } else {
        (false, None)
    }
}

/// Map goal write errors: `23505` (UNIQUE user_id,name) → 409,
/// `23514` (check) → 422; everything else is internal (never leaked).
fn map_goal_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("savings goal name already exists".into());
            }
            Some("23514") => {
                return AppError::Validation("invalid savings goal data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_goal_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateGoalRequest>,
) -> Result<(StatusCode, Json<GoalResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_goal_name(&body.name)?;
    let target_amount = parse_money_amount(&body.target_amount)?;
    let currency = validate_currency(body.currency.as_deref())?;
    let target_date = validate_target_date(body.target_date.as_deref())?;
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.color.as_deref(), MAX_COLOR_LEN, "color")?;
    if let Some(category_id) = body.category_id {
        ensure_finance_category(&state.pool, category_id, user_id).await?;
    }
    let row = sqlx::query_as::<_, GoalRow>(CREATE_GOAL_SQL)
        .bind(user_id)
        .bind(&name)
        .bind(body.description.as_deref())
        .bind(target_amount)
        .bind(&currency)
        .bind(target_date)
        .bind(body.category_id)
        .bind(body.color.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_goal_db_err)?;
    Ok((StatusCode::CREATED, Json(GoalResponse::from(row))))
}

pub async fn list_goals_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<GoalResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, GoalRow>(LIST_GOALS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(GoalResponse::from).collect()))
}

pub async fn get_goal_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<GoalResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, GoalRow>(GET_GOAL_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(GoalResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn delete_goal_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_GOAL_SQL)
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

pub async fn patch_goal_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchGoalRequest>,
) -> Result<Json<GoalResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    if body.name.is_none()
        && body.description.is_none()
        && body.target_amount.is_none()
        && body.target_date.is_none()
        && body.category_id.is_none()
        && body.color.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    // Ownership contract: ajeno → 404, inexistente puro → 422 (movements contract).
    ensure_goal_writable(&state.pool, id, user_id).await?;
    let current = sqlx::query_as::<_, GoalRow>(GET_GOAL_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    let _ = &current;
    let name = match body.name.as_deref() {
        Some(raw) => Some(validate_goal_name(raw)?),
        None => None,
    };
    let target_amount = match body.target_amount.as_deref() {
        Some(raw) => Some(parse_money_amount(raw)?),
        None => None,
    };
    let target_date = match body.target_date.as_deref() {
        Some(raw) => validate_target_date(Some(raw))?,
        None => None,
    };
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.color.as_deref(), MAX_COLOR_LEN, "color")?;
    if let Some(category_id) = body.category_id {
        ensure_finance_category(&state.pool, category_id, user_id).await?;
    }
    let mut qb: sqlx::QueryBuilder<sqlx::Postgres> =
        sqlx::QueryBuilder::new(PATCH_GOAL_BASE_SQL);
    if let Some(name) = name.as_deref() {
        qb.push(", name = ");
        qb.push_bind(name);
    }
    if let Some(description) = body.description.as_deref() {
        qb.push(", description = ");
        qb.push_bind(description);
    }
    if let Some(target_amount) = target_amount {
        qb.push(", target_amount = ");
        qb.push_bind(target_amount);
    }
    if let Some(target_date) = target_date {
        qb.push(", target_date = ");
        qb.push_bind(target_date);
    }
    if let Some(category_id) = body.category_id {
        qb.push(", category_id = ");
        qb.push_bind(category_id);
    }
    if let Some(color) = body.color.as_deref() {
        qb.push(", color = ");
        qb.push_bind(color);
    }
    // JD-SAVE: recálculo en el mismo UPDATE (saved>=target → completed +
    // COALESCE(completed_at,now()); si no → reabrir con completed_at=NULL).
    // Cuando el PATCH trae target nuevo se compara contra ese valor bindeado
    // (RHS de UPDATE ve la fila vieja, no el SET previo); sin target nuevo se
    // compara contra la columna actual (idempotente para renombres parciales).
    if let Some(new_target) = target_amount {
        qb.push(", is_completed = (saved_amount >= ");
        qb.push_bind(new_target);
        qb.push("), completed_at = CASE WHEN (saved_amount >= ");
        qb.push_bind(new_target);
        qb.push(") THEN COALESCE(completed_at, now()) ELSE NULL END");
    } else {
        qb.push(", is_completed = (saved_amount >= target_amount), completed_at = CASE WHEN (saved_amount >= target_amount) THEN COALESCE(completed_at, now()) ELSE NULL END");
    }
    qb.push(" WHERE id = ");
    qb.push_bind(id);
    qb.push(" AND user_id = ");
    qb.push_bind(user_id);
    qb.push(" RETURNING id, name, description, target_amount, saved_amount, currency, target_date, category_id, color, is_completed, completed_at, created_at, updated_at");
    let row = qb
        .build_query_as::<GoalRow>()
        .fetch_optional(&state.pool)
        .await
        .map_err(map_goal_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(GoalResponse::from(row)))
}

type MovementRow = (
    Uuid,
    Uuid,
    Decimal,
    NaiveDate,
    Option<Uuid>,
    Option<String>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateMovementRequest {
    /// Signed wire-format money string: positive = deposit, negative =
    /// withdrawal (`!= 0`, never a JSON number).
    pub amount: String,
    /// Calendar date `YYYY-MM-DD`.
    pub occurred_on: String,
    pub transaction_id: Option<Uuid>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MovementResponse {
    pub id: Uuid,
    pub savings_goal_id: Uuid,
    /// Signed amount as a string (e.g. `"50.00"`, `"-30.00"`); serde renders
    /// decimals as strings, never floats.
    pub amount: Decimal,
    pub occurred_on: NaiveDate,
    pub transaction_id: Option<Uuid>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<MovementRow> for MovementResponse {
    fn from(
        row: (
            Uuid,
            Uuid,
            Decimal,
            NaiveDate,
            Option<Uuid>,
            Option<String>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (id, savings_goal_id, amount, occurred_on, transaction_id, notes, created_at) = row;
        Self {
            id,
            savings_goal_id,
            amount,
            occurred_on,
            transaction_id,
            notes,
            created_at,
        }
    }
}

/// Parse `occurred_on` as a calendar date (strict `YYYY-MM-DD`), else 422.
pub fn validate_movement_date(raw: &str) -> Result<NaiveDate, AppError> {
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

/// Resolve the goal for a movement write: owned → Ok; exists for another
/// user → 404 (never leak existence); exists for nobody → 422
/// (orphaned-goal FK guard per the finance-savings spec).
pub async fn ensure_goal_writable(
    pool: &sqlx::PgPool,
    goal_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(GOAL_OWNERSHIP_SQL)
        .bind(goal_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if owned.is_some() {
        return Ok(());
    }
    let exists: Option<Uuid> = sqlx::query_scalar(GOAL_EXISTS_SQL)
        .bind(goal_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if exists.is_some() {
        return Err(AppError::NotFound);
    }
    Err(AppError::Validation("savings goal does not exist".into()))
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

/// Map movement write errors: `23503` (FK: goal vanished mid-flight or
/// transaction deleted) → 422; `23514` (check: over-withdrawal drove
/// `saved_amount` below 0) → 422; everything else is internal.
fn map_movement_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23503") => {
                return AppError::Validation("invalid savings movement reference".into());
            }
            Some("23514") => {
                return AppError::Validation("movement would overdraw the goal balance".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_movement_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(goal_id): Path<Uuid>,
    Json(body): Json<CreateMovementRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let amount = parse_signed_amount(&body.amount)?;
    let occurred_on = validate_movement_date(&body.occurred_on)?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    ensure_goal_writable(&state.pool, goal_id, user_id).await?;
    if let Some(transaction_id) = body.transaction_id {
        ensure_transaction_owned(&state.pool, transaction_id, user_id).await?;
    }
    let row = sqlx::query_as::<_, MovementRow>(CREATE_MOVEMENT_SQL)
        .bind(user_id)
        .bind(goal_id)
        .bind(amount)
        .bind(occurred_on)
        .bind(body.transaction_id)
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_movement_db_err)?;
    Ok((StatusCode::CREATED, Json(MovementResponse::from(row))))
}

pub async fn delete_movement_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((goal_id, movement_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    ensure_goal_writable(&state.pool, goal_id, user_id).await?;
    let res = sqlx::query(DELETE_MOVEMENT_SQL)
        .bind(movement_id)
        .bind(goal_id)
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
    fn accepts_trimmed_valid_name() {
        assert_eq!(validate_goal_name("  Japan Trip ").unwrap(), "Japan Trip");
    }

    #[test]
    fn rejects_blank_and_oversized_names_as_422() {
        assert_422(validate_goal_name("").unwrap_err());
        assert_422(validate_goal_name("   ").unwrap_err());
        assert_422(validate_goal_name(&"x".repeat(201)).unwrap_err());
        assert_422(validate_goal_name("bad\0name").unwrap_err());
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
    fn accepts_iso_target_date_and_none() {
        assert_eq!(validate_target_date(None).unwrap(), None);
        assert_eq!(
            validate_target_date(Some("2026-12-31")).unwrap(),
            Some(NaiveDate::from_ymd_opt(2026, 12, 31).unwrap())
        );
    }

    #[test]
    fn rejects_bad_target_dates_as_422() {
        for raw in ["", "2026-13-01", "2026-02-30", "31/12/2026", "not-a-date"] {
            assert_422(validate_target_date(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn target_amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({"name": "Trip", "target_amount": 100.00});
        assert!(
            serde_json::from_value::<CreateGoalRequest>(payload).is_err(),
            "numeric target_amount must fail deserialization"
        );
        let ok: CreateGoalRequest = serde_json::from_value(json!({
            "name": "Trip",
            "target_amount": "100.00"
        }))
        .unwrap();
        assert_eq!(ok.target_amount, "100.00");
    }

    #[test]
    fn trigger_owned_fields_are_never_writable() {
        // `saved_amount` / `is_completed` / `completed_at` belong to the 0003
        // trigger; `deny_unknown_fields` turns them into 422 at the boundary.
        for payload in [
            json!({"name": "Trip", "target_amount": "100.00", "saved_amount": "10.00"}),
            json!({"name": "Trip", "target_amount": "100.00", "is_completed": true}),
            json!({"name": "Trip", "target_amount": "100.00", "completed_at": "2026-01-01T00:00:00Z"}),
        ] {
            assert!(
                serde_json::from_value::<CreateGoalRequest>(payload).is_err(),
                "trigger-owned field must fail deserialization"
            );
        }
    }

    #[test]
    fn amounts_serialize_as_strings_never_floats() {
        let resp = GoalResponse {
            id: Uuid::new_v4(),
            name: "Trip".into(),
            description: None,
            target_amount: Decimal::new(10000, 2),
            saved_amount: Decimal::new(0, 2),
            currency: "COP".into(),
            target_date: None,
            category_id: None,
            color: None,
            is_completed: false,
            completed_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(
            v["target_amount"],
            serde_json::Value::String("100.00".into())
        );
        assert_eq!(v["saved_amount"], serde_json::Value::String("0.00".into()));
    }

    #[test]
    fn goal_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_GOAL_SQL,
            LIST_GOALS_SQL,
            GET_GOAL_SQL,
            DELETE_GOAL_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "goal SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_GOAL_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_GOAL_SQL}"
        );
        assert!(
            DELETE_GOAL_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_GOAL_SQL}"
        );
        assert!(
            CATEGORY_LOOKUP_SQL.contains("kind::text"),
            "category check must read kind, got: {CATEGORY_LOOKUP_SQL}"
        );
    }

    #[test]
    fn movement_amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({"amount": 50.00, "occurred_on": "2026-09-01"});
        assert!(
            serde_json::from_value::<CreateMovementRequest>(payload).is_err(),
            "numeric movement amount must fail deserialization"
        );
        for raw in ["50.00", "-30.00"] {
            let ok: CreateMovementRequest = serde_json::from_value(json!({
                "amount": raw,
                "occurred_on": "2026-09-01"
            }))
            .unwrap();
            assert_eq!(ok.amount, raw);
        }
    }

    #[test]
    fn movement_rejects_bad_money_and_bad_dates_as_422() {
        // Signed parser: "abc"/"0.00" → 422; date guard: malformed → 422.
        for raw in ["abc", "", "0.00", "0", "-0.00", "10.005"] {
            assert_422(parse_signed_amount(raw).unwrap_err());
        }
        for raw in ["", "2026-13-01", "2026-02-30", "01/09/2026", "not-a-date"] {
            assert_422(validate_movement_date(raw).unwrap_err());
        }
        assert_eq!(
            validate_movement_date("2026-09-01").unwrap(),
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
        );
    }

    #[test]
    fn movement_trigger_owned_fields_are_never_writable() {
        // `saved_amount` / `is_completed` belong to the 0003 trigger, not to
        // a movement row; `deny_unknown_fields` turns them into 422.
        for payload in [
            json!({"amount": "50.00", "occurred_on": "2026-09-01", "saved_amount": "10.00"}),
            json!({"amount": "50.00", "occurred_on": "2026-09-01", "is_completed": true}),
        ] {
            assert!(
                serde_json::from_value::<CreateMovementRequest>(payload).is_err(),
                "trigger-owned field must fail deserialization"
            );
        }
    }

    #[test]
    fn movement_amount_serializes_as_string_never_float() {
        let resp = MovementResponse {
            id: Uuid::new_v4(),
            savings_goal_id: Uuid::new_v4(),
            amount: Decimal::new(-3000, 2),
            occurred_on: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            transaction_id: None,
            notes: None,
            created_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("-30.00".into()));
    }

    #[test]
    fn movement_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_MOVEMENT_SQL,
            DELETE_MOVEMENT_SQL,
            GOAL_OWNERSHIP_SQL,
            TRANSACTION_OWNERSHIP_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "movement SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            DELETE_MOVEMENT_SQL.contains("id=$1 AND savings_goal_id=$2 AND user_id=$3"),
            "movement delete must scope id+goal+user, got: {DELETE_MOVEMENT_SQL}"
        );
        assert!(
            GOAL_EXISTS_SQL.contains("FROM savings_goals WHERE id=$1"),
            "orphaned-goal probe must be unscoped, got: {GOAL_EXISTS_SQL}"
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
        let email = format!("goal-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("goal test")
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

    fn create_body(name: &str) -> Json<CreateGoalRequest> {
        Json(
            serde_json::from_value(json!({"name": name, "target_amount": "100.00"}))
                .expect("valid goal body"),
        )
    }

    #[tokio::test]
    async fn create_goal_201_with_zero_balance_then_get_200_then_delete_204() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_goal_201_with_zero_balance_then_get_200_then_delete_204: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) = create_goal_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Japan Trip"),
        )
        .await
        .expect("create goal is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.saved_amount, Decimal::new(0, 2));
        assert!(!created.is_completed);
        let got = get_goal_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("get own goal is 200");
        assert_eq!(got.name, "Japan Trip");
        let listed = list_goals_handler(State(state.clone()), headers.clone())
            .await
            .expect("list goals is 200");
        assert!(listed.iter().any(|g| g.id == created.id));
        let status = delete_goal_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn duplicate_goal_name_is_409() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP duplicate_goal_name_is_409: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, _) =
            create_goal_handler(State(state.clone()), headers.clone(), create_body("Dup"))
                .await
                .expect("first create is 201");
        assert_eq!(status, StatusCode::CREATED);
        let err = create_goal_handler(State(state.clone()), headers.clone(), create_body("Dup"))
            .await
            .expect_err("duplicate name must be 409");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::CONFLICT
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_goal_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_goal_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let goal_id: Uuid = sqlx::query_scalar(
            "INSERT INTO savings_goals (user_id, name, target_amount) VALUES ($1,'Mine',100) RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed goal");
        let err = get_goal_handler(State(state_b.clone()), headers_b.clone(), Path(goal_id))
            .await
            .expect_err("foreign goal get must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let err = delete_goal_handler(State(state_b.clone()), headers_b, Path(goal_id))
            .await
            .expect_err("foreign goal delete must be 404");
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
        let habit_cat: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'habit','Exercise') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed habit category");
        let body = Json(
            serde_json::from_value(json!({
                "name": "Trip",
                "target_amount": "100.00",
                "category_id": habit_cat
            }))
            .expect("valid body with category"),
        );
        let err = create_goal_handler(State(state.clone()), headers, body)
            .await
            .expect_err("habit-kind category must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    fn movement_body(amount: &str) -> Json<CreateMovementRequest> {
        Json(
            serde_json::from_value(json!({"amount": amount, "occurred_on": "2026-09-01"}))
                .expect("valid movement body"),
        )
    }

    async fn seed_goal(pool: &sqlx::PgPool, user_id: Uuid, target: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO savings_goals (user_id, name, target_amount) VALUES ($1,$2,$3::numeric) RETURNING id",
        )
        .bind(user_id)
        .bind(format!("goal-{}", Uuid::new_v4()))
        .bind(target)
        .fetch_one(pool)
        .await
        .expect("seed goal")
    }

    /// Re-read the trigger-owned balance after a movement write.
    async fn goal_state(pool: &sqlx::PgPool, goal_id: Uuid, user_id: Uuid) -> (Decimal, bool) {
        sqlx::query_as::<_, (Decimal, bool)>(GOAL_BALANCE_SQL)
            .bind(goal_id)
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("read goal balance")
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
            "INSERT INTO transactions (user_id, account_id, type, amount, occurred_on) VALUES ($1,$2,'income',50, '2026-09-01') RETURNING id",
        )
        .bind(user_id)
        .bind(account_id)
        .fetch_one(pool)
        .await
        .expect("seed transaction")
    }

    #[tokio::test]
    async fn deposit_movement_201_updates_saved_amount_via_trigger() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP deposit_movement_201_updates_saved_amount_via_trigger: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id, "1000.00").await;
        let (status, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            movement_body("50.00"),
        )
        .await
        .expect("deposit is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.savings_goal_id, goal_id);
        let (saved, completed) = goal_state(&pool, goal_id, user_id).await;
        assert_eq!(saved, Decimal::new(5000, 2));
        assert!(!completed);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn withdrawal_movement_reduces_balance_via_trigger() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP withdrawal_movement_reduces_balance_via_trigger: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id, "1000.00").await;
        let (status, _) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            movement_body("100.00"),
        )
        .await
        .expect("seed deposit is 201");
        assert_eq!(status, StatusCode::CREATED);
        let (status, _) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            movement_body("-30.00"),
        )
        .await
        .expect("withdrawal is 201");
        assert_eq!(status, StatusCode::CREATED);
        let (saved, _) = goal_state(&pool, goal_id, user_id).await;
        assert_eq!(saved, Decimal::new(7000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn reaching_target_flips_is_completed_via_trigger() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP reaching_target_flips_is_completed_via_trigger: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id, "100.00").await;
        let (status, _) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            movement_body("90.00"),
        )
        .await
        .expect("first deposit is 201");
        assert_eq!(status, StatusCode::CREATED);
        let (_, completed) = goal_state(&pool, goal_id, user_id).await;
        assert!(!completed);
        let (status, _) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            movement_body("10.00"),
        )
        .await
        .expect("completing deposit is 201");
        assert_eq!(status, StatusCode::CREATED);
        let (saved, completed) = goal_state(&pool, goal_id, user_id).await;
        assert_eq!(saved, Decimal::new(10000, 2));
        assert!(completed);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_movement_204_reverses_trigger_balance() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_movement_204_reverses_trigger_balance: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id, "1000.00").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            movement_body("50.00"),
        )
        .await
        .expect("deposit is 201");
        let status = delete_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path((goal_id, created.id)),
        )
        .await
        .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (saved, completed) = goal_state(&pool, goal_id, user_id).await;
        assert_eq!(saved, Decimal::new(0, 2));
        assert!(!completed);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn movement_with_invalid_money_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP movement_with_invalid_money_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id, "1000.00").await;
        for amount in ["abc", "0.00", "10.005"] {
            let err = create_movement_handler(
                State(state.clone()),
                headers.clone(),
                Path(goal_id),
                movement_body(amount),
            )
            .await
            .expect_err("bad movement money must be 422");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn movement_on_missing_goal_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP movement_on_missing_goal_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(Uuid::new_v4()),
            movement_body("10.00"),
        )
        .await
        .expect_err("orphaned goal movement must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn movement_on_foreign_goal_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP movement_on_foreign_goal_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_a, "1000.00").await;
        let err = create_movement_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(goal_id),
            movement_body("10.00"),
        )
        .await
        .expect_err("foreign goal movement must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let err = delete_movement_handler(
            State(state_b.clone()),
            headers_b,
            Path((goal_id, Uuid::new_v4())),
        )
        .await
        .expect_err("foreign goal movement delete must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn movement_with_unowned_transaction_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP movement_with_unowned_transaction_is_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_tx = seed_owned_transaction(&pool, user_a).await;
        let goal_id = seed_goal(&pool, user_b, "1000.00").await;
        let body = Json(
            serde_json::from_value(json!({
                "amount": "10.00",
                "occurred_on": "2026-09-01",
                "transaction_id": foreign_tx
            }))
            .expect("valid body with transaction"),
        );
        let err = create_movement_handler(State(state_b.clone()), headers_b, Path(goal_id), body)
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

    #[tokio::test]
    async fn over_withdrawal_below_zero_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP over_withdrawal_below_zero_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id, "1000.00").await;
        let err = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            movement_body("-10.00"),
        )
        .await
        .expect_err("over-withdrawal must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }
}

#[cfg(test)]
mod patch_goal_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn patch_dto_rejects_trigger_owned_fields() {
        for payload in [
            json!({"name": "Viaje playa"}),
            json!({"target_amount": "2000000.00"}),
        ] {
            assert!(
                serde_json::from_value::<PatchGoalRequest>(payload).is_ok(),
                "allowlisted field must deserialize"
            );
        }
        for payload in [
            json!({"saved_amount": "999.00"}),
            json!({"is_completed": true}),
            json!({"completed_at": "2026-01-01T00:00:00Z"}),
        ] {
            assert!(
                serde_json::from_value::<PatchGoalRequest>(payload.clone()).is_err(),
                "trigger-owned field must fail deserialization: {payload}"
            );
        }
        assert!(serde_json::from_value::<PatchGoalRequest>(json!({"target_amount": "0"})).is_ok());
    }

    #[test]
    fn patch_sql_scopes_by_user_id_and_refreshes_updated_at() {
        assert!(
            PATCH_GOAL_BASE_SQL.contains("updated_at = now()"),
            "patch base must refresh updated_at"
        );
        assert!(
            DELETE_GOAL_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id"
        );
        assert!(
            GET_GOAL_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_GOAL_SQL}"
        );
    }

    #[test]
    fn triangulate_target_amount_zero_is_422_and_trigger_fields_rejected() {
        use axum::response::IntoResponse;
        let err = parse_money_amount("0").unwrap_err();
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        for payload in [
            serde_json::json!({"saved_amount": "5.00"}),
            serde_json::json!({"is_completed": true}),
            serde_json::json!({"completed_at": "2026-01-01T00:00:00Z"}),
        ] {
            assert!(
                serde_json::from_value::<PatchGoalRequest>(payload).is_err(),
                "trigger-owned must be 422 via deny_unknown_fields"
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
        let email = format!("goalpatch-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("goal patch test")
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
    async fn patch_rename_to_existing_name_is_409_and_partial_preserves_saved() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_rename_to_existing_name_is_409_and_partial_preserves_saved: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let a: Uuid = sqlx::query_scalar(
            "INSERT INTO savings_goals (user_id, name, target_amount) VALUES ($1,'A',100) RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed goal A");
        let b: Uuid = sqlx::query_scalar(
            "INSERT INTO savings_goals (user_id, name, target_amount) VALUES ($1,'B',100) RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed goal B");
        // Rename B → A debe ser 409.
        let err = patch_goal_handler(
            State(state.clone()),
            headers.clone(),
            Path(b),
            Json(serde_json::from_value(serde_json::json!({"name": "A"})).unwrap()),
        )
        .await
        .expect_err("duplicate rename must be 409");
        assert_eq!(
            axum::response::IntoResponse::into_response(err).status(),
            axum::http::StatusCode::CONFLICT
        );
        // Abono 50 al goal A vía trigger, luego PATCH parcial preserva saved_amount.
        sqlx::query(
            "INSERT INTO savings_goal_movements (user_id, savings_goal_id, amount, occurred_on) VALUES ($1,$2,50,'2026-09-01')",
        )
        .bind(user_id)
        .bind(a)
        .execute(&pool)
        .await
        .expect("seed movement");
        let patched = patch_goal_handler(
            State(state.clone()),
            headers.clone(),
            Path(a),
            Json(serde_json::from_value(serde_json::json!({"name": "A2"})).unwrap()),
        )
        .await
        .expect("partial rename is 200");
        assert_eq!(patched.name, "A2");
        assert_eq!(
            patched.saved_amount,
            rust_decimal::Decimal::new(5000, 2),
            "partial patch must preserve trigger-owned saved_amount"
        );
        // target_amount "0" → 422.
        let err = patch_goal_handler(
            State(state.clone()),
            headers.clone(),
            Path(a),
            Json(
                serde_json::from_value(serde_json::json!({"target_amount": "0"})).unwrap(),
            ),
        )
        .await
        .expect_err("zero target must be 422");
        assert_eq!(
            axum::response::IntoResponse::into_response(err).status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn patch_foreign_is_404_and_missing_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_foreign_is_404_and_missing_is_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let gid: Uuid = sqlx::query_scalar(
            "INSERT INTO savings_goals (user_id, name, target_amount) VALUES ($1,'Mine',100) RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed goal");
        let err = patch_goal_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(gid),
            Json(serde_json::from_value(serde_json::json!({"name": "X"})).unwrap()),
        )
        .await
        .expect_err("foreign patch must be 404");
        assert_eq!(
            axum::response::IntoResponse::into_response(err).status(),
            axum::http::StatusCode::NOT_FOUND
        );
        // Inexistente puro (nadie lo posee) → 422 por contrato ensure_goal_writable.
        let err = patch_goal_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(Uuid::new_v4()),
            Json(serde_json::from_value(serde_json::json!({"name": "X"})).unwrap()),
        )
        .await
        .expect_err("missing goal patch must be 422");
        assert_eq!(
            axum::response::IntoResponse::into_response(err).status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }
}

#[cfg(test)]
mod jd_save_tests {
    use super::*;
    use rust_decimal::Decimal;

    #[test]
    fn patch_recalc_decides_completion_from_saved_vs_target() {
        // JD-SAVE RED: recálculo saved>=target → completed + preserve-or-now, si no → reopen NULL.
        let now = Utc::now();
        // Completa cuando saved alcanza target, preservando completed_at previo.
        let prev = Some(now);
        let (done, at) = decide_goal_completion(Decimal::new(10000, 2), Decimal::new(10000, 2), prev, now);
        assert!(done);
        assert_eq!(at, prev);
        // Completa con now() cuando no había completed_at.
        let (done, at) = decide_goal_completion(Decimal::new(6000, 2), Decimal::new(5000, 2), None, now);
        assert!(done);
        assert_eq!(at, Some(now));
        // Reabre cuando saved < target.
        let (done, at) = decide_goal_completion(Decimal::new(4000, 2), Decimal::new(5000, 2), prev, now);
        assert!(!done);
        assert_eq!(at, None);
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("goalsave-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("goal save test")
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
    async fn patch_target_recalc_completes_and_reopens_in_same_update() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_target_recalc_completes_and_reopens_in_same_update: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        // Meta target 100, abono 60 vía trigger → saved 60, abierta.
        let goal_id: Uuid = sqlx::query_scalar(
            "INSERT INTO savings_goals (user_id, name, target_amount) VALUES ($1,'JD-SAVE',100) RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed goal");
        sqlx::query(
            "INSERT INTO savings_goal_movements (user_id, savings_goal_id, amount, occurred_on) VALUES ($1,$2,60,'2026-09-01')",
        )
        .bind(user_id)
        .bind(goal_id)
        .execute(&pool)
        .await
        .expect("seed movement");
        // Bajar target a 50 en el mismo UPDATE → saved(60)>=50 → completed + completed_at Some.
        let patched = patch_goal_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            Json(serde_json::from_value(serde_json::json!({"target_amount": "50.00"})).unwrap()),
        )
        .await
        .expect("lower target is 200");
        assert!(patched.is_completed, "saved 60 >= target 50 must complete in same UPDATE");
        assert!(patched.completed_at.is_some(), "completing PATCH must set completed_at via COALESCE(now())");
        assert_eq!(patched.saved_amount, Decimal::new(6000, 2));
        // Subir target a 200 → saved(60)<200 → reabrir con completed_at NULL.
        let patched = patch_goal_handler(
            State(state.clone()),
            headers.clone(),
            Path(goal_id),
            Json(serde_json::from_value(serde_json::json!({"target_amount": "200.00"})).unwrap()),
        )
        .await
        .expect("raise target is 200");
        assert!(!patched.is_completed, "saved 60 < target 200 must reopen in same UPDATE");
        assert!(patched.completed_at.is_none(), "reopening PATCH must clear completed_at to NULL");
        cleanup_user(&pool, user_id).await;
    }
}
