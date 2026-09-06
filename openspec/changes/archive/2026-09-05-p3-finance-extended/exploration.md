## Exploration: p3-finance-extended (savings goals + movements, debts + payments, subscriptions, assets + valuations / net worth)

### Current State

P2 (finance core) is done and archived: `accounts`, `transactions`, `transfers`,
`budgets` routes exist in `backend/src/routes/`, all scoped by `require_user_id`
(`backend/src/auth/helper.rs`), money as `rust_decimal::Decimal` ↔ `NUMERIC(18,2)`
serialized as JSON strings via `parse_money_amount` (`backend/src/finance/money.rs`,
`> 0`, `scale <= 2`, else 422), `UNIQUE(user_id,name)` → 409, FK/kind problems → 422,
foreign-id access → 404. Migration `0005` neutralized the transfer trigger branch.

The P3 *schema* already exists in `backend/migrations/0003_savings_debts_subs_assets.sql`
(applied; do NOT edit). It defines four independent domains, each with a primary
table plus append-only history maintained by AFTER INSERT/DELETE triggers:

- `savings_goals` (`UNIQUE(user_id,name)`, `target_amount > 0`, derived `saved_amount`,
  `is_completed`/`completed_at`) + `savings_goal_movements` (signed `amount <> 0`,
  optional `transaction_id` link). Trigger `update_savings_goal_saved()` applies
  INSERT/DELETE deltas and flips completion.
- `debts` (`original_amount > 0`, derived `pending_amount`, `debt_status` enum:
  `active|paid_off|defaulted|negotiating`) + `debt_payments` (`amount > 0`, optional
  `transaction_id` link). Trigger `update_debt_pending()` subtracts payments with a
  `GREATEST(...,0)` floor and flips `active` ↔ `paid_off`.
- `subscriptions` (`price >= 0` — note: zero allowed, unlike P2 money),
  `subscription_frequency` enum (`daily|weekly|biweekly|monthly|quarterly|semiannual|annual`),
  `is_active` + `cancelled_at`, partial indexes on active rows.
- `assets` (`asset_category` enum, optional `account_id` link, derived `current_value`,
  `is_archived`) + `asset_valuations` (`UNIQUE(asset_id,recorded_on)`). Trigger
  `sync_asset_current_value()` fires on INSERT only. Migration also adds
  `accounts.asset_id → assets(id) ON DELETE SET NULL` (P2 treats it as opaque UUID).
- All tables carry `user_id REFERENCES users(id) ON DELETE CASCADE`, `created_at`, and
  `set_updated_at()` triggers on the four primary tables (NOT on history tables).
- Enums live in `0001` (`debt_status`, `subscription_frequency`, `asset_category`,
  `category_kind` includes `finance` AND `subscription`).

### Affected Areas

- `backend/src/routes/` — new modules: `savings.rs` (goals + movements), `debts.rs`
  (debts + payments), `subscriptions.rs`, `assets.rs` (assets + valuations + net-worth
  aggregate); wiring in `routes/mod.rs`, `main.rs`.
- `backend/src/finance/money.rs` — reuse `parse_money_amount` as-is for all amounts
  (movements need a signed variant: deposit/withdrawal direction).
- `backend/src/routes/transactions.rs` — reuse `validate_occurred_on`,
  `ensure_account_owned`, `ensure_finance_category`-style ownership helpers for the
  `transaction_id` / `category_id` cross-links.
- `backend/src/auth/helper.rs`, `backend/src/error.rs` — no changes expected
  (`require_user_id`, 409/422/404 mapping already cover P3 needs).
- `openspec/specs/` — new delta specs: `finance-savings`, `finance-debts`,
  `finance-subscriptions`, `finance-assets` (net worth included in assets spec).
- Out of scope: new migrations (0003 is final; optional 0006 index-only migration
  TBD in design), dashboard aggregates, charts, frontend.

### Approaches

1. **Thin CRUD over triggers, same as P2 income/expense** — handlers INSERT/DELETE
   history rows and let the 0003 triggers maintain `saved_amount` / `pending_amount` /
   `is_completed` / `status`; PATCH restricted to metadata via `deny_unknown_fields`
   (derived columns never writable, mirroring P2 core-field protection).
   - Pros: consistent with P2; no double-apply risk; least code; triggers already deployed.
   - Cons: inherits trigger limitations (no UPDATE handling, valuation ordering —
     see Risks); needs API-level guards to compensate.
   - Effort: Low/Medium

