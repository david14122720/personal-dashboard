//! Finance transaction CRUD (income/expense only), scoped by `user_id`.
//!
//! Amounts arrive as strings and are validated by
//! [`parse_money_amount`][crate::finance::money::parse_money_amount]
//! (`> 0`, `scale <= 2`, else 422). Core fields (`amount`, `account_id`,
//! `type`) are immutable after creation: PATCH only accepts
//! description/notes/category (unknown fields → 422 via
//! `deny_unknown_fields`). Deletes rely on the DB trigger to reverse the
//! balance effect. Transfers are owned by PR3 and rejected here.
//!
//! Registered in `main.rs` (PR4 wiring).

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id, error::AppError, finance::money::parse_money_amount,
    state::AppState,
};

/// Transaction kinds accepted here. `transfer` legs are created atomically by
/// PR3 (`POST /transfers`), never by this endpoint.
pub const TRANSACTION_TYPES: &[&str] = &["income", "expense"];

const MAX_TEXT_LEN: usize = 2000;
const MAX_PAYMENT_METHOD_LEN: usize = 64;

const CREATE_TRANSACTION_SQL: &str = "INSERT INTO transactions (user_id, account_id, type, amount, occurred_on, category_id, description, notes, payment_method, credit_card_account_id) VALUES ($1,$2,$3::transaction_type,$4,$5,$6,$7,$8,$9,$10) RETURNING id, account_id, type::text, amount, currency, occurred_on, category_id, description, notes, credit_card_account_id, created_at, updated_at";
const DELETE_TRANSACTION_SQL: &str = "DELETE FROM transactions WHERE id=$1 AND user_id=$2";
const ACCOUNT_OWNERSHIP_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2";
const CATEGORY_LOOKUP_SQL: &str = "SELECT kind::text FROM categories WHERE id=$1 AND user_id=$2";
/// Card terms for linkage/over-limit checks, scoped to the caller (a
/// foreign id yields no row; see [`require_usable_card`]).
const CARD_LOOKUP_SQL: &str =
    "SELECT balance, type::text, credit_limit FROM accounts WHERE id=$1 AND user_id=$2";
/// Unscoped existence probe: distinguishes a foreign card (404) from a
/// nonexistent id (422) without leaking which user owns it.
const CARD_EXISTS_SQL: &str = "SELECT id FROM accounts WHERE id=$1";

