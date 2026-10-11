//! Finance (and shared) categories: list, create and delete (`GET|POST
//! /categories`, `DELETE /categories/{id}`).
//!
//! The `categories` table already exists (`user_id, kind, name` with a
//! `UNIQUE(user_id, kind, name)` guard and `category_kind` enum
//! `finance|habit|goal|task|subscription`). This module only READS: it lists
//! the caller's non-archived categories ordered by name, optionally filtered
//! by `?kind=`. Reads validate `kind` against the same enum values and
//! return 422 for unknown kinds (writes use the ownership-only
//! `ensure_owned_category` from `crate::finance::validation`). All queries scope by `user_id` so foreign ids never leak.
//! Since S3a (migration 0011) `kind='finance'` is intentionally orphaned:
//! it stays accepted and stored (existing rows keep working) but no finance
//! writer consumes it.
//!
//! Only COP is used; categories carry no money and no conversion applies.
//!
//! Registered in `routes/mod.rs` and `main.rs` (S1 wiring).

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::helper::require_user_id, error::AppError, state::AppState};

/// Category kinds accepted at the API boundary (mirrors `category_kind` enum).
pub const CATEGORY_KINDS: &[&str] = &["finance", "habit", "goal", "task", "subscription"];

/// Longest accepted category name after trimming (mirrors the accounts
/// `validate_account_name` shape: trimmed, length-capped, no null bytes).
const MAX_CATEGORY_NAME_LEN: usize = 80;

const LIST_CATEGORIES_SQL: &str = "SELECT id, kind::text, name, color, icon, is_archived, created_at FROM categories WHERE user_id=$1 AND ($2::category_kind IS NULL OR kind=$2::category_kind) AND NOT is_archived ORDER BY name ASC";
const CREATE_CATEGORY_SQL: &str = "INSERT INTO categories (user_id, kind, name) VALUES ($1,$2::category_kind,$3) RETURNING id, kind::text, name, color, icon, is_archived, created_at";
const DELETE_CATEGORY_SQL: &str = "DELETE FROM categories WHERE id=$1 AND user_id=$2";

type CategoryRow = (
    Uuid,
    String,
    String,
    Option<String>,
    Option<String>,
    bool,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
pub struct ListCategoriesQuery {
    pub kind: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CategoryResponse {
    pub id: Uuid,
    pub kind: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub is_archived: bool,
    pub created_at: DateTime<Utc>,
}

impl From<CategoryRow> for CategoryResponse {
    fn from(
        row: (
            Uuid,
            String,
            String,
            Option<String>,
            Option<String>,
            bool,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (id, kind, name, color, icon, is_archived, created_at) = row;
        Self {
            id,
            kind,
            name,
            color,
            icon,
            is_archived,
            created_at,
        }
    }
}

/// Validate the optional `kind` filter: `None` lists every kind, `Some`
/// must be one of [`CATEGORY_KINDS`] (trimmed, case-sensitive like the DB
/// enum), else 422.
pub fn validate_category_kind(raw: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    let normalized = raw.trim();
    if CATEGORY_KINDS.contains(&normalized) {
        Ok(Some(normalized.to_string()))
    } else {
        Err(AppError::Validation(
            "category kind must be one of: finance, habit, goal, task, subscription".into(),
        ))
    }
}

pub async fn list_categories_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ListCategoriesQuery>,
) -> Result<Json<Vec<CategoryResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let kind = validate_category_kind(params.kind.as_deref())?;
    let rows = sqlx::query_as::<_, CategoryRow>(LIST_CATEGORIES_SQL)
        .bind(user_id)
        .bind(kind)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(CategoryResponse::from).collect()))
}

/// Create body: `name` plus the optional `kind` (defaults to `finance`
/// when omitted). Unknown fields are rejected (422), like the accounts
/// create contract.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub kind: Option<String>,
}

/// Validate a category name: 1-80 chars after trimming, no null bytes.
/// The Spanish message is shown to users as-is (VALIDATION_ERROR).
pub fn validate_category_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > MAX_CATEGORY_NAME_LEN || name.contains('\0') {
        return Err(AppError::Validation(
            "el nombre de la categoría debe tener entre 1 y 80 caracteres".into(),
        ));
    }
    Ok(name.to_string())
}

