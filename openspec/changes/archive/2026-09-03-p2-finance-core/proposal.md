# Proposal: p2-finance-core

## Intent

Implement the core finance API layer over the existing `0002_finance` schema. This change provides the necessary backend infrastructure for managing accounts, transactions (income/expense), atomic transfers, and budget tracking, ensuring strict balance consistency and ownership scoping.

## Scope

### In Scope
- **Accounts CRUD**: Create, read, update, and archive accounts.
- **Transactions CRUD**: Create and manage income/expense entries (limited updates to prevent balance desync).
- **Atomic Transfers**: Single-transaction implementation of double-leg transfers with manual balance updates.
- **Budgets**: CRUD and on-demand status computation (spent/remaining/% used) with alert thresholds.
- **Trigger Fix**: Migration `0005` to neutralize broken transfer logic in the balance trigger.
- **Infrastructure**: `rust_decimal` integration for money, shared `require_user_id` auth helper.

### Out of Scope
- Aggregated dashboards and visual charts.
- Specialized modules for savings, debts, or subscriptions (migration `0003` related).
- Frontend implementation.
- Global CORS hardening (inherited P1 debt).

## Capabilities

### New Capabilities
- `finance-accounts`: Management of financial accounts and their cached balances.
- `finance-transactions`: Recording of income and expense events.
- `finance-transfers`: Atomic movement of funds between accounts.
- `finance-budgets`: Category-based spending caps and status monitoring.

### Modified Capabilities
- None

## Approach

### Technical Strategy
- **Balance Management**: Hybrid approach. Keep the existing DB trigger for Income/Expense to maintain $O(1)$ reads. Implement Transfers via a single application-level DB transaction that handles both transaction legs and both account balance updates explicitly.
- **Corrective Migration**: Deploy migration `0005` to neutralize the broken transfer branch of the `apply_transaction_to_balance()` trigger.
- **Money Handling**: Use `rust_decimal::Decimal` mapped to `NUMERIC(18,2)` via `sqlx`. All money DTOs will use strings for serialization to avoid floating-point drift.
- **Security & Auth**: Extract a shared `require_user_id` helper. Every query is scoped by `user_id`. Resource access (e.g., specific account ID) returns `404 Not Found` if not owned by the user to prevent existence oracles.
- **Budgeting**: Compute budget status on-demand using indexed aggregation queries (`SUM` of expenses per category/period), mapping thresholds to status (OK/Warn/Over) in Rust.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/` | New | `accounts.rs`, `transactions.rs`, `transfers.rs`, `budgets.rs` |
| `backend/src/auth/` | Modified | Extraction of `require_user_id` helper |
| `backend/migrations/` | New | `0005_fix_transfer_trigger.sql` |
| `backend/Cargo.toml` | Modified | Add `rust_decimal` and `sqlx` decimal feature |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Balance Desync via `UPDATE` | Med | Forbid updates to amount/account/type at the API level; only allow description/category edits. |
| Transfer Race Conditions | Low | Use `SELECT ... FOR UPDATE` on account rows during transfer transactions. |
| Existing Corrupt Balances | Med | Implement a reconciliation query in the design phase to detect/fix desyncs. |
| Trigger Conflict | Low | Migration `0005` explicitly neutralizes the legacy transfer branch. |

## Rollback Plan

1. Revert `backend/src/` code changes.
2. Drop migration `0005` (if possible) or apply a counter-migration to restore the previous trigger state (acknowledging the bug).
3. Since the schema is mostly additive or corrective, data loss risk is low, but balance audits are required after rollback.

## Dependencies

- P1 (Auth) must be stable and deployed.
- PostgreSQL instance at `192.168.50.120:5434`.

## Success Criteria

- [ ] All `cargo test` unit and integration tests pass.
- [ ] Transfer atomicity proven: failure in the second leg rolls back the first.
- [ ] Balance consistency: `SUM(transactions)` equals `accounts.balance` for all accounts.
- [ ] Ownership scoping: Requests for foreign `user_id` resources return 404.
