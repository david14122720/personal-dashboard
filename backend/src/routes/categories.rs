//! Finance (and shared) categories listing (`GET /categories`).
//!
//! The `categories` table already exists (`user_id, kind, name` with a
//! `UNIQUE(user_id, kind, name)` guard and `category_kind` enum
//! `finance|habit|goal|task|subscription`). This module only READS: it lists
//! the caller's non-archived categories ordered by name, optionally filtered
//! by `?kind=`. Validation reuses the `ensure_finance_category` convention
//! from `transactions.rs` (owned + `kind='finance'`, else 422) for writes;
//! reads validate `kind` against the same enum values and return 422 for
//! unknown kinds. All queries scope by `user_id` so foreign ids never leak.
//!
//! Only COP is used; categories carry no money and no conversion applies.
//!
//! Registered in `routes/mod.rs` and `main.rs` (S1 wiring).

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth::helper::require_user_id, error::AppError, state::AppState};

/// Category kinds accepted at the API boundary (mirrors `category_kind` enum).
pub const CATEGORY_KINDS: &[&str] = &["finance", "habit", "goal", "task", "subscription"];

const LIST_CATEGORIES_SQL: &str = "SELECT id, kind::text, name, color, icon, is_archived, created_at FROM categories WHERE user_id=$1 AND ($2::category_kind IS NULL OR kind=$2::category_kind) AND NOT is_archived ORDER BY name ASC";

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

#[cfg(test)]
mod tests {
    use super::*;
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
    async fn foreign_categories_never_leak() {
        let Some(pool) = test_pool() else {
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
}
