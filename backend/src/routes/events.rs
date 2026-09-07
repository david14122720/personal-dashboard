//! Events CRUD with range queries and cross-domain ownership probes.
//!
//! Wire conventions follow the P4 habits/goals/tasks slices (`habits.rs`,
//! `goals.rs`, `tasks.rs`) and the P3 route slices (`debts.rs`,
//! `subscriptions.rs`): `require_user_id` auth (bad session → 401),
//! `deny_unknown_fields` DTOs, `user_id`-scoped SQL (foreign event ids → 404
//! without leaking existence), `23505 → 409` and `23503 / 23514 / 22P02 →
//! 422`.
//!
//! Ownership matrix: an event may link to entities in six domains — habits,
//! goals, tasks, debts, subscriptions, and categories. Each provided link id
//! is probed in two steps: a `user_id`-scoped probe (owned → Ok), then an
//! unscoped exists-probe (exists for another user → 422, exists for nobody →
//! 404). `category_id` is ownership-only (any kind — the `category_kind`
//! enum has no `event` kind): unowned or missing → 422 per the P3 category
//! contract, never 404. `reminder_id` linking is out of scope for this slice
//! (same precedent as the habits/goals/tasks slices — additive later) and is
//! rejected by `deny_unknown_fields`.
//!
//! There is no `events.note_id` column in the schema and no event self-link
//! column, so note-linking and event-linking are out of scope (design §Open
//! Questions tracks a future `note_id`).
//!
//! Range reads (`GET /events?from&to`): both bounds optional RFC 3339
//! datetimes; the overlap predicate is `starts_at < :to AND (ends_at IS NULL
//! OR ends_at > :from)` per the design. No bounds returns every owned event
//! ordered by `starts_at`. Unknown query fields and malformed datetimes are
//! 422.
//!
//! Registered in `routes/mod.rs`; events routes are wired in `main.rs` so the
//! `POST /events` (cross-user FK) → 422 harness is live (remaining P4 modules
//! land in their own slices).

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::helper::require_user_id, error::AppError, state::AppState};

const MAX_TITLE_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;
const MAX_LOCATION_LEN: usize = 500;

/// Mirrors the `event_kind` Postgres enum; validated at the API boundary so
/// an unknown value is 422 instead of a DB error.
const EVENT_KINDS: &[&str] = &[
    "event",
    "appointment",
    "reminder",
    "payment_due",
    "goal_milestone",
    "habit_reminder",
];

const CREATE_EVENT_SQL: &str = "INSERT INTO events (user_id, title, description, kind, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id) VALUES ($1,$2,$3,$4::event_kind,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, title, description, kind::text, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id, created_at, updated_at";
const LIST_EVENTS_SQL: &str = "SELECT id, title, description, kind::text, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id, created_at, updated_at FROM events WHERE user_id=$1 ORDER BY starts_at ASC";
const LIST_EVENTS_FROM_SQL: &str = "SELECT id, title, description, kind::text, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id, created_at, updated_at FROM events WHERE user_id=$1 AND (ends_at IS NULL OR ends_at > $2) ORDER BY starts_at ASC";
const LIST_EVENTS_TO_SQL: &str = "SELECT id, title, description, kind::text, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id, created_at, updated_at FROM events WHERE user_id=$1 AND starts_at < $2 ORDER BY starts_at ASC";
const LIST_EVENTS_RANGE_SQL: &str = "SELECT id, title, description, kind::text, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id, created_at, updated_at FROM events WHERE user_id=$1 AND starts_at < $3 AND (ends_at IS NULL OR ends_at > $2) ORDER BY starts_at ASC";
const GET_EVENT_SQL: &str = "SELECT id, title, description, kind::text, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id, created_at, updated_at FROM events WHERE id=$1 AND user_id=$2";
const PATCH_EVENT_SQL: &str = "UPDATE events SET title=COALESCE($3,title), description=COALESCE($4,description), kind=COALESCE($5::event_kind,kind), starts_at=COALESCE($6,starts_at), ends_at=COALESCE($7,ends_at), all_day=COALESCE($8,all_day), location=COALESCE($9,location), habit_id=COALESCE($10,habit_id), goal_id=COALESCE($11,goal_id), task_id=COALESCE($12,task_id), debt_id=COALESCE($13,debt_id), subscription_id=COALESCE($14,subscription_id), category_id=COALESCE($15,category_id), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, title, description, kind::text, starts_at, ends_at, all_day, location, habit_id, goal_id, task_id, debt_id, subscription_id, category_id, created_at, updated_at";
const DELETE_EVENT_SQL: &str = "DELETE FROM events WHERE id=$1 AND user_id=$2";