type TransactionRow = (
    Uuid,
    Uuid,
    String,
    Decimal,
    String,
    NaiveDate,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    Option<Uuid>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTransactionRequest {
    pub account_id: Uuid,
    #[serde(rename = "type")]
    pub transaction_type: String,
    /// Wire-format money string, e.g. `"50.00"` (never a JSON number).
    pub amount: String,
    /// Calendar date `YYYY-MM-DD`.
    pub occurred_on: String,
    pub category_id: Option<Uuid>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub payment_method: Option<String>,
    /// Optional link to an owned `credit_card` account. Expense-only (see
    /// [`validate_card_link_type`]); the 0002 trigger charges the card leg
    /// alongside the primary account leg.
    pub credit_card_account_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchTransactionRequest {
    pub description: Option<String>,
    pub notes: Option<String>,
    pub category_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct TransactionResponse {
    pub id: Uuid,
    pub account_id: Uuid,
    #[serde(rename = "type")]
    pub transaction_type: String,
    /// Serialized as a string (e.g. `"50.00"`); `rust_decimal`'s serde impl
    /// renders decimals as strings, never floats.
    pub amount: Decimal,
    pub currency: String,
    pub occurred_on: NaiveDate,
    pub category_id: Option<Uuid>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub credit_card_account_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl
    From<(
        Uuid,
        Uuid,
        String,
        Decimal,
        String,
        NaiveDate,
        Option<Uuid>,
        Option<String>,
        Option<String>,
        Option<Uuid>,
        DateTime<Utc>,
        DateTime<Utc>,
    )> for TransactionResponse
{
    fn from(
        row: (
            Uuid,
            Uuid,
            String,
            Decimal,
            String,
            NaiveDate,
            Option<Uuid>,
            Option<String>,
            Option<String>,
            Option<Uuid>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            account_id,
            transaction_type,
            amount,
            currency,
            occurred_on,
            category_id,
            description,
            notes,
            credit_card_account_id,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            account_id,
            transaction_type,
            amount,
            currency,
            occurred_on,
            category_id,
            description,
            notes,
            credit_card_account_id,
            created_at,
            updated_at,
        }
    }
}

/// Validate the transaction kind: only `income`/`expense` here (422 otherwise,
/// including `transfer` which belongs to `POST /transfers`).
pub fn validate_transaction_type(raw: &str) -> Result<String, AppError> {
    let normalized = raw.trim();
    if TRANSACTION_TYPES.contains(&normalized) {
        Ok(normalized.to_string())
    } else if normalized == "transfer" {
        Err(AppError::Validation(
            "transfers require POST /transfers".into(),
        ))
    } else {
        Err(AppError::Validation(
            "transaction type must be income or expense".into(),
        ))
    }
}

/// Parse `occurred_on` as a calendar date (strict `YYYY-MM-DD`), else 422.
pub fn validate_occurred_on(raw: &str) -> Result<NaiveDate, AppError> {
    let trimmed = raw.trim();
    let well_formed =
        trimmed.len() == 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-';
    if !well_formed {
        return Err(AppError::Validation(
            "occurred_on must be a calendar date YYYY-MM-DD".into(),
        ));
    }
    NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| AppError::Validation("occurred_on must be a calendar date YYYY-MM-DD".into()))
}

/// Validate PATCH text lengths (description/notes caps).
pub fn validate_transaction_patch(body: &PatchTransactionRequest) -> Result<(), AppError> {
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    Ok(())
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

/// Verify the account is owned by the user (else 404, no existence oracle).
pub async fn ensure_account_owned(
    pool: &sqlx::PgPool,
    account_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let owned: Option<Uuid> = sqlx::query_scalar(ACCOUNT_OWNERSHIP_SQL)
        .bind(account_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| AppError::Internal)?;
    owned.map(|_| ()).ok_or(AppError::NotFound)
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

/// A card link is only meaningful on expenses: income linked to a card is
/// 422 (a payment or refund travels as a transfer or a plain income, never
/// as card-linked debt).
pub fn validate_card_link_type(
    transaction_type: &str,
    has_card_link: bool,
) -> Result<(), AppError> {
    if has_card_link && transaction_type != "expense" {
        return Err(AppError::Validation(
            "only expenses can be linked to credit cards".into(),
        ));
    }
    Ok(())
}

/// Card terms for the over-limit guard: `(balance, credit_limit)`.
///
/// - Owned `credit_card` row → its terms (`credit_limit` is NOT NULL there
///   by `chk_card_limit_presence`; a NULL surfaces as 500, never a bypass).
/// - Owned non-card row → 422 (a link must reference a `credit_card`).
/// - Row owned by someone else → 404 (no existence oracle).
/// - Id owned by nobody → 422 (orphaned-link FK guard).
pub async fn require_usable_card(
    pool: &sqlx::PgPool,
    card_id: Uuid,
    user_id: Uuid,
) -> Result<(Decimal, Decimal), AppError> {
    let row: Option<(Decimal, String, Option<Decimal>)> =
        sqlx::query_as(CARD_LOOKUP_SQL)
            .bind(card_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|_| AppError::Internal)?;
    match row {
        None => {
            let exists: Option<Uuid> = sqlx::query_scalar(CARD_EXISTS_SQL)
                .bind(card_id)
                .fetch_optional(pool)
                .await
                .map_err(|_| AppError::Internal)?;
            if exists.is_some() {
                Err(AppError::NotFound)
            } else {
                Err(AppError::Validation(
                    "credit card does not exist".into(),
                ))
            }
        }
        Some((balance, account_type, limit)) => {
            if account_type != "credit_card" {
                return Err(AppError::Validation(
                    "credit_card_account_id must reference a credit_card account".into(),
                ));
            }
            match limit {
                Some(limit) => Ok((balance, limit)),
                None => Err(AppError::Internal),
            }
        }
    }
}

/// Over-limit guard: `used_balance + amount > credit_limit` → 422 before
/// INSERT, so a rejected purchase records nothing and moves no balance.
/// `used_balance` is the absolute debt (`GREATEST(-balance, 0)`).
pub fn enforce_credit_limit(
    balance: Decimal,
    limit: Decimal,
    amount: Decimal,
) -> Result<(), AppError> {
    let used = (-balance).max(Decimal::ZERO);
    if used + amount > limit {
        return Err(AppError::Validation(
            "purchase exceeds the credit card limit".into(),
        ));
    }
    Ok(())
}

/// Map transaction write errors: `23503` (linked card raced away) → 422;
/// everything else is internal (never leaked).
fn map_transaction_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if db.code().as_deref() == Some("23503") {
            return AppError::Validation("invalid credit card link".into());
        }
    }
    AppError::Internal
}

pub async fn create_transaction_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTransactionRequest>,
) -> Result<(StatusCode, Json<TransactionResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let transaction_type = validate_transaction_type(&body.transaction_type)?;
    let amount = parse_money_amount(&body.amount)?;
    let occurred_on = validate_occurred_on(&body.occurred_on)?;
    validate_optional_text(body.description.as_deref(), MAX_TEXT_LEN, "description")?;
    validate_optional_text(body.notes.as_deref(), MAX_TEXT_LEN, "notes")?;
    validate_optional_text(
        body.payment_method.as_deref(),
        MAX_PAYMENT_METHOD_LEN,
        "payment_method",
    )?;
    ensure_account_owned(&state.pool, body.account_id, user_id).await?;
    if let Some(category_id) = body.category_id {
        ensure_finance_category(&state.pool, category_id, user_id).await?;
    }
    validate_card_link_type(&transaction_type, body.credit_card_account_id.is_some())?;
    if let Some(card_id) = body.credit_card_account_id {
        // A self-link would double-charge one row (primary leg + card leg
        // hit the same balance in the 0002 trigger): reject it outright.
        if card_id == body.account_id {
            return Err(AppError::Validation(
                "credit_card_account_id must differ from account_id".into(),
            ));
        }
        let (balance, limit) =
            require_usable_card(&state.pool, card_id, user_id).await?;
        enforce_credit_limit(balance, limit, amount)?;
    } else if transaction_type == "expense" {
        // Direct purchase on the card itself (no link): same guard, so the
        // trigger cannot push the card past its limit.
        let row: Option<(Decimal, String, Option<Decimal>)> =
            sqlx::query_as(CARD_LOOKUP_SQL)
                .bind(body.account_id)
                .bind(user_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|_| AppError::Internal)?;
        if let Some((balance, account_type, Some(limit))) = row {
            if account_type == "credit_card" {
                enforce_credit_limit(balance, limit, amount)?;
            }
        }
    }
    let row = sqlx::query_as::<_, TransactionRow>(CREATE_TRANSACTION_SQL)
        .bind(user_id)
        .bind(body.account_id)
        .bind(&transaction_type)
        .bind(amount)
        .bind(occurred_on)
        .bind(body.category_id)
        .bind(body.description.as_deref())
        .bind(body.notes.as_deref())
        .bind(body.payment_method.as_deref())
        .bind(body.credit_card_account_id)
        .fetch_one(&state.pool)
        .await
        .map_err(map_transaction_db_err)?;
    Ok((StatusCode::CREATED, Json(TransactionResponse::from(row))))
}

pub async fn patch_transaction_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchTransactionRequest>,
) -> Result<Json<TransactionResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_transaction_patch(&body)?;
    if let Some(category_id) = body.category_id {
        ensure_finance_category(&state.pool, category_id, user_id).await?;
    }
    if body.description.is_none() && body.notes.is_none() && body.category_id.is_none() {
        return Err(AppError::Validation("no updatable fields provided".into()));
    }
    let mut qb: sqlx::QueryBuilder<sqlx::Postgres> =
        sqlx::QueryBuilder::new("UPDATE transactions SET updated_at = now()");
    if let Some(description) = &body.description {
        qb.push(", description = ");
        qb.push_bind(description);
    }
    if let Some(notes) = &body.notes {
        qb.push(", notes = ");
        qb.push_bind(notes);
    }
    if let Some(category_id) = body.category_id {
        qb.push(", category_id = ");
        qb.push_bind(category_id);
    }
    qb.push(" WHERE id = ");
    qb.push_bind(id);
    qb.push(" AND user_id = ");
    qb.push_bind(user_id);
    qb.push(" RETURNING id, account_id, type::text, amount, currency, occurred_on, category_id, description, notes, credit_card_account_id, created_at, updated_at");
    let row = qb
        .build_query_as::<TransactionRow>()
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(TransactionResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn delete_transaction_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let res = sqlx::query(DELETE_TRANSACTION_SQL)
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

// -- Slice 0 (p6-frontend-dashboard): dashboard reads --

/// Default page size for `GET /transactions`.
pub const DEFAULT_TX_LIMIT: i64 = 50;
/// Maximum page size for `GET /transactions`.
pub const MAX_TX_LIMIT: i64 = 200;

/// Keyset cursor over `(occurred_on, id)`: base64url of `YYYY-MM-DD|uuid`.
/// Keyset (not OFFSET) keeps pages stable under concurrent inserts and rides
/// `idx_tx_user_date` with `ORDER BY occurred_on DESC, id DESC`.
pub fn encode_tx_cursor(occurred_on: NaiveDate, id: Uuid) -> String {
    URL_SAFE_NO_PAD.encode(format!(
        "{}|{}",
        occurred_on.format("%Y-%m-%d"),
        id.hyphenated()
    ))
}

/// Decode a cursor produced by [`encode_tx_cursor`]; garbage is 422, never 500.
pub fn decode_tx_cursor(raw: &str) -> Result<(NaiveDate, Uuid), AppError> {
    let invalid = || AppError::Validation("invalid cursor".into());
    let decoded = URL_SAFE_NO_PAD.decode(raw.trim()).map_err(|_| invalid())?;
    let text = String::from_utf8(decoded).map_err(|_| invalid())?;
    let (date_part, id_part) = text.split_once('|').ok_or_else(invalid)?;
    let date = validate_occurred_on(date_part).map_err(|_| invalid())?;
    let id = Uuid::parse_str(id_part.trim()).map_err(|_| invalid())?;
    Ok((date, id))
}

/// Validate `limit`: default 50, range `[1, 200]`, else 422.
pub fn validate_tx_limit(raw: Option<i64>) -> Result<i64, AppError> {
    let limit = raw.unwrap_or(DEFAULT_TX_LIMIT);
    if !(1..=MAX_TX_LIMIT).contains(&limit) {
        return Err(AppError::Validation(format!(
            "limit must be between 1 and {MAX_TX_LIMIT}"
        )));
    }
    Ok(limit)
}

#[derive(Debug, Deserialize)]
pub struct ListTransactionsQuery {
    pub account_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub transaction_type: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// Filtered list + keyset page + filter total in ONE round-trip. The `filtered`
/// CTE applies the user + filter predicates (no cursor); the outer query adds
/// the keyset window, and the scalar subquery reports the full filter total —
/// `COUNT(*) OVER()` would only count the cursor window, understating page 2+.
/// Unknown filter ids yield an empty page (never 404); `type` is limited to
/// `income`/`expense` (transfers live under `POST /transfers`).
const LIST_TRANSACTIONS_SQL: &str = "WITH filtered AS (SELECT id, account_id, type::text AS tx_type, amount, currency, occurred_on, category_id, description, notes, credit_card_account_id, created_at, updated_at FROM transactions WHERE user_id=$1 AND ($2::uuid IS NULL OR account_id=$2) AND ($3::uuid IS NULL OR category_id=$3) AND ($4::transaction_type IS NULL OR type=$4::transaction_type) AND ($5::date IS NULL OR occurred_on >= $5) AND ($6::date IS NULL OR occurred_on <= $6)) SELECT id, account_id, tx_type, amount, currency, occurred_on, category_id, description, notes, credit_card_account_id, created_at, updated_at, (SELECT COUNT(*) FROM filtered) AS total_count FROM filtered WHERE ($7::date IS NULL OR (occurred_on, id) < ($7, $8::uuid)) ORDER BY occurred_on DESC, id DESC LIMIT $9";

type TransactionListRow = (
    Uuid,
    Uuid,
    String,
    Decimal,
    String,
    NaiveDate,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    Option<Uuid>,
    DateTime<Utc>,
    DateTime<Utc>,
    i64,
);

#[derive(Debug, Serialize)]
pub struct TransactionListResponse {
    pub items: Vec<TransactionResponse>,
    pub next_cursor: Option<String>,
    pub total_count: i64,
}

pub async fn list_transactions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ListTransactionsQuery>,
) -> Result<Json<TransactionListResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let limit = validate_tx_limit(params.limit)?;
    let transaction_type = params
        .transaction_type
        .as_deref()
        .map(validate_transaction_type)
        .transpose()?;
    let from = params
        .from
        .as_deref()
        .map(validate_occurred_on)
        .transpose()?;
    let to = params.to.as_deref().map(validate_occurred_on).transpose()?;
    let (cursor_date, cursor_id) = params
        .cursor
        .as_deref()
        .map(decode_tx_cursor)
        .transpose()?
        .map(|(d, i)| (Some(d), Some(i)))
        .unwrap_or((None, None));
    let rows = sqlx::query_as::<_, TransactionListRow>(LIST_TRANSACTIONS_SQL)
        .bind(user_id)
        .bind(params.account_id)
        .bind(params.category_id)
        .bind(transaction_type)
        .bind(from)
        .bind(to)
        .bind(cursor_date)
        .bind(cursor_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    let total_count = rows.first().map(|row| row.12).unwrap_or(0);
    let items: Vec<TransactionResponse> = rows
        .into_iter()
        .map(|row| {
            TransactionResponse::from((
                row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8, row.9,
                row.10, row.11,
            ))
        })
        .collect();
    // A full page may have a successor; a short page is the end.
    let next_cursor = if items.len() as i64 == limit {
        items
            .last()
            .map(|item| encode_tx_cursor(item.occurred_on, item.id))
    } else {
        None
    };
    Ok(Json(TransactionListResponse {
        items,
        next_cursor,
        total_count,
    }))
}

#[derive(Debug, Deserialize)]
pub struct StatsRangeQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(rename = "type")]
    pub transaction_type: Option<String>,
}

