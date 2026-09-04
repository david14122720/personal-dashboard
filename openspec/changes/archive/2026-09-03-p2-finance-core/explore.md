# Exploration: p2-finance-core (backend finance core)

## Current State

P1 (auth) is done; **no finance routes exist yet**. The finance *schema* already
exists in `backend/migrations/0002_finance.sql`, so P2 is an **API layer over a
pre-existing schema**, plus (critically) a trigger fix:

- `accounts` — `UNIQUE(user_id, name)`, cached `balance NUMERIC(18,2)`, partial
  index on active accounts, credit-card columns, optional `asset_id` (FK target
  lands in migration 0003).
- `transactions` — `amount NUMERIC(18,2) CHECK (amount > 0)`,
  `transfer_group_id` shared by both transfer legs, `transfer_has_group` CHECK
  (`type='transfer'` ⟺ group id present), indexes on
  (user,date), (user,account,date), (user,category,date), (user,type,date).
- `budgets` — per-category period caps with `warn_threshold` / `over_threshold`
  fractions and `period_end >= period_start` CHECK.
- `apply_transaction_to_balance()` AFTER INSERT OR DELETE trigger maintains
  `accounts.balance`. Income/expense branches are correct; **the transfer branch
  is broken** (see Risks).
- Backend conventions to reuse: per-handler `extract_bearer` + session-join
  lookup (`routes/me.rs`), unified `AppError` envelope
  (401/403/404/409/422/429/500), `x-request-id` on every response, `sqlx::PgPool`
  (max 5 conns, 1 CPU / 1 GB), hand-rolled validation (no `validator` crate),
  TDD with `cargo test` unit tests per module.
- `Cargo.toml` has **no money type**: `sqlx` features are
  `postgres, runtime-tokio-rustls, tls-rustls, chrono, uuid` — no `decimal` /
  `bigdecimal`. NUMERIC mapping is an open decision.
- `objetivo.md` finance scope: 7 account kinds (= `account_type` enum already),
  income/expense fields (date, value, category, account, description, payment
  method, type), transfers excluded from income/expense totals, budgets with
  spent/remaining/%used + warn/over alerts.

## Affected Areas

- `backend/src/routes/` — new modules: `accounts.rs`, `transactions.rs`,
  `transfers.rs`, `budgets.rs` (+ wiring in `routes/mod.rs`, `main.rs`).
- `backend/src/auth/middleware.rs` (or new `auth/require_user.rs`) — extract a
  shared `require_user_id(pool, headers) -> Uuid` helper; `me.rs` inlines this
  today and every finance handler will need it.
- `backend/src/error.rs` — already covers 401/403/404/409/422; likely no change
  (409 `Conflict` maps UNIQUE violations).
- `backend/migrations/0005_*` (new) — transfer-trigger fix; 0002 is already
  applied and must not be edited.
- `backend/Cargo.toml` — add `rust_decimal` (+ `serde` impl) and sqlx `decimal`
  feature; consider `time`/`chrono` already present for `occurred_on: NaiveDate`.
- `openspec/specs/` — new `finance-core` spec in propose/spec phases.
- Out of scope: dashboard aggregates, charts, savings/debts/subs (0003), frontend.

## Approaches

### 1. Balance consistency: keep DB trigger vs move to app-level transaction

- **A — Keep trigger for income/expense, app-level explicit updates for
  transfers (recommended).** Income/expense trigger branches are correct and keep
  dashboard reads O(1). Transfers bypass the broken trigger branch (neutralized
  by a 0005 migration): the handler opens one DB transaction, inserts both legs
  with the same `transfer_group_id`, and issues the two `UPDATE accounts`
  statements itself, then commits.
  - Pros: single writer path per operation type; no double-apply risk once the
    transfer branch is neutralized; transfer intent is explicit and testable in
    Rust; keeps the correct trigger code untouched.
  - Cons: two balance-writing mechanisms coexist (trigger + app); requires one
    corrective migration; reviewers must understand why transfers differ.
  - Effort: Medium.
