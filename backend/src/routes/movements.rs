//! Movements ledger CRUD + atomic balance effect, strictly scoped by `user_id`.
//!
//! A movement links one account, one category, a direction
//! (`expense` | `income`), an amount and a date. Writing, editing or
//! deleting a movement adjusts the owning account balance inside the SAME
//! database transaction as the row write (finance-simplify-movements D4):
//! one HTTP request, one transaction, never a trigger and never a
//! client-orchestrated double write.
//!
//! Transfers (2026-10-04-accounts-transfers-login-calendar D2) are ONE
//! ledger row with `direction = 'transfer'`: `account_id` is the origin,
//! `transfer_account_id` the destination and `category_id` is NULL. They
//! are created through `POST /api/movements/transfer`, debit the origin and
//! credit the destination in the same transaction, and are create/delete
//! only (`PATCH` on a transfer is 422).
//!
//! Lock discipline (design §Architecture Decisions): the account row is
//! locked FIRST (`SELECT ... FOR UPDATE`) so concurrent same-account
//! writers serialize instead of deadlocking on a lock upgrade. A PATCH
//! touching two accounts, a transfer create and a transfer delete lock
//! every touched account in ascending UUID order. Inside the PATCH
//! transaction, AFTER the account locks and BEFORE any balance
//! write, the movement row is re-read `FOR UPDATE`: the reversal and the
//! apply terms come from that locked row, never from the pre-transaction
//! snapshot, so a serialized second writer can never undo a delta that
//! the first one already replaced. Any failure drops the transaction: no
//! row, no partial balance change, no `updated_at` mutation survives.
//!
//! Status matrix (design §Architecture Decisions): 401 without a token;
//! 404 for a foreign or missing movement id (never 403); 422 for a
//! referenced foreign/missing `account_id` / `category_id`, unknown or
//! missing fields, malformed amount/date/direction, a cross-currency or
//! self-referencing transfer and a PATCH against a transfer; 409 surfaces
//! only via `DELETE /api/accounts/{id}`. Category kind never gates a write
//! (D3).
//!
//! Registered in `main.rs` (S-A slice; the transfer route joined in W2).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Datelike, Days, Months, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id,
    error::AppError,
    finance::{
        money::{parse_money_amount, MAX_MONEY_AMOUNT},
        validation::{ensure_owned_account, ensure_owned_category, validate_occurred_on},
    },
    routes::habits::ValidatedQuery,
    routes::parse_read_shape,
    state::AppState,
};

/// Descriptions are free text passthrough capped at 2000 characters (the
/// 422 message says "caracteres", so the bound counts chars, not bytes).
const MAX_DESCRIPTION_LEN: usize = 2000;

const LOCK_ACCOUNT_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE";
/// Currency of an owned account, read inside the PATCH transaction: a movement
/// may only be re-pointed to an account of its own currency, otherwise the
/// stored delta is silently re-denominated (the pay path carries the same
/// rule). An account's currency is immutable after creation — `PATCH
/// /accounts` never accepts it — so the read needs no extra lock.
const ACCOUNT_CURRENCY_SQL: &str = "SELECT currency FROM accounts WHERE id=$1 AND user_id=$2";
/// Transfer-scoped account lock: unlike [`LOCK_ACCOUNT_SQL`] it also returns
/// the currency and the archived flag, so the handler can enforce the
/// same-currency rule and the archived backstop on the locked rows (design
/// D2.2; S3). `is_archived` is read under the same lock: no check-then-act.
const LOCK_TRANSFER_ACCOUNTS_SQL: &str =
    "SELECT id, currency, is_archived FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE";
/// Archived flag of an owned account, read AFTER [`LOCK_ACCOUNT_SQL`] (or the
/// transfer lock) has serialized on the row. Deliberately separate from the
/// ownership helper: `ensure_owned_account` and `LOCK_ACCOUNT_SQL` keep their
/// ownership-only semantics for Pay and every other caller (S3), while the
/// create and re-point handlers apply this dedicated archived backstop.
const ACCOUNT_ARCHIVED_SQL: &str =
    "SELECT is_archived FROM accounts WHERE id=$1 AND user_id=$2";
const INSERT_MOVEMENT_SQL: &str = "INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on, description, subscription_id) VALUES ($1,$2,$3,$4::movement_direction,$5,$6,$7,$8) RETURNING id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at";
/// Transfer insert: the enum literal and the destination are written here —
/// `category_id`/`subscription_id` are omitted so the CHECKs keep them NULL.
const INSERT_TRANSFER_SQL: &str = "INSERT INTO movements (user_id, account_id, transfer_account_id, direction, amount, occurred_on, description, subscription_id) VALUES ($1,$2,$3,'transfer',$4,$5,$6,NULL) RETURNING id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at";
const APPLY_BALANCE_SQL: &str = "UPDATE accounts SET balance = balance + $2, updated_at = now() WHERE id=$1 AND user_id=$3";
const UPDATE_MOVEMENT_SQL: &str = "UPDATE movements SET account_id=$3, category_id=$4, direction=$5::movement_direction, amount=$6, occurred_on=$7, description=$8, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at";
/// Returns BOTH account legs so a transfer delete can undo origin and
/// destination; `transfer_account_id` is NULL for expense/income.
const DELETE_MOVEMENT_SQL: &str = "DELETE FROM movements WHERE id=$1 AND user_id=$2 RETURNING account_id, transfer_account_id, direction::text, amount";
const LIST_MOVEMENTS_SQL: &str = "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE user_id=$1 ORDER BY occurred_on DESC, created_at DESC, id DESC";
/// Ranged list: same 11-column projection in the same order and the full API
/// order as [`LIST_MOVEMENTS_SQL`], bounded inclusively on both edges over
/// `occurred_on` (`from <= occurred_on <= to`, the same semantics
/// `GET /habits/logs` uses). Served only when both bounds parse; with
/// neither parameter the handler keeps serving [`LIST_MOVEMENTS_SQL`].
/// No `limit` (S3a): no consumer in this delivery needs pagination.
const LIST_MOVEMENTS_RANGE_SQL: &str = "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE user_id=$1 AND occurred_on >= $2 AND occurred_on <= $3 ORDER BY occurred_on DESC, created_at DESC, id DESC";
/// Brief shape (`?shape=brief`) of the unbounded list: the S12 fields the
/// browser views read; the WHERE scope and ORDER BY are the full list's
/// verbatim. Dropped for the browser: subscription_id, created_at,
/// updated_at (the MCP keeps the full projection).
const LIST_MOVEMENTS_BRIEF_SQL: &str = "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description FROM movements WHERE user_id=$1 ORDER BY occurred_on DESC, created_at DESC, id DESC";
/// Brief shape of the ranged list: same S12 columns as
/// [`LIST_MOVEMENTS_BRIEF_SQL`] with the range bounds and the full range
/// order verbatim.
const LIST_MOVEMENTS_RANGE_BRIEF_SQL: &str = "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description FROM movements WHERE user_id=$1 AND occurred_on >= $2 AND occurred_on <= $3 ORDER BY occurred_on DESC, created_at DESC, id DESC";
const GET_MOVEMENT_SQL: &str = "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE id=$1 AND user_id=$2";
/// Authoritative PATCH re-read: inside the transaction, under the account
/// lock, the stored money terms (account, destination, direction, amount)
/// are taken from THIS row and never from the pre-transaction snapshot.
const LOCK_MOVEMENT_SQL: &str = "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE id=$1 AND user_id=$2 FOR UPDATE";
/// A movement whose account changed between the snapshot and the account
/// lock (PATCH or DELETE) restarts from a refreshed snapshot (the lock set is
/// the only thing recalculated); bounded so a pathological race ends in a
/// clean, fully-rolled-back 500 instead of an unbounded loop.
const MOVEMENT_LOCK_RETRY_ATTEMPTS: usize = 5;

// -- S1 (T5): `GET /movements/summary` ------------------------------------
//
// The server owns the aggregation the dashboard used to do in the browser:
// one request returns final totals, per-account/per-category splits, calendar
// buckets and the five most recent rows. `expense`/`income` mirror the client
// rule `isUserCurrencyMovement`: only movements whose account is ACTIVE and
// whose currency equals the user's default currency participate (a foreign
// account is excluded, never converted; an archived account is hidden from
// `/accounts`, so it was already absent from the client map). Transfers feed
// `count`/`recent_total` but never the sums.

/// The caller's default currency (`user_preferences.currency_code`), with the
/// documented COP fallback when the row is missing.
const USER_CURRENCY_SQL: &str =
    "SELECT COALESCE((SELECT currency_code::text FROM user_preferences WHERE user_id=$1), 'COP')";
/// One round-trip for the totals: user-currency expense, user-currency income,
/// user-currency movement count (transfers included) and every movement in
/// range (`recent_total`).
const SUMMARY_TOTALS_SQL: &str = "SELECT \
    COALESCE(SUM(CASE WHEN a.currency=$2 AND NOT a.is_archived AND m.direction='expense'::movement_direction THEN m.amount END), 0), \
    COALESCE(SUM(CASE WHEN a.currency=$2 AND NOT a.is_archived AND m.direction='income'::movement_direction THEN m.amount END), 0), \
    COUNT(*) FILTER (WHERE a.currency=$2 AND NOT a.is_archived), \
    COUNT(*) \
 FROM movements m JOIN accounts a ON a.id=m.account_id AND a.user_id=m.user_id \
 WHERE m.user_id=$1 AND m.occurred_on >= $3 AND m.occurred_on <= $4";
/// Per-account expense/income, grouped in SQL (no N+1). Transfers are neither
/// expense nor income, so they are filtered out; foreign-currency and archived
/// accounts follow the same exclusion as the totals.
const SUMMARY_BY_ACCOUNT_SQL: &str = "SELECT m.account_id, \
    COALESCE(SUM(CASE WHEN m.direction='expense'::movement_direction THEN m.amount END), 0), \
    COALESCE(SUM(CASE WHEN m.direction='income'::movement_direction THEN m.amount END), 0) \
 FROM movements m JOIN accounts a ON a.id=m.account_id AND a.user_id=m.user_id \
 WHERE m.user_id=$1 AND m.occurred_on >= $2 AND m.occurred_on <= $3 \
   AND a.currency=$4 AND NOT a.is_archived AND m.direction <> 'transfer'::movement_direction \
 GROUP BY m.account_id ORDER BY m.account_id ASC";
/// Per-category expense/income. Rows without a category are excluded (the
/// client never rendered a "sin categoría" slice); ORDER BY 2 is the expense
/// sum, largest first, the client pie's ordering.
const SUMMARY_BY_CATEGORY_SQL: &str = "SELECT m.category_id, \
    COALESCE(SUM(CASE WHEN m.direction='expense'::movement_direction THEN m.amount END), 0), \
    COALESCE(SUM(CASE WHEN m.direction='income'::movement_direction THEN m.amount END), 0) \
 FROM movements m JOIN accounts a ON a.id=m.account_id AND a.user_id=m.user_id \
 WHERE m.user_id=$1 AND m.occurred_on >= $2 AND m.occurred_on <= $3 \
   AND m.category_id IS NOT NULL \
   AND a.currency=$4 AND NOT a.is_archived AND m.direction <> 'transfer'::movement_direction \
 GROUP BY m.category_id ORDER BY 2 DESC, m.category_id ASC";
/// Bucket sums: `date_trunc($4, ...)` keeps the grouping in SQL and returns the
/// unit start (Monday for ISO weeks). Rust expands the missing (empty) units
/// around these rows so charts stay gap-free, exactly like `trendBuckets`.
const SUMMARY_BUCKETS_SQL: &str = "SELECT date_trunc($4, m.occurred_on::timestamp)::date AS bucket_start, \
    COALESCE(SUM(CASE WHEN m.direction='expense'::movement_direction THEN m.amount END), 0), \
    COALESCE(SUM(CASE WHEN m.direction='income'::movement_direction THEN m.amount END), 0) \
 FROM movements m JOIN accounts a ON a.id=m.account_id AND a.user_id=m.user_id \
 WHERE m.user_id=$1 AND m.occurred_on >= $2 AND m.occurred_on <= $3 \
   AND a.currency=$5 AND NOT a.is_archived AND m.direction <> 'transfer'::movement_direction \
 GROUP BY 1 ORDER BY 1 ASC";
/// `recent`: the first five rows of the same window, full list order
/// (`occurred_on DESC, created_at DESC, id DESC`). Every movement participates
/// here (all accounts/directions), matching `recent_total`.
const SUMMARY_RECENT_SQL: &str = "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description FROM movements WHERE user_id=$1 AND occurred_on >= $2 AND occurred_on <= $3 ORDER BY occurred_on DESC, created_at DESC, id DESC LIMIT 5";

/// Movement row: 11 columns (sqlx 0.8 `FromRow` tuple cap is 16).
/// `transfer_account_id` sits after `account_id`, matching the shared
/// projection of every movement statement (design D2.5).
type MovementRow = (
    Uuid,
    Uuid,
    Option<Uuid>,
    Option<Uuid>,
    String,
    Decimal,
    NaiveDate,
    Option<String>,
    Option<Uuid>,
    DateTime<Utc>,
    DateTime<Utc>,
);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateMovementRequest {
    /// `expense` | `income` — anything else is 422.
    pub direction: String,
    /// Wire-format money string (e.g. `"25000.00"`); a JSON number never
    /// reaches the parser (`deny_unknown_fields` + `String` reject it at
    /// the boundary with 422).
    pub amount: String,
    pub account_id: Uuid,
    /// Required on create (the column stays nullable so a database-level
    /// category deletion can neither orphan nor block a movement).
    pub category_id: Uuid,
    /// Calendar date `YYYY-MM-DD`.
    pub occurred_on: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTransferRequest {
    /// Origin account, stored as `movements.account_id`.
    pub from_account_id: Uuid,
    /// Destination account, stored as `movements.transfer_account_id`.
    pub to_account_id: Uuid,
    /// Wire-format money string (e.g. `"25000.00"`); a JSON number never
    /// reaches the parser (`deny_unknown_fields` + `String` reject it at
    /// the boundary with 422).
    pub amount: String,
    /// Calendar date `YYYY-MM-DD`.
    pub occurred_on: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchMovementRequest {
    /// Any subset MAY be sent; omitted fields keep their stored value.
    /// `subscription_id` is NOT a field: sending it is 422 and the audit
    /// link written by the subscription Pay action can never be re-pointed.
    pub direction: Option<String>,
    pub amount: Option<String>,
    pub account_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub occurred_on: Option<String>,
    pub description: Option<String>,
}

/// `GET /movements` range filter: both bounds optional calendar dates
/// (`YYYY-MM-DD`, inclusive on both edges over `occurred_on`). Unknown query
/// fields are rejected (422) via `deny_unknown_fields` (see
/// `ValidatedQuery`, which remaps axum's 400); malformed or half-specified
/// bounds are 422 in [`parse_movement_range`].
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementRangeQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub shape: Option<String>,
}

/// `GET /movements/summary` query: a REQUIRED inclusive window plus the bucket
/// granularity. Unlike [`MovementRangeQuery`] there is no unbounded mode.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementSummaryQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub group: Option<String>,
}

/// Parse the `GET /movements?from&to` range bounds (strict `YYYY-MM-DD` via
/// the shared [`validate_occurred_on`], else 422): with neither bound there
/// is no range (`Ok(None)` — the handler serves [`LIST_MOVEMENTS_SQL`]);
/// with both bounds the inclusive window (`from <= to`, else 422); a single
/// bound is 422 — `from` and `to` travel together or not at all. Pure: no
/// I/O, no `PgPool`.
pub fn parse_movement_range(
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Option<(NaiveDate, NaiveDate)>, AppError> {
    match (from, to) {
        (None, None) => Ok(None),
        (Some(raw_from), Some(raw_to)) => {
            let from = validate_occurred_on(raw_from)?;
            let to = validate_occurred_on(raw_to)?;
            if from > to {
                return Err(AppError::Validation("to must be after from".into()));
            }
            Ok(Some((from, to)))
        }
        _ => Err(AppError::Validation(
            "from and to must be provided together".into(),
        )),
    }
}

/// Bucket granularity of `GET /movements/summary`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SummaryGroup {
    Day,
    Week,
    Month,
    Year,
}

impl SummaryGroup {
    /// The `date_trunc` unit name.
    fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        }
    }
}

/// Parse the `group` query parameter strictly, following [`parse_read_shape`]:
/// missing or any value other than the four contract values is 422, never
/// silently defaulted.
pub fn parse_summary_group(raw: Option<&str>) -> Result<SummaryGroup, AppError> {
    match raw {
        Some("day") => Ok(SummaryGroup::Day),
        Some("week") => Ok(SummaryGroup::Week),
        Some("month") => Ok(SummaryGroup::Month),
        Some("year") => Ok(SummaryGroup::Year),
        Some(other) => Err(AppError::Validation(format!(
            "group must be one of: day, week, month, year (got `{other}`)"
        ))),
        None => Err(AppError::Validation(
            "group is required: one of day, week, month, year".into(),
        )),
    }
}

