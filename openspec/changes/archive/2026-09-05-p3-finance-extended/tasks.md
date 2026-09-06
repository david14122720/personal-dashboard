# Tasks: p3-finance-extended

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1100-1300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Money) → PR 2 (Savings) → PR 3 (Debts) → PR 4 (Subs) → PR 5 (Assets/NetWorth) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Money Parsers | PR 1 | `cargo test finance::money` | N/A (Pure logic) | `backend/src/finance/money.rs` |
| 2 | Savings Domain | PR 2 | `cargo test routes::savings` | `curl /savings-goals` | `backend/src/routes/savings.rs` |
| 3 | Debts Domain | PR 3 | `cargo test routes::debts` | `curl /debts` | `backend/src/routes/debts.rs` |
| 4 | Subs Domain | PR 4 | `cargo test routes::subscriptions` | `curl /subscriptions` | `backend/src/routes/subscriptions.rs` |
| 5 | Assets & Net Worth | PR 5 | `cargo test routes::assets` | `curl /net-worth` | `backend/src/routes/assets.rs` |

## Phase 1: Infrastructure (Money Parsing)

- [x] 1.1 Implement `parse_money_amount_nonneg` (≥0, scale≤2) in `backend/src/finance/money.rs`
- [x] 1.2 Implement `parse_signed_amount` (≠0, scale≤2) in `backend/src/finance/money.rs`
- [x] 1.3 Write unit tests in `backend/src/finance/money.rs` covering valid/invalid strings for all 3 parsers

## Phase 2: Savings Domain (TDD)

- [x] 2.1 Write RED tests for `POST /savings-goals` (201 happy path, 409 duplicate name) in `backend/src/routes/savings.rs` — done in slice 2a (goals-only)
- [x] 2.2 Implement `POST /savings-goals` handler in `backend/src/routes/savings.rs` (GREEN) — done in slice 2a
- [x] 2.3 Write RED tests for `GET /savings-goals` and `GET /savings-goals/:id` (200 happy path, 404 cross-user) in `backend/src/routes/savings.rs` — done in slice 2a
- [x] 2.4 Implement `GET` handlers in `backend/src/routes/savings.rs` (GREEN) — done in slice 2a
- [x] 2.5 Write RED tests for `DELETE /savings-goals/:id` (204 happy path, 404 cross-user) in `backend/src/routes/savings.rs` — done in slice 2a
- [x] 2.6 Implement `DELETE` handler in `backend/src/routes/savings.rs` (GREEN) — done in slice 2a
- [x] 2.7 Write RED tests for `POST /savings-goals/:id/movements` (201 happy path, 422 invalid money, 422 orphaned goal) in `backend/src/routes/savings.rs` — slice 2b (reverted slice-2 content NOT landed)
- [x] 2.8 Implement `POST .../movements` handler using `parse_signed_amount` in `backend/src/routes/savings.rs` (GREEN) — slice 2b
- [x] 2.9 Write RED tests for `DELETE /savings-goals/:id/movements/:mid` (204 happy path, 404 cross-user) in `backend/src/routes/savings.rs` — slice 2b
- [x] 2.10 Implement `DELETE .../movements/:mid` handler in `backend/src/routes/savings.rs` (GREEN) — slice 2b
- [x] 2.11 Write RED tests for Savings triggers (balance update, `is_completed` flip) in `backend/src/routes/savings.rs` — slice 2b (trigger effects are movement-driven)
- [x] 2.12 Verify Savings triggers are operational (GREEN) — slice 2b

## Phase 3: Debts Domain (TDD)

- [x] 3.1 Write RED tests for `POST /debts` (201 happy path, status=active, pending=original) in `backend/src/routes/debts.rs`
- [x] 3.2 Implement `POST /debts` handler in `backend/src/routes/debts.rs` (GREEN)
- [x] 3.3 Write RED tests for `GET /debts` and `GET /debts/:id` (200 happy path, 404 cross-user) in `backend/src/routes/debts.rs`
- [x] 3.4 Implement `GET` handlers in `backend/src/routes/debts.rs` (GREEN)
- [x] 3.5 Write RED tests for `DELETE /debts/:id` (204 happy path, 404 cross-user) in `backend/src/routes/debts.rs`
- [x] 3.6 Implement `DELETE` handler in `backend/src/routes/debts.rs` (GREEN)
- [x] 3.7 Write RED tests for `POST /debts/:id/payments` (201 happy path, 422 overpayment, 422 status≠active, 422 invalid money) in `backend/src/routes/debts.rs`
- [x] 3.8 Implement `POST .../payments` handler in `backend/src/routes/debts.rs` (GREEN)
- [x] 3.9 Write RED tests for Debts triggers (pending_amount update, status flip to `paid_off`) in `backend/src/routes/debts.rs`
- [x] 3.10 Verify Debts triggers are operational (GREEN)

