//! Habits CRUD plus daily logs and an on-demand streak read model, strictly
//! scoped by `user_id`.
//!
//! Wire conventions follow the P3 route slices (`debts.rs`, `subscriptions.rs`):
//! `require_user_id` auth (bad session → 401), `deny_unknown_fields` DTOs,
//! `user_id`-scoped SQL (foreign ids → 404 without leaking existence),
//! `23505 → 409` (duplicate habit name, duplicate log date) and
//! `23503 / 23514 / 22P02 → 422`.
//!
//! Validation rules (spec + design): `direction` is one of
//! `build | maintain | reduce | quit`; `frequency` is one of
//! `daily | weekly | monthly | custom` (default `daily`). The `days_of_week`
//! mask (`0=Sun .. 6=Sat`) must be *consistent* with the frequency: `custom`
//! requires a non-empty mask, every other frequency requires an empty mask
//! (else 422). Log `status` is one of `done | missed | skipped` — the legacy
//! `not_done` value still breaks streaks when read, but is no longer
//! writable. `target_per_period` / `count_value` travel as strings and parse
//! to `NUMERIC(8,2)` (`> 0` / `>= 0`, `scale <= 2`, capped below `10^6`,
//! else 422).
//!
//! PATCH is metadata-scoped (mirroring the subscription lifecycle precedent):
//! `name`, `description`, `target_per_period`, `end_date`, `category_id`,
//! `color`, `icon`, `is_archived`. `direction`, `frequency`, `days_of_week`,
//! and `start_date` are immutable after creation — corrections go through
//! DELETE + recreate, and `deny_unknown_fields` turns them into 422 on PATCH.
//! `category_id` must be an owned `habit`-kind category (else 422).
//! `reminder_id` linking is out of scope for slice 1 (additive later).
//!
//! Streaks are computed on demand with gaps-and-islands SQL over
//! `idx_habit_logs_habit_date`: `done` increments, `skipped` is neutral
//! (bridges gaps without incrementing), `missed`/`not_done` break, masked-out
//! weekdays are ignored, and a missing (unlogged) unmasked day breaks.
//! Deviations from `design.md`, both proven against live PG: the design query
//! fails to parse (`date - bigint` has no operator — `ROW_NUMBER()` is
//! `bigint`) and drops `skipped` rows before the consecutiveness check, which
//! contradicts the Healthy Streak scenario (`[done, skipped, done]` must be
//! 2, the verbatim query returns 1). The query below keeps the design shape
//! and adds a `skipped_after` bridge count plus an `::int` cast.
//!
//! Registered in `routes/mod.rs`; habits routes are wired in `main.rs` so the
//! `POST /habits/:id/logs` → `GET /habits/:id/streak` harness is live
//! (remaining P4 modules land in their own slices).