/// Parse the summary window: both bounds are mandatory (unlike the optional
/// `/movements` range), and the shared [`parse_movement_range`] keeps the
/// strict `YYYY-MM-DD` format, the `from <= to` ordering and the
/// half-specified 422.
pub fn parse_summary_window(
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(NaiveDate, NaiveDate), AppError> {
    parse_movement_range(from, to)?
        .ok_or_else(|| AppError::Validation("from and to are required".into()))
}

/// First day of the calendar unit containing `date` (Monday for `week`).
fn summary_unit_start(group: SummaryGroup, date: NaiveDate) -> NaiveDate {
    match group {
        SummaryGroup::Day => date,
        SummaryGroup::Week => {
            let offset = i64::from(date.weekday().num_days_from_monday()) as u64;
            date.checked_sub_days(Days::new(offset)).unwrap_or(date)
        }
        SummaryGroup::Month => {
            NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date)
        }
        SummaryGroup::Year => NaiveDate::from_ymd_opt(date.year(), 1, 1).unwrap_or(date),
    }
}

/// Inclusive last day of the unit that starts at `start`. Week is Monday to
/// Sunday, matching the client's `trendWindow`.
fn summary_unit_end(group: SummaryGroup, start: NaiveDate) -> NaiveDate {
    match group {
        SummaryGroup::Day => start,
        SummaryGroup::Week => start
            .checked_add_days(Days::new(6))
            .unwrap_or(NaiveDate::MAX),
        SummaryGroup::Month => {
            let (year, month) = (start.year(), start.month());
            if month == 12 {
                NaiveDate::from_ymd_opt(year, 12, 31).unwrap_or(NaiveDate::MAX)
            } else {
                NaiveDate::from_ymd_opt(year, month + 1, 1)
                    .and_then(|first| first.pred_opt())
                    .unwrap_or(NaiveDate::MAX)
            }
        }
        SummaryGroup::Year => NaiveDate::from_ymd_opt(start.year(), 12, 31)
            .unwrap_or(NaiveDate::MAX),
    }
}

/// Contract bucket key: `YYYY-MM-DD` (day), ISO `YYYY-Www` (week), `YYYY-MM`
/// (month) or `YYYY` (year) — byte-identical to the client's `trendWindow`.
fn summary_bucket_key(group: SummaryGroup, start: NaiveDate) -> String {
    match group {
        SummaryGroup::Day => start.format("%Y-%m-%d").to_string(),
        SummaryGroup::Week => {
            let iso = start.iso_week();
            format!("{}-W{:02}", iso.year(), iso.week())
        }
        SummaryGroup::Month => format!("{:04}-{:02}", start.year(), start.month()),
        SummaryGroup::Year => start.year().to_string(),
    }
}

/// First day of the NEXT unit, or `None` at the representable date ceiling.
fn next_summary_unit_start(group: SummaryGroup, start: NaiveDate) -> Option<NaiveDate> {
    match group {
        SummaryGroup::Day => start.succ_opt(),
        SummaryGroup::Week => start.checked_add_days(Days::new(7)),
        SummaryGroup::Month => start.checked_add_months(Months::new(1)),
        SummaryGroup::Year => NaiveDate::from_ymd_opt(start.year() + 1, 1, 1),
    }
}

/// Every calendar unit intersecting the inclusive `[from, to]` window, oldest
/// first, with its natural unit boundaries (a week is its Monday-Sunday
/// window). Empty units are present with zero totals so the chart keeps its
/// gap-free shape; the SQL rows fill the ones that carry movements.
fn summary_bucket_windows(
    group: SummaryGroup,
    from: NaiveDate,
    to: NaiveDate,
) -> Vec<SummaryBucket> {
    let mut buckets = Vec::new();
    let mut start = summary_unit_start(group, from);
    while start <= to {
        buckets.push(SummaryBucket {
            key: summary_bucket_key(group, start),
            from: start,
            to: summary_unit_end(group, start),
            expense: Decimal::ZERO,
            income: Decimal::ZERO,
        });
        match next_summary_unit_start(group, start) {
            Some(next) => start = next,
            None => break,
        }
    }
    buckets
}

#[derive(Debug, Serialize)]
pub struct MovementResponse {
    pub id: Uuid,
    pub direction: String,
    /// Serialized as a string (e.g. `"25000.00"`); `rust_decimal`'s serde
    /// impl renders decimals as strings, never floats.
    pub amount: Decimal,
    /// Serialized as `YYYY-MM-DD`.
    pub occurred_on: NaiveDate,
    pub description: Option<String>,
    pub account_id: Uuid,
    /// Destination account for a transfer; `null` for expense/income.
    pub transfer_account_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub subscription_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<MovementRow> for MovementResponse {
    fn from(
        row: (
            Uuid,
            Uuid,
            Option<Uuid>,
            Option<Uuid>,
            String,
            Decimal,
            NaiveDate,
            Option<String>,
            Option<Uuid>,
            DateTime<Utc>,
            DateTime<Utc>,
        ),
    ) -> Self {
        let (
            id,
            account_id,
            transfer_account_id,
            category_id,
            direction,
            amount,
            occurred_on,
            description,
            subscription_id,
            created_at,
            updated_at,
        ) = row;
        Self {
            id,
            direction,
            amount,
            occurred_on,
            description,
            account_id,
            transfer_account_id,
            category_id,
            subscription_id,
            created_at,
            updated_at,
        }
    }
}

/// Brief movement row: id, account_id, transfer_account_id, category_id,
/// direction, amount, occurred_on, description (S12 order).
type MovementBriefRow = (
    Uuid,
    Uuid,
    Option<Uuid>,
    Option<Uuid>,
    String,
    Decimal,
    NaiveDate,
    Option<String>,
);

/// Brief movement response (`?shape=brief`): id, account_id,
/// transfer_account_id, category_id, direction, amount, occurred_on,
/// description.
#[derive(Debug, Serialize)]
pub struct MovementBriefResponse {
    pub id: Uuid,
    pub account_id: Uuid,
    /// Destination account for a transfer; `null` for expense/income.
    pub transfer_account_id: Option<Uuid>,
    pub category_id: Option<Uuid>,
    pub direction: String,
    /// Serialized as a string (e.g. `"25000.00"`); `rust_decimal`'s serde
    /// impl renders decimals as strings, never floats.
    pub amount: Decimal,
    /// Serialized as `YYYY-MM-DD`.
    pub occurred_on: NaiveDate,
    pub description: Option<String>,
}

impl From<MovementBriefRow> for MovementBriefResponse {
    fn from(
        row: (
            Uuid,
            Uuid,
            Option<Uuid>,
            Option<Uuid>,
            String,
            Decimal,
            NaiveDate,
            Option<String>,
        ),
    ) -> Self {
        let (
            id,
            account_id,
            transfer_account_id,
            category_id,
            direction,
            amount,
            occurred_on,
            description,
        ) = row;
        Self {
            id,
            account_id,
            transfer_account_id,
            category_id,
            direction,
            amount,
            occurred_on,
            description,
        }
    }
}

/// `GET /api/movements` body: the full row set, or the brief shape the SPA
/// asks for with `?shape=brief`.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum MovementsResponse {
    Full(Vec<MovementResponse>),
    Brief(Vec<MovementBriefResponse>),
}

/// Pinned wire contract of `GET /api/movements/summary` (S1/T5). Field names
/// and nesting are frozen: the dashboard/finance sections render these
/// aggregates directly.
#[derive(Debug, Serialize)]
pub struct MovementSummaryTotals {
    /// Sum of user-currency expense rows (decimal string on the wire).
    pub expense: Decimal,
    /// Sum of user-currency income rows (decimal string on the wire).
    pub income: Decimal,
    /// User-currency movements in the window, transfers included.
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct MovementSummaryAccount {
    pub account_id: Uuid,
    pub expense: Decimal,
    pub income: Decimal,
}

#[derive(Debug, Serialize)]
pub struct MovementSummaryCategory {
    pub category_id: Uuid,
    pub expense: Decimal,
    pub income: Decimal,
}

#[derive(Debug, Serialize)]
pub struct SummaryBucket {
    /// `YYYY-MM-DD` | `YYYY-Www` | `YYYY-MM` | `YYYY`.
    pub key: String,
    /// Inclusive natural unit bounds (week = Monday..Sunday).
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub expense: Decimal,
    pub income: Decimal,
}

#[derive(Debug, Serialize)]
pub struct MovementSummaryResponse {
    pub totals: MovementSummaryTotals,
    pub by_account: Vec<MovementSummaryAccount>,
    pub by_category: Vec<MovementSummaryCategory>,
    pub buckets: Vec<SummaryBucket>,
    /// Up to five most recent movements in the window, most recent first.
    pub recent: Vec<MovementBriefResponse>,
    /// Every movement in the window, the label count ("N movimientos").
    pub recent_total: i64,
}

/// Validate the direction: exactly `expense` or `income`, else Spanish 422.
pub fn validate_direction(raw: &str) -> Result<String, AppError> {
    match raw.trim() {
        "expense" => Ok("expense".to_string()),
        "income" => Ok("income".to_string()),
        _ => Err(AppError::Validation(
            "la direccion debe ser 'expense' o 'income'".into(),
        )),
    }
}

/// Validate a movement amount: positive money (`> 0`, `scale <= 2`) below
/// the shared [`MAX_MONEY_AMOUNT`] cap (`10^9`, COP-scale), else Spanish
/// 422. Parsing itself delegates to the shared [`parse_money_amount`];
/// only the surface message is movement-scoped.
pub fn validate_movement_amount(raw: &str) -> Result<Decimal, AppError> {
    let amount = parse_money_amount(raw).map_err(|_| {
        AppError::Validation(
            "el monto debe ser un numero positivo con maximo 2 decimales".into(),
        )
    })?;
    if amount >= Decimal::from(MAX_MONEY_AMOUNT) {
        return Err(AppError::Validation(
            "el monto debe ser menor a 1000000000".into(),
        ));
    }
    Ok(amount)
}

/// Validate a free-text description (passthrough, max 2000 characters),
/// else Spanish 422.
pub fn validate_description(raw: &str) -> Result<String, AppError> {
    if raw.chars().count() > MAX_DESCRIPTION_LEN {
        return Err(AppError::Validation(
            "la descripcion debe tener maximo 2000 caracteres".into(),
        ));
    }
    Ok(raw.to_string())
}

/// Map movement write errors: `23514` (check) | `23503` (FK raced away) |
/// `22P02` (invalid enum text — belt-and-braces behind the API guard) →
/// Spanish 422; everything else is internal (never leaked).
fn map_movement_db_err(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        match db.code().as_deref() {
            Some("23503") | Some("23514") | Some("22P02") => {
                return AppError::Validation("datos del movimiento invalidos".into());
            }
            _ => {}
        }
    }
    AppError::Internal
}

/// Signed balance delta: `expense` subtracts, `income` adds and a `transfer`
/// debits its origin (`account_id`). The stored amount is always positive;
/// the direction carries the sign. Fails closed: a direction outside
/// `expense`/`income`/`transfer` is an error, never an implicit addition
/// (the transfer destination leg is written explicitly by the handler).
fn signed_delta(direction: &str, amount: Decimal) -> Result<Decimal, AppError> {
    match direction {
        "expense" | "transfer" => Ok(-amount),
        "income" => Ok(amount),
        _ => Err(AppError::Internal),
    }
}

/// Transfers are create/delete only (design D2.4): a PATCH against a stored
/// `transfer` row is 422 BEFORE any balance math, checked on the
/// pre-transaction snapshot and again on the locked row.
fn reject_transfer_patch(stored_direction: &str) -> Result<(), AppError> {
    if stored_direction == "transfer" {
        return Err(AppError::Validation(
            "las transferencias no se pueden editar; elimina y vuelve a crearla".into(),
        ));
    }
    Ok(())
}

pub async fn create_movement_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateMovementRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let direction = validate_direction(&body.direction)?;
    let amount = validate_movement_amount(&body.amount)?;
    let occurred_on = validate_occurred_on(&body.occurred_on)?;
    let description = body
        .description
        .as_deref()
        .map(validate_description)
        .transpose()?;
    // Fail fast before opening a write transaction; the in-transaction
    // lock below re-verifies under the row lock.
    ensure_owned_account(&state.pool, body.account_id, user_id).await?;
    let mut tx = state.pool.begin().await.map_err(|_| AppError::Internal)?;
    // Lock-first: serialize concurrent same-account writers (design §Data
    // Flow step 1). A referenced foreign/missing account is 422, never 404.
    let locked: Option<Uuid> = sqlx::query_scalar(LOCK_ACCOUNT_SQL)
        .bind(body.account_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| AppError::Internal)?;
    if locked.is_none() {
        return Err(AppError::Validation(
            "la cuenta debe pertenecer al usuario".into(),
        ));
    }
    // S3 backstop: an archived account can no longer originate a movement.
    // Ownership stays the same (the helper above is untouched); this is a
    // dedicated gate read under the row just locked.
    let archived: bool = sqlx::query_scalar(ACCOUNT_ARCHIVED_SQL)
        .bind(body.account_id)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| AppError::Internal)?;
    if archived {
        return Err(AppError::Validation(
            "no se pueden crear movimientos sobre cuentas archivadas".into(),
        ));
    }
    ensure_owned_category(&mut *tx, body.category_id, user_id).await?;
    let row = sqlx::query_as::<_, MovementRow>(INSERT_MOVEMENT_SQL)
        .bind(user_id)
        .bind(body.account_id)
        .bind(body.category_id)
        .bind(&direction)
        .bind(amount)
        .bind(occurred_on)
        .bind(description.as_deref())
        .bind(None::<Uuid>)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_movement_db_err)?;
    sqlx::query(APPLY_BALANCE_SQL)
        .bind(body.account_id)
        .bind(signed_delta(&direction, amount)?)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(map_movement_db_err)?;
    tx.commit().await.map_err(|_| AppError::Internal)?;
    Ok((StatusCode::CREATED, Json(MovementResponse::from(row))))
}

/// Create a transfer: ONE ledger row between two owned, same-currency
/// accounts with both balance legs in one transaction (design D2).
///
/// Validation precedence follows D2.1: amount, date, description, both
/// accounts owned, distinct accounts, same currency. The two account rows
/// are locked in ascending UUID order, so opposite transfers (A→B vs B→A)
/// serialize identically and can never deadlock.
pub async fn create_transfer_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTransferRequest>,
) -> Result<(StatusCode, Json<MovementResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let amount = validate_movement_amount(&body.amount)?;
    let occurred_on = validate_occurred_on(&body.occurred_on)?;
    let description = body
        .description
        .as_deref()
        .map(validate_description)
        .transpose()?;
    // Fail fast before opening a write transaction; the locked rows below
    // re-verify ownership and carry the currency.
    ensure_owned_account(&state.pool, body.from_account_id, user_id).await?;
    ensure_owned_account(&state.pool, body.to_account_id, user_id).await?;
    if body.from_account_id == body.to_account_id {
        return Err(AppError::Validation(
            "las cuentas de la transferencia deben ser distintas".into(),
        ));
    }
    let mut tx = state.pool.begin().await.map_err(|_| AppError::Internal)?;
    // Ascending-UUID lock order, exactly like PATCH: opposite transfers
    // (A→B vs B→A) serialise identically and can never deadlock.
    let mut ids = [body.from_account_id, body.to_account_id];
    ids.sort();
    let mut from_currency: Option<String> = None;
    let mut to_currency: Option<String> = None;
    for account_id in ids {
        let locked: Option<(Uuid, String, bool)> = sqlx::query_as(LOCK_TRANSFER_ACCOUNTS_SQL)
            .bind(account_id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
        let Some((locked_id, currency, archived)) = locked else {
            return Err(AppError::Validation(
                "la cuenta debe pertenecer al usuario".into(),
            ));
        };
        // S3 backstop: neither transfer leg may be an archived account. The
        // flag comes from the locked row, so an archive racing this write can
        // never slip a transfer through.
        if archived {
            return Err(AppError::Validation(
                "no se pueden crear movimientos sobre cuentas archivadas".into(),
            ));
        }
        if locked_id == body.from_account_id {
            from_currency = Some(currency);
        } else {
            to_currency = Some(currency);
        }
    }
    let (Some(from_currency), Some(to_currency)) = (from_currency, to_currency) else {
        return Err(AppError::Validation(
            "la cuenta debe pertenecer al usuario".into(),
        ));
    };
    if from_currency != to_currency {
        return Err(AppError::Validation(
            "las cuentas deben tener la misma moneda".into(),
        ));
    }
    let row = sqlx::query_as::<_, MovementRow>(INSERT_TRANSFER_SQL)
        .bind(user_id)
        .bind(body.from_account_id)
        .bind(body.to_account_id)
        .bind(amount)
        .bind(occurred_on)
        .bind(description.as_deref())
        .fetch_one(&mut *tx)
        .await
        .map_err(map_movement_db_err)?;
    // Origin debit, then destination credit: two explicit legs in the same
    // transaction (the destination leg never runs through `signed_delta`).
    sqlx::query(APPLY_BALANCE_SQL)
        .bind(body.from_account_id)
        .bind(-amount)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(map_movement_db_err)?;
    sqlx::query(APPLY_BALANCE_SQL)
        .bind(body.to_account_id)
        .bind(amount)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(map_movement_db_err)?;
    tx.commit().await.map_err(|_| AppError::Internal)?;
    Ok((StatusCode::CREATED, Json(MovementResponse::from(row))))
}

pub async fn list_movements_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    ValidatedQuery(query): ValidatedQuery<MovementRangeQuery>,
) -> Result<Json<MovementsResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let range = parse_movement_range(query.from.as_deref(), query.to.as_deref())?;
    let shape = parse_read_shape(query.shape.as_deref())?;
    if shape.is_brief() {
        let brief = match range {
            Some((from, to)) => {
                sqlx::query_as::<_, MovementBriefRow>(LIST_MOVEMENTS_RANGE_BRIEF_SQL)
                    .bind(user_id)
                    .bind(from)
                    .bind(to)
                    .fetch_all(&state.pool)
                    .await
                    .map_err(|e| {
                        tracing::error!("list_movements range failed: {e:?}");
                        AppError::Internal
                    })?
            }
            None => {
                sqlx::query_as::<_, MovementBriefRow>(LIST_MOVEMENTS_BRIEF_SQL)
                    .bind(user_id)
                    .fetch_all(&state.pool)
                    .await
                    .map_err(|e| {
                        tracing::error!("list_movements failed: {e:?}");
                        AppError::Internal
                    })?
            }
        };
        return Ok(Json(MovementsResponse::Brief(
            brief.into_iter().map(MovementBriefResponse::from).collect(),
        )));
    }
    let rows = match range {
        Some((from, to)) => {
            sqlx::query_as::<_, MovementRow>(LIST_MOVEMENTS_RANGE_SQL)
                .bind(user_id)
                .bind(from)
                .bind(to)
                .fetch_all(&state.pool)
                .await
                .map_err(|e| {
                    tracing::error!("list_movements range failed: {e:?}");
                    AppError::Internal
                })?
        }
        None => {
            sqlx::query_as::<_, MovementRow>(LIST_MOVEMENTS_SQL)
                .bind(user_id)
                .fetch_all(&state.pool)
                .await
                .map_err(|e| {
                    tracing::error!("list_movements failed: {e:?}");
                    AppError::Internal
                })?
        }
    };
    Ok(Json(MovementsResponse::Full(
        rows.into_iter().map(MovementResponse::from).collect()
    )))
}

