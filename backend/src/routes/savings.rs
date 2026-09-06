//! Savings goals CRUD, strictly scoped by `user_id`.
//!
//! Amounts arrive as strings and are validated by
//! [`parse_money_amount`][crate::finance::money::parse_money_amount]
//! (`> 0`, `scale <= 2`, else 422). Derived columns (`saved_amount`,
//! `is_completed`, `completed_at`) are trigger-owned and never writable:
//! the create DTO carries `deny_unknown_fields` and exposes no PATCH.
//! Duplicate names per user surface as 409 via pgcode `23505`; a
//! `category_id` outside the owned `finance` kind is 422; foreign ids
//! resolve to 404 without leaking existence.
//!
//! Movements (`POST /savings-goals/:id/movements`) arrive in slice 2b.
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
    auth::helper::require_user_id, error::AppError, finance::money::parse_money_amount,
    state::AppState,
};

const MAX_NAME_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;
const MAX_COLOR_LEN: usize = 32;

const CREATE_GOAL_SQL: &str = "INSERT INTO savings_goals (user_id, name, description, target_amount, currency, target_date, category_id, color) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, description, target_amount, saved_amount, currency, target_date, category_id, color, is_completed, completed_at, created_at, updated_at";
const LIST_GOALS_SQL: &str = "SELECT id, name, description, target_amount, saved_amount, currency, target_date, category_id, color, is_completed, completed_at, created_at, updated_at FROM savings_goals WHERE user_id=$1 ORDER BY created_at ASC";
const GET_GOAL_SQL: &str = "SELECT id, name, description, target_amount, saved_amount, currency, target_date, category_id, color, is_completed, completed_at, created_at, updated_at FROM savings_goals WHERE id=$1 AND user_id=$2";
const DELETE_GOAL_SQL: &str = "DELETE FROM savings_goals WHERE id=$1 AND user_id=$2";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";

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
}