fn validate_stats_range(
    params: &StatsRangeQuery,
    range_required: bool,
) -> Result<(Option<NaiveDate>, Option<NaiveDate>), AppError> {
    let from = params
        .from
        .as_deref()
        .map(validate_occurred_on)
        .transpose()?;
    let to = params.to.as_deref().map(validate_occurred_on).transpose()?;
    if range_required {
        if from.is_none() {
            return Err(AppError::Validation("from is required".into()));
        }
        if to.is_none() {
            return Err(AppError::Validation("to is required".into()));
        }
    }
    if let (Some(from), Some(to)) = (from, to) {
        if to < from {
            return Err(AppError::Validation(
                "to must be on or after from".into(),
            ));
        }
    }
    Ok((from, to))
}

/// Server-side spend totals per category: one `SUM GROUP BY` over the caller's
/// expenses (default `type=expense`). Empty ranges yield `[]`.
const BY_CATEGORY_SQL: &str = "SELECT t.category_id, c.name, COALESCE(SUM(t.amount),0) AS total FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.user_id=$1 AND t.type=$2::transaction_type AND t.occurred_on BETWEEN $3 AND $4 GROUP BY t.category_id, c.name ORDER BY total DESC, c.name ASC";

#[derive(Debug, Serialize)]
pub struct CategoryTotalResponse {
    pub category_id: Uuid,
    pub name: String,
    /// Serialized as a string (e.g. `"35.75"`); decimals render as strings.
    pub total: Decimal,
}