/// `GET /api/movements/summary?from&to&group` — final aggregates for one
/// window (S1/T5). All summing/grouping happens in SQL; Rust only expands the
/// empty calendar buckets. Registered as a STATIC route before `/movements/{id}`
/// so `{id}` can never capture "summary".
pub async fn movement_summary_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    ValidatedQuery(query): ValidatedQuery<MovementSummaryQuery>,
) -> Result<Json<MovementSummaryResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let (from, to) = parse_summary_window(query.from.as_deref(), query.to.as_deref())?;
    let group = parse_summary_group(query.group.as_deref())?;
    let currency: String = sqlx::query_scalar(USER_CURRENCY_SQL)
        .bind(user_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("movement summary currency failed: {e:?}");
            AppError::Internal
        })?;
    let (expense, income, count, recent_total) =
        sqlx::query_as::<_, (Decimal, Decimal, i64, i64)>(SUMMARY_TOTALS_SQL)
            .bind(user_id)
            .bind(&currency)
            .bind(from)
            .bind(to)
            .fetch_one(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!("movement summary totals failed: {e:?}");
                AppError::Internal
            })?;
    let by_account = sqlx::query_as::<_, (Uuid, Decimal, Decimal)>(SUMMARY_BY_ACCOUNT_SQL)
        .bind(user_id)
        .bind(from)
        .bind(to)
        .bind(&currency)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("movement summary by_account failed: {e:?}");
            AppError::Internal
        })?
        .into_iter()
        .map(|(account_id, expense, income)| MovementSummaryAccount {
            account_id,
            expense,
            income,
        })
        .collect();
    let by_category = sqlx::query_as::<_, (Uuid, Decimal, Decimal)>(SUMMARY_BY_CATEGORY_SQL)
        .bind(user_id)
        .bind(from)
        .bind(to)
        .bind(&currency)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("movement summary by_category failed: {e:?}");
            AppError::Internal
        })?
        .into_iter()
        .map(|(category_id, expense, income)| MovementSummaryCategory {
            category_id,
            expense,
            income,
        })
        .collect();
    // One grouped SQL scan; the empty units are filled from the pure window
    // expansion so the response always carries every bucket in order.
    let mut bucket_totals: HashMap<NaiveDate, (Decimal, Decimal)> =
        sqlx::query_as::<_, (NaiveDate, Decimal, Decimal)>(SUMMARY_BUCKETS_SQL)
            .bind(user_id)
            .bind(from)
            .bind(to)
            .bind(group.as_str())
            .bind(&currency)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| {
                tracing::error!("movement summary buckets failed: {e:?}");
                AppError::Internal
            })?
            .into_iter()
            .map(|(start, expense, income)| (start, (expense, income)))
            .collect();
    let mut buckets = summary_bucket_windows(group, from, to);
    for bucket in &mut buckets {
        if let Some((expense, income)) = bucket_totals.remove(&bucket.from) {
            bucket.expense = expense;
            bucket.income = income;
        }
    }
    let recent = sqlx::query_as::<_, MovementBriefRow>(SUMMARY_RECENT_SQL)
        .bind(user_id)
        .bind(from)
        .bind(to)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("movement summary recent failed: {e:?}");
            AppError::Internal
        })?
        .into_iter()
        .map(MovementBriefResponse::from)
        .collect();
    Ok(Json(MovementSummaryResponse {
        totals: MovementSummaryTotals {
            expense,
            income,
            count,
        },
        by_account,
        by_category,
        buckets,
        recent,
        recent_total,
    }))
}

pub async fn get_movement_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<MovementResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let row = sqlx::query_as::<_, MovementRow>(GET_MOVEMENT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    row.map(|r| Json(MovementResponse::from(r)))
        .ok_or(AppError::NotFound)
}

pub async fn patch_movement_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchMovementRequest>,
) -> Result<Json<MovementResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    // Pre-transaction snapshot: the fast 404 and the initial account lock
    // set. It is NEVER the source of the money terms — those are re-read
    // under the account lock below, so a concurrent PATCH that commits in
    // between cannot be reversed twice.
    let mut snapshot = sqlx::query_as::<_, MovementRow>(GET_MOVEMENT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    // Transfers are create/delete only: reject before any balance math, on
    // the snapshot and again on the locked row below (D2.4).
    reject_transfer_patch(&snapshot.4)?;
    // Validate the body once, preserving the 422 precedence (direction,
    // amount, occurred_on, description) and the fast 404 above.
    let new_direction = body
        .direction
        .as_deref()
        .map(validate_direction)
        .transpose()?;
    let new_amount = body
        .amount
        .as_deref()
        .map(validate_movement_amount)
        .transpose()?;
    let new_occurred_on = body
        .occurred_on
        .as_deref()
        .map(validate_occurred_on)
        .transpose()?;
    let new_description = body
        .description
        .as_deref()
        .map(validate_description)
        .transpose()?;
    if let Some(requested_account) = body.account_id {
        ensure_owned_account(&state.pool, requested_account, user_id).await?;
    }
    // A concurrent PATCH may re-point the movement to another account
    // between the snapshot and the account lock; the reversal must then land
    // on the NEW account, which this attempt never locked. The transaction
    // rolls back untouched and restarts from a refreshed snapshot (bounded:
    // only the lock set is recalculated).
    for _ in 0..MOVEMENT_LOCK_RETRY_ATTEMPTS {
        let snapshot_account = snapshot.1;
        let account_id = body.account_id.unwrap_or(snapshot_account);
        let mut tx = state.pool.begin().await.map_err(|_| AppError::Internal)?;
        // Lock old + new accounts in ascending UUID order so opposite
        // direction moves (A→B vs B→A) cannot deadlock each other.
        let mut to_lock = vec![snapshot_account];
        if account_id != snapshot_account {
            to_lock.push(account_id);
        }
        to_lock.sort();
        for acc in to_lock {
            let locked: Option<Uuid> = sqlx::query_scalar(LOCK_ACCOUNT_SQL)
                .bind(acc)
                .bind(user_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|_| AppError::Internal)?;
            if locked.is_none() {
                return Err(AppError::Validation(
                    "la cuenta debe pertenecer al usuario".into(),
                ));
            }
        }
        // Under the account lock, re-read the movement FOR UPDATE: the
        // authoritative direction/amount/account are the ones stored NOW
        // (account → movement lock order is preserved).
        let locked_row = sqlx::query_as::<_, MovementRow>(LOCK_MOVEMENT_SQL)
            .bind(id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
        let Some(locked_row) = locked_row else {
            // Deleted by another writer while we waited for the account lock.
            return Err(AppError::NotFound);
        };
        let locked_response = MovementResponse::from(locked_row);
        reject_transfer_patch(&locked_response.direction)?;
        if locked_response.account_id != snapshot_account {
            // Moved under us: restart with a refreshed snapshot so the
            // reversal hits the account that actually stores the delta.
            tx.rollback().await.map_err(|_| AppError::Internal)?;
            snapshot = sqlx::query_as::<_, MovementRow>(GET_MOVEMENT_SQL)
                .bind(id)
                .bind(user_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|_| AppError::Internal)?
                .ok_or(AppError::NotFound)?;
            continue;
        }
        // S3 backstop: only the NEW target is gated. Moving a movement AWAY
        // from an archived account stays allowed (that is how stored data is
        // corrected), and an amount-only edit is not a re-point at all.
        if account_id != locked_response.account_id {
            let archived: bool = sqlx::query_scalar(ACCOUNT_ARCHIVED_SQL)
                .bind(account_id)
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| AppError::Internal)?;
            if archived {
                return Err(AppError::Validation(
                    "no se puede mover un movimiento a una cuenta archivada".into(),
                ));
            }
        }
        // Same-currency rule on a re-point: the stored amount lives in the
        // scale of the account that holds it, so moving the movement to an
        // account of another currency would corrupt both balances. Both
        // accounts are already locked in this transaction, in ascending order.
        if account_id != locked_response.account_id {
            let from_currency: String = sqlx::query_scalar(ACCOUNT_CURRENCY_SQL)
                .bind(locked_response.account_id)
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| AppError::Internal)?;
            let to_currency: String = sqlx::query_scalar(ACCOUNT_CURRENCY_SQL)
                .bind(account_id)
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(|_| AppError::Internal)?;
            if from_currency != to_currency {
                return Err(AppError::Validation(
                    "la cuenta debe usar la misma moneda que la del movimiento".into(),
                ));
            }
        }
        // Merge from the LOCKED row: omitted fields keep their stored value
        // as of the lock, and `subscription_id` is not a PATCH field, so the
        // audit link is preserved untouched.
        let direction = new_direction
            .clone()
            .unwrap_or_else(|| locked_response.direction.clone());
        let amount = new_amount.unwrap_or(locked_response.amount);
        let category_id = body.category_id.or(locked_response.category_id);
        let occurred_on = new_occurred_on.unwrap_or(locked_response.occurred_on);
        let description = new_description
            .clone()
            .or_else(|| locked_response.description.clone());
        if body.category_id.is_some() {
            if let Some(category_id) = category_id {
                ensure_owned_category(&mut *tx, category_id, user_id).await?;
            }
        }
        // Full delta reversal: undo the STORED signed delta on the old
        // account (the row read under the lock), then apply the NEW signed
        // delta on the (possibly same) account — one transaction, net-zero
        // when nothing money-relevant changed (design delta-reversal matrix).
        sqlx::query(APPLY_BALANCE_SQL)
            .bind(locked_response.account_id)
            .bind(-signed_delta(
                &locked_response.direction,
                locked_response.amount,
            )?)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(map_movement_db_err)?;
        sqlx::query(APPLY_BALANCE_SQL)
            .bind(account_id)
            .bind(signed_delta(&direction, amount)?)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(map_movement_db_err)?;
        let row = sqlx::query_as::<_, MovementRow>(UPDATE_MOVEMENT_SQL)
            .bind(id)
            .bind(user_id)
            .bind(account_id)
            .bind(category_id)
            .bind(&direction)
            .bind(amount)
            .bind(occurred_on)
            .bind(description.as_deref())
            .fetch_one(&mut *tx)
            .await
            .map_err(map_movement_db_err)?;
        tx.commit().await.map_err(|_| AppError::Internal)?;
        return Ok(Json(MovementResponse::from(row)));
    }
    // Every attempt lost the account race: each transaction rolled back
    // cleanly (nothing written), so a 500 is safe.
    Err(AppError::Internal)
}

