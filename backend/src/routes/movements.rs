//! Movements ledger CRUD + atomic balance effect, strictly scoped by `user_id`.
//!
//! A movement links one account, one category, a direction
//! (`expense` | `income`), an amount and a date. Writing, editing or
//! deleting a movement adjusts the owning account balance inside the SAME
//! database transaction as the row write (finance-simplify-movements D4):
//! one HTTP request, one transaction, never a trigger and never a
//! client-orchestrated double write.
//!
//! Lock discipline (design §Architecture Decisions): the account row is
//! locked FIRST (`SELECT ... FOR UPDATE`) so concurrent same-account
//! writers serialize instead of deadlocking on a lock upgrade. A PATCH
//! touching two accounts locks both in ascending UUID order. Inside the
//! PATCH transaction, AFTER the account locks and BEFORE any balance
//! write, the movement row is re-read `FOR UPDATE`: the reversal and the
//! apply terms come from that locked row, never from the pre-transaction
//! snapshot, so a serialized second writer can never undo a delta that
//! the first one already replaced. Any failure drops the transaction: no
//! row, no partial balance change, no `updated_at` mutation survives.
//!
//! Status matrix (design §Architecture Decisions): 401 without a token;
//! 404 for a foreign or missing movement id (never 403); 422 for a
//! referenced foreign/missing `account_id` / `category_id`, unknown or
//! missing fields, malformed amount/date/direction; 409 surfaces only via
//! `DELETE /api/accounts/{id}`. Category kind never gates a write (D3).
//!
//! Registered in `routes/mod.rs` (wiring in `main.rs`, S-A slice).

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
    finance::{
        money::parse_money_amount,
        validation::{ensure_owned_account, ensure_owned_category, validate_occurred_on},
    },
    state::AppState,
};

/// Absolute cap for a single movement: `|amount| < 10^6` so a
/// `NUMERIC(18,2)` overflow can never surface as a 500.
const MAX_MOVEMENT_AMOUNT: i64 = 1_000_000;
/// Descriptions are free text passthrough capped at 2000 bytes (same bound
/// as every other finance free-text field).
const MAX_DESCRIPTION_LEN: usize = 2000;

const LOCK_ACCOUNT_SQL: &str = "SELECT id FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE";
const INSERT_MOVEMENT_SQL: &str = "INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on, description, subscription_id) VALUES ($1,$2,$3,$4::movement_direction,$5,$6,$7,$8) RETURNING id, account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at";
const APPLY_BALANCE_SQL: &str = "UPDATE accounts SET balance = balance + $2, updated_at = now() WHERE id=$1 AND user_id=$3";
const UPDATE_MOVEMENT_SQL: &str = "UPDATE movements SET account_id=$3, category_id=$4, direction=$5::movement_direction, amount=$6, occurred_on=$7, description=$8, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id, account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at";
const DELETE_MOVEMENT_SQL: &str =
    "DELETE FROM movements WHERE id=$1 AND user_id=$2 RETURNING account_id, direction::text, amount";
const LIST_MOVEMENTS_SQL: &str = "SELECT id, account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE user_id=$1 ORDER BY occurred_on DESC, created_at DESC, id DESC";
const GET_MOVEMENT_SQL: &str = "SELECT id, account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE id=$1 AND user_id=$2";
/// Authoritative PATCH re-read: inside the transaction, under the account
/// lock, the stored money terms (account, direction, amount) are taken from
/// THIS row and never from the pre-transaction snapshot.
const LOCK_MOVEMENT_SQL: &str = "SELECT id, account_id, category_id, direction::text, amount, occurred_on, description, subscription_id, created_at, updated_at FROM movements WHERE id=$1 AND user_id=$2 FOR UPDATE";
/// A PATCH whose movement changed account between the snapshot and the
/// account lock restarts from a refreshed snapshot (the lock set is the only
/// thing recalculated); bounded so a pathological race ends in a clean,
/// fully rolled-back 500 instead of an unbounded loop.
const PATCH_LOCK_RETRY_ATTEMPTS: usize = 5;

/// Movement row: 10 columns (sqlx 0.8 `FromRow` tuple cap is 16).
type MovementRow = (
    Uuid,
    Uuid,
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
            category_id,
            subscription_id,
            created_at,
            updated_at,
        }
    }
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
/// `10^6`, else Spanish 422. Parsing itself delegates to the shared
/// [`parse_money_amount`]; only the surface message is movement-scoped.
pub fn validate_movement_amount(raw: &str) -> Result<Decimal, AppError> {
    let amount = parse_money_amount(raw).map_err(|_| {
        AppError::Validation(
            "el monto debe ser un numero positivo con maximo 2 decimales".into(),
        )
    })?;
    if amount >= Decimal::from(MAX_MOVEMENT_AMOUNT) {
        return Err(AppError::Validation(
            "el monto debe ser menor a 1000000".into(),
        ));
    }
    Ok(amount)
}