use axum::{
    extract::{FromRequestParts, Path, Query, State},
    http::{request::Parts, HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id,
    error::AppError,
    finance::money::{parse_money_amount, parse_money_amount_nonneg},
    state::AppState,
};

const MAX_NAME_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;

/// Mirrors the `habit_direction` Postgres enum; validated at the API boundary
/// so an unknown value is 422 instead of a DB error.
const HABIT_DIRECTIONS: &[&str] = &["build", "maintain", "reduce", "quit"];

/// Mirrors the `habit_frequency` Postgres enum.
const HABIT_FREQUENCIES: &[&str] = &["daily", "weekly", "monthly", "custom"];

/// Writable log statuses. The legacy `not_done` value still breaks streaks
/// when read, but is rejected on write (use `missed`).
const HABIT_LOG_STATUSES: &[&str] = &["done", "missed", "skipped"];

/// `NUMERIC(8,2)` ceiling: values `>= 10^6` would overflow the column.
const MAX_PERIOD_VALUE: Decimal = Decimal::from_parts(1_000_000, 0, 0, false, 0);

const CREATE_HABIT_SQL: &str = "INSERT INTO habits (user_id, name, description, direction, frequency, days_of_week, target_per_period, start_date, end_date, category_id, color, icon) VALUES ($1,$2,$3,$4::habit_direction,$5::habit_frequency,$6,$7,$8,$9,$10,$11,$12) RETURNING id, name, description, direction::text, frequency::text, days_of_week, target_per_period, start_date, end_date, category_id, color, icon, is_archived, created_at, updated_at";
const LIST_HABITS_SQL: &str = "SELECT id, name, description, direction::text, frequency::text, days_of_week, target_per_period, start_date, end_date, category_id, color, icon, is_archived, created_at, updated_at FROM habits WHERE user_id=$1 ORDER BY created_at ASC";
const GET_HABIT_SQL: &str = "SELECT id, name, description, direction::text, frequency::text, days_of_week, target_per_period, start_date, end_date, category_id, color, icon, is_archived, created_at, updated_at FROM habits WHERE id=$1 AND user_id=$2";
const PATCH_HABIT_SQL: &str = "UPDATE habits SET name=COALESCE($3,name), description=COALESCE($4,description), target_per_period=COALESCE($5,target_per_period), end_date=COALESCE($6,end_date), category_id=COALESCE($7,category_id), color=COALESCE($8,color), icon=COALESCE($9,icon), is_archived=COALESCE($10,is_archived), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, name, description, direction::text, frequency::text, days_of_week, target_per_period, start_date, end_date, category_id, color, icon, is_archived, created_at, updated_at";
const DELETE_HABIT_SQL: &str = "DELETE FROM habits WHERE id=$1 AND user_id=$2";
const HABIT_OWNERSHIP_SQL: &str = "SELECT id FROM habits WHERE id=$1 AND user_id=$2";
const HABIT_EXISTS_SQL: &str = "SELECT id FROM habits WHERE id=$1";
const HABIT_MASK_SQL: &str = "SELECT days_of_week FROM habits WHERE id=$1 AND user_id=$2";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";
const CREATE_LOG_SQL: &str = "INSERT INTO habit_logs (user_id, habit_id, log_date, status, count_value, notes) VALUES ($1,$2,$3,$4::habit_log_status,$5,$6) RETURNING id, habit_id, log_date, status::text, count_value, notes, created_at, updated_at";
const PATCH_LOG_SQL: &str = "UPDATE habit_logs SET status=COALESCE($4::habit_log_status,status), count_value=COALESCE($5,count_value), notes=COALESCE($6,notes), updated_at=now() WHERE habit_id=$1 AND user_id=$2 AND log_date=$3 RETURNING id, habit_id, log_date, status::text, count_value, notes, created_at, updated_at";

/// On-demand streak (gaps-and-islands with a `skipped` bridge): `$1` habit,
/// `$2` user, `$3` `days_of_week` mask (empty/NULL = every day). See the
/// module docs for why this differs from the `design.md` sketch.
const STREAK_SQL: &str = "WITH logs AS (SELECT log_date, status FROM habit_logs WHERE habit_id=$1 AND user_id=$2 AND (COALESCE(CARDINALITY($3),0)=0 OR EXTRACT(DOW FROM log_date)::int = ANY($3))), nonskip AS (SELECT log_date, status FROM logs WHERE status <> 'skipped'), ordered AS (SELECT log_date, status, ROW_NUMBER() OVER (ORDER BY log_date DESC) AS rn, (SELECT MAX(log_date) FROM logs) AS anchor, (SELECT COUNT(*) FROM logs s WHERE s.status='skipped' AND s.log_date > nonskip.log_date) AS skipped_after FROM nonskip), cut AS (SELECT MIN(rn) AS cut_rn FROM ordered WHERE status IN ('missed','not_done') OR log_date <> anchor - ((rn - 1 + skipped_after)::int)) SELECT COALESCE((SELECT cut_rn FROM cut), (SELECT COUNT(*)+1 FROM ordered)) - 1 AS current_streak";

type HabitRow = (
    Uuid,
    String,
    Option<String>,
    String,
    String,
    Vec<i16>,
    Option<Decimal>,
    NaiveDate,
    Option<NaiveDate>,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    bool,
    DateTime<Utc>,
    DateTime<Utc>,
);

type HabitLogRow = (
    Uuid,
    Uuid,
    NaiveDate,
    String,
    Option<Decimal>,
    Option<String>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateHabitRequest {
    pub name: String,
    pub description: Option<String>,
    /// One of the `habit_direction` enum values (e.g. `"build"`).
    pub direction: String,
    /// One of the `habit_frequency` enum values (default `"daily"`).
    pub frequency: Option<String>,
    /// Weekday mask `0=Sun .. 6=Sat`; required non-empty for `custom`,
    /// must be empty for every other frequency.
    pub days_of_week: Option<Vec<i16>>,
    /// Wire-format decimal string (`> 0`), e.g. `"1.00"`.
    pub target_per_period: Option<String>,
    /// Calendar date `YYYY-MM-DD` (defaults to today).
    pub start_date: Option<String>,
    /// Calendar date `YYYY-MM-DD` (must be `>= start_date`).
    pub end_date: Option<String>,
    pub category_id: Option<Uuid>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchHabitRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    /// Wire-format decimal string (`> 0`), e.g. `"1.00"`.
    pub target_per_period: Option<String>,
    /// Calendar date `YYYY-MM-DD` (must be `>= start_date`).
    pub end_date: Option<String>,
    pub category_id: Option<Uuid>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub is_archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateLogRequest {
    /// Calendar date `YYYY-MM-DD`.
    pub log_date: String,
    /// One of `done | missed | skipped`.
    pub status: String,
    /// Wire-format decimal string (`>= 0`), e.g. `"0.00"`.
    pub count_value: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchLogRequest {
    /// One of `done | missed | skipped`.
    pub status: Option<String>,
    /// Wire-format decimal string (`>= 0`), e.g. `"0.00"`.
    pub count_value: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HabitResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub direction: String,
    pub frequency: String,
    pub days_of_week: Vec<i16>,
    /// Serialized as a string (e.g. `"1.00"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub target_per_period: Option<Decimal>,
    pub start_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub category_id: Option<Uuid>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub is_archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<HabitRow> for HabitResponse {
    fn from(
        row: (
            Uuid,
            String,
            Option<String>,
            String,
            String,
            Vec<i16>,
            Option<Decimal>,
            NaiveDate,
            Option<NaiveDate>,
            Option<Uuid>,
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
            description,
            direction,
            frequency,
            days_of_week,
            target_per_period,
            start_date,
            end_date,
            category_id,
            color,
            icon,
            is_archived,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            name,
            description,
            direction,
            frequency,
            days_of_week,
            target_per_period,
            start_date,
            end_date,
            category_id,
            color,
            icon,
            is_archived,
            created_at,
            updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct HabitLogResponse {
    pub id: Uuid,
    pub habit_id: Uuid,
    pub log_date: NaiveDate,
    pub status: String,
    /// Serialized as a string (e.g. `"0.00"`); serde renders decimals as
    /// strings, never floats.
    pub count_value: Option<Decimal>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<HabitLogRow> for HabitLogResponse {
    fn from(
        row: (
            Uuid,
            Uuid,
            NaiveDate,
            String,
            Option<Decimal>,
            Option<String>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (id, habit_id, log_date, status, count_value, notes, created_at, updated_at) = row;
        Self {
            id,
            habit_id,
            log_date,
            status,
            count_value,
            notes,
            created_at,
            updated_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct StreakResponse {
    pub habit_id: Uuid,
    pub current_streak: i64,
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

/// Validate `direction` against the `habit_direction` enum values (exact
/// match after trimming), else 422.
pub fn validate_direction(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if HABIT_DIRECTIONS.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "direction must be one of: build, maintain, reduce, quit".into(),
        ))
    }
}

/// Validate `frequency` against the `habit_frequency` enum values (exact
/// match after trimming, default `daily`), else 422.
pub fn validate_frequency(raw: Option<&str>) -> Result<String, AppError> {
    let Some(raw) = raw else {
        return Ok("daily".to_string());
    };
    let normalized = raw.trim();
    if HABIT_FREQUENCIES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "frequency must be one of: daily, weekly, monthly, custom".into(),
        ))
    }
}

/// Validate the `days_of_week` mask against the frequency: `custom` requires
/// a non-empty mask of `0..=6`, every other frequency requires an empty mask
/// (else 422). Returns the normalized mask.
pub fn validate_days_mask(frequency: &str, days: Option<&[i16]>) -> Result<Vec<i16>, AppError> {
    let days: &[i16] = days.unwrap_or(&[]);
    if frequency == "custom" {
        if days.is_empty() {
            return Err(AppError::Validation(
                "days_of_week must be non-empty for custom frequency".into(),
            ));
        }
    } else if !days.is_empty() {
        return Err(AppError::Validation(format!(
            "days_of_week must be empty for {frequency} frequency"
        )));
    }
    if days.iter().any(|d| *d < 0 || *d > 6) {
        return Err(AppError::Validation(
            "days_of_week must contain only values 0-6 (0=Sun .. 6=Sat)".into(),
        ));
    }
    let mut mask = days.to_vec();
    mask.sort_unstable();
    mask.dedup();
    Ok(mask)
}

/// Validate a log `status` against the writable values
/// (`done | missed | skipped`), else 422.
pub fn validate_log_status(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if HABIT_LOG_STATUSES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "status must be one of: done, missed, skipped".into(),
        ))
    }
}

/// Parse an optional `target_per_period`: positive decimal (`> 0`,
/// `scale <= 2`) capped below `10^6` for `NUMERIC(8,2)`, else 422.
pub fn validate_target(raw: Option<&str>) -> Result<Option<Decimal>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let value = parse_money_amount(raw)?;
    if value >= MAX_PERIOD_VALUE {
        return Err(AppError::Validation(
            "target_per_period exceeds the maximum storable value".into(),
        ));
    }
    Ok(Some(value))
}

/// Parse an optional `count_value`: non-negative decimal (`>= 0`,
/// `scale <= 2`) capped below `10^6` for `NUMERIC(8,2)`, else 422.
pub fn validate_count(raw: Option<&str>) -> Result<Option<Decimal>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let value = parse_money_amount_nonneg(raw)?;
    if value >= MAX_PERIOD_VALUE {
        return Err(AppError::Validation(
            "count_value exceeds the maximum storable value".into(),
        ));
    }
    Ok(Some(value))
}

/// Reject an `end_date` before `start_date`, else 422.
pub fn validate_date_range(start: NaiveDate, end: Option<NaiveDate>) -> Result<(), AppError> {
    if let Some(end) = end {
        if end < start {
            return Err(AppError::Validation(
                "end_date must not be before start_date".into(),
            ));
        }
    }
    Ok(())
}

/// Parse the `GET /habits/logs?from&to` range bounds (strict `YYYY-MM-DD`,
/// else 422): `from > to` is 422 (`from_after_to`), and ranges wider than
/// 366 days inclusive (`(to - from).num_days() > 365`) are 422
/// (`range_too_wide`). Pure: no I/O, no `PgPool`.
pub fn parse_logs_range(from: &str, to: &str) -> Result<(NaiveDate, NaiveDate), AppError> {
    let from = validate_calendar_date(from, "from")?;
    let to = validate_calendar_date(to, "to")?;
    if from > to {
        return Err(AppError::Validation("from_after_to".into()));
    }
    if (to - from).num_days() > 365 {
        return Err(AppError::Validation("range_too_wide".into()));
    }
    Ok((from, to))
}

/// Reject a PATCH with no actionable field, else 422.
pub fn validate_habit_patch(body: &PatchHabitRequest) -> Result<(), AppError> {
    if body.name.is_none()
        && body.description.is_none()
        && body.target_per_period.is_none()
        && body.end_date.is_none()
        && body.category_id.is_none()
        && body.color.is_none()
        && body.icon.is_none()
        && body.is_archived.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Reject a log PATCH with no actionable field, else 422.
pub fn validate_log_patch(body: &PatchLogRequest) -> Result<(), AppError> {
    if body.status.is_none() && body.count_value.is_none() && body.notes.is_none() {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Verify the category is owned AND `kind='habit'` (else 422 per the P3
/// category contract: FK + kind mismatch + unowned all map to 422, never
/// 404).
pub async fn ensure_habit_category(
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
        Some("habit") => Ok(()),
        _ => Err(AppError::Validation(
            "category must be an owned habit category".into(),
        )),
    }
}

/// Resolve the habit for a log/streak write: owned → Ok; exists for another
/// user → 404 (never leak existence); exists for nobody → 422 (orphaned-habit
/// FK guard, mirroring the debts `ensure_debt_writable` contract).
pub async fn ensure_habit_writable(
    pool: &sqlx::PgPool,
    habit_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(HABIT_OWNERSHIP_SQL)
        .bind(habit_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if owned.is_some() {
        return Ok(());
    }
    let exists: Option<Uuid> = sqlx::query_scalar(HABIT_EXISTS_SQL)
        .bind(habit_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if exists.is_some() {
        return Err(AppError::NotFound);
    }
    Err(AppError::Validation("habit does not exist".into()))
}

/// Map habit write errors: `23505` (duplicate name, duplicate log date) →
/// 409; `23503` (FK raced away) / `23514` (check) / `22P02` (invalid enum
/// text — belt-and-braces behind the API guard) → 422; everything else is
/// internal (never leaked).
fn map_habit_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("habit already exists".into());
            }
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("invalid habit data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_habit_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateHabitRequest>,
) -> Result<(StatusCode, Json<HabitResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_required_text(&body.name, MAX_NAME_LEN, "name")?;
    let direction = validate_direction(&body.direction)?;
    let frequency = validate_frequency(body.frequency.as_deref())?;
    let mask = validate_days_mask(&frequency, body.days_of_week.as_deref())?;
    let target = validate_target(body.target_per_period.as_deref())?;
    let start = match body.start_date.as_deref() {
        Some(raw) => validate_calendar_date(raw, "start_date")?,
        None => Utc::now().date_naive(),
    };
    let end = match body.end_date.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "end_date")?),
        None => None,
    };
    validate_date_range(start, end)?;
    if let Some(category_id) = body.category_id {
        ensure_habit_category(&state.pool, category_id, user_id).await?;
    }
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.color.as_deref(), 32, "color")?;
    validate_optional_text(body.icon.as_deref(), 64, "icon")?;
    let row = sqlx::query_as::<_, HabitRow>(CREATE_HABIT_SQL)
        .bind(user_id)
        .bind(&name)
        .bind(body.description.as_deref())
        .bind(&direction)
        .bind(&frequency)
        .bind(&mask)
        .bind(target)
        .bind(start)
        .bind(end)
        .bind(body.category_id)
        .bind(body.color.as_deref())
        .bind(body.icon.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_habit_db_err)?;
    Ok((StatusCode::CREATED, Json(HabitResponse::from(row))))
}

pub async fn list_habits_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<HabitResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, HabitRow>(LIST_HABITS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(HabitResponse::from).collect()))
}

pub async fn get_habit_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<HabitResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, HabitRow>(GET_HABIT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(HabitResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn patch_habit_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchHabitRequest>,
) -> Result<Json<HabitResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_habit_patch(&body)?;
    // `end_date` needs the immutable `start_date` for the range check, and a
    // foreign id must be 404 before any validation leaks existence.
    let current = sqlx::query_as::<_, HabitRow>(GET_HABIT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    let current = HabitResponse::from(current);
    let name = match body.name.as_deref() {
        Some(raw) => Some(validate_required_text(raw, MAX_NAME_LEN, "name")?),
        None => None,
    };
    let target = validate_target(body.target_per_period.as_deref())?;
    let end = match body.end_date.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "end_date")?),
        None => None,
    };
    validate_date_range(current.start_date, end.or(current.end_date))?;
    if let Some(category_id) = body.category_id {
        ensure_habit_category(&state.pool, category_id, user_id).await?;
    }
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.color.as_deref(), 32, "color")?;
    validate_optional_text(body.icon.as_deref(), 64, "icon")?;
    let row = sqlx::query_as::<_, HabitRow>(PATCH_HABIT_SQL)
        .bind(id)
        .bind(user_id)
        .bind(name.as_deref())
        .bind(body.description.as_deref())
        .bind(target)
        .bind(end)
        .bind(body.category_id)
        .bind(body.color.as_deref())
        .bind(body.icon.as_deref())
        .bind(body.is_archived)
        .fetch_optional(&state.pool)
        .await
        .map_err(map_habit_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(HabitResponse::from(row)))
}