2. **App-level balance logic with triggers neutralized (transfer-style)** — move
   derived-field maintenance into Rust transactions, neutralize 0003 triggers via a
   new migration.
   - Pros: single writer path in testable Rust; fixes ordering/race issues properly.
   - Cons: rewrites already-correct deployed trigger behavior; needs a corrective
     migration; contradicts P2 precedent for the income/expense path; more code for
     no single-user benefit.
   - Effort: High

3. **Net worth: on-demand aggregate (recommended, budget-status-style)** —
   `GET /net-worth` computes `SUM(assets.current_value)` (+ optionally
   `SUM(accounts.balance)` and `- SUM(debts.pending_amount)`) per currency
   (`GROUP BY currency`, no cross-currency math), reusing the budget on-demand
   aggregate pattern (single round-trip, no materialization).
   - Pros: always fresh; no schema object; trivially testable; fits single-user scale.
   - Cons: definition of net worth (which components) needs a product decision in propose.
   - Effort: Low

### Recommendation

Approach **1 + 3**: thin handlers over the existing 0003 triggers, P2 conventions
verbatim (`require_user_id` scoping, `parse_money_amount` string DTOs, 409 on the two
UNIQUE constraints, 422 on FK/kind/enum problems, 404 on foreign ids), plus an
on-demand `GET /net-worth` aggregate. Proposed endpoints: savings-goals CRUD
(+ archive via `is_completed` filter, not delete) with `POST/GET/DELETE` movements;
debts CRUD (+ `status` transitions `active|negotiating|defaulted`, `paid_off` is
trigger-owned) with `POST/GET/DELETE` payments; subscriptions CRUD + cancel/reactivate
(`is_active` + `cancelled_at`); assets CRUD (+ archive) with `POST/GET` valuations
(no UPDATE/DELETE — model corrections as new valuations, same as P2 DELETE+recreate
rule for trigger-owned state). Movement direction as signed amount string OR
`{kind: deposit|withdrawal}` + positive amount string (decide in propose; former
matches the schema directly, latter matches P2 `> 0` validation reuse).

### Risks

- **No UPDATE trigger anywhere in 0003** (same P2 lesson): editing a movement/payment/
  valuation amount or a goal's `target_amount` silently desyncs derived state or leaves
  stale `is_completed`. Mitigation: forbid those UPDATES at the API (P2 precedent);
  corrections are DELETE+recreate (movements/payments) or new valuation rows.
- **`sync_asset_current_value()` is INSERT-only and order-naive**: the LATEST INSERT
  wins `current_value`, not the latest `recorded_on` — a backdated valuation overwrites
  with stale data, and DELETE never reverts. Mitigation (propose-level decision):
  either reject out-of-order `recorded_on` (422) or recompute `current_value` from
  `MAX(recorded_on)` after each write; forbid valuation DELETE or recompute on delete.
- **Debt overpayment is silently clamped** (`GREATEST(pending-amount,0)` floors at 0;
  excess vanishes). Mitigation: validate `payment <= pending_amount` in the handler
  (422 otherwise) and/or reject payments on `paid_off` debts.
- **Movement/payment `transaction_id` is an unscoped FK**: any transaction id passes the
  DB constraint, including another user's. Mitigation: app-level ownership check
  (`transactions WHERE id=$1 AND user_id=$2`, else 422/404 per P2 category convention).
- **`category_id` kind convention undecided**: `category_kind` has both `finance` and
  `subscription` kinds — savings-goal categories likely `finance`, subscription
  categories likely `subscription`. Decide in propose; enforce app-side (422).
- **`subscriptions.price >= 0` allows zero** (free trials) — `parse_money_amount`
  rejects zero, so subscriptions need their own `>= 0` parser variant.
- **Concurrent history inserts race** (read-modify-write in triggers without row locks,
  same as P2 income/expense). Single-user workload: accept, note in design.
- **Missing `(user_id)` index on history tables** (`savings_goal_movements`,
  `debt_payments` index only `(parent_id, date)`; user-scoped lists would seq-scan).
  Mitigation: optional additive `0006` index-only migration, or always list via parent.
- **`completed_at`/`cancelled_at` lifecycle**: un-completing a goal (movement DELETE)
  resets blindly; subscription reactivate semantics (clear `cancelled_at`?) need
  propose-level decisions.

### Ready for Proposal

Yes. No external research needed — all evidence is in-repo (0003, P2 routes, P2
archive). Next: `propose` for `p3-finance-extended`, resolving the open decisions
(movement direction encoding, net-worth component definition, valuation ordering rule,
overpayment policy, category-kind mapping, history list indexing), then `spec`
(four finance delta specs) and `design` (endpoints, DTOs, error mapping, TDD test list
following P2 conventions: unit tests per module + DB-gated tests with SKIP when no
`DATABASE_URL` + ownership 404 tests).
