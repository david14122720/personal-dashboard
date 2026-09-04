# Tasks: p2-finance-core

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 800 - 1100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Infra) $\rightarrow$ PR 2 (Ledger) $\rightarrow$ PR 3 (Transfers) $\rightarrow$ PR 4 (Budgets + Wiring) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Foundation & Migration | PR 1 | `cargo test auth::helper` | `curl -H "Authorization: ..." /accounts` | `backend/src/auth/helper.rs`, `migrations/0005...` |
| 2 | Accounts & Tx CRUD | PR 2 | `cargo test routes::accounts` | `POST /accounts`, `POST /transactions` | `backend/src/routes/{accounts,transactions}.rs` |
| 3 | Atomic Transfers | PR 3 | `cargo test routes::transfers` | `POST /transfers` | `backend/src/routes/transfers.rs` |
| 4 | Budgets & Wiring | PR 4 | `cargo test routes::budgets` | `GET /budgets/:id/status` | `backend/src/routes/budgets.rs`, `routes/mod.rs`, `main.rs` |

## Phase 1: Foundation & Infrastructure

- [x] 1.1 Update `backend/Cargo.toml`: Add `rust_decimal` (with `serde` feature) and enable `decimal` feature for `sqlx`.
- [x] 1.2 Create `backend/src/auth/helper.rs`: Implement `require_user_id(&HeaderMap, &PgPool) -> Result<Uuid, AppError>`.
- [x] 1.3 Update `backend/src/auth/mod.rs`: Export `helper` module.
- [x] 1.4 Write RED tests for `require_user_id`: Verify 401 for missing, invalid, or expired tokens.
- [x] 1.5 Create `backend/migrations/0005_fix_transfer_trigger.sql`: `CREATE OR REPLACE` the trigger to neutralize the `transfer` branch (no-op).
- [x] 1.6 Write RED integration test for trigger neutralization: Verify a `type='transfer'` insert does NOT automatically update balances.

## Phase 2: Basic Ledger (Accounts & Transactions)

- [x] 2.1 Create `backend/src/routes/accounts.rs`: Implement CRUD + soft-archive (scoped by `user_id`).
- [x] 2.2 Write RED tests for Account creation: Verify 409 Conflict for duplicate names per user.
- [x] 2.3 Create `backend/src/routes/transactions.rs`: Implement Create (Income/Expense), Limited Patch (metadata only), and Delete.
- [x] 2.4 Write RED tests for Transaction amounts: Verify 422 for `amount <= 0` or `scale > 2`.
- [x] 2.5 Write RED integration tests for Ownership: Verify 404 for foreign `account_id` or `transaction_id`.
- [x] 2.6 Verify Green: `cargo test routes::{accounts,transactions}`.

## Phase 3: Atomic Transfers

- [x] 3.1 Create `backend/src/routes/transfers.rs`: Implement atomic transfer transaction.
    - [x] 3.1.1 Lock accounts in sorted-UUID order (`SELECT ... FOR UPDATE`).
    - [x] 3.1.2 Validate distinct ownership and amount precision.
    - [x] 3.1.3 Insert both legs with `transfer_group_id`.
    - [x] 3.1.4 Explicitly `UPDATE` account balances.
- [x] 3.2 Write RED tests for Transfer validation: Verify 422 for same-account transfer.
- [x] 3.3 Write RED integration test for Atomicity: Simulate failure on 2nd leg $\rightarrow$ verify full rollback (no orphan legs, no balance change).
- [x] 3.4 Verify Green: `cargo test routes::transfers`.

## Phase 4: Budgets & Status

- [ ] 4.1 Create `backend/src/routes/budgets.rs`: Implement CRUD + `GET /budgets/:id/status`.
- [ ] 4.2 Implement budget status aggregation query: `SUM(amount)` for `type='expense'` within period.
- [ ] 4.3 Write RED tests for Budget validation: Verify 422 for `period_end < period_start` or `amount <= 0`.
- [ ] 4.4 Write RED tests for Status Mapper: Verify `ok` $\rightarrow$ `warn` $\rightarrow$ `over` transitions based on percentage.
- [ ] 4.5 Verify Green: `cargo test routes::budgets`.

## Phase 5: Wiring & Final Verification

- [ ] 5.1 Update `backend/src/routes/mod.rs` and `backend/src/main.rs`: Register all new finance routes.
- [ ] 5.2 Write Final Reconciliation Integration Test: Verify `SUM(transactions)` equals `accounts.balance` across all accounts.
- [ ] 5.3 Verify Green: `cargo test` (all targets).
