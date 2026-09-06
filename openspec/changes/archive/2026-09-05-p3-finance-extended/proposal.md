# Proposal: p3-finance-extended

## Intent

Extend the finance module to support savings goals, debt tracking, subscriptions, and asset valuations, culminating in a comprehensive net-worth aggregation. This change builds upon the P2 finance core and leverages existing database triggers from migration `0003` to maintain derived balances.

## Scope

### In Scope
- **Savings Goals**: CRUD for goals, management of signed movements (deposits/withdrawals).
- **Debts**: CRUD for debts, tracking payments, and status transitions (`active` $\to$ `paid_off`).
- **Subscriptions**: CRUD for recurring services, activation/cancellation lifecycle.
- **Assets**: CRUD for assets, append-only valuations, and on-demand Net Worth aggregation.
- **Integration**: Proper ownership checks for `transaction_id` and `category_id` cross-links.

### Out of Scope
- Frontend UI, charts, or dashboard components.
- Modifications to migration `0003` (considered final).
- Cross-currency exchange rate calculations for net worth.

## Capabilities

### New Capabilities
- `finance-savings`: Management of savings goals and their corresponding value movements.
- `finance-debts`: Tracking of owed amounts and payment history.
- `finance-subscriptions`: Lifecycle management of recurring financial commitments.
- `finance-assets`: Tracking of asset values and computation of total net worth.

### Modified Capabilities
- None

## Approach

Implement thin CRUD handlers over the existing `0003` triggers, adhering to P2 conventions:
- **Scoping**: All routes wrapped in `require_user_id`.
- **Money**: Use `rust_decimal::Decimal` via `parse_money_amount` (string DTOs).
- **Persistence**: 
    - Use the "Thin CRUD" pattern: handlers insert/delete history rows; triggers handle derived fields.
    - Forbid `UPDATE` on amount fields to prevent trigger desync (corrections via DELETE+recreate).
- **Net Worth**: Computed on-demand via `GET /net-worth` as `sum(assets.current_value) - sum(debts.pending_amount)` per currency.

### Resolved Decisions (P2-Consistent)
1. **Savings Movements**: Signed amount string; handler validates direction (deposit vs withdrawal).
2. **Net Worth**: Per-currency aggregate: `sum(assets.current_value, non-archived) - sum(debts.pending_amount, active)`.
3. **Valuations**: INSERT-only. Reject backdated-out-of-order writes (422) to ensure `current_value` trigger accuracy.
4. **Debt Overpayment**: Clamp via API: reject payments $> \text{pending\_amount}$ (422) to avoid silent clamping in DB.
5. **Category Scoping**: `category_id` must match `category_kind` (`finance` for savings, `subscription` for subs).
6. **History Indexing**: User-id scoped; if performance degrades during verification, implement additive `0006` index migration.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/` | New | `savings.rs`, `debts.rs`, `subscriptions.rs`, `assets.rs` |
| `backend/src/routes/mod.rs` | Modified | Wiring new finance modules |
| `backend/src/finance/money.rs` | Modified | Add variant parser for subscriptions ($\ge 0$ vs $> 0$) |
| `openspec/specs/` | New | `finance-savings`, `finance-debts`, `finance-subscriptions`, `finance-assets` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Trigger Desync | Low | Forbid `UPDATE` on amounts at API level; use DELETE+recreate. |
| Race Conditions | Low | Single-user workload; accept standard trigger concurrency. |
| Valuation Ordering | Medium | Strict rejection of out-of-order `recorded_on` dates. |

## Rollback Plan

1. Revert API routes and handler changes.
2. Database state is preserved as `0003` was already applied; only new data in history tables would be orphaned but not corrupt.

## Dependencies

- P2 Finance Core (accounts, transactions) must be stable.
- Migration `0003` must be applied.

## Success Criteria

- [ ] Savings goals correctly flip `is_completed` based on movements.
- [ ] Debt `pending_amount` correctly reaches 0 and flips status to `paid_off`.
- [ ] Net Worth aggregate accurately reflects non-archived assets minus active debts.
- [ ] Ownership checks prevent accessing other users' transactions/categories.
- [ ] Subscriptions support zero-price (free) entries.