pub async fn delete_movement_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    // Pre-transaction snapshot: the fast 404 and the initial account lock
    // set. It is NEVER the source of the money terms — those come from the
    // DELETE ... RETURNING below, taken after the account locks.
    let mut snapshot = sqlx::query_as::<_, MovementRow>(GET_MOVEMENT_SQL)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?
        .ok_or(AppError::NotFound)?;
    // A concurrent PATCH may re-point the movement between the snapshot and
    // the account lock; this attempt would then hold the WRONG account and
    // the DELETE below would reveal it. The transaction rolls back untouched
    // and restarts from a refreshed snapshot (bounded: only the lock set is
    // recalculated).
    for _ in 0..MOVEMENT_LOCK_RETRY_ATTEMPTS {
        let mut tx = state.pool.begin().await.map_err(|_| AppError::Internal)?;
        // Account -> movement lock order, exactly like PATCH (and the
        // transfer create): lock every account the snapshot attributes to the
        // row, in ascending UUID order, BEFORE touching the movement row, so
        // a concurrent PATCH can never deadlock against a movement-first
        // delete.
        let mut to_lock = vec![snapshot.1];
        if let Some(destination) = snapshot.2 {
            to_lock.push(destination);
        }
        to_lock.sort();
        for account in &to_lock {
            let locked: Option<Uuid> = sqlx::query_scalar(LOCK_ACCOUNT_SQL)
                .bind(account)
                .bind(user_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|_| AppError::Internal)?;
            if locked.is_none() {
                return Err(AppError::Validation(
                    "la cuenta debe pertenecer al usuario".into(),
                ));
            }
        }
        // The DELETE now takes the movement row lock itself and returns the
        // authoritative terms for the reversal below.
        let deleted: Option<(Uuid, Option<Uuid>, String, Decimal)> =
            sqlx::query_as(DELETE_MOVEMENT_SQL)
                .bind(id)
                .bind(user_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|_| AppError::Internal)?;
        let Some((account_id, transfer_account_id, direction, amount)) = deleted else {
            // Deleted by another writer while we waited for the account lock:
            // the transaction drops uncommitted (the DELETE is gone) and the
            // foreign/missing id reads as 404.
            return Err(AppError::NotFound);
        };
        // The row moved to an account this attempt never locked: roll back
        // (undoing the DELETE above) and retry from a refreshed snapshot
        // before any balance math.
        let mut locked_set = vec![account_id];
        if let Some(destination) = transfer_account_id {
            locked_set.push(destination);
        }
        locked_set.sort();
        if locked_set != to_lock {
            tx.rollback().await.map_err(|_| AppError::Internal)?;
            snapshot = sqlx::query_as::<_, MovementRow>(GET_MOVEMENT_SQL)
                .bind(id)
                .bind(user_id)
                .fetch_optional(&state.pool)
                .await
                .map_err(|_| AppError::Internal)?
                .ok_or(AppError::NotFound)?;
            continue;
        }
        if direction == "transfer" {
            let destination = transfer_account_id.ok_or(AppError::Internal)?;
            // Undo the origin debit and the destination credit: both legs.
            sqlx::query(APPLY_BALANCE_SQL)
                .bind(account_id)
                .bind(amount)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(map_movement_db_err)?;
            sqlx::query(APPLY_BALANCE_SQL)
                .bind(destination)
                .bind(-amount)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(map_movement_db_err)?;
        } else {
            sqlx::query(APPLY_BALANCE_SQL)
                .bind(account_id)
                .bind(-signed_delta(&direction, amount)?)
                .bind(user_id)
                .execute(&mut *tx)
                .await
                .map_err(map_movement_db_err)?;
        }
        tx.commit().await.map_err(|_| AppError::Internal)?;
        return Ok(StatusCode::NO_CONTENT);
    }
    // Every attempt lost the account race: each transaction rolled back
    // cleanly (nothing written), so a 500 is safe.
    Err(AppError::Internal)
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
    fn accepts_expense_and_income_directions() {
        assert_eq!(validate_direction("expense").unwrap(), "expense");
        assert_eq!(validate_direction("income").unwrap(), "income");
        assert_eq!(validate_direction("  income  ").unwrap(), "income");
    }

    #[test]
    fn rejects_unknown_direction_as_422() {
        for raw in ["", "transfer", "Expense", "INCOME", "gasto"] {
            assert_422(validate_direction(raw).unwrap_err());
        }
    }

    #[test]
    fn movement_amount_accepts_valid_values() {
        assert_eq!(
            validate_movement_amount("25000.00").unwrap(),
            Decimal::new(2_500_000, 2)
        );
        assert_eq!(
            validate_movement_amount("0.01").unwrap(),
            Decimal::new(1, 2)
        );
        assert_eq!(
            validate_movement_amount("999999.99").unwrap(),
            Decimal::new(99_999_999, 2)
        );
        assert_eq!(
            validate_movement_amount("3500000.00").unwrap(),
            Decimal::new(350_000_000, 2)
        );
        assert_eq!(
            validate_movement_amount("999999999.99").unwrap(),
            Decimal::new(99_999_999_999, 2)
        );
        assert_eq!(
            validate_movement_amount(" 25000 ").unwrap(),
            Decimal::new(25_000, 0)
        );
    }

    #[test]
    fn movement_amount_rejects_bad_values_as_422() {
        for raw in [
            "0.00",
            "0",
            "-10.00",
            "10.005",
            "0.001",
            "abc",
            "",
            "12,50",
            "٢٥٠٠٠",
            "２５０００",
        ] {
            assert_422(validate_movement_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn movement_amount_rejects_billion_and_above_as_422() {
        for raw in ["1000000000.00", "1000000000", "2500000000.50"] {
            assert_422(validate_movement_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn description_accepts_short_but_rejects_oversized_as_422() {
        assert_eq!(validate_description("mercado").unwrap(), "mercado");
        assert_422(validate_description(&"x".repeat(2001)).unwrap_err());
        validate_description(&"x".repeat(2000))
            .expect("2000 chars is the documented bound");
        // The 422 says "maximo 2000 caracteres": count chars, not bytes.
        validate_description(&"á".repeat(2000)).expect("2000 accented chars fit by char count");
        assert_422(validate_description(&"á".repeat(2001)).unwrap_err());
    }

    #[test]
    fn movement_date_boundary_uses_canonical_validator() {
        assert_eq!(
            validate_occurred_on("2028-02-29").unwrap(),
            NaiveDate::from_ymd_opt(2028, 2, 29).unwrap()
        );
        assert!(validate_occurred_on("2026-02-29").is_err(), "non-leap Feb 29");
        assert_eq!(
            validate_occurred_on("0001-01-01").unwrap(),
            NaiveDate::from_ymd_opt(1, 1, 1).unwrap()
        );
        assert_eq!(
            validate_occurred_on(" 2026-10-03 ").unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 3).unwrap(),
            "padded date is trimmed"
        );
        assert!(
            validate_occurred_on("2026-10-03T00:00:00Z").is_err(),
            "RFC3339 must be 422 for occurred_on"
        );
    }

    #[test]
    fn create_rejects_number_amount_and_subscription_id_as_422() {
        let account_id = Uuid::new_v4();
        let category_id = Uuid::new_v4();
        // Money travels as a string: a JSON number never reaches the parser.
        let numeric = json!({
            "direction": "expense", "amount": 25000.00,
            "account_id": account_id, "category_id": category_id,
            "occurred_on": "2026-09-24"
        });
        assert!(
            serde_json::from_value::<CreateMovementRequest>(numeric).is_err(),
            "numeric amount must fail deserialization"
        );
        // `subscription_id` is not a create field (only Pay sets it).
        let with_sub = json!({
            "direction": "expense", "amount": "25000.00",
            "account_id": account_id, "category_id": category_id,
            "occurred_on": "2026-09-24", "subscription_id": Uuid::new_v4()
        });
        assert!(
            serde_json::from_value::<CreateMovementRequest>(with_sub).is_err(),
            "subscription_id must fail deserialization on create"
        );
        // Unknown fields and missing required fields are 422 at the boundary.
        let unknown = json!({
            "direction": "expense", "amount": "25000.00",
            "account_id": account_id, "category_id": category_id,
            "occurred_on": "2026-09-24", "frequency": "monthly"
        });
        assert!(
            serde_json::from_value::<CreateMovementRequest>(unknown).is_err(),
            "unknown field must fail deserialization"
        );
        let missing = json!({
            "direction": "expense", "amount": "25000.00",
            "account_id": account_id, "category_id": category_id
        });
        assert!(
            serde_json::from_value::<CreateMovementRequest>(missing).is_err(),
            "missing occurred_on must fail deserialization"
        );
        let ok: CreateMovementRequest = serde_json::from_value(json!({
            "direction": "expense", "amount": "25000.00",
            "account_id": account_id, "category_id": category_id,
            "occurred_on": "2026-09-24", "description": "mercado"
        }))
        .unwrap();
        assert_eq!(ok.description.as_deref(), Some("mercado"));
    }

    #[test]
    fn patch_accepts_empty_and_partial_but_rejects_subscription_id() {
        let empty: PatchMovementRequest = serde_json::from_value(json!({})).unwrap();
        assert!(empty.direction.is_none() && empty.amount.is_none());
        let partial: PatchMovementRequest = serde_json::from_value(json!({
            "direction": "income", "amount": "30000.00"
        }))
        .unwrap();
        assert_eq!(partial.direction.as_deref(), Some("income"));
        // The audit link can never be re-pointed through PATCH.
        let with_sub = json!({"subscription_id": Uuid::new_v4()});
        assert!(
            serde_json::from_value::<PatchMovementRequest>(with_sub).is_err(),
            "subscription_id must fail deserialization on patch"
        );
    }

    #[test]
    fn movement_response_serializes_money_as_string_and_date_as_ymd() {
        let resp = MovementResponse {
            id: Uuid::new_v4(),
            direction: "expense".into(),
            amount: Decimal::new(2_500_000, 2),
            occurred_on: NaiveDate::from_ymd_opt(2026, 9, 24).unwrap(),
            description: Some("mercado".into()),
            account_id: Uuid::new_v4(),
            transfer_account_id: None,
            category_id: Some(Uuid::new_v4()),
            subscription_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("25000.00".into()));
        assert_eq!(v["occurred_on"], serde_json::Value::String("2026-09-24".into()));
        assert_eq!(v["direction"], serde_json::Value::String("expense".into()));
        // Every movement serializes the destination slot; an expense has none.
        assert_eq!(v["transfer_account_id"], serde_json::Value::Null);
    }

    #[test]
    fn transfer_response_serializes_destination_and_null_category() {
        let destination = Uuid::new_v4();
        let resp = MovementResponse {
            id: Uuid::new_v4(),
            direction: "transfer".into(),
            amount: Decimal::new(2_500_000, 2),
            occurred_on: NaiveDate::from_ymd_opt(2026, 10, 4).unwrap(),
            description: None,
            account_id: Uuid::new_v4(),
            transfer_account_id: Some(destination),
            category_id: None,
            subscription_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["direction"], serde_json::Value::String("transfer".into()));
        assert_eq!(
            v["transfer_account_id"],
            serde_json::Value::String(destination.to_string())
        );
        assert_eq!(v["category_id"], serde_json::Value::Null);
    }

    #[test]
    fn signed_delta_fails_closed_and_transfer_debits_origin() {
        let amount = Decimal::new(2_500_000, 2);
        assert_eq!(signed_delta("expense", amount).unwrap(), -amount);
        // A transfer debits its origin; the destination leg is written
        // explicitly by the transfer handler, never through this helper.
        assert_eq!(signed_delta("transfer", amount).unwrap(), -amount);
        assert_eq!(signed_delta("income", amount).unwrap(), amount);
        // Fail closed: an unknown direction must never add money.
        for direction in ["", "Transfer", "gasto", "transfer_typo"] {
            assert!(
                matches!(signed_delta(direction, amount), Err(AppError::Internal)),
                "unknown direction {direction:?} must be an internal error"
            );
        }
    }

    #[test]
    fn patch_rejects_stored_transfer_with_spanish_422() {
        for direction in ["expense", "income"] {
            reject_transfer_patch(direction).expect("non-transfers stay editable");
        }
        let err = reject_transfer_patch("transfer").unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("transferencias"),
                "422 message must name transfers, got: {msg}"
            ),
            other => panic!("transfer PATCH must be a validation error, got: {other:?}"),
        }
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn transfer_request_allowlist_rejects_unknown_fields_and_numeric_amounts() {
        let from = Uuid::new_v4();
        let to = Uuid::new_v4();
        let ok: CreateTransferRequest = serde_json::from_value(json!({
            "from_account_id": from,
            "to_account_id": to,
            "amount": "25000.00",
            "occurred_on": "2026-10-04",
            "description": "ahorro"
        }))
        .unwrap();
        assert_eq!(ok.from_account_id, from);
        assert_eq!(ok.to_account_id, to);
        assert_eq!(ok.description.as_deref(), Some("ahorro"));
        for bad in [
            // Money travels as a decimal string, never a JSON number.
            json!({"from_account_id": from, "to_account_id": to, "amount": 25000.0, "occurred_on": "2026-10-04"}),
            // Every field outside the allowlist is unknown (422).
            json!({"from_account_id": from, "to_account_id": to, "amount": "25000.00", "occurred_on": "2026-10-04", "direction": "transfer"}),
            json!({"from_account_id": from, "to_account_id": to, "amount": "25000.00", "occurred_on": "2026-10-04", "category_id": Uuid::new_v4()}),
            json!({"from_account_id": from, "to_account_id": to, "amount": "25000.00", "occurred_on": "2026-10-04", "subscription_id": Uuid::new_v4()}),
            json!({"from_account_id": from, "to_account_id": to, "amount": "25000.00", "occurred_on": "2026-10-04", "transfer_account_id": to}),
            // Missing required fields fail at the boundary too.
            json!({"to_account_id": to, "amount": "25000.00", "occurred_on": "2026-10-04"}),
            json!({"from_account_id": from, "amount": "25000.00", "occurred_on": "2026-10-04"}),
        ] {
            assert!(
                serde_json::from_value::<CreateTransferRequest>(bad.clone()).is_err(),
                "transfer body must reject {bad}"
            );
        }
        // Only the transfer handler may write the destination column: the
        // expense/income create and PATCH DTOs reject it as unknown.
        let create_with_transfer = json!({
            "direction": "expense", "amount": "25000.00",
            "account_id": from, "category_id": to,
            "occurred_on": "2026-10-04", "transfer_account_id": to
        });
        assert!(
            serde_json::from_value::<CreateMovementRequest>(create_with_transfer).is_err(),
            "POST /movements must reject transfer_account_id"
        );
        assert!(
            serde_json::from_value::<PatchMovementRequest>(json!({"transfer_account_id": to}))
                .is_err(),
            "PATCH /movements/{{id}} must reject transfer_account_id"
        );
    }

    #[test]
    fn brief_sql_selects_only_s12_columns_with_verbatim_scope_and_order() {
        for sql in [LIST_MOVEMENTS_BRIEF_SQL, LIST_MOVEMENTS_RANGE_BRIEF_SQL] {
            assert!(
                sql.contains("user_id"),
                "brief SQL must scope by user_id, got: {sql}"
            );
            // Only the SELECT list must be free of the dropped columns: the
            // verbatim ORDER BY legitimately still mentions `created_at`.
            let select_list = sql.split(" FROM ").next().unwrap_or(sql);
            for dropped in ["subscription_id", "created_at", "updated_at"] {
                assert!(
                    !select_list.contains(dropped),
                    "brief SELECT must not carry `{dropped}`, got: {sql}"
                );
            }
            for kept in [
                "id",
                "account_id",
                "transfer_account_id",
                "category_id",
                "direction::text",
                "amount",
                "occurred_on",
                "description",
            ] {
                assert!(
                    sql.contains(kept),
                    "brief SQL must keep `{kept}`, got: {sql}"
                );
            }
            assert!(
                sql.contains("ORDER BY occurred_on DESC, created_at DESC, id DESC"),
                "brief must keep the full list order verbatim, got: {sql}"
            );
        }
        assert!(
            LIST_MOVEMENTS_RANGE_BRIEF_SQL.contains("occurred_on >= $2 AND occurred_on <= $3"),
            "ranged brief must keep the range bounds verbatim, got: {LIST_MOVEMENTS_RANGE_BRIEF_SQL}"
        );
    }

    #[test]
    fn movement_sql_scopes_every_query_by_user_id_and_locks_first() {
        // Shared projection: all six movement statements select exactly the
        // same 11 columns in the same order, so `MovementRow` decodes them
        // all and the tuple stays far below the sqlx cap of 16 (D2.5).
        const MOVEMENT_COLUMNS: &str = "id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at";
        for sql in [
            LOCK_ACCOUNT_SQL,
            LOCK_TRANSFER_ACCOUNTS_SQL,
            ACCOUNT_ARCHIVED_SQL,
            INSERT_MOVEMENT_SQL,
            INSERT_TRANSFER_SQL,
            APPLY_BALANCE_SQL,
            UPDATE_MOVEMENT_SQL,
            DELETE_MOVEMENT_SQL,
            LIST_MOVEMENTS_SQL,
            GET_MOVEMENT_SQL,
            LOCK_MOVEMENT_SQL,
            USER_CURRENCY_SQL,
            SUMMARY_TOTALS_SQL,
            SUMMARY_BY_ACCOUNT_SQL,
            SUMMARY_BY_CATEGORY_SQL,
            SUMMARY_BUCKETS_SQL,
            SUMMARY_RECENT_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "movement SQL must scope by user_id, got: {sql}"
            );
        }
        for sql in [
            INSERT_MOVEMENT_SQL,
            INSERT_TRANSFER_SQL,
            UPDATE_MOVEMENT_SQL,
            LIST_MOVEMENTS_SQL,
            GET_MOVEMENT_SQL,
            LOCK_MOVEMENT_SQL,
        ] {
            assert!(
                sql.contains(MOVEMENT_COLUMNS),
                "statement must select the 11 movement columns in order, got: {sql}"
            );
        }
        assert!(
            LOCK_ACCOUNT_SQL.contains("FOR UPDATE"),
            "account probe must lock the row, got: {LOCK_ACCOUNT_SQL}"
        );
        assert!(
            !LOCK_ACCOUNT_SQL.contains("is_archived"),
            "S3: the shared account lock stays ownership-only (Pay and every other caller), got: {LOCK_ACCOUNT_SQL}"
        );
        assert!(
            ACCOUNT_ARCHIVED_SQL.contains("is_archived")
                && ACCOUNT_ARCHIVED_SQL.contains("user_id"),
            "the archived backstop must read the owned row's flag, got: {ACCOUNT_ARCHIVED_SQL}"
        );
        assert!(
            LOCK_TRANSFER_ACCOUNTS_SQL.contains("is_archived"),
            "the transfer lock must carry the archived flag, got: {LOCK_TRANSFER_ACCOUNTS_SQL}"
        );
        assert!(
            ACCOUNT_CURRENCY_SQL.contains("currency") && ACCOUNT_CURRENCY_SQL.contains("user_id"),
            "the re-point currency read must be owned, got: {ACCOUNT_CURRENCY_SQL}"
        );
        assert!(
            LOCK_TRANSFER_ACCOUNTS_SQL.contains("FOR UPDATE")
                && LOCK_TRANSFER_ACCOUNTS_SQL.contains("currency"),
            "the transfer lock must serialize on the account rows and carry the currency, got: {LOCK_TRANSFER_ACCOUNTS_SQL}"
        );
        assert!(
            LOCK_MOVEMENT_SQL.contains("FOR UPDATE"),
            "PATCH must re-read the movement under the row lock, got: {LOCK_MOVEMENT_SQL}"
        );
        assert!(
            LIST_MOVEMENTS_SQL
                .contains("ORDER BY occurred_on DESC, created_at DESC, id DESC"),
            "list must carry the full API order, got: {LIST_MOVEMENTS_SQL}"
        );
        assert!(
            INSERT_MOVEMENT_SQL.contains("$4::movement_direction"),
            "insert must cast the direction enum, got: {INSERT_MOVEMENT_SQL}"
        );
        // The transfer insert writes the destination and the enum literal
        // directly; `category_id` is omitted so the CHECK keeps it NULL.
        assert!(
            INSERT_TRANSFER_SQL.contains("transfer_account_id")
                && INSERT_TRANSFER_SQL.contains("'transfer'")
                && !INSERT_TRANSFER_SQL
                    .split("VALUES")
                    .next()
                    .unwrap_or(INSERT_TRANSFER_SQL)
                    .contains("category_id"),
            "transfer insert must write the destination and no category, got: {INSERT_TRANSFER_SQL}"
        );
        // DELETE returns both legs so the reversal can undo origin+destination.
        assert!(
            DELETE_MOVEMENT_SQL.contains(
                "RETURNING account_id, transfer_account_id, direction::text, amount"
            ),
            "delete must return both account legs, got: {DELETE_MOVEMENT_SQL}"
        );
        let insert_columns = INSERT_MOVEMENT_SQL
            .split("VALUES")
            .next()
            .unwrap_or(INSERT_MOVEMENT_SQL);
        assert!(
            !insert_columns.contains("updated_at"),
            "insert column list relies on the created_at/updated_at column defaults, got: {insert_columns}"
        );
        assert!(
            LIST_MOVEMENTS_SQL == "SELECT id, account_id, transfer_account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE user_id=$1 ORDER BY occurred_on DESC, created_at DESC, id DESC",
            "LIST_MOVEMENTS_SQL must stay byte-identical: the no-params path keeps today's statement"
        );
        assert!(
            LIST_MOVEMENTS_RANGE_SQL.contains(MOVEMENT_COLUMNS),
            "ranged statement must select the 11 movement columns in order, got: {LIST_MOVEMENTS_RANGE_SQL}"
        );
        assert!(
            LIST_MOVEMENTS_RANGE_SQL
                .contains("ORDER BY occurred_on DESC, created_at DESC, id DESC"),
            "ranged statement must carry the full API order, got: {LIST_MOVEMENTS_RANGE_SQL}"
        );
        assert!(
            LIST_MOVEMENTS_RANGE_SQL.contains("occurred_on >= $2")
                && LIST_MOVEMENTS_RANGE_SQL.contains("occurred_on <= $3"),
            "ranged statement must bound occurred_on inclusively on both edges, got: {LIST_MOVEMENTS_RANGE_SQL}"
        );
        assert!(
            LIST_MOVEMENTS_RANGE_SQL.contains("user_id=$1"),
            "ranged statement must scope by user_id, got: {LIST_MOVEMENTS_RANGE_SQL}"
        );
        assert!(
            !LIST_MOVEMENTS_RANGE_SQL.contains("LIMIT")
                && !LIST_MOVEMENTS_RANGE_SQL.to_lowercase().contains("limit"),
            "ranged statement must not add a limit (S3a), got: {LIST_MOVEMENTS_RANGE_SQL}"
        );
        // The no-params path resolves to no range, so the handler keeps
        // serving LIST_MOVEMENTS_SQL byte-identical to today.
        assert!(
            parse_movement_range(None, None).unwrap().is_none(),
            "no query parameters must resolve to the unfiltered statement"
        );
    }

    #[test]
    fn range_query_accepts_optional_bounds_but_rejects_unknown_fields() {
        let ok: MovementRangeQuery = serde_json::from_value(json!({
            "from": "2026-10-01", "to": "2026-10-31"
        }))
        .expect("from+to must deserialize");
        assert_eq!(ok.from.as_deref(), Some("2026-10-01"));
        assert_eq!(ok.to.as_deref(), Some("2026-10-31"));
        let empty: MovementRangeQuery = serde_json::from_value(json!({})).unwrap();
        assert!(empty.from.is_none() && empty.to.is_none());
        // Unknown query fields are rejected (422), never silently ignored.
        for bad in [
            json!({"from": "2026-10-01", "to": "2026-10-31", "limit": 500}),
            json!({"view": "month"}),
            json!({"from": "2026-10-01", "to": "2026-10-31", "order": "asc"}),
        ] {
            assert!(
                serde_json::from_value::<MovementRangeQuery>(bad.clone()).is_err(),
                "range query must reject unknown field: {bad}"
            );
        }
    }

    #[test]
    fn range_rejects_malformed_and_half_specified_dates_as_422() {
        // Malformed dates are 422.
        for (from, to) in [
            (Some("not-a-date"), Some("2026-10-31")),
            (Some("2026-10-01"), Some("nope")),
            (Some("2026-13-01"), Some("2026-10-31")),
            (Some("2026-10-01"), Some("2026-02-30")),
            (Some("01/10/2026"), Some("2026-10-31")),
            (Some("2026-10-01T00:00:00Z"), Some("2026-10-31")),
            (Some("2026-10-01"), Some("2026-10-31T00:00:00Z")),
        ] {
            let err = parse_movement_range(from, to).unwrap_err();
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                "malformed range ({from:?}, {to:?}) must be 422"
            );
        }
        // Half-specified bounds are 422: from and to travel together or not at all.
        for (from, to) in [
            (Some("2026-10-01"), None),
            (None, Some("2026-10-31")),
        ] {
            let err = parse_movement_range(from, to).unwrap_err();
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                "half-specified range ({from:?}, {to:?}) must be 422"
            );
        }
        // An inverted window is 422 as well.
        let err = parse_movement_range(Some("2026-10-31"), Some("2026-10-01"))
            .unwrap_err();
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        // Sanity: a well-formed window parses to the inclusive bounds.
        let (from, to) =
            parse_movement_range(Some("2026-10-01"), Some("2026-10-31"))
                .expect("valid window parses")
                .expect("valid window is Some");
        assert_eq!(from.to_string(), "2026-10-01");
        assert_eq!(to.to_string(), "2026-10-31");
    }

    #[test]
    fn summary_group_accepts_the_contract_values_and_rejects_others_as_422() {
        assert_eq!(parse_summary_group(Some("day")).unwrap(), SummaryGroup::Day);
        assert_eq!(parse_summary_group(Some("week")).unwrap(), SummaryGroup::Week);
        assert_eq!(parse_summary_group(Some("month")).unwrap(), SummaryGroup::Month);
        assert_eq!(parse_summary_group(Some("year")).unwrap(), SummaryGroup::Year);
        for raw in [None, Some(""), Some("quarter"), Some("Month"), Some("months")] {
            assert_422(parse_summary_group(raw).unwrap_err());
        }
    }

    #[test]
    fn summary_window_requires_both_bounds_and_keeps_them_inclusive() {
        let (from, to) =
            parse_summary_window(Some("2026-10-01"), Some("2026-10-31")).expect("valid window");
        assert_eq!(from.to_string(), "2026-10-01");
        assert_eq!(to.to_string(), "2026-10-31");
        // Unlike the optional `/movements` range, the summary has no unbounded
        // mode: absent, half-specified, malformed and inverted windows are 422.
        for (from, to) in [
            (None, None),
            (Some("2026-10-01"), None),
            (None, Some("2026-10-31")),
            (Some("not-a-date"), Some("2026-10-31")),
            (Some("2026-10-31"), Some("2026-10-01")),
        ] {
            assert_422(parse_summary_window(from, to).unwrap_err());
        }
    }

    #[test]
    fn summary_query_accepts_the_contract_and_rejects_unknown_fields() {
        let ok: MovementSummaryQuery = serde_json::from_value(json!({
            "from": "2026-10-01", "to": "2026-10-31", "group": "month"
        }))
        .expect("contract query must deserialize");
        assert_eq!(ok.group.as_deref(), Some("month"));
        for bad in [
            json!({"from": "2026-10-01", "to": "2026-10-31", "group": "month", "limit": 5}),
            json!({"from": "2026-10-01", "to": "2026-10-31", "group": "month", "period": "month"}),
        ] {
            assert!(
                serde_json::from_value::<MovementSummaryQuery>(bad.clone()).is_err(),
                "summary query must reject unknown field: {bad}"
            );
        }
    }

    #[test]
    fn summary_buckets_use_contract_keys_and_natural_boundaries() {
        let d = |year, month, day| NaiveDate::from_ymd_opt(year, month, day).unwrap();
        let day_buckets =
            summary_bucket_windows(SummaryGroup::Day, d(2026, 10, 1), d(2026, 10, 3));
        assert_eq!(
            day_buckets.iter().map(|b| b.key.as_str()).collect::<Vec<_>>(),
            ["2026-10-01", "2026-10-02", "2026-10-03"]
        );
        assert!(
            day_buckets.iter().all(|b| b.from == b.to),
            "a day bucket covers exactly its day"
        );

        // ISO weeks: 2026-10-01 is Thursday of W40 (Mon 28 Sep – Sun 4 Oct).
        let week_buckets =
            summary_bucket_windows(SummaryGroup::Week, d(2026, 10, 1), d(2026, 10, 14));
        assert_eq!(
            week_buckets
                .iter()
                .map(|b| b.key.as_str())
                .collect::<Vec<_>>(),
            ["2026-W40", "2026-W41", "2026-W42"]
        );
        assert_eq!(
            (week_buckets[0].from, week_buckets[0].to),
            (d(2026, 9, 28), d(2026, 10, 4))
        );
        assert_eq!(
            (week_buckets[1].from, week_buckets[1].to),
            (d(2026, 10, 5), d(2026, 10, 11))
        );
        assert_eq!(
            (week_buckets[2].from, week_buckets[2].to),
            (d(2026, 10, 12), d(2026, 10, 18))
        );

        let month_buckets =
            summary_bucket_windows(SummaryGroup::Month, d(2026, 9, 15), d(2026, 11, 2));
        assert_eq!(
            month_buckets
                .iter()
                .map(|b| b.key.as_str())
                .collect::<Vec<_>>(),
            ["2026-09", "2026-10", "2026-11"]
        );
        assert_eq!(
            (month_buckets[1].from, month_buckets[1].to),
            (d(2026, 10, 1), d(2026, 10, 31))
        );
        assert_eq!(
            (month_buckets[2].from, month_buckets[2].to),
            (d(2026, 11, 1), d(2026, 11, 30))
        );

        let year_buckets =
            summary_bucket_windows(SummaryGroup::Year, d(2025, 6, 1), d(2026, 3, 1));
        assert_eq!(
            year_buckets
                .iter()
                .map(|b| b.key.as_str())
                .collect::<Vec<_>>(),
            ["2025", "2026"]
        );
        assert_eq!(
            (year_buckets[0].from, year_buckets[0].to),
            (d(2025, 1, 1), d(2025, 12, 31))
        );
        assert!(year_buckets
            .iter()
            .all(|b| b.expense == Decimal::ZERO && b.income == Decimal::ZERO));
    }

    #[test]
    fn summary_response_serializes_the_pinned_contract() {
        let response = MovementSummaryResponse {
            totals: MovementSummaryTotals {
                expense: Decimal::new(11000, 2),
                income: Decimal::new(5000, 2),
                count: 4,
            },
            by_account: vec![MovementSummaryAccount {
                account_id: Uuid::new_v4(),
                expense: Decimal::new(11000, 2),
                income: Decimal::new(5000, 2),
            }],
            by_category: vec![MovementSummaryCategory {
                category_id: Uuid::new_v4(),
                expense: Decimal::new(11000, 2),
                income: Decimal::new(5000, 2),
            }],
            buckets: vec![SummaryBucket {
                key: "2026-10".into(),
                from: NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
                to: NaiveDate::from_ymd_opt(2026, 10, 31).unwrap(),
                expense: Decimal::new(11000, 2),
                income: Decimal::new(5000, 2),
            }],
            recent: Vec::new(),
            recent_total: 6,
        };
        let v = serde_json::to_value(&response).unwrap();
        // Money stays a decimal string (the repo-wide wire convention).
        assert_eq!(v["totals"]["expense"], "110.00");
        assert_eq!(v["totals"]["income"], "50.00");
        assert_eq!(v["totals"]["count"], 4);
        assert!(v["by_account"].is_array());
        assert!(v["by_account"][0].get("account_id").is_some());
        assert!(v["by_category"].is_array());
        assert!(v["by_category"][0].get("category_id").is_some());
        assert_eq!(v["buckets"][0]["key"], "2026-10");
        assert_eq!(v["buckets"][0]["from"], "2026-10-01");
        assert_eq!(v["buckets"][0]["to"], "2026-10-31");
        assert!(v["recent"].is_array());
        assert_eq!(v["recent_total"], 6);
        let keys: std::collections::BTreeSet<&str> = v
            .as_object()
            .expect("summary is a JSON object")
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "totals",
                "by_account",
                "by_category",
                "buckets",
                "recent",
                "recent_total"
            ]
            .into_iter()
            .collect()
        );
    }

    #[tokio::test]
    async fn range_query_extraction_rejects_unknown_fields_as_422() {
        use axum::extract::FromRequestParts;
        let req = axum::http::Request::builder()
            .uri("/movements?from=2026-10-01&to=2026-10-31&limit=500")
            .body(())
            .expect("request builds");
        let mut parts = req.into_parts().0;
        let err =
            crate::routes::habits::ValidatedQuery::<MovementRangeQuery>::from_request_parts(
                &mut parts,
                &(),
            )
            .await
            .expect_err("unknown query field must be rejected");
        let resp = err.into_response();
        assert_eq!(resp.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
        let body = axum::body::to_bytes(resp.into_body(), 8192)
            .await
            .expect("body readable");
        let v: serde_json::Value = serde_json::from_slice(&body).expect("json body");
        assert_eq!(v["error"]["code"], serde_json::Value::String("VALIDATION_ERROR".into()));
    }

    // -- DB-gated tests (skip without DATABASE_URL) --------------------------

    /// Behavioral regression for the PATCH same-currency rule: re-pointing a
    /// stored movement at an account of another currency used to re-denominate
    /// the delta silently (found by the independent verifier, same class as the
    /// pay rule). A same-currency re-point must keep working.
    #[tokio::test]
    async fn patch_repoint_to_another_currency_is_422_and_moves_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP patch_repoint_to_another_currency_is_422_and_moves_nothing: no DATABASE_URL"
            );
            return;
        };
        async fn balance_of(pool: &sqlx::PgPool, account_id: Uuid) -> Decimal {
            sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
                .bind(account_id)
                .fetch_one(pool)
                .await
                .expect("read balance")
        }
        let (state, headers, user_id) = db_state(&pool).await;
        let cop_from = seed_account(&pool, user_id, "cop-from", "1000.00").await;
        let cop_to = seed_account(&pool, user_id, "cop-to", "500.00").await;
        let usd = seed_account_with_currency(&pool, user_id, "usd", "0.00", "USD").await;
        let category = seed_category(&pool, user_id, "finance", "cat").await;
        let movement_id: Uuid = sqlx::query_scalar(
            "INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on) VALUES ($1,$2,$3,'expense',$4::numeric,'2026-10-01') RETURNING id",
        )
        .bind(user_id)
        .bind(cop_from)
        .bind(category)
        .bind("100.00")
        .fetch_one(&pool)
        .await
        .expect("seed movement");

        let cross: PatchMovementRequest =
            serde_json::from_value(json!({ "account_id": usd })).expect("valid patch body");
        let err = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(movement_id),
            Json(cross),
        )
        .await
        .expect_err("a cross-currency re-point must be rejected");
        assert_422(err);
        assert_eq!(balance_of(&pool, cop_from).await, Decimal::from(1000));
        assert_eq!(balance_of(&pool, usd).await, Decimal::ZERO);

        let same: PatchMovementRequest =
            serde_json::from_value(json!({ "account_id": cop_to })).expect("valid patch body");
        let moved = patch_movement_handler(State(state), headers, Path(movement_id), Json(same))
            .await
            .expect("a same-currency re-point succeeds");
        assert_eq!(moved.account_id, cop_to);
        // The reversal credits the origin, then the new debit lands on the target.
        assert_eq!(balance_of(&pool, cop_from).await, Decimal::from(1100));
        assert_eq!(balance_of(&pool, cop_to).await, Decimal::from(400));
        cleanup_user(&pool, user_id).await;
    }

    /// S3 backstop: creating a movement on an archived account is 422 and
    /// persists nothing. The active-account control stays 201.
    #[tokio::test]
    async fn create_on_archived_account_is_422_and_persists_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP create_on_archived_account_is_422_and_persists_nothing: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let archived = seed_archived_account(&pool, user_id, "Vieja", "1000.00").await;
        let category = seed_category(&pool, user_id, "finance", "cat").await;
        let err = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(archived, category, json!({"amount": "100.00"})),
        )
        .await
        .expect_err("an archived source account must be 422");
        assert_422(err);
        assert_eq!(movement_count(&pool, user_id).await, 0);
        assert_eq!(account_balance(&pool, archived).await, Decimal::from(1000));

        // Control: the same body on an active account is still 201.
        let active = seed_account(&pool, user_id, "Activa", "1000.00").await;
        let (status, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(active, category, json!({"amount": "100.00"})),
        )
        .await
        .expect("an active source account stays creatable");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created.account_id, active);
        assert_eq!(account_balance(&pool, active).await, Decimal::from(900));
        cleanup_user(&pool, user_id).await;
    }

    /// S3 covers the transfer target too: either archived leg is 422 and the
    /// transfer writes no row and moves no balance.
    #[tokio::test]
    async fn create_transfer_with_archived_account_is_422_and_persists_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP create_transfer_with_archived_account_is_422_and_persists_nothing: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let active = seed_account(&pool, user_id, "Activa", "1000.00").await;
        let archived = seed_archived_account(&pool, user_id, "Vieja", "1000.00").await;
        for (from, to) in [(archived, active), (active, archived)] {
            let err = create_transfer_handler(
                State(state.clone()),
                headers.clone(),
                Json(transfer_body(from, to, "50.00", "2026-10-04")),
            )
            .await
            .expect_err("an archived transfer leg must be 422");
            assert_422(err);
        }
        assert_eq!(movement_count(&pool, user_id).await, 0);
        assert_eq!(account_balance(&pool, active).await, Decimal::from(1000));
        assert_eq!(account_balance(&pool, archived).await, Decimal::from(1000));
        cleanup_user(&pool, user_id).await;
    }

    /// S3: re-pointing a movement TOWARD an archived account is 422 and moves
    /// neither row nor balance.
    #[tokio::test]
    async fn repoint_to_archived_account_is_422_and_moves_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP repoint_to_archived_account_is_422_and_moves_nothing: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let origin = seed_account(&pool, user_id, "Origen", "1000.00").await;
        let archived = seed_archived_account(&pool, user_id, "Vieja", "500.00").await;
        let category = seed_category(&pool, user_id, "finance", "cat").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(
                origin,
                category,
                json!({"amount": "100.00", "occurred_on": "2026-10-01"}),
            ),
        )
        .await
        .expect("seed movement is 201");
        assert_eq!(account_balance(&pool, origin).await, Decimal::from(900));

        let err = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.id),
            Json(
                serde_json::from_value(json!({"account_id": archived}))
                    .expect("valid patch body"),
            ),
        )
        .await
        .expect_err("re-pointing to an archived account must be 422");
        assert_422(err);
        let stored_account: Uuid =
            sqlx::query_scalar("SELECT account_id FROM movements WHERE id=$1")
                .bind(created.id)
                .fetch_one(&pool)
                .await
                .expect("read stored movement");
        assert_eq!(stored_account, origin);
        assert_eq!(account_balance(&pool, origin).await, Decimal::from(900));
        assert_eq!(account_balance(&pool, archived).await, Decimal::from(500));
        cleanup_user(&pool, user_id).await;
    }

    /// S3: the correction path stays open — a movement stored on an archived
    /// account can be re-pointed to an active one, and an amount-only edit on
    /// the archived account is not a re-point and stays allowed.
    #[tokio::test]
    async fn repoint_away_from_archived_account_is_200() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP repoint_away_from_archived_account_is_200: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let target = seed_account(&pool, user_id, "Activa", "1000.00").await;
        let archived = seed_archived_account(&pool, user_id, "Vieja", "900.00").await;
        let category = seed_category(&pool, user_id, "finance", "cat").await;
        let movement_id = seed_movement_row(
            &pool,
            user_id,
            archived,
            None,
            Some(category),
            "expense",
            "100.00",
            "2026-10-01",
            Some("correccion"),
        )
        .await;
        let patched = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(movement_id),
            Json(
                serde_json::from_value(json!({"account_id": target}))
                    .expect("valid patch body"),
            ),
        )
        .await
        .expect("moving away from an archived account stays 200");
        assert_eq!(patched.account_id, target);
        assert_eq!(account_balance(&pool, archived).await, Decimal::from(1000));
        assert_eq!(account_balance(&pool, target).await, Decimal::from(900));

        // Amount-only edit on a movement still stored on the archived account:
        // there is no NEW archived target, so it is not the blocked re-point.
        let kept = seed_movement_row(
            &pool,
            user_id,
            archived,
            None,
            Some(category),
            "expense",
            "20.00",
            "2026-10-02",
            None,
        )
        .await;
        let edited = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(kept),
            Json(
                serde_json::from_value(json!({"amount": "30.00"}))
                    .expect("valid patch body"),
            ),
        )
        .await
        .expect("an amount-only edit on an archived account stays 200");
        assert_eq!(edited.account_id, archived);
        assert_eq!(edited.amount, Decimal::new(3000, 2));
        cleanup_user(&pool, user_id).await;
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("mov-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("movement test")
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

    /// Delete in dependency order: `movements.account_id` is
    /// `ON DELETE RESTRICT`, so movement rows go before the user cascade.
    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
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

    async fn seed_account(pool: &sqlx::PgPool, user_id: Uuid, name: &str, balance: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, balance) VALUES ($1,$2,$3::numeric) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .bind(balance)
        .fetch_one(pool)
        .await
        .expect("seed account")
    }

    /// Same as [`seed_account`], with an explicit currency so the
    /// cross-currency rejection can be exercised (the column defaults to COP).
    async fn seed_account_with_currency(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        name: &str,
        balance: &str,
        currency: &str,
    ) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, currency, balance) VALUES ($1,$2,$3,$4::numeric) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .bind(currency)
        .bind(balance)
        .fetch_one(pool)
        .await
        .expect("seed account with currency")
    }

    async fn seed_category(pool: &sqlx::PgPool, user_id: Uuid, kind: &str, name: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO categories (user_id, kind, name) VALUES ($1,$2::category_kind,$3) RETURNING id",
        )
        .bind(user_id)
        .bind(kind)
        .bind(name)
        .fetch_one(pool)
        .await
        .expect("seed category")
    }

    /// Archived owned account: creation must reject it, while stored movements
    /// on it remain editable (the correction path).
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
        .bind(name)
        .bind(balance)
        .fetch_one(pool)
        .await
        .expect("seed archived account")
    }

    /// Raw ledger row for scenarios the create handlers now reject (an archived
    /// account) or for transfers. The balance is NOT adjusted: callers seed it.
    #[allow(clippy::too_many_arguments)]
    async fn seed_movement_row(
        pool: &sqlx::PgPool,
        user_id: Uuid,
        account_id: Uuid,
        transfer_account_id: Option<Uuid>,
        category_id: Option<Uuid>,
        direction: &str,
        amount: &str,
        occurred_on: &str,
        description: Option<&str>,
    ) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO movements (user_id, account_id, transfer_account_id, category_id, direction, amount, occurred_on, description) VALUES ($1,$2,$3,$4,$5::movement_direction,$6::numeric,$7::date,$8) RETURNING id",
        )
        .bind(user_id)
        .bind(account_id)
        .bind(transfer_account_id)
        .bind(category_id)
        .bind(direction)
        .bind(amount)
        .bind(occurred_on)
        .bind(description)
        .fetch_one(pool)
        .await
        .expect("seed movement row")
    }

    fn create_body(account_id: Uuid, category_id: Uuid, extra: serde_json::Value) -> Json<CreateMovementRequest> {
        let mut v = json!({
            "direction": "expense",
            "amount": "25000.00",
            "account_id": account_id,
            "category_id": category_id,
            "occurred_on": "2026-09-24"
        });
        for (k, val) in extra.as_object().expect("extra must be an object") {
            v[k] = val.clone();
        }
        Json(serde_json::from_value(v).expect("valid movement body"))
    }

    fn transfer_body(
        from_account_id: Uuid,
        to_account_id: Uuid,
        amount: &str,
        occurred_on: &str,
    ) -> CreateTransferRequest {
        CreateTransferRequest {
            from_account_id,
            to_account_id,
            amount: amount.to_string(),
            occurred_on: occurred_on.to_string(),
            description: None,
        }
    }

    async fn account_balance(pool: &sqlx::PgPool, account_id: Uuid) -> Decimal {
        sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
            .bind(account_id)
            .fetch_one(pool)
            .await
            .expect("read balance")
    }

    async fn movement_count(pool: &sqlx::PgPool, user_id: Uuid) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM movements WHERE user_id=$1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("count movements")
    }

    /// Ledger identity: the balance an account must show given its seeded
    /// base plus every stored signed delta. A concurrent writer that reverses
    /// a stale snapshot breaks it.
    async fn stored_delta_sum(pool: &sqlx::PgPool, user_id: Uuid, account_id: Uuid) -> Decimal {
        let rows: Vec<(String, Decimal)> = sqlx::query_as(
            "SELECT direction::text, amount FROM movements WHERE user_id=$1 AND account_id=$2",
        )
        .bind(user_id)
        .bind(account_id)
        .fetch_all(pool)
        .await
        .expect("read stored movement deltas");
        rows.iter().fold(Decimal::ZERO, |acc, (direction, amount)| {
            acc + signed_delta(direction, *amount)
                .expect("every stored movement has a known direction")
        })
    }

    /// Poll until at least `expected` backends are blocked by `holder_pid`'s
    /// transaction. Proves that both writer requests already took their
    /// pre-transaction snapshot and are queued on the locked account row.
    async fn wait_until_blocked_by(pool: &sqlx::PgPool, holder_pid: i32, expected: i64) -> bool {
        // Second and later waiters queue behind the first waiter's tuple
        // lock, so the wait chain must be walked transitively from the
        // holder, not just one blocking hop.
        const BLOCKED_CHAIN_SQL: &str = "WITH RECURSIVE blocked AS ( \
             SELECT pid FROM pg_stat_activity \
             WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid)) \
             UNION \
             SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid)) \
         ) SELECT count(*) FROM blocked";
        for _ in 0..100 {
            let blocked: i64 = sqlx::query_scalar(BLOCKED_CHAIN_SQL)
                .bind(holder_pid)
                .fetch_one(pool)
                .await
                .expect("poll blocked writers");
            if blocked >= expected {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        false
    }

    #[tokio::test]
    async fn insert_expense_reflects_in_balance_atomically() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP insert_expense_reflects_in_balance_atomically: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (status, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_id, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        assert_eq!(status, StatusCode::CREATED);
        let v = serde_json::to_value(&created.0).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("25000.00".into()));
        assert_eq!(v["direction"], serde_json::Value::String("expense".into()));
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(7_500_000, 2));
        assert_eq!(movement_count(&pool, user_id).await, 1);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn income_adds_to_balance() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP income_adds_to_balance: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "75000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Salario").await;
        let (status, _) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(
                account_id,
                category_id,
                json!({"direction": "income", "amount": "110000.00"}),
            ),
        )
        .await
        .expect("create income is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(18_500_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn any_owned_category_kind_is_accepted() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP any_owned_category_kind_is_accepted: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        // A `subscription`-kind category is NOT a finance category, but D3
        // removed the kind gate for movements: the write must succeed.
        let category_id = seed_category(&pool, user_id, "subscription", "Streaming").await;
        let (status, _) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_id, category_id, json!({})),
        )
        .await
        .expect("cross-kind category is accepted");
        assert_eq!(status, StatusCode::CREATED);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_reverses_the_balance() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_reverses_the_balance: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_id, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        let status = delete_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
        )
        .await
        .expect("delete is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(10_000_000, 2));
        assert_eq!(movement_count(&pool, user_id).await, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_income_subtracts_back() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_income_subtracts_back: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "75000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Salario").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(
                account_id,
                category_id,
                json!({"direction": "income", "amount": "110000.00"}),
            ),
        )
        .await
        .expect("create income is 201");
        delete_movement_handler(State(state.clone()), headers.clone(), Path(created.0.id))
            .await
            .expect("delete is 204");
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(7_500_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn patch_amount_only_reverses_and_reapplies() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_amount_only_reverses_and_reapplies: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_id, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(7_500_000, 2));
        let patched = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
            Json(serde_json::from_value(json!({"amount": "10000.00"})).unwrap()),
        )
        .await
        .expect("patch amount is 200");
        let v = serde_json::to_value(&patched.0).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("10000.00".into()));
        // 100000 − 25000 + 25000 − 10000 = 90000.
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(9_000_000, 2));
        assert_eq!(movement_count(&pool, user_id).await, 1);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn patch_direction_flip_reverses_sign() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_direction_flip_reverses_sign: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(
                account_id,
                category_id,
                json!({"direction": "expense", "amount": "30000.00"}),
            ),
        )
        .await
        .expect("create expense is 201");
        let _ = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
            Json(serde_json::from_value(json!({"direction": "income"})).unwrap()),
        )
        .await
        .expect("direction flip is 200");
        // 100000 − 30000 + 30000 + 30000 = 130000.
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(13_000_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn patch_account_move_updates_both_accounts() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_account_move_updates_both_accounts: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_a = seed_account(&pool, user_id, "Cash A", "100000.00").await;
        let account_b = seed_account(&pool, user_id, "Cash B", "50000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_a, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        let _ = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
            Json(serde_json::from_value(json!({"account_id": account_b})).unwrap()),
        )
        .await
        .expect("account move is 200");
        // A gains back 25000 → 100000; B loses 25000 → 25000.
        assert_eq!(account_balance(&pool, account_a).await, Decimal::new(10_000_000, 2));
        assert_eq!(account_balance(&pool, account_b).await, Decimal::new(2_500_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn patch_combo_direction_amount_and_account() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_combo_direction_amount_and_account: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_a = seed_account(&pool, user_id, "Cash A", "100000.00").await;
        let account_b = seed_account(&pool, user_id, "Cash B", "50000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_a, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        let _ = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
            Json(
                serde_json::from_value(json!({
                    "direction": "income",
                    "amount": "30000.00",
                    "account_id": account_b
                }))
                .unwrap(),
            ),
        )
        .await
        .expect("combo patch is 200");
        // A gains back 25000 → 100000; B gains 30000 → 80000.
        assert_eq!(account_balance(&pool, account_a).await, Decimal::new(10_000_000, 2));
        assert_eq!(account_balance(&pool, account_b).await, Decimal::new(8_000_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn failed_patch_leaves_no_partial_effect() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP failed_patch_leaves_no_partial_effect: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_id, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        let missing = Uuid::new_v4();
        let err = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
            Json(serde_json::from_value(json!({"account_id": missing})).unwrap()),
        )
        .await
        .expect_err("patch to a missing account must fail");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        // Movement unchanged, no balance adjusted, no row added.
        let got = get_movement_handler(State(state.clone()), headers.clone(), Path(created.0.id))
            .await
            .expect("movement still readable");
        assert_eq!(got.0.account_id, account_id);
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(7_500_000, 2));
        assert_eq!(movement_count(&pool, user_id).await, 1);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn concurrent_same_account_writes_serialize() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP concurrent_same_account_writes_serialize: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let mk_body = || {
            create_body(
                account_id,
                category_id,
                json!({"direction": "expense", "amount": "10000.00"}),
            )
        };
        let (r1, r2) = tokio::join!(
            create_movement_handler(State(state.clone()), headers.clone(), mk_body()),
            create_movement_handler(State(state.clone()), headers.clone(), mk_body())
        );
        let _ = r1.expect("first concurrent write is 201");
        let _ = r2.expect("second concurrent write is 201");
        // No lost update: both deltas applied against the locked row.
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(8_000_000, 2));
        assert_eq!(movement_count(&pool, user_id).await, 2);
        cleanup_user(&pool, user_id).await;
    }

    /// Two PATCHes on the SAME movement, both holding their pre-transaction
    /// snapshot before either commits, must not reverse a stale delta. The
    /// gate transaction holds the account row so both requests queue on it;
    /// the winner's committed values are what the second writer must undo.
    #[tokio::test]
    async fn serialized_concurrent_patches_keep_balance_consistent() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP serialized_concurrent_patches_keep_balance_consistent: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_id, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        let movement_id = created.0.id;
        // 100000 − 25000 = 75000.
        assert_eq!(account_balance(&pool, account_id).await, Decimal::new(7_500_000, 2));

        let mut gate = pool.begin().await.expect("gate transaction");
        let gate_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await
            .expect("gate backend pid");
        let gate_locked: Option<Uuid> = sqlx::query_scalar(LOCK_ACCOUNT_SQL)
            .bind(account_id)
            .bind(user_id)
            .fetch_optional(&mut *gate)
            .await
            .expect("gate locks the account");
        assert!(gate_locked.is_some(), "gate must lock the seeded account");

        let patch = |raw_amount: &'static str| {
            let state = state.clone();
            let headers = headers.clone();
            async move {
                patch_movement_handler(
                    State(state),
                    headers,
                    Path(movement_id),
                    Json(serde_json::from_value(json!({"amount": raw_amount})).unwrap()),
                )
                .await
            }
        };
        let first = tokio::spawn(patch("10000.00"));
        let second = tokio::spawn(patch("40000.00"));
        assert!(
            wait_until_blocked_by(&pool, gate_pid, 2).await,
            "both PATCHes must queue on the account lock with stale snapshots"
        );
        gate.commit().await.expect("release gate");

        let _ = first
            .await
            .expect("first patch task")
            .expect("first patch is 200");
        let _ = second
            .await
            .expect("second patch task")
            .expect("second patch is 200");

        // Whichever writer won the account lock, the second one must reverse
        // the committed row, so the ledger identity has to hold.
        let balance = account_balance(&pool, account_id).await;
        let deltas = stored_delta_sum(&pool, user_id, account_id).await;
        assert_eq!(
            balance,
            Decimal::new(10_000_000, 2) + deltas,
            "balance must equal the seeded base plus the stored signed deltas"
        );
        assert_eq!(movement_count(&pool, user_id).await, 1);
        cleanup_user(&pool, user_id).await;
    }

    /// Account-move variant: a committed PATCH moves the movement from A to B
    /// while both queued PATCHes hold a snapshot pointing at A. The reversal
    /// must land on B (the account that stores the delta), never on A, and the
    /// stored row must keep pointing at B.
    #[tokio::test]
    async fn serialized_concurrent_patches_after_move_reverse_on_stored_account() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP serialized_concurrent_patches_after_move_reverse_on_stored_account: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_a = seed_account(&pool, user_id, "Cash A", "100000.00").await;
        let account_b = seed_account(&pool, user_id, "Cash B", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let (_, created) = create_movement_handler(
            State(state.clone()),
            headers.clone(),
            create_body(account_a, category_id, json!({})),
        )
        .await
        .expect("create expense is 201");
        let movement_id = created.0.id;
        // A: 100000 − 25000 = 75000; B still 100000.

        let mut gate = pool.begin().await.expect("gate transaction");
        let gate_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *gate)
            .await
            .expect("gate backend pid");
        // Ascending UUID order, exactly like the handlers.
        let mut both = vec![account_a, account_b];
        both.sort();
        for account in both {
            let locked: Option<Uuid> = sqlx::query_scalar(LOCK_ACCOUNT_SQL)
                .bind(account)
                .bind(user_id)
                .fetch_optional(&mut *gate)
                .await
                .expect("gate locks both accounts");
            assert!(locked.is_some(), "gate must lock both seeded accounts");
        }

        let patch = |raw_amount: &'static str| {
            let state = state.clone();
            let headers = headers.clone();
            async move {
                patch_movement_handler(
                    State(state),
                    headers,
                    Path(movement_id),
                    Json(serde_json::from_value(json!({"amount": raw_amount})).unwrap()),
                )
                .await
            }
        };
        let first = tokio::spawn(patch("10000.00"));
        let second = tokio::spawn(patch("40000.00"));
        assert!(
            wait_until_blocked_by(&pool, gate_pid, 2).await,
            "both PATCHes must queue on the account lock with stale snapshots"
        );

        // Commit a legitimate account move while both PATCHes hold a stale
        // snapshot: reverse on A, apply on B, re-point the row — the state a
        // committed PATCH move leaves behind.
        sqlx::query(
            "UPDATE accounts SET balance = balance + $2, updated_at = now() WHERE id=$1 AND user_id=$3",
        )
        .bind(account_a)
        .bind(Decimal::new(2_500_000, 2))
        .bind(user_id)
        .execute(&mut *gate)
        .await
        .expect("gate reverses the expense on A");
        sqlx::query(
            "UPDATE accounts SET balance = balance - $2, updated_at = now() WHERE id=$1 AND user_id=$3",
        )
        .bind(account_b)
        .bind(Decimal::new(2_500_000, 2))
        .bind(user_id)
        .execute(&mut *gate)
        .await
        .expect("gate applies the expense on B");
        sqlx::query(
            "UPDATE movements SET account_id=$2, updated_at = now() WHERE id=$1 AND user_id=$3",
        )
        .bind(movement_id)
        .bind(account_b)
        .bind(user_id)
        .execute(&mut *gate)
        .await
        .expect("gate re-points the movement");
        gate.commit().await.expect("release gate");

        let _ = first
            .await
            .expect("first patch task")
            .expect("first patch is 200");
        let _ = second
            .await
            .expect("second patch task")
            .expect("second patch is 200");

        let stored: Vec<(Uuid, String, Decimal)> =
            sqlx::query_as("SELECT account_id, direction::text, amount FROM movements WHERE user_id=$1")
                .bind(user_id)
                .fetch_all(&pool)
                .await
                .expect("read stored movements");
        assert_eq!(stored.len(), 1, "exactly one movement must remain");
        assert_eq!(
            stored[0].0, account_b,
            "the movement must keep pointing at the account that stores the delta"
        );
        for account in [account_a, account_b] {
            let balance = account_balance(&pool, account).await;
            let deltas = stored_delta_sum(&pool, user_id, account).await;
            assert_eq!(
                balance,
                Decimal::new(10_000_000, 2) + deltas,
                "account {account} must equal its seeded base plus its stored signed deltas"
            );
        }
        // A holds no movement again, so it is back to its seeded base exactly.
        assert_eq!(account_balance(&pool, account_a).await, Decimal::new(10_000_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_movement_reads_as_not_found() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_movement_reads_as_not_found: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_a, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_a, "finance", "Mercado").await;
        let movement_id: Uuid = sqlx::query_scalar(
            "INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on) VALUES ($1,$2,$3,'expense',100,'2026-09-24') RETURNING id",
        )
        .bind(user_a)
        .bind(account_id)
        .bind(category_id)
        .fetch_one(&pool)
        .await
        .expect("seed movement");
        for res in [
            get_movement_handler(State(state_b.clone()), headers_b.clone(), Path(movement_id)).await.map(|_| ()),
            delete_movement_handler(State(state_b.clone()), headers_b.clone(), Path(movement_id)).await.map(|_| ()),
        ] {
            let err = res.expect_err("foreign movement must be 404");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::NOT_FOUND
            );
        }
        let err = patch_movement_handler(
            State(state_b.clone()),
            headers_b.clone(),
            Path(movement_id),
            Json(serde_json::from_value(json!({"amount": "5.00"})).unwrap()),
        )
        .await
        .expect_err("foreign patch must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn create_with_foreign_account_or_category_is_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP create_with_foreign_account_or_category_is_422: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let foreign_account = seed_account(&pool, user_a, "Cash", "100000.00").await;
        let foreign_category = seed_category(&pool, user_a, "finance", "Mercado").await;
        let own_account = seed_account(&pool, user_b, "Mine", "100000.00").await;
        let own_category = seed_category(&pool, user_b, "finance", "Propia").await;
        for body in [
            create_body(foreign_account, own_category, json!({})),
            create_body(own_account, foreign_category, json!({})),
        ] {
            let err = create_movement_handler(State(state_b.clone()), headers_b.clone(), body)
                .await
                .expect_err("foreign reference must be 422");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        // Nothing persisted for the caller: no row, no balance change.
        assert_eq!(movement_count(&pool, user_b).await, 0);
        assert_eq!(account_balance(&pool, own_account).await, Decimal::new(10_000_000, 2));
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn transfer_moves_both_balances_and_writes_one_row() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP transfer_moves_both_balances_and_writes_one_row: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let origin = seed_account(&pool, user_id, "Ahorros", "100000.00").await;
        let destination = seed_account(&pool, user_id, "Nequi", "50000.00").await;
        let (status, created) = create_transfer_handler(
            State(state.clone()),
            headers.clone(),
            Json(transfer_body(origin, destination, "25000.00", "2026-10-04")),
        )
        .await
        .expect("transfer is 201");
        assert_eq!(status, StatusCode::CREATED);
        let v = serde_json::to_value(&created.0).unwrap();
        assert_eq!(v["direction"], serde_json::Value::String("transfer".into()));
        assert_eq!(v["account_id"], serde_json::Value::String(origin.to_string()));
        assert_eq!(
            v["transfer_account_id"],
            serde_json::Value::String(destination.to_string())
        );
        assert_eq!(v["category_id"], serde_json::Value::Null);
        assert_eq!(v["amount"], serde_json::Value::String("25000.00".into()));
        // Both legs applied in the same transaction.
        assert_eq!(account_balance(&pool, origin).await, Decimal::new(7_500_000, 2));
        assert_eq!(account_balance(&pool, destination).await, Decimal::new(7_500_000, 2));
        // Exactly one ledger row: origin -> destination, no category.
        let rows: Vec<(Uuid, Option<Uuid>, Option<Uuid>, String, Decimal)> = sqlx::query_as(
            "SELECT account_id, transfer_account_id, category_id, direction::text, amount FROM movements WHERE user_id=$1",
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
        .expect("read transfer row");
        assert_eq!(rows.len(), 1, "a transfer is ONE ledger row");
        assert_eq!(rows[0].0, origin);
        assert_eq!(rows[0].1, Some(destination));
        assert_eq!(rows[0].2, None);
        assert_eq!(rows[0].3, "transfer");
        assert_eq!(rows[0].4, Decimal::new(2_500_000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn delete_transfer_restores_both_balances_and_removes_row() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP delete_transfer_restores_both_balances_and_removes_row: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let origin = seed_account(&pool, user_id, "Ahorros", "100000.00").await;
        let destination = seed_account(&pool, user_id, "Nequi", "50000.00").await;
        let (_, created) = create_transfer_handler(
            State(state.clone()),
            headers.clone(),
            Json(transfer_body(origin, destination, "25000.00", "2026-10-04")),
        )
        .await
        .expect("transfer is 201");
        let status = delete_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
        )
        .await
        .expect("delete transfer is 204");
        assert_eq!(status, StatusCode::NO_CONTENT);
        // Both legs undone: origin credit back, destination debit back.
        assert_eq!(account_balance(&pool, origin).await, Decimal::new(10_000_000, 2));
        assert_eq!(account_balance(&pool, destination).await, Decimal::new(5_000_000, 2));
        assert_eq!(movement_count(&pool, user_id).await, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn patch_on_transfer_is_422_and_changes_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP patch_on_transfer_is_422_and_changes_nothing: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let origin = seed_account(&pool, user_id, "Ahorros", "100000.00").await;
        let destination = seed_account(&pool, user_id, "Nequi", "50000.00").await;
        let (_, created) = create_transfer_handler(
            State(state.clone()),
            headers.clone(),
            Json(transfer_body(origin, destination, "25000.00", "2026-10-04")),
        )
        .await
        .expect("transfer is 201");
        let err = patch_movement_handler(
            State(state.clone()),
            headers.clone(),
            Path(created.0.id),
            Json(serde_json::from_value(json!({"amount": "1000.00"})).unwrap()),
        )
        .await
        .expect_err("patch on a transfer must be 422");
        match &err {
            AppError::Validation(msg) => {
                assert!(msg.contains("transferencias"), "got: {msg}")
            }
            other => panic!("patch on a transfer must be Validation, got: {other:?}"),
        }
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        // Both balances and the stored row are untouched.
        assert_eq!(account_balance(&pool, origin).await, Decimal::new(7_500_000, 2));
        assert_eq!(account_balance(&pool, destination).await, Decimal::new(7_500_000, 2));
        let stored: (String, Decimal, Option<Uuid>) = sqlx::query_as(
            "SELECT direction::text, amount, transfer_account_id FROM movements WHERE id=$1",
        )
        .bind(created.0.id)
        .fetch_one(&pool)
        .await
        .expect("read stored transfer");
        assert_eq!(
            stored,
            (
                "transfer".to_string(),
                Decimal::new(2_500_000, 2),
                Some(destination)
            )
        );
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn transfer_validation_is_spanish_422_and_persists_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP transfer_validation_is_spanish_422_and_persists_nothing: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cop = seed_account(&pool, user_id, "Ahorros", "100000.00").await;
        let cop2 = seed_account(&pool, user_id, "Nequi", "50000.00").await;
        let usd =
            seed_account_with_currency(&pool, user_id, "USD Card", "50000.00", "USD").await;
        let (_, _, other_user) = db_state(&pool).await;
        let foreign = seed_account(&pool, other_user, "Ajena", "100000.00").await;
        let missing = Uuid::new_v4();
        let cases: Vec<(CreateTransferRequest, &str, &str)> = vec![
            (transfer_body(cop, cop, "25000.00", "2026-10-04"), "same account", "distintas"),
            (transfer_body(cop, usd, "25000.00", "2026-10-04"), "cross currency", "misma moneda"),
            (transfer_body(cop, foreign, "25000.00", "2026-10-04"), "foreign destination", "pertenecer"),
            (transfer_body(foreign, cop, "25000.00", "2026-10-04"), "foreign origin", "pertenecer"),
            (transfer_body(cop, missing, "25000.00", "2026-10-04"), "missing destination", "pertenecer"),
            (transfer_body(cop, cop2, "0.00", "2026-10-04"), "non-positive amount", "monto"),
            (transfer_body(cop, cop2, "10.005", "2026-10-04"), "three decimals", "monto"),
            (transfer_body(cop, cop2, "25000.00", "2026-02-30"), "unparseable date", "fecha"),
        ];
        for (body, label, needle) in cases {
            let err = create_transfer_handler(State(state.clone()), headers.clone(), Json(body))
                .await
                .expect_err("invalid transfer must fail");
            match &err {
                AppError::Validation(msg) => assert!(
                    msg.contains(needle),
                    "{label}: message must contain {needle:?}, got: {msg}"
                ),
                other => panic!("{label}: expected Validation, got: {other:?}"),
            }
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY,
                "{label} must be 422"
            );
        }
        // Nothing persisted and no balance moved (own or foreign).
        assert_eq!(movement_count(&pool, user_id).await, 0);
        assert_eq!(account_balance(&pool, cop).await, Decimal::new(10_000_000, 2));
        assert_eq!(account_balance(&pool, cop2).await, Decimal::new(5_000_000, 2));
        assert_eq!(account_balance(&pool, usd).await, Decimal::new(5_000_000, 2));
        assert_eq!(account_balance(&pool, foreign).await, Decimal::new(10_000_000, 2));
        cleanup_user(&pool, user_id).await;
        cleanup_user(&pool, other_user).await;
    }

    #[tokio::test]
    async fn opposite_transfers_do_not_deadlock() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP opposite_transfers_do_not_deadlock: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let origin = seed_account(&pool, user_id, "Ahorros", "100000.00").await;
        let destination = seed_account(&pool, user_id, "Nequi", "50000.00").await;
        let (first, second) = tokio::join!(
            create_transfer_handler(
                State(state.clone()),
                headers.clone(),
                Json(transfer_body(origin, destination, "25000.00", "2026-10-04")),
            ),
            create_transfer_handler(
                State(state.clone()),
                headers.clone(),
                Json(transfer_body(destination, origin, "10000.00", "2026-10-04")),
            )
        );
        let _ = first.expect("A→B must commit (ascending-UUID lock order)");
        let _ = second.expect("B→A must commit (ascending-UUID lock order)");
        // 100000 − 25000 + 10000 and 50000 + 25000 − 10000.
        assert_eq!(account_balance(&pool, origin).await, Decimal::new(8_500_000, 2));
        assert_eq!(account_balance(&pool, destination).await, Decimal::new(6_500_000, 2));
        assert_eq!(movement_count(&pool, user_id).await, 2);
        cleanup_user(&pool, user_id).await;
    }

    /// Review fix: DELETE used to lock the movement row and only then the
    /// account, while PATCH locks the account first. The ABBA cycle let
    /// Postgres abort one writer with 40P01 (surfaced as a 500). This gate
    /// makes the interleaving deterministic: DELETE queues on the gated
    /// movement row (old order) before PATCH, and PATCH holds the account
    /// while waiting for that same row.
    #[tokio::test]
    async fn concurrent_patch_and_delete_never_deadlock_or_500() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP concurrent_patch_and_delete_never_deadlock_or_500: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "1000000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;

        for round in 0..8 {
            let (_, created) = create_movement_handler(
                State(state.clone()),
                headers.clone(),
                create_body(account_id, category_id, json!({})),
            )
            .await
            .expect("seed movement");
            let movement_id = created.0.id;

            // Gate the movement row so both writers queue inside their own
            // transaction instead of racing on scheduler timing.
            let mut gate = pool.begin().await.expect("gate transaction");
            let gate_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *gate)
                .await
                .expect("gate backend pid");
            let gate_locked: Option<Uuid> = sqlx::query_scalar(LOCK_MOVEMENT_SQL)
                .bind(movement_id)
                .bind(user_id)
                .fetch_optional(&mut *gate)
                .await
                .expect("gate locks the movement");
            assert!(gate_locked.is_some(), "gate must lock the seeded movement");

            let delete = tokio::spawn({
                let state = state.clone();
                let headers = headers.clone();
                async move {
                    delete_movement_handler(State(state), headers, Path(movement_id)).await
                }
            });
            assert!(
                wait_until_blocked_by(&pool, gate_pid, 1).await,
                "round {round}: DELETE must queue behind the gate"
            );
            let patch = tokio::spawn({
                let state = state.clone();
                let headers = headers.clone();
                async move {
                    patch_movement_handler(
                        State(state),
                        headers,
                        Path(movement_id),
                        Json(serde_json::from_value(json!({"amount": "30000.00"})).unwrap()),
                    )
                    .await
                }
            });
            // With the old movement-first DELETE the wait chain is
            // gate <- DELETE <- PATCH (PATCH holding the account and waiting
            // for the movement row); with the account-first fix it is
            // gate <- DELETE (account held) <- PATCH on that same account,
            // so no cycle can form.
            assert!(
                wait_until_blocked_by(&pool, gate_pid, 2).await,
                "round {round}: PATCH must queue behind DELETE's account lock"
            );
            gate.commit().await.expect("release gate");

            let patch_result = tokio::time::timeout(std::time::Duration::from_secs(30), patch)
                .await
                .expect("PATCH must resolve before the timeout")
                .expect("PATCH task must not panic");
            match patch_result {
                Ok(_) => {}
                Err(err) => assert_eq!(
                    err.into_response().status(),
                    axum::http::StatusCode::NOT_FOUND,
                    "round {round}: PATCH must never surface a deadlock/500"
                ),
            }
            let delete_result = tokio::time::timeout(std::time::Duration::from_secs(30), delete)
                .await
                .expect("DELETE must resolve before the timeout")
                .expect("DELETE task must not panic");
            match delete_result {
                Ok(status) => assert_eq!(status, StatusCode::NO_CONTENT),
                Err(err) => assert_eq!(
                    err.into_response().status(),
                    axum::http::StatusCode::NOT_FOUND,
                    "round {round}: DELETE must never surface a deadlock/500"
                ),
            }
            assert_eq!(
                movement_count(&pool, user_id).await,
                0,
                "round {round}: the movement must be gone"
            );
            assert_eq!(
                account_balance(&pool, account_id).await,
                Decimal::new(100_000_000, 2),
                "round {round}: create+patch+delete must restore the seeded balance"
            );
        }
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn unauthenticated_movement_access_is_401() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unauthenticated_movement_access_is_401: no DATABASE_URL");
            return;
        };
        let (state, _, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "100000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        let empty = HeaderMap::new();
        let err = create_movement_handler(
            State(state.clone()),
            empty.clone(),
            create_body(account_id, category_id, json!({})),
        )
        .await
        .expect_err("create without token must be 401");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNAUTHORIZED
        );
        let err = list_movements_handler(State(state.clone()), empty, range_query(None, None))
            .await
            .expect_err("list without token must be 401");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNAUTHORIZED
        );
        let _ = state;
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn list_returns_caller_movements_in_api_order() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP list_returns_caller_movements_in_api_order: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "1000000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        for date in ["2026-09-20", "2026-09-24", "2026-09-22"] {
            let _ = create_movement_handler(
                State(state.clone()),
                headers.clone(),
                create_body(account_id, category_id, json!({"occurred_on": date})),
            )
            .await
            .expect("seed movement");
        }
        let listed = list_movements_handler(
            State(state.clone()),
            headers.clone(),
            range_query(None, None),
        )
        .await
        .expect("list is 200");
        let MovementsResponse::Full(listed) = listed.0 else {
            panic!("default list must serve the full shape");
        };
        let dates: Vec<String> = listed
            .iter()
            .map(|m| m.occurred_on.to_string())
            .collect();
        assert_eq!(dates, vec!["2026-09-24", "2026-09-22", "2026-09-20"]);
        cleanup_user(&pool, user_id).await;
    }

    fn range_query(from: Option<&str>, to: Option<&str>) -> ValidatedQuery<MovementRangeQuery> {
        use crate::routes::habits::ValidatedQuery;
        ValidatedQuery(MovementRangeQuery {
            from: from.map(str::to_string),
            to: to.map(str::to_string),
            shape: None,
        })
    }

    #[tokio::test]
    async fn range_returns_rows_inclusive_on_both_edges() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP range_returns_rows_inclusive_on_both_edges: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account_id = seed_account(&pool, user_id, "Cash", "1000000.00").await;
        let category_id = seed_category(&pool, user_id, "finance", "Mercado").await;
        // Rows exactly on `from` and on `to` are included; one day outside
        // on either side is excluded.
        for date in [
            "2026-09-30",
            "2026-10-01",
            "2026-10-15",
            "2026-10-31",
            "2026-11-01",
        ] {
            let _ = create_movement_handler(
                State(state.clone()),
                headers.clone(),
                create_body(account_id, category_id, json!({"occurred_on": date})),
            )
            .await
            .expect("seed movement");
        }
        let listed = list_movements_handler(
            State(state.clone()),
            headers.clone(),
            range_query(Some("2026-10-01"), Some("2026-10-31")),
        )
        .await
        .expect("ranged list is 200");
        let MovementsResponse::Full(listed) = listed.0 else {
            panic!("default ranged list must serve the full shape");
        };
        let mut dates: Vec<String> = listed
            .iter()
            .map(|m| m.occurred_on.to_string())
            .collect();
        dates.sort();
        assert_eq!(dates, vec!["2026-10-01", "2026-10-15", "2026-10-31"]);
        // Malformed and half-specified bounds are 422 through the handler.
        for query in [
            range_query(Some("not-a-date"), Some("2026-10-31")),
            range_query(Some("2026-10-01"), None),
            range_query(None, Some("2026-10-31")),
        ] {
            let err = list_movements_handler(State(state.clone()), headers.clone(), query)
                .await
                .expect_err("bad range must be 422");
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
        cleanup_user(&pool, user_id).await;
    }

    fn summary_query(
        from: Option<&str>,
        to: Option<&str>,
        group: Option<&str>,
    ) -> ValidatedQuery<MovementSummaryQuery> {
        ValidatedQuery(MovementSummaryQuery {
            from: from.map(str::to_string),
            to: to.map(str::to_string),
            group: group.map(str::to_string),
        })
    }

    /// S1/T5: every field of the pinned contract, aggregated from SQL, against
    /// the same rules the client used to apply in the browser
    /// (`isUserCurrencyMovement` + `toExpenseByCategory`): only movements on
    /// ACTIVE accounts of the user's default currency feed `expense`/`income`
    /// and `count`; transfers count but never sum; `recent_total` counts every
    /// movement in the window.
    #[tokio::test]
    async fn summary_aggregates_follow_the_single_currency_client_rule() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP summary_aggregates_follow_the_single_currency_client_rule: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cop_a = seed_account(&pool, user_id, "A", "0.00").await;
        let cop_b = seed_account(&pool, user_id, "B", "0.00").await;
        let usd = seed_account_with_currency(&pool, user_id, "USD", "0.00", "USD").await;
        let archived = seed_archived_account(&pool, user_id, "Vieja", "0.00").await;
        let cat1 = seed_category(&pool, user_id, "finance", "Mercado").await;
        let cat2 = seed_category(&pool, user_id, "finance", "Transporte").await;
        let d = |day| NaiveDate::from_ymd_opt(2026, 10, day).unwrap();
        // Counted: active COP accounts (rows 1..=3 + the transfer).
        seed_movement_row(
            &pool, user_id, cop_a, None, Some(cat1), "expense", "100.00", "2026-10-01",
            Some("uno"),
        )
        .await;
        seed_movement_row(
            &pool, user_id, cop_a, None, Some(cat1), "income", "50.00", "2026-10-02",
            Some("dos"),
        )
        .await;
        seed_movement_row(
            &pool, user_id, cop_b, None, Some(cat2), "expense", "10.00", "2026-10-03",
            Some("tres"),
        )
        .await;
        // Excluded from the aggregates: foreign currency, archived account.
        seed_movement_row(
            &pool, user_id, usd, None, Some(cat1), "expense", "999.00", "2026-10-04",
            Some("cuatro"),
        )
        .await;
        seed_movement_row(
            &pool, user_id, archived, None, Some(cat1), "expense", "777.00", "2026-10-06",
            Some("cinco"),
        )
        .await;
        // Excluded: outside the window.
        seed_movement_row(
            &pool, user_id, cop_a, None, Some(cat2), "expense", "5.00", "2026-09-30",
            Some("fuera"),
        )
        .await;
        seed_movement_row(
            &pool, user_id, cop_a, None, Some(cat2), "income", "7.00", "2026-11-01",
            Some("fuera2"),
        )
        .await;
        // Counted in `count` / `recent_total`, never in expense/income.
        seed_movement_row(
            &pool, user_id, cop_a, Some(cop_b), None, "transfer", "30.00", "2026-10-07",
            Some("seis"),
        )
        .await;

        let summary = movement_summary_handler(
            State(state.clone()),
            headers.clone(),
            summary_query(Some("2026-10-01"), Some("2026-10-31"), Some("month")),
        )
        .await
        .expect("summary is 200");

        assert_eq!(summary.totals.expense, Decimal::new(11000, 2));
        assert_eq!(summary.totals.income, Decimal::new(5000, 2));
        assert_eq!(
            summary.totals.count, 4,
            "active user-currency movements, transfer included"
        );
        assert_eq!(summary.recent_total, 6, "every movement in range");

        assert_eq!(summary.by_account.len(), 2);
        let account_a = summary
            .by_account
            .iter()
            .find(|row| row.account_id == cop_a)
            .expect("account A is present");
        assert_eq!(account_a.expense, Decimal::new(10000, 2));
        assert_eq!(account_a.income, Decimal::new(5000, 2));
        let account_b = summary
            .by_account
            .iter()
            .find(|row| row.account_id == cop_b)
            .expect("account B is present");
        assert_eq!(account_b.expense, Decimal::new(1000, 2));
        assert_eq!(account_b.income, Decimal::ZERO);
        assert!(
            !summary.by_account.iter().any(|row| row.account_id == usd
                || row.account_id == archived),
            "foreign-currency and archived accounts never aggregate"
        );

        assert_eq!(summary.by_category.len(), 2);
        let mercado = summary
            .by_category
            .iter()
            .find(|row| row.category_id == cat1)
            .expect("category 1 is present");
        assert_eq!(mercado.expense, Decimal::new(10000, 2));
        assert_eq!(mercado.income, Decimal::new(5000, 2));
        let transporte = summary
            .by_category
            .iter()
            .find(|row| row.category_id == cat2)
            .expect("category 2 is present");
        assert_eq!(transporte.expense, Decimal::new(1000, 2));
        assert_eq!(transporte.income, Decimal::ZERO);
        // Largest expense first, mirroring the client pie ordering.
        assert_eq!(summary.by_category[0].category_id, cat1);

        assert_eq!(summary.buckets.len(), 1);
        assert_eq!(summary.buckets[0].key, "2026-10");
        assert_eq!(summary.buckets[0].from, d(1));
        assert_eq!(summary.buckets[0].to, d(31));
        assert_eq!(summary.buckets[0].expense, Decimal::new(11000, 2));
        assert_eq!(summary.buckets[0].income, Decimal::new(5000, 2));

        // `recent`: up to five, most recent first, from EVERY movement set.
        assert_eq!(summary.recent.len(), 5);
        assert_eq!(summary.recent[0].occurred_on, d(7));
        assert_eq!(summary.recent[0].direction, "transfer");
        assert_eq!(summary.recent[0].transfer_account_id, Some(cop_b));
        assert_eq!(
            summary
                .recent
                .iter()
                .map(|row| row.occurred_on)
                .collect::<Vec<_>>(),
            vec![d(7), d(6), d(4), d(3), d(2)]
        );
        cleanup_user(&pool, user_id).await;
    }

    /// S1/T5: the user's default currency is read server-side from
    /// `user_preferences` (fallback COP), never assumed from the account name.
    #[tokio::test]
    async fn summary_reads_the_users_default_currency_from_preferences() {
        let Some(pool) = test_pool() else {
            eprintln!(
                "SKIP summary_reads_the_users_default_currency_from_preferences: no DATABASE_URL"
            );
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let cop = seed_account(&pool, user_id, "Pesos", "0.00").await;
        let usd = seed_account_with_currency(&pool, user_id, "Dolares", "0.00", "USD").await;
        let category = seed_category(&pool, user_id, "finance", "cat").await;
        seed_movement_row(
            &pool, user_id, cop, None, Some(category), "expense", "100.00", "2026-10-01", None,
        )
        .await;
        seed_movement_row(
            &pool, user_id, usd, None, Some(category), "expense", "9.00", "2026-10-02", None,
        )
        .await;

        // No preferences row: the documented fallback is COP.
        let cop_summary = movement_summary_handler(
            State(state.clone()),
            headers.clone(),
            summary_query(Some("2026-10-01"), Some("2026-10-31"), Some("day")),
        )
        .await
        .expect("summary is 200");
        assert_eq!(cop_summary.totals.expense, Decimal::new(10000, 2));
        assert_eq!(cop_summary.totals.count, 1);

        sqlx::query(
            "INSERT INTO user_preferences (user_id, currency_code) VALUES ($1,'USD') ON CONFLICT (user_id) DO UPDATE SET currency_code='USD'",
        )
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("switch the user's default currency");
        let usd_summary = movement_summary_handler(
            State(state.clone()),
            headers.clone(),
            summary_query(Some("2026-10-01"), Some("2026-10-31"), Some("day")),
        )
        .await
        .expect("summary is 200");
        assert_eq!(usd_summary.totals.expense, Decimal::new(900, 2));
        assert_eq!(usd_summary.totals.count, 1);
        assert_eq!(usd_summary.by_account.len(), 1);
        assert_eq!(usd_summary.by_account[0].account_id, usd);
        cleanup_user(&pool, user_id).await;
    }

    /// S1/T5: the summary window has no unbounded mode and the group is
    /// strict; every bad combination is a 422 before any aggregate query.
    #[tokio::test]
    async fn summary_rejects_missing_or_invalid_parameters_as_422() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP summary_rejects_missing_or_invalid_parameters_as_422: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        for query in [
            summary_query(None, None, Some("month")),
            summary_query(Some("2026-10-01"), None, Some("month")),
            summary_query(None, Some("2026-10-31"), Some("month")),
            summary_query(Some("2026-10-01"), Some("2026-10-31"), None),
            summary_query(Some("2026-10-01"), Some("2026-10-31"), Some("quarter")),
            summary_query(Some("not-a-date"), Some("2026-10-31"), Some("month")),
            summary_query(Some("2026-10-31"), Some("2026-10-01"), Some("month")),
        ] {
            let err = movement_summary_handler(State(state.clone()), headers.clone(), query)
                .await
                .expect_err("bad summary parameters must be 422");
            assert_422(err);
        }
        cleanup_user(&pool, user_id).await;
    }

    /// S1/T5: `date_trunc` grouping matches the client keys for all four
    /// granularities, including the ISO week-year boundary (2027-01-01 belongs
    /// to ISO week 2026-W53).
    #[tokio::test]
    async fn summary_bucket_grouping_covers_every_group() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP summary_bucket_grouping_covers_every_group: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let account = seed_account(&pool, user_id, "Cash", "0.00").await;
        let category = seed_category(&pool, user_id, "finance", "cat").await;
        for (direction, amount, date) in [
            ("expense", "10.00", "2026-10-01"),
            ("income", "20.00", "2026-10-04"),
            ("expense", "30.00", "2026-10-05"),
            ("expense", "40.00", "2026-12-31"),
            ("income", "50.00", "2027-01-01"),
        ] {
            seed_movement_row(
                &pool,
                user_id,
                account,
                None,
                Some(category),
                direction,
                amount,
                date,
                None,
            )
            .await;
        }
        let grouped = |group: &'static str| {
            let state = state.clone();
            let headers = headers.clone();
            async move {
                movement_summary_handler(
                    State(state),
                    headers,
                    summary_query(Some("2026-10-01"), Some("2027-01-01"), Some(group)),
                )
                .await
                .expect("summary is 200")
            }
        };

        let day = grouped("day").await;
        assert_eq!(day.buckets.len(), 93, "Oct 1..Jan 1 is 93 inclusive days");
        let day_bucket = |key: &str| {
            day.buckets
                .iter()
                .find(|b| b.key == key)
                .unwrap_or_else(|| panic!("missing day bucket {key}"))
        };
        assert_eq!(day_bucket("2026-10-01").expense, Decimal::new(1000, 2));
        assert_eq!(day_bucket("2026-10-04").income, Decimal::new(2000, 2));
        assert_eq!(day_bucket("2026-10-05").expense, Decimal::new(3000, 2));
        assert_eq!(day_bucket("2026-12-31").expense, Decimal::new(4000, 2));
        assert_eq!(day_bucket("2027-01-01").income, Decimal::new(5000, 2));

        let week = grouped("week").await;
        let week_bucket = |key: &str| {
            week.buckets
                .iter()
                .find(|b| b.key == key)
                .unwrap_or_else(|| panic!("missing week bucket {key}"))
        };
        assert_eq!(week.buckets[0].from.to_string(), "2026-09-28");
        assert_eq!(
            week.buckets.last().unwrap().to.to_string(),
            "2027-01-03"
        );
        assert_eq!(week_bucket("2026-W40").expense, Decimal::new(1000, 2));
        assert_eq!(week_bucket("2026-W40").income, Decimal::new(2000, 2));
        assert_eq!(week_bucket("2026-W41").expense, Decimal::new(3000, 2));
        // 2026-12-31 (Thu) and 2027-01-01 (Fri) share ISO week 2026-W53.
        assert_eq!(week_bucket("2026-W53").expense, Decimal::new(4000, 2));
        assert_eq!(week_bucket("2026-W53").income, Decimal::new(5000, 2));

        let month = grouped("month").await;
        assert_eq!(
            month
                .buckets
                .iter()
                .map(|b| b.key.as_str())
                .collect::<Vec<_>>(),
            ["2026-10", "2026-11", "2026-12", "2027-01"]
        );
        assert_eq!(month.buckets[0].expense, Decimal::new(4000, 2));
        assert_eq!(month.buckets[0].income, Decimal::new(2000, 2));
        assert_eq!(month.buckets[1].expense, Decimal::ZERO);
        assert_eq!(month.buckets[2].expense, Decimal::new(4000, 2));
        assert_eq!(month.buckets[3].income, Decimal::new(5000, 2));

        let year = grouped("year").await;
        assert_eq!(
            year.buckets.iter().map(|b| b.key.as_str()).collect::<Vec<_>>(),
            ["2026", "2027"]
        );
        assert_eq!(year.buckets[0].expense, Decimal::new(8000, 2));
        assert_eq!(year.buckets[0].income, Decimal::new(2000, 2));
        assert_eq!(year.buckets[1].expense, Decimal::ZERO);
        assert_eq!(year.buckets[1].income, Decimal::new(5000, 2));
        cleanup_user(&pool, user_id).await;
    }
}
