# Apply Progress: p2-finance-core — PR1-infra + PR2-ledger + PR3-transfers

## Work unit (PR3-transfers)

- Unit: PR3-transfers (Atomic Transfers). Tasks 3.1–3.4.
- Mode: Standard with TDD discipline (tests written first, RED observed, then GREEN).
  No live Postgres available (`DATABASE_URL` unset), so DB-backed paths are
  DB-gated (SKIP-print without `DATABASE_URL`) exactly like PR1/PR2.
- Chain: stacked-to-main per session preflight. This batch is one autonomous slice.
- Status: 6/6 PR1 + 6/6 PR2 + 7/7 PR3 tasks complete. PR4 explicitly NOT started.

## TDD Cycle Evidence (RED → GREEN) — PR3

| Task | RED (failing test first) | GREEN (implementation) | REFACTOR |
|------|--------------------------|------------------------|----------|
| 3.1 txn skeleton | 3 tests failed on `todo!()` panic (`same_account_transfer_is_422`, `distinct_accounts_pass_validation`, `lock_order_is_sorted_uuid_regardless_of_direction`); 7 contract/DB-SKIP tests passing | `routes/transfers.rs`: `execute_transfer` (BEGIN → sorted-UUID `FOR UPDATE` locks → ownership check → group id → leg1 NULL-link → leg2 → back-link → explicit debit/credit → COMMIT, any err → ROLLBACK) | `rustfmt` on the new file only (repo-wide fmt drift left untouched, PR1 precedent) |
| 3.2 same-account 422 | RED above | `validate_transfer_accounts` (from == to → 422) + handler calls it before touching the DB | Pure unit test + DB-gated no-op test (balance unchanged, 0 legs) |
| 3.3 atomicity rollback | DB tests SKIP-printed (no `DATABASE_URL`) | Fault-injection DB test (temp `BEFORE INSERT` trigger fails 2nd `fault-probe` leg → 500, 0 legs, balances unchanged) + foreign-leg 404 rollback test | Trigger scoped by probe description so parallel tests are unaffected; always dropped in-test |
| 3.4 green | `cargo test routes::transfers`: 7 passed, 3 failed (RED) | `cargo test routes::transfers`: 10 passed, 0 failed; full `cargo test`: 76 unit + 5 integration passed, 0 failed | `cargo clippy --all-targets -- -D warnings` clean |

RED run: `cargo test routes::transfers` showed 3 FAILED (`todo!()` panics) + 7
passing (serde/SQL/shape/DB-SKIP).
GREEN run: 10/10 transfers passed; full suite 76 unit + 5 integration, 0 failed.

## Work Unit Evidence — PR3

| Evidence | Value |
|----------|-------|
| Focused test command and exact result | `cargo test routes::transfers` (backend/): 10 passed, 0 failed (4 DB-gated SKIP without `DATABASE_URL`) |
| Runtime harness command/scenario and exact result | N/A — no runtime boundary exists in this slice (handler declared but not registered; registration is PR4). DB-gated handler tests (`POST /transfers` 201 with ±balances/group/cross-links, same-account 422 no-op, foreign-leg 404 rollback, injected 2nd-leg-failure rollback) SKIP without `DATABASE_URL`, verified via `--nocapture` |
| Rollback boundary | Exact files removable without unrelated work: `backend/src/routes/transfers.rs`; revertible 1-line module declaration in `backend/src/routes/mod.rs`. No migration, no Cargo change, no wiring touched |

Additional gates: `cargo clippy --all-targets -- -D warnings` clean (file-level
`allow(dead_code)` with PR4-wiring justification, matching PR1/PR2 precedent);
`rustfmt` applied to the new file only.

## Files Changed — PR3

| File | Action | What was done |
|------|--------|---------------|
| `backend/src/routes/transfers.rs` | Created (~630 lines) | `POST /transfers` handler: sorted-UUID `FOR UPDATE` locks, in-txn ownership check (404), `parse_money_amount` + strict date + description caps (422), both legs `type='transfer'` with shared `transfer_group_id` + cross `related_transfer_id`, explicit debit/credit, COMMIT/ROLLBACK; 201 + `{transfer_group_id, legs}` |
| `backend/src/routes/mod.rs` | Modified (+1) | Module declaration only (`pub mod transfers`); route registration stays PR4 |
| `openspec/changes/p2-finance-core/tasks.md` | Modified | Phase 3 tasks 3.1–3.4 marked `[x]` |

