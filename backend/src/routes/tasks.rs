//! Tasks CRUD with status-based views, strictly scoped by `user_id`.
//!
//! Wire conventions follow the P4 habits/goals slices (`habits.rs`,
//! `goals.rs`) and the P3 route slices (`debts.rs`, `subscriptions.rs`):
//! `require_user_id` auth (bad session → 401), `deny_unknown_fields` DTOs,
//! `user_id`-scoped SQL (foreign ids → 404 without leaking existence),
//! `23505 → 409` and `23503 / 23514 / 22P02 → 422`.
//!
//! `completed_at` is trigger-owned (migration `0004`: `set_task_completed_at()`
//! on UPDATE; migration `0007`: same function on INSERT), so it is read-only
//! at the API boundary: neither `CreateTaskRequest` nor `PatchTaskRequest`
//! declares a `completed_at` field, and `deny_unknown_fields` turns any
//! client-supplied `completed_at` into 422. `reminder_id` linking is out of
//! scope for this slice (same precedent as habits/goals slices — additive
//! later) and is likewise rejected by `deny_unknown_fields`.
//!
//! Goal linking: `goal_id` is optional. An owned goal links with 201; a goal
//! owned by another user → 404 (never leak existence); a nonexistent goal →
//! 422 (orphaned-FK guard, mirroring the habits `ensure_habit_writable`
//! contract). `category_id` must be an owned `task`-kind category (else 422
//! per the P3 category contract).
//!
//! Views (`GET /tasks?view=`): `today` (`due_date = $2 AND
//! `completed_at IS NULL`), `upcoming` (`due_date > $2 AND
//! `completed_at IS NULL`), `overdue` (`due_date < $2 AND
//! `completed_at IS NULL`), `done` (`completed_at IS NOT NULL`). `$2` is the
//! current Bogota day (`finance::dates::today_bogota()`), bound instead of
//! `CURRENT_DATE` so the views never follow the DB session timezone. No `view`
//! (or empty) returns every owned task. An unknown `view` is 422.
//!
//! Registered in `routes/mod.rs`; tasks routes are wired in `main.rs` so the
//! `POST /tasks` → `GET /tasks?view=today` harness is live (remaining P4
//! modules land in their own slices).

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id,
    error::AppError,
    finance::dates::today_bogota,
    routes::parse_read_shape,
    state::AppState,
};

const MAX_TITLE_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;

/// Mirrors the `task_status` Postgres enum; validated at the API boundary so
/// an unknown value is 422 instead of a DB error.
const TASK_STATUSES: &[&str] = &["pending", "in_progress", "completed", "cancelled"];

/// Mirrors the `task_priority` Postgres enum.
const TASK_PRIORITIES: &[&str] = &["low", "medium", "high", "urgent"];

/// The four status-based views accepted by `GET /tasks?view=`.
const TASK_VIEWS: &[&str] = &["today", "upcoming", "overdue", "done"];

/// New rows without an explicit `sort_order` append at the end of the user's
/// list (`MAX(sort_order) + 1`, `0` for the first one). The subquery is scoped
/// by `user_id=$1`, the same list the reads order, so ordering is per user.
/// Two concurrent creates may derive the same value; `ORDER BY sort_order,
/// created_at` keeps the rendered order deterministic in that case.
const CREATE_TASK_SQL: &str = "INSERT INTO tasks (user_id, title, description, priority, status, due_date, goal_id, category_id, sort_order) VALUES ($1,$2,$3,$4::task_priority,$5::task_status,$6,$7,$8,COALESCE($9,(SELECT COALESCE(MAX(sort_order)+1,0) FROM tasks WHERE user_id=$1))) RETURNING id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at";
const LIST_TASKS_SQL: &str = "SELECT id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at FROM tasks WHERE user_id=$1 ORDER BY sort_order ASC, created_at ASC";
const LIST_TASKS_TODAY_SQL: &str = "SELECT id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at FROM tasks WHERE user_id=$1 AND due_date = $2 AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC";
const LIST_TASKS_UPCOMING_SQL: &str = "SELECT id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at FROM tasks WHERE user_id=$1 AND due_date > $2 AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC";
const LIST_TASKS_OVERDUE_SQL: &str = "SELECT id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at FROM tasks WHERE user_id=$1 AND due_date < $2 AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC";
const LIST_TASKS_DONE_SQL: &str = "SELECT id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at FROM tasks WHERE user_id=$1 AND completed_at IS NOT NULL ORDER BY sort_order ASC, created_at ASC";
/// Brief shape (`?shape=brief`): exactly the seven fields the productivity views read.
const LIST_TASKS_BRIEF_SQL: &str = "SELECT id, title, priority::text, status::text, due_date, completed_at, goal_id FROM tasks WHERE user_id=$1 ORDER BY sort_order ASC, created_at ASC";
/// Brief shape of the `today` view: same seven columns, same WHERE/ORDER BY.
const LIST_TASKS_TODAY_BRIEF_SQL: &str = "SELECT id, title, priority::text, status::text, due_date, completed_at, goal_id FROM tasks WHERE user_id=$1 AND due_date = $2 AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC";
/// Brief shape of the `upcoming` view: same seven columns, same WHERE/ORDER BY.
const LIST_TASKS_UPCOMING_BRIEF_SQL: &str = "SELECT id, title, priority::text, status::text, due_date, completed_at, goal_id FROM tasks WHERE user_id=$1 AND due_date > $2 AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC";
/// Brief shape of the `overdue` view: same seven columns, same WHERE/ORDER BY.
const LIST_TASKS_OVERDUE_BRIEF_SQL: &str = "SELECT id, title, priority::text, status::text, due_date, completed_at, goal_id FROM tasks WHERE user_id=$1 AND due_date < $2 AND completed_at IS NULL ORDER BY sort_order ASC, created_at ASC";
/// Brief shape of the `done` view: same seven columns, same WHERE/ORDER BY.
const LIST_TASKS_DONE_BRIEF_SQL: &str = "SELECT id, title, priority::text, status::text, due_date, completed_at, goal_id FROM tasks WHERE user_id=$1 AND completed_at IS NOT NULL ORDER BY sort_order ASC, created_at ASC";
const GET_TASK_SQL: &str = "SELECT id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at FROM tasks WHERE id=$1 AND user_id=$2";
const PATCH_TASK_SQL: &str = "UPDATE tasks SET title=COALESCE($3,title), description=COALESCE($4,description), priority=COALESCE($5::task_priority,priority), status=COALESCE($6::task_status,status), due_date=COALESCE($7,due_date), goal_id=COALESCE($8,goal_id), category_id=COALESCE($9,category_id), sort_order=COALESCE($10,sort_order), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, title, description, priority::text, status::text, due_date, completed_at, goal_id, category_id, reminder_id, sort_order, created_at, updated_at";
const DELETE_TASK_SQL: &str = "DELETE FROM tasks WHERE id=$1 AND user_id=$2";
const GOAL_OWNERSHIP_SQL: &str = "SELECT id FROM goals WHERE id=$1 AND user_id=$2";
const GOAL_EXISTS_SQL: &str = "SELECT id FROM goals WHERE id=$1";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";