/// Validate a free-text description (passthrough, max 2000 bytes), else
/// Spanish 422.
pub fn validate_description(raw: &str) -> Result<String, AppError> {
    if raw.len() > MAX_DESCRIPTION_LEN {
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

/// Signed balance delta: `expense` subtracts, `income` adds. The stored
/// amount is always positive; the direction carries the sign.
fn signed_delta(direction: &str, amount: Decimal) -> Decimal {
    if direction == "expense" {
        -amount
    } else {
        amount
    }
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
        .bind(signed_delta(&direction, amount))
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
) -> Result<Json<Vec<MovementResponse>>, AppError> {
    let user_id = require_user_id(&headers, &state.pool).await?;
    let rows = sqlx::query_as::<_, MovementRow>(LIST_MOVEMENTS_SQL)
        .bind(user_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            tracing::error!("list_movements failed: {e:?}");
            AppError::Internal
        })?;
    Ok(Json(rows.into_iter().map(MovementResponse::from).collect()))
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
    for _ in 0..PATCH_LOCK_RETRY_ATTEMPTS {
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
            .bind(-signed_delta(&locked_response.direction, locked_response.amount))
            .bind(user_id)
            .execute(&mut *tx)
            .await
            .map_err(map_movement_db_err)?;
        sqlx::query(APPLY_BALANCE_SQL)
            .bind(account_id)
            .bind(signed_delta(&direction, amount))
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
    let mut tx = state.pool.begin().await.map_err(|_| AppError::Internal)?;
    let deleted: Option<(Uuid, String, Decimal)> =
        sqlx::query_as(DELETE_MOVEMENT_SQL)
            .bind(id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| AppError::Internal)?;
    let Some((account_id, direction, amount)) = deleted else {
        // Nothing deleted: the transaction drops uncommitted (no-op
        // rollback) and the foreign/missing id reads as 404.
        return Err(AppError::NotFound);
    };
    sqlx::query(APPLY_BALANCE_SQL)
        .bind(account_id)
        .bind(-signed_delta(&direction, amount))
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(map_movement_db_err)?;
    tx.commit().await.map_err(|_| AppError::Internal)?;
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
    }

    #[test]
    fn movement_amount_rejects_bad_values_as_422() {
        for raw in ["0.00", "0", "-10.00", "10.005", "abc", "", "12,50"] {
            assert_422(validate_movement_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn movement_amount_rejects_million_and_above_as_422() {
        for raw in ["1000000.00", "1000000", "2500000.50"] {
            assert_422(validate_movement_amount(raw).unwrap_err());
        }
    }

    #[test]
    fn description_accepts_short_but_rejects_oversized_as_422() {
        assert_eq!(validate_description("mercado").unwrap(), "mercado");
        assert_422(validate_description(&"x".repeat(2001)).unwrap_err());
        validate_description(&"x".repeat(2000))
            .expect("2000 bytes is the documented bound");
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
            category_id: Some(Uuid::new_v4()),
            subscription_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let v = serde_json::to_value(&resp).unwrap();
        assert_eq!(v["amount"], serde_json::Value::String("25000.00".into()));
        assert_eq!(v["occurred_on"], serde_json::Value::String("2026-09-24".into()));
        assert_eq!(v["direction"], serde_json::Value::String("expense".into()));
    }

    #[test]
    fn movement_sql_scopes_every_query_by_user_id_and_locks_first() {
        for sql in [
            LOCK_ACCOUNT_SQL,
            INSERT_MOVEMENT_SQL,
            APPLY_BALANCE_SQL,
            UPDATE_MOVEMENT_SQL,
            DELETE_MOVEMENT_SQL,
            LIST_MOVEMENTS_SQL,
            GET_MOVEMENT_SQL,
            LOCK_MOVEMENT_SQL,
        ] {
            assert!(
                sql.contains("user_id"),
                "movement SQL must scope by user_id, got: {sql}"
            );
        }
        assert!(
            LOCK_ACCOUNT_SQL.contains("FOR UPDATE"),
            "account probe must lock the row, got: {LOCK_ACCOUNT_SQL}"
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
        let insert_columns = INSERT_MOVEMENT_SQL
            .split("VALUES")
            .next()
            .unwrap_or(INSERT_MOVEMENT_SQL);
        assert!(
            !insert_columns.contains("updated_at"),
            "insert column list relies on the created_at/updated_at column defaults, got: {insert_columns}"
        );
    }

    // -- DB-gated tests (skip without DATABASE_URL) --------------------------

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
            "INSERT INTO accounts (user_id, name, type, balance) VALUES ($1,$2,'cash',$3::numeric) RETURNING id",
        )
        .bind(user_id)
        .bind(name)
        .bind(balance)
        .fetch_one(pool)
        .await
        .expect("seed account")
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
    async fn unauthenticated_movement_access_is_401() {
        let Some(pool) = test_pool() else {
            eprintln!("SKIP unauthenticated_movement_access_is_401: no DATABASE_URL");
            return;
        };
        let (state, _, _) = db_state(&pool).await;
        let (_, _, user_id) = db_state(&pool).await;
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
        let err = list_movements_handler(State(state.clone()), empty)
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
        let listed = list_movements_handler(State(state.clone()), headers.clone())
            .await
            .expect("list is 200");
        let dates: Vec<String> = listed
            .0
            .iter()
            .map(|m| m.occurred_on.to_string())
            .collect();
        assert_eq!(dates, vec!["2026-09-24", "2026-09-22", "2026-09-20"]);
        cleanup_user(&pool, user_id).await;
    }
}
