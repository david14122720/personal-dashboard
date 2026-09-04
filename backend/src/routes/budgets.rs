//! Budgets: per-category spending caps with on-demand status monitoring.
//!
//! A budget caps spending for one owned `kind='finance'` category over a
//! closed date range. Status is computed on demand with a SINGLE aggregate
//! query (`SUM(amount)` over `type='expense'` rows in the period) — no N+1,
//! no background jobs. Thresholds are mapped to `ok`/`warn`/`over` in Rust:
//! `pct >= over_threshold` → `over`, `pct >= warn_threshold` → `warn`.
//!
//! Money travels as strings (`parse_money_amount`: `> 0`, `scale <= 2`, else
//! 422). A foreign or missing budget resolves to 404 (never 403, no oracle);
//! category problems (missing, unowned, wrong kind) are 422 per the finance
//! error mapping. Transfers (`type='transfer'`) never count toward spend.

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
    finance::money::parse_money_amount,
    routes::transactions::{ensure_finance_category, validate_occurred_on},
    state::AppState,
};

const MAX_NOTES_LEN: usize = 2000;

const CREATE_BUDGET_SQL: &str = "INSERT INTO budgets (user_id, category_id, amount, period_start, period_end, warn_threshold, over_threshold, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, category_id, amount, currency, period_start, period_end, warn_threshold, over_threshold, notes, created_at, updated_at";
const LIST_BUDGETS_SQL: &str = "SELECT id, category_id, amount, currency, period_start, period_end, warn_threshold, over_threshold, notes, created_at, updated_at FROM budgets WHERE user_id=$1 ORDER BY period_start DESC";
const GET_BUDGET_SQL: &str = "SELECT id, category_id, amount, currency, period_start, period_end, warn_threshold, over_threshold, notes, created_at, updated_at FROM budgets WHERE id=$1 AND user_id=$2";

/// Single-round-trip spend aggregate for one budget: every expense row in the
/// period collapses into one `SUM` (no per-transaction queries, no N+1).
/// Transfers are excluded by the `type='expense'` predicate.
const STATUS_SPENT_SQL: &str = "SELECT COALESCE(SUM(t.amount),0) FROM transactions t WHERE t.user_id=$1 AND t.category_id=$2 AND t.type='expense' AND t.occurred_on BETWEEN $3 AND $4";

