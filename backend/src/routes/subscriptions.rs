//! Subscriptions CRUD plus active/cancelled lifecycle and the Pay action,
//! strictly scoped by `user_id`.
//!
//! Prices arrive as strings and are validated at the boundary with
//! [`parse_money_amount_nonneg`][crate::finance::money::parse_money_amount_nonneg]
//! (`>= 0`, `scale <= 2`, else 422): zero-price records are valid (free
//! tiers), unlike the strictly positive P2 money parser. The price is
//! additionally capped below [`MAX_MONEY_AMOUNT`][crate::finance::money::MAX_MONEY_AMOUNT]
//! (10^9, shared with the movements ledger) on create/patch, and Pay
//! re-checks the locked stored price before inserting its audit movement, so
//! a pre-existing row written under the old 1e16 cap is 422 instead of
//! creating an invalid ledger row; `NUMERIC(18,2)` overflow can never
//! surface as a 500. `frequency` is monthly-only at the API level (absent or
//! `"monthly"` accepted, anything else 422, never a DB error); the
//! `subscription_frequency` column/enum stay in the database as vestigial.
//!
//! Lifecycle is PATCH-based and metadata-scoped: the PATCH DTO carries
//! `deny_unknown_fields` and accepts exactly
//! `name | price | next_billing_on | is_active`. Cancelling
//! (`is_active = false`) stamps `cancelled_at = now()`; reactivating
//! (`is_active = true`) clears it back to `NULL`. A category outside the
//! owned set is 422 regardless of kind (D3); foreign subscription ids
//! resolve to 404 without leaking existence.
//!
//! Pay (`POST /api/subscriptions/{id}/pay`) runs one transaction that locks
//! the account first, then the subscription (`SELECT ... FOR UPDATE`), guards
//! (account foreign/missing/archived → one uniform 422, inactive → 422, price
//! zero → 422, stored price at/above the cap → 422, paid this cycle → 409),
//! idempotently seeds the fixed `Suscripciones` category, inserts the audit
//! movement, debits the account, stamps `last_paid_on` and advances
//! `next_billing_on`. The lock-first order mirrors the movements ledger
//! discipline (design §Data Flow) so concurrent payers serialize instead of
//! deadlocking.
//!
//! "Paid this cycle" stays `last_paid_on` set and `next_billing_on` still in
//! the future, so the pay button re-enables exactly when the due date arrives.
//! The client-writable due date is closed at its write instead: `PATCH`
//! rejects any backwards move of `next_billing_on` against the stored due date
//! and still rejects a value on or before `last_paid_on` (422), both read under
//! the same transaction that updates the row, so paying and then moving the due
//! date backwards can no longer re-open a second pay for the same cycle.
//!
//! Registered in `routes/mod.rs` (pay wiring in `main.rs`, S-B slice).

use axum::{
    extract::{Path, Query, State},
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
    finance::{
        dates::{advance_next_billing, today_bogota},
        money::{parse_money_amount_nonneg, MAX_MONEY_AMOUNT},
        validation::ensure_owned_category,
    },
    routes::{parse_read_shape, ShapeQuery},
    state::AppState,
};

const MAX_NAME_LEN: usize = 200;
const MAX_TEXT_LEN: usize = 2000;
const MAX_METHOD_LEN: usize = 200;
const MAX_URL_LEN: usize = 2000;

/// Parse the subscription price: non-negative money (`>= 0`, `scale <= 2`)
/// capped below the shared `MAX_MONEY_AMOUNT` (10^9). The cap is enforced on
/// create/patch and guarded again on Pay (see `pay_subscription_handler`), so
/// a pre-existing oversized row cannot insert an invalid ledger movement.
pub fn validate_price(raw: &str) -> Result<Decimal, AppError> {
    let price = parse_money_amount_nonneg(raw)?;
    if price >= Decimal::from(MAX_MONEY_AMOUNT) {
        return Err(AppError::Validation(
            "el precio debe ser menor a 1000000000".into(),
        ));
    }
    Ok(price)
}
const CREATE_SUB_SQL: &str = "INSERT INTO subscriptions (user_id, name, price, currency, frequency, next_billing_on, category_id, payment_method, url, notes) VALUES ($1,$2,$3,$4,$5::subscription_frequency,$6,$7,$8,$9,$10) RETURNING id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at, last_paid_on";
const LIST_SUBS_SQL: &str = "SELECT id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at, last_paid_on FROM subscriptions WHERE user_id=$1 ORDER BY created_at ASC";
/// Brief shape (`?shape=brief`): exactly the eight fields the browser views
/// read from a subscription. The WHERE scope and ORDER BY are the full
/// list's verbatim; dropped for the browser are category_id,
/// payment_method, url, notes, cancelled_at, created_at, updated_at (the
/// MCP keeps the full projection).
const LIST_SUBS_BRIEF_SQL: &str =
    "SELECT id, name, price, currency, frequency::text, next_billing_on, is_active, last_paid_on FROM subscriptions WHERE user_id=$1 ORDER BY created_at ASC";
const GET_SUB_SQL: &str = "SELECT id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at, last_paid_on FROM subscriptions WHERE id=$1 AND user_id=$2";
const PATCH_SUB_SQL: &str = "UPDATE subscriptions SET name=COALESCE($3, name), price=COALESCE($4, price), next_billing_on=COALESCE($5, next_billing_on), is_active=COALESCE($6, is_active), cancelled_at=CASE WHEN $6 IS NULL THEN cancelled_at WHEN $6 THEN NULL ELSE COALESCE(cancelled_at, now()) END, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at, last_paid_on";
/// PATCH pre-write lock: the pay state (`last_paid_on` plus the stored
/// `next_billing_on`) is read under `FOR UPDATE` on the owned row, inside the
/// same transaction that writes the new due date, so the backwards-due-date
/// guard cannot be raced by a concurrent pay (design §Data Flow lock-first
/// discipline; no check-then-act).
const PATCH_LOCK_LAST_PAID_SQL: &str =
    "SELECT last_paid_on, next_billing_on FROM subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE";
const DELETE_SUB_SQL: &str = "DELETE FROM subscriptions WHERE id=$1 AND user_id=$2";
/// Pay-time account lock. Carries the currency so the handler can enforce the
/// same-currency rule against the subscription before any ledger row or debit
/// is written (mirrors `LOCK_TRANSFER_ACCOUNTS_SQL` in `movements.rs`).
/// `AND NOT is_archived` rejects archived accounts under the same row lock
/// (no check-then-act): the handler maps the miss to one 422 that names
/// neither existence nor the flag, so foreign, missing and archived ids are
/// indistinguishable.
const PAY_LOCK_ACCOUNT_SQL: &str =
    "SELECT id, currency FROM accounts WHERE id=$1 AND user_id=$2 AND NOT is_archived FOR UPDATE";
/// Pay lock on the subscription row; also carries `last_paid_on` and
/// `next_billing_on` so the paid-cycle guard is evaluated on the locked row.
const PAY_LOCK_SUB_SQL: &str = "SELECT id, price, is_active, next_billing_on, last_paid_on, currency FROM subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE";
const SEED_CATEGORY_SQL: &str = "INSERT INTO categories (user_id, kind, name) VALUES ($1, 'finance'::category_kind, 'Suscripciones') ON CONFLICT (user_id, kind, name) DO UPDATE SET name = EXCLUDED.name RETURNING id";
const PAY_INSERT_MOVEMENT_SQL: &str = "INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on, description, subscription_id) VALUES ($1,$2,$3,'expense',$4,$5,NULL,$6)";
const PAY_DEBIT_ACCOUNT_SQL: &str =
    "UPDATE accounts SET balance = balance - $2, updated_at = now() WHERE id=$1 AND user_id=$3";
const PAY_UPDATE_SUB_SQL: &str = "UPDATE subscriptions SET last_paid_on=$3, next_billing_on=$4, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, name, price, currency, frequency::text, next_billing_on, category_id, payment_method, url, notes, is_active, cancelled_at, created_at, updated_at, last_paid_on";

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
    Option<NaiveDate>,
);

