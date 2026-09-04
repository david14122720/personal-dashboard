# Apply Progress: p2-finance-core — PR1-infra

## Work unit
- Unit: PR1-infra (Foundation & Migration). Tasks 1.1–1.6.
- Mode: Standard with TDD discipline (tests written first, RED observed, then GREEN).
  Strict TDD mode NOT claimed: repo init recorded `strict_tdd:false` (no workspace
  runner); no live Postgres available, so DB-backed paths are DB-gated (skip
  without `DATABASE_URL`) and the trigger test is a file-content regression test.
- Chain: stacked-to-main per session preflight. This batch is one autonomous slice.
- Status: 6/6 PR1 tasks complete. PR2–PR4 explicitly NOT started.

## TDD Cycle Evidence (RED → GREEN)

| Task | RED (failing test first) | GREEN (implementation) | REFACTOR |
|------|--------------------------|------------------------|----------|
| 1.4 `require_user_id` 401s | 3 tests failed on `todo!()` panic (`missing_header_is_401`, `wrong_scheme_is_401`, `empty_bearer_token_is_401`); 3 DB-backed tests SKIP-printed (no `DATABASE_URL`) | `auth/helper.rs` bearer→hash→session lookup; 401 on miss, 500 on DB error | `#[allow(dead_code)]` w/ justification (wired in PR2); `cargo fmt` on new files |
| Money parse (orchestrator-required, supports 2.4) | 5 tests failed on `todo!()` panic (accept ×2, reject zero/neg, scale>2, non-numeric) | `finance/money.rs::parse_money_amount` (>0, scale ≤2, else 422) | Same `allow(dead_code)` treatment |
| 1.5/1.6 trigger neutralization | Migration test file failed (0005 missing) | `0005_fix_transfer_trigger.sql` transfer branches → no-op | Churn-free: reverted `cargo fmt` drift in 10 unrelated files |

RED run: 34 passed, 8 failed. GREEN run: 42 unit + 5 integration passed, 0 failed.

## Work Unit Evidence

| Evidence | Value |
|----------|-------|
| Focused test command and exact result | `cargo test` (backend/): 42 unit passed + 5 integration passed, 0 failed |
| Runtime harness command/scenario and exact result | N/A — no runtime boundary exists in this slice (no routes, no server behavior change; DB-gated session tests SKIP without `DATABASE_URL`, verified via `--nocapture`: 3× `SKIP ... no DATABASE_URL`) |
| Rollback boundary | Exact files removable without unrelated work: `backend/migrations/0005_fix_transfer_trigger.sql`, `backend/src/auth/helper.rs`, `backend/src/finance/`, `backend/tests/migration_0005_transfer_trigger.rs`; revertible one-liners in `backend/Cargo.toml` (rust_decimal + `rust_decimal` sqlx feature), `backend/src/auth/mod.rs`, `backend/src/main.rs`. `Cargo.lock` regenerates via `cargo build`. |

Additional gates: `cargo clippy --all-targets -- -D warnings` clean (after justified
`allow(dead_code)` on the two PR2-consumer functions, matching the existing
`error.rs` precedent).

## Files Changed

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

## Decisions / deviations
- `finance/money.rs` is not listed in tasks.md Phase 1, but the orchestrator work
  unit explicitly required the money string-parse test in PR1; the module is the
  minimal home for it and front-loads spec rule "reject `<=0`, `scale>2` → 422".
- DB-backed helper tests (unknown/expired/valid session) skip honestly without
  `DATABASE_URL` instead of failing; pure 401 paths (missing/wrong-scheme/empty)
  run everywhere via a never-connecting lazy pool.
- Trigger test is file-content rather than live-DB (no Postgres in this
  environment); live transfer-balance behavior test belongs to PR3 per tasks.md 3.3.

## Review budget
- Authored: ~408 changed lines (402 new-file lines + ~6 tracked-line edits;
  `Cargo.lock` excluded as generated). Marginally over the 400 budget; the
  overage is required TDD tests that cannot be cut without violating the
  work-unit contract → recommend `size:exception` for the PR1 review slice, or
  orchestrator trims descriptive comments. No further cohesive split exists
  inside PR1 (migration + helper + money are each already minimal).

## Remaining
- PR2 (Ledger), PR3 (Transfers), PR4 (Budgets + Wiring) — untouched.
- Next recommended: `sdd-apply` PR2 slice, then verify.