- **B — Fix the trigger to handle transfers correctly, app only inserts rows.**
  Rewrite `apply_transaction_to_balance()` so the second leg credits the
  destination.
  - Pros: single mechanism (trigger owns all balance writes); app code stays
    thin.
  - Cons: trigger cannot tell source leg from destination leg — both rows are
    `(type='transfer', amount > 0, account_id)`; distinguishing them needs a new
    column (e.g. `transfer_direction`) or fragile insert-order dependence, i.e.
    a schema change anyway plus PL/pgSQL that is hard to unit-test under TDD
    (`cargo test` cannot cover it). Rejected.
  - Effort: High (schema change + untestable logic).
- **C — Drop the trigger entirely; all balance writes in app transactions.**
  - Pros: one mechanism, fully covered by `cargo test` + integration tests.
  - Cons: every income/expense handler must remember the balance UPDATE;
    a forgotten path silently desyncs balances; rewrites already-correct,
    already-deployed trigger behavior. Rejected.
  - Effort: Medium-High.

### 2. Transfer atomicity

- **Single DB transaction inserting both legs + both balance updates (recommended).**
  Handler: `BEGIN` → verify both accounts belong to caller, distinct, same-user
  → `gen_random_uuid()` group id → INSERT leg A, INSERT leg B (with
  `related_transfer_id` cross-links set explicitly, not relying on
  `trg_tx_link_counterparty`) → UPDATE balances (−source, +dest) → `COMMIT`.
  Any error → `ROLLBACK`, no partial state. Idempotency key optional (defer).
  - Pros: atomic by construction; no dependence on the asymmetric
    counterparty-link trigger (which only back-links leg 1 → leg 2); both
    `related_transfer_id` directions set deterministically.
  - Cons: holds a pooled connection slightly longer (fine at ≤5 conns,
    single-user workload).
  - Effort: Low-Medium.
- Alternative (rejected): two sequential requests (create leg, then link).
  Leaves half-transfers on failure; contradicts "saldos consistentes".

### 3. Money type: NUMERIC(18,2) ↔ Rust ↔ JSON

- **`rust_decimal::Decimal` + sqlx `decimal` feature, serialized as JSON string
  (recommended).** Add `rust_decimal = { version = "1", features = ["serde"] }`
  and sqlx `decimal`. Validate `amount > 0` at the boundary (RFC: reject float
  input — accept string or integer minor units in DTOs, never `f64`).
  - Pros: exact decimal arithmetic, no float drift; sqlx native NUMERIC support;
    string serialization keeps frontend `Number()` conversion explicit.
  - Cons: new dependency; DTOs need a custom deserializer accepting
    string-or-int (small, testable).
  - Effort: Low.
- Alternative (rejected): `f64` in Rust. Float rounding on money violates the
  domain; fails the "never guess with money" bar. `i64` minor units is viable
  but fights the NUMERIC schema and COP (no minor units in practice) — more
  conversion friction than `Decimal`.

### 4. Auth scoping and ownership checks

- **Reuse P1 pattern, extracted to a helper (recommended).** `require_user_id()`
  does the `extract_bearer` → `SHA-256` → active-session join and returns
  `user_id` or `AppError::Auth` (fail closed). Every finance query is scoped
  `WHERE user_id = $1`; account access goes through
  `SELECT … WHERE id = $1 AND user_id = $2` → `None` maps to **404** (not 403)
  to avoid cross-user existence oracles; category use validated as
  `kind='finance'` + owned at the app layer (no DB check exists).
  Category/account mismatch → 422. Parameterized queries only (sqlx binds).
  - Pros: consistent with `session-auth` spec; 404-on-foreign-id leaks nothing;
    fully unit-testable.
  - Cons: ownership subquery on every write (one extra round-trip; negligible).
  - Effort: Low.
