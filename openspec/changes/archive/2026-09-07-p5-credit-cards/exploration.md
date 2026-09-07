## Exploration: Credit cards for personal-dashboard (Rust Axum + PostgreSQL)

### Current State

Credit-card support is **half-scaffolded in the schema but unexposed in the API**:

- `0001` defines `account_type` enum including `'credit_card'`, accepted at the
  API boundary (`accounts.rs` `ACCOUNT_TYPES`).
- `0002` adds card columns on `accounts` (`credit_limit NUMERIC(18,2)`,
  `statement_day SMALLINT 1–31`, `payment_due_day SMALLINT 1–31`), plus
  `transactions.credit_card_account_id` ("spent on card X" vs "paid card X
  from bank Y" split). The balance trigger already charges the card on
  `expense` inserts with a card link, and reverses on delete (`0005` preserves
  this behavior; only the `transfer` branch was neutralized).
- **Gap**: no route reads or writes these columns. `CREATE_ACCOUNT_SQL` omits
  them; `CREATE_TRANSACTION_SQL` omits `credit_card_account_id`; `grep` finds
  zero uses of `credit_card_account_id` in `src/`. So today a card is just a
  named account with a trigger-maintained `balance` (debt grows negative) —
  no limit, no cycle dates, no usage %, no alerts.
- Established patterns to follow: money-as-string boundary validated by
  `finance/money.rs` (`parse_money_amount`, `> 0`, `scale <= 2` → 422);
  `deny_unknown_fields` DTOs; every query scoped `AND user_id=$N` with
  foreign-id → 404 / orphaned-id → 422 split (`debts.rs::ensure_debt_writable`,
  savings movements contract); derived columns trigger-owned, never writable;
  explicit app-level txn with sorted-UUID `SELECT … FOR UPDATE` for transfers
  (`transfers.rs`); `NUMERIC(18,2)` for money (note: task brief says
  `NUMERIC(12,2)` but the codebase standard is `NUMERIC(18,2)` — follow the
  codebase); per-user unique names → 409 via pgcode `23505`.
- Source requirements (`objetivo.md` § Tarjetas de crédito): limit, used
  balance, available balance, statement date, payment date, purchases,
  payments, visual % of limit used, high-usage alerts.

### Affected Areas

- `backend/migrations/0006_credit_cards.sql` (new) — card columns already
  exist, so this migration only adds CHECKs/indexes (and any new ledger
  table if approach B wins); never edit `0002`.
- `backend/src/routes/accounts.rs` — expose `credit_limit`/`statement_day`/
  `payment_due_day` on create/PATCH for `type='credit_card'`; extend
  `AccountResponse` with derived `used`/`available`/`usage_pct` (computed in
  SELECT, not stored).
- `backend/src/routes/transactions.rs` — accept optional
  `credit_card_account_id` (owned card, 422 if foreign) to record purchases.
- `backend/src/routes/transfers.rs` or new `credit_cards.rs` — card payments
  as transfers (bank → card); new `GET /credit-cards/:id/summary` or extended
  `GET /accounts/:id` for usage %.
- `backend/src/main.rs`, `backend/src/routes/mod.rs` — wire new routes.
- `openspec/specs/finance-accounts/spec.md` — extend with card scenarios.

### Approaches

1. **Card as specialized account (extend `accounts`)** — activate the dormant
   columns: require `credit_limit` on `type='credit_card'`, expose cycle
   days, model purchases via existing `transactions.credit_card_account_id`
   + trigger, payments as `POST /transfers` (bank → card), compute
   `used = -balance`, `available = limit + balance`, `usage_pct` in the read
   query.
   - Pros: zero new tables; reuses trigger, ownership, transfer atomicity,
     budget/category plumbing; smallest migration; consistent with schema
     author's evident intent.
   - Cons: `accounts.balance` semantics get confusing (negative = debt);
     billing-cycle concepts (statement balance vs current balance) need
     date-filtered aggregates, not just the cached balance; CHECK
     (`credit_limit` required iff card) must be added carefully.
   - Effort: Low/Medium

2. **Dedicated entity (`credit_cards` + `credit_card_transactions`)** —
   new tables mirroring `debts`/`debt_payments` with `limit`, `used`
   trigger-maintained, `statement_day`, `payment_due_day`, own purchase/
   payment ledger optionally linked to `transactions`.
   - Pros: clean domain separation; statement-cycle snapshots natural;
     no semantic overload of `accounts.balance`.
   - Cons: duplicates ownership/trigger/transfer machinery; two sources of
     truth for money (card ledger vs transactions ledger) risk drift;
     dashboard/net-worth joins get heavier; more indexes and code on a
     1 CPU/1 GB box; contradicts the existing schema direction.
   - Effort: High

### Recommendation

**Approach A (card as specialized account)**, in slices:

1. Migration `0006`: `CHECK (type='credit_card' ⟺ credit_limit IS NOT NULL)`,
   `CHECK (credit_limit > 0)`, index
   `idx_accounts_user_card ON accounts(user_id) WHERE type='credit_card'`.
2. Extend `POST /accounts` + `PATCH /accounts/:id` with card fields
   (string-money validation, day 1–31 validation, non-card types reject
   card fields with 422); extend responses with computed
   `credit_limit`, `used_balance`, `available_balance`, `usage_pct`
   (single-row `SELECT … CASE`, no N+1).
3. Accept `credit_card_account_id` on `POST /transactions` (expense only,
   owned card, 422 otherwise) — activates the existing trigger path.
4. Document card payment = `POST /transfers` (bank → card), which
   reduces the negative balance via the explicit app txn.
5. `GET /accounts/:id` (or `/credit-cards` summary) returns usage % +
   `alert_level` (ok < 70 %, warn 70–90 %, high > 90 %, mirroring budgets'
   `warn_threshold` convention); cycle dates derived from
   `statement_day`/`payment_due_day` + `occurred_on` range aggregate
   (`SUM … WHERE occurred_on > last_statement`), one indexed query.

Purchases/payments reuse `transactions`/`transfers` — no new ledger table.
`saldo disponible` is computed, never stored (avoids drift); `EXPLAIN`-check
the summary query against `idx_tx_user_account_date`.

### Risks

- `accounts.balance` going negative for cards may confuse dashboard/net-worth
  aggregates that `SUM(balance)` — must treat card balances as liabilities
  in those queries.
- Statement vs current balance needs a date-cutoff aggregate; naive
  `used = -balance` overstates the statement amount after the cutoff.
- Day-of-month 29–31 cycles need a sane rule for short months (clamp to
  month-end); decide in propose phase.
- Over-limit purchases: API guard (422) vs trigger clamp — follow the debts
  precedent (API-level guard, trigger as backstop).
- Scope creep into full billing-cycle engine (installments, interest
  accrual); keep P5 to tracking + alerts, defer interest computation.

### Ready for Proposal

Yes — recommend Approach A with the 5 slices above. Propose should define
exact endpoints, CHECK constraints, usage-%/alert thresholds, and the
short-month rule.
