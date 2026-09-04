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
//! Registered in `main.rs` (PR4 wiring).

use axum::{
    extract::State,
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
const INSERT_LEG_SQL: &str = "INSERT INTO transactions (id, user_id, account_id, type, amount, occurred_on, description, transfer_group_id, related_transfer_id) VALUES ($1,$2,$3,$4::transaction_type,$5,$6,$7,$8,$9) RETURNING id, account_id, type::text, amount, currency, occurred_on, category_id, description, notes, created_at, updated_at";

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
/// [`TransactionResponse`] via its `From` impl).
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
        let out_id = Uuid::new_v4();
        let in_id = Uuid::new_v4();
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
        // (including parallel tests) untouched.
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
        sqlx::query(
            "DROP TRIGGER IF EXISTS tmp_fail_second_leg ON transactions;
             CREATE TRIGGER tmp_fail_second_leg BEFORE INSERT ON transactions
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
        sqlx::query(
            "DROP TRIGGER IF EXISTS tmp_fail_second_leg ON transactions;
             DROP FUNCTION IF EXISTS tmp_fail_second_transfer_leg()",
        )
        .execute(&pool)
        .await
        .expect("remove fault trigger");
        cleanup_user(&pool, user_id).await;
    }
}
