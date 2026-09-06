//! Subscriptions CRUD plus active/cancelled lifecycle, strictly scoped by `user_id`.
//!
//! Prices arrive as strings and are validated at the boundary with
//! [`parse_money_amount_nonneg`][crate::finance::money::parse_money_amount_nonneg]
//! (`>= 0`, `scale <= 2`, else 422): zero-price records are valid (free
//! tiers), unlike the strictly positive P2 money parser. The price is
//! additionally capped below `10^16` so a `NUMERIC(18,2)` overflow can never
//! surface as a 500. `frequency` is validated at the API level against the
//! `subscription_frequency` enum values (else 422, never a DB error).
//!
//! Lifecycle is PATCH-only and metadata-scoped: the PATCH DTO carries
//! `deny_unknown_fields` and accepts a single field, `is_active`.
//! Cancelling (`is_active = false`) stamps `cancelled_at = now()`;
//! reactivating (`is_active = true`) clears it back to `NULL`. There is no
//! PATCH for `price`, `frequency`, or `name` — corrections go through
//! DELETE + recreate. A `category_id` outside the owned `subscription` kind
//! is 422; foreign subscription ids resolve to 404 without leaking
//! existence.
//!
//! Registered in `routes/mod.rs` (wiring in `main.rs` lands in Phase 6).

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
    auth::helper::require_user_id, error::AppError, finance::money::parse_money_amount_nonneg,
    state::AppState,
};

const MAX_NAME_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;
const MAX_METHOD_LEN: usize = 200;
const MAX_URL_LEN: usize = 2000;

/// Mirrors the `subscription_frequency` Postgres enum; validated at the API
/// boundary so an unknown value is 422 instead of a DB error.
const SUBSCRIPTION_FREQUENCIES: &[&str] = &[
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "semiannual",
    "annual",
];

/// Parse the subscription price: non-negative money (`>= 0`, `scale <= 2`)
/// capped below `10^16` so `NUMERIC(18,2)` overflow is 422, never a 500.
pub fn validate_price(raw: &str) -> Result<Decimal, AppError> {
    let price = parse_money_amount_nonneg(raw)?;
    if price >= Decimal::new(10_000_000_000_000_000, 0) {
        return Err(AppError::Validation(
            "price exceeds the maximum storable amount".into(),
        ));
    }
    Ok(price)
}
const CREATE_SUB_SQL: &str = "INSERT INTO subscriptions (user_id, name, price, currency, frequency, next_billing_on, category_id, payment_method, url, notes) VALUES ($1,$2,$3,$4,$5::subscription_frequency,$6,$7,$8,$9,$10) RETURNING id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at";
const LIST_SUBS_SQL: &str = "SELECT id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at FROM subscriptions WHERE user_id=$1 ORDER BY created_at ASC";
const GET_SUB_SQL: &str = "SELECT id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at FROM subscriptions WHERE id=$1 AND user_id=$2";
const PATCH_SUB_SQL: &str = "UPDATE subscriptions SET is_active=$3, cancelled_at=CASE WHEN $3 THEN NULL ELSE now() END, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at";
const DELETE_SUB_SQL: &str = "DELETE FROM subscriptions WHERE id=$1 AND user_id=$2";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";

