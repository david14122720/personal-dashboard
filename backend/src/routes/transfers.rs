//! Atomic transfers between two owned accounts (`POST /transfers`).
//!
//! A transfer moves funds as ONE database transaction: both legs share a
//! single `transfer_group_id` (with cross-linked `related_transfer_id`) and
//! both balances are updated explicitly inside the same txn. Any error at any
//! step rolls everything back — no orphan legs, no half-moved money.
//!
//! Why app-level (not trigger): the `0002` trigger fired per-row and could
//! not see both legs atomically. Migration `0005` neutralized the `transfer`
//! branch, so the trigger ignores these rows and the handler below owns both
//! balance updates. `income`/`expense` inserts still rely on the trigger.
//!
//! Fixed lock order (deadlock avoidance): both accounts are locked with
//! `SELECT ... FOR UPDATE` in sorted-UUID order, regardless of transfer
//! direction. Ownership is verified INSIDE the txn (after locking) so the
//! 404 path also rolls back an open transaction.
//!
//! Transfers use `type='transfer'` (never income/expense), so budget
//! aggregates (`SUM ... WHERE type='expense'`) and income/expense totals
//! never count moved money.
//!
//! Card payments ride this endpoint: a bank → card transfer moves funds out
//! of the bank account and into the card account (`balance + amount`),
//! reducing the card's negative balance toward zero. No card-specific
//! branch exists — the destination may be any owned account, including a
//! `credit_card`; ownership (404), distinct-legs (422) and money-string
//! (422) validation apply unchanged, and the over-limit guard does not
//! apply to payments (they reduce debt, never add it).
//!
//! Registered in `main.rs` (PR4 wiring).

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::helper::require_user_id,
    error::AppError,
    finance::money::parse_money_amount,
    routes::transactions::{validate_occurred_on, TransactionResponse},
    state::AppState,
};

const MAX_DESCRIPTION_LEN: usize = 2000;

/// Lock one account row for the transfer txn. Executed in sorted-UUID order
/// (see [`sorted_lock_order`]) so concurrent opposite-direction transfers
/// cannot deadlock. `user_id` scoping makes a foreign id a 404, never a leak.
const LOCK_ACCOUNT_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE";

/// Insert one transfer leg. `transfer_group_id` is shared by both legs;
/// `related_transfer_id` cross-links them (leg1 is back-linked after leg2
/// exists, because the FK requires the counterparty row to exist first).
const INSERT_LEG_SQL: &str = "INSERT INTO transactions (id, user_id, account_id, type, amount, occurred_on, description, transfer_group_id, related_transfer_id) VALUES ($1,$2,$3,$4::transaction_type,$5,$6,$7,$8,$9) RETURNING id, account_id, type::text, amount, currency, occurred_on, category_id, description, notes, credit_card_account_id, created_at, updated_at";

/// Back-link the first leg to the second once both rows exist.
const LINK_COUNTERPART_SQL: &str =
    "UPDATE transactions SET related_transfer_id=$1 WHERE id=$2 AND user_id=$3";

/// Explicit balance moves. The 0005-neutralized trigger ignores `transfer`
/// rows, so these two statements are the ONLY balance effect.
const DEBIT_SOURCE_SQL: &str =
    "UPDATE accounts SET balance = balance - $1 WHERE id=$2 AND user_id=$3";
const CREDIT_DEST_SQL: &str =
    "UPDATE accounts SET balance = balance + $1 WHERE id=$2 AND user_id=$3";