/// Pay-time locked subscription: id, price, is_active, next_billing_on,
/// last_paid_on, currency.
type PayLockedRow = (
    Uuid,
    Decimal,
    bool,
    Option<NaiveDate>,
    Option<NaiveDate>,
    String,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateSubscriptionRequest {
    pub name: String,
    /// Wire-format money string, e.g. `"9.99"` (never a JSON number).
    /// Zero (`"0.00"`) is valid: free tiers are supported.
    pub price: String,
    /// Monthly-only: absent or `"monthly"` stores `monthly`; anything else
    /// is 422. The column/enum stay vestigial in the database.
    pub frequency: Option<String>,
    pub currency: Option<String>,
    /// Calendar date `YYYY-MM-DD` (required: every subscription has a
    /// monthly due date).
    pub next_billing_on: String,
    pub category_id: Option<Uuid>,
    pub payment_method: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchSubscriptionRequest {
    /// Widened allowlist (exactly these four fields): omitted fields keep
    /// their stored value; `cancelled_at` stays server-owned
    /// (`is_active = false` stamps it, `true` clears it).
    pub name: Option<String>,
    /// Wire-format money string (`>= 0`, `scale <= 2`).
    pub price: Option<String>,
    /// Calendar date `YYYY-MM-DD`.
    pub next_billing_on: Option<String>,
    /// `false` cancels (stamps `cancelled_at`); `true` reactivates (clears it).
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaySubscriptionRequest {
    /// Owned, non-archived account to debit. Foreign, missing and archived
    /// all resolve to the same 422, never 403 (and never a 404 that would
    /// distinguish "not yours" from "archived").
    pub account_id: Uuid,
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
    /// Date of the last successful pay in `America/Bogota` (`NULL` = never
    /// paid). Combined with `next_billing_on`, it derives the paid-this-cycle
    /// state lazily: paid when `last_paid_on IS NOT NULL AND
    /// next_billing_on > today`. A paid row's due date may only move forward
    /// (`PATCH` rejects a backwards move against the stored due date and any
    /// `next_billing_on <= last_paid_on` with 422).
    pub last_paid_on: Option<NaiveDate>,
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
            Option<NaiveDate>,
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
            last_paid_on,
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
            last_paid_on,
        }
    }
}

/// Brief subscription row: id, name, price, currency, frequency,
/// next_billing_on, is_active, last_paid_on (S12 order).
type SubscriptionBriefRow = (
    Uuid,
    String,
    Decimal,
    String,
    String,
    Option<NaiveDate>,
    bool,
    Option<NaiveDate>,
);

/// Brief subscription response (`?shape=brief`): id, name, price, currency,
/// frequency, next_billing_on, is_active, last_paid_on.
#[derive(Debug, Serialize)]
pub struct SubscriptionBriefResponse {
    pub id: Uuid,
    pub name: String,
    /// Serialized as a string (e.g. `"9.99"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub price: Decimal,
    pub currency: String,
    pub frequency: String,
    pub next_billing_on: Option<NaiveDate>,
    /// Lifecycle flag; `true` at creation alongside `cancelled_at = NULL`.
    pub is_active: bool,
    /// Date of the last successful pay in `America/Bogota` (`NULL` = never
    /// paid).
    pub last_paid_on: Option<NaiveDate>,
}

impl From<SubscriptionBriefRow> for SubscriptionBriefResponse {
    fn from(
        row: (
            Uuid,
            String,
            Decimal,
            String,
            String,
            Option<NaiveDate>,
            bool,
            Option<NaiveDate>,
        ),
    ) -> Self {
        let (
            id,
            name,
            price,
            currency,
            frequency,
            next_billing_on,
            is_active,
            last_paid_on,
        ) = row;
        Self {
            id,
            name,
            price,
            currency,
            frequency,
            next_billing_on,
            is_active,
            last_paid_on,
        }
    }
}

/// `GET /api/subscriptions` body: the full row set, or the brief shape the
/// SPA asks for with `?shape=brief`.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum SubscriptionsResponse {
    Full(Vec<SubscriptionResponse>),
    Brief(Vec<SubscriptionBriefResponse>),
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

/// Validate the billing frequency: absent or `"monthly"` (exact match after
/// trimming) stores `monthly`; anything else is 422.
pub fn validate_frequency(raw: Option<&str>) -> Result<String, AppError> {
    match raw {
        None => Ok("monthly".to_string()),
        Some(value) => {
            let normalized = value.trim();
            if normalized == "monthly" {
                Ok("monthly".to_string())
            } else {
                Err(AppError::Validation(
                    "frequency must be omitted or \"monthly\"".into(),
                ))
            }
        }
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

/// Reject a PATCH with no actionable field (the writable fields are exactly
/// `name | price | next_billing_on | is_active`).
pub fn validate_subscription_patch(body: &PatchSubscriptionRequest) -> Result<(), AppError> {
    if body.name.is_none()
        && body.price.is_none()
        && body.next_billing_on.is_none()
        && body.is_active.is_none()
    {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    Ok(())
}

/// Map subscription write errors: `23514` (check) and `22P02` (invalid enum
/// text — belt-and-braces behind the API guard) → 422; `23503` (category FK
/// raced away) → 422; everything else is internal (never leaked). There is
/// no unique constraint on subscriptions, so no 409 mapping.
fn map_sub_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("datos de la suscripción inválidos".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

/// Whether the locked subscription counts as paid for the cycle containing
/// `today`: `last_paid_on` set and the advanced due date still in the future.
/// Pure so both the handler and tests share one definition.
fn is_paid_this_cycle(
    last_paid_on: Option<NaiveDate>,
    next_billing_on: Option<NaiveDate>,
    today: NaiveDate,
) -> bool {
    last_paid_on.is_some() && next_billing_on.is_some_and(|due| due > today)
}

/// Pay guard: the 409 for a second submit in the cycle already covered by
/// `last_paid_on`. [`is_paid_this_cycle`] stays the single definition; this
/// shape lets the regression test assert the status without a database.
fn reject_paid_cycle(
    last_paid_on: Option<NaiveDate>,
    next_billing_on: Option<NaiveDate>,
    today: NaiveDate,
) -> Result<(), AppError> {
    if is_paid_this_cycle(last_paid_on, next_billing_on, today) {
        return Err(AppError::Conflict(
            "la suscripción ya está pagada en este ciclo".into(),
        ));
    }
    Ok(())
}

/// PATCH write guard: once a cycle has been paid, the client-writable due date
/// may only move forward. Any new value before the stored due date re-opens
/// `pay` as soon as that earlier date arrives (the F-20/JD-A-001 chain:
/// `last_paid_on + 1 day` is after the payment, so the old
/// `<= last_paid_on` check let it through). The second check keeps refusing
/// legacy rows whose stored due date predates `last_paid_on`. No `last_paid_on`
/// or no due date in the payload → nothing to guard.
fn reject_due_date_into_paid_cycle(
    next_billing_on: Option<NaiveDate>,
    stored_next_billing_on: Option<NaiveDate>,
    last_paid_on: Option<NaiveDate>,
) -> Result<(), AppError> {
    let (Some(next_billing_on), Some(last_paid_on)) = (next_billing_on, last_paid_on) else {
        return Ok(());
    };
    if stored_next_billing_on.is_some_and(|stored| next_billing_on < stored) {
        return Err(AppError::Validation(
            "una suscripción pagada solo puede mover su fecha de cobro hacia adelante".into(),
        ));
    }
    if next_billing_on <= last_paid_on {
        return Err(AppError::Validation(
            "next_billing_on no puede ser anterior o igual a la última fecha de pago".into(),
        ));
    }
    Ok(())
}

pub async fn create_subscription_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateSubscriptionRequest>,
) -> Result<(StatusCode, Json<SubscriptionResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let name = validate_required_text(&body.name, MAX_NAME_LEN, "name")?;
    let price = validate_price(&body.price)?;
    let frequency = validate_frequency(body.frequency.as_deref())?;
    let currency = validate_currency(body.currency.as_deref())?;
    let next_billing_on = validate_calendar_date(&body.next_billing_on, "next_billing_on")?;
    if let Some(category_id) = body.category_id {
        ensure_owned_category(&state.pool, category_id, user_id).await?;
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
    Query(query): Query<ShapeQuery>,
) -> Result<Json<SubscriptionsResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let shape = parse_read_shape(query.shape.as_deref())?;
    if shape.is_brief() {
        let rows = sqlx::query_as::<_, SubscriptionBriefRow>(LIST_SUBS_BRIEF_SQL)
            .bind(user_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!("list_subscriptions failed: {e:?}");
                AppError::Internal
            })?;
        return Ok(Json(SubscriptionsResponse::Brief(
            rows.into_iter()
                .map(SubscriptionBriefResponse::from)
                .collect(),
        )));
    }
    let rows = sqlx::query_as::<_, SubscriptionRow>(LIST_SUBS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("list_subscriptions failed: {e:?}");
            AppError::Internal
        })?;
    Ok(Json(SubscriptionsResponse::Full(
        rows.into_iter().map(SubscriptionResponse::from).collect(),
    )))
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
    // Validate every provided field before touching the database so a bad
    // value is 422 with the row unchanged.
    let name = body
        .name
        .as_deref()
        .map(|raw| validate_required_text(raw, MAX_NAME_LEN, "name"))
        .transpose()?;
    let price = body
        .price
        .as_deref()
        .map(validate_price)
        .transpose()?;
    let next_billing_on = body
        .next_billing_on
        .as_deref()
        .map(|raw| validate_calendar_date(raw, "next_billing_on"))
        .transpose()?;
    // Lock-first in one transaction: the pay state is read under `FOR UPDATE`
    // and the update below runs in the same transaction, so the backwards
    // due-date guard cannot be raced by a concurrent pay.
    let mut tx = state.pool.begin().await.map_err(|_| AppError::Internal)?;
    let stored: Option<(Option<NaiveDate>, Option<NaiveDate>)> =
        sqlx::query_as(PATCH_LOCK_LAST_PAID_SQL)
            .bind(id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
    let Some((stored_last_paid_on, stored_next_billing_on)) = stored else {
        return Err(AppError::NotFound);
    };
    // A paid cycle is closed: the due date may only move forward, so both the
    // `PATCH` into the past and the `last_paid_on + 1 day` move are 422 (F-20).
    reject_due_date_into_paid_cycle(next_billing_on, stored_next_billing_on, stored_last_paid_on)?;
    // Single atomic statement: omitted fields keep their value via
    // `COALESCE`; `cancelled_at` stays server-owned (`NULL` bind keeps it,
    // `true` clears it, `false` stamps `now()` when unset).
    let row = sqlx::query_as::<_, SubscriptionRow>(PATCH_SUB_SQL)
        .bind(id)
        .bind(user_id)
        .bind(name.as_deref())
        .bind(price)
        .bind(next_billing_on)
        .bind(body.is_active)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_sub_db_err)?;
    let Some(row) = row else {
        return Err(AppError::NotFound);
    };
    tx.commit().await.map_err(|_| AppError::Internal)?;
    Ok(Json(SubscriptionResponse::from(row)))
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

pub async fn pay_subscription_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PaySubscriptionRequest>,
) -> Result<Json<SubscriptionResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let today = today_bogota();
    let mut tx = state.pool.begin().await.map_err(|_| AppError::Internal)?;
    // Lock-first (movements discipline): the account row serializes
    // concurrent payers. The lock filters archived accounts out as well
    // (S11), so a miss is one uniform 422 for foreign, missing and archived
    // ids: the caller cannot tell which one it was.
    let locked_account: Option<(Uuid, String)> = sqlx::query_as(PAY_LOCK_ACCOUNT_SQL)
        .bind(body.account_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AppError::Internal)?;
    let Some((_, account_currency)) = locked_account else {
        return Err(AppError::Validation(
            "la cuenta no existe o está archivada".into(),
        ));
    };
    // Then the subscription row: foreign/missing is 404, never 403.
    let locked: Option<PayLockedRow> = sqlx::query_as(PAY_LOCK_SUB_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AppError::Internal)?;
    let Some((_, price, is_active, next_billing_on, last_paid_on, sub_currency)) = locked else {
        return Err(AppError::NotFound);
    };
    // Same-currency rule (money integrity, mirrors the transfer path): the
    // subscription may only be paid from an account denominated in its own
    // currency. Without this the ledger row and the debit mix scales and the
    // account balance stops meaning what it says.
    if account_currency != sub_currency {
        return Err(AppError::Validation(
            "la cuenta y la suscripción deben tener la misma moneda".into(),
        ));
    }
    if !is_active {
        return Err(AppError::Validation(
            "la suscripción está cancelada y no se puede pagar".into(),
        ));
    }
    if price == Decimal::ZERO {
        return Err(AppError::Validation(
            "las suscripciones gratuitas no se pueden pagar".into(),
        ));
    }
    // Pre-existing rows (written under the old 1e16 cap) must not reach the
    // ledger: guard the locked stored price, not just the create/patch input.
    if price >= Decimal::from(MAX_MONEY_AMOUNT) {
        return Err(AppError::Validation(
            "el precio de la suscripcion supera el maximo permitido; editalo antes de pagar"
                .into(),
        ));
    }
    reject_paid_cycle(last_paid_on, next_billing_on, today)?;
    // Idempotent fixed-category seed: exact `(user_id, 'finance',
    // 'Suscripciones')` key, so a same-named row of another kind coexists
    // untouched. `DO UPDATE` (no-op) is the only way to get the existing id
    // back in one statement.
    let category_id: Uuid = sqlx::query_scalar(SEED_CATEGORY_SQL)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::Internal)?;
    let next = advance_next_billing(next_billing_on, today);
    sqlx::query(PAY_INSERT_MOVEMENT_SQL)
        .bind(user_id)
        .bind(body.account_id)
        .bind(category_id)
        .bind(price)
        .bind(today)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(map_sub_db_err)?;
    sqlx::query(PAY_DEBIT_ACCOUNT_SQL)
        .bind(body.account_id)
        .bind(price)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(map_sub_db_err)?;
    let row = sqlx::query_as::<_, SubscriptionRow>(PAY_UPDATE_SUB_SQL)
        .bind(id)
        .bind(user_id)
        .bind(today)
        .bind(next)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::Internal)?;
    tx.commit().await.map_err(|_| AppError::Internal)?;
    Ok(Json(SubscriptionResponse::from(row)))
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
        // Same COP-scale cap as the ledger: just below 1e9.
        assert_eq!(
            validate_price("999999999.99").unwrap(),
            Decimal::new(99_999_999_999, 2)
        );
    }

    #[test]
    fn price_rejects_negative_bad_scale_and_overflow_as_422() {
        for raw in ["abc", "", "-5.00", "-0.01", "10.005"] {
            assert_422(validate_price(raw).unwrap_err());
        }
        // The cap is MAX_MONEY_AMOUNT (1e9): Pay inserts the price into movements.
        assert_422(validate_price("1000000000").unwrap_err());
        assert_422(validate_price("2000000000").unwrap_err());
        // 17+ integer digits cannot fit NUMERIC(18,2): 422, never a 500.
        assert_422(validate_price("99999999999999999.99").unwrap_err());
        assert_422(validate_price("100000000000000000.00").unwrap_err());
    }

    #[test]
    fn frequency_defaults_to_monthly_and_rejects_other_values_as_422() {
        assert_eq!(validate_frequency(None).unwrap(), "monthly");
        assert_eq!(
            validate_frequency(Some("monthly")).unwrap(),
            "monthly"
        );
        assert_eq!(
            validate_frequency(Some("  monthly ")).unwrap(),
            "monthly"
        );
        for raw in [
            "daily",
            "weekly",
            "biweekly",
            "quarterly",
            "semiannual",
            "annual",
            "",
            "Monthly",
            "MONTHLY",
            "fortnightly",
            "never",
        ] {
            assert_422(validate_frequency(Some(raw)).unwrap_err());
        }
    }

    #[test]
    fn price_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({
            "name": "Netflix",
            "price": 9.99,
            "frequency": "monthly",
            "next_billing_on": "2026-10-15"
        });
        assert!(
            serde_json::from_value::<CreateSubscriptionRequest>(payload).is_err(),
            "numeric price must fail deserialization"
        );
        let ok: CreateSubscriptionRequest = serde_json::from_value(json!({
            "name": "Netflix",
            "price": "9.99",
            "next_billing_on": "2026-10-15"
        }))
        .unwrap();
        assert_eq!(ok.price, "9.99");
        assert_eq!(ok.frequency, None);
    }

    #[test]
    fn create_requires_next_billing_on() {
        // The monthly due date is required: omitting it fails
        // deserialization (axum surfaces it as 422).
        let payload = json!({"name": "Netflix", "price": "9.99"});
        assert!(
            serde_json::from_value::<CreateSubscriptionRequest>(payload).is_err(),
            "missing next_billing_on must fail deserialization"
        );
        let ok: CreateSubscriptionRequest = serde_json::from_value(json!({
            "name": "Netflix",
            "price": "9.99",
            "frequency": "monthly",
            "next_billing_on": "2026-10-15"
        }))
        .unwrap();
        assert_eq!(ok.next_billing_on, "2026-10-15");
    }

    #[test]
    fn lifecycle_fields_are_never_writable_on_create() {
        // `is_active` / `cancelled_at` are lifecycle-owned; `deny_unknown_fields`
        // turns them into 422 at the boundary.
        for payload in [
            json!({
                "name": "Netflix", "price": "9.99",
                "next_billing_on": "2026-10-15", "is_active": false
            }),
            json!({
                "name": "Netflix", "price": "9.99",
                "next_billing_on": "2026-10-15",
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
    fn patch_accepts_exactly_the_widened_allowlist() {
        let ok: PatchSubscriptionRequest = serde_json::from_value(json!({
            "name": "Nuevo",
            "price": "29900.00",
            "next_billing_on": "2026-11-15",
            "is_active": false
        }))
        .unwrap();
        assert_eq!(ok.name.as_deref(), Some("Nuevo"));
        assert_eq!(ok.is_active, Some(false));
        // Single-field patches stay valid (omitted fields keep their value).
        for payload in [
            json!({"is_active": false}),
            json!({"name": "Nuevo"}),
            json!({"price": "29900.00"}),
            json!({"next_billing_on": "2026-11-15"}),
        ] {
            assert!(
                serde_json::from_value::<PatchSubscriptionRequest>(payload.clone()).is_ok(),
                "allowlisted single field must deserialize: {payload}"
            );
        }
        // Non-allowlisted fields — including the old `frequency`/`currency`
        // writes and the never-writable `category_id` — are 422.
        for payload in [
            json!({"frequency": "annual"}),
            json!({"currency": "USD"}),
            json!({"category_id": "00000000-0000-0000-0000-000000000000"}),
            json!({"payment_method": "cash"}),
            json!({"url": "https://example.com"}),
            json!({"notes": "hi"}),
            json!({"is_active": true, "frequency": "monthly"}),
        ] {
            assert!(
                serde_json::from_value::<PatchSubscriptionRequest>(payload.clone()).is_err(),
                "non-allowlisted patch field must fail deserialization: {payload}"
            );
        }
    }

    #[test]
    fn patch_rejects_empty_body_as_422() {
        let body: PatchSubscriptionRequest = serde_json::from_value(json!({})).unwrap();
        assert_422(validate_subscription_patch(&body).unwrap_err());
        for body in [
            PatchSubscriptionRequest {
                name: Some("Nuevo".into()),
                price: None,
                next_billing_on: None,
                is_active: None,
            },
            PatchSubscriptionRequest {
                name: None,
                price: Some("9.99".into()),
                next_billing_on: None,
                is_active: None,
            },
            PatchSubscriptionRequest {
                name: None,
                price: None,
                next_billing_on: Some("2026-11-15".into()),
                is_active: None,
            },
            PatchSubscriptionRequest {
                name: None,
                price: None,
                next_billing_on: None,
                is_active: Some(true),
            },
        ] {
            assert!(validate_subscription_patch(&body).is_ok());
        }
    }

    #[test]
    fn pay_body_accepts_only_account_id() {
        let id = Uuid::new_v4();
        let ok: PaySubscriptionRequest =
            serde_json::from_value(json!({"account_id": id})).unwrap();
        assert_eq!(ok.account_id, id);
        assert!(
            serde_json::from_value::<PaySubscriptionRequest>(
                json!({"account_id": id, "amount": "9.99"})
            )
            .is_err(),
            "extra pay field must fail deserialization"
        );
        assert!(
            serde_json::from_value::<PaySubscriptionRequest>(json!({})).is_err(),
            "missing account_id must fail deserialization"
        );
    }

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).expect("valid test date")
    }

    #[test]
    fn paid_this_cycle_derives_from_last_paid_and_due() {
        let today = date(2026, 9, 24);
        let future = date(2026, 10, 15);
        // Paid with the due date still ahead: paid.
        assert!(is_paid_this_cycle(Some(today), Some(future), today));
        // Due date reached: pay is enabled again without any background job.
        assert!(!is_paid_this_cycle(Some(today), Some(today), today));
        // Never paid, or no due date: not paid.
        assert!(!is_paid_this_cycle(None, Some(future), today));
        assert!(!is_paid_this_cycle(Some(today), None, today));
    }

    /// The normal monthly flow, which the first cut of S13 broke: the owner
    /// pays on the due date and gets the next cycle scheduled one month out,
    /// with the guard closed right after (409) and the state consistent.
    #[test]
    fn paying_on_the_due_date_is_the_normal_monthly_cycle() {
        let due = date(2026, 11, 15);
        // Due date arrives: the previous advance no longer covers it.
        assert!(reject_paid_cycle(Some(date(2026, 10, 15)), Some(due), due).is_ok());
        // The pay itself advances the due date past `today`...
        let advanced = advance_next_billing(Some(due), due);
        assert_eq!(advanced, date(2026, 12, 15));
        // ...which is exactly what the paid predicate reads.
        assert_409(
            reject_paid_cycle(Some(due), Some(advanced), due)
                .expect_err("a second pay in the cycle just paid is 409"),
        );
        // One month later the guard opens again with no PATCH and no job.
        assert!(reject_paid_cycle(Some(due), Some(advanced), advanced).is_ok());
    }

    /// S13/F-20 regression: `PATCH next_billing_on` is client-writable, so
    /// moving the due date backwards used to re-enable `pay` for the cycle
    /// just paid. The write guard rejects every move before the stored due
    /// date, and still rejects values inside the paid cycle for legacy rows.
    #[test]
    fn patching_a_paid_due_date_backwards_is_422() {
        // day D, and the due date after the pay is D + 1 month.
        let last_paid = date(2026, 11, 14);
        let due_after_pay = date(2026, 12, 14);
        // JD-A-001 exploit: D + 1 day is after `last_paid_on`, so the old
        // guard let it through, but it is backwards against the stored due.
        let backward_err = reject_due_date_into_paid_cycle(
            Some(date(2026, 11, 15)),
            Some(due_after_pay),
            Some(last_paid),
        )
        .expect_err("D + 1 day must not reopen the paid cycle");
        assert!(
            matches!(&backward_err, AppError::Validation(msg) if msg.contains("hacia adelante")),
            "the backwards move must name the forward-only rule, got: {backward_err:?}"
        );
        assert_422(backward_err);
        // Any other backwards move against the stored due date is refused.
        assert_422(
            reject_due_date_into_paid_cycle(
                Some(date(2026, 12, 13)),
                Some(due_after_pay),
                Some(last_paid),
            )
            .expect_err("a backwards due date must not reopen a paid cycle"),
        );
        // Keeping the stored due date or moving strictly forward stays 200.
        assert!(reject_due_date_into_paid_cycle(
            Some(due_after_pay),
            Some(due_after_pay),
            Some(last_paid)
        )
        .is_ok());
        assert!(reject_due_date_into_paid_cycle(
            Some(date(2026, 12, 15)),
            Some(due_after_pay),
            Some(last_paid)
        )
        .is_ok());
        // The existing `<= last_paid_on` guard still covers legacy rows whose
        // stored due date predates the last payment.
        for inside_cycle in [date(2026, 11, 1), last_paid] {
            assert_422(
                reject_due_date_into_paid_cycle(
                    Some(inside_cycle),
                    Some(date(2026, 11, 1)),
                    Some(last_paid),
                )
                .expect_err("legacy rows still cannot move into the paid cycle"),
            );
        }
        assert!(reject_due_date_into_paid_cycle(
            Some(date(2026, 11, 15)),
            Some(date(2026, 11, 1)),
            Some(last_paid)
        )
        .is_ok());
        // Never paid, or no due date in the payload: nothing to guard.
        assert!(
            reject_due_date_into_paid_cycle(Some(date(2026, 1, 1)), Some(due_after_pay), None)
                .is_ok()
        );
        assert!(
            reject_due_date_into_paid_cycle(None, Some(due_after_pay), Some(last_paid)).is_ok()
        );
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
            last_paid_on: None,
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["price"], serde_json::Value::String("9.99".into()));
        assert_eq!(v["is_active"], serde_json::Value::Bool(true));
        assert!(v.get("last_paid_on").is_some(), "pay state must be visible");
    }

    #[test]
    fn brief_sql_selects_only_s12_columns_with_verbatim_scope_and_order() {
        assert!(
            LIST_SUBS_BRIEF_SQL.contains("user_id"),
            "brief SQL must scope by user_id, got: {LIST_SUBS_BRIEF_SQL}"
        );
        // Only the SELECT list must be free of the dropped columns: the
        // verbatim ORDER BY legitimately still mentions `created_at`.
        let select_list = LIST_SUBS_BRIEF_SQL.split(" FROM ").next().unwrap_or(LIST_SUBS_BRIEF_SQL);
        for dropped in [
            "category_id",
            "payment_method",
            "url",
            "notes",
            "cancelled_at",
            "created_at",
            "updated_at",
        ] {
            assert!(
                !select_list.contains(dropped),
                "brief SELECT must not carry `{dropped}`, got: {LIST_SUBS_BRIEF_SQL}"
            );
        }
        for kept in [
            "id",
            "name",
            "price",
            "currency",
            "frequency::text",
            "next_billing_on",
            "is_active",
            "last_paid_on",
        ] {
            assert!(
                LIST_SUBS_BRIEF_SQL.contains(kept),
                "brief SQL must keep `{kept}`, got: {LIST_SUBS_BRIEF_SQL}"
            );
        }
        assert!(
            LIST_SUBS_BRIEF_SQL.contains("ORDER BY created_at ASC"),
            "brief must keep the full list order verbatim, got: {LIST_SUBS_BRIEF_SQL}"
        );
    }

    #[test]
    fn subscription_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_SUB_SQL,
            LIST_SUBS_SQL,
            GET_SUB_SQL,
            PATCH_SUB_SQL,
            DELETE_SUB_SQL,
            PAY_LOCK_SUB_SQL,
            PAY_UPDATE_SUB_SQL,
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
            PATCH_SUB_SQL.contains("COALESCE($3, name)")
                && PATCH_SUB_SQL.contains("COALESCE($4, price)")
                && PATCH_SUB_SQL.contains("COALESCE($5, next_billing_on)")
                && PATCH_SUB_SQL.contains("COALESCE($6, is_active)"),
            "patch must COALESCE exactly the four allowlisted fields, got: {PATCH_SUB_SQL}"
        );
        assert!(
            PATCH_SUB_SQL.contains("cancelled_at=CASE WHEN $6 IS NULL"),
            "patch must own the cancelled_at lifecycle, got: {PATCH_SUB_SQL}"
        );
        assert!(
            CREATE_SUB_SQL.contains("$5::subscription_frequency"),
            "create must cast the frequency bind to the enum, got: {CREATE_SUB_SQL}"
        );
        assert!(
            CREATE_SUB_SQL.contains("last_paid_on") && GET_SUB_SQL.contains("last_paid_on"),
            "reads must project the pay state column"
        );
        assert!(
            SEED_CATEGORY_SQL.contains("ON CONFLICT (user_id, kind, name) DO UPDATE"),
            "seed must upsert on the exact key and return the id, got: {SEED_CATEGORY_SQL}"
        );
        assert!(
            SEED_CATEGORY_SQL.contains("RETURNING id"),
            "seed must return the id, got: {SEED_CATEGORY_SQL}"
        );
        assert!(
            PAY_LOCK_SUB_SQL.contains("FOR UPDATE") && PAY_LOCK_ACCOUNT_SQL.contains("FOR UPDATE"),
            "pay must lock account then subscription"
        );
        assert!(
            PAY_LOCK_SUB_SQL.contains("currency") && PAY_LOCK_ACCOUNT_SQL.contains("currency"),
            "pay must carry both currencies so the same-currency rule is enforceable"
        );
        assert!(
            PAY_LOCK_ACCOUNT_SQL.contains("NOT is_archived"),
            "the pay account lock must exclude archived accounts (S11), got: {PAY_LOCK_ACCOUNT_SQL}"
        );
        assert!(
            PATCH_LOCK_LAST_PAID_SQL.contains("last_paid_on")
                && PATCH_LOCK_LAST_PAID_SQL.contains("next_billing_on")
                && PATCH_LOCK_LAST_PAID_SQL.contains("id=$1 AND user_id=$2")
                && PATCH_LOCK_LAST_PAID_SQL.contains("FOR UPDATE"),
            "patch must read the pay state on the owned row under a lock (S13), got: {PATCH_LOCK_LAST_PAID_SQL}"
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
        // Movements block user cleanup (`ON DELETE RESTRICT` via accounts),
        // so they go first; subscriptions and accounts cascade from users.
        sqlx::query("DELETE FROM movements WHERE user_id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup movements");
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    async fn seed_account(pool: &sqlx::PgPool, user_id: Uuid, balance: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, balance) VALUES ($1,$2,$3::numeric) RETURNING id",
        )
        .bind(user_id)
        .bind(format!("acct-{}", Uuid::new_v4()))
        .bind(balance)
        .fetch_one(pool)
        .await
        .expect("seed account")
    }

    /// Archived owned account: it disappears from the listings, and the pay
    /// lock filters it out under the row lock (S11).
    async fn seed_archived_account(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        name: &str,
        balance: &str,
    ) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, balance, is_archived) VALUES ($1,$2,$3::numeric,TRUE) RETURNING id",
        )
        .bind(user_id)
        .bind(format!("{name}-{}", Uuid::new_v4()))
        .bind(balance)
        .fetch_one(pool)
        .await
        .expect("seed archived account")
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

    async fn balance_of(pool: &sqlx::PgPool, account_id: Uuid) -> Decimal {
        sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
            .bind(account_id)
            .fetch_one(pool)
            .await
            .expect("read balance")
    }

    async fn movement_count(pool: &sqlx::PgPool, user_id: Uuid) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM movements WHERE user_id=$1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("count movements")
    }

    fn create_body(name: &str, price: &str, due: &str) -> Json<CreateSubscriptionRequest> {
        Json(
            serde_json::from_value(json!({
                "name": name,
                "price": price,
                "next_billing_on": due
            }))
            .expect("valid subscription body"),
        )
    }

    async fn pay(
        state: AppState,
        headers: HeaderMap,
        sub_id: Uuid,
        account_id: Uuid,
    ) -> Result<Json<SubscriptionResponse>, AppError> {
        pay_subscription_handler(
            State(state),
            headers,
            Path(sub_id),
            Json(PaySubscriptionRequest { account_id }),
        )
        .await
    }

    /// Behavioral regression test for the pay same-currency rule: the static
    /// assertions below only prove the lock SQL carries `currency`, which stays
    /// true even if the comparison itself is deleted. Transfers already had a
    /// DB-backed cross-currency test; pay did not.
    #[tokio::test]
    async fn pay_rejects_a_cross_currency_account_and_writes_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP pay_rejects_a_cross_currency_account_and_writes_nothing: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cop: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, balance, currency) VALUES ($1,'acct-cop',$2::numeric,'COP') RETURNING id",
        )
        .bind(user_id)
        .bind("1000.00")
        .fetch_one(&pool)
        .await
        .expect("seed COP account");
        let usd_account: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, balance, currency) VALUES ($1,'acct-usd',$2::numeric,'USD') RETURNING id",
        )
        .bind(user_id)
        .bind("100.00")
        .fetch_one(&pool)
        .await
        .expect("seed USD account");
        let usd_sub: Uuid = sqlx::query_scalar(
            "INSERT INTO subscriptions (user_id, name, price, currency, frequency, next_billing_on) VALUES ($1,'sub-usd',$2::numeric,'USD','monthly'::subscription_frequency, current_date + 7) RETURNING id",
        )
        .bind(user_id)
        .bind("9.99")
        .fetch_one(&pool)
        .await
        .expect("seed USD subscription");

        let err = pay(state.clone(), headers.clone(), usd_sub, cop)
            .await
            .expect_err("a cross-currency pay must be rejected");
        assert_422(err);
        assert_eq!(balance_of(&pool, cop).await, Decimal::from(1000));
        assert_eq!(movement_count(&pool, user_id).await, 0);

        // The matching currency still pays: the rule blocks mismatches only.
        let paid = pay(state, headers, usd_sub, usd_account)
            .await
            .expect("a same-currency pay succeeds");
        assert_eq!(paid.id, usd_sub);
        assert_eq!(
            balance_of(&pool, usd_account).await,
            Decimal::from(100) - "9.99".parse::<Decimal>().expect("decimal literal")
        );
        assert_eq!(movement_count(&pool, user_id).await, 1);
        cleanup_user(&pool, user_id).await;
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
            create_body("Netflix", "9.99", "2026-10-15"),
        )
        .await
        .expect("create subscription is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.price, Decimal::new(999, 2));
        assert_eq!(created.frequency, "monthly");
        assert_eq!(
            created.next_billing_on,
            Some(NaiveDate::from_ymd_opt(2026, 10, 15).unwrap())
        );
        assert!(created.is_active);
        assert_eq!(created.cancelled_at, None);
        assert_eq!(created.last_paid_on, None);
        let got = get_subscription_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("get own subscription is 200");
        assert_eq!(got.name, "Netflix");
        let listed = list_subscriptions_handler(
            State(state.clone()),
            headers.clone(),
            Query(ShapeQuery { shape: None }),
        )
        .await
        .expect("list subscriptions is 200");
        let SubscriptionsResponse::Full(listed) = listed.0 else {
            panic!("default list must serve the full shape");
        };
        assert!(listed.iter().any(|s| s.id == created.id));
        let status =
            delete_subscription_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn create_rejects_non_monthly_frequency_and_missing_due_as_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_rejects_non_monthly_frequency_and_missing_due_as_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        for body in [
            serde_json::from_value(json!({
                "name": "Netflix", "price": "9.99",
                "frequency": "weekly", "next_billing_on": "2026-10-15"
            }))
            .expect("weekly body"),
            serde_json::from_value(json!({
                "name": "Netflix", "price": "9.99",
                "frequency": "annual", "next_billing_on": "2026-10-15"
            }))
            .expect("annual body"),
        ] {
            let err = create_subscription_handler(State(state.clone()), headers.clone(), Json(body))
                .await
                .expect_err("non-monthly frequency must be 422");
            assert_422(err);
        }
        // Explicit "monthly" is accepted and stored.
        let (status, created) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "name": "Netflix", "price": "9.99",
                    "frequency": "monthly", "next_billing_on": "2026-10-15"
                }))
                .expect("monthly body"),
            ),
        )
        .await
        .expect("explicit monthly is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.frequency, "monthly");
        assert_eq!(movement_count(&pool, user_id).await, 0);
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
                "next_billing_on": "2026-10-15"
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
        let (_, created) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Spotify", "9.99", "2026-10-15"),
        )
        .await
        .expect("create is 201");
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
    async fn widened_patch_edits_name_price_and_due() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP widened_patch_edits_name_price_and_due: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let (_, created) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Netflix", "9.99", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let patched = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(
                serde_json::from_value(json!({
                    "name": "Nuevo",
                    "price": "29900.00",
                    "next_billing_on": "2026-11-15"
                }))
                .expect("valid widened patch"),
            ),
        )
        .await
        .expect("widened patch is 200");
        assert_eq!(patched.name, "Nuevo");
        assert_eq!(patched.price, Decimal::new(2_990_000, 2));
        assert_eq!(
            patched.next_billing_on,
            Some(NaiveDate::from_ymd_opt(2026, 11, 15).unwrap())
        );
        assert!(patched.is_active);
        // A bad value is 422 with the row unchanged.
        let err = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(serde_json::from_value(json!({"price": "abc"})).expect("bad-price patch")),
        )
        .await
        .expect_err("bad price patch must be 422");
        assert_422(err);
        let got = get_subscription_handler(State(state.clone()), headers.clone(), Path(created.id))
            .await
            .expect("row still readable");
        assert_eq!(got.price, Decimal::new(2_990_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn owned_category_of_any_kind_is_accepted_foreign_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP owned_category_of_any_kind_is_accepted_foreign_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        // D3: kind no longer gates the write — a `finance`-kind category is
        // accepted on create and on edit.
        let finance_cat = seed_category(&pool, user_id, "finance", "general").await;
        let (_, created) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Json(
                serde_json::from_value(json!({
                    "name": "Netflix", "price": "9.99",
                    "next_billing_on": "2026-10-15",
                    "category_id": finance_cat
                }))
                .expect("body with finance-kind category"),
            ),
        )
        .await
        .expect("finance-kind category is 201");
        assert_eq!(created.category_id, Some(finance_cat));
        let habit_cat = seed_category(&pool, user_id, "habit", "reading").await;
        let body = Json(
            serde_json::from_value(json!({
                "name": "Netflix", "price": "9.99",
                "next_billing_on": "2026-10-15",
                "category_id": habit_cat
            }))
            .expect("body with habit-kind category"),
        );
        let (status, _) =
            create_subscription_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect("habit-kind category is 201");
        assert_eq!(status, StatusCode::CREATED);
        // Foreign or missing categories stay 422 in Spanish, never 404.
        let (other_state, _, other_user) = db_state(&pool).await;
        let foreign_cat = seed_category(&pool, other_user, "finance", "theirs").await;
        for category_id in [foreign_cat, Uuid::new_v4()] {
            let err = create_subscription_handler(
                State(state.clone()),
                headers.clone(),
                Json(
                    serde_json::from_value(json!({
                        "name": "Netflix", "price": "9.99",
                        "next_billing_on": "2026-10-15",
                        "category_id": category_id
                    }))
                    .expect("body with foreign category"),
                ),
            )
            .await
            .expect_err("foreign category must be 422");
            assert_422(err);
        }
        assert_eq!(movement_count(&pool, user_id).await, 0);
        cleanup_user(&pool, user_id).await;
        cleanup_user(&pool, other_user).await;
        let _ = other_state;
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
                    "next_billing_on": "2026-10-15"
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
            "INSERT INTO subscriptions (user_id, name, price, currency, frequency, next_billing_on) VALUES ($1,'Mine',999,'COP','monthly','2026-10-15') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed subscription");
        let err = get_subscription_handler(State(state_b.clone()), headers_b.clone(), Path(sub_id))
            .await
            .expect_err("foreign subscription get must be 404");
        assert_404(err);
        let patch = Json(serde_json::from_value(json!({"is_active": false})).expect("valid patch"));
        let err = patch_subscription_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(sub_id),
            patch,
        )
        .await
        .expect_err("foreign subscription patch must be 404");
        assert_404(err);
        let err = delete_subscription_handler(State(state_b.clone()), headers_b.clone(), Path(sub_id))
            .await
            .expect_err("foreign subscription delete must be 404");
        assert_404(err);
        let account_id = seed_account(&pool, user_b, "100000").await;
        let err = pay(state_b.clone(), headers_b, sub_id, account_id)
            .await
            .expect_err("foreign subscription pay must be 404, never 403");
        assert_404(err);
        assert_eq!(movement_count(&pool, user_b).await, 0);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn pay_debits_atomically_and_advances_the_cycle() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP pay_debits_atomically_and_advances_the_cycle: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "100000").await;
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Streaming", "19900", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let paid = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect("first pay is 200");
        let today = today_bogota();
        assert_eq!(paid.last_paid_on, Some(today));
        assert_eq!(paid.next_billing_on, Some(advance_next_billing(sub.next_billing_on, today)));
        assert_eq!(balance_of(&pool, account_id).await, Decimal::new(8_010_000, 2));
        // Exactly one audit movement: expense, seeded category, linked.
        let (direction, amount, category_id, subscription_id): (String, Decimal, Uuid, Uuid) =
            sqlx::query_as(
                "SELECT direction::text, amount, category_id, subscription_id FROM movements WHERE user_id=$1",
            )
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("one movement row");
        assert_eq!(direction, "expense");
        assert_eq!(amount, Decimal::new(1_990_000, 2));
        let seed_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM categories WHERE user_id=$1 AND kind='finance' AND name='Suscripciones'",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seeded category exists");
        assert_eq!(category_id, seed_id);
        assert_eq!(subscription_id, sub.id);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn double_pay_same_cycle_is_409_with_nothing_persisted() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP double_pay_same_cycle_is_409_with_nothing_persisted: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "100000").await;
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Gym", "19900", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let _ = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect("first pay is 200");
        let balance_after_first = balance_of(&pool, account_id).await;
        let err = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect_err("second pay same cycle must be 409");
        assert_409(err);
        assert_eq!(movement_count(&pool, user_id).await, 1);
        assert_eq!(balance_of(&pool, account_id).await, balance_after_first);
        cleanup_user(&pool, user_id).await;
    }

    /// S13 regression guard for the normal monthly flow: the pay action is
    /// enabled when the due date arrives, so paying ON the due date must be
    /// 200 (not 409), schedule the next occurrence one month out and close the
    /// guard again immediately.
    #[tokio::test]
    async fn pay_on_the_due_date_is_200_and_advances_the_cycle() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP pay_on_the_due_date_is_200_and_advances_the_cycle: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "100000").await;
        let today = today_bogota();
        let due_today = today.format("%Y-%m-%d").to_string();
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Gym", "19900", &due_today),
        )
        .await
        .expect("create is 201");
        assert_eq!(sub.next_billing_on, Some(today));
        let paid = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect("paying on the due date is the normal monthly flow (200)");
        assert_eq!(paid.last_paid_on, Some(today));
        let advanced = advance_next_billing(Some(today), today);
        assert_eq!(paid.next_billing_on, Some(advanced));
        // Closed again right after the pay; no background job re-opens it.
        let err = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect_err("a second pay in the same cycle is 409");
        assert_409(err);
        assert_eq!(movement_count(&pool, user_id).await, 1);
        cleanup_user(&pool, user_id).await;
    }

    /// S13: once the cycle is paid, the client-writable due date may only move
    /// forward. The audited exploit (pay → `PATCH next_billing_on` into the
    /// past → pay again) is 422 with the row untouched, while a forward move
    /// and an unrelated edit stay 200.
    #[tokio::test]
    async fn patch_due_date_into_a_paid_cycle_is_422_and_keeps_the_row() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_due_date_into_a_paid_cycle_is_422_and_keeps_the_row: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "100000").await;
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Gym", "19900", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let paid = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect("first pay is 200");
        let last_paid = paid.last_paid_on.expect("pay stamps last_paid_on");
        let due_after_pay = paid.next_billing_on.expect("pay advances the due date");
        // JD-A-001: D + 1 day is after `last_paid_on` but before the stored
        // due date, so only the backwards-move guard can refuse it. Writes on
        // or before `last_paid_on` are refused too.
        for past in [
            last_paid.succ_opt().expect("day after pay exists"),
            last_paid,
            last_paid.pred_opt().unwrap(),
            date(2020, 1, 1),
        ] {
            let err = patch_subscription_handler(
                State(state.clone()),
                headers.clone(),
                Path(sub.id),
                Json(
                    serde_json::from_value(json!({
                        "next_billing_on": past.format("%Y-%m-%d").to_string()
                    }))
                    .expect("backwards due-date patch"),
                ),
            )
            .await
            .expect_err("a backwards due date on a paid row must be 422");
            assert_422(err);
        }
        // The refused PATCH leaves the pay gate closed: a second pay in the
        // same cycle is still 409, never a duplicate debit.
        assert_409(
            pay(state.clone(), headers.clone(), sub.id, account_id)
                .await
                .expect_err("the refused backwards patch must not re-enable pay"),
        );
        let got = get_subscription_handler(State(state.clone()), headers.clone(), Path(sub.id))
            .await
            .expect("subscription still readable");
        assert_eq!(
            got.next_billing_on,
            Some(due_after_pay),
            "the 422 must leave the due date untouched"
        );
        assert_eq!(got.last_paid_on, Some(last_paid));
        assert_eq!(movement_count(&pool, user_id).await, 1);
        // Moving forward is the legitimate re-schedule and stays 200.
        let forward = advance_next_billing(Some(due_after_pay), due_after_pay);
        let patched = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(sub.id),
            Json(
                serde_json::from_value(json!({
                    "next_billing_on": forward.format("%Y-%m-%d").to_string()
                }))
                .expect("forward due-date patch"),
            ),
        )
        .await
        .expect("a forward due date is 200");
        assert_eq!(patched.next_billing_on, Some(forward));
        // An edit that does not carry the due date is not affected.
        let renamed = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(sub.id),
            Json(serde_json::from_value(json!({"name": "Renombrada"})).expect("name patch")),
        )
        .await
        .expect("name-only patch is 200");
        assert_eq!(renamed.name, "Renombrada");
        assert_eq!(renamed.next_billing_on, Some(forward));
        // Legacy rows may store a due date earlier than `last_paid_on`; the
        // second guard still refuses a new value inside the paid cycle.
        let legacy_due = last_paid.pred_opt().expect("previous day exists");
        sqlx::query(
            "UPDATE subscriptions SET next_billing_on=$2, last_paid_on=$3 WHERE id=$1 AND user_id=$4",
        )
        .bind(sub.id)
        .bind(legacy_due)
        .bind(last_paid)
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("seed legacy due date");
        let err = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(sub.id),
            Json(
                serde_json::from_value(json!({
                    "next_billing_on": last_paid.format("%Y-%m-%d").to_string()
                }))
                .expect("legacy due-date patch"),
            ),
        )
        .await
        .expect_err("a legacy row still cannot move its due date into the paid cycle");
        assert_422(err);
        let got = get_subscription_handler(State(state.clone()), headers.clone(), Path(sub.id))
            .await
            .expect("subscription still readable");
        assert_eq!(
            got.next_billing_on,
            Some(legacy_due),
            "the legacy 422 must leave the due date untouched"
        );
        assert_eq!(got.last_paid_on, Some(last_paid));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn pay_free_and_inactive_subscriptions_are_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP pay_free_and_inactive_subscriptions_are_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "100000").await;
        let (_, free) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Free Tier", "0.00", "2026-10-15"),
        )
        .await
        .expect("free create is 201");
        let err = pay(state.clone(), headers.clone(), free.id, account_id)
            .await
            .expect_err("free pay must be 422");
        assert_422(err);
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Music", "9.99", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let _ = patch_subscription_handler(
            State(state.clone()),
            headers.clone(),
            Path(sub.id),
            Json(serde_json::from_value(json!({"is_active": false})).expect("cancel patch")),
        )
        .await
        .expect("cancel is 200");
        let err = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect_err("cancelled pay must be 422");
        assert_422(err);
        assert_eq!(movement_count(&pool, user_id).await, 0);
        assert_eq!(balance_of(&pool, account_id).await, Decimal::new(10_000_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn pay_pre_existing_oversized_price_is_422_and_persists_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP pay_pre_existing_oversized_price_is_422_and_persists_nothing: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "6000000000").await;
        // A row written under the old 1e16 cap (direct SQL bypasses today's
        // create validation) must not be payable: it would insert an invalid
        // ledger movement the movements API rejects.
        let oversized_id: Uuid = sqlx::query_scalar(
            "INSERT INTO subscriptions (user_id, name, price, frequency, next_billing_on) VALUES ($1,'Legacy Oversized',$2::numeric,'monthly'::subscription_frequency,'2026-10-15') RETURNING id",
        )
        .bind(user_id)
        .bind("5000000000.00")
        .fetch_one(&pool)
        .await
        .expect("seed pre-existing oversized subscription");
        let err = pay(state.clone(), headers.clone(), oversized_id, account_id)
            .await
            .expect_err("stored price above the cap must be 422");
        assert_422(err);
        assert_eq!(movement_count(&pool, user_id).await, 0);
        assert_eq!(
            balance_of(&pool, account_id).await,
            Decimal::new(600_000_000_000, 2)
        );
        // Boundary: a stored price just below the cap still pays and writes
        // exactly one ledger movement.
        let boundary_id: Uuid = sqlx::query_scalar(
            "INSERT INTO subscriptions (user_id, name, price, frequency, next_billing_on) VALUES ($1,'Legacy Boundary',$2::numeric,'monthly'::subscription_frequency,'2026-10-15') RETURNING id",
        )
        .bind(user_id)
        .bind("999999999.99")
        .fetch_one(&pool)
        .await
        .expect("seed boundary subscription");
        let paid = pay(state.clone(), headers.clone(), boundary_id, account_id)
            .await
            .expect("price just below the cap still pays");
        assert_eq!(paid.price, Decimal::new(99_999_999_999, 2));
        assert_eq!(paid.last_paid_on, Some(today_bogota()));
        assert_eq!(movement_count(&pool, user_id).await, 1);
        assert_eq!(
            balance_of(&pool, account_id).await,
            Decimal::new(500_000_000_001, 2)
        );
        cleanup_user(&pool, user_id).await;
    }

    /// S11: the account lock filters archived accounts, so the miss is one
    /// uniform 422 — the same status and message a foreign or missing id
    /// gets, with nothing persisted (no movement, no debit, no stamp).
    #[tokio::test]
    async fn pay_with_foreign_missing_or_archived_account_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP pay_with_foreign_missing_or_archived_account_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let archived_account = seed_archived_account(&pool, user_id, "Vieja", "100000").await;
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Streaming", "19900", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let (_, _, other_user) = db_state(&pool).await;
        let foreign_account = seed_account(&pool, other_user, "50000").await;
        for account_id in [foreign_account, Uuid::new_v4(), archived_account] {
            let err = pay(state.clone(), headers.clone(), sub.id, account_id)
                .await
                .expect_err("foreign/missing/archived account pay must be 422");
            assert!(
                matches!(&err, AppError::Validation(msg) if msg == "la cuenta no existe o está archivada"),
                "one uniform 422 for every unresolvable account id, naming neither existence nor the archived flag, got: {err:?}"
            );
            assert_422(err);
        }
        assert_eq!(movement_count(&pool, user_id).await, 0);
        assert_eq!(
            balance_of(&pool, archived_account).await,
            Decimal::new(10_000_000, 2)
        );
        let got = get_subscription_handler(State(state.clone()), headers.clone(), Path(sub.id))
            .await
            .expect("subscription readable");
        assert_eq!(got.last_paid_on, None);
        cleanup_user(&pool, user_id).await;
        cleanup_user(&pool, other_user).await;
    }

    #[tokio::test]
    async fn pay_after_account_deleted_records_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP pay_after_account_deleted_records_nothing: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "100000").await;
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Streaming", "19900", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        // The account disappears before pay runs: the same uniform 422, no
        // movement, and the subscription row is untouched (full rollback, no
        // partial effect).
        sqlx::query("DELETE FROM accounts WHERE id=$1")
            .bind(account_id)
            .execute(&pool)
            .await
            .expect("delete account");
        let err = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect_err("pay on deleted account must be 422");
        assert_422(err);
        assert_eq!(movement_count(&pool, user_id).await, 0);
        let got = get_subscription_handler(State(state.clone()), headers.clone(), Path(sub.id))
            .await
            .expect("subscription still readable");
        assert_eq!(got.last_paid_on, None);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn seed_is_idempotent_and_leaves_other_kind_untouched() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP seed_is_idempotent_and_leaves_other_kind_untouched: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        // A same-named row of another kind predates the first pay.
        let other_id: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'subscription','Suscripciones') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed other-kind Suscripciones");
        let before: (Uuid, String, String) =
            sqlx::query_as("SELECT id, kind::text, name FROM categories WHERE id=$1")
                .bind(other_id)
                .fetch_one(&pool)
                .await
                .expect("read other-kind row");
        let account_id = seed_account(&pool, user_id, "100000").await;
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Streaming", "19900", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let _ = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect("pay seeds the finance Suscripciones");
        // Exactly one finance-kind row; the subscription-kind row is
        // byte-identical (no rename, no delete, no suffix).
        let finance_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM categories WHERE user_id=$1 AND kind='finance' AND name='Suscripciones'",
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
        .expect("finance Suscripciones rows");
        assert_eq!(finance_ids.len(), 1);
        let after: (Uuid, String, String) =
            sqlx::query_as("SELECT id, kind::text, name FROM categories WHERE id=$1")
                .bind(other_id)
                .fetch_one(&pool)
                .await
                .expect("other-kind row still there");
        assert_eq!(before, after);
        // A second subscription pays against the same seed id
        // (idempotent: no duplicate row, same id reused).
        let (_, sub2) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Gym", "9900", "2026-10-15"),
        )
        .await
        .expect("second create is 201");
        let _ = pay(state.clone(), headers.clone(), sub2.id, account_id)
            .await
            .expect("second pay reuses the seed");
        let finance_ids_after: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM categories WHERE user_id=$1 AND kind='finance' AND name='Suscripciones'",
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
        .expect("finance Suscripciones rows after second pay");
        assert_eq!(finance_ids_after, finance_ids);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_preserves_movements_as_audit() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_preserves_movements_as_audit: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "100000").await;
        let (_, sub) = create_subscription_handler(
            State(state.clone()),
            headers.clone(),
            create_body("Streaming", "19900", "2026-10-15"),
        )
        .await
        .expect("create is 201");
        let _ = pay(state.clone(), headers.clone(), sub.id, account_id)
            .await
            .expect("pay is 200");
        let status =
            delete_subscription_handler(State(state.clone()), headers.clone(), Path(sub.id))
                .await
                .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        // `ON DELETE SET NULL`: the audit row survives with the link
        // cleared and its amount and date intact.
        let (amount, occurred_on, subscription_id): (Decimal, NaiveDate, Option<Uuid>) =
            sqlx::query_as("SELECT amount, occurred_on, subscription_id FROM movements WHERE user_id=$1")
                .bind(user_id)
                .fetch_one(&pool)
                .await
                .expect("movement survives the delete");
        assert_eq!(amount, Decimal::new(1_990_000, 2));
        assert_eq!(occurred_on, today_bogota());
        assert_eq!(subscription_id, None);
        cleanup_user(&pool, user_id).await;
    }
}