## Decisions / deviations — PR3

- Both legs are `type='transfer'` (design's fixed order), not income/expense:
  the spec's "expense/income leg" wording describes money direction (out/in),
  while the actual type keeps transfers out of income/expense totals and the
  budget `type='expense'` aggregate.
- Cross-linking is insert-leg1-NULL → insert-leg2→leg1 → update-leg1→leg2,
  because the `related_transfer_id` FK requires the counterparty row to exist.
  The 0002 counterparty trigger is a harmless no-op on this path (documented
  in-module) and 0005 keeps transfer balances trigger-free.
- Ownership is verified INSIDE the txn after locking, so the 404 path rolls
  back an open transaction (covered by the foreign-leg rollback test).
- `validate_occurred_on` is reused from `routes::transactions` (no duplication);
  `TransactionResponse::from` converts legs (identical row shape).
- Response is `201 + {transfer_group_id, legs:[out,in]}` (no precedent existed;
  PR4 wiring may narrow it).

## Review budget — PR3

- Authored: ~640 changed lines (one new file incl. required TDD tests + 1
  tracked-line module declaration). Over the 400 budget; the overage is
  required contract tests + DB-gated atomicity tests that cannot be cut
  without violating the work-unit contract → recommend `size:exception` for
  the PR3 review slice (same treatment as PR1/PR2 exceptions).

## Prior batch (PR2-ledger, preserved)

- Unit: PR2-ledger (Basic Ledger). Tasks 2.1–2.6.
- Mode: Standard with TDD discipline (tests written first, RED observed, then GREEN).
  No live Postgres available, so DB-backed paths are DB-gated (skip without
  `DATABASE_URL`) exactly like PR1.
- Chain: stacked-to-main per session preflight. This batch is one autonomous slice.
- Status: 6/6 PR1 tasks + 6/6 PR2 tasks complete. PR3–PR4 explicitly NOT started.

## TDD Cycle Evidence (RED → GREEN) — PR2

| Task | RED (failing test first) | GREEN (implementation) | REFACTOR |
|------|--------------------------|------------------------|----------|
| 2.1/2.2 account validation + 409 | 9 tests failed on `todo!()` panic (type/name/currency validators, patch-length); duplicate-409 + foreign-404 DB tests SKIP-printed | `routes/accounts.rs`: CRUD + archive, `WHERE id=$1 AND user_id=$2`, `23505`→409, `23514`→422 | `rustfmt` on new files only (repo-wide fmt drift left untouched) |
| 2.3/2.4 tx validation + money | 4 tests failed on `todo!()` panic (type/date/patch validators); money 422 reuses `parse_money_amount` (PR1-tested) + string-amount serde test | `routes/transactions.rs`: income/expense create, metadata-only patch, delete; `transfer` rejected with `POST /transfers` hint | Strict `YYYY-MM-DD` shape check added after chrono accepted `2026-9-1` (test caught leniency, implementation tightened) |
| 2.5 ownership 404 | 5 DB-gated tests SKIP without `DATABASE_URL` | `ensure_account_owned` → 404; `ensure_finance_category` (owned + `kind='finance'`) → 422 | Category unowned/kind-mismatch both 422 per design (never 404, no oracle) |
| 2.6 green | `cargo test routes::`: 25 passed after GREEN (9 RED failures resolved) | Full `cargo test`: 66 unit + 5 integration passed, 0 failed | `cargo clippy --all-targets -- -D warnings` clean |

RED run: `cargo test routes::` showed 9 FAILED (`todo!()` panics) + contract
tests (serde/SQL/serialization) passing + 5 DB SKIP-prints.
GREEN run: 66 unit + 5 integration passed, 0 failed.

## Work Unit Evidence — PR2

| Evidence | Value |
|----------|-------|
| Focused test command and exact result | `cargo test routes::` (backend/): 25 passed, 0 failed (5 DB-gated SKIP without `DATABASE_URL`) |
| Runtime harness command/scenario and exact result | N/A — no runtime boundary exists in this slice (routes declared but not registered; registration is PR4). DB-gated handler tests (`POST /accounts` dup-409, `POST /transactions` 201→`DELETE` 204, foreign-404, category-kind-422) SKIP without `DATABASE_URL`, verified via `--nocapture` |
| Rollback boundary | Exact files removable without unrelated work: `backend/src/routes/accounts.rs`, `backend/src/routes/transactions.rs`; revertible 3-line module declarations in `backend/src/routes/mod.rs`. No migration, no Cargo change, no wiring touched |

Additional gates: `cargo clippy --all-targets -- -D warnings` clean (file-level
`allow(dead_code)` with PR4-wiring justification, matching PR1 precedent);
`rustfmt` applied to the two new files only.

## Files Changed — PR2

| File | Action | What was done |
|------|--------|---------------|
| `backend/src/routes/accounts.rs` | Created (~480 lines) | CRUD + archive; all queries `WHERE ... AND user_id=$N` via `require_user_id`; 201/200, 409 dup name, 422 bad type/currency/lengths, 404 foreign/missing; `deny_unknown_fields` on DTOs; money serialized as string |
| `backend/src/routes/transactions.rs` | Created (~560 lines) | Income/expense create (string amount via `parse_money_amount`, strict date, finance-category check), metadata-only patch (`deny_unknown_fields` → 422 on core-field edits), delete 204 (trigger reverses); `transfer` type rejected toward `POST /transfers` |
| `backend/src/routes/mod.rs` | Modified (+3) | Module declarations only (`pub mod accounts/transactions`); route registration stays PR4 |
| `openspec/changes/p2-finance-core/tasks.md` | Modified | Phase 2 tasks 2.1–2.6 marked `[x]` |

## Decisions / deviations — PR2

- `GET /accounts` lists non-archived only (`AND NOT is_archived`); detail
  `GET /accounts/:id` still returns archived rows (200). Reads the spec
  scenario literally ("no longer appears in active account lists").
- `PATCH` with zero updatable fields → 422 (explicit, avoids no-op 200s).
- Category unowned OR wrong-kind → 422 (never 404), per design error mapping.
- `occurred_on` enforces strict 10-char `YYYY-MM-DD` shape before chrono parse
  (chrono leniently accepts `2026-9-1`; API boundary stays canonical).
- `rust_decimal` default serde already renders strings (`"50.00"`, proven by
  test); the `rust_decimal::serde::str` path does not exist in 1.43 (private
  module), so no `with` attribute and no Cargo change was needed.

## Review budget — PR2

- Authored: ~1040 changed lines (two new files incl. required TDD tests + 3
  tracked-line module declarations). Over the 400 budget; the overage is
  required contract tests + DB-gated integration tests that cannot be cut
  without violating the work-unit contract → recommend `size:exception` for
  the PR2 review slice (same treatment as PR1's 734-count exception).

## Prior batch (PR1-infra, preserved)

## Work unit
- Unit: PR1-infra (Foundation & Migration). Tasks 1.1–1.6.
- Mode: Standard with TDD discipline (tests written first, RED observed, then GREEN).
  Strict TDD mode NOT claimed: repo init recorded `strict_tdd:false` (no workspace
  runner); no live Postgres available, so DB-backed paths are DB-gated (skip
  without `DATABASE_URL`) and the trigger test is a file-content regression test.
- Chain: stacked-to-main per session preflight. This batch is one autonomous slice.
- Status: 6/6 PR1 tasks complete. PR2–PR4 explicitly NOT started.

## TDD Cycle Evidence (RED → GREEN) — PR1

| Task | RED (failing test first) | GREEN (implementation) | REFACTOR |
|------|--------------------------|------------------------|----------|
| 1.4 `require_user_id` 401s | 3 tests failed on `todo!()` panic (`missing_header_is_401`, `wrong_scheme_is_401`, `empty_bearer_token_is_401`); 3 DB-backed tests SKIP-printed (no `DATABASE_URL`) | `auth/helper.rs` bearer→hash→session lookup; 401 on miss, 500 on DB error | `#[allow(dead_code)]` w/ justification (wired in PR2); `cargo fmt` on new files |
| Money parse (orchestrator-required, supports 2.4) | 5 tests failed on `todo!()` panic (accept ×2, reject zero/neg, scale>2, non-numeric) | `finance/money.rs::parse_money_amount` (>0, scale ≤2, else 422) | Same `allow(dead_code)` treatment |
| 1.5/1.6 trigger neutralization | Migration test file failed (0005 missing) | `0005_fix_transfer_trigger.sql` transfer branches → no-op | Churn-free: reverted `cargo fmt` drift in 10 unrelated files |

RED run: 34 passed, 8 failed. GREEN run: 42 unit + 5 integration passed, 0 failed.

## Work Unit Evidence — PR1

| Evidence | Value |
|----------|-------|
| Focused test command and exact result | `cargo test` (backend/): 42 unit passed + 5 integration passed, 0 failed |
| Runtime harness command/scenario and exact result | N/A — no runtime boundary exists in this slice (no routes, no server behavior change; DB-gated session tests SKIP without `DATABASE_URL`, verified via `--nocapture`: 3× `SKIP ... no DATABASE_URL`) |
| Rollback boundary | Exact files removable without unrelated work: `backend/migrations/0005_fix_transfer_trigger.sql`, `backend/src/auth/helper.rs`, `backend/src/finance/`, `backend/tests/migration_0005_transfer_trigger.rs`; revertible one-liners in `backend/Cargo.toml` (rust_decimal + `rust_decimal` sqlx feature), `backend/src/auth/mod.rs`, `backend/src/main.rs`. `Cargo.lock` regenerates via `cargo build`. |

Additional gates: `cargo clippy --all-targets -- -D warnings` clean (after justified
`allow(dead_code)` on the two PR2-consumer functions, matching the existing
`error.rs` precedent).

## Files Changed — PR1

| File | Action | What was done |
|------|--------|---------------|
| `backend/migrations/0005_fix_transfer_trigger.sql` | Created (52 lines) | `CREATE OR REPLACE apply_transaction_to_balance()`; transfer INSERT/DELETE branches are no-ops; income/expense/credit-card paths identical to 0002; 0002 untouched |
| `backend/src/auth/helper.rs` | Created (174 lines) | `require_user_id(&HeaderMap, &PgPool) -> Result<Uuid, AppError>` reusing `middleware::extract_bearer`/`bearer_hash`; 401 on missing/malformed/unknown/expired/revoked, `Internal` on DB error; 6 tests (3 pure + 3 DB-gated) |
| `backend/src/auth/mod.rs` | Modified (+1) | Export `helper` module |
| `backend/src/finance/mod.rs` + `money.rs` | Created (6 + 73 lines) | `parse_money_amount(&str) -> Result<Decimal, AppError>`; rejects empty/non-numeric/`<=0`/`scale>2` with 422; 5 tests |
| `backend/src/main.rs` | Modified (+1) | Register `mod finance` |
| `backend/Cargo.toml` | Modified | `rust_decimal` (+`serde`); sqlx feature `rust_decimal` (note: sqlx 0.8 renamed the old `decimal` feature — `decimal` does not resolve) |
| `backend/Cargo.lock` | Regenerated | New dependency closure (generated, excluded from authored count) |
| `backend/tests/migration_0005_transfer_trigger.rs` | Created (97 lines) | 5 file-content regression tests: transfer branches contain no `UPDATE`, income/expense/card paths preserved, function-only (no `CREATE TRIGGER`), 0002 still holds original logic |
| `openspec/changes/p2-finance-core/tasks.md` | Modified | Phase 1 tasks 1.1–1.6 marked `[x]` |

## Decisions / deviations — PR1

- `finance/money.rs` is not listed in tasks.md Phase 1, but the orchestrator work
  unit explicitly required the money string-parse test in PR1; the module is the
  minimal home for it and front-loads spec rule "reject `<=0`, `scale>2` → 422".
- DB-backed helper tests (unknown/expired/valid session) skip honestly without
  `DATABASE_URL` instead of failing; pure 401 paths (missing/wrong-scheme/empty)
  run everywhere via a never-connecting lazy pool.
- Trigger test is file-content rather than live-DB (no Postgres in this
  environment); live transfer-balance behavior test belongs to PR3 per tasks.md 3.3.

## Review budget — PR1

- Authored: ~408 changed lines (402 new-file lines + ~6 tracked-line edits;
  `Cargo.lock` excluded as generated). Marginally over the 400 budget; the
  overage is required TDD tests that cannot be cut without violating the
  work-unit contract → recommend `size:exception` for the PR1 review slice, or
  orchestrator trims descriptive comments. No further cohesive split exists
  inside PR1 (migration + helper + money are each already minimal).

## Remaining

- PR4 (Budgets + Wiring) — untouched.
- Next recommended: `sdd-apply` PR4 slice, then verify.