const HABIT_OWNERSHIP_SQL: &str = "SELECT id FROM habits WHERE id=$1 AND user_id=$2";
const HABIT_EXISTS_SQL: &str = "SELECT id FROM habits WHERE id=$1";
const GOAL_OWNERSHIP_SQL: &str = "SELECT id FROM goals WHERE id=$1 AND user_id=$2";
const GOAL_EXISTS_SQL: &str = "SELECT id FROM goals WHERE id=$1";
const TASK_OWNERSHIP_SQL: &str = "SELECT id FROM tasks WHERE id=$1 AND user_id=$2";
const TASK_EXISTS_SQL: &str = "SELECT id FROM tasks WHERE id=$1";
const DEBT_OWNERSHIP_SQL: &str = "SELECT id FROM debts WHERE id=$1 AND user_id=$2";
const DEBT_EXISTS_SQL: &str = "SELECT id FROM debts WHERE id=$1";
const SUBSCRIPTION_OWNERSHIP_SQL: &str = "SELECT id FROM subscriptions WHERE id=$1 AND user_id=$2";
const SUBSCRIPTION_EXISTS_SQL: &str = "SELECT id FROM subscriptions WHERE id=$1";
const CATEGORY_OWNERSHIP_SQL: &str = "SELECT id FROM categories WHERE id=$1 AND user_id=$2";