type TaskRow = (
    Uuid,
    String,
    Option<String>,
    String,
    String,
    Option<NaiveDate>,
    Option<DateTime<Utc>>,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
    i32,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTaskRequest {
    pub title: String,
    pub description: Option<String>,
    /// One of the `task_priority` enum values (default `"medium"`).
    pub priority: Option<String>,
    /// One of the `task_status` enum values (default `"pending"`).
    pub status: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub due_date: Option<String>,
    /// Optional link to an owned goal (foreign → 404, missing → 422).
    pub goal_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    /// Ordering within the user's list; omitted → `MAX(sort_order) + 1`
    /// (append at the end, `0` for the first task).
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchTaskRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    /// One of the `task_priority` enum values.
    pub priority: Option<String>,
    /// One of the `task_status` enum values.
    pub status: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub due_date: Option<String>,
    /// Optional link to an owned goal (foreign → 404, missing → 422).
    pub goal_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    /// Ordering within the user's list; omitted → the stored value is kept.
    pub sort_order: Option<i32>,
}

/// `GET /tasks` filter. Unknown query fields are rejected (422) to keep the
/// read contract strict; an unknown `view` value is 422 in the handler.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskViewQuery {
    pub view: Option<String>,
    pub shape: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TaskResponse {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub priority: String,
    pub status: String,
    pub due_date: Option<NaiveDate>,
    /// Trigger-owned (migrations `0004`/`0007`): stamped on completion,
    /// cleared otherwise, never client-writable.
    pub completed_at: Option<DateTime<Utc>>,
    pub goal_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub reminder_id: Option<Uuid>,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<TaskRow> for TaskResponse {
    fn from(
        row: (
            Uuid,
            String,
            Option<String>,
            String,
            String,
            Option<NaiveDate>,
            Option<DateTime<Utc>>,
            Option<Uuid>,
            Option<Uuid>,
            Option<Uuid>,
            i32,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            title,
            description,
            priority,
            status,
            due_date,
            completed_at,
            goal_id,
            category_id,
            reminder_id,
            sort_order,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            title,
            description,
            priority,
            status,
            due_date,
            completed_at,
            goal_id,
            category_id,
            reminder_id,
            sort_order,
            created_at,
            updated_at,
        }
    }
}

/// Brief task row: id, title, priority, status, due_date, completed_at, goal_id.
type TaskBriefRow = (
    Uuid,
    String,
    String,
    String,
    Option<NaiveDate>,
    Option<DateTime<Utc>>,
    Option<Uuid>,
);

#[derive(Debug, Serialize)]
pub struct TaskBriefResponse {
    pub id: Uuid,
    pub title: String,
    pub priority: String,
    pub status: String,
    pub due_date: Option<NaiveDate>,
    pub completed_at: Option<DateTime<Utc>>,
    pub goal_id: Option<Uuid>,
}

impl From<TaskBriefRow> for TaskBriefResponse {
    fn from(
        row: (
            Uuid,
            String,
            String,
            String,
            Option<NaiveDate>,
            Option<DateTime<Utc>>,
            Option<Uuid>,
        ),
    ) -> Self {
        let (id, title, priority, status, due_date, completed_at, goal_id) = row;
        Self {
            id,
            title,
            priority,
            status,
            due_date,
            completed_at,
            goal_id,
        }
    }
}

/// `GET /api/tasks` body: the full row set, or the brief shape the SPA asks
/// for with `?shape=brief`.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum TasksResponse {
    Full(Vec<TaskResponse>),
    Brief(Vec<TaskBriefResponse>),
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

/// Validate `status` against the `task_status` enum values (exact match
/// after trimming), else 422.
pub fn validate_task_status(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if TASK_STATUSES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "status must be one of: pending, in_progress, completed, cancelled".into(),
        ))
    }
}