type BudgetRow = (
    Uuid,
    Uuid,
    Decimal,
    String,
    NaiveDate,
    NaiveDate,
    Decimal,
    Decimal,
    Option<String>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateBudgetRequest {
    pub category_id: Uuid,
    /// Wire-format money string, e.g. `"500.00"` (never a JSON number).
    pub amount: String,
    /// Calendar dates `YYYY-MM-DD`; `period_end >= period_start` else 422.
    pub period_start: String,
    pub period_end: String,
    /// Fractions of `amount` (e.g. `0.8` warns at 80%). Defaults: 0.8 / 1.0.
    pub warn_threshold: Option<f64>,
    pub over_threshold: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BudgetResponse {
    pub id: Uuid,
    pub category_id: Uuid,
    /// Serialized as a string (e.g. `"500.00"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub amount: Decimal,
    pub currency: String,
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    /// Fractions (e.g. `0.8`); plain JSON numbers, thresholds are ratios.
    pub warn_threshold: f64,
    pub over_threshold: f64,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct BudgetStatusResponse {
    /// Total expenses in the period, as a string (e.g. `"85.00"`).
    pub spent: Decimal,
    /// `amount - spent` (negative when over budget), as a string.
    pub remaining: Decimal,
    /// `spent / amount` as a fraction (e.g. `0.85`).
    pub pct: f64,
    /// `ok` | `warn` | `over` (see [`map_budget_status`]).
    pub status: String,
}

impl From<BudgetRow> for BudgetResponse {
    fn from(row: BudgetRow) -> Self {
        let (
            id,
            category_id,
            amount,
            currency,
            period_start,
            period_end,
            warn_threshold,
            over_threshold,
            notes,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            category_id,
            amount,
            currency,
            period_start,
            period_end,
            warn_threshold: decimal_to_f64(warn_threshold),
            over_threshold: decimal_to_f64(over_threshold),
            notes,
            created_at,
            updated_at,
        }
    }
}

/// Exact `Decimal` → `f64` via the canonical string form (avoids depending on
/// `ToPrimitive` feature gates; thresholds/pct are display ratios, never money
/// math, so float representation is appropriate here).
fn decimal_to_f64(value: Decimal) -> f64 {
    value.to_string().parse::<f64>().unwrap_or(0.0)
}

/// Reject an inverted period (`period_end < period_start`) with 422. Equal
/// bounds describe a valid single-day budget.
pub fn validate_budget_period(start: NaiveDate, end: NaiveDate) -> Result<(), AppError> {
    if end < start {
        return Err(AppError::Validation(
            "period_end must be on or after period_start".into(),
        ));
    }
    Ok(())
}

/// Validate alert thresholds as fractions: `warn` in `[0,1]`, `over` in
/// `[warn,2]` (mirrors the DB checks), both finite. Else 422.
pub fn validate_thresholds(warn: f64, over: f64) -> Result<(), AppError> {
    if !warn.is_finite() || !over.is_finite() || !(0.0..=1.0).contains(&warn) {
        return Err(AppError::Validation(
            "warn_threshold must be between 0 and 1".into(),
        ));
    }
    if over < warn || over > 2.0 {
        return Err(AppError::Validation(
            "over_threshold must be between warn_threshold and 2".into(),
        ));
    }
    Ok(())
}

/// Map spend fraction to alert status: `pct >= over` → `over`,
/// `pct >= warn` → `warn`, else `ok`. Boundaries belong to the higher tier
/// (exactly 80% with `warn=0.8` is already `warn`).
pub fn map_budget_status(pct: f64, warn: f64, over: f64) -> &'static str {
    if pct >= over {
        "over"
    } else if pct >= warn {
        "warn"
    } else {
        "ok"
    }
}

fn validate_optional_notes(notes: Option<&str>) -> Result<(), AppError> {
    if let Some(text) = notes {
        if text.len() > MAX_NOTES_LEN || text.contains('\0') {
            return Err(AppError::Validation(format!(
                "notes must be at most {MAX_NOTES_LEN} characters"
            )));
        }
    }
    Ok(())
}

pub async fn create_budget_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateBudgetRequest>,
) -> Result<(StatusCode, Json<BudgetResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let amount = parse_money_amount(&body.amount)?;
    let period_start = validate_occurred_on(&body.period_start)?;
    let period_end = validate_occurred_on(&body.period_end)?;
    validate_budget_period(period_start, period_end)?;
    let warn = body.warn_threshold.unwrap_or(0.8);
    let over = body.over_threshold.unwrap_or(1.0);
    validate_thresholds(warn, over)?;
    validate_optional_notes(body.notes.as_deref())?;
    // Category must be owned AND `kind='finance'` (422 otherwise, no oracle).
    ensure_finance_category(&state.pool, body.category_id, user_id).await?;
    let row = sqlx::query_as::<_, BudgetRow>(CREATE_BUDGET_SQL)
        .bind(user_id)
        .bind(body.category_id)
        .bind(amount)
        .bind(period_start)
        .bind(period_end)
        .bind(warn)
        .bind(over)
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok((StatusCode::CREATED, Json(BudgetResponse::from(row))))
}

pub async fn list_budgets_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<BudgetResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, BudgetRow>(LIST_BUDGETS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(rows.into_iter().map(BudgetResponse::from).collect()))
}