pub async fn delete_habit_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_HABIT_SQL)
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

pub async fn create_log_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(habit_id): Path<Uuid>,
    Json(body): Json<CreateLogRequest>,
) -> Result<(StatusCode, Json<HabitLogResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let log_date = validate_calendar_date(&body.log_date, "log_date")?;
    let status = validate_log_status(&body.status)?;
    let count = validate_count(body.count_value.as_deref())?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    ensure_habit_writable(&state.pool, habit_id, user_id).await?;
    let row = sqlx::query_as::<_, HabitLogRow>(CREATE_LOG_SQL)
        .bind(user_id)
        .bind(habit_id)
        .bind(log_date)
        .bind(&status)
        .bind(count)
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db) = &e {
                if db.code().as_deref() == Some("23505") {
                    return AppError::Conflict("log already exists for this date".into());
                }
            }
            map_habit_db_err(e)
        })?;
    Ok((StatusCode::CREATED, Json(HabitLogResponse::from(row))))
}

pub async fn patch_log_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((habit_id, raw_date)): Path<(Uuid, String)>,
    Json(body): Json<PatchLogRequest>,
) -> Result<Json<HabitLogResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_log_patch(&body)?;
    let log_date = validate_calendar_date(&raw_date, "log_date")?;
    let status = match body.status.as_deref() {
        Some(raw) => Some(validate_log_status(raw)?),
        None => None,
    };
    let count = validate_count(body.count_value.as_deref())?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    ensure_habit_writable(&state.pool, habit_id, user_id).await?;
    let row = sqlx::query_as::<_, HabitLogRow>(PATCH_LOG_SQL)
        .bind(habit_id)
        .bind(user_id)
        .bind(log_date)
        .bind(status.as_deref())
        .bind(count)
        .bind(body.notes.as_deref())
        .fetch_optional(&state.pool)
        .await
        .map_err(map_habit_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(HabitLogResponse::from(row)))
}

pub async fn get_streak_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(habit_id): Path<Uuid>,
) -> Result<Json<StreakResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    // The mask doubles as the ownership probe: foreign ids are 404.
    let mask: Option<Vec<i16>> = sqlx::query_scalar(HABIT_MASK_SQL)
        .bind(habit_id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    let mask = mask.unwrap_or_default();
    let current_streak: i64 = sqlx::query_scalar(STREAK_SQL)
        .bind(habit_id)
        .bind(user_id)
        .bind(&mask)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(StreakResponse {
        habit_id,
        current_streak,
    }))
}