- Note: `main.rs` CORS is currently `Allow-Origin: Any` — pre-existing P1 debt
  that finance inherits; flag for hardening, do not bundle into P2 scope.

### 5. Budget computation: on-demand aggregate vs materialized view

- **On-demand aggregate query per budget (recommended).**
  `SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id=$1 AND
  category_id=$2 AND type='expense' AND occurred_on BETWEEN $3 AND $4`
  (transfer rows are `type='transfer'`, excluded by construction), then compute
  `remaining = amount − spent`, `pct = spent/amount`, `status =
  ok|warn|over` from the row's thresholds in Rust. Covered by the existing
  `idx_tx_user_category_date`.
  - Pros: no new schema object; always fresh; trivially testable; single-user
    scale makes per-request aggregation cheap.
  - Cons: one aggregate query per budget row (N+1) on list endpoints — mitigate
    with a single `GROUP BY category_id` query for the list case in design.
  - Effort: Low.
- Alternative (rejected for P2): `budget_status` view. Adds a DB object for a
  problem that is one indexed query; view still needs per-row thresholds
  applied. Revisit only if budget lists measurably slow.

## Recommendation

Approach **A + single-txn transfers + rust_decimal-as-string + helper auth
scoping + on-demand budget aggregates**, plus migration `0005` neutralizing the
transfer branch of `apply_transaction_to_balance()` (and optionally the
asymmetric `trg_tx_link_counterparty`, superseded by explicit cross-links).
Propose endpoints: accounts CRUD (+ archive, history via filtered transactions),
transactions CRUD for income/expense (no UPDATE of amount/account/type — model
as DELETE+recreate or explicit reversal so the trigger stays correct),
transfers create/get (no update/delete except void-by-reversal, TBD in design),
budgets CRUD + computed status fields. TDD: unit tests for money parsing,
status mapping, auth helper; integration tests (sqlx against local PG
`192.168.50.120:5434`) proving transfer atomicity (rollback on second-leg
failure) and balance reconciliation (`SUM(transactions)` vs cached `balance`).

## Risks

- **Transfer trigger is wrong today (verified by reading 0002).** Both legs do
  `balance − amount` on their own account and the first-inserted leg is a no-op
  (counter not found yet) — money vanishes; destination is never credited.
  Any transfer written before the 0005 fix corrupts balances. Mitigation: fix
  migration is a P2 prerequisite; add a reconciliation query to design.
- **No UPDATE trigger on transactions.** `UPDATE amount/account/type` silently
  desyncs `accounts.balance`. Mitigation: forbid those UPDATES at the API
  (allow only description/category/notes edits) or implement reversal entries.
- **`related_transfer_id` back-link trigger is one-directional** (leg 1 → leg 2
  only). Mitigation: set both directions explicitly in the app transaction;
  neutralize or remove the trigger in 0005.
- **No FK constraining `transactions.category_id` to `kind='finance'`.**
  Mitigation: app-layer check on every write (422 otherwise).
- **`accounts.asset_id` references a table created in 0003** with no FK
  declared in 0002 — dangling-id risk. Mitigation: treat as opaque UUID in P2;
  do not join or cascade on it.
- **CORS `Any`** inherited from P1 (`main.rs`); finance endpoints ship with it
  unless hardened separately. Flag, don't scope-creep.
- **Concurrent transfers on the same account** could interleave balance UPDATEs;
  single-user workload makes this unlikely, but design should use
  `SELECT … FOR UPDATE` on the two account rows inside the transfer transaction.

## Ready for Proposal

Yes. No external research needed — all evidence is in-repo (migrations, P1
handlers, specs, `objetivo.md`). Next: `propose` for `p2-finance-core`, then
`spec` (finance-core delta spec) and `design` (endpoints, DTOs, 0005 migration,
error mapping, TDD test list).
