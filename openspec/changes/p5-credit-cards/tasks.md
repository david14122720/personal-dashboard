# Tasks: Credit Card Tracking (p5-credit-cards)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 350 - 400 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR or 4 work-unit slices |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Foundation & Schema | PR 1 | `cargo test tests/migrations` | Migration apply | `backend/migrations/0006_credit_cards.sql` |
| 2 | Account Management | PR 2 | `cargo test tests/accounts` | `POST /accounts` $\to$ `GET /accounts/:id` | `backend/src/routes/accounts.rs` |
| 3 | Transaction Linkage | PR 3 | `cargo test tests/transactions` | `POST /transactions` (with card link) | `backend/src/routes/transactions.rs` |
| 4 | Financial Summary | PR 4 | `cargo test tests/assets` | `GET /net-worth` | `backend/src/routes/assets.rs`, `backend/src/routes/transfers.rs` |

## Phase 1: Foundation & Infrastructure

- [x] 1.1 Create `backend/migrations/0006_credit_cards.sql` with `chk_card_limit_presence`, `chk_card_limit_pos`, `chk_card_days_presence` and partial indexes `idx_accounts_user_card`, `idx_tx_card_user_date` (landed as `0008_credit_cards.sql`: 0006/0007 already taken; identical content)
- [x] 1.2 Write integration tests for Migration 0006:
    - [x] 1.2.1 RED: Reject non-card account with `credit_limit`
    - [x] 1.2.2 RED: Reject card account without `credit_limit`
    - [x] 1.2.3 GREEN: Allow card account with `credit_limit > 0`
- [x] 1.3 Verify index usage for card queries using `EXPLAIN (ANALYZE)` to ensure no Seq Scan on `accounts` or `transactions` (GREEN)

## Phase 2: Account Implementation (Slice 2)

- [x] 2.1 Update `backend/src/routes/accounts.rs` DTOs (`CreateAccountRequest`, `AccountResponse`) to include `credit_limit`, `statement_day`, `payment_due_day`, and computed metrics
- [x] 2.2 Implement `validate_card_fields` and month-end date clamping logic in `backend/src/routes/accounts.rs`
- [x] 2.3 Implement CASE-computed metrics (`used_balance`, `available_balance`, `usage_pct`, `alert_level`) in the `GET /accounts` SQL query to avoid N+1 (implemented as Rust computation from the same 14-column row: single fetch, no N+1; SQL CASE would breach the sqlx 16-column cap)
- [x] 2.4 Write integration tests for Accounts:
    - [x] 2.4.1 RED: `POST /accounts` returns 422 if `type: "credit_card"` but `credit_limit` is missing
    - [x] 2.4.2 RED: `POST /accounts` returns 422 if `type: "savings"` but `credit_limit` is provided
    - [x] 2.4.3 GREEN: `POST /accounts` returns 201 for valid credit card configuration
    - [x] 2.4.4 GREEN: `GET /accounts/:id` returns correct `usage_pct` and `alert_level` for given balance/limit

## Phase 3: Transaction Implementation (Slice 3)

- [x] 3.1 Update `backend/src/routes/transactions.rs` DTOs to include optional `credit_card_account_id`
- [x] 3.2 Implement ownership check and "expense-only" validation for `credit_card_account_id` in `backend/src/routes/transactions.rs`
- [x] 3.3 Implement over-limit guard in `backend/src/routes/transactions.rs` returning 422 if `used_balance + amount > credit_limit`
- [x] 3.4 Write integration tests for Transactions:
    - [x] 3.4.1 RED: `POST /transactions` returns 422 when linking income to credit card
    - [x] 3.4.2 RED: `POST /transactions` returns 422 when purchase exceeds `credit_limit`
    - [x] 3.4.3 GREEN: `POST /transactions` returns 201 for linked expense and verify account balance becomes negative

## Phase 4: Summary & Wiring (Slice 4)

- [ ] 4.1 Implement statement balance cutoff aggregate (`SUM` of transactions where `occurred_on <= cutoff`) in `backend/src/routes/accounts.rs`
- [ ] 4.2 Update `backend/src/routes/assets.rs` to include card debt in liabilities using `SUM(GREATEST(-balance, 0))`
- [ ] 4.3 Update `backend/src/routes/transfers.rs` with documentation and validation for bank $\to$ card payments
- [ ] 4.4 Write integration tests for Summary & Wiring:
    - [ ] 4.4.1 RED: Statement balance includes transactions after the billing cutoff date
    - [ ] 4.4.2 GREEN: Statement balance correctly aggregates only transactions on or before cutoff
    - [ ] 4.4.3 RED: Total net worth increases when a card balance becomes more negative
    - [ ] 4.4.4 GREEN: Total net worth correctly treats card debt as a liability