type SubscriptionRow = (
    Uuid,
    String,
    Decimal,
    String,
    String,
    Option<NaiveDate>,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    Option<DateTime<Utc>>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateSubscriptionRequest {
    pub name: String,
    /// Wire-format money string, e.g. `"9.99"` (never a JSON number).
    /// Zero (`"0.00"`) is valid: free tiers are supported.
    pub price: String,
    /// One of the `subscription_frequency` enum values (e.g. `"monthly"`).
    pub frequency: String,
    pub currency: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub next_billing_on: Option<String>,
    pub category_id: Option<Uuid>,
    pub payment_method: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchSubscriptionRequest {
    /// `false` cancels (stamps `cancelled_at`); `true` reactivates (clears it).
    pub is_active: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct SubscriptionResponse {
    pub id: Uuid,
    pub name: String,
    /// Serialized as a string (e.g. `"9.99"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub price: Decimal,
    pub currency: String,
    pub frequency: String,
    pub next_billing_on: Option<NaiveDate>,
    pub category_id: Option<Uuid>,
    pub payment_method: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
    /// Lifecycle flag; `true` at creation alongside `cancelled_at = NULL`.
    pub is_active: bool,
    pub cancelled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<SubscriptionRow> for SubscriptionResponse {
    fn from(
        row: (
            Uuid,
            String,
            Decimal,
            String,
            String,
            Option<NaiveDate>,
            Option<Uuid>,
            Option<String>,
            Option<String>,
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
            price,
            currency,
            frequency,
            next_billing_on,
            category_id,
            payment_method,
            url,
            notes,
            is_active,
            cancelled_at,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            name,
            price,
            currency,
            frequency,
            next_billing_on,
            category_id,
            payment_method,
            url,
            notes,
            is_active,
            cancelled_at,
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

/// Parse an optional calendar date (`YYYY-MM-DD`), else 422.
pub fn validate_optional_date(
    raw: Option<&str>,
    field: &'static str,
) -> Result<Option<NaiveDate>, AppError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    validate_calendar_date(raw, field).map(Some)
}

/// Validate the billing frequency against the `subscription_frequency`
/// enum values (exact match after trimming), else 422.
pub fn validate_frequency(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if SUBSCRIPTION_FREQUENCIES.contains(&normalized) {
        Ok(normalized.to_string())
    } else {
        Err(AppError::Validation(
            "frequency must be one of: daily, weekly, biweekly, monthly, quarterly, semiannual, annual"
                .into(),
        ))
    }
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

/// Reject a PATCH with no actionable field (the only writable field is
/// `is_active`).
pub fn validate_subscription_patch(body: &PatchSubscriptionRequest) -> Result<(), AppError> {
    if body.is_active.is_none() {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Verify the category is owned AND `kind='subscription'` (else 422 per
/// design: FK + kind mismatch + unowned all map to 422, never 404).
pub async fn ensure_subscription_category(
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
        Some("subscription") => Ok(()),
        _ => Err(AppError::Validation(
            "category must be an owned subscription category".into(),
        )),
    }
}

/// Map subscription write errors: `23514` (check) and `22P02` (invalid enum
/// text — belt-and-braces behind the API guard) → 422; `23503` (category FK
/// raced away) → 422; everything else is internal (never leaked). There is
/// no unique constraint on subscriptions, so no 409 mapping.
fn map_sub_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("invalid subscription data".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

pub async fn create_subscription_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSubscriptionRequest>,
) -> Result<(StatusCode, Json<SubscriptionResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_required_text(&body.name, MAX_NAME_LEN, "name")?;
    let price = validate_price(&body.price)?;
    let frequency = validate_frequency(&body.frequency)?;
    let currency = validate_currency(body.currency.as_deref())?;
    let next_billing_on =
        validate_optional_date(body.next_billing_on.as_deref(), "next_billing_on")?;
    if let Some(category_id) = body.category_id {
        ensure_subscription_category(&state.pool, category_id, user_id).await?;
    }
    validate_optional_text(
        body.payment_method.as_deref(),
        MAX_METHOD_LEN,
        "payment_method",
    )?;
    validate_optional_text(body.url.as_deref(), MAX_URL_LEN, "url")?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    let row = sqlx::query_as::<_, SubscriptionRow>(CREATE_SUB_SQL)
        .bind(user_id)
        .bind(&name)
        .bind(price)
        .bind(&currency)
        .bind(&frequency)
        .bind(next_billing_on)
        .bind(body.category_id)
        .bind(body.payment_method.as_deref())
        .bind(body.url.as_deref())
        .bind(body.notes.as_deref())
        .fetch_one(&state.pool)
        .await
        .map_err(map_sub_db_err)?;
    Ok((StatusCode::CREATED, Json(SubscriptionResponse::from(row))))
}

pub async fn list_subscriptions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<SubscriptionResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, SubscriptionRow>(LIST_SUBS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(
        rows.into_iter().map(SubscriptionResponse::from).collect(),
    ))
}

pub async fn get_subscription_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<SubscriptionResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, SubscriptionRow>(GET_SUB_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(SubscriptionResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn patch_subscription_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchSubscriptionRequest>,
) -> Result<Json<SubscriptionResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_subscription_patch(&body)?;
    // `is_active` is the only writable field (`deny_unknown_fields` rejects
    // the rest at the boundary): false stamps `cancelled_at`, true clears it.
    let is_active = body.is_active.unwrap_or(true);
    let row = sqlx::query_as::<_, SubscriptionRow>(PATCH_SUB_SQL)
        .bind(id)
        .bind(user_id)
        .bind(is_active)
        .fetch_optional(&state.pool)
        .await
        .map_err(map_sub_db_err)?;
    row.map(|r| Json(SubscriptionResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn delete_subscription_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_SUB_SQL)
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
        assert_eq!(
            validate_required_text("  Netflix ", MAX_NAME_LEN, "name").unwrap(),
            "Netflix"
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
    fn accepts_iso_dates_and_rejects_bad_dates_as_422() {
        assert_eq!(
            validate_calendar_date("2026-03-01", "next_billing_on").unwrap(),
            NaiveDate::from_ymd_opt(2026, 3, 1).unwrap()
        );
        assert_eq!(
            validate_optional_date(Some("2026-12-31"), "next_billing_on").unwrap(),
            Some(NaiveDate::from_ymd_opt(2026, 12, 31).unwrap())
        );
        assert_eq!(
            validate_optional_date(None, "next_billing_on").unwrap(),
            None
        );
        for raw in ["", "2026-13-01", "2026-02-30", "01/03/2026", "not-a-date"] {
            assert_422(validate_calendar_date(raw, "next_billing_on").unwrap_err());
        }
    }

    #[test]
    fn price_accepts_zero_for_free_tiers() {
        // Unlike the strictly positive P2 parser, subscriptions allow `>= 0`.
        assert_eq!(validate_price("0.00").unwrap(), Decimal::ZERO);
        assert_eq!(validate_price("0").unwrap(), Decimal::ZERO);
        assert_eq!(validate_price("9.99").unwrap(), Decimal::new(999, 2));
        assert_eq!(validate_price("  5.00  ").unwrap(), Decimal::new(500, 2));
        assert_eq!(
            validate_price("9999999999999999.99").unwrap(),
            Decimal::new(999999999999999999i64, 2)
        );
    }

    #[test]
    fn price_rejects_negative_bad_scale_and_overflow_as_422() {
        for raw in ["abc", "", "-5.00", "-0.01", "10.005"] {
            assert_422(validate_price(raw).unwrap_err());
        }
        // 17+ integer digits cannot fit NUMERIC(18,2): 422, never a 500.
        assert_422(validate_price("99999999999999999.99").unwrap_err());
        assert_422(validate_price("100000000000000000.00").unwrap_err());
    }

    #[test]
    fn frequency_accepts_all_enum_values() {
        for raw in [
            "daily",
            "weekly",
            "biweekly",
            "monthly",
            "quarterly",
            "semiannual",
            "annual",
        ] {
            assert_eq!(validate_frequency(raw).unwrap(), raw);
        }
        assert_eq!(validate_frequency("  monthly ").unwrap(), "monthly");
    }

    #[test]
    fn frequency_rejects_unknown_values_as_422() {
        for raw in ["", "Monthly", "MONTHLY", "fortnightly", "yearly", "never"] {
            assert_422(validate_frequency(raw).unwrap_err());
        }
    }

    #[test]
    fn price_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({
            "name": "Netflix",
            "price": 9.99,
            "frequency": "monthly"
        });
        assert!(
            serde_json::from_value::<CreateSubscriptionRequest>(payload).is_err(),
            "numeric price must fail deserialization"
        );
        let ok: CreateSubscriptionRequest = serde_json::from_value(json!({
            "name": "Netflix",
            "price": "9.99",
            "frequency": "monthly"
        }))
        .unwrap();
        assert_eq!(ok.price, "9.99");
    }

    #[test]
    fn lifecycle_fields_are_never_writable_on_create() {
        // `is_active` / `cancelled_at` are lifecycle-owned; `deny_unknown_fields`
        // turns them into 422 at the boundary.
        for payload in [
            json!({
                "name": "Netflix", "price": "9.99", "frequency": "monthly",
                "is_active": false
            }),
            json!({
                "name": "Netflix", "price": "9.99", "frequency": "monthly",
                "cancelled_at": "2026-01-01T00:00:00Z"
            }),
        ] {
            assert!(
                serde_json::from_value::<CreateSubscriptionRequest>(payload).is_err(),
                "lifecycle field must fail deserialization"
            );
        }
    }

    #[test]
    fn patch_accepts_only_is_active() {
        let ok: PatchSubscriptionRequest =
            serde_json::from_value(json!({"is_active": false})).unwrap();
        assert_eq!(ok.is_active, Some(false));
        // Core fields are not patchable: 422 at the boundary.
        for payload in [
            json!({"is_active": false, "price": "4.99"}),
            json!({"is_active": true, "frequency": "annual"}),
            json!({"is_active": true, "name": "Other"}),
            json!({"price": "4.99"}),
        ] {
            assert!(
                serde_json::from_value::<PatchSubscriptionRequest>(payload).is_err(),
                "non-lifecycle patch field must fail deserialization"
            );
        }
    }

    #[test]
    fn patch_rejects_empty_body_as_422() {
        let body: PatchSubscriptionRequest = serde_json::from_value(json!({})).unwrap();
        assert_422(validate_subscription_patch(&body).unwrap_err());
        let body = PatchSubscriptionRequest {
            is_active: Some(true),
        };
        assert!(validate_subscription_patch(&body).is_ok());
    }

    #[test]
    fn price_serializes_as_string_never_float() {
        let resp = SubscriptionResponse {
            id: Uuid::new_v4(),
            name: "Netflix".into(),
            price: Decimal::new(999, 2),
            currency: "COP".into(),
            frequency: "monthly".into(),
            next_billing_on: None,
            category_id: None,
            payment_method: None,
            url: None,
            notes: None,
            is_active: true,
            cancelled_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["price"], serde_json::Value::String("9.99".into()));
        assert_eq!(v["is_active"], serde_json::Value::Bool(true));
    }

    #[test]
    fn subscription_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_SUB_SQL,
            LIST_SUBS_SQL,
            GET_SUB_SQL,
            PATCH_SUB_SQL,
            DELETE_SUB_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "subscription SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            GET_SUB_SQL.contains("id=$1 AND user_id=$2"),
            "detail lookup must scope id+user_id, got: {GET_SUB_SQL}"
        );
        assert!(
            DELETE_SUB_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_SUB_SQL}"
        );
        assert!(
            PATCH_SUB_SQL.contains("id=$1 AND user_id=$2"),
            "patch must scope id+user_id, got: {PATCH_SUB_SQL}"
        );
        assert!(
            PATCH_SUB_SQL.contains("cancelled_at=CASE"),
            "patch must own the cancelled_at lifecycle, got: {PATCH_SUB_SQL}"
        );
        assert!(
            CATEGORY_LOOKUP_SQL.contains("kind::text"),
            "category lookup must read kind as text, got: {CATEGORY_LOOKUP_SQL}"
        );
        assert!(
            CREATE_SUB_SQL.contains("$5::subscription_frequency"),
            "create must cast the frequency bind to the enum, got: {CREATE_SUB_SQL}"
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
        let email = format!("sub-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("sub test")
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

    fn create_body(name: &str) -> Json<CreateSubscriptionRequest> {
        Json(
            serde_json::from_value(json!({
                "name": name,
                "price": "9.99",
                "frequency": "monthly"
            }))
            .expect("valid subscription body"),
        )
    }

    async fn seed_category(pool: &sqlx::PgPool, user_id: Uuid, kind: &str, name: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,$2::category_kind,$3) RETURNING id",
        )
        .bind(user_id)
        .bind(kind)
        .bind(format!("{name}-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed category")
    }

    #[tokio::test]
    async fn create_201_active_then_get_200_then_delete_204() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_201_active_then_get_200_then_delete_204: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Netflix"),
        )
        .await
        .expect("create subscription is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.price, Decimal::new(999, 2));
        assert_eq!(created.frequency, "monthly");
        assert!(created.is_active);
        assert_eq!(created.cancelled_at, None);
        let got = get_subscription_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("get own subscription is 200");
        assert_eq!(got.name, "Netflix");
        let listed = list_subscriptions_handler(State(state.clone()), headers.clone())
            .await
            .expect("list subscriptions is 200");
        assert!(listed.iter().any(|s| s.id == created.id));
        let status =
            delete_subscription_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn create_free_subscription_201_accepts_zero_price() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_free_subscription_201_accepts_zero_price: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let body = Json(
            serde_json::from_value(json!({
                "name": "Free Tier",
                "price": "0.00",
                "frequency": "monthly"
            }))
            .expect("valid free body"),
        );
        let (status, created) =
            create_subscription_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect("free subscription is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.price, Decimal::ZERO);
        assert!(created.is_active);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn cancel_200_stamps_cancelled_at_then_reactivate_200_clears_it() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP cancel_200_stamps_cancelled_at_then_reactivate_200_clears_it: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (status, created) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Spotify"),
        )
        .await
        .expect("create is 201");
        assert_eq!(status, StatusCode::CREATED);
        let cancel =
            Json(serde_json::from_value(json!({"is_active": false})).expect("valid cancel patch"));
        let cancelled = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            cancel,
        )
        .await
        .expect("cancel is 200");
        assert!(!cancelled.is_active);
        assert!(cancelled.cancelled_at.is_some());
        let reactivate = Json(
            serde_json::from_value(json!({"is_active": true})).expect("valid reactivate patch"),
        );
        let active = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            reactivate,
        )
        .await
        .expect("reactivate is 200");
        assert!(active.is_active);
        assert_eq!(active.cancelled_at, None);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn create_with_wrong_category_kind_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_with_wrong_category_kind_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        // `finance` is a valid category kind, but subscriptions require
        // `subscription`.
        let finance_cat = seed_category(&pool, user_id, "finance", "budgets").await;
        let body = Json(
            serde_json::from_value(json!({
                "name": "Netflix",
                "price": "9.99",
                "frequency": "monthly",
                "category_id": finance_cat
            }))
            .expect("valid body with wrong-kind category"),
        );
        let err = create_subscription_handler(State(state.clone()), headers.clone(), body)
            .await
            .expect_err("wrong category kind must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        let sub_cat = seed_category(&pool, user_id, "subscription", "streaming").await;
        let body = Json(
            serde_json::from_value(json!({
                "name": "Netflix",
                "price": "9.99",
                "frequency": "monthly",
                "category_id": sub_cat
            }))
            .expect("valid body with subscription category"),
        );
        let (status, created) =
            create_subscription_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect("subscription-kind category is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.category_id, Some(sub_cat));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn create_with_invalid_money_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_with_invalid_money_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        for price in ["abc", "", "-5.00", "10.005"] {
            let body = Json(
                serde_json::from_value(json!({
                    "name": "Netflix",
                    "price": price,
                    "frequency": "monthly"
                }))
                .expect("body with bad price"),
            );
            let err = create_subscription_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect_err("bad price must be 422");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_subscription_access_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_subscription_access_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let sub_id: Uuid = sqlx::query_scalar(
            "INSERT INTO subscriptions (user_id, name, price, currency, frequency) VALUES ($1,'Mine',999,'COP','monthly') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed subscription");
        let err = get_subscription_handler(State(state_b.clone()), headers_b.clone(), Path(sub_id))
            .await
            .expect_err("foreign subscription get must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let patch = Json(serde_json::from_value(json!({"is_active": false})).expect("valid patch"));
        let err = patch_subscription_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(sub_id),
            patch,
        )
        .await
        .expect_err("foreign subscription patch must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let err = delete_subscription_handler(State(state_b.clone()), headers_b, Path(sub_id))
            .await
            .expect_err("foreign subscription delete must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }
}