/// One leg row, same shape as the transaction row (converted into
/// [`TransactionResponse`] via its `From` impl). Transfer legs never carry
/// a card link, so `credit_card_account_id` reads back NULL.
type TransferLegRow = (
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
pub struct CreateTransferRequest {
    pub from_account_id: Uuid,
    pub to_account_id: Uuid,
    /// Wire-format money string, e.g. `"100.00"` (never a JSON number).
    pub amount: String,
    /// Calendar date `YYYY-MM-DD`.
    pub occurred_on: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TransferResponse {
    pub transfer_group_id: Uuid,
    pub legs: Vec<TransactionResponse>,
}

/// Reject a transfer whose legs share one account (422, nothing moves).
pub fn validate_transfer_accounts(from: Uuid, to: Uuid) -> Result<(), AppError> {
    if from == to {
        return Err(AppError::Validation(
            "transfer requires two distinct accounts".into(),
        ));
    }
    Ok(())
}

/// Lock order for the two accounts: ascending UUID, independent of transfer
/// direction, so two concurrent opposite transfers lock in the same order.
pub fn sorted_lock_order(from: Uuid, to: Uuid) -> (Uuid, Uuid) {
    if from < to {
        (from, to)
    } else {
        (to, from)
    }
}

fn validate_description(description: Option<&str>) -> Result<(), AppError> {
    if let Some(text) = description {
        if text.len() > MAX_DESCRIPTION_LEN || text.contains('\0') {
            return Err(AppError::Validation(format!(
                "description must be at most {MAX_DESCRIPTION_LEN} characters"
            )));
        }
    }
    Ok(())
}

/// Order transfer leg ids so history can recover direction without extra
/// columns: the source leg always carries the smaller UUID, the destination
/// the larger one. Both ids are random v4; sorting them before insert makes
/// `MIN(id)` = source and `MAX(id)` = destination for every group created
/// after S1. Legacy groups (pre-S1, random ids) may resolve swapped — the
/// history query documents that fallback.
///
/// Pure helper so the convention is unit-testable without a DB.
pub fn order_transfer_leg_ids(a: Uuid, b: Uuid) -> (Uuid, Uuid) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

async fn execute_transfer(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    from: Uuid,
    to: Uuid,
    amount: Decimal,
    occurred_on: NaiveDate,
    description: Option<&str>,
) -> Result<(Uuid, TransferLegRow, TransferLegRow), AppError> {
    let mut tx = pool.begin().await.map_err(|_| AppError::Internal)?;
    // Every fallible step below returns `AppError`; the match afterwards
    // commits on success and rolls back on ANY error (validation 404 included
    // — ownership is checked inside the txn, after locking).
    let outcome: Result<(Uuid, TransferLegRow, TransferLegRow), AppError> = async {
        // Fixed lock order: sorted UUIDs, so concurrent opposite-direction
        // transfers cannot deadlock.
        let (first, second) = sorted_lock_order(from, to);
        for id in [first, second] {
            let owned: Option<Uuid> = sqlx::query_scalar(LOCK_ACCOUNT_SQL)
                .bind(id)
                .bind(user_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(|_| AppError::Internal)?;
            if owned.is_none() {
                // Foreign or missing account: 404 without leaking which.
                return Err(AppError::NotFound);
            }
        }
        let group_id = Uuid::new_v4();
        // S1 direction convention: source id < dest id (see
        // [`order_transfer_leg_ids`]). `GET /transfers` recovers
        // from/to via `MIN(id)`/`MAX(id)` without a schema change.
        let (out_id, in_id) = order_transfer_leg_ids(Uuid::new_v4(), Uuid::new_v4());
        // Leg 1 (money out of `from`) with `related_transfer_id` NULL for now:
        // the FK requires the counterparty row to exist, so the cross-link is
        // completed after leg 2 is inserted. (The counterparty trigger only
        // fires when `related_transfer_id IS NULL` and finds no same-group
        // sibling yet, so it is a harmless no-op here.)
        let out_leg = sqlx::query_as::<_, TransferLegRow>(INSERT_LEG_SQL)
            .bind(out_id)
            .bind(user_id)
            .bind(from)
            .bind("transfer")
            .bind(amount)
            .bind(occurred_on)
            .bind(description)
            .bind(group_id)
            .bind(None::<Uuid>)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
        // Leg 2 (money into `to`), linked to leg 1.
        let in_leg = sqlx::query_as::<_, TransferLegRow>(INSERT_LEG_SQL)
            .bind(in_id)
            .bind(user_id)
            .bind(to)
            .bind("transfer")
            .bind(amount)
            .bind(occurred_on)
            .bind(description)
            .bind(group_id)
            .bind(Some(out_id))
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
        // Back-link leg 1 -> leg 2: the group is now cross-linked both ways.
        sqlx::query(LINK_COUNTERPART_SQL)
            .bind(in_id)
            .bind(out_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
        // Explicit balance moves (the ONLY balance effect: the 0005 trigger
        // ignores `transfer` rows). `rows_affected` is defensive: the rows
        // were just locked above, so 0 means something is deeply wrong.
        let debit = sqlx::query(DEBIT_SOURCE_SQL)
            .bind(amount)
            .bind(from)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
        let credit = sqlx::query(CREDIT_DEST_SQL)
            .bind(amount)
            .bind(to)
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
        if debit.rows_affected() != 1 || credit.rows_affected() != 1 {
            return Err(AppError::Internal);
        }
        Ok((group_id, out_leg, in_leg))
    }
    .await;
    match outcome {
        Ok((group_id, out_leg, in_leg)) => {
            tx.commit().await.map_err(|_| AppError::Internal)?;
            Ok((group_id, out_leg, in_leg))
        }
        Err(err) => {
            let _ = tx.rollback().await;
            Err(err)
        }
    }
}

pub async fn create_transfer_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTransferRequest>,
) -> Result<(StatusCode, Json<TransferResponse>), AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    validate_transfer_accounts(body.from_account_id, body.to_account_id)?;
    let amount = parse_money_amount(&body.amount)?;
    let occurred_on = validate_occurred_on(&body.occurred_on)?;
    validate_description(body.description.as_deref())?;
    let (group_id, out_leg, in_leg) = execute_transfer(
        &state.pool,
        user_id,
        body.from_account_id,
        body.to_account_id,
        amount,
        occurred_on,
        body.description.as_deref(),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(TransferResponse {
            transfer_group_id: group_id,
            legs: vec![
                TransactionResponse::from(out_leg),
                TransactionResponse::from(in_leg),
            ],
        }),
    ))
}

// -- S1 (captura manual): historial paginado de transferencias --

/// Default page size for `GET /transfers`.
pub const DEFAULT_TRANSFER_LIMIT: i64 = 50;
/// Maximum page size for `GET /transfers`.
pub const MAX_TRANSFER_LIMIT: i64 = 200;

/// Keyset cursor over `(occurred_on, transfer_group_id)`: base64url of
/// `YYYY-MM-DD|uuid`. Mirrors `transactions::encode_tx_cursor` so pages stay
/// stable under concurrent inserts and ride the transfer-group ordering with
/// `ORDER BY occurred_on DESC, transfer_group_id DESC`.
pub fn encode_transfer_cursor(occurred_on: NaiveDate, group_id: Uuid) -> String {
    URL_SAFE_NO_PAD.encode(format!(
        "{}|{}",
        occurred_on.format("%Y-%m-%d"),
        group_id.hyphenated()
    ))
}

/// Decode a cursor produced by [`encode_transfer_cursor`]; garbage is 422, never 500.
pub fn decode_transfer_cursor(raw: &str) -> Result<(NaiveDate, Uuid), AppError> {
    let invalid = || AppError::Validation("invalid cursor".into());
    let decoded = URL_SAFE_NO_PAD.decode(raw.trim()).map_err(|_| invalid())?;
    let text = String::from_utf8(decoded).map_err(|_| invalid())?;
    let (date_part, id_part) = text.split_once('|').ok_or_else(invalid)?;
    let date = validate_occurred_on(date_part).map_err(|_| invalid())?;
    let id = Uuid::parse_str(id_part.trim()).map_err(|_| invalid())?;
    Ok((date, id))
}

/// Validate `limit`: default 50, range `[1, 200]`, else 422.
pub fn validate_transfer_limit(raw: Option<i64>) -> Result<i64, AppError> {
    let limit = raw.unwrap_or(DEFAULT_TRANSFER_LIMIT);
    if !(1..=MAX_TRANSFER_LIMIT).contains(&limit) {
        return Err(AppError::Validation(format!(
            "limit must be between 1 and {MAX_TRANSFER_LIMIT}"
        )));
    }
    Ok(limit)
}

#[derive(Debug, Deserialize)]
pub struct ListTransfersQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/// One transfer for history: the two legs collapsed into from/to. Amount,
/// currency, date and description are identical on both legs (enforced at
/// insert), so `MIN` is exact. Direction follows the S1 convention
/// (`MIN(id)` = source, `MAX(id)` = destination); pre-S1 groups with random
/// ids may resolve swapped, which the frontend surfaces as a plain
/// origin/destination pair without asserting direction for legacy rows.
const LIST_TRANSFERS_SQL: &str = "WITH groups AS (SELECT transfer_group_id, MIN(occurred_on) AS occurred_on, MIN(amount) AS amount, MIN(currency) AS currency, MIN(description) AS description, MAX(created_at) AS created_at, MIN(id) AS first_id, MAX(id) AS second_id FROM transactions WHERE user_id=$1 AND type='transfer' AND ($2::date IS NULL OR occurred_on >= $2) AND ($3::date IS NULL OR occurred_on <= $3) GROUP BY transfer_group_id HAVING COUNT(*) = 2) SELECT g.transfer_group_id, src.account_id, dst.account_id, g.amount, g.currency, g.occurred_on, g.description, g.created_at, (SELECT COUNT(*) FROM groups) AS total_count FROM groups g JOIN transactions src ON src.id = g.first_id AND src.user_id=$1 JOIN transactions dst ON dst.id = g.second_id AND dst.user_id=$1 WHERE ($4::date IS NULL OR (g.occurred_on, g.transfer_group_id) < ($4, $5::uuid)) ORDER BY g.occurred_on DESC, g.transfer_group_id DESC LIMIT $6";

type TransferListRow = (
    Uuid,
    Uuid,
    Uuid,
    Decimal,
    String,
    NaiveDate,
    Option<String>,
    DateTime<Utc>,
    i64,
);

#[derive(Debug, Serialize)]
pub struct TransferHistoryItem {
    pub transfer_group_id: Uuid,
    pub from_account_id: Uuid,
    pub to_account_id: Uuid,
    /// Serialized as a string (e.g. `"100.00"`); decimals render as strings.
    pub amount: Decimal,
    pub currency: String,
    pub occurred_on: NaiveDate,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct TransferListResponse {
    pub items: Vec<TransferHistoryItem>,
    pub next_cursor: Option<String>,
    pub total_count: i64,
}

pub async fn list_transfers_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<ListTransfersQuery>,
) -> Result<Json<TransferListResponse>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let limit = validate_transfer_limit(params.limit)?;
    let from = params
        .from
        .as_deref()
        .map(validate_occurred_on)
        .transpose()?;
    let to = params.to.as_deref().map(validate_occurred_on).transpose()?;
    let (cursor_date, cursor_group) = params
        .cursor
        .as_deref()
        .map(decode_transfer_cursor)
        .transpose()?
        .map(|(d, i)| (Some(d), Some(i)))
        .unwrap_or((None, None));
    let rows = sqlx::query_as::<_, TransferListRow>(LIST_TRANSFERS_SQL)
        .bind(user_id)
        .bind(from)
        .bind(to)
        .bind(cursor_date)
        .bind(cursor_group)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
        .map_err(|_| AppError::Internal)?;
    let total_count = rows.first().map(|row| row.8).unwrap_or(0);
    let items: Vec<TransferHistoryItem> = rows
        .into_iter()
        .map(
            |(
                transfer_group_id,
                from_account_id,
                to_account_id,
                amount,
                currency,
                occurred_on,
                description,
                created_at,
                _,
            )| TransferHistoryItem {
                transfer_group_id,
                from_account_id,
                to_account_id,
                amount,
                currency,
                occurred_on,
                description,
                created_at,
            },
        )
        .collect();
    let next_cursor = if items.len() as i64 == limit {
        items
            .last()
            .map(|item| encode_transfer_cursor(item.occurred_on, item.transfer_group_id))
    } else {
        None
    };
    Ok(Json(TransferListResponse {
        items,
        next_cursor,
        total_count,
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

    #[test]
    fn same_account_transfer_is_422() {
        let id = Uuid::new_v4();
        assert_422(validate_transfer_accounts(id, id).unwrap_err());
    }

    #[test]
    fn distinct_accounts_pass_validation() {
        validate_transfer_accounts(Uuid::new_v4(), Uuid::new_v4()).unwrap();
    }

    #[test]
    fn lock_order_is_sorted_uuid_regardless_of_direction() {
        let a = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let b = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        assert_eq!(sorted_lock_order(a, b), (a, b));
        assert_eq!(sorted_lock_order(b, a), (a, b));
    }

    #[test]
    fn amount_must_arrive_as_string_not_json_number() {
        // Money travels as string to avoid float drift; a JSON number must
        // fail deserialization (axum surfaces it as 422).
        let payload = json!({
            "from_account_id": Uuid::new_v4(),
            "to_account_id": Uuid::new_v4(),
            "amount": 100.00,
            "occurred_on": "2026-09-01"
        });
        assert!(
            serde_json::from_value::<CreateTransferRequest>(payload).is_err(),
            "numeric amount must fail deserialization"
        );
        let ok: CreateTransferRequest = serde_json::from_value(json!({
            "from_account_id": Uuid::new_v4(),
            "to_account_id": Uuid::new_v4(),
            "amount": "100.00",
            "occurred_on": "2026-09-01"
        }))
        .unwrap();
        assert_eq!(ok.amount, "100.00");
    }

    #[test]
    fn transfer_sql_locks_scopes_and_moves_both_balances() {
        assert!(
            LOCK_ACCOUNT_SQL.contains("FOR UPDATE"),
            "transfer must lock accounts, got: {LOCK_ACCOUNT_SQL}"
        );
        for sql in [
            LOCK_ACCOUNT_SQL,
            INSERT_LEG_SQL,
            LINK_COUNTERPART_SQL,
            DEBIT_SOURCE_SQL,
            CREDIT_DEST_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "transfer SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            INSERT_LEG_SQL.contains("transfer_group_id")
                && INSERT_LEG_SQL.contains("related_transfer_id"),
            "legs must share group id and cross-link, got: {INSERT_LEG_SQL}"
        );
        assert!(
            DEBIT_SOURCE_SQL.contains("balance -") && CREDIT_DEST_SQL.contains("balance +"),
            "balances must move exactly ∓amount"
        );
    }

    #[test]
    fn transfer_response_groups_both_legs() {
        let group = Uuid::new_v4();
        let leg = |account: Uuid| TransactionResponse {
            id: Uuid::new_v4(),
            account_id: account,
            transaction_type: "transfer".into(),
            amount: Decimal::new(10000, 2),
            currency: "COP".into(),
            occurred_on: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            category_id: None,
            description: None,
            notes: None,
            credit_card_account_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let resp = TransferResponse {
            transfer_group_id: group,
            legs: vec![leg(Uuid::new_v4()), leg(Uuid::new_v4())],
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["legs"].as_array().unwrap().len(), 2);
        assert_eq!(v["legs"][0]["type"], "transfer");
        assert_eq!(
            v["legs"][0]["amount"],
            serde_json::Value::String("100.00".into())
        );
    }

    #[test]
    fn transfer_leg_ids_order_source_first() {
        let a = Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap();
        let b = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        assert_eq!(order_transfer_leg_ids(a, b), (a, b));
        assert_eq!(order_transfer_leg_ids(b, a), (a, b));
        let (s, d) = order_transfer_leg_ids(Uuid::new_v4(), Uuid::new_v4());
        assert!(s < d, "source id must sort before dest id");
    }

    #[test]
    fn transfer_cursor_codec_roundtrips_group() {
        let group = Uuid::new_v4();
        let date = NaiveDate::from_ymd_opt(2026, 9, 15).unwrap();
        let cursor = encode_transfer_cursor(date, group);
        assert_eq!(decode_transfer_cursor(&cursor).unwrap(), (date, group));
    }

    #[test]
    fn invalid_transfer_cursor_is_422() {
        for raw in ["", "   ", "not-base64!!!", "bm8tcGlwZQ=="] {
            let err = decode_transfer_cursor(raw).unwrap_err();
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
    }

    #[test]
    fn transfer_limit_defaults_to_50_and_caps_at_200() {
        assert_eq!(validate_transfer_limit(None).unwrap(), 50);
        assert_eq!(validate_transfer_limit(Some(200)).unwrap(), 200);
        for raw in [Some(0), Some(-5), Some(201), Some(1000)] {
            let err = validate_transfer_limit(raw).unwrap_err();
            assert_eq!(
                err.into_response().status(),
                axum::http::StatusCode::UNPROCESSABLE_ENTITY
            );
        }
    }

    #[test]
    fn transfer_list_sql_is_single_keyset_statement_with_total() {
        assert_eq!(LIST_TRANSFERS_SQL.matches(';').count(), 0);
        for fragment in [
            "(SELECT COUNT(*) FROM groups)",
            "ORDER BY g.occurred_on DESC, g.transfer_group_id DESC",
            "LIMIT $",
            "user_id=$1",
            "HAVING COUNT(*) = 2",
            "MIN(id) AS first_id",
        ] {
            assert!(
                LIST_TRANSFERS_SQL.contains(fragment),
                "transfer list SQL must contain {fragment}"
            );
        }
    }

    #[test]
    fn transfer_history_item_serializes_money_as_string() {
        let item = TransferHistoryItem {
            transfer_group_id: Uuid::new_v4(),
            from_account_id: Uuid::new_v4(),
            to_account_id: Uuid::new_v4(),
            amount: Decimal::new(10000, 2),
            currency: "COP".into(),
            occurred_on: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
            description: None,
            created_at: Utc::now(),
        };
        let v = serde_json::to_value(&item).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("100.00".into()));
        assert_eq!(v["currency"], serde_json::Value::String("COP".into()));
    }

    fn test_pool() -> Option<sqlx::PgPool> {
        std::env::var("DATABASE_URL")
            .ok()
            .map(|url| sqlx::PgPool::connect_lazy(&url).expect("lazy pool from DATABASE_URL"))
    }

    async fn db_state(pool: &sqlx::PgPool) -> (AppState, HeaderMap, Uuid) {
        use crate::auth::rate_limit::LoginRateLimiter;
        use std::sync::Arc;
        let email = format!("xf-{}@example.com", Uuid::new_v4());
        let user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(&email)
        .bind("not-a-real-hash")
        .bind("transfer test")
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

    async fn seed_account(pool: &sqlx::PgPool, user_id: Uuid, name: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type) VALUES ($1,$2,'bank') RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .expect("seed account")
    }

    async fn account_balance(pool: &sqlx::PgPool, id: Uuid) -> Decimal {
        sqlx::query_scalar("SELECT balance FROM accounts WHERE id=$1")
            .bind(id)
            .fetch_one(pool)
            .await
            .expect("read balance")
    }

    async fn transfer_leg_count(pool: &sqlx::PgPool, user_id: Uuid) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM transactions WHERE user_id=$1 AND type='transfer'")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("count legs")
    }

    async fn cleanup_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("DELETE FROM users WHERE id=$1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    fn transfer_body(from: Uuid, to: Uuid) -> Json<CreateTransferRequest> {
        Json(CreateTransferRequest {
            from_account_id: from,
            to_account_id: to,
            amount: "100.00".into(),
            occurred_on: "2026-09-01".into(),
            description: None,
        })
    }

    #[tokio::test]
    async fn successful_transfer_moves_balances_exactly() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP successful_transfer_moves_balances_exactly: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let from = seed_account(&pool, user_id, "Source").await;
        let to = seed_account(&pool, user_id, "Dest").await;
        sqlx::query("UPDATE accounts SET balance=1000.00 WHERE id=$1")
            .bind(from)
            .execute(&pool)
            .await
            .expect("seed balance");
        let (status, resp) =
            create_transfer_handler(State(state.clone()), headers, transfer_body(from, to))
                .await
                .expect("transfer is 201");
        assert_eq!(status, StatusCode::CREATED);
        // Both legs share one group id, are cross-linked, and are `transfer`
        // (never income/expense, so totals ignore them).
        assert_eq!(resp.legs.len(), 2);
        assert_eq!(resp.legs[0].transaction_type, "transfer");
        assert_eq!(resp.legs[1].transaction_type, "transfer");
        let g0: Uuid = sqlx::query_scalar("SELECT transfer_group_id FROM transactions WHERE id=$1")
            .bind(resp.legs[0].id)
            .fetch_one(&pool)
            .await
            .expect("leg group");
        let g1: Uuid = sqlx::query_scalar("SELECT transfer_group_id FROM transactions WHERE id=$1")
            .bind(resp.legs[1].id)
            .fetch_one(&pool)
            .await
            .expect("leg group");
        assert_eq!(g0, g1);
        assert_eq!(g0, resp.transfer_group_id);
        let r0: Option<Uuid> =
            sqlx::query_scalar("SELECT related_transfer_id FROM transactions WHERE id=$1")
                .bind(resp.legs[0].id)
                .fetch_one(&pool)
                .await
                .expect("leg link");
        let r1: Option<Uuid> =
            sqlx::query_scalar("SELECT related_transfer_id FROM transactions WHERE id=$1")
                .bind(resp.legs[1].id)
                .fetch_one(&pool)
                .await
                .expect("leg link");
        assert_eq!(r0, Some(resp.legs[1].id));
        assert_eq!(r1, Some(resp.legs[0].id));
        // Balances moved exactly ∓amount, once (trigger adds nothing).
        assert_eq!(account_balance(&pool, from).await, Decimal::new(90000, 2));
        assert_eq!(account_balance(&pool, to).await, Decimal::new(10000, 2));
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn same_account_transfer_is_422_and_moves_nothing() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP same_account_transfer_is_422_and_moves_nothing: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let only = seed_account(&pool, user_id, "Only").await;
        sqlx::query("UPDATE accounts SET balance=500.00 WHERE id=$1")
            .bind(only)
            .execute(&pool)
            .await
            .expect("seed balance");
        let body = Json(CreateTransferRequest {
            from_account_id: only,
            to_account_id: only,
            amount: "10.00".into(),
            occurred_on: "2026-09-01".into(),
            description: None,
        });
        let err = create_transfer_handler(State(state.clone()), headers, body)
            .await
            .expect_err("same-account transfer must be 422");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(account_balance(&pool, only).await, Decimal::new(50000, 2));
        assert_eq!(transfer_leg_count(&pool, user_id).await, 0);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn bank_to_card_payment_reduces_debt() {
        // finance-transfers spec: paying the card bill is a plain transfer
        // (bank → card); the card leg rises toward zero, the bank leg falls.
        let Some(pool) = test_pool() else {
            eprintln!("SKIP bank_to_card_payment_reduces_debt: no DATABASE_URL");
            return;
        };
        let (state, headers, user_id) = db_state(&pool).await;
        let bank = seed_account(&pool, user_id, "Checking").await;
        let card: Uuid = sqlx::query_scalar(
            "INSERT INTO accounts (user_id, name, type, credit_limit, statement_day, payment_due_day) VALUES ($1,'Visa','credit_card',5000,15,25) RETURNING id",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .expect("seed card");
        sqlx::query("UPDATE accounts SET balance=1000.00 WHERE id=$1")
            .bind(bank)
            .execute(&pool)
            .await
            .expect("seed bank balance");
        sqlx::query("UPDATE accounts SET balance=-500.00 WHERE id=$1")
            .bind(card)
            .execute(&pool)
            .await
            .expect("seed card debt");
        let body = Json(CreateTransferRequest {
            from_account_id: bank,
            to_account_id: card,
            amount: "500.00".into(),
            occurred_on: "2026-09-01".into(),
            description: Some("card payment".into()),
        });
        let (status, _) = create_transfer_handler(State(state.clone()), headers, body)
            .await
            .expect("card payment is 201");
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(account_balance(&pool, bank).await, Decimal::new(50000, 2));
        assert_eq!(account_balance(&pool, card).await, Decimal::ZERO);
        cleanup_user(&pool, user_id).await;
    }

    #[tokio::test]
    async fn foreign_leg_is_404_and_rolls_back() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP foreign_leg_is_404_and_rolls_back: no DATABASE_URL");
            return;
        };
        let (state_a, _, user_a) = db_state(&pool).await;
        let (state_b, headers_b, user_b) = db_state(&pool).await;
        let mine = seed_account(&pool, user_b, "Mine").await;
        let foreign = seed_account(&pool, user_a, "Foreign").await;
        sqlx::query("UPDATE accounts SET balance=500.00 WHERE id=$1")
            .bind(mine)
            .execute(&pool)
            .await
            .expect("seed balance");
        let err = create_transfer_handler(
            State(state_b.clone()),
            headers_b,
            transfer_body(mine, foreign),
        )
        .await
        .expect_err("foreign leg must be 404");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::NOT_FOUND
        );
        // Rollback proof: source balance untouched, no orphan legs persisted.
        assert_eq!(account_balance(&pool, mine).await, Decimal::new(50000, 2));
        assert_eq!(transfer_leg_count(&pool, user_b).await, 0);
        let _ = state_a;
        cleanup_user(&pool, user_a).await;
        cleanup_user(&pool, user_b).await;
    }

    #[tokio::test]
    async fn rollback_on_second_leg_failure_leaves_no_orphans() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP rollback_on_second_leg_failure_leaves_no_orphans: no DATABASE_URL");
            return;
        };
        // Fault injection: a temporary trigger that fails the SECOND transfer
        // insert carrying the probe description, leaving all other traffic
        // (including parallel tests) untouched. Each DDL statement runs as
        // its own single-statement query: sqlx uses the prepared-statement
        // protocol, which rejects multi-command strings with 42601.
        sqlx::query(
            "CREATE OR REPLACE FUNCTION tmp_fail_second_transfer_leg() RETURNS trigger AS $$
             BEGIN
               IF NEW.description = 'fault-probe'
                  AND EXISTS (SELECT 1 FROM transactions WHERE transfer_group_id = NEW.transfer_group_id) THEN
                 RAISE EXCEPTION 'injected second-leg failure';
               END IF;
               RETURN NEW;
             END $$ LANGUAGE plpgsql",
        )
        .execute(&pool)
        .await
        .expect("install fault trigger fn");
        sqlx::query("DROP TRIGGER IF EXISTS tmp_fail_second_leg ON transactions")
            .execute(&pool)
            .await
            .expect("drop stale fault trigger");
        sqlx::query(
            "CREATE TRIGGER tmp_fail_second_leg BEFORE INSERT ON transactions
             FOR EACH ROW WHEN (NEW.type = 'transfer') EXECUTE FUNCTION tmp_fail_second_transfer_leg()",
        )
        .execute(&pool)
        .await
        .expect("install fault trigger");
        let (state, headers, user_id) = db_state(&pool).await;
        let from = seed_account(&pool, user_id, "FaultSrc").await;
        let to = seed_account(&pool, user_id, "FaultDst").await;
        sqlx::query("UPDATE accounts SET balance=500.00 WHERE id=$1")
            .bind(from)
            .execute(&pool)
            .await
            .expect("seed balance");
        let body = Json(CreateTransferRequest {
            from_account_id: from,
            to_account_id: to,
            amount: "25.00".into(),
            occurred_on: "2026-09-01".into(),
            description: Some("fault-probe".into()),
        });
        let err = create_transfer_handler(State(state.clone()), headers, body)
            .await
            .expect_err("injected second-leg failure must surface");
        assert_eq!(
            err.into_response().status(),
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        );
        // Full rollback: first leg gone, balances unchanged.
        assert_eq!(transfer_leg_count(&pool, user_id).await, 0);
        assert_eq!(account_balance(&pool, from).await, Decimal::new(50000, 2));
        assert_eq!(account_balance(&pool, to).await, Decimal::new(0, 2));
        sqlx::query("DROP TRIGGER IF EXISTS tmp_fail_second_leg ON transactions")
            .execute(&pool)
            .await
            .expect("remove fault trigger");
        sqlx::query("DROP FUNCTION IF EXISTS tmp_fail_second_transfer_leg()")
            .execute(&pool)
            .await
            .expect("remove fault trigger fn");
        cleanup_user(&pool, user_id).await;
    }

        fn list_query(cursor: Option<String>, limit: Option<i64>) -> Query<ListTransfersQuery> {
            Query(ListTransfersQuery {
                from: None,
                to: None,
                cursor,
                limit,
            })
        }

        #[tokio::test]
        async fn list_transfers_returns_group_with_direction_and_total() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP list_transfers_returns_group_with_direction_and_total: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            let from = seed_account(&pool, user_id, "ListSrc").await;
            let to = seed_account(&pool, user_id, "ListDst").await;
            sqlx::query("UPDATE accounts SET balance=1000.00 WHERE id=$1")
                .bind(from)
                .execute(&pool)
                .await
                .expect("seed balance");
            let (_, created) = create_transfer_handler(
                State(state.clone()),
                headers.clone(),
                transfer_body(from, to),
            )
            .await
            .expect("transfer is 201");
            let body = list_transfers_handler(State(state.clone()), headers.clone(), list_query(None, None))
                .await
                .expect("list is 200")
                .0;
            assert_eq!(body.total_count, 1);
            assert_eq!(body.items.len(), 1);
            let item = &body.items[0];
            assert_eq!(item.transfer_group_id, created.transfer_group_id);
            assert_eq!(item.from_account_id, from);
            assert_eq!(item.to_account_id, to);
            assert!(body.next_cursor.is_none());
            let v = serde_json::to_value(&body).unwrap();
            assert_eq!(v["items"][0]["amount"], serde_json::Value::String("100.00".into()));
            assert_eq!(v["items"][0]["currency"], serde_json::Value::String("COP".into()));
            cleanup_user(&pool, user_id).await;
        }

        #[tokio::test]
        async fn list_transfers_paginates_via_keyset_without_overlap() {
            let Some(pool) = test_pool() else {
                eprintln!("SKIP list_transfers_paginates_via_keyset_without_overlap: no DATABASE_URL");
                return;
            };
            let (state, headers, user_id) = db_state(&pool).await;
            let from = seed_account(&pool, user_id, "PageSrc").await;
            let to = seed_account(&pool, user_id, "PageDst").await;
            sqlx::query("UPDATE accounts SET balance=5000.00 WHERE id=$1")
                .bind(from)
                .execute(&pool)
                .await
                .expect("seed balance");
            for day in ["2026-09-01", "2026-09-02", "2026-09-03"] {
                let body = Json(CreateTransferRequest {
                    from_account_id: from,
                    to_account_id: to,
                    amount: "10.00".into(),
                    occurred_on: day.into(),
                    description: None,
                });
                create_transfer_handler(State(state.clone()), headers.clone(), body)
                    .await
                    .expect("seed transfer");
            }
            let page1 = list_transfers_handler(
                State(state.clone()),
                headers.clone(),
                list_query(None, Some(2)),
            )
            .await
            .expect("page 1 is 200")
            .0;
            assert_eq!(page1.items.len(), 2);
            assert_eq!(page1.total_count, 3);
            let cursor = page1.next_cursor.expect("full page must carry next_cursor");
            let page2 = list_transfers_handler(
                State(state.clone()),
                headers.clone(),
                list_query(Some(cursor), Some(2)),
            )
            .await
            .expect("page 2 is 200")
            .0;
            assert_eq!(page2.items.len(), 1);
            assert_eq!(page2.total_count, 3);
            assert!(page2.next_cursor.is_none());
            let seen1: Vec<Uuid> = page1.items.iter().map(|t| t.transfer_group_id).collect();
            assert!(!seen1.contains(&page2.items[0].transfer_group_id));
            cleanup_user(&pool, user_id).await;
        }
}
