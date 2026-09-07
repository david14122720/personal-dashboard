# Proposal: Credit Card Tracking (p5-credit-cards)

## Intent

Activate dormant credit card fields in the schema to allow users to track credit limits, usage percentages, and billing cycles without duplicating the ledger or introducing dual-truth drift.

## Scope

### In Scope
- **Database**: Add `CHECK` constraints and indexes for card-specific columns on `accounts`.
- **Account Management**: Expose `credit_limit`, `statement_day`, and `payment_due_day` via `POST /accounts` and `PATCH /accounts/:id`.
- **Purchase Recording**: Allow optional `credit_card_account_id` on `POST /transactions` for expense types.
- **Metrics**: Compute derived `used_balance`, `available_balance`, and `usage_pct` in read queries.
- **Alerts**: Implement usage thresholds: OK (<70%), Warn (70-90%), High (>90%).
- **Billing Logic**: Implement statement/payment day clamping (29-31 $\rightarrow$ last day of month).
- **Balance Types**: Distinguish between Statement Balance (cutoff aggregate) and Current Balance (live).

### Out of Scope
- Interest calculation and automatic accrual.
- Installment plan (cuotas) engine.

## Capabilities

### New Capabilities
- `credit-card-summary`: Calculation of usage percentages and date-filtered statement aggregates.

### Modified Capabilities
- `finance-accounts`: Support for credit card types and their specific metadata.
- `finance-transactions`: Linkage of expenses to a specific credit card account.
- `finance-transfers`: Use of transfers for bank-to-card payments.

## Approach

**Pattern: Card as Specialized Account**
Instead of a new entity, we activate the dormant columns already present in the schema. 

1. **Schema**: Migration `0006` adds `CHECK (type='credit_card' ⟺ credit_limit IS NOT NULL)` and `CHECK (credit_limit > 0)`.
2. **Data Types**: Standardize on `NUMERIC(18,2)` for all money fields.
3. **Read Optimization**: Use `CASE` statements in the primary account `SELECT` to compute usage metrics, avoiding N+1 queries.
4. **Cycle Logic**: Statement and payment dates are derived from the stored day-of-month, clamped to the month-end for short months.
5. **Ledger**: Reuse existing `transactions` trigger. Purchases increment debt (negative balance); payments (transfers) reduce it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/migrations/0006_credit_cards.sql` | New | Constraints and indexes for card accounts |
| `backend/src/routes/accounts.rs` | Modified | Expose card fields in DTOs and SQL |
| `backend/src/routes/transactions.rs` | Modified | Support `credit_card_account_id` in purchases |
| `backend/src/routes/transfers.rs` | Modified | Documentation/Validation for bank $\rightarrow$ card payments |
| `openspec/specs/finance-accounts/spec.md` | Modified | Add credit card scenarios |
| `openspec/specs/finance-transactions/spec.md` | Modified | Add card linkage requirements |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Net worth aggregates miscalculating card debt | Med | Ensure `SUM(balance)` treats negative card balances as liabilities |
| Statement balance drift | Low | Compute via date-filtered `SUM` on `transactions` rather than cached balance |
| Over-limit purchases | Med | API-level guard (422) validated against `credit_limit` |

## Rollback Plan

1. Revert API changes in `accounts.rs` and `transactions.rs`.
2. Roll back migration `0006_credit_cards.sql` (drop constraints/indexes).

## Dependencies

- Existing `accounts` and `transactions` trigger logic must be preserved.

## Success Criteria

- [ ] Card accounts can be created/updated with limits and cycle days.
- [ ] Expenses linked to a card correctly update the account balance.
- [ ] Account summary returns correct `usage_pct` and `alert_level`.
- [ ] Statement balance correctly aggregates only transactions prior to the statement date.