pub async fn get_budget_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<BudgetResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, BudgetRow>(GET_BUDGET_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(BudgetResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn budget_status_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<BudgetStatusResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, BudgetRow>(GET_BUDGET_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    let (
        _id,
        category_id,
        amount,
        _currency,
        period_start,
        period_end,
        warn_threshold,
        over_threshold,
        _notes,
        _created_at,
        _updated_at,
    ) = row.ok_or(AppError::NotFound)?;
    // Single aggregate round-trip: one SUM over expenses in the period.
    let spent: Decimal = sqlx::query_scalar(STATUS_SPENT_SQL)
        .bind(user_id)
        .bind(category_id)
        .bind(period_start)
        .bind(period_end)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    let remaining = amount - spent;
    let pct = decimal_to_f64(spent.checked_div(amount).unwrap_or(Decimal::ZERO));
    let status = map_budget_status(
        pct,
        decimal_to_f64(warn_threshold),
        decimal_to_f64(over_threshold),
    )
    .to_string();
    Ok(Json(BudgetStatusResponse {
        spent,
        remaining,
        pct,
        status,
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

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    #[test]
    fn accepts_ordered_and_single_day_periods() {
        validate_budget_period(date(2026, 9, 1), date(2026, 9, 30)).unwrap();
        validate_budget_period(date(2026, 9, 1), date(2026, 9, 1)).unwrap();
    }

    #[test]
    fn rejects_inverted_period_as_422() {
        assert_422(validate_budget_period(date(2026, 9, 30), date(2026, 9, 1)).unwrap_err());
    }

    #[test]
    fn accepts_default_thresholds() {
        validate_thresholds(0.8, 1.0).unwrap();
    }

    #[test]
    fn rejects_bad_thresholds_as_422() {
        // warn outside [0,1], over below warn, over above 2, non-finite.
        for (warn, over) in [
            (-0.1, 1.0),
            (1.5, 1.0),
            (0.8, 0.5),
            (0.8, 2.5),
            (f64::NAN, 1.0),
            (0.8, f64::INFINITY),
        ] {
            assert_422(validate_thresholds(warn, over).unwrap_err());
        }
    }

    #[test]
    fn status_maps_ok_warn_over_with_boundaries_on_upper_tier() {
        assert_eq!(map_budget_status(0.40, 0.8, 1.0), "ok");
        assert_eq!(map_budget_status(0.0, 0.8, 1.0), "ok");
        assert_eq!(map_budget_status(0.80, 0.8, 1.0), "warn");
        assert_eq!(map_budget_status(0.85, 0.8, 1.0), "warn");
        assert_eq!(map_budget_status(1.00, 0.8, 1.0), "over");
        assert_eq!(map_budget_status(1.10, 0.8, 1.0), "over");
    }

    #[test]
    fn amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({
            "category_id": Uuid::new_v4(),
            "amount": 500.00,
            "period_start": "2026-09-01",
            "period_end": "2026-09-30"
        });
        assert!(
            serde_json::from_value::<CreateBudgetRequest>(payload).is_err(),
            "numeric amount must fail deserialization"
        );
        let ok: CreateBudgetRequest = serde_json::from_value(json!({
            "category_id": Uuid::new_v4(),
            "amount": "500.00",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30"
        }))
        .unwrap();
        assert_eq!(ok.amount, "500.00");
    }

    #[test]
    fn amount_serializes_as_string_never_float() {
        let resp = BudgetResponse {
            id: Uuid::new_v4(),
            category_id: Uuid::new_v4(),
            amount: Decimal::new(50000, 2),
            currency: "COP".into(),
            period_start: date(2026, 9, 1),
            period_end: date(2026, 9, 30),
            warn_threshold: 0.8,
            over_threshold: 1.0,
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("500.00".into()));
        assert_eq!(v["warn_threshold"], json!(0.8));
    }

    #[test]
    fn budget_sql_scopes_every_query_by_user_id() {
        for sql in [CREATE_BUDGET_SQL, LIST_BUDGETS_SQL, GET_BUDGET_SQL] {
            assert!(
                sql.contains("user_id"),
                "budget SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_BUDGET_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_BUDGET_SQL}"
        );
    }

    #[test]
    fn status_aggregate_is_single_expense_sum_in_period() {
        // One aggregate round-trip: SUM over expenses in the period. No N+1:
        // a single statement (no stacked queries), transfers excluded by type.
        assert_eq!(STATUS_SPENT_SQL.matches(';').count(), 0);
        for fragment in [
            "SUM(",
            "type='expense'",
            "occurred_on BETWEEN",
            "category_id",
            "user_id",
        ] {
            assert!(
                STATUS_SPENT_SQL.contains(fragment),
                "status aggregate must contain {fragment}, got: {STATUS_SPENT_SQL}"
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
        let email = format!("bud-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("budget test")
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

    async fn seed_finance_category(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance','Food') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .expect("seed finance category")
    }

    async fn seed_account(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(pool)
        .await
        .expect("seed account")
    }

    async fn record_expense(
        state: &AppState,
        headers: &HeaderMap,
        account_id: Uuid,
        category_id: Uuid,
        amount: &str,
    ) {
        use crate::routes::transactions::{create_transaction_handler, CreateTransactionRequest};
        let body = Json(CreateTransactionRequest {
            account_id,
            transaction_type: "expense".into(),
            amount: amount.into(),
            occurred_on: "2026-09-10".into(),
            category_id: Some(category_id),
            description: None,
            notes: None,
            payment_method: None,
        });
        let (status, _) = create_transaction_handler(State(state.clone()), headers.clone(), body)
            .await
            .expect("seed expense is 201");
        assert_eq!(status, StatusCode::CREATED);
    }

    fn budget_body(category_id: Uuid) -> Json<CreateBudgetRequest> {
        Json(CreateBudgetRequest {
            category_id,
            amount: "100.00".into(),
            period_start: "2026-09-01".into(),
            period_end: "2026-09-30".into(),
            warn_threshold: None,
            over_threshold: None,
            notes: None,
        })
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    #[tokio::test]
    async fn create_budget_201_and_status_tracks_ok_warn_over() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_budget_201_and_status_tracks_ok_warn_over: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let category_id = seed_finance_category(&pool, user_id).await;
        let account_id = seed_account(&pool, user_id).await;
        let (status, created) = create_budget_handler(
            State(state.clone()),
            headers.clone(),
            budget_body(category_id),
        )
        .await
        .expect("create budget is 201");
        assert_eq!(status, StatusCode::CREATED);
        // No spend yet: ok, spent 0, remaining full.
        let fresh = budget_status_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("status is 200");
        assert_eq!(fresh.status, "ok");
        assert_eq!(fresh.spent, Decimal::new(0, 2));
        assert_eq!(fresh.remaining, Decimal::new(10000, 2));
        // 85% spend → warn (defaults 0.8 / 1.0).
        record_expense(&state, &headers, account_id, category_id, "85.00").await;
        let warned = budget_status_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("status is 200");
        assert_eq!(warned.status, "warn");
        assert_eq!(warned.spent, Decimal::new(8500, 2));
        assert_eq!(warned.remaining, Decimal::new(1500, 2));
        assert!((warned.pct - 0.85).abs() < 1e-9);
        // 110% spend → over, remaining negative.
        record_expense(&state, &headers, account_id, category_id, "25.00").await;
        let over = budget_status_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("status is 200");
        assert_eq!(over.status, "over");
        assert_eq!(over.spent, Decimal::new(11000, 2));
        assert_eq!(over.remaining, Decimal::new(-1000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn invalid_period_and_amount_are_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP invalid_period_and_amount_are_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let category_id = seed_finance_category(&pool, user_id).await;
        // Inverted period.
        let mut bad = budget_body(category_id);
        bad.period_start = "2026-09-30".into();
        bad.period_end = "2026-09-01".into();
        let err = create_budget_handler(State(state.clone()), headers.clone(), bad)
            .await
            .expect_err("inverted period must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        // Zero amount.
        let mut bad = budget_body(category_id);
        bad.amount = "0.00".into();
        let err = create_budget_handler(State(state.clone()), headers.clone(), bad)
            .await
            .expect_err("zero amount must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn non_finance_and_foreign_category_are_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP non_finance_and_foreign_category_are_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        // Habit-kind category owned by the user → 422 (never 404).
        let habit_cat: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'habit','Exercise') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed habit category");
        let err = create_budget_handler(
            State(state.clone()),
            headers.clone(),
            budget_body(habit_cat),
        )
        .await
        .expect_err("habit-kind category must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        // Finance category owned by ANOTHER user → 422 (no existence oracle).
        let (other_state, _, other_user) = db_state(&pool).await;
        let foreign_cat = seed_finance_category(&pool, other_user).await;
        let err = create_budget_handler(
            State(state.clone()),
            headers.clone(),
            budget_body(foreign_cat),
        )
        .await
        .expect_err("foreign category must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let _ = other_state;
        cleanup_user(&pool, user_id).await;
        cleanup_user(&pool, other_user).await;
    }

    #[tokio::test]
    async fn foreign_budget_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_budget_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let category_id = seed_finance_category(&pool, user_a).await;
        let budget_id: Uuid = sqlx::query_scalar(
            "INSERT INTO budgets (user_id, category_id, amount, period_start, period_end) VALUES ($1,$2,100.00,'2026-09-01','2026-09-30') RETURNING id",
        )
        .bind(user_a)
        .bind(category_id)
        .fetch_one(&pool)
        .await
        .expect("seed budget");
        for err in [
            get_budget_handler(State(state_b.clone()), headers_b.clone(), Path(budget_id))
                .await
                .expect_err("foreign budget must be 404"),
            budget_status_handler(State(state_b.clone()), headers_b.clone(), Path(budget_id))
                .await
                .expect_err("foreign status must be 404"),
        ] {
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::NOT_FOUND
            );
        }
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn reconciliation_signed_sum_matches_cached_balance() {
        // Task 5.2: income adds, expenses subtract, transfers net to zero, so
        // the signed transaction total must equal the trigger-maintained
        // `accounts.balance` for every account.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP reconciliation_signed_sum_matches_cached_balance: no DATABASE_URL");
            return;
        };
        use crate::routes::transactions::{create_transaction_handler, CreateTransactionRequest};
        use crate::routes::transfers::{create_transfer_handler, CreateTransferRequest};
        let (state, headers, user_id) = db_state(&pool).await;
        let wallet = seed_account(&pool, user_id).await;
        let bank: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Bank','bank') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed bank account");
        let tx = |account_id: Uuid, kind: &str, amount: &str| CreateTransactionRequest {
            account_id,
            transaction_type: kind.into(),
            amount: amount.into(),
            occurred_on: "2026-09-10".into(),
            category_id: None,
            description: None,
            notes: None,
            payment_method: None,
        };
        for (account_id, kind, amount) in
            [(wallet, "income", "100.00"), (wallet, "expense", "30.00")]
        {
            let (status, _) = create_transaction_handler(
                State(state.clone()),
                headers.clone(),
                Json(tx(account_id, kind, amount)),
            )
            .await
            .expect("seed ledger row is 201");
            assert_eq!(status, StatusCode::CREATED);
        }
        // A transfer nets to zero across both accounts.
        let (status, _) = create_transfer_handler(
            State(state.clone()),
            headers.clone(),
            Json(CreateTransferRequest {
                from_account_id: wallet,
                to_account_id: bank,
                amount: "20.00".into(),
                occurred_on: "2026-09-11".into(),
                description: None,
            }),
        )
        .await
        .expect("seed transfer is 201");
        assert_eq!(status, StatusCode::CREATED);
        let rows: Vec<(Uuid, Decimal)> =
            sqlx::query_as("SELECT id, balance FROM accounts WHERE user_id=$1")
                .bind(user_id)
                .fetch_all(&pool)
                .await
                .expect("read balances");
        for (account_id, balance) in rows {
            let signed: Decimal = sqlx::query_scalar(
                "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount WHEN type='expense' THEN -amount ELSE 0 END),0) FROM transactions WHERE account_id=$1",
            )
            .bind(account_id)
            .fetch_one(&pool)
            .await
            .expect("signed sum");
            assert_eq!(balance, signed, "balance must equal signed ledger sum");
        }
        assert_eq!(
            sqlx::query_scalar::<_, Decimal>("SELECT balance FROM accounts WHERE id=$1")
                .bind(wallet)
                .fetch_one(&pool)
                .await
                .expect("wallet balance"),
            Decimal::new(5000, 2)
        );
        assert_eq!(
            sqlx::query_scalar::<_, Decimal>("SELECT balance FROM accounts WHERE id=$1")
                .bind(bank)
                .fetch_one(&pool)
                .await
                .expect("bank balance"),
            Decimal::new(2000, 2)
        );
        cleanup_user(&pool, user_id).await;
    }
}