pub async fn transactions_by_category_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<StatsRangeQuery>,
) -> Result<Json<Vec<CategoryTotalResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let (from, to) = validate_stats_range(&params, true)?;
    let transaction_type = params
        .transaction_type
        .as_deref()
        .map(validate_transaction_type)
        .transpose()?
        .unwrap_or_else(|| "expense".to_string());
    let rows = sqlx::query_as::<_, (Uuid, String, Decimal)>(BY_CATEGORY_SQL)
        .bind(user_id)
        .bind(&transaction_type)
        .bind(from)
        .bind(to)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|(category_id, name, total)| CategoryTotalResponse {
                category_id,
                name,
                total,
            })
            .collect(),
    ))
}

/// Monthly income-vs-expense series for charts, following the P5
/// `SUM(CASE WHEN type=...)` precedent. Transfers are excluded by the
/// `IN ('income','expense')` predicate; the range is optional.
const MONTHLY_FLOW_SQL: &str = "SELECT to_char(occurred_on,'YYYY-MM') AS month, COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0.00 END),0.00) AS income, COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0.00 END),0.00) AS expense FROM transactions WHERE user_id=$1 AND type IN ('income','expense') AND ($2::date IS NULL OR occurred_on >= $2) AND ($3::date IS NULL OR occurred_on <= $3) GROUP BY 1 ORDER BY 1 ASC";

#[derive(Debug, Serialize)]
pub struct MonthlyFlowResponse {
    pub month: String,
    /// Serialized as strings (e.g. `"1000.00"`); decimals render as strings.
    pub income: Decimal,
    pub expense: Decimal,
}

pub async fn transactions_monthly_flow_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<StatsRangeQuery>,
) -> Result<Json<Vec<MonthlyFlowResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let (from, to) = validate_stats_range(&params, false)?;
    let rows = sqlx::query_as::<_, (String, Decimal, Decimal)>(MONTHLY_FLOW_SQL)
        .bind(user_id)
        .bind(from)
        .bind(to)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|(month, income, expense)| {
                // Normalize to 2dp: exact-zero NUMERIC decodes to scale-0
                // `Decimal::ZERO` (serializes as `"0"`, not `"0.00"`).
                let mut income = income;
                income.rescale(2);
                let mut expense = expense;
                expense.rescale(2);
                MonthlyFlowResponse {
                    month,
                    income,
                    expense,
                }
            })
            .collect(),
    ))
}

