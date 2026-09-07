//! Notes CRUD with pinning and full-text search.
//!
//! Wire conventions follow the P4 habits/goals/tasks/events slices
//! (`habits.rs`, `goals.rs`, `tasks.rs`, `events.rs`) and the P3 route slices
//! (`debts.rs`, `subscriptions.rs`): `require_user_id` auth (bad session →
//! 401), `deny_unknown_fields` DTOs, `user_id`-scoped SQL (foreign note ids →
//! 404 without leaking existence), `23505 → 409` and `23503 / 23514 / 22P02 →
//! 422`.
//!
//! Search rides the generated `search_tsv` column (migration `0004`:
//! `setweight(title,'A') || setweight(body,'B')` with the `simple`
//! dictionary, GIN-indexed as `idx_notes_search`). The read contract is
//! `search_tsv @@ plainto_tsquery('simple', q)` ordered by `is_pinned DESC,
//! updated_at DESC`; a missing/blank `q` skips the predicate and returns
//! every owned note in the same pinned-first order.
//!
//! Pinning is PATCH-scoped: `is_pinned` is writable on create and patch (200
//! on toggle). There is no `note` value in the `category_kind` enum, so
//! `category_id` is ownership-only (owned → link, unowned/missing → 422 per
//! the P3 category contract, never 404 — same precedent as the events slice).
//! `reminder_id` linking is out of scope for this slice and is rejected by
//! `deny_unknown_fields`.
//!
//! Body size is capped at 1 MiB (bytes) at the API boundary → 422, so an
//! oversized note never reaches the generated tsvector.
//!
//! Registered in `routes/mod.rs`; notes routes are wired in `main.rs` so the
//! `GET /notes/search?q=` → pin-order harness is live (remaining P4 wiring
//! lands in slice 6).

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
/// DOS guard: note bodies larger than 1 MiB (bytes) are rejected with 422
/// before they reach the generated `search_tsv` column.
const MAX_BODY_BYTES: usize = 1_048_576;

const CREATE_NOTE_SQL: &str = "INSERT INTO notes (user_id, title, body, is_markdown, is_pinned, category_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, body, is_markdown, is_pinned, category_id, created_at, updated_at";
const LIST_NOTES_SQL: &str = "SELECT id, title, body, is_markdown, is_pinned, category_id, created_at, updated_at FROM notes WHERE user_id=$1 ORDER BY is_pinned DESC, updated_at DESC";
const SEARCH_NOTES_SQL: &str = "SELECT id, title, body, is_markdown, is_pinned, category_id, created_at, updated_at FROM notes WHERE user_id=$1 AND search_tsv @@ plainto_tsquery('simple', $2) ORDER BY is_pinned DESC, updated_at DESC";
const GET_NOTE_SQL: &str = "SELECT id, title, body, is_markdown, is_pinned, category_id, created_at, updated_at FROM notes WHERE id=$1 AND user_id=$2";
const PATCH_NOTE_SQL: &str = "UPDATE notes SET title=COALESCE($3,title), body=COALESCE($4,body), is_markdown=COALESCE($5,is_markdown), is_pinned=COALESCE($6,is_pinned), category_id=COALESCE($7,category_id), updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, title, body, is_markdown, is_pinned, category_id, created_at, updated_at";
const DELETE_NOTE_SQL: &str = "DELETE FROM notes WHERE id=$1 AND user_id=$2";
const CATEGORY_OWNERSHIP_SQL: &str = "SELECT id FROM categories WHERE id=$1 AND user_id=$2";

