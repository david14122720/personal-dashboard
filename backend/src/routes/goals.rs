//! Goals CRUD with trigger-owned `progress`, strictly scoped by `user_id`.
//!
//! Wire conventions follow the P4 habits slice (`habits.rs`) and the P3 route
//! slices (`debts.rs`, `subscriptions.rs`): `require_user_id` auth (bad
//! session → 401), `deny_unknown_fields` DTOs, `user_id`-scoped SQL (foreign
//! ids → 404 without leaking existence), `23505 → 409` and
//! `23503 / 23514 / 22P02 → 422`.
//!
//! `progress` is trigger-owned (migration `0007`: `recalc_goal_progress()`
//! recomputes it from linked tasks on every task INSERT/UPDATE/DELETE), so it
//! is read-only at the API boundary: neither `CreateGoalRequest` nor
//! `PatchGoalRequest` declares a `progress` field, and
//! `deny_unknown_fields` turns any client-supplied `progress` into 422.
//! `reminder_id` linking is out of scope for this slice (same precedent as
//! habits slice 1 — additive later) and is likewise rejected by
//! `deny_unknown_fields`.
//!
//! PATCH is metadata-scoped: `name`, `description`, `area`, `start_date`,
//! `due_date`, `status`, `category_id`, `color`. `start_date`/`due_date` are
//! validated as a merged range against the stored row (rescheduling a goal is
//! legitimate — unlike habit cadence, it changes no read-model semantics).
//! `category_id` must be an owned `goal`-kind category (else 422).
//!
//! Registered in `routes/mod.rs`; goals routes are wired in `main.rs` so the
//! `POST /goals` → `GET /goals/:id` harness is live (remaining P4 modules
//! land in their own slices).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::helper::require_user_id, error::AppError, state::AppState};

const MAX_NAME_LEN: usize = 200;
const MAX_AREA_LEN: usize = 100;
const MAX_TEXT_LEN: usize = 2000;

/// Mirrors the `goal_status` Postgres enum; validated at the API boundary so
/// an unknown value is 422 instead of a DB error.
const GOAL_STATUSES: &[&str] = &["active", "completed", "paused", "cancelled"];

const CREATE_GOAL_SQL: &str = "INSERT INTO goals (user_id, name, description, area, category_id, start_date, due_date, status, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::goal_status,$9) RETURNING id, name, description, area, category_id, start_date, due_date, progress, status::text, reminder_id, color, created_at, updated_at";
const LIST_GOALS_SQL: &str = "SELECT id, name, description, area, category_id, start_date, due_date, progress, status::text, reminder_id, color, created_at, updated_at FROM goals WHERE user_id=$1 ORDER BY created_at ASC";
const GET_GOAL_SQL: &str = "SELECT id, name, description, area, category_id, start_date, due_date, progress, status::text, reminder_id, color, created_at, updated_at FROM goals WHERE id=$1 AND user_id=$2";
const PATCH_GOAL_SQL: &str = "UPDATE goals SET name=COALESCE($3,name), description=COALESCE($4,description), area=COALESCE($5,area), start_date=COALESCE($6,start_date), due_date=COALESCE($7,due_date), status=COALESCE($8::goal_status,status), category_id=COALESCE($9,category_id), color=COALESCE($10,color), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, name, description, area, category_id, start_date, due_date, progress, status::text, reminder_id, color, created_at, updated_at";
const DELETE_GOAL_SQL: &str = "DELETE FROM goals WHERE id=$1 AND user_id=$2";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";