/// Validate an optional `status` (default `pending`), else 422.
pub fn validate_task_status_opt(raw: Option<&str>) -> Result<String, AppError> {
    let Some(raw) = raw else {
        return Ok("pending".to_string());
    };
    validate_task_status(raw)
}

/// Validate `priority` against the `task_priority` enum values (exact match
/// after trimming), else 422.
pub fn validate_task_priority(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if TASK_PRIORITIES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "priority must be one of: low, medium, high, urgent".into(),
        ))
    }
}

/// Validate an optional `priority` (default `medium`), else 422.
pub fn validate_task_priority_opt(raw: Option<&str>) -> Result<String, AppError> {
    let Some(raw) = raw else {
        return Ok("medium".to_string());
    };
    validate_task_priority(raw)
}

/// Validate the `view` filter: empty/`None` means "all tasks"; a known view
/// name selects its subset; anything else is 422.
pub fn validate_task_view(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let normalized = raw.trim();
    if normalized.is_empty() {
        return Ok(None);
    }
    if TASK_VIEWS.contains(&normalized) {
        Ok(Some(normalized.to_string()))
    } else {
        Err(AppError::Validation(
            "view must be one of: today, upcoming, overdue, done".into(),
        ))
    }
}

/// Reject a PATCH with no actionable field, else 422.
pub fn validate_task_patch(body: &PatchTaskRequest) -> Result<(), AppError> {
    if body.title.is_none()
        && body.description.is_none()
        && body.priority.is_none()
        && body.status.is_none()
        && body.due_date.is_none()
        && body.goal_id.is_none()
        && body.category_id.is_none()
        && body.sort_order.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Resolve the goal for a task write: owned → Ok; exists for another user →
/// 404 (never leak existence); exists for nobody → 422 (orphaned-goal FK
/// guard, mirroring the habits `ensure_habit_writable` contract).
pub async fn ensure_task_goal(
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
    Err(AppError::Validation("goal does not exist".into()))
}

/// Verify the category is owned AND `kind='task'` (else 422 per the P3
/// category contract: FK + kind mismatch + unowned all map to 422, never
/// 404).
pub async fn ensure_task_category(
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
        Some("task") => Ok(()),
        _ => Err(AppError::Validation(
            "category must be an owned task category".into(),
        )),
    }
}

/// Map task write errors: `23505` (duplicate key, belt-and-braces — tasks
/// carry no unique business key today) → 409; `23503` (FK raced away) /
/// `23514` (check) / `22P02` (invalid enum text — belt-and-braces behind the
/// API guard) → 422; everything else is internal (never leaked).
fn map_task_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("task already exists".into());
            }
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("invalid task data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_task_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTaskRequest>,
) -> Result<(StatusCode, Json<TaskResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let title = validate_required_text(&body.title, MAX_TITLE_LEN, "title")?;
    let priority = validate_task_priority_opt(body.priority.as_deref())?;
    let status = validate_task_status_opt(body.status.as_deref())?;
    let due = match body.due_date.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "due_date")?),
        None => None,
    };
    if let Some(goal_id) = body.goal_id {
        ensure_task_goal(&state.pool, goal_id, user_id).await?;
    }
    if let Some(category_id) = body.category_id {
        ensure_task_category(&state.pool, category_id, user_id).await?;
    }
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    let row = sqlx::query_as::<_, TaskRow>(CREATE_TASK_SQL)
        .bind(user_id)
        .bind(&title)
        .bind(body.description.as_deref())
        .bind(&priority)
        .bind(&status)
        .bind(due)
        .bind(body.goal_id)
        .bind(body.category_id)
        .bind(body.sort_order)
        .fetch_one(&state.pool)
        .await
        .map_err(map_task_db_err)?;
    Ok((StatusCode::CREATED, Json(TaskResponse::from(row))))
}