#[cfg(test)]
mod dashboard_reads_tests {
    use super::*;
    use axum::extract::Query;
    use axum::response::IntoResponse;

    fn assert_401(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNAUTHORIZED);
    }

    fn assert_422(err: AppError) {
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    }

    fn list_query(limit: Option<i64>, cursor: Option<String>) -> Query<ListTransactionsQuery> {
        Query(ListTransactionsQuery {
            account_id: None,
            category_id: None,
            transaction_type: None,
            from: None,
            to: None,
            cursor,
            limit,
        })
    }

    fn lazy_state() -> AppState {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        AppState {
            pool: sqlx::PgPool::connect_lazy("postgres://localhost:1/unused")
                .expect("lazy pool construction must succeed"),
            session_ttl_hours: 24,
            rate_limiter: Arc::new(LoginRateLimiter::new()),
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
        let email = format!("txlist-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("tx list test")
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

    async fn seed_account(pool: &sqlx::PgPool, user_id: Uuid) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,$2,'cash') RETURNING id",
        )
        .bind(user_id)
        .bind(format!("wallet-{}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed account")
    }

    async fn seed_finance_category(pool: &sqlx::PgPool, user_id: Uuid, name: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'finance',$2) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .expect("seed finance category")
    }

    async fn seed_tx(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        account_id: Uuid,
        kind: &str,
        amount: &str,
        date: &str,
        category_id: Option<Uuid>,
    ) {
        sqlx::query("INSERT INTO transactions (user_id, account_id, type, amount, occurred_on, category_id) VALUES ($1,$2,$3::transaction_type,$4,$5,$6)")
            .bind(user_id)
            .bind(account_id)
            .bind(kind)
            .bind(amount.parse::<Decimal>().unwrap())
            .bind(date.parse::<NaiveDate>().unwrap())
            .bind(category_id)
            .execute(pool)
            .await
            .expect("seed tx");
    }

    async fn seed_transfer_leg(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        account_id: Uuid,
        amount: &str,
        date: &str,
    ) {
        sqlx::query("INSERT INTO transactions (user_id, account_id, type, amount, occurred_on, transfer_group_id) VALUES ($1,$2,'transfer',$3,$4,$5)")
            .bind(user_id)
            .bind(account_id)
            .bind(amount.parse::<Decimal>().unwrap())
            .bind(date.parse::<NaiveDate>().unwrap())
            .bind(Uuid::new_v4())
            .execute(pool)
            .await
            .expect("seed transfer leg");
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    // -- Task 0.1 RED: list endpoint does not exist yet --

    #[test]
    fn cursor_codec_roundtrips_date_and_id() {
        let id = Uuid::new_v4();
        let date = NaiveDate::from_ymd_opt(2026, 9, 15).unwrap();
        let cursor = encode_tx_cursor(date, id);
        assert_eq!(decode_tx_cursor(&cursor).unwrap(), (date, id));
    }

    #[test]
    fn invalid_cursor_is_422() {
        for raw in [
            "",
            "   ",
            "not-base64!!!",
            "bm8tcGlwZQ==",
            "MjAyNi0xMy0wMXwwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDA=",
        ] {
            assert_422(decode_tx_cursor(raw).unwrap_err());
        }
    }

    #[test]
    fn tx_limit_defaults_to_50_and_caps_at_200() {
        assert_eq!(validate_tx_limit(None).unwrap(), 50);
        assert_eq!(validate_tx_limit(Some(200)).unwrap(), 200);
        for raw in [Some(0), Some(-5), Some(201), Some(1000)] {
            assert_422(validate_tx_limit(raw).unwrap_err());
        }
    }

    #[test]
    fn list_sql_is_single_keyset_statement_with_total() {
        // One round-trip: keyset on (occurred_on, id) + filter total via a
        // scalar subquery over the CTE (COUNT(*) OVER() would only count the
        // cursor window, understating page 2+).
        assert_eq!(LIST_TRANSACTIONS_SQL.matches(';').count(), 0);
        for fragment in [
            "(SELECT COUNT(*) FROM filtered)",
            "ORDER BY occurred_on DESC, id DESC",
            "LIMIT $",
            "user_id=$1",
        ] {
            assert!(
                LIST_TRANSACTIONS_SQL.contains(fragment),
                "list SQL must contain {fragment}"
            );
        }
    }

    #[tokio::test]
    async fn unauthenticated_list_is_401() {
        let err = list_transactions_handler(State(lazy_state()), HeaderMap::new(), list_query(None, None))
            .await
            .expect_err("missing session must be 401");
        assert_401(err);
    }

    #[tokio::test]
    async fn default_list_returns_items_cursor_and_total_as_strings() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP default_list_returns_items_cursor_and_total_as_strings: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id).await;
        seed_tx(&pool, user_id, account_id, "expense", "10.00", "2026-09-01", None).await;
        seed_tx(&pool, user_id, account_id, "expense", "20.00", "2026-09-02", None).await;
        seed_tx(&pool, user_id, account_id, "income", "100.00", "2026-09-03", None).await;
        let body = list_transactions_handler(State(state), headers, list_query(None, None))
            .await
            .expect("default list is 200")
            .0;
        assert_eq!(body.items.len(), 3);
        assert_eq!(body.total_count, 3);
        assert!(body.next_cursor.is_none());
        // Reverse-chronological: newest first.
        assert_eq!(
            body.items[0].occurred_on,
            NaiveDate::from_ymd_opt(2026, 9, 3).unwrap()
        );
        // Money travels as decimal strings, never floats.
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["items"][0]["amount"], serde_json::Value::String("100.00".into()));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn list_paginates_via_keyset_without_overlap() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP list_paginates_via_keyset_without_overlap: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id).await;
        for day in ["2026-09-01", "2026-09-02", "2026-09-03"] {
            seed_tx(&pool, user_id, account_id, "expense", "5.00", day, None).await;
        }
        let page1 = list_transactions_handler(
            State(state.clone()),
            headers.clone(),
            list_query(Some(2), None),
        )
        .await
        .expect("page 1 is 200")
        .0;
        assert_eq!(page1.items.len(), 2);
        assert_eq!(page1.total_count, 3);
        let cursor = page1.next_cursor.expect("full page must carry next_cursor");
        let page2 = list_transactions_handler(
            State(state.clone()),
            headers.clone(),
            list_query(Some(2), Some(cursor)),
        )
        .await
        .expect("page 2 is 200")
        .0;
        assert_eq!(page2.items.len(), 1);
        assert_eq!(page2.total_count, 3);
        assert!(page2.next_cursor.is_none());
        let seen1: Vec<Uuid> = page1.items.iter().map(|t| t.id).collect();
        assert!(!seen1.contains(&page2.items[0].id), "pages must not overlap");
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn unknown_filter_ids_yield_empty_page_not_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unknown_filter_ids_yield_empty_page_not_404: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id).await;
        seed_tx(&pool, user_id, account_id, "expense", "5.00", "2026-09-01", None).await;
        let q = Query(ListTransactionsQuery {
            account_id: Some(Uuid::new_v4()),
            category_id: Some(Uuid::new_v4()),
            transaction_type: None,
            from: None,
            to: None,
            cursor: None,
            limit: None,
        });
        let body = list_transactions_handler(State(state), headers, q)
            .await
            .expect("unknown filters are a 200 empty page")
            .0;
        assert!(body.items.is_empty());
        assert_eq!(body.total_count, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn list_filters_by_type_and_date_range() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP list_filters_by_type_and_date_range: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id).await;
        seed_tx(&pool, user_id, account_id, "expense", "5.00", "2026-08-15", None).await;
        seed_tx(&pool, user_id, account_id, "income", "50.00", "2026-09-02", None).await;
        let q = Query(ListTransactionsQuery {
            account_id: None,
            category_id: None,
            transaction_type: Some("expense".into()),
            from: Some("2026-09-01".into()),
            to: Some("2026-09-30".into()),
            cursor: None,
            limit: None,
        });
        let body = list_transactions_handler(State(state.clone()), headers.clone(), q)
            .await
            .expect("filtered list is 200")
            .0;
        assert!(body.items.is_empty(), "August expense and September income are both excluded");
        // A transfer filter value is 422: transfers live under POST /transfers.
        let q = Query(ListTransactionsQuery {
            account_id: None,
            category_id: None,
            transaction_type: Some("transfer".into()),
            from: None,
            to: None,
            cursor: None,
            limit: None,
        });
        let err = list_transactions_handler(State(state), headers, q)
            .await
            .expect_err("transfer filter must be 422");
        assert_422(err);
        cleanup_user(&pool, user_id).await;
    }

    // -- Task 0.3 RED: by-category aggregate does not exist yet --

    #[tokio::test]
    async fn by_category_requires_range_and_sums_as_strings() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP by_category_requires_range_and_sums_as_strings: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id).await;
        let food = seed_finance_category(&pool, user_id, "Food").await;
        // Missing from/to is 422.
        let q = Query(StatsRangeQuery { from: None, to: None, transaction_type: None });
        let err = transactions_by_category_handler(State(state.clone()), headers.clone(), q)
            .await
            .expect_err("missing range must be 422");
        assert_422(err);
        // Empty range is a 200 empty array.
        let q = Query(StatsRangeQuery {
            from: Some("2020-01-01".into()),
            to: Some("2020-01-31".into()),
            transaction_type: None,
        });
        let body = transactions_by_category_handler(State(state.clone()), headers.clone(), q)
            .await
            .expect("empty range is 200")
            .0;
        assert!(body.is_empty());
        // Three September expenses sum to 35.75.
        for amount in ["10.00", "20.50", "5.25"] {
            seed_tx(&pool, user_id, account_id, "expense", amount, "2026-09-10", Some(food)).await;
        }
        let q = Query(StatsRangeQuery {
            from: Some("2026-09-01".into()),
            to: Some("2026-09-30".into()),
            transaction_type: Some("expense".into()),
        });
        let body = transactions_by_category_handler(State(state.clone()), headers.clone(), q)
            .await
            .expect("category totals are 200")
            .0;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0].name, "Food");
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v[0]["total"], serde_json::Value::String("35.75".into()));
        cleanup_user(&pool, user_id).await;
    }

    // -- Task 0.5 RED: monthly-flow aggregate does not exist yet --

    #[tokio::test]
    async fn monthly_flow_groups_by_month_and_excludes_transfers() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP monthly_flow_groups_by_month_and_excludes_transfers: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id).await;
        seed_tx(&pool, user_id, account_id, "income", "1000.00", "2026-09-05", None).await;
        seed_tx(&pool, user_id, account_id, "expense", "400.00", "2026-09-06", None).await;
        seed_transfer_leg(&pool, user_id, account_id, "9999.00", "2026-09-07").await;
        let q = Query(StatsRangeQuery {
            from: Some("2026-09-01".into()),
            to: Some("2026-09-30".into()),
            transaction_type: None,
        });
        let body = transactions_monthly_flow_handler(State(state.clone()), headers.clone(), q)
            .await
            .expect("monthly flow is 200")
            .0;
        assert_eq!(body.len(), 1);
        assert_eq!(body[0].month, "2026-09");
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v[0]["income"], serde_json::Value::String("1000.00".into()));
        assert_eq!(v[0]["expense"], serde_json::Value::String("400.00".into()));
        cleanup_user(&pool, user_id).await;
    }
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
    fn accepts_income_and_expense_types() {
        assert_eq!(validate_transaction_type("income").unwrap(), "income");
        assert_eq!(validate_transaction_type("expense").unwrap(), "expense");
    }

    #[test]
    fn rejects_transfer_and_unknown_types_as_422() {
        // `transfer` must go through POST /transfers (atomic two-leg txn).
        for raw in ["transfer", "TRANSFER", "", "refund", " income "] {
            if raw.trim() == "income" {
                continue;
            }
            assert_422(validate_transaction_type(raw).unwrap_err());
        }
    }

    #[test]
    fn accepts_iso_calendar_date() {
        assert_eq!(
            validate_occurred_on("2026-09-01").unwrap(),
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
        );
    }

    #[test]
    fn rejects_bad_dates_as_422() {
        for raw in [
            "",
            "2026-13-01",
            "2026-02-30",
            "01/09/2026",
            "2026-9-1",
            "not-a-date",
        ] {
            assert_422(validate_occurred_on(raw).unwrap_err());
        }
    }

    #[test]
    fn amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({
            "account_id": Uuid::new_v4(),
            "type": "expense",
            "amount": 50.00,
            "occurred_on": "2026-09-01"
        });
        assert!(
            serde_json::from_value::<CreateTransactionRequest>(payload).is_err(),
            "numeric amount must fail deserialization"
        );
        let ok: CreateTransactionRequest = serde_json::from_value(json!({
            "account_id": Uuid::new_v4(),
            "type": "expense",
            "amount": "50.00",
            "occurred_on": "2026-09-01"
        }))
        .unwrap();
        assert_eq!(ok.amount, "50.00");
    }

    #[test]
    fn amount_serializes_as_string_never_float() {
        let resp = TransactionResponse {
            id: Uuid::new_v4(),
            account_id: Uuid::new_v4(),
            transaction_type: "expense".into(),
            amount: Decimal::new(5000, 2),
            currency: "COP".into(),
            occurred_on: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            category_id: None,
            description: None,
            notes: None,
            credit_card_account_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("50.00".into()));
    }

    #[test]
    fn patch_rejects_core_field_edits_as_422() {
        for payload in [
            json!({"amount": "99.99"}),
            json!({"account_id": Uuid::new_v4()}),
            json!({"type": "income"}),
        ] {
            assert!(
                serde_json::from_value::<PatchTransactionRequest>(payload).is_err(),
                "core-field edit must fail deserialization"
            );
        }
        let ok: PatchTransactionRequest =
            serde_json::from_value(json!({"description": "lunch"})).unwrap();
        assert_eq!(ok.description.as_deref(), Some("lunch"));
    }

    #[test]
    fn patch_rejects_oversized_text_as_422() {
        let body = PatchTransactionRequest {
            description: Some("d".repeat(2001)),
            notes: None,
            category_id: None,
        };
        assert_422(validate_transaction_patch(&body).unwrap_err());
    }

    #[test]
    fn transaction_sql_scopes_every_query_by_user_id() {
        for sql in [
            CREATE_TRANSACTION_SQL,
            DELETE_TRANSACTION_SQL,
            ACCOUNT_OWNERSHIP_SQL,
            CATEGORY_LOOKUP_SQL,
            CARD_LOOKUP_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "transaction SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            DELETE_TRANSACTION_SQL.contains("id=$1 AND user_id=$2"),
            "delete must scope id+user_id, got: {DELETE_TRANSACTION_SQL}"
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
        let email = format!("tx-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("tx test")
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
    async fn create_expense_201_then_delete_204() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_expense_201_then_delete_204: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let body = Json(CreateTransactionRequest {
            account_id,
            transaction_type: "expense".into(),
            amount: "50.00".into(),
            occurred_on: "2026-09-01".into(),
            category_id: None,
            description: Some("groceries".into()),
            notes: None,
            payment_method: None,
            credit_card_account_id: None,
        });
        let (status, created) =
            create_transaction_handler(State(state.clone()), headers.clone(), body)
                .await
                .expect("create expense is 201");
        assert_eq!(status, StatusCode::CREATED);
        let status =
            delete_transaction_handler(State(state.clone()), headers.clone(), Path(created.id))
                .await
                .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn transaction_on_foreign_account_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP transaction_on_foreign_account_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_account: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Vault','bank') RETURNING id",
        )
        .bind(user_a)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let body = Json(CreateTransactionRequest {
            account_id: foreign_account,
            transaction_type: "expense".into(),
            amount: "10.00".into(),
            occurred_on: "2026-09-01".into(),
            category_id: None,
            description: None,
            notes: None,
            payment_method: None,
            credit_card_account_id: None,
        });
        let err = create_transaction_handler(State(state_b.clone()), headers_b, body)
            .await
            .expect_err("foreign account must be 404");
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
        let account_id: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,'Wallet','cash') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed account");
        let habit_cat: Uuid = sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,'habit','Exercise') RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed habit category");
        let body = Json(CreateTransactionRequest {
            account_id,
            transaction_type: "expense".into(),
            amount: "10.00".into(),
            occurred_on: "2026-09-01".into(),
            category_id: Some(habit_cat),
            description: None,
            notes: None,
            payment_method: None,
            credit_card_account_id: None,
        });
        let err = create_transaction_handler(State(state.clone()), headers, body)
            .await
            .expect_err("habit-kind category must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    // -- Slice 3 (p5-credit-cards): card linkage, expense-only, over-limit --

    #[test]
    fn card_link_accepts_optional_link_on_expense() {
        validate_card_link_type("expense", true).unwrap();
        validate_card_link_type("expense", false).unwrap();
        validate_card_link_type("income", false).unwrap();
    }

    #[test]
    fn card_link_rejects_income_linkage_as_422() {
        assert_422(validate_card_link_type("income", true).unwrap_err());
    }

    #[test]
    fn card_link_field_deserializes_as_optional_uuid() {
        let payload = json!({
            "account_id": Uuid::new_v4(),
            "type": "expense",
            "amount": "50.00",
            "occurred_on": "2026-09-01",
            "credit_card_account_id": Uuid::new_v4()
        });
        let req: CreateTransactionRequest = serde_json::from_value(payload).unwrap();
        assert!(req.credit_card_account_id.is_some());
        // Backwards compatible: old clients omit the field entirely.
        let legacy: CreateTransactionRequest = serde_json::from_value(json!({
            "account_id": Uuid::new_v4(),
            "type": "expense",
            "amount": "50.00",
            "occurred_on": "2026-09-01"
        }))
        .unwrap();
        assert!(legacy.credit_card_account_id.is_none());
    }

    async fn seed_card(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        name: &str,
        limit: &str,
    ) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type, credit_limit, statement_day, payment_due_day) VALUES ($1,$2,'credit_card',$3,15,25) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .bind(limit.parse::<rust_decimal::Decimal>().unwrap())
        .fetch_one(pool)
        .await
        .expect("seed card")
    }

    async fn seed_cash_account(pool: &sqlx::PgPool, user_id: Uuid, name: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,$2,'cash') RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .expect("seed cash account")
    }

    async fn card_balance(pool: &sqlx::PgPool, id: Uuid) -> Decimal {
        sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
            .bind(id)
            .fetch_one(pool)
            .await
            .expect("read card balance")
    }

    async fn user_tx_count(pool: &sqlx::PgPool, user_id: Uuid) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM transactions WHERE user_id=$1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("count transactions")
    }

    fn linked_expense_body(account_id: Uuid, card_id: Uuid, amount: &str) -> Json<CreateTransactionRequest> {
        Json(CreateTransactionRequest {
            account_id,
            transaction_type: "expense".into(),
            amount: amount.into(),
            occurred_on: "2026-09-01".into(),
            category_id: None,
            description: Some("card purchase".into()),
            notes: None,
            payment_method: None,
            credit_card_account_id: Some(card_id),
        })
    }

    #[tokio::test]
    async fn income_linked_to_card_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP income_linked_to_card_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cash = seed_cash_account(&pool, user_id, "Wallet").await;
        let card = seed_card(&pool, user_id, "Visa", "1000.00").await;
        let body = Json(CreateTransactionRequest {
            account_id: cash,
            transaction_type: "income".into(),
            amount: "50.00".into(),
            occurred_on: "2026-09-01".into(),
            category_id: None,
            description: None,
            notes: None,
            payment_method: None,
            credit_card_account_id: Some(card),
        });
        let err = create_transaction_handler(State(state.clone()), headers, body)
            .await
            .expect_err("income linked to card must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(user_tx_count(&pool, user_id).await, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn over_limit_purchase_is_422_and_records_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP over_limit_purchase_is_422_and_records_nothing: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cash = seed_cash_account(&pool, user_id, "Wallet").await;
        let card = seed_card(&pool, user_id, "Visa", "1000.00").await;
        sqlx::query("UPDATE accounts SET balance = -950.00 WHERE id=$1")
            .bind(card)
            .execute(&pool)
            .await
            .expect("seed card debt");
        let err = create_transaction_handler(
            State(state.clone()),
            headers,
            linked_expense_body(cash, card, "100.00"),
        )
        .await
        .expect_err("over-limit purchase must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(user_tx_count(&pool, user_id).await, 0);
        assert_eq!(card_balance(&pool, card).await, Decimal::new(-95000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn linked_expense_is_201_and_charges_card_negative() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP linked_expense_is_201_and_charges_card_negative: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cash = seed_cash_account(&pool, user_id, "Wallet").await;
        let card = seed_card(&pool, user_id, "Visa", "1000.00").await;
        let (status, created) = create_transaction_handler(
            State(state.clone()),
            headers,
            linked_expense_body(cash, card, "50.00"),
        )
        .await
        .expect("linked expense is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.credit_card_account_id, Some(card));
        // The card leg carries the debt (negative balance); the cash leg is
        // charged too, mirroring the 0002 trigger semantics.
        assert_eq!(card_balance(&pool, card).await, Decimal::new(-5000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn link_to_non_card_account_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP link_to_non_card_account_is_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cash = seed_cash_account(&pool, user_id, "Wallet").await;
        let other = seed_cash_account(&pool, user_id, "Pocket").await;
        let err = create_transaction_handler(
            State(state.clone()),
            headers,
            linked_expense_body(cash, other, "10.00"),
        )
        .await
        .expect_err("link to non-card must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn link_to_foreign_card_is_404() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP link_to_foreign_card_is_404: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let cash = seed_cash_account(&pool, user_b, "Wallet").await;
        let foreign_card = seed_card(&pool, user_a, "Visa", "1000.00").await;
        let err = create_transaction_handler(
            State(state_b.clone()),
            headers_b,
            linked_expense_body(cash, foreign_card, "10.00"),
        )
        .await
        .expect_err("link to foreign card must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }
}