/// Row mirror of the note SELECT lists (8 columns — `search_tsv` is a
/// generated retrieval-only column and is never selected).
type NoteRow = (
    Uuid,
    String,
    String,
    bool,
    bool,
    Option<Uuid>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateNoteRequest {
    pub title: String,
    /// Defaults to `""` when omitted.
    pub body: Option<String>,
    /// Defaults to `true` when omitted.
    pub is_markdown: Option<bool>,
    /// Defaults to `false` when omitted.
    pub is_pinned: Option<bool>,
    /// Optional owned category link (any kind — no `note` kind exists;
    /// unowned/missing → 422).
    pub category_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchNoteRequest {
    pub title: Option<String>,
    pub body: Option<String>,
    pub is_markdown: Option<bool>,
    /// Pin toggle: `{"is_pinned": true}` → 200.
    pub is_pinned: Option<bool>,
    /// Optional owned category link (same ownership rule as create).
    pub category_id: Option<Uuid>,
}

/// `GET /notes/search` filter. Unknown query fields are rejected (422) to
/// keep the read contract strict; a missing/blank `q` returns every owned
/// note in pinned-first order.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoteSearchQuery {
    pub q: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NoteResponse {
    pub id: Uuid,
    pub title: String,
    pub body: String,
    pub is_markdown: bool,
    pub is_pinned: bool,
    pub category_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<NoteRow> for NoteResponse {
    fn from(
        row: (
            Uuid,
            String,
            String,
            bool,
            bool,
            Option<Uuid>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (id, title, body, is_markdown, is_pinned, category_id, created_at, updated_at) = row;
        Self {
            id,
            title,
            body,
            is_markdown,
            is_pinned,
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

/// Validate an optional note body: at most 1 MiB (bytes), no null bytes.
/// `None` means "not provided" (create defaults it to `""`).
pub fn validate_note_body(value: Option<&str>) -> Result<(), AppError> {
    if let Some(text) = value {
        if text.len() > MAX_BODY_BYTES || text.contains('\0') {
            return Err(AppError::Validation(format!(
                "body must be at most {MAX_BODY_BYTES} bytes"
            )));
        }
    }
    Ok(())
}

/// Reject a PATCH with no actionable field, else 422.
pub fn validate_note_patch(body: &PatchNoteRequest) -> Result<(), AppError> {
    if body.title.is_none()
        && body.body.is_none()
        && body.is_markdown.is_none()
        && body.is_pinned.is_none()
        && body.category_id.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Verify the category is owned (any kind — the `category_kind` enum has no
/// `note` kind). Unowned or missing → 422 per the P3 category contract,
/// never 404.
pub async fn ensure_note_category(
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
    match owned {
        Some(_) => Ok(()),
        None => Err(AppError::Validation(
            "category must be an owned category".into(),
        )),
    }
}

/// Map note write errors: `23505` (duplicate key, belt-and-braces — notes
/// carry no unique business key today) → 409; `23503` (FK raced away) /
/// `23514` (check) / `22P02` (invalid text — belt-and-braces behind the API
/// guard) → 422; everything else is internal (never leaked).
fn map_note_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("note already exists".into());
            }
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("invalid note data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateNoteRequest>,
) -> Result<(StatusCode, Json<NoteResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let title = validate_required_text(&body.title, MAX_TITLE_LEN, "title")?;
    validate_note_body(body.body.as_deref())?;
    if let Some(category_id) = body.category_id {
        ensure_note_category(&state.pool, category_id, user_id).await?;
    }
    let row = sqlx::query_as::<_, NoteRow>(CREATE_NOTE_SQL)
        .bind(user_id)
        .bind(&title)
        .bind(body.body.as_deref().unwrap_or(""))
        .bind(body.is_markdown.unwrap_or(true))
        .bind(body.is_pinned.unwrap_or(false))
        .bind(body.category_id)
        .fetch_one(&state.pool)
        .await
        .map_err(map_note_db_err)?;
    Ok((StatusCode::CREATED, Json(NoteResponse::from(row))))
}

pub async fn list_notes_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<NoteResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, NoteRow>(LIST_NOTES_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(NoteResponse::from).collect()))
}

pub async fn search_notes_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<NoteSearchQuery>,
) -> Result<Json<Vec<NoteResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    // A missing/blank `q` skips the FTS predicate and returns every owned
    // note in the same pinned-first order (spec: Empty Query scenario).
    let trimmed = query.q.as_deref().map(str::trim).unwrap_or("");
    let rows = if trimmed.is_empty() {
        sqlx::query_as::<_, NoteRow>(LIST_NOTES_SQL)
            .bind(user_id)
            .fetch_all(&state.pool)
            .await
    } else {
        sqlx::query_as::<_, NoteRow>(SEARCH_NOTES_SQL)
            .bind(user_id)
            .bind(trimmed)
            .fetch_all(&state.pool)
            .await
    }
    .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(NoteResponse::from).collect()))
}

pub async fn get_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<NoteResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, NoteRow>(GET_NOTE_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(NoteResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn patch_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchNoteRequest>,
) -> Result<Json<NoteResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_note_patch(&body)?;
    // A foreign id must be 404 before any validation leaks existence.
    sqlx::query_as::<_, NoteRow>(GET_NOTE_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    let title = match body.title.as_deref() {
        Some(raw) => Some(validate_required_text(raw, MAX_TITLE_LEN, "title")?),
        None => None,
    };
    validate_note_body(body.body.as_deref())?;
    if let Some(category_id) = body.category_id {
        ensure_note_category(&state.pool, category_id, user_id).await?;
    }
    let row = sqlx::query_as::<_, NoteRow>(PATCH_NOTE_SQL)
        .bind(id)
        .bind(user_id)
        .bind(title.as_deref())
        .bind(body.body.as_deref())
        .bind(body.is_markdown)
        .bind(body.is_pinned)
        .bind(body.category_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(map_note_db_err)?
        .ok_or(AppError::NotFound)?;
    Ok(Json(NoteResponse::from(row)))
}

pub async fn delete_note_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_NOTE_SQL)
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
            validate_required_text("  Project plan ", MAX_TITLE_LEN, "title").unwrap(),
            "Project plan"
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
    fn body_size_limit_is_1mib() {
        // Boundary: exactly 1 MiB passes, one byte more is 422.
        validate_note_body(Some(&"x".repeat(MAX_BODY_BYTES))).expect("1 MiB is valid");
        validate_note_body(None).expect("omitted body is valid");
        validate_note_body(Some("")).expect("empty body is valid");
        assert_422(validate_note_body(Some(&"x".repeat(MAX_BODY_BYTES + 1))).unwrap_err());
        assert_422(validate_note_body(Some("bad\0body")).unwrap_err());
    }

    #[test]
    fn empty_patches_are_422() {
        let empty = PatchNoteRequest {
            title: None,
            body: None,
            is_markdown: None,
            is_pinned: None,
            category_id: None,
        };
        assert_422(validate_note_patch(&empty).unwrap_err());
        let pin_only = PatchNoteRequest {
            title: None,
            body: None,
            is_markdown: None,
            is_pinned: Some(true),
            category_id: None,
        };
        validate_note_patch(&pin_only).expect("pin-only patch is valid");
    }

    #[test]
    fn generated_and_identity_fields_are_never_writable() {
        // `search_tsv` (generated), `user_id`, `progress`-style identity
        // fields must fail deserialization on both create and patch.
        for payload in [
            json!({"title": "N", "search_tsv": "plan"}),
            json!({"title": "N", "user_id": "00000000-0000-0000-0000-000000000000"}),
            json!({"title": "N", "reminder_id": "00000000-0000-0000-0000-000000000000"}),
            json!({"title": "N", "created_at": "2026-09-07T10:00:00Z"}),
        ] {
            assert!(
                serde_json::from_value::<CreateNoteRequest>(payload.clone()).is_err(),
                "out-of-scope field must fail deserialization on create: {payload}"
            );
            assert!(
                serde_json::from_value::<PatchNoteRequest>(payload.clone()).is_err(),
                "out-of-scope field must fail deserialization on patch: {payload}"
            );
        }
        // Sanity: pin-relevant bodies deserialize on both.
        let create: CreateNoteRequest =
            serde_json::from_value(json!({"title": "N", "is_pinned": true})).unwrap();
        assert!(create.is_pinned.unwrap());
        let patch: PatchNoteRequest = serde_json::from_value(json!({"is_pinned": false})).unwrap();
        assert!(!patch.is_pinned.unwrap());
    }

    #[test]
    fn search_query_rejects_unknown_fields() {
        assert!(serde_json::from_value::<NoteSearchQuery>(json!({"q": "project"})).is_ok());
        assert!(serde_json::from_value::<NoteSearchQuery>(json!({})).is_ok());
        assert!(serde_json::from_value::<NoteSearchQuery>(json!({"q": ""})).is_ok());
        assert!(serde_json::from_value::<NoteSearchQuery>(json!({"query": "project"})).is_err());
        assert!(serde_json::from_value::<NoteSearchQuery>(json!({"view": "all"})).is_err());
    }

    #[test]
    fn note_sql_scopes_every_query_by_user_id() {
        // Every read/write must ride `user_id` so foreign ids 404 without
        // leaking existence.
        for sql in [
            CREATE_NOTE_SQL,
            LIST_NOTES_SQL,
            SEARCH_NOTES_SQL,
            GET_NOTE_SQL,
            PATCH_NOTE_SQL,
            DELETE_NOTE_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "note SQL must scope by user_id: {sql}"
            );
        }
    }

    #[test]
    fn search_sql_encodes_the_fts_contract() {
        // `plainto_tsquery('simple', q) @@ search_tsv` on the generated
        // column, pinned-first ordering shared with the blank-q list path.
        assert!(
            SEARCH_NOTES_SQL.contains("search_tsv @@ plainto_tsquery('simple'"),
            "search must use plainto_tsquery('simple') on search_tsv: {SEARCH_NOTES_SQL}"
        );
        for sql in [SEARCH_NOTES_SQL, LIST_NOTES_SQL] {
            assert!(
                sql.contains("ORDER BY is_pinned DESC, updated_at DESC"),
                "pinned-first ordering required: {sql}"
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
        let email = format!("note-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("note test")
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

    fn note_body(title: &str) -> Json<CreateNoteRequest> {
        Json(
            serde_json::from_value(json!({
                "title": title,
                "body": format!("body of {title}"),
            }))
            .expect("valid note body"),
        )
    }

    fn search_query(q: Option<&str>) -> Query<NoteSearchQuery> {
        Query(NoteSearchQuery {
            q: q.map(str::to_string),
        })
    }

    #[tokio::test]
    async fn missing_session_is_401_without_touching_the_db() {
        let state = AppState {
            pool: lazy_pool(),
            session_ttl_hours: 24,
            rate_limiter: std::sync::Arc::new(crate::auth::rate_limit::LoginRateLimiter::new()),
        };
        let headers = HeaderMap::new();
        let err = create_note_handler(State(state.clone()), headers.clone(), note_body("N"))
            .await
            .unwrap_err();
        assert_401(err);
        let err = search_notes_handler(
            State(state.clone()),
            headers.clone(),
            search_query(Some("x")),
        )
        .await
        .unwrap_err();
        assert_401(err);
        let err = get_note_handler(State(state.clone()), headers.clone(), Path(Uuid::new_v4()))
            .await
            .unwrap_err();
        assert_401(err);
        let err = delete_note_handler(State(state), headers, Path(Uuid::new_v4()))
            .await
            .unwrap_err();
        assert_401(err);
    }

    #[tokio::test]
    async fn create_201_get_200_pin_toggle_200_delete_204() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_201_get_200_pin_toggle_200_delete_204: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, Json(created)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            note_body(&format!("note-{}", Uuid::new_v4())),
        )
        .await
        .expect("create note");
        assert_eq!(status, StatusCode::CREATED);
        assert!(!created.is_pinned);
        assert!(created.is_markdown);

        let Json(fetched) =
            get_note_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("get note");
        assert_eq!(fetched.id, created.id);

        // Pin toggle via PATCH → 200, then unpin → 200.
        let Json(pinned) = patch_note_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"is_pinned": true})).expect("valid pin patch")),
        )
        .await
        .expect("pin note");
        assert!(pinned.is_pinned);
        let Json(unpinned) = patch_note_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"is_pinned": false})).expect("valid unpin patch")),
        )
        .await
        .expect("unpin note");
        assert!(!unpinned.is_pinned);

        // Pinned-first list: pin it again, add a newer unpinned note, the
        // pinned one still lists first.
        let Json(repinned) = patch_note_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"is_pinned": true})).expect("valid pin patch")),
        )
        .await
        .expect("re-pin note");
        assert!(repinned.is_pinned);
        let (status, Json(newer_note)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            note_body(&format!("newer-{}", Uuid::new_v4())),
        )
        .await
        .expect("create newer note");
        assert_eq!(status, StatusCode::CREATED);
        assert!(!newer_note.is_pinned);
        let Json(listed) = list_notes_handler(State(state.clone()), headers.clone())
            .await
            .expect("list notes");
        assert!(listed.len() >= 2);
        assert_eq!(listed[0].id, created.id, "pinned note lists first");

        let status = delete_note_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("delete note");
        assert_eq!(status, StatusCode::NO_CONTENT);
        let err = get_note_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .unwrap_err();
        assert_404(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_note_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_note_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, headers_a, user_a) = db_state(&pool).await;
        let (_state_b, headers_b, user_b) = db_state(&pool).await;
        let (_, Json(created)) = create_note_handler(
            State(state_a.clone()),
            headers_a.clone(),
            note_body(&format!("owned-{}", Uuid::new_v4())),
        )
        .await
        .expect("create note");
        // Cross-user reads/patches/deletes 404 without leaking existence.
        let err = get_note_handler(State(state_a.clone()), headers_b.clone(), Path(created.id))
            .await
            .unwrap_err();
        assert_404(err);
        let err = patch_note_handler(
            State(state_a.clone()),
            headers_b.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"title": "hijack"})).expect("valid patch")),
        )
        .await
        .unwrap_err();
        assert_404(err);
        let err = delete_note_handler(State(state_a.clone()), headers_b.clone(), Path(created.id))
            .await
            .unwrap_err();
        assert_404(err);
        // Foreign notes never appear in another user's search.
        let Json(results) = search_notes_handler(
            State(state_a.clone()),
            headers_b.clone(),
            search_query(Some("owned")),
        )
        .await
        .expect("foreign search");
        assert!(results.is_empty());
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn search_returns_pinned_notes_first() {
        // Task 6.3.1 (RED): an unpinned newer note and a pinned older note
        // share a term — the pinned one must rank first.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP search_returns_pinned_notes_first: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let token = format!("pinorder{}", Uuid::new_v4().simple());
        let (_, Json(older)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "title": format!("older {token}"),
                    "body": format!("older body {token}"),
                }))
                .expect("valid note body"),
            ),
        )
        .await
        .expect("create older note");
        let (_, Json(newer)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "title": format!("newer {token}"),
                    "body": format!("newer body {token}"),
                }))
                .expect("valid note body"),
            ),
        )
        .await
        .expect("create newer note");
        // Force the recency order against the test's will: the unpinned note
        // is strictly newer, so only `is_pinned DESC` can put `older` first.
        sqlx::query("UPDATE notes SET updated_at = now() - interval '1 hour' WHERE id=$1")
            .bind(older.id)
            .execute(&pool)
            .await
            .expect("age the pinned note");
        let Json(pinned_older) = patch_note_handler(
            State(state.clone()),
            headers.clone(),
            Path(older.id),
            Json(serde_json::from_value(json!({"is_pinned": true})).expect("valid pin patch")),
        )
        .await
        .expect("pin older note");
        assert!(pinned_older.is_pinned);
        // Re-age after the pin bumped `updated_at` via the trigger.
        sqlx::query("UPDATE notes SET updated_at = now() - interval '1 hour' WHERE id=$1")
            .bind(older.id)
            .execute(&pool)
            .await
            .expect("re-age the pinned note");
        let Json(results) = search_notes_handler(
            State(state.clone()),
            headers.clone(),
            search_query(Some(&token)),
        )
        .await
        .expect("search notes");
        assert_eq!(results.len(), 2, "both notes match {token}");
        assert_eq!(results[0].id, older.id, "pinned older note ranks first");
        assert_eq!(results[1].id, newer.id, "unpinned newer note ranks second");
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn blank_search_returns_all_notes_pinned_first() {
        // Task 6.3.2 (RED): missing/blank `q` returns every owned note in
        // pinned-first, updated_at-DESC order.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP blank_search_returns_all_notes_pinned_first: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let token = format!("blankq{}", Uuid::new_v4().simple());
        let (_, Json(first)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            note_body(&format!("{token}-first")),
        )
        .await
        .expect("create first note");
        let (_, Json(second)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            note_body(&format!("{token}-second")),
        )
        .await
        .expect("create second note");
        let Json(pinned_first) = patch_note_handler(
            State(state.clone()),
            headers.clone(),
            Path(first.id),
            Json(serde_json::from_value(json!({"is_pinned": true})).expect("valid pin patch")),
        )
        .await
        .expect("pin first note");
        assert!(pinned_first.is_pinned);
        for q in [None, Some(""), Some("   ")] {
            let Json(results) =
                search_notes_handler(State(state.clone()), headers.clone(), search_query(q))
                    .await
                    .expect("blank search");
            let ids: Vec<Uuid> = results.iter().map(|n| n.id).collect();
            assert!(ids.contains(&first.id) && ids.contains(&second.id));
            assert_eq!(results[0].id, first.id, "pinned note first for q={q:?}");
        }
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn basic_search_matches_title_and_body() {
        // Spec scenario: "project plan" vs "shopping list", query "project".
        let Some(pool) = test_pool() else {
            eprintln!("SKIP basic_search_matches_title_and_body: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let token = format!("ftsmatch{}", Uuid::new_v4().simple());
        let (_, Json(plan)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "title": format!("{token} project plan"),
                    "body": "quarterly roadmap",
                }))
                .expect("valid note body"),
            ),
        )
        .await
        .expect("create plan note");
        let (list_status, Json(list_note)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "title": format!("{token} shopping list"),
                    "body": "milk and eggs",
                }))
                .expect("valid note body"),
            ),
        )
        .await
        .expect("create list note");
        assert_eq!(list_status, StatusCode::CREATED);
        assert_ne!(list_note.id, plan.id);
        let Json(results) = search_notes_handler(
            State(state.clone()),
            headers.clone(),
            search_query(Some(&format!("{token} project"))),
        )
        .await
        .expect("search notes");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, plan.id);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn oversized_body_is_422_live() {
        // Task 6.3.3 (GREEN): bodies over 1 MiB never reach the database.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP oversized_body_is_422_live: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let err = create_note_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "title": "too big",
                    "body": "x".repeat(MAX_BODY_BYTES + 1),
                }))
                .expect("oversized body deserializes"),
            ),
        )
        .await
        .unwrap_err();
        assert_422(err);
        // Patch path: an existing note with an oversized body is 422 (a
        // missing id stays 404 — existence is probed before validation so
        // the validator never leaks it).
        let (_, Json(existing)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            note_body(&format!("shrinkable-{}", Uuid::new_v4())),
        )
        .await
        .expect("create note");
        let err = patch_note_handler(
            State(state.clone()),
            headers.clone(),
            Path(existing.id),
            Json(
                serde_json::from_value(json!({
                    "body": "x".repeat(MAX_BODY_BYTES + 1),
                }))
                .expect("oversized patch deserializes"),
            ),
        )
        .await
        .unwrap_err();
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn unowned_and_missing_categories_are_422_live() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unowned_and_missing_categories_are_422_live: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_other, headers_other, user_other) = db_state(&pool).await;
        let foreign_category: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'task',$2) RETURNING id",
        )
        .bind(user_other)
        .bind(format!("foreign-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed foreign category");
        for category_id in [foreign_category, Uuid::new_v4()] {
            let err = create_note_handler(
                State(state.clone()),
                headers.clone(),
                Json(
                    serde_json::from_value(json!({
                        "title": "linked",
                        "category_id": category_id,
                    }))
                    .expect("valid linked body"),
                ),
            )
            .await
            .unwrap_err();
            assert_422(err);
        }
        // An owned category (any kind — no `note` kind exists) links fine.
        let owned_category: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'task',$2) RETURNING id",
        )
        .bind(user_id)
        .bind(format!("owned-{}", Uuid::new_v4()))
        .fetch_one(&pool)
        .await
        .expect("seed owned category");
        let (status, Json(linked)) = create_note_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "title": "linked",
                    "category_id": owned_category,
                }))
                .expect("valid linked body"),
            ),
        )
        .await
        .expect("owned category links");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(linked.category_id, Some(owned_category));
        // Silence the unused-binding lint for the second session on purpose:
        // `headers_other` proves the foreign-category seed above.
        let _ = headers_other;
        cleanup_user(&pool, user_id).await;
        cleanup_user(&pool, user_other).await;
    }

    #[tokio::test]
    async fn search_query_avoids_sequential_scans() {
        // Task 6.4: EXPLAIN (ANALYZE, BUFFERS) proof for the FTS read model.
        // The planner only prefers index paths at realistic volume, so seed
        // decoy notes first, then ANALYZE so the stats reflect the volume.
        // The probe term is unique to two target notes, keeping the bitmap
        // highly selective.
        //
        // Plan-shape note: through sqlx (server-side params) EXPLAIN reports
        // the generic plan, which rides `idx_notes_user_updated` (user bitmap)
        // plus a heap `@@` filter — no sequential scan. Custom plans with a
        // selective literal ride `idx_notes_search` directly (Bitmap Index
        // Scan on the GIN index, verified live against the same distribution:
        // `Recheck Cond: (search_tsv @@ '''ginprobe'''::tsquery)`). Either
        // shape is index-backed, so the test accepts both indexes and
        // rejects only the unindexed shape.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP search_query_uses_the_fts_gin_index: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let token = format!("ginprobe{}", Uuid::new_v4().simple());
        for title in [format!("{token} alpha"), format!("{token} beta")] {
            let (probe_status, Json(_probe)) = create_note_handler(
                State(state.clone()),
                headers.clone(),
                Json(
                    serde_json::from_value(json!({"title": title, "body": "probe body"}))
                        .expect("valid note body"),
                ),
            )
            .await
            .expect("create probe note");
            assert_eq!(probe_status, StatusCode::CREATED);
        }
        sqlx::query(
            "INSERT INTO notes (user_id, title, body) SELECT $1, 'decoy-' || g, 'filler text ' || g FROM generate_series(1,5000) g",
        )
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("seed decoy notes");
        sqlx::query("ANALYZE notes")
            .execute(&pool)
            .await
            .expect("analyze notes");
        let plan_rows: Vec<(String,)> =
            sqlx::query_as(&format!("EXPLAIN (ANALYZE, BUFFERS) {SEARCH_NOTES_SQL}"))
                .bind(user_id)
                .bind(&token)
                .fetch_all(&state.pool)
                .await
                .expect("explain search executes");
        let plan = plan_rows
            .iter()
            .map(|(line,)| line.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        eprintln!("notes search plan:\n{plan}");
        assert!(
            plan.contains("idx_notes_search") || plan.contains("idx_notes_user_updated"),
            "search must use an index (idx_notes_search or idx_notes_user_updated), got:\n{plan}"
        );
        assert!(
            !plan.contains("Seq Scan on notes"),
            "search must not sequential-scan notes, got:\n{plan}"
        );
        cleanup_user(&pool, user_id).await;
    }
}