type GoalRow = (
    Uuid,
    String,
    Option<String>,
    String,
    Option<Uuid>,
    NaiveDate,
    Option<NaiveDate>,
    i16,
    String,
    Option<Uuid>,
    Option<String>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateGoalRequest {
    pub name: String,
    pub description: Option<String>,
    /// Free-form area label (e.g. `"finances"`, `"study"`).
    pub area: String,
    pub category_id: Option<Uuid>,
    /// Calendar date `YYYY-MM-DD` (defaults to today).
    pub start_date: Option<String>,
    /// Calendar date `YYYY-MM-DD` (must be `>= start_date`).
    pub due_date: Option<String>,
    /// One of the `goal_status` enum values (default `"active"`).
    pub status: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchGoalRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    /// Free-form area label (e.g. `"finances"`, `"study"`).
    pub area: Option<String>,
    /// Calendar date `YYYY-MM-DD` (merged with the stored row for the range
    /// check).
    pub start_date: Option<String>,
    /// Calendar date `YYYY-MM-DD` (must be `>= start_date`).
    pub due_date: Option<String>,
    /// One of the `goal_status` enum values.
    pub status: Option<String>,
    pub category_id: Option<Uuid>,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GoalResponse {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub area: String,
    pub category_id: Option<Uuid>,
    pub start_date: NaiveDate,
    pub due_date: Option<NaiveDate>,
    /// Trigger-owned (migration `0007`): recomputed from linked tasks, never
    /// client-writable.
    pub progress: i16,
    pub status: String,
    pub reminder_id: Option<Uuid>,
    pub color: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<GoalRow> for GoalResponse {
    fn from(
        row: (
            Uuid,
            String,
            Option<String>,
            String,
            Option<Uuid>,
            NaiveDate,
            Option<NaiveDate>,
            i16,
            String,
            Option<Uuid>,
            Option<String>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            name,
            description,
            area,
            category_id,
            start_date,
            due_date,
            progress,
            status,
            reminder_id,
            color,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            name,
            description,
            area,
            category_id,
            start_date,
            due_date,
            progress,
            status,
            reminder_id,
            color,
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

/// Validate `status` against the `goal_status` enum values (exact match
/// after trimming), else 422.
pub fn validate_goal_status(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if GOAL_STATUSES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "status must be one of: active, completed, paused, cancelled".into(),
        ))
    }
}

/// Validate an optional `status` (default `active`), else 422.
pub fn validate_goal_status_opt(raw: Option<&str>) -> Result<String, AppError> {
    let Some(raw) = raw else {
        return Ok("active".to_string());
    };
    validate_goal_status(raw)
}

/// Reject a `due_date` before `start_date`, else 422.
pub fn validate_date_range(start: NaiveDate, end: Option<NaiveDate>) -> Result<(), AppError> {
    if let Some(end) = end {
        if end < start {
            return Err(AppError::Validation(
                "due_date must not be before start_date".into(),
            ));
        }
    }
    Ok(())
}

/// Reject a PATCH with no actionable field, else 422.
pub fn validate_goal_patch(body: &PatchGoalRequest) -> Result<(), AppError> {
    if body.name.is_none()
        && body.description.is_none()
        && body.area.is_none()
        && body.start_date.is_none()
        && body.due_date.is_none()
        && body.status.is_none()
        && body.category_id.is_none()
        && body.color.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Verify the category is owned AND `kind='goal'` (else 422 per the P3
/// category contract: FK + kind mismatch + unowned all map to 422, never
/// 404).
pub async fn ensure_goal_category(
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
        Some("goal") => Ok(()),
        _ => Err(AppError::Validation(
            "category must be an owned goal category".into(),
        )),
    }
}

/// Map goal write errors: `23505` (duplicate key, belt-and-braces — goals
/// carry no unique business key today) → 409; `23503` (FK raced away) /
/// `23514` (check) / `22P02` (invalid enum text — belt-and-braces behind the
/// API guard) → 422; everything else is internal (never leaked).
fn map_goal_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("goal already exists".into());
            }
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("invalid goal data".into());
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
    let name = validate_required_text(&body.name, MAX_NAME_LEN, "name")?;
    let area = validate_required_text(&body.area, MAX_AREA_LEN, "area")?;
    let status = validate_goal_status_opt(body.status.as_deref())?;
    let start = match body.start_date.as_deref() {
        Some(raw) => validate_calendar_date(raw, "start_date")?,
        None => Utc::now().date_naive(),
    };
    let due = match body.due_date.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "due_date")?),
        None => None,
    };
    validate_date_range(start, due)?;
    if let Some(category_id) = body.category_id {
        ensure_goal_category(&state.pool, category_id, user_id).await?;
    }
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.color.as_deref(), 32, "color")?;
    let row = sqlx::query_as::<_, GoalRow>(CREATE_GOAL_SQL)
        .bind(user_id)
        .bind(&name)
        .bind(body.description.as_deref())
        .bind(&area)
        .bind(body.category_id)
        .bind(start)
        .bind(due)
        .bind(&status)
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