/// Row mirror of the event SELECT lists (16 columns — `reminder_id` is
/// deliberately not selected: sqlx `FromRow` tuples cap at 16 columns and no
/// API path writes `reminder_id`, so it is always NULL; re-add it to the
/// SELECT lists when reminder linking lands).
type EventRow = (
    Uuid,
    String,
    Option<String>,
    String,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    bool,
    Option<String>,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
    Option<Uuid>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateEventRequest {
    pub title: String,
    pub description: Option<String>,
    /// One of the `event_kind` enum values (default `"event"`).
    pub kind: Option<String>,
    /// RFC 3339 datetime (required).
    pub starts_at: String,
    /// RFC 3339 datetime (must be `> starts_at` when present).
    pub ends_at: Option<String>,
    pub all_day: Option<bool>,
    pub location: Option<String>,
    /// Optional cross-domain links (owned → link, foreign → 422, missing →
    /// 404; `category_id` is ownership-only → 422 when unowned/missing).
    pub habit_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub debt_id: Option<Uuid>,
    pub subscription_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchEventRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    /// One of the `event_kind` enum values.
    pub kind: Option<String>,
    /// RFC 3339 datetime (merged with the stored row for the range check).
    pub starts_at: Option<String>,
    /// RFC 3339 datetime (must be `> starts_at` after the merge).
    pub ends_at: Option<String>,
    pub all_day: Option<bool>,
    pub location: Option<String>,
    /// Optional cross-domain links (same ownership matrix as create).
    pub habit_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub debt_id: Option<Uuid>,
    pub subscription_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
}

/// `GET /events` range filter. Unknown query fields are rejected (422) to
/// keep the read contract strict; malformed bounds are 422 in the handler.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventRangeQuery {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EventResponse {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub kind: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: Option<DateTime<Utc>>,
    pub all_day: bool,
    pub location: Option<String>,
    pub habit_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub debt_id: Option<Uuid>,
    pub subscription_id: Option<Uuid>,
    /// Always `None` on write (linking out of scope) — read back for
    /// completeness.
    pub reminder_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<EventRow> for EventResponse {
    fn from(
        row: (
            Uuid,
            String,
            Option<String>,
            String,
            DateTime<Utc>,
            Option<DateTime<Utc>>,
            bool,
            Option<String>,
            Option<Uuid>,
            Option<Uuid>,
            Option<Uuid>,
            Option<Uuid>,
            Option<Uuid>,
            Option<Uuid>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            title,
            description,
            kind,
            starts_at,
            ends_at,
            all_day,
            location,
            habit_id,
            goal_id,
            task_id,
            debt_id,
            subscription_id,
            category_id,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            title,
            description,
            kind,
            starts_at,
            ends_at,
            all_day,
            location,
            habit_id,
            goal_id,
            task_id,
            debt_id,
            subscription_id,
            // Never selected (see `EventRow`): no API path writes it.
            reminder_id: None,
            category_id,
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

/// Validate `kind` against the `event_kind` enum values (exact match after
/// trimming), else 422.
pub fn validate_event_kind(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if EVENT_KINDS.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "kind must be one of: event, appointment, reminder, payment_due, goal_milestone, habit_reminder"
                .into(),
        ))
    }
}

/// Validate an optional `kind` (default `event`), else 422.
pub fn validate_event_kind_opt(raw: Option<&str>) -> Result<String, AppError> {
    let Some(raw) = raw else {
        return Ok("event".to_string());
    };
    validate_event_kind(raw)
}

/// Parse an RFC 3339 datetime (strict — a bare date is rejected), else 422.
pub fn validate_event_datetime(raw: &str, field: &'static str) -> Result<DateTime<Utc>, AppError> {
    raw.trim()
        .parse::<DateTime<Utc>>()
        .map_err(|_| AppError::Validation(format!("{field} must be an RFC 3339 datetime")))
}

/// Enforce `ends_at > starts_at` whenever an end is present, else 422.
pub fn validate_event_range(
    starts_at: DateTime<Utc>,
    ends_at: Option<DateTime<Utc>>,
) -> Result<(), AppError> {
    if let Some(ends_at) = ends_at {
        if ends_at <= starts_at {
            return Err(AppError::Validation(
                "ends_at must be after starts_at".into(),
            ));
        }
    }
    Ok(())
}

/// Reject a PATCH with no actionable field, else 422.
pub fn validate_event_patch(body: &PatchEventRequest) -> Result<(), AppError> {
    if body.title.is_none()
        && body.description.is_none()
        && body.kind.is_none()
        && body.starts_at.is_none()
        && body.ends_at.is_none()
        && body.all_day.is_none()
        && body.location.is_none()
        && body.habit_id.is_none()
        && body.goal_id.is_none()
        && body.task_id.is_none()
        && body.debt_id.is_none()
        && body.subscription_id.is_none()
        && body.category_id.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Resolve one cross-domain link: scoped probe (owned → Ok), then unscoped
/// exists-probe (exists for another user → 422, exists for nobody → 404).
async fn ensure_event_link(
    pool: &sqlx::PgPool,
    scoped_sql: &str,
    exists_sql: &str,
    id: Uuid,
    user_id: Uuid,
    field: &'static str,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(scoped_sql)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if owned.is_some() {
        return Ok(());
    }
    let exists: Option<Uuid> = sqlx::query_scalar(exists_sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if exists.is_some() {
        return Err(AppError::Validation(format!(
            "{field} belongs to another user"
        )));
    }
    Err(AppError::NotFound)
}

/// Verify the category is owned (any kind — the `category_kind` enum has no
/// `event` kind). Unowned or missing → 422 per the P3 category contract,
/// never 404.
pub async fn ensure_event_category(
    pool: &sqlx::PgPool,
    category_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(CATEGORY_OWNERSHIP_SQL)
        .bind(category_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    if owned.is_some() {
        return Ok(());
    }
    Err(AppError::Validation(
        "category must be an owned category".into(),
    ))
}

/// The six cross-domain link ids carried by both write DTOs.
#[derive(Debug, Clone, Copy, Default)]
pub struct EventLinks {
    pub habit_id: Option<Uuid>,
    pub goal_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub debt_id: Option<Uuid>,
    pub subscription_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
}

/// Validate every provided link id against the ownership matrix (habits,
/// goals, tasks, debts, subscriptions: owned → Ok, foreign → 422, missing →
/// 404; categories: owned → Ok, else 422).
pub async fn ensure_event_links(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    links: EventLinks,
) -> Result<(), AppError> {
    if let Some(id) = links.habit_id {
        ensure_event_link(
            pool,
            HABIT_OWNERSHIP_SQL,
            HABIT_EXISTS_SQL,
            id,
            user_id,
            "habit",
        )
        .await?;
    }
    if let Some(id) = links.goal_id {
        ensure_event_link(
            pool,
            GOAL_OWNERSHIP_SQL,
            GOAL_EXISTS_SQL,
            id,
            user_id,
            "goal",
        )
        .await?;
    }
    if let Some(id) = links.task_id {
        ensure_event_link(
            pool,
            TASK_OWNERSHIP_SQL,
            TASK_EXISTS_SQL,
            id,
            user_id,
            "task",
        )
        .await?;
    }
    if let Some(id) = links.debt_id {
        ensure_event_link(
            pool,
            DEBT_OWNERSHIP_SQL,
            DEBT_EXISTS_SQL,
            id,
            user_id,
            "debt",
        )
        .await?;
    }
    if let Some(id) = links.subscription_id {
        ensure_event_link(
            pool,
            SUBSCRIPTION_OWNERSHIP_SQL,
            SUBSCRIPTION_EXISTS_SQL,
            id,
            user_id,
            "subscription",
        )
        .await?;
    }
    if let Some(id) = links.category_id {
        ensure_event_category(pool, id, user_id).await?;
    }
    Ok(())
}

/// Map event write errors: `23505` (duplicate key, belt-and-braces — events
/// carry no unique business key today) → 409; `23503` (FK raced away) /
/// `23514` (check) / `22P02` (invalid enum text — belt-and-braces behind the
/// API guard) → 422; everything else is internal (never leaked).
fn map_event_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("event already exists".into());
            }
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("invalid event data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_event_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateEventRequest>,
) -> Result<(StatusCode, Json<EventResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let title = validate_required_text(&body.title, MAX_TITLE_LEN, "title")?;
    let kind = validate_event_kind_opt(body.kind.as_deref())?;
    let starts_at = validate_event_datetime(&body.starts_at, "starts_at")?;
    let ends_at = match body.ends_at.as_deref() {
        Some(raw) => Some(validate_event_datetime(raw, "ends_at")?),
        None => None,
    };
    validate_event_range(starts_at, ends_at)?;
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.location.as_deref(), MAX_LOCATION_LEN, "location")?;
    let all_day = body.all_day.unwrap_or(false);
    ensure_event_links(
        &state.pool,
        user_id,
        EventLinks {
            habit_id: body.habit_id,
            goal_id: body.goal_id,
            task_id: body.task_id,
            debt_id: body.debt_id,
            subscription_id: body.subscription_id,
            category_id: body.category_id,
        },
    )
    .await?;
    let row = sqlx::query_as::<_, EventRow>(CREATE_EVENT_SQL)
        .bind(user_id)
        .bind(&title)
        .bind(body.description.as_deref())
        .bind(&kind)
        .bind(starts_at)
        .bind(ends_at)
        .bind(all_day)
        .bind(body.location.as_deref())
        .bind(body.habit_id)
        .bind(body.goal_id)
        .bind(body.task_id)
        .bind(body.debt_id)
        .bind(body.subscription_id)
        .bind(body.category_id)
        .fetch_one(&state.pool)
        .await
        .map_err(map_event_db_err)?;
    Ok((StatusCode::CREATED, Json(EventResponse::from(row))))
}

pub async fn list_events_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventRangeQuery>,
) -> Result<Json<Vec<EventResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let from = match query.from.as_deref() {
        Some(raw) => Some(validate_event_datetime(raw, "from")?),
        None => None,
    };
    let to = match query.to.as_deref() {
        Some(raw) => Some(validate_event_datetime(raw, "to")?),
        None => None,
    };
    if let (Some(from), Some(to)) = (from, to) {
        if to <= from {
            return Err(AppError::Validation("to must be after from".into()));
        }
    }
    let rows = match (from, to) {
        (Some(from), Some(to)) => {
            sqlx::query_as::<_, EventRow>(LIST_EVENTS_RANGE_SQL)
                .bind(user_id)
                .bind(from)
                .bind(to)
                .fetch_all(&state.pool)
                .await
        }
        (Some(from), None) => {
            sqlx::query_as::<_, EventRow>(LIST_EVENTS_FROM_SQL)
                .bind(user_id)
                .bind(from)
                .fetch_all(&state.pool)
                .await
        }
        (None, Some(to)) => {
            sqlx::query_as::<_, EventRow>(LIST_EVENTS_TO_SQL)
                .bind(user_id)
                .bind(to)
                .fetch_all(&state.pool)
                .await
        }
        (None, None) => {
            sqlx::query_as::<_, EventRow>(LIST_EVENTS_SQL)
                .bind(user_id)
                .fetch_all(&state.pool)
                .await
        }
    }
    .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(EventResponse::from).collect()))
}