/// Today read: every caller habit with today's log state and its streak in
/// ONE statement. `today_status` comes from a `LEFT JOIN habit_logs ON
/// log_date = CURRENT_DATE` (`done`/`missed`/`skipped` when logged,
/// `pending` when scheduled today with no log, `skipped` on non-scheduled
/// days). `current_streak` reuses the [`STREAK_SQL`] gaps-and-islands shape
/// via `CROSS JOIN LATERAL` (per-habit evaluation, no loop, no N+1); the
/// placeholders are rebound to the outer habit row (`h.id`, `h.user_id`,
/// `h.days_of_week`), keeping the `::int` cast and the `skipped` bridge.
const TODAY_SQL: &str = "SELECT h.id, h.name, h.frequency::text, h.days_of_week, s.current_streak, COALESCE(l.status::text, CASE WHEN (COALESCE(CARDINALITY(h.days_of_week),0)=0 OR EXTRACT(DOW FROM CURRENT_DATE)::int = ANY(h.days_of_week)) THEN 'pending' ELSE 'skipped' END) AS today_status FROM habits h LEFT JOIN habit_logs l ON l.habit_id=h.id AND l.user_id=h.user_id AND l.log_date=CURRENT_DATE CROSS JOIN LATERAL (WITH logs AS (SELECT log_date, status FROM habit_logs WHERE habit_id=h.id AND user_id=h.user_id AND (COALESCE(CARDINALITY(h.days_of_week),0)=0 OR EXTRACT(DOW FROM log_date)::int = ANY(h.days_of_week))), nonskip AS (SELECT log_date, status FROM logs WHERE status <> 'skipped'), ordered AS (SELECT log_date, status, ROW_NUMBER() OVER (ORDER BY log_date DESC) AS rn, (SELECT MAX(log_date) FROM logs) AS anchor, (SELECT COUNT(*) FROM logs skipped_bridge WHERE skipped_bridge.status='skipped' AND skipped_bridge.log_date > nonskip.log_date) AS skipped_after FROM nonskip), cut AS (SELECT MIN(rn) AS cut_rn FROM ordered WHERE status IN ('missed','not_done') OR log_date <> anchor - ((rn - 1 + skipped_after)::int)) SELECT COALESCE((SELECT cut_rn FROM cut), (SELECT COUNT(*)+1 FROM ordered)) - 1 AS current_streak) s WHERE h.user_id=$1 ORDER BY h.created_at ASC";

type HabitTodayRow = (Uuid, String, String, Vec<i16>, i64, String);

#[derive(Debug, Serialize)]
pub struct HabitTodayResponse {
    pub habit_id: Uuid,
    pub name: String,
    pub habit_frequency: String,
    pub days_of_week: Vec<i16>,
    pub current_streak: i64,
    /// `done` | `missed` | `skipped` | `pending` (lowercase, never NULL).
    pub today_status: String,
}

pub async fn today_habits_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<HabitTodayResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, HabitTodayRow>(TODAY_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(
        rows.into_iter()
            .map(
                |(habit_id, name, habit_frequency, days_of_week, current_streak, today_status)| {
                    HabitTodayResponse {
                        habit_id,
                        name,
                        habit_frequency,
                        days_of_week,
                        current_streak,
                        today_status,
                    }
                },
            )
            .collect(),
    ))
}

/// Range-history read (multi-habit, one round-trip): dedicated 3-column
/// SQL — never widens `HabitRow` (15 cols, near the sqlx cap of 16).
/// `idx_habit_logs_user_date (user_id, log_date)` covers the filter;
/// `idx_habit_logs_habit_date` stays on the streak/today path.
const LOGS_RANGE_SQL: &str = "SELECT habit_id, log_date, status::text FROM habit_logs WHERE user_id = $1 AND log_date >= $2 AND log_date <= $3 ORDER BY habit_id ASC, log_date ASC";

type HabitLogRangeRow = (Uuid, NaiveDate, String);

/// `GET /habits/logs` range filter. Unknown query fields are rejected (422) via
/// `deny_unknown_fields` (see `ValidatedQuery`, which remaps axum's 400).
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HabitLogsRangeQuery {
    pub from: String,
    pub to: String,
}

/// Query extractor whose rejection is 422 `VALIDATION_ERROR` instead of axum's
/// default 400: the `Range Logs Read` contract requires 422 for malformed or
/// unknown query fields. Opt-in per handler (`GET /habits/logs`); the global
/// `Query` extractor and every other route stay untouched.
#[derive(Debug)]
pub struct ValidatedQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ValidatedQuery<T>
where
    T: serde::de::DeserializeOwned,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| ValidatedQuery(value))
            .map_err(|rejection| AppError::Validation(format!("invalid query parameters: {rejection}")))
    }
}

#[derive(Debug, Serialize)]
pub struct HabitLogRangeEntry {
    pub habit_id: Uuid,
    pub log_date: NaiveDate,
    pub status: String,
}

pub async fn list_logs_range_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    ValidatedQuery(query): ValidatedQuery<HabitLogsRangeQuery>,
) -> Result<Json<Vec<HabitLogRangeEntry>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let (from, to) = parse_logs_range(&query.from, &query.to)?;
    let rows = sqlx::query_as::<_, HabitLogRangeRow>(LOGS_RANGE_SQL)
        .bind(user_id)
        .bind(from)
        .bind(to)
        .fetch_all(&state.pool)
        .await
        .map_err(map_habit_db_err)?;
    Ok(Json(
        rows.into_iter()
            .map(|(habit_id, log_date, status)| HabitLogRangeEntry {
                habit_id,
                log_date,
                status,
            })
            .collect(),
    ))
}

#[cfg(test)]
mod today_read_tests {
    use super::*;
    use axum::response::IntoResponse;