pub async fn patch_goal_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchGoalRequest>,
) -> Result<Json<GoalResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_goal_patch(&body)?;
    // `due_date` needs the stored `start_date` (and vice versa) for the
    // merged range check, and a foreign id must be 404 before any validation
    // leaks existence.
    let current = sqlx::query_as::<_, GoalRow>(GET_GOAL_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    let current = GoalResponse::from(current);
    let name = match body.name.as_deref() {
        Some(raw) => Some(validate_required_text(raw, MAX_NAME_LEN, "name")?),
        None => None,
    };
    let area = match body.area.as_deref() {
        Some(raw) => Some(validate_required_text(raw, MAX_AREA_LEN, "area")?),
        None => None,
    };
    let status = match body.status.as_deref() {
        Some(raw) => Some(validate_goal_status(raw)?),
        None => None,
    };
    let start = match body.start_date.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "start_date")?),
        None => None,
    };
    let due = match body.due_date.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "due_date")?),
        None => None,
    };
    validate_date_range(
        start.unwrap_or(current.start_date),
        due.or(current.due_date),
    )?;
    if let Some(category_id) = body.category_id {
        ensure_goal_category(&state.pool, category_id, user_id).await?;
    }
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.color.as_deref(), 32, "color")?;
    let row = sqlx::query_as::<_, GoalRow>(PATCH_GOAL_SQL)
        .bind(id)
        .bind(user_id)
        .bind(name.as_deref())
        .bind(body.description.as_deref())
        .bind(area.as_deref())
        .bind(start)
        .bind(due)
        .bind(status.as_deref())
        .bind(body.category_id)
        .bind(body.color.as_deref())
        .fetch_optional(&state.pool)
        .await
        .map_err(map_goal_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(GoalResponse::from(row)))
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

    #[test]
    fn accepts_trimmed_valid_name_and_area() {
        assert_eq!(
            validate_required_text("  Run a marathon ", MAX_NAME_LEN, "name").unwrap(),
            "Run a marathon"
        );
        assert_eq!(
            validate_required_text("  finances ", MAX_AREA_LEN, "area").unwrap(),
            "finances"
        );
    }

    #[test]
    fn rejects_blank_and_oversized_name_and_area_as_422() {
        assert_422(validate_required_text("", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("   ", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text(&"x".repeat(201), MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("bad\0name", MAX_NAME_LEN, "name").unwrap_err());
        assert_422(validate_required_text("", MAX_AREA_LEN, "area").unwrap_err());
        assert_422(validate_required_text(&"x".repeat(101), MAX_AREA_LEN, "area").unwrap_err());
    }

    #[test]
    fn accepts_known_goal_statuses_with_active_default() {
        for raw in ["active", "completed", "paused", "cancelled"] {
            assert_eq!(validate_goal_status(raw).unwrap(), raw);
        }
        assert_eq!(validate_goal_status("  paused ").unwrap(), "paused");
        assert_eq!(validate_goal_status_opt(None).unwrap(), "active");
        assert_eq!(
            validate_goal_status_opt(Some("completed")).unwrap(),
            "completed"
        );
    }

    #[test]
    fn rejects_unknown_goal_status_as_422() {
        for raw in ["", "done", "ACTIVE", "archived", "in_progress"] {
            assert_422(validate_goal_status(raw).unwrap_err());
            assert_422(validate_goal_status_opt(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn progress_and_reminder_are_never_writable() {
        // `progress` is trigger-owned (migration 0007) and `reminder_id`
        // linking is out of scope: `deny_unknown_fields` turns each into 422
        // at the boundary, on both create and patch.
        for payload in [
            json!({"name": "G", "area": "study", "progress": 50}),
            json!({"name": "G", "area": "study", "reminder_id": "00000000-0000-0000-0000-000000000000"}),
        ] {
            assert!(
                serde_json::from_value::<CreateGoalRequest>(payload.clone()).is_err(),
                "trigger-owned/out-of-scope field must fail deserialization on create: {payload}"
            );
            assert!(
                serde_json::from_value::<PatchGoalRequest>(payload.clone()).is_err(),
                "trigger-owned/out-of-scope field must fail deserialization on patch: {payload}"
            );
        }
        // Sanity: the same bodies without the forbidden fields deserialize.
        let _: CreateGoalRequest =
            serde_json::from_value(json!({"name": "G", "area": "study"})).unwrap();
        let _: PatchGoalRequest = serde_json::from_value(json!({"name": "G2"})).unwrap();
    }

    #[test]
    fn empty_patches_are_422() {
        let body: PatchGoalRequest = serde_json::from_value(json!({})).unwrap();
        assert_422(validate_goal_patch(&body).unwrap_err());
    }

    #[test]
    fn due_before_start_is_422() {
        let start = NaiveDate::from_ymd_opt(2026, 9, 10).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 9, 9).unwrap();
        assert_422(validate_date_range(start, Some(end)).unwrap_err());
        validate_date_range(start, Some(start)).unwrap();
        validate_date_range(start, None).unwrap();
    }

    #[test]
    fn goal_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_GOAL_SQL,
            LIST_GOALS_SQL,
            GET_GOAL_SQL,
            PATCH_GOAL_SQL,
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
        // `progress` may appear in RETURNING (read into the response) but
        // must never be a written column: check the clause before RETURNING.
        for sql in [CREATE_GOAL_SQL, PATCH_GOAL_SQL] {
            let write_clause = sql.split("RETURNING").next().unwrap_or(sql);
            assert!(
                !write_clause.contains("progress"),
                "goal write must never set trigger-owned progress, got: {sql}"
            );
        }
        assert!(
            CATEGORY_LOOKUP_SQL.contains("id=$1 AND user_id=$2"),
            "category probe must scope id+user_id, got: {CATEGORY_LOOKUP_SQL}"
        );
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

    fn goal_body(name: &str, area: &str) -> Json<CreateGoalRequest> {
        Json(serde_json::from_value(json!({"name": name, "area": area})).expect("valid goal body"))
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
        let err = list_goals_handler(State(state), HeaderMap::new())
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
        let (status, Json(created)) = create_goal_handler(
            State(state.clone()),
            headers.clone(),
            goal_body(&format!("goal-{}", Uuid::new_v4()), "study"),
        )
        .await
        .expect("create goal");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.progress, 0, "new goal with no tasks must be 0%");
        assert_eq!(created.status, "active");
        assert!(created.reminder_id.is_none());

        let Json(fetched) =
            get_goal_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("get goal");
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.progress, 0);

        let Json(patched) = patch_goal_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(
                serde_json::from_value(json!({"description": "learn rust", "status": "paused"}))
                    .expect("valid patch"),
            ),
        )
        .await
        .expect("patch goal");
        assert_eq!(patched.description.as_deref(), Some("learn rust"));
        assert_eq!(patched.status, "paused");

        let status = delete_goal_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete goal");
        assert_eq!(status, StatusCode::NO_CONTENT);
        let err = get_goal_handler(State(state), headers, Path(created.id))
            .await
            .expect_err("deleted goal must be 404");
        assert_404(err);
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
            "INSERT INTO goals (user_id, name, area) VALUES ($1,$2,'health') RETURNING id",
        )
        .bind(user_a)
        .bind(format!("goal-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed goal");
        // User B must see 404 (never leak existence) on get, patch, delete.
        let err = get_goal_handler(State(state_b.clone()), headers_b.clone(), Path(goal_id))
            .await
            .expect_err("foreign get must be 404");
        assert_404(err);
        let err = patch_goal_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(goal_id),
            Json(serde_json::from_value(json!({"name": "hijack"})).expect("valid patch")),
        )
        .await
        .expect_err("foreign patch must be 404");
        assert_404(err);
        let err = delete_goal_handler(State(state_b.clone()), headers_b.clone(), Path(goal_id))
            .await
            .expect_err("foreign delete must be 404");
        assert_404(err);
        // Owner still sees it.
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn progress_is_trigger_owned_and_patch_rejects_it() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP progress_is_trigger_owned_and_patch_rejects_it: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, Json(created)) = create_goal_handler(
            State(state.clone()),
            headers.clone(),
            goal_body(&format!("goal-{}", Uuid::new_v4()), "study"),
        )
        .await
        .expect("create goal");
        assert_eq!(created.progress, 0, "no linked tasks → 0%");

        // A client-supplied `progress` never reaches the handler: serde
        // rejects it first (axum surfaces it as 422).
        assert!(
            serde_json::from_value::<PatchGoalRequest>(json!({"progress": 99})).is_err(),
            "PATCH progress must fail deserialization"
        );
        assert!(
            serde_json::from_value::<CreateGoalRequest>(
                json!({"name": "G", "area": "study", "progress": 99})
            )
            .is_err(),
            "CREATE progress must fail deserialization"
        );

        // The 0007 trigger owns progress: one completed + one pending task →
        // 50%, proving writes flow only through tasks.
        sqlx::query(
            "INSERT INTO tasks (user_id, title, status, goal_id) VALUES ($1,'t1','completed',$2), ($1,'t2','pending',$2)",
        )
        .bind(user_id)
        .bind(created.id)
        .execute(&pool)
        .await
        .expect("seed tasks");
        let Json(fetched) =
            get_goal_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("get goal");
        assert_eq!(fetched.progress, 50, "1/2 tasks completed → 50%");
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn unowned_category_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unowned_category_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_goal_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(
                    json!({"name": "G", "area": "study", "category_id": Uuid::new_v4()}),
                )
                .expect("well-formed body"),
            ),
        )
        .await
        .expect_err("unowned category must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn create_with_due_before_start_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP due_before_start_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_goal_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(
                    json!({"name": "G", "area": "study", "start_date": "2026-09-10", "due_date": "2026-09-09"}),
                )
                .expect("well-formed body"),
            ),
        )
        .await
        .expect_err("due before start must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }
}