pub async fn list_tasks_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TaskViewQuery>,
) -> Result<Json<TasksResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let view = validate_task_view(query.view.as_deref())?;
    let shape = parse_read_shape(query.shape.as_deref())?;
    if shape.is_brief() {
        let sql = match view.as_deref() {
            Some("today") => LIST_TASKS_TODAY_BRIEF_SQL,
            Some("upcoming") => LIST_TASKS_UPCOMING_BRIEF_SQL,
            Some("overdue") => LIST_TASKS_OVERDUE_BRIEF_SQL,
            Some("done") => LIST_TASKS_DONE_BRIEF_SQL,
            _ => LIST_TASKS_BRIEF_SQL,
        };
        let needs_day = matches!(view.as_deref(), Some("today" | "upcoming" | "overdue"));
        let mut q = sqlx::query_as::<_, TaskBriefRow>(sql).bind(user_id);
        if needs_day {
            q = q.bind(today_bogota());
        }
        let rows = q.fetch_all(&state.pool).await.map_err(|_| AppError::Internal)?;
        return Ok(Json(TasksResponse::Brief(
            rows.into_iter().map(TaskBriefResponse::from).collect(),
        )));
    }
    let (sql, needs_day) = match view.as_deref() {
        Some("today") => (LIST_TASKS_TODAY_SQL, true),
        Some("upcoming") => (LIST_TASKS_UPCOMING_SQL, true),
        Some("overdue") => (LIST_TASKS_OVERDUE_SQL, true),
        Some("done") => (LIST_TASKS_DONE_SQL, false),
        _ => (LIST_TASKS_SQL, false),
    };
    let mut query = sqlx::query_as::<_, TaskRow>(sql).bind(user_id);
    if needs_day {
        query = query.bind(today_bogota());
    }
    let rows = query
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(TasksResponse::Full(
        rows.into_iter().map(TaskResponse::from).collect(),
    )))
}