/// Map category write errors: `23505` (UNIQUE user_id,kind,name) → 409 with
/// a Spanish message, `23514` (check) → 422; everything else is internal
/// (mirrors `map_account_db_err`).
fn map_category_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23505") => {
                return AppError::Conflict("ya existe una categoría con ese nombre".into());
            }
            Some("23514") => {
                return AppError::Validation("datos de categoría inválidos".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

/// Create an owned category (201). Every `category_id` FK in the schema
/// (`movements`, `subscriptions`, habits/goals/tasks/calendar) is
/// `ON DELETE SET NULL`, so a plain delete later is always safe.
pub async fn create_category_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<CategoryResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_category_name(&body.name)?;
    let kind = validate_category_kind(body.kind.as_deref())?.unwrap_or_else(|| "finance".into());
    let row = sqlx::query_as::<_, CategoryRow>(CREATE_CATEGORY_SQL)
        .bind(user_id)
        .bind(&kind)
        .bind(&name)
        .fetch_one(&state.pool)
        .await
        .map_err(map_category_db_err)?;
    Ok((StatusCode::CREATED, Json(CategoryResponse::from(row))))
}

/// Delete an owned category (204). Missing/foreign ids resolve to 404
/// without leaking existence; referencing rows keep their audit
/// (`category_id` SET NULL, never cascaded).
pub async fn delete_category_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_CATEGORY_SQL)
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
    use axum::extract::Path;
    use axum::response::IntoResponse;

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[test]
    fn accepts_all_documented_kinds() {
        for kind in CATEGORY_KINDS {
            assert_eq!(
                validate_category_kind(Some(kind)).unwrap(),
                Some(kind.to_string())
            );
        }
    }

    #[test]
    fn none_lists_every_kind() {
        assert_eq!(validate_category_kind(None).unwrap(), None);
    }

    #[test]
    fn rejects_unknown_kind_as_422() {
        for raw in ["", "FINANCE", " finance ", "money", "savings"] {
            // NOTE: " finance " trims to "finance" and is accepted; keep only true rejects.
            if raw.trim() == "finance" {
                continue;
            }
            assert_422(validate_category_kind(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn trims_kind_before_matching() {
        assert_eq!(
            validate_category_kind(Some("  finance  ")).unwrap(),
            Some("finance".to_string())
        );
    }

    #[test]
    fn list_sql_scopes_filters_and_orders() {
        assert!(
            LIST_CATEGORIES_SQL.contains("user_id=$1"),
            "categories SQL must scope by user_id, got: {LIST_CATEGORIES_SQL}"
        );
        assert!(
            LIST_CATEGORIES_SQL.contains("category_kind"),
            "categories SQL must cast the kind filter, got: {LIST_CATEGORIES_SQL}"
        );
        assert!(
            LIST_CATEGORIES_SQL.contains("NOT is_archived"),
            "list must hide archived categories, got: {LIST_CATEGORIES_SQL}"
        );
        assert!(
            LIST_CATEGORIES_SQL.contains("ORDER BY name ASC"),
            "list must order by name, got: {LIST_CATEGORIES_SQL}"
        );
    }

    #[test]
    fn category_response_preserves_name_and_kind() {
        let row = (
            Uuid::new_v4(),
            "finance".to_string(),
            "Alimentación".to_string(),
            None,
            None,
            false,
            Utc::now(),
        );
        let resp = CategoryResponse::from(row);
        assert_eq!(resp.kind, "finance");
        assert_eq!(resp.name, "Alimentación");
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["name"], serde_json::Value::String("Alimentación".into()));
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(
        pool: &sqlx::PgPool,
    ) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("cat-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("cat test")
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
    async fn list_finance_returns_only_finance_ordered_by_name() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP list_finance_returns_only_finance_ordered_by_name: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        for (kind, name) in [
            ("finance", "Transporte"),
            ("finance", "Alimentación"),
            ("habit", "Ejercicio"),
        ] {
            sqlx::query("INSERT INTO categories (user_id, kind, name) VALUES ($1,$2::category_kind,$3)")
                .bind(user_id)
                .bind(kind)
                .bind(name)
                .execute(&pool)
                .await
                .expect("seed category");
        }
        let q = Query(ListCategoriesQuery {
            kind: Some("finance".into()),
        });
        let body = list_categories_handler(State(state.clone()), headers.clone(), q)
            .await
            .expect("list finance is 200")
            .0;
        assert_eq!(body.len(), 2);
        assert_eq!(body[0].name, "Alimentación");
        assert_eq!(body[1].name, "Transporte");
        assert!(body.iter().all(|c| c.kind == "finance"));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn unknown_kind_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unknown_kind_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let q = Query(ListCategoriesQuery {
            kind: Some("money".into()),
        });
        let err = list_categories_handler(State(state.clone()), headers, q)
            .await
            .expect_err("unknown kind must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_categories_never_leak() {        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_categories_never_leak: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        sqlx::query("INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Privada') ON CONFLICT DO NOTHING")
            .bind(user_a)
            .execute(&pool)
            .await
            .expect("seed foreign category");
        sqlx::query("INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Privada2') ON CONFLICT DO NOTHING")
            .bind(user_a)
            .execute(&pool)
            .await
            .expect("seed foreign category");
        let q = Query(ListCategoriesQuery {
            kind: Some("finance".into()),
        });
        let body = list_categories_handler(State(state_b.clone()), headers_b, q)
            .await
            .expect("list is 200")
            .0;
        assert!(
            body.iter().all(|c| c.name != "Privada" && c.name != "Privada2"),
            "foreign categories must not leak"
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    // -- T1/T2 (categories-crud): create + delete. RED first: the handlers
    // and `validate_category_name` do not exist yet. --

    #[test]
    fn category_name_trims_and_accepts() {
        assert_eq!(validate_category_name("  Mercado  ").unwrap(), "Mercado");
        assert_eq!(validate_category_name("a").unwrap(), "a");
        assert_eq!(validate_category_name(&"x".repeat(80)).unwrap().len(), 80);
    }

    #[test]
    fn category_name_rejects_blank_too_long_and_null_bytes() {
        for raw in ["", "   ", &"x".repeat(81), "Alimen\0tación"] {
            assert_422(validate_category_name(raw).unwrap_err());
        }
    }

    #[test]
    fn category_name_cap_counts_characters_not_bytes() {
        let accepted = "á".repeat(80);
        assert_eq!(validate_category_name(&accepted).unwrap(), accepted);
        assert_422(validate_category_name(&"á".repeat(81)).unwrap_err());
    }

    fn create_req(name: &str, kind: Option<&str>) -> Json<CreateCategoryRequest> {
        Json(CreateCategoryRequest {
            name: name.to_string(),
            kind: kind.map(str::to_string),
        })
    }

    fn assert_409(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::CONFLICT);
    }

    fn assert_404(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn create_category_returns_201_and_defaults_to_finance() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_category_returns_201_and_defaults_to_finance: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, body) = create_category_handler(
            State(state.clone()),
            headers.clone(),
            create_req("  Mercado  ", None),
        )
        .await
        .expect("create is 201");
        assert_eq!(status, axum::http::StatusCode::CREATED);
        assert_eq!(body.name, "Mercado");
        assert_eq!(body.kind, "finance");
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn duplicate_category_name_is_409() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP duplicate_category_name_is_409: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) = create_category_handler(State(state.clone()), headers.clone(), create_req("Mercado", None))
            .await
            .expect("first create is 201");
        assert_eq!(status, axum::http::StatusCode::CREATED);
        assert_eq!(created.name, "Mercado");
        let err = create_category_handler(
            State(state.clone()),
            headers.clone(),
            create_req("Mercado", Some("finance")),
        )
        .await
        .expect_err("duplicate name must be 409");
        assert_409(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_category_returns_204_and_second_delete_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_category_returns_204_and_second_delete_is_404: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, body) = create_category_handler(
            State(state.clone()),
            headers.clone(),
            create_req("Mercado", None),
        )
        .await
        .expect("create is 201");
        let status = delete_category_handler(State(state.clone()), headers.clone(), Path(body.id))
            .await
            .expect("delete is 204");
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);
        let err = delete_category_handler(State(state.clone()), headers.clone(), Path(body.id))
            .await
            .expect_err("second delete must be 404");
        assert_404(err);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_category_delete_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_category_delete_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_id: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Privada') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed foreign category");
        let err = delete_category_handler(State(state_b.clone()), headers_b, Path(foreign_id))
            .await
            .expect_err("foreign delete must be 404");
        assert_404(err);
        // The foreign row survives another owner's delete attempt.
        let still_there: i64 =
            sqlx::query_scalar("SELECT count(*) FROM categories WHERE id=$1")
                .bind(foreign_id)
                .fetch_one(&pool)
                .await
                .expect("count foreign category");
        assert_eq!(still_there, 1);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn delete_category_nulls_movement_category_id() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_category_nulls_movement_category_id: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, body) = create_category_handler(
            State(state.clone()),
            headers.clone(),
            create_req("Mercado", None),
        )
        .await
        .expect("create is 201");
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name) VALUES ($1,'Principal') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let movement_id: Uuid = sqlx::query_scalar(
            "INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on) VALUES ($1,$2,$3,'expense','25000.00','2026-10-01') RETURNING id",
        )
        .bind(user_id)
        .bind(account_id)
        .bind(body.id)
        .fetch_one(&pool)
        .await
        .expect("seed movement");
        delete_category_handler(State(state.clone()), headers.clone(), Path(body.id))
            .await
            .expect("delete is 204");
        let category_id: Option<Uuid> =
            sqlx::query_scalar("SELECT category_id FROM movements WHERE id=$1")
                .bind(movement_id)
                .fetch_one(&pool)
                .await
                .expect("read movement");
        assert_eq!(category_id, None, "delete must SET NULL, not erase the movement");
        cleanup_user(&pool, user_id).await;
    }
}