pub async fn get_event_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<EventResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, EventRow>(GET_EVENT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(EventResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn patch_event_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchEventRequest>,
) -> Result<Json<EventResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_event_patch(&body)?;
    // A foreign id must be 404 before any validation leaks existence.
    let existing = sqlx::query_as::<_, EventRow>(GET_EVENT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    let current = EventResponse::from(existing);
    let title = match body.title.as_deref() {
        Some(raw) => Some(validate_required_text(raw, MAX_TITLE_LEN, "title")?),
        None => None,
    };
    let kind = match body.kind.as_deref() {
        Some(raw) => Some(validate_event_kind(raw)?),
        None => None,
    };
    let starts_at = match body.starts_at.as_deref() {
        Some(raw) => Some(validate_event_datetime(raw, "starts_at")?),
        None => None,
    };
    let ends_at = match body.ends_at.as_deref() {
        Some(raw) => Some(validate_event_datetime(raw, "ends_at")?),
        None => None,
    };
    // Validate the merged range: an `ends_at` must stay after the effective
    // `starts_at` (and vice versa) against the stored row.
    let effective_starts = starts_at.unwrap_or(current.starts_at);
    match (ends_at, current.ends_at) {
        (Some(ends), _) => validate_event_range(effective_starts, Some(ends))?,
        (None, Some(stored)) => validate_event_range(effective_starts, Some(stored))?,
        (None, None) => {}
    }
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.location.as_deref(), MAX_LOCATION_LEN, "location")?;
    ensure_event_links(
        &state.pool,
        user_id,
        EventLinks {
            habit_id: body.habit_id,
            goal_id: body.goal_id,
            task_id: body.task_id,
            debt_id: body.debt_id,
            subscription_id: body.subscription_id,
            category_id: body.category_id,
        },
    )
    .await?;
    let row = sqlx::query_as::<_, EventRow>(PATCH_EVENT_SQL)
        .bind(id)
        .bind(user_id)
        .bind(title.as_deref())
        .bind(body.description.as_deref())
        .bind(kind.as_deref())
        .bind(starts_at)
        .bind(ends_at)
        .bind(body.all_day)
        .bind(body.location.as_deref())
        .bind(body.habit_id)
        .bind(body.goal_id)
        .bind(body.task_id)
        .bind(body.debt_id)
        .bind(body.subscription_id)
        .bind(body.category_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(map_event_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(EventResponse::from(row)))
}

pub async fn delete_event_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_EVENT_SQL)
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
            validate_required_text("  Planning ", MAX_TITLE_LEN, "title").unwrap(),
            "Planning"
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
    fn accepts_known_kinds_with_event_default() {
        for raw in [
            "event",
            "appointment",
            "reminder",
            "payment_due",
            "goal_milestone",
            "habit_reminder",
        ] {
            assert_eq!(validate_event_kind(raw).unwrap(), raw);
        }
        assert_eq!(validate_event_kind("  event ").unwrap(), "event");
        assert_eq!(validate_event_kind_opt(None).unwrap(), "event");
        assert_eq!(
            validate_event_kind_opt(Some("appointment")).unwrap(),
            "appointment"
        );
    }

    #[test]
    fn rejects_unknown_kinds_as_422() {
        for raw in ["", "meeting", "EVENT", "todo", "deadline"] {
            assert_422(validate_event_kind(raw).unwrap_err());
            assert_422(validate_event_kind_opt(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn accepts_rfc3339_datetimes_and_rejects_bare_dates_as_422() {
        let dt = validate_event_datetime("2026-09-07T10:00:00Z", "starts_at").unwrap();
        assert_eq!(dt.to_rfc3339(), "2026-09-07T10:00:00+00:00");
        // Offsets are accepted and normalized to UTC.
        let dt = validate_event_datetime("2026-09-07T10:00:00-05:00", "starts_at").unwrap();
        assert_eq!(dt.to_rfc3339(), "2026-09-07T15:00:00+00:00");
        for raw in [
            "",
            "2026-09-07",
            "09/07/2026",
            "not-a-date",
            "2026-13-40T99:99:99Z",
        ] {
            assert_422(validate_event_datetime(raw, "starts_at").unwrap_err());
        }
    }

    #[test]
    fn range_requires_ends_after_starts() {
        let starts = validate_event_datetime("2026-09-07T10:00:00Z", "starts_at").unwrap();
        let after = validate_event_datetime("2026-09-07T11:00:00Z", "ends_at").unwrap();
        validate_event_range(starts, Some(after)).expect("ends after starts is valid");
        validate_event_range(starts, None).expect("open-ended is valid");
        assert_422(validate_event_range(starts, Some(starts)).unwrap_err());
        let before = validate_event_datetime("2026-09-07T09:00:00Z", "ends_at").unwrap();
        assert_422(validate_event_range(starts, Some(before)).unwrap_err());
    }

    #[test]
    fn reminder_linking_is_never_writable() {
        // `reminder_id` linking is out of scope for this slice:
        // `deny_unknown_fields` turns it into 422 at the boundary, on both
        // create and patch. There is no `note_id` or event self-link column
        // in the schema, so those fields are rejected the same way.
        for payload in [
            json!({"title": "E", "starts_at": "2026-09-07T10:00:00Z", "reminder_id": "00000000-0000-0000-0000-000000000000"}),
            json!({"title": "E", "starts_at": "2026-09-07T10:00:00Z", "note_id": "00000000-0000-0000-0000-000000000000"}),
            json!({"title": "E", "starts_at": "2026-09-07T10:00:00Z", "user_id": "00000000-0000-0000-0000-000000000000"}),
        ] {
            assert!(
                serde_json::from_value::<CreateEventRequest>(payload.clone()).is_err(),
                "out-of-scope link field must fail deserialization on create: {payload}"
            );
            assert!(
                serde_json::from_value::<PatchEventRequest>(payload.clone()).is_err(),
                "out-of-scope link field must fail deserialization on patch: {payload}"
            );
        }
        // Sanity: the same bodies without the forbidden fields deserialize.
        let _: CreateEventRequest =
            serde_json::from_value(json!({"title": "E", "starts_at": "2026-09-07T10:00:00Z"}))
                .unwrap();
        let _: PatchEventRequest = serde_json::from_value(json!({"title": "E2"})).unwrap();
    }

    #[test]
    fn range_query_rejects_unknown_fields() {
        assert!(serde_json::from_value::<EventRangeQuery>(
            json!({"from": "2026-09-07T00:00:00Z", "to": "2026-09-08T00:00:00Z"})
        )
        .is_ok());
        assert!(serde_json::from_value::<EventRangeQuery>(json!({})).is_ok());
        assert!(serde_json::from_value::<EventRangeQuery>(json!({"view": "week"})).is_err());
    }

    #[test]
    fn empty_patches_are_422() {
        let body: PatchEventRequest = serde_json::from_value(json!({})).unwrap();
        assert_422(validate_event_patch(&body).unwrap_err());
    }

    #[test]
    fn event_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_EVENT_SQL,
            LIST_EVENTS_SQL,
            LIST_EVENTS_FROM_SQL,
            LIST_EVENTS_TO_SQL,
            LIST_EVENTS_RANGE_SQL,
            GET_EVENT_SQL,
            PATCH_EVENT_SQL,
            DELETE_EVENT_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "event SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_EVENT_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_EVENT_SQL}"
        );
        assert!(
            DELETE_EVENT_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_EVENT_SQL}"
        );
        // `reminder_id` may appear in RETURNING (read into the response) but
        // must never be a written column: check the clause before RETURNING.
        for sql in [CREATE_EVENT_SQL, PATCH_EVENT_SQL] {
            let write_clause = sql.split("RETURNING").next().unwrap_or(sql);
            assert!(
                !write_clause.contains("reminder_id"),
                "event write must never set out-of-scope reminder_id, got: {sql}"
            );
        }
        for sql in [
            HABIT_EXISTS_SQL,
            GOAL_EXISTS_SQL,
            TASK_EXISTS_SQL,
            DEBT_EXISTS_SQL,
            SUBSCRIPTION_EXISTS_SQL,
        ] {
            assert!(
                !sql.contains("user_id"),
                "exists-probe must be unscoped, got: {sql}"
            );
        }
    }

    #[test]
    fn range_sql_encodes_the_overlap_contract() {
        // The design overlap predicate: `starts_at < :to AND (ends_at IS NULL
        // OR ends_at > :from)`.
        for sql in [LIST_EVENTS_FROM_SQL, LIST_EVENTS_RANGE_SQL] {
            assert!(
                sql.contains("ends_at IS NULL OR ends_at >"),
                "from-side range SQL must keep open-ended events, got: {sql}"
            );
        }
        for sql in [LIST_EVENTS_TO_SQL, LIST_EVENTS_RANGE_SQL] {
            assert!(
                sql.contains("starts_at <"),
                "to-side range SQL must bound on starts_at, got: {sql}"
            );
        }
        assert!(
            LIST_EVENTS_RANGE_SQL.contains("starts_at < $3"),
            "bounded range must bind :to as $3, got: {LIST_EVENTS_RANGE_SQL}"
        );
        assert!(
            LIST_EVENTS_RANGE_SQL.contains("ends_at > $2"),
            "bounded range must bind :from as $2, got: {LIST_EVENTS_RANGE_SQL}"
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
        let email = format!("event-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("event test")
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

    fn event_body(starts_at: &str) -> Json<CreateEventRequest> {
        Json(
            serde_json::from_value(json!({
                "title": format!("event-{}", Uuid::new_v4()),
                "starts_at": starts_at,
            }))
            .expect("valid event body"),
        )
    }

    fn range_query(from: Option<&str>, to: Option<&str>) -> Query<EventRangeQuery> {
        Query(EventRangeQuery {
            from: from.map(str::to_string),
            to: to.map(str::to_string),
        })
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

    async fn seed_task(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar("INSERT INTO tasks (user_id, title) VALUES ($1,$2) RETURNING id")
            .bind(user_id)
            .bind(format!("task-{}", Uuid::new_v4()))
            .fetch_one(pool)
            .await
            .expect("seed task")
    }

    async fn seed_debt(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO debts (user_id, name, creditor, original_amount, pending_amount, start_date) VALUES ($1,$2,'bank',100,100,CURRENT_DATE) RETURNING id",
        )
        .bind(user_id)
        .bind(format!("debt-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed debt")
    }

    async fn seed_subscription(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO subscriptions (user_id, name, price, frequency) VALUES ($1,$2,10,'monthly') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("sub-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed subscription")
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
        let err = list_events_handler(State(state), HeaderMap::new(), range_query(None, None))
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
        let (status, Json(created)) = create_event_handler(
            State(state.clone()),
            headers.clone(),
            event_body("2026-09-07T10:00:00Z"),
        )
        .await
        .expect("create event");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.kind, "event");
        assert!(!created.all_day);
        assert!(created.ends_at.is_none());
        assert!(created.reminder_id.is_none());

        let Json(fetched) =
            get_event_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("get event");
        assert_eq!(fetched.id, created.id);

        let Json(listed) = list_events_handler(
            State(state.clone()),
            headers.clone(),
            range_query(None, None),
        )
        .await
        .expect("list events");
        assert!(listed.iter().any(|e| e.id == created.id));

        let Json(patched) = patch_event_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(
                serde_json::from_value(json!({"location": "home office", "kind": "appointment"}))
                    .expect("valid patch"),
            ),
        )
        .await
        .expect("patch event");
        assert_eq!(patched.location.as_deref(), Some("home office"));
        assert_eq!(patched.kind, "appointment");

        let status = delete_event_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete event");
        assert_eq!(status, StatusCode::NO_CONTENT);
        let err = get_event_handler(State(state), headers, Path(created.id))
            .await
            .expect_err("deleted event must be 404");
        assert_404(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_event_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_event_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let event_id: Uuid = sqlx::query_scalar(
            "INSERT INTO events (user_id, title, starts_at) VALUES ($1,$2,'2026-09-07T10:00:00Z') RETURNING id",
        )
        .bind(user_a)
        .bind(format!("event-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed event");
        // User B must see 404 (never leak existence) on get, patch, delete.
        let err = get_event_handler(State(state_b.clone()), headers_b.clone(), Path(event_id))
            .await
            .expect_err("foreign get must be 404");
        assert_404(err);
        let err = patch_event_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(event_id),
            Json(serde_json::from_value(json!({"title": "hijack"})).expect("valid patch")),
        )
        .await
        .expect_err("foreign patch must be 404");
        assert_404(err);
        let err = delete_event_handler(State(state_b.clone()), headers_b.clone(), Path(event_id))
            .await
            .expect_err("foreign delete must be 404");
        assert_404(err);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn cross_user_links_are_422() {
        // RED (task 5.3.1): every link domain owned by another user must be
        // 422 — never 404 (the entity exists) and never 201 (no hijack).
        let Some(pool) = test_pool() else {
            eprintln!("SKIP cross_user_links_are_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let links: Vec<(&str, Uuid)> = vec![
            ("habit_id", seed_habit(&pool, user_a).await),
            ("goal_id", seed_goal(&pool, user_a).await),
            ("task_id", seed_task(&pool, user_a).await),
            ("debt_id", seed_debt(&pool, user_a).await),
            ("subscription_id", seed_subscription(&pool, user_a).await),
        ];
        for (field, id) in links {
            let body = Json(
                serde_json::from_value::<CreateEventRequest>(json!({
                    "title": format!("event-{}", Uuid::new_v4()),
                    "starts_at": "2026-09-07T10:00:00Z",
                    field: id,
                }))
                .expect("valid body with link"),
            );
            let err = create_event_handler(State(state_b.clone()), headers_b.clone(), body)
                .await
                .expect_err(&format!("cross-user {field} link must be 422"));
            assert_422(err);
        }
        // Category is ownership-only: a foreign category is 422 as well.
        let foreign_category: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'task',$2) RETURNING id",
        )
        .bind(user_a)
        .bind(format!("cat-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed category");
        let body = Json(
            serde_json::from_value::<CreateEventRequest>(json!({
                "title": format!("event-{}", Uuid::new_v4()),
                "starts_at": "2026-09-07T10:00:00Z",
                "category_id": foreign_category,
            }))
            .expect("valid body with category"),
        );
        let err = create_event_handler(State(state_b.clone()), headers_b.clone(), body)
            .await
            .expect_err("cross-user category link must be 422");
        assert_422(err);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn missing_links_are_404_and_missing_category_is_422() {
        // RED (task 5.3.2): a link id that exists for nobody is 404 (except
        // categories, which are ownership-only → 422 per the P3 contract).
        let Some(pool) = test_pool() else {
            eprintln!("SKIP missing_links_are_404_and_missing_category_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        for field in [
            "habit_id",
            "goal_id",
            "task_id",
            "debt_id",
            "subscription_id",
        ] {
            let body = Json(
                serde_json::from_value::<CreateEventRequest>(json!({
                    "title": format!("event-{}", Uuid::new_v4()),
                    "starts_at": "2026-09-07T10:00:00Z",
                    field: Uuid::new_v4(),
                }))
                .expect("valid body with link"),
            );
            let err = create_event_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect_err(&format!("missing {field} link must be 404"));
            assert_404(err);
        }
        let body = Json(
            serde_json::from_value::<CreateEventRequest>(json!({
                "title": format!("event-{}", Uuid::new_v4()),
                "starts_at": "2026-09-07T10:00:00Z",
                "category_id": Uuid::new_v4(),
            }))
            .expect("valid body with category"),
        );
        let err = create_event_handler(State(state.clone()), headers.clone(), body)
            .await
            .expect_err("missing category link must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn owned_links_create_201() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP owned_links_create_201: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let habit_id = seed_habit(&pool, user_id).await;
        let goal_id = seed_goal(&pool, user_id).await;
        let body = Json(
            serde_json::from_value::<CreateEventRequest>(json!({
                "title": format!("event-{}", Uuid::new_v4()),
                "starts_at": "2026-09-07T10:00:00Z",
                "ends_at": "2026-09-07T11:00:00Z",
                "habit_id": habit_id,
                "goal_id": goal_id,
            }))
            .expect("valid body with links"),
        );
        let (status, Json(created)) =
            create_event_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect("owned links are 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.habit_id, Some(habit_id));
        assert_eq!(created.goal_id, Some(goal_id));
        assert!(created.ends_at.is_some());
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn range_queries_filter_by_overlap() {
        // GREEN (task 5.3.3): `from`/`to` select overlapping events per the
        // design predicate; open-ended events match any `from` they outlive.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP range_queries_filter_by_overlap: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        // Seed directly via SQL to keep the range test independent of the
        // create handler's link/validation path.
        let past_id: Uuid = sqlx::query_scalar(
            "INSERT INTO events (user_id, title, starts_at, ends_at) VALUES ($1,$2,'2026-09-01T10:00:00Z','2026-09-01T11:00:00Z') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("past-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed past event");
        let span_id: Uuid = sqlx::query_scalar(
            "INSERT INTO events (user_id, title, starts_at, ends_at) VALUES ($1,$2,'2026-09-06T10:00:00Z','2026-09-08T10:00:00Z') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("span-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed spanning event");
        let open_id: Uuid = sqlx::query_scalar(
            "INSERT INTO events (user_id, title, starts_at) VALUES ($1,$2,'2026-09-06T10:00:00Z') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("open-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed open-ended event");
        let future_id: Uuid = sqlx::query_scalar(
            "INSERT INTO events (user_id, title, starts_at, ends_at) VALUES ($1,$2,'2026-09-10T10:00:00Z','2026-09-10T11:00:00Z') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("future-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed future event");

        let ids = |events: Vec<EventResponse>| events.into_iter().map(|e| e.id).collect::<Vec<_>>();

        // Bounded week window: spanning + open-ended overlap, past/future excluded.
        let Json(week) = list_events_handler(
            State(state.clone()),
            headers.clone(),
            range_query(Some("2026-09-07T00:00:00Z"), Some("2026-09-08T00:00:00Z")),
        )
        .await
        .expect("bounded range");
        let week_ids = ids(week);
        assert!(
            week_ids.contains(&span_id),
            "spanning event must overlap the week"
        );
        assert!(
            week_ids.contains(&open_id),
            "open-ended event must overlap the week"
        );
        assert!(!week_ids.contains(&past_id), "past event must be excluded");
        assert!(
            !week_ids.contains(&future_id),
            "future event must be excluded"
        );

        // `from`-only: past excluded, everything outliving `from` included.
        let Json(from_only) = list_events_handler(
            State(state.clone()),
            headers.clone(),
            range_query(Some("2026-09-07T00:00:00Z"), None),
        )
        .await
        .expect("from-only range");
        let from_ids = ids(from_only);
        assert!(!from_ids.contains(&past_id));
        assert!(from_ids.contains(&span_id));
        assert!(from_ids.contains(&open_id));
        assert!(from_ids.contains(&future_id));

        // `to`-only: future excluded, everything starting before `to` included.
        let Json(to_only) = list_events_handler(
            State(state.clone()),
            headers.clone(),
            range_query(None, Some("2026-09-08T00:00:00Z")),
        )
        .await
        .expect("to-only range");
        let to_ids = ids(to_only);
        assert!(to_ids.contains(&past_id));
        assert!(to_ids.contains(&span_id));
        assert!(to_ids.contains(&open_id));
        assert!(!to_ids.contains(&future_id));

        // No bounds returns everything owned.
        let Json(all) = list_events_handler(
            State(state.clone()),
            headers.clone(),
            range_query(None, None),
        )
        .await
        .expect("unbounded list");
        assert_eq!(all.len(), 4);

        // Malformed bounds are 422.
        let err = list_events_handler(
            State(state.clone()),
            headers.clone(),
            range_query(Some("not-a-date"), None),
        )
        .await
        .expect_err("bad from must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }
    #[tokio::test]
    async fn create_rejects_bad_range_and_bad_kind_live() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_rejects_bad_range_and_bad_kind_live: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        // ends_at before starts_at → 422 (validated before any DB write).
        let body = Json(
            serde_json::from_value::<CreateEventRequest>(json!({
                "title": format!("event-{}", Uuid::new_v4()),
                "starts_at": "2026-09-07T11:00:00Z",
                "ends_at": "2026-09-07T10:00:00Z",
            }))
            .expect("well-formed body"),
        );
        let err = create_event_handler(State(state.clone()), headers.clone(), body)
            .await
            .expect_err("inverted range must be 422");
        assert_422(err);
        // Unknown kind → 422.
        let body = Json(
            serde_json::from_value::<CreateEventRequest>(json!({
                "title": format!("event-{}", Uuid::new_v4()),
                "starts_at": "2026-09-07T10:00:00Z",
                "kind": "meeting",
            }))
            .expect("well-formed body"),
        );
        let err = create_event_handler(State(state.clone()), headers.clone(), body)
            .await
            .expect_err("unknown kind must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }
}