    fn assert_401(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
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

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("habtoday-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("habit today test")
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

    async fn seed_habit(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        name: &str,
        mask: Option<&[i16]>,
    ) -> Uuid {
        let frequency = if mask.is_some() { "custom" } else { "daily" };
        let days: Vec<i16> = mask.map(|m| m.to_vec()).unwrap_or_default();
        sqlx::query_scalar(
            "INSERT INTO habits (user_id, name, direction, frequency, days_of_week) VALUES ($1,$2,'build',$3::habit_frequency,$4) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .bind(frequency)
        .bind(&days)
        .fetch_one(pool)
        .await
        .expect("seed habit")
    }

    async fn seed_log(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        habit_id: Uuid,
        date: NaiveDate,
        status: &str,
    ) {
        sqlx::query(
            "INSERT INTO habit_logs (user_id, habit_id, log_date, status) VALUES ($1,$2,$3,$4::habit_log_status)",
        )
        .bind(user_id)
        .bind(habit_id)
        .bind(date)
        .bind(status)
        .execute(pool)
        .await
        .expect("seed log");
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    // -- Task 0.7 RED: today read does not exist yet --

    #[test]
    fn today_sql_resolves_status_and_streak_in_one_statement() {
        assert_eq!(TODAY_SQL.matches(';').count(), 0);
        for fragment in [
            "LATERAL",
            "CURRENT_DATE",
            "'pending'",
            "CARDINALITY",
            "user_id",
        ] {
            assert!(
                TODAY_SQL.contains(fragment),
                "today SQL must contain {fragment}"
            );
        }
    }

    #[tokio::test]
    async fn unauthenticated_today_is_401() {
        let err = today_habits_handler(State(lazy_state()), HeaderMap::new())
            .await
            .expect_err("missing session must be 401");
        assert_401(err);
    }

    #[tokio::test]
    async fn today_with_no_habits_is_empty_array() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP today_with_no_habits_is_empty_array: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let body = today_habits_handler(State(state), headers)
            .await
            .expect("empty today is 200")
            .0;
        assert!(body.is_empty());
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn today_returns_mixed_statuses_with_streaks() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP today_returns_mixed_statuses_with_streaks: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let today = Utc::now().date_naive();
        let yesterday = today - chrono::Duration::days(1);
        // A: done yesterday + done today → streak 2, done.
        let habit_a = seed_habit(&pool, user_id, "habit-a", None).await;
        seed_log(&pool, user_id, habit_a, yesterday, "done").await;
        seed_log(&pool, user_id, habit_a, today, "done").await;
        // B: done yesterday + missed today → streak 0, missed.
        let habit_b = seed_habit(&pool, user_id, "habit-b", None).await;
        seed_log(&pool, user_id, habit_b, yesterday, "done").await;
        seed_log(&pool, user_id, habit_b, today, "missed").await;
        // C: scheduled today, no log → streak 0, pending.
        let habit_c = seed_habit(&pool, user_id, "habit-c", None).await;
        let body = today_habits_handler(State(state), headers)
            .await
            .expect("today is 200")
            .0;
        assert_eq!(body.len(), 3);
        let entry = |id: Uuid| body.iter().find(|h| h.habit_id == id).expect("habit present");
        let a = entry(habit_a);
        assert_eq!(a.today_status, "done");
        assert_eq!(a.current_streak, 2);
        assert_eq!(a.habit_frequency, "daily");
        let b = entry(habit_b);
        assert_eq!(b.today_status, "missed");
        assert_eq!(b.current_streak, 0);
        let c = entry(habit_c);
        assert_eq!(c.today_status, "pending");
        assert_eq!(c.current_streak, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn missed_day_breaks_streak_but_today_still_counts() {
        // A missed day must break the chain: done two days ago, missed
        // yesterday, done today → streak 1 (not 3, not 0).
        let Some(pool) = test_pool() else {
            eprintln!("SKIP missed_day_breaks_streak_but_today_still_counts: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let today = Utc::now().date_naive();
        let habit = seed_habit(&pool, user_id, "habit-gap", None).await;
        seed_log(&pool, user_id, habit, today - chrono::Duration::days(2), "done").await;
        seed_log(&pool, user_id, habit, today - chrono::Duration::days(1), "missed").await;
        seed_log(&pool, user_id, habit, today, "done").await;
        let body = today_habits_handler(State(state), headers)
            .await
            .expect("today is 200")
            .0;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0].today_status, "done");
        assert_eq!(body[0].current_streak, 1);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn non_scheduled_day_returns_skipped() {
        // A custom habit scheduled on a weekday other than today, with no log,
        // resolves to skipped (never pending).
        let Some(pool) = test_pool() else {
            eprintln!("SKIP non_scheduled_day_returns_skipped: no DATABASE_URL");
            return;
        };
        use chrono::Datelike;
        let (state, headers, user_id) = db_state(&pool).await;
        let today_dow = Utc::now().date_naive().weekday().num_days_from_sunday() as i16;
        let other_dow = (today_dow + 1) % 7;
        let habit = seed_habit(&pool, user_id, "habit-custom", Some(&[other_dow])).await;
        let body = today_habits_handler(State(state), headers)
            .await
            .expect("today is 200")
            .0;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0].today_status, "skipped");
        let _ = habit;
        cleanup_user(&pool, user_id).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;
    use serde_json::json;

    fn assert_401(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    fn assert_404(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::NOT_FOUND);
    }

    fn assert_409(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::CONFLICT);
    }

    #[test]
    fn accepts_trimmed_valid_name() {
        assert_eq!(
            validate_required_text("  Morning Run ", MAX_NAME_LEN, "name").unwrap(),
            "Morning Run"
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
    fn accepts_known_directions_and_frequencies() {
        for raw in ["build", "maintain", "reduce", "quit"] {
            assert_eq!(validate_direction(raw).unwrap(), raw);
        }
        assert_eq!(validate_direction("  build ").unwrap(), "build");
        for raw in ["daily", "weekly", "monthly", "custom"] {
            assert_eq!(validate_frequency(Some(raw)).unwrap(), raw);
        }
        assert_eq!(validate_frequency(None).unwrap(), "daily");
    }

    #[test]
    fn rejects_unknown_direction_frequency_status_as_422() {
        for raw in ["", "sometimes", "BUILD", "everyday"] {
            assert_422(validate_direction(raw).unwrap_err());
            assert_422(validate_frequency(Some(raw)).unwrap_err());
        }
        for raw in ["", "not_done", "DONE", "completed"] {
            assert_422(validate_log_status(raw).unwrap_err());
        }
    }

    #[test]
    fn accepts_writable_log_statuses() {
        for raw in ["done", "missed", "skipped"] {
            assert_eq!(validate_log_status(raw).unwrap(), raw);
        }
    }

    #[test]
    fn custom_requires_non_empty_mask_others_require_empty_as_422() {
        assert_eq!(
            validate_days_mask("custom", Some(&[1, 3, 5])).unwrap(),
            vec![1, 3, 5]
        );
        assert_422(validate_days_mask("custom", None).unwrap_err());
        assert_422(validate_days_mask("custom", Some(&[])).unwrap_err());
        for freq in ["daily", "weekly", "monthly"] {
            assert_eq!(validate_days_mask(freq, None).unwrap(), Vec::<i16>::new());
            assert_eq!(
                validate_days_mask(freq, Some(&[])).unwrap(),
                Vec::<i16>::new()
            );
            assert_422(validate_days_mask(freq, Some(&[1])).unwrap_err());
        }
    }

    #[test]
    fn rejects_out_of_range_weekdays_as_422() {
        for days in [vec![-1], vec![7], vec![0, 8], vec![100]] {
            assert_422(validate_days_mask("custom", Some(&days)).unwrap_err());
        }
    }

    #[test]
    fn target_must_be_positive_and_count_non_negative_as_422() {
        assert_eq!(
            validate_target(Some("1.00")).unwrap(),
            Some(Decimal::new(100, 2))
        );
        assert_eq!(validate_target(None).unwrap(), None);
        for raw in ["abc", "", "0.00", "0", "-1.00", "1.005", "1000000"] {
            assert_422(validate_target(Some(raw)).unwrap_err());
        }
        assert_eq!(validate_count(Some("0.00")).unwrap(), Some(Decimal::ZERO));
        assert_eq!(validate_count(None).unwrap(), None);
        for raw in ["abc", "", "-0.01", "1.005", "1000000"] {
            assert_422(validate_count(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn amounts_must_arrive_as_strings_not_json_numbers() {
        // Decimals travel as strings to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({"name": "H", "direction": "build", "target_per_period": 1.5});
        assert!(
            serde_json::from_value::<CreateHabitRequest>(payload).is_err(),
            "numeric target_per_period must fail deserialization"
        );
        let payload = json!({"log_date": "2026-09-02", "status": "done", "count_value": 2});
        assert!(
            serde_json::from_value::<CreateLogRequest>(payload).is_err(),
            "numeric count_value must fail deserialization"
        );
    }

    #[test]
    fn immutable_and_trigger_owned_fields_are_never_writable() {
        // `direction`, `frequency`, `days_of_week`, `start_date` are immutable
        // after creation, and `is_archived` is PATCH-only: `deny_unknown_fields`
        // turns each misplaced field into 422 at the boundary.
        let payload = json!({"name": "H", "direction": "build", "is_archived": true});
        assert!(
            serde_json::from_value::<CreateHabitRequest>(payload).is_err(),
            "is_archived must fail deserialization on create"
        );
        for payload in [
            json!({"name": "H2", "direction": "quit"}),
            json!({"name": "H2", "frequency": "weekly"}),
            json!({"name": "H2", "days_of_week": [1]}),
            json!({"name": "H2", "start_date": "2026-09-01"}),
        ] {
            assert!(
                serde_json::from_value::<PatchHabitRequest>(payload.clone()).is_err(),
                "immutable field must fail deserialization on patch: {payload}"
            );
        }
    }

    #[test]
    fn empty_patches_are_422() {
        let body: PatchHabitRequest = serde_json::from_value(json!({})).unwrap();
        assert_422(validate_habit_patch(&body).unwrap_err());
        let body: PatchLogRequest = serde_json::from_value(json!({})).unwrap();
        assert_422(validate_log_patch(&body).unwrap_err());
    }

    #[test]
    fn end_before_start_is_422() {
        let start = NaiveDate::from_ymd_opt(2026, 9, 10).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 9, 9).unwrap();
        assert_422(validate_date_range(start, Some(end)).unwrap_err());
        validate_date_range(start, Some(start)).unwrap();
        validate_date_range(start, None).unwrap();
    }

    #[test]
    fn habit_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_HABIT_SQL,
            LIST_HABITS_SQL,
            GET_HABIT_SQL,
            PATCH_HABIT_SQL,
            DELETE_HABIT_SQL,
            HABIT_MASK_SQL,
            CREATE_LOG_SQL,
            PATCH_LOG_SQL,
            STREAK_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "habit SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_HABIT_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_HABIT_SQL}"
        );
        assert!(
            DELETE_HABIT_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_HABIT_SQL}"
        );
        assert!(
            HABIT_EXISTS_SQL.contains("FROM habits WHERE id=$1"),
            "orphaned-habit probe must be unscoped, got: {HABIT_EXISTS_SQL}"
        );
    }

    #[test]
    fn streak_sql_encodes_the_read_model_contract() {
        // Gaps-and-islands with a skipped bridge: both breaking values, the
        // neutral value, the mask gate, and the consecutive-day arithmetic.
        // (Index usage is planner-level; task 2.4 proves it with EXPLAIN.)
        for marker in [
            "'missed'",
            "'not_done'",
            "'skipped'",
            "CARDINALITY($3)",
            "skipped_after",
            "ROW_NUMBER() OVER (ORDER BY log_date DESC)",
        ] {
            assert!(
                STREAK_SQL.contains(marker),
                "streak SQL must encode {marker}"
            );
        }
    }

    fn lazy_pool() -> sqlx::PgPool {
        sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
            .expect("lazy pool construction must succeed")
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("habit-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("habit test")
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

    fn habit_body(name: &str) -> Json<CreateHabitRequest> {
        Json(
            serde_json::from_value(json!({"name": name, "direction": "build"}))
                .expect("valid habit body"),
        )
    }

    fn log_body(date: &str, status: &str) -> Json<CreateLogRequest> {
        Json(
            serde_json::from_value(json!({"log_date": date, "status": status}))
                .expect("valid log body"),
        )
    }

    async fn seed_habit(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO habits (user_id, name, direction) VALUES ($1,$2,'build') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("habit-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed habit")
    }

    async fn seed_log(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        habit_id: Uuid,
        date: &str,
        status: &str,
    ) {
        sqlx::query(
            "INSERT INTO habit_logs (user_id, habit_id, log_date, status) VALUES ($1,$2,$3,$4::habit_log_status)",
        )
        .bind(user_id)
        .bind(habit_id)
        .bind(date.parse::<NaiveDate>().expect("valid probe date"))
        .bind(status)
        .execute(pool)
        .await
        .expect("seed log");
    }

    #[tokio::test]
    async fn missing_session_is_401_without_touching_the_db() {
        // Lazy pool never connects: auth fails before any query.
        let pool = lazy_pool();
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: std::sync::Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
        };
        let err = list_habits_handler(State(state), HeaderMap::new())
            .await
            .expect_err("missing session must be 401");
        assert_401(err);
    }

    #[tokio::test]
    async fn create_201_get_200_patch_200_delete_204() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_201_get_200_patch_200_delete_204: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) = create_habit_handler(
            State(state.clone()),
            headers.clone(),
            habit_body("Morning Run"),
        )
        .await
        .expect("create habit is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.name, "Morning Run");
        assert_eq!(created.direction, "build");
        assert_eq!(created.frequency, "daily");
        assert!(!created.is_archived);
        let got = get_habit_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("get own habit is 200");
        assert_eq!(got.id, created.id);
        let listed = list_habits_handler(State(state.clone()), headers.clone())
            .await
            .expect("list habits is 200");
        assert!(listed.iter().any(|h| h.id == created.id));
        let patched = patch_habit_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(
                serde_json::from_value(json!({"description": "5k loop", "is_archived": true}))
                    .expect("valid patch body"),
            ),
        )
        .await
        .expect("patch own habit is 200");
        assert_eq!(patched.description.as_deref(), Some("5k loop"));
        assert!(patched.is_archived);
        let status = delete_habit_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_habit_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_habit_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let habit_id = seed_habit(&pool, user_a).await;
        let err = get_habit_handler(State(state_b.clone()), headers_b.clone(), Path(habit_id))
            .await
            .expect_err("foreign habit get must be 404");
        assert_404(err);
        let err = patch_habit_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(habit_id),
            Json(serde_json::from_value(json!({"color": "red"})).expect("valid patch")),
        )
        .await
        .expect_err("foreign habit patch must be 404");
        assert_404(err);
        let err = delete_habit_handler(State(state_b.clone()), headers_b.clone(), Path(habit_id))
            .await
            .expect_err("foreign habit delete must be 404");
        assert_404(err);
        let err = create_log_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(habit_id),
            log_body("2026-09-02", "done"),
        )
        .await
        .expect_err("foreign habit log must be 404");
        assert_404(err);
        let err = get_streak_handler(State(state_b.clone()), headers_b, Path(habit_id))
            .await
            .expect_err("foreign habit streak must be 404");
        assert_404(err);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn duplicate_habit_name_is_409() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP duplicate_habit_name_is_409: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, _) = create_habit_handler(
            State(state.clone()),
            headers.clone(),
            habit_body("Same Name"),
        )
        .await
        .expect("first create is 201");
        assert_eq!(status, StatusCode::CREATED);
        let err = create_habit_handler(
            State(state.clone()),
            headers.clone(),
            habit_body("Same Name"),
        )
        .await
        .expect_err("duplicate habit name must be 409");
        assert_409(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn unowned_category_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unowned_category_is_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_cat: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'habit','Mine') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed category");
        let wrong_kind: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Spend') RETURNING id",
        )
        .bind(user_b)
        .fetch_one(&pool)
        .await
        .expect("seed category");
        for cat in [foreign_cat, wrong_kind] {
            let body = Json(
                serde_json::from_value::<CreateHabitRequest>(json!({
                    "name": format!("cat-{}", Uuid::new_v4()),
                    "direction": "build",
                    "category_id": cat
                }))
                .expect("valid body with category"),
            );
            let err = create_habit_handler(State(state_b.clone()), headers_b.clone(), body)
                .await
                .expect_err("bad category must be 422");
            assert_422(err);
        }
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn log_201_dup_409_patch_200_patch_missing_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP log_201_dup_409_patch_200_patch_missing_404: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let habit_id = seed_habit(&pool, user_id).await;
        let (status, created) = create_log_handler(
            State(state.clone()),
            headers.clone(),
            Path(habit_id),
            log_body("2026-09-02", "done"),
        )
        .await
        .expect("log create is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.habit_id, habit_id);
        assert_eq!(created.status, "done");
        let err = create_log_handler(
            State(state.clone()),
            headers.clone(),
            Path(habit_id),
            log_body("2026-09-02", "done"),
        )
        .await
        .expect_err("duplicate log date must be 409");
        assert_409(err);
        let patched = patch_log_handler(
            State(state.clone()),
            headers.clone(),
            Path((habit_id, "2026-09-02".to_string())),
            Json(
                serde_json::from_value(json!({"status": "missed", "notes": "sick"}))
                    .expect("valid log patch"),
            ),
        )
        .await
        .expect("log patch is 200");
        assert_eq!(patched.status, "missed");
        assert_eq!(patched.notes.as_deref(), Some("sick"));
        let err = patch_log_handler(
            State(state.clone()),
            headers.clone(),
            Path((habit_id, "2026-09-03".to_string())),
            Json(serde_json::from_value(json!({"status": "done"})).expect("valid log patch")),
        )
        .await
        .expect_err("patch on missing log date must be 404");
        assert_404(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn log_on_missing_habit_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP log_on_missing_habit_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_log_handler(
            State(state.clone()),
            headers.clone(),
            Path(Uuid::new_v4()),
            log_body("2026-09-02", "done"),
        )
        .await
        .expect_err("orphaned habit log must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn streak_healthy_counts_done_across_skipped() {
        // Spec scenario: [Day 1: done, Day 2: skipped, Day 3: done] → 2.
        // Fixed Wed-Fri dates keep the unmasked habit off weekend edges.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP streak_healthy_counts_done_across_skipped: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let habit_id = seed_habit(&pool, user_id).await;
        seed_log(&pool, user_id, habit_id, "2026-09-02", "done").await;
        seed_log(&pool, user_id, habit_id, "2026-09-03", "skipped").await;
        seed_log(&pool, user_id, habit_id, "2026-09-04", "done").await;
        let streak = get_streak_handler(State(state.clone()), headers.clone(), Path(habit_id))
            .await
            .expect("streak is 200");
        assert_eq!(streak.current_streak, 2);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn streak_breaks_on_missed_and_not_done() {
        // Spec scenario: [done, missed, done] → 1; legacy `not_done` breaks too.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP streak_breaks_on_missed_and_not_done: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        for breaker in ["missed", "not_done"] {
            let habit_id = seed_habit(&pool, user_id).await;
            seed_log(&pool, user_id, habit_id, "2026-09-02", "done").await;
            seed_log(&pool, user_id, habit_id, "2026-09-03", breaker).await;
            seed_log(&pool, user_id, habit_id, "2026-09-04", "done").await;
            let streak = get_streak_handler(State(state.clone()), headers.clone(), Path(habit_id))
                .await
                .expect("streak is 200");
            assert_eq!(streak.current_streak, 1, "breaker: {breaker}");
        }
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn streak_ignores_masked_days() {
        // Spec scenario: a weekday-masked habit ignores the Saturday entry —
        // the same Fri/Sat/Sun done-logs streak 3 unmasked but 1 masked.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP streak_ignores_masked_days: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let mask_seed = vec![1i16, 2, 3, 4, 5];
        let masked_id: Uuid = sqlx::query_scalar(
            "INSERT INTO habits (user_id, name, direction, frequency, days_of_week) VALUES ($1,$2,'build','custom',$3) RETURNING id",
        )
        .bind(user_id)
        .bind(format!("masked-{}", Uuid::new_v4()))
        .bind(&mask_seed)
        .fetch_one(&pool)
        .await
        .expect("seed masked habit");
        let plain_id = seed_habit(&pool, user_id).await;
        for habit_id in [masked_id, plain_id] {
            for date in ["2026-09-04", "2026-09-05", "2026-09-06"] {
                seed_log(&pool, user_id, habit_id, date, "done").await;
            }
        }
        let masked = get_streak_handler(State(state.clone()), headers.clone(), Path(masked_id))
            .await
            .expect("masked streak is 200");
        assert_eq!(masked.current_streak, 1);
        let plain = get_streak_handler(State(state.clone()), headers.clone(), Path(plain_id))
            .await
            .expect("plain streak is 200");
        assert_eq!(plain.current_streak, 3);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn streak_without_logs_is_zero() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP streak_without_logs_is_zero: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let habit_id = seed_habit(&pool, user_id).await;
        let streak = get_streak_handler(State(state.clone()), headers.clone(), Path(habit_id))
            .await
            .expect("streak is 200");
        assert_eq!(streak.current_streak, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn streak_query_uses_the_habit_date_index() {
        // Task 2.4: EXPLAIN (ANALYZE, BUFFERS) proof that the on-demand read
        // model rides `idx_habit_logs_habit_date`. The planner only prefers
        // the index at realistic volume (a near-empty table seq-scans
        // legitimately), so seed decoy habits first — two set-generating
        // INSERTs, then ANALYZE so the stats reflect the volume.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP streak_query_uses_the_habit_date_index: no DATABASE_URL");
            return;
        };
        let (state, _, user_id) = db_state(&pool).await;
        let habit_id = seed_habit(&pool, user_id).await;
        seed_log(&pool, user_id, habit_id, "2026-09-04", "done").await;
        sqlx::query(
            "INSERT INTO habits (user_id, name, direction) SELECT $1, 'decoy-' || g, 'build' FROM generate_series(1,200) g",
        )
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("seed decoy habits");
        sqlx::query(
            "INSERT INTO habit_logs (user_id, habit_id, log_date, status) SELECT h.user_id, h.id, CURRENT_DATE - (g || ' days')::interval, 'done' FROM habits h CROSS JOIN generate_series(0,49) g WHERE h.user_id=$1 AND h.name LIKE 'decoy-%'",
        )
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("seed decoy logs");
        sqlx::query("ANALYZE habit_logs")
            .execute(&pool)
            .await
            .expect("analyze habit_logs");
        let mask: Vec<i16> = vec![];
        let plan_rows: Vec<(String,)> =
            sqlx::query_as(sqlx::AssertSqlSafe(format!("EXPLAIN (ANALYZE, BUFFERS) {STREAK_SQL}")))
                .bind(habit_id)
                .bind(user_id)
                .bind(&mask)
                .fetch_all(&state.pool)
                .await
                .expect("explain streak executes");
        let plan = plan_rows
            .iter()
            .map(|(line,)| line.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        eprintln!("streak plan:\n{plan}");
        assert!(
            plan.contains("idx_habit_logs_habit_date"),
            "streak must use idx_habit_logs_habit_date, got:\n{plan}"
        );
        assert!(
            !plan.contains("Seq Scan on habit_logs"),
            "streak must not sequential-scan habit_logs, got:\n{plan}"
        );
        cleanup_user(&pool, user_id).await;
    }
}

#[cfg(test)]
mod logs_range_tests {
    use super::*;
    use axum::response::IntoResponse;

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn parse_logs_range_acepta_rango_valido() {
        let (from, to) = parse_logs_range("2026-09-01", "2026-09-30").expect("rango valido es Ok");
        assert_eq!(from, NaiveDate::from_ymd_opt(2026, 9, 1).unwrap());
        assert_eq!(to, NaiveDate::from_ymd_opt(2026, 9, 30).unwrap());
    }

    #[test]
    fn parse_logs_range_rechaza_formato() {
        for (from, to) in [
            ("2026-13-40", "2026-09-30"),
            ("not-a-date", "2026-09-30"),
            ("2026-09-01", "2026-02-30"),
            ("09/01/2026", "2026-09-30"),
        ] {
            assert_422(parse_logs_range(from, to).unwrap_err());
        }
    }

    #[test]
    fn parse_logs_range_rechaza_from_after_to() {
        assert_422(parse_logs_range("2026-09-30", "2026-09-01").unwrap_err());
    }

    #[test]
    fn parse_logs_range_rechaza_mas_de_366_dias() {
        // 366 dias inclusivos (diff 365) ok; 367 (diff 366) err.
        parse_logs_range("2026-01-01", "2027-01-01").expect("366 dias es Ok");
        assert_422(parse_logs_range("2026-01-01", "2027-01-02").unwrap_err());
    }

    #[test]
    fn parse_logs_range_acepta_rango_de_un_dia() {
        let (from, to) = parse_logs_range("2026-09-01", "2026-09-01").expect("mismo dia es Ok");
        assert_eq!(from, to);
    }

    #[test]
    fn parse_logs_range_acepta_bisiesto_y_rechaza_feb29_invalido() {
        let (from, to) = parse_logs_range("2024-02-28", "2024-03-01").expect("bisiesto es Ok");
        assert_eq!((to - from).num_days(), 2);
        parse_logs_range("2024-02-29", "2024-02-29").expect("2024-02-29 existe");
        assert!(parse_logs_range("2023-02-29", "2023-03-01").is_err());
    }

    #[test]
    fn range_query_rechaza_unknown_fields_con_422() {
        let payload = serde_json::json!({
            "from": "2026-09-01",
            "to": "2026-09-30",
            "habit_id": "00000000-0000-0000-0000-000000000000",
        });
        assert!(
            serde_json::from_value::<HabitLogsRangeQuery>(payload).is_err(),
            "unknown field must fail deserialization (axum surfaces it as 422)"
        );
        let ok: HabitLogsRangeQuery = serde_json::from_value(serde_json::json!({
            "from": "2026-09-01",
            "to": "2026-09-30",
        }))
        .expect("from+to deserializa");
        assert_eq!(ok.from, "2026-09-01");
    }

    fn range_query(from: &str, to: &str) -> ValidatedQuery<HabitLogsRangeQuery> {
        ValidatedQuery(HabitLogsRangeQuery {
            from: from.to_string(),
            to: to.to_string(),
        })
    }

    async fn range_db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("habrange-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("habit range test")
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

    #[tokio::test]
    async fn range_devuelve_solo_propios_en_rango_ordenados_y_not_done_tal_cual() {
        let Some(url) = std::env::var("DATABASE_URL").ok() else {
            eprintln!("SKIP range_devuelve_solo_propios_en_rango_ordenados_y_not_done_tal_cual: no DATABASE_URL");
            return;
        };
        let pool = sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL");
        let (state, headers, user_id) = range_db_state(&pool).await;
        let other: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(format!("habrange-other-{}@example.com", Uuid::new_v4()))
        .bind("not-a-real-hash")
        .bind("other user")
        .fetch_one(&pool)
        .await
        .expect("seed other user");
        let habit_a: Uuid = sqlx::query_scalar(
            "INSERT INTO habits (user_id, name, direction) VALUES ($1,'range-a','build') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed habit a");
        let habit_b: Uuid = sqlx::query_scalar(
            "INSERT INTO habits (user_id, name, direction) VALUES ($1,'range-b','build') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed habit b");
        let foreign: Uuid = sqlx::query_scalar(
            "INSERT INTO habits (user_id, name, direction) VALUES ($1,'range-foreign','build') RETURNING id",
        )
        .bind(other)
        .fetch_one(&pool)
        .await
        .expect("seed foreign habit");
        for (hid, uid, date, status) in [
            (habit_a, user_id, "2026-09-01", "done"),
            (habit_a, user_id, "2026-09-03", "missed"),
            (habit_a, user_id, "2026-09-05", "not_done"),
            (habit_b, user_id, "2026-09-02", "skipped"),
            // Fuera de rango: no deben aparecer.
            (habit_a, user_id, "2026-08-31", "done"),
            (habit_b, user_id, "2026-10-01", "done"),
            // Otro usuario en rango: invisible.
            (foreign, other, "2026-09-02", "done"),
        ] {
            sqlx::query(
                "INSERT INTO habit_logs (user_id, habit_id, log_date, status) VALUES ($1,$2,$3,$4::habit_log_status)",
            )
            .bind(uid)
            .bind(hid)
            .bind(date.parse::<NaiveDate>().expect("probe date"))
            .bind(status)
            .execute(&pool)
            .await
            .expect("seed log");
        }
        let body = list_logs_range_handler(
            State(state),
            headers,
            range_query("2026-09-01", "2026-09-30"),
        )
        .await
        .expect("range es 200")
        .0;
        assert_eq!(body.len(), 4);
        let keys: Vec<(Uuid, NaiveDate)> =
            body.iter().map(|e| (e.habit_id, e.log_date)).collect();
        assert_eq!(keys, {
            let mut sorted = keys.clone();
            sorted.sort();
            sorted
        });
        let legacy = body
            .iter()
            .find(|e| e.habit_id == habit_a && e.log_date == NaiveDate::from_ymd_opt(2026, 9, 5).unwrap())
            .expect("legacy not_done presente");
        assert_eq!(legacy.status, "not_done");
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(&pool)
            .await
            .expect("cleanup user");
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(other)
            .execute(&pool)
            .await
            .expect("cleanup other");
    }

    #[tokio::test]
    async fn range_sin_sesion_es_401() {
        let pool = sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
            .expect("lazy pool construction must succeed");
        let state = AppState {
            pool,
            session_ttl_hours: 24,
            rate_limiter: std::sync::Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
        };
        let err = list_logs_range_handler(State(state), HeaderMap::new(), range_query("2026-09-01", "2026-09-30"))
            .await
            .expect_err("sin sesion es 401");
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn logs_range_sql_filtra_por_usuario_y_rango_y_ordena() {
        for fragment in [
            "user_id = $1",
            "log_date >= $2",
            "log_date <= $3",
            "ORDER BY habit_id",
        ] {
            assert!(
                LOGS_RANGE_SQL.contains(fragment),
                "range SQL must contain {fragment}"
            );
        }
        assert!(
            !LOGS_RANGE_SQL.contains("SELECT *"),
            "range SQL must not use SELECT *"
        );
        assert!(
            !LOGS_RANGE_SQL.contains("HabitRow"),
            "range SQL must not mention HabitRow"
        );
    }

    fn query_parts(uri: &str) -> Parts {
        axum::http::Request::builder()
            .uri(uri)
            .body(())
            .expect("request builds")
            .into_parts()
            .0
    }

    #[tokio::test]
    async fn validated_query_acepta_from_y_to() {
        let mut parts = query_parts("/habits/logs?from=2026-09-01&to=2026-09-30");
        let ValidatedQuery(query) = ValidatedQuery::<HabitLogsRangeQuery>::from_request_parts(&mut parts, &())
            .await
            .expect("from+to validos pasan la extraccion");
        assert_eq!(query.from, "2026-09-01");
        assert_eq!(query.to, "2026-09-30");
    }

    #[tokio::test]
    async fn validated_query_mapea_unknown_field_a_422() {
        let mut parts = query_parts("/habits/logs?from=2026-09-01&to=2026-09-30&unknown=1");
        let err = ValidatedQuery::<HabitLogsRangeQuery>::from_request_parts(&mut parts, &())
            .await
            .expect_err("unknown field debe rechazarse");
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = axum::body::to_bytes(resp.into_body(), 8192).await.expect("body legible");
        let json: serde_json::Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
    }

    #[tokio::test]
    async fn validated_query_mapea_falta_de_parametros_a_422() {
        let mut parts = query_parts("/habits/logs?from=2026-09-01");
        let err = ValidatedQuery::<HabitLogsRangeQuery>::from_request_parts(&mut parts, &())
            .await
            .expect_err("to es requerido");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    /// Router real (`main::build_router`) con pool lazy: la query invalida se
    /// rechaza antes del handler (422), no como 401 ni 400.
    #[tokio::test]
    async fn router_rechaza_unknown_query_field_con_422() {
        use std::sync::Arc;
        use tower::ServiceExt;

        let state = AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused").expect("lazy pool"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
        };
        let app = crate::build_router(state, None);
        let res = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/api/habits/logs?from=2026-09-01&to=2026-09-30&unknown=1")
                    .body(axum::body::Body::empty())
                    .expect("request"),
            )
            .await
            .expect("router responds");
        assert_eq!(res.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }
}