## Phase 4: Subscriptions Domain (TDD)

- [x] 4.1 Write RED tests for `POST /subscriptions` (201 happy path, 422 wrong category kind, 422 invalid money) in `backend/src/routes/subscriptions.rs`
- [x] 4.2 Implement `POST /subscriptions` handler in `backend/src/routes/subscriptions.rs` (GREEN)
- [x] 4.3 Write RED tests for `GET /subscriptions` and `GET /subscriptions/:id` (200 happy path, 404 cross-user) in `backend/src/routes/subscriptions.rs`
- [x] 4.4 Implement `GET` handlers in `backend/src/routes/subscriptions.rs` (GREEN)
- [x] 4.5 Write RED tests for `PATCH /subscriptions/:id` (200 OK for `is_active`, 422 unknown fields, 404 cross-user) in `backend/src/routes/subscriptions.rs`
- [x] 4.6 Implement `PATCH` handler in `backend/src/routes/subscriptions.rs` (GREEN)
- [x] 4.7 Write RED tests for `DELETE /subscriptions/:id` (204 happy path, 404 cross-user) in `backend/src/routes/subscriptions.rs`
- [x] 4.8 Implement `DELETE` handler in `backend/src/routes/subscriptions.rs` (GREEN)

## Phase 5: Assets & Net Worth (TDD)

- [x] 5.1 Write RED tests for `POST /assets` (201 happy path) in `backend/src/routes/assets.rs`
- [x] 5.2 Implement `POST /assets` handler in `backend/src/routes/assets.rs` (GREEN)
- [x] 5.3 Write RED tests for `GET /assets` and `GET /assets/:id` (200 happy path, 404 cross-user) in `backend/src/routes/assets.rs`
- [x] 5.4 Implement `GET` handlers in `backend/src/routes/assets.rs` (GREEN)
- [x] 5.5 Write RED tests for `DELETE /assets/:id` as archive-flag update (204 happy path, 404 cross-user) in `backend/src/routes/assets.rs`
- [x] 5.6 Implement `DELETE` (archive) handler in `backend/src/routes/assets.rs` (GREEN)
- [x] 5.7 Write RED tests for `POST /assets/:id/valuations` (201 happy path, 422 out-of-order recorded_on, 422 invalid money) in `backend/src/routes/assets.rs`
- [x] 5.8 Implement `POST .../valuations` handler in `backend/src/routes/assets.rs` (GREEN)
- [x] 5.9 Write RED tests for `GET /net-worth` (200 OK, correct aggregate: assets - debts, grouped by currency) in `backend/src/routes/assets.rs`
- [x] 5.10 Implement `GET /net-worth` handler in `backend/src/routes/assets.rs` (GREEN)
- [x] 5.11 Write RED tests for Assets triggers (`current_value` update) in `backend/src/routes/assets.rs`
- [x] 5.12 Verify Assets triggers are operational (GREEN)

## Phase 6: Wiring & Integration

- [x] 6.1 Register `savings`, `debts`, `subscriptions`, and `assets` modules in `backend/src/routes/mod.rs` — slice 6 (removed 4 `#[allow(dead_code)]` shims; test-only probe consts gated `#[cfg(test)]`)
- [x] 6.2 Wire all route handlers into the application in `backend/src/main.rs` — slice 6 (14 endpoints: savings-goals x4, debts x3, subscriptions x2, assets x3, net-worth x1, P2 style)
- [x] 6.3 Final smoke test: verify all domains interact correctly (especially Net Worth aggregate) — slice 6 (boot + 401/422/405 matrix, full suite 202 green, clippy clean)