pub async fn get_task_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<TaskResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, TaskRow>(GET_TASK_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(TaskResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn patch_task_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchTaskRequest>,
) -> Result<Json<TaskResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_task_patch(&body)?;
    // A foreign id must be 404 before any validation leaks existence.
    let exists = sqlx::query_as::<_, TaskRow>(GET_TASK_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    let _ = exists;
    let title = match body.title.as_deref() {
        Some(raw) => Some(validate_required_text(raw, MAX_TITLE_LEN, "title")?),
        None => None,
    };
    let priority = match body.priority.as_deref() {
        Some(raw) => Some(validate_task_priority(raw)?),
        None => None,
    };
    let status = match body.status.as_deref() {
        Some(raw) => Some(validate_task_status(raw)?),
        None => None,
    };
    let due = match body.due_date.as_deref() {
        Some(raw) => Some(validate_calendar_date(raw, "due_date")?),
        None => None,
    };
    if let Some(goal_id) = body.goal_id {
        ensure_task_goal(&state.pool, goal_id, user_id).await?;
    }
    if let Some(category_id) = body.category_id {
        ensure_task_category(&state.pool, category_id, user_id).await?;
    }
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    let row = sqlx::query_as::<_, TaskRow>(PATCH_TASK_SQL)
        .bind(id)
        .bind(user_id)
        .bind(title.as_deref())
        .bind(body.description.as_deref())
        .bind(priority.as_deref())
        .bind(status.as_deref())
        .bind(due)
        .bind(body.goal_id)
        .bind(body.category_id)
        .bind(body.sort_order)
        .fetch_optional(&state.pool)
        .await
        .map_err(map_task_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(TaskResponse::from(row)))
}

pub async fn delete_task_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_TASK_SQL)
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
    fn accepts_trimmed_valid_title() {
        assert_eq!(
            validate_required_text("  Buy milk ", MAX_TITLE_LEN, "title").unwrap(),
            "Buy milk"
        );
    }

    #[test]
    fn rejects_blank_and_oversized_title_as_422() {
        assert_422(validate_required_text("", MAX_TITLE_LEN, "title").unwrap_err());
        assert_422(validate_required_text("   ", MAX_TITLE_LEN, "title").unwrap_err());
        assert_422(validate_required_text(&"x".repeat(201), MAX_TITLE_LEN, "title").unwrap_err());
        assert_422(validate_required_text("bad\0title", MAX_TITLE_LEN, "title").unwrap_err());
    }

    #[test]
    fn accepts_known_statuses_and_priorities_with_defaults() {
        for raw in ["pending", "in_progress", "completed", "cancelled"] {
            assert_eq!(validate_task_status(raw).unwrap(), raw);
        }
        assert_eq!(validate_task_status("  pending ").unwrap(), "pending");
        assert_eq!(validate_task_status_opt(None).unwrap(), "pending");
        assert_eq!(
            validate_task_status_opt(Some("completed")).unwrap(),
            "completed"
        );
        for raw in ["low", "medium", "high", "urgent"] {
            assert_eq!(validate_task_priority(raw).unwrap(), raw);
        }
        assert_eq!(validate_task_priority("  high ").unwrap(), "high");
        assert_eq!(validate_task_priority_opt(None).unwrap(), "medium");
    }

    #[test]
    fn rejects_unknown_status_priority_and_view_as_422() {
        for raw in ["", "done", "PENDING", "archived", "todo"] {
            assert_422(validate_task_status(raw).unwrap_err());
            assert_422(validate_task_status_opt(Some(raw)).unwrap_err());
        }
        for raw in ["", "normal", "MEDIUM", "critical"] {
            assert_422(validate_task_priority(raw).unwrap_err());
            assert_422(validate_task_priority_opt(Some(raw)).unwrap_err());
        }
        for raw in ["week", "TODAY", "all", "deleted"] {
            assert_422(validate_task_view(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn accepts_known_views_with_all_default() {
        for raw in ["today", "upcoming", "overdue", "done"] {
            assert_eq!(
                validate_task_view(Some(raw)).unwrap(),
                Some(raw.to_string())
            );
        }
        assert_eq!(validate_task_view(None).unwrap(), None);
        assert_eq!(validate_task_view(Some("")).unwrap(), None);
        assert_eq!(validate_task_view(Some("   ")).unwrap(), None);
    }

    #[test]
    fn completed_at_and_reminder_are_never_writable() {
        // `completed_at` is trigger-owned (migrations 0004/0007) and
        // `reminder_id` linking is out of scope: `deny_unknown_fields` turns
        // each into 422 at the boundary, on both create and patch.
        for payload in [
            json!({"title": "T", "completed_at": "2026-09-06T00:00:00Z"}),
            json!({"title": "T", "reminder_id": "00000000-0000-0000-0000-000000000000"}),
        ] {
            assert!(
                serde_json::from_value::<CreateTaskRequest>(payload.clone()).is_err(),
                "trigger-owned/out-of-scope field must fail deserialization on create: {payload}"
            );
            assert!(
                serde_json::from_value::<PatchTaskRequest>(payload.clone()).is_err(),
                "trigger-owned/out-of-scope field must fail deserialization on patch: {payload}"
            );
        }
        // Sanity: the same bodies without the forbidden fields deserialize.
        let _: CreateTaskRequest = serde_json::from_value(json!({"title": "T"})).unwrap();
        let _: PatchTaskRequest = serde_json::from_value(json!({"title": "T2"})).unwrap();
    }

    #[test]
    fn empty_patches_are_422() {
        let body: PatchTaskRequest = serde_json::from_value(json!({})).unwrap();
        assert_422(validate_task_patch(&body).unwrap_err());
    }

    #[test]
    fn task_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_TASK_SQL,
            LIST_TASKS_SQL,
            LIST_TASKS_TODAY_SQL,
            LIST_TASKS_UPCOMING_SQL,
            LIST_TASKS_OVERDUE_SQL,
            LIST_TASKS_DONE_SQL,
            GET_TASK_SQL,
            PATCH_TASK_SQL,
            DELETE_TASK_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "task SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_TASK_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_TASK_SQL}"
        );
        assert!(
            DELETE_TASK_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_TASK_SQL}"
        );
        // `completed_at` may appear in RETURNING (read into the response) but
        // must never be a written column: check the clause before RETURNING.
        for sql in [CREATE_TASK_SQL, PATCH_TASK_SQL] {
            let write_clause = sql.split("RETURNING").next().unwrap_or(sql);
            assert!(
                !write_clause.contains("completed_at"),
                "task write must never set trigger-owned completed_at, got: {sql}"
            );
        }
        assert!(
            GOAL_EXISTS_SQL.contains("FROM goals WHERE id=$1"),
            "orphaned-goal probe must be unscoped, got: {GOAL_EXISTS_SQL}"
        );
    }

    #[test]
    fn view_sql_encodes_the_read_model_contract() {
        // Each view filters on the spec/design contract: today/upcoming/
        // overdue on `due_date` vs the Bogota day bound at `$2` with
        // `completed_at IS NULL`, done on `completed_at IS NOT NULL`.
        for (sql, markers) in [
            (
                LIST_TASKS_TODAY_SQL,
                vec!["due_date = $2", "completed_at IS NULL"],
            ),
            (
                LIST_TASKS_UPCOMING_SQL,
                vec!["due_date > $2", "completed_at IS NULL"],
            ),
            (
                LIST_TASKS_OVERDUE_SQL,
                vec!["due_date < $2", "completed_at IS NULL"],
            ),
            (LIST_TASKS_DONE_SQL, vec!["completed_at IS NOT NULL"]),
        ] {
            for marker in markers {
                assert!(
                    sql.contains(marker),
                    "view SQL must encode {marker}, got: {sql}"
                );
            }
        }
        // The three day views take the day from the bind; the DB session
        // clock (UTC in production) must never decide what "today" is.
        for sql in [
            LIST_TASKS_TODAY_SQL,
            LIST_TASKS_UPCOMING_SQL,
            LIST_TASKS_OVERDUE_SQL,
        ] {
            assert!(
                !sql.contains("CURRENT_DATE"),
                "day view must not read the DB session clock, got: {sql}"
            );
            assert!(
                sql.contains("$2"),
                "day view must bind the Bogota day at $2, got: {sql}"
            );
        }
        // The unfiltered list and the done view stay day-free.
        for sql in [LIST_TASKS_SQL, LIST_TASKS_DONE_SQL] {
            assert!(
                !sql.contains("$2") && !sql.contains("CURRENT_DATE"),
                "day-free view must not take a bound day, got: {sql}"
            );
        }
        // The done view filters on the stamp alone: check the WHERE clause
        // (the SELECT column list legitimately names `due_date`).
        let done_where = LIST_TASKS_DONE_SQL.split("WHERE").nth(1).unwrap_or("");
        assert!(
            !done_where.contains("due_date"),
            "done view must not filter on due_date, got: {LIST_TASKS_DONE_SQL}"
        );
    }

    #[test]
    fn tasks_brief_sql_returns_only_frontend_fields() {
        for sql in [
            LIST_TASKS_BRIEF_SQL,
            LIST_TASKS_TODAY_BRIEF_SQL,
            LIST_TASKS_UPCOMING_BRIEF_SQL,
            LIST_TASKS_OVERDUE_BRIEF_SQL,
            LIST_TASKS_DONE_BRIEF_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "tasks brief SQL must scope by user_id, got: {sql}"
            );
            for kept in [
                "id",
                "title",
                "priority",
                "status",
                "due_date",
                "completed_at",
                "goal_id",
            ] {
                assert!(
                    sql.contains(kept),
                    "tasks brief SQL must keep `{kept}`, got: {sql}"
                );
            }
            for dropped in [
                "description",
                "reminder_id",
                "category_id",
                "sort_order",
                "created_at",
                "updated_at",
            ] {
                // Check the SELECT column list only: the ORDER BY verbatim
                // keeps `sort_order`/`created_at` even though they are not
                // selected.
                let cols = sql
                    .split("SELECT")
                    .nth(1)
                    .unwrap_or("")
                    .split("FROM")
                    .next()
                    .unwrap_or("");
                assert!(
                    !cols.contains(dropped),
                    "tasks brief SQL must not select dropped `{dropped}`, got: {sql}"
                );
            }
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
        let email = format!("task-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("task test")
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
            hermes: None,
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

    fn task_body(title: &str) -> Json<CreateTaskRequest> {
        Json(serde_json::from_value(json!({"title": title})).expect("valid task body"))
    }

    fn task_body_with_order(title: &str, sort_order: Option<i32>) -> Json<CreateTaskRequest> {
        let payload = match sort_order {
            Some(order) => json!({"title": title, "sort_order": order}),
            None => json!({"title": title}),
        };
        Json(serde_json::from_value(payload).expect("valid task body"))
    }

    fn view_query(view: Option<&str>) -> Query<TaskViewQuery> {
        Query(TaskViewQuery {
            view: view.map(str::to_string),
            shape: None,
        })
    }

    async fn seed_goal(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO goals (user_id, name, area) VALUES ($1,$2,'study') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("goal-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed goal")
    }

    async fn goal_progress(pool: &sqlx::PgPool, goal_id: Uuid) -> i16 {
        sqlx::query_scalar("SELECT progress FROM goals WHERE id=$1")
            .bind(goal_id)
            .fetch_one(pool)
            .await
            .expect("read goal progress")
    }

    #[tokio::test]
    async fn missing_session_is_401_without_touching_the_db() {
        // Lazy pool never connects: auth fails before any query.
        let pool = lazy_pool();
        let state = AppState {
            pool: pool.clone(),
            session_ttl_hours: 24,
            rate_limiter: std::sync::Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
            hermes: None,
        };
        let err = list_tasks_handler(State(state), HeaderMap::new(), view_query(None))
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
        let (status, Json(created)) = create_task_handler(
            State(state.clone()),
            headers.clone(),
            task_body(&format!("task-{}", Uuid::new_v4())),
        )
        .await
        .expect("create task");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.status, "pending");
        assert_eq!(created.priority, "medium");
        assert!(created.completed_at.is_none());
        assert!(created.reminder_id.is_none());

        let Json(fetched) =
            get_task_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("get task");
        assert_eq!(fetched.id, created.id);

        let Json(listed) =
            list_tasks_handler(State(state.clone()), headers.clone(), view_query(None))
                .await
                .expect("list tasks");
        let TasksResponse::Full(listed) = listed else {
            panic!("unfiltered list without shape must be the full variant");
        };
        assert!(listed.iter().any(|t| t.id == created.id));

        let Json(patched) = patch_task_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(
                serde_json::from_value(
                    json!({"description": "do it well", "priority": "high", "sort_order": 3}),
                )
                .expect("valid patch"),
            ),
        )
        .await
        .expect("patch task");
        assert_eq!(patched.description.as_deref(), Some("do it well"));
        assert_eq!(patched.priority, "high");
        assert_eq!(patched.sort_order, 3);

        let status = delete_task_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete task");
        assert_eq!(status, StatusCode::NO_CONTENT);
        let err = get_task_handler(State(state), headers, Path(created.id))
            .await
            .expect_err("deleted task must be 404");
        assert_404(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_task_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_task_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let task_id: Uuid =
            sqlx::query_scalar("INSERT INTO tasks (user_id, title) VALUES ($1,$2) RETURNING id")
                .bind(user_a)
                .bind(format!("task-{}", Uuid::new_v4()))
                .fetch_one(&pool)
                .await
                .expect("seed task");
        // User B must see 404 (never leak existence) on get, patch, delete.
        let err = get_task_handler(State(state_b.clone()), headers_b.clone(), Path(task_id))
            .await
            .expect_err("foreign get must be 404");
        assert_404(err);
        let err = patch_task_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(task_id),
            Json(serde_json::from_value(json!({"title": "hijack"})).expect("valid patch")),
        )
        .await
        .expect_err("foreign patch must be 404");
        assert_404(err);
        let err = delete_task_handler(State(state_b.clone()), headers_b.clone(), Path(task_id))
            .await
            .expect_err("foreign delete must be 404");
        assert_404(err);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn create_task_linked_to_own_goal_is_201() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_task_linked_to_own_goal_is_201: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id).await;
        let body = Json(
            serde_json::from_value::<CreateTaskRequest>(json!({
                "title": format!("task-{}", Uuid::new_v4()),
                "goal_id": goal_id
            }))
            .expect("valid body with goal"),
        );
        let (status, Json(created)) =
            create_task_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect("link to own goal is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.goal_id, Some(goal_id));
        assert_eq!(goal_progress(&pool, goal_id).await, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_goal_link_is_404_and_missing_goal_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_goal_link_is_404_and_missing_goal_is_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_goal = seed_goal(&pool, user_a).await;
        // Goal owned by another user → 404 (never leak existence).
        let body = Json(
            serde_json::from_value::<CreateTaskRequest>(json!({
                "title": format!("task-{}", Uuid::new_v4()),
                "goal_id": foreign_goal
            }))
            .expect("valid body with goal"),
        );
        let err = create_task_handler(State(state_b.clone()), headers_b.clone(), body)
            .await
            .expect_err("foreign goal link must be 404");
        assert_404(err);
        // Goal that exists for nobody → 422 (orphaned-FK guard).
        let body = Json(
            serde_json::from_value::<CreateTaskRequest>(json!({
                "title": format!("task-{}", Uuid::new_v4()),
                "goal_id": Uuid::new_v4()
            }))
            .expect("valid body with goal"),
        );
        let err = create_task_handler(State(state_b.clone()), headers_b.clone(), body)
            .await
            .expect_err("missing goal link must be 422");
        assert_422(err);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn goal_progress_tracks_task_changes_0_100_0() {
        // RED (task 4.4.1): the live 0007 trigger must move the linked goal
        // 0% → 100% → 0% purely through task writes — no app-side progress
        // math exists anywhere in this module.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP goal_progress_tracks_task_changes_0_100_0: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let goal_id = seed_goal(&pool, user_id).await;
        assert_eq!(goal_progress(&pool, goal_id).await, 0);

        let body = Json(
            serde_json::from_value::<CreateTaskRequest>(json!({
                "title": format!("task-{}", Uuid::new_v4()),
                "goal_id": goal_id
            }))
            .expect("valid body with goal"),
        );
        let (_, Json(created)) = create_task_handler(State(state.clone()), headers.clone(), body)
            .await
            .expect("create linked task");
        assert_eq!(goal_progress(&pool, goal_id).await, 0);
        assert!(created.completed_at.is_none());

        // Complete the only linked task → 100%, stamped by the trigger.
        let Json(done) = patch_task_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"status": "completed"})).expect("valid patch")),
        )
        .await
        .expect("complete task");
        assert_eq!(done.status, "completed");
        assert!(
            done.completed_at.is_some(),
            "completing a task must stamp completed_at"
        );
        assert_eq!(goal_progress(&pool, goal_id).await, 100);

        // Reopen it → 0% again, stamp cleared by the trigger.
        let Json(reopened) = patch_task_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"status": "pending"})).expect("valid patch")),
        )
        .await
        .expect("reopen task");
        assert!(reopened.completed_at.is_none());
        assert_eq!(goal_progress(&pool, goal_id).await, 0);

        // Deleting the only (pending) task keeps the goal at 0%.
        let status = delete_task_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete task");
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(goal_progress(&pool, goal_id).await, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn view_filters_return_correct_subsets() {
        // GREEN (task 4.4.2): today/upcoming/overdue/done partition the owned
        // tasks per the spec scenarios; completed tasks never leak into the
        // date views.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP view_filters_return_correct_subsets: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let today = today_bogota();
        let past = today - chrono::Duration::days(2);
        let future = today + chrono::Duration::days(2);
        let seed = |title: &str, due: Option<NaiveDate>, status: &str| {
            let pool = pool.clone();
            let owner = user_id;
            let title = title.to_string();
            let status = status.to_string();
            async move {
                sqlx::query_scalar::<_, Uuid>(
                    "INSERT INTO tasks (user_id, title, due_date, status) VALUES ($1,$2,$3,$4::task_status) RETURNING id",
                )
                .bind(owner)
                .bind(title)
                .bind(due)
                .bind(status)
                .fetch_one(&pool)
                .await
                .expect("seed task")
            }
        };
        let today_id = seed("today-task", Some(today), "pending").await;
        let upcoming_id = seed("upcoming-task", Some(future), "pending").await;
        let overdue_id = seed("overdue-task", Some(past), "pending").await;
        let done_today_id = seed("done-today-task", Some(today), "completed").await;
        let undated_id = seed("undated-task", None, "pending").await;

        let ids = |tasks: TasksResponse| {
            let TasksResponse::Full(tasks) = tasks else {
                panic!("view without shape must be the full variant");
            };
            tasks.into_iter().map(|t| t.id).collect::<Vec<_>>()
        };

        let Json(today_tasks) = list_tasks_handler(
            State(state.clone()),
            headers.clone(),
            view_query(Some("today")),
        )
        .await
        .expect("today view");
        let today_ids = ids(today_tasks);
        assert!(
            today_ids.contains(&today_id),
            "today view must include today's pending task"
        );
        assert!(
            !today_ids.contains(&done_today_id),
            "today view must exclude completed tasks"
        );
        assert!(
            !today_ids.contains(&overdue_id),
            "today view must exclude overdue tasks"
        );
        assert!(
            !today_ids.contains(&upcoming_id),
            "today view must exclude upcoming tasks"
        );
        assert!(
            !today_ids.contains(&undated_id),
            "today view must exclude undated tasks"
        );

        let Json(upcoming_tasks) = list_tasks_handler(
            State(state.clone()),
            headers.clone(),
            view_query(Some("upcoming")),
        )
        .await
        .expect("upcoming view");
        let upcoming_ids = ids(upcoming_tasks);
        assert_eq!(upcoming_ids, vec![upcoming_id]);

        let Json(overdue_tasks) = list_tasks_handler(
            State(state.clone()),
            headers.clone(),
            view_query(Some("overdue")),
        )
        .await
        .expect("overdue view");
        let overdue_ids = ids(overdue_tasks);
        assert_eq!(overdue_ids, vec![overdue_id]);

        let Json(done_tasks) = list_tasks_handler(
            State(state.clone()),
            headers.clone(),
            view_query(Some("done")),
        )
        .await
        .expect("done view");
        let done_ids = ids(done_tasks);
        assert!(
            done_ids.contains(&done_today_id),
            "done view must include completed tasks"
        );

        // No view returns everything owned.
        let Json(all) = list_tasks_handler(State(state.clone()), headers.clone(), view_query(None))
            .await
            .expect("unfiltered list");
        let TasksResponse::Full(all) = all else {
            panic!("unfiltered list without shape must be the full variant");
        };
        assert_eq!(all.len(), 5);

        // Unknown view is 422.
        let err = list_tasks_handler(
            State(state.clone()),
            headers.clone(),
            view_query(Some("someday")),
        )
        .await
        .expect_err("unknown view must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn create_with_due_before_nothing_is_still_422_on_bad_date() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP create_with_due_before_nothing_is_still_422_on_bad_date: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let body = Json(
            serde_json::from_value::<CreateTaskRequest>(json!({
                "title": format!("task-{}", Uuid::new_v4()),
                "due_date": "not-a-date"
            }))
            .expect("well-formed body"),
        );
        let err = create_task_handler(State(state.clone()), headers.clone(), body)
            .await
            .expect_err("bad due_date must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn unowned_category_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unowned_category_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_task_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(
                    json!({"title": format!("task-{}", Uuid::new_v4()), "category_id": Uuid::new_v4()}),
                )
                .expect("well-formed body"),
            ),
        )
        .await
        .expect_err("unowned category must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    // -- S5: server-derived sort_order --

    #[tokio::test]
    async fn create_without_sort_order_appends_at_the_end() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_without_sort_order_appends_at_the_end: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, Json(first)) = create_task_handler(
            State(state.clone()),
            headers.clone(),
            task_body_with_order("Primera", None),
        )
        .await
        .expect("first create");
        let (_, Json(second)) = create_task_handler(
            State(state.clone()),
            headers.clone(),
            task_body_with_order("Segunda", None),
        )
        .await
        .expect("second create");
        assert_eq!(first.sort_order, 0);
        assert_eq!(second.sort_order, 1);

        let Json(listed) =
            list_tasks_handler(State(state.clone()), headers.clone(), view_query(None))
                .await
                .expect("list tasks");
        let TasksResponse::Full(rows) = listed else {
            panic!("unfiltered list without shape must be the full variant");
        };
        assert_eq!(
            rows.iter()
                .map(|task| (task.title.as_str(), task.sort_order))
                .collect::<Vec<_>>(),
            vec![("Primera", 0), ("Segunda", 1)]
        );

        // The max is per user: another user's first default task starts at 0.
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let (_, Json(other)) = create_task_handler(
            State(state_b),
            headers_b,
            task_body_with_order("Ajena", None),
        )
        .await
        .expect("other user create");
        assert_eq!(other.sort_order, 0);
        cleanup_user(&pool, user_id).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn explicit_sort_order_is_accepted_and_the_next_default_follows_it() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP explicit_sort_order_is_accepted_and_the_next_default_follows_it: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, Json(explicit)) = create_task_handler(
            State(state.clone()),
            headers.clone(),
            task_body_with_order("Explícita", Some(10)),
        )
        .await
        .expect("explicit create");
        assert_eq!(explicit.sort_order, 10);
        let (_, Json(next)) = create_task_handler(
            State(state.clone()),
            headers.clone(),
            task_body_with_order("Siguiente", None),
        )
        .await
        .expect("default create");
        assert_eq!(next.sort_order, 11);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn patch_without_sort_order_keeps_the_stored_value() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_without_sort_order_keeps_the_stored_value: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, Json(created)) = create_task_handler(
            State(state.clone()),
            headers.clone(),
            task_body_with_order("Original", Some(7)),
        )
        .await
        .expect("create with explicit order");
        assert_eq!(created.sort_order, 7);

        let Json(patched) = patch_task_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(
                serde_json::from_value(json!({"title": "Renombrada"})).expect("valid patch"),
            ),
        )
        .await
        .expect("patch other fields");
        assert_eq!(patched.title, "Renombrada");
        assert_eq!(patched.sort_order, 7);

        // An explicit sort_order on PATCH is still honoured.
        let Json(resorted) = patch_task_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"sort_order": 3})).expect("valid patch")),
        )
        .await
        .expect("patch explicit sort_order");
        assert_eq!(resorted.sort_order, 3);
        cleanup_user(&pool, user_id).await;
    }
}
