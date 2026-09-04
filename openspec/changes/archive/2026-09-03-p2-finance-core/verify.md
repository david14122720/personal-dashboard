# Verify Report: p2-finance-core

- Change: `p2-finance-core`
- Mode: full artifacts (proposal + 4 specs + design + tasks)
- Date (UTC): 2026-09-04
- Re-verification of: prior FAIL (2 CRITICAL test-harness bugs, test-only remediation in commit `06c0724`)
- Verdict: **PASS**

## 1. Completeness (27/27 tasks [x] — all present in code)

| Phase | Tasks | Evidence |
|---|---|---|
| 1 Foundation | 1.1–1.6 | `auth/helper.rs`, `finance/money.rs`, `migrations/0005_fix_transfer_trigger.sql`, migration regression tests — present |
| 2 Ledger | 2.1–2.6 | `routes/accounts.rs`, `routes/transactions.rs` — present, wired |
| 3 Transfers | 3.1–3.4 | `routes/transfers.rs` (sorted-UUID `FOR UPDATE`, group id, cross-links, explicit balance updates, single txn + rollback) — present, wired |
| 4 Budgets | 4.1–4.5 | `routes/budgets.rs` (CRUD + status aggregate + threshold mapper) — present, wired |
| 5 Wiring | 5.1–5.3 | 8 routes registered in `main.rs`; reconciliation test remediated (transfer legs net symmetrically per account) |

Remediation under test (commit `06c0724`, test-only, no production code touched):
- CRITICAL-1 fixed: reconciliation query nets `transfer` legs symmetrically instead of `ELSE 0`.
- CRITICAL-2 fixed: fault-trigger DDL split into single statements (simple query protocol, no more 42601).

## 2. Static evidence

| Command | Result |
|---|---|
| `cargo test` (backend/, no `DATABASE_URL`) | 90 unit + 5 integration passed, 0 failed |
| `cargo clippy --all-targets -- -D warnings` | clean |
| `cargo build` | whole binary compiles; all 8 finance routes registered |
| `DATABASE_URL=<scratch> cargo test` (live PG 18.6) | **90 passed, 5 passed, 0 failed** |
| `DATABASE_URL=<scratch> cargo test -- --nocapture` grep | both remediated tests `ok`; **zero SKIP lines** |

## 3. Live evidence (scratch DB on Dokploy PG 18.6, migrations 0001–0005, real binary + HTTP)

Prod database was NOT mutated: scratch database created, exercised, dropped; prod data untouched. Connection identifiers are opaque (see Engram report); no secrets in this file.

| Capability | Reproduction | Result |
|---|---|---|
| Account create | `POST /accounts` bank | 201, balance 0 |
| Duplicate name | same name again | 409, no new row |
| Ownership | `GET` unknown id | 404 |
| Income/expense + trigger | +100.00 / −30.00 | balance 70.00 |
| Amount validation | 0.00 | 422 |
| Transfer atomic | `POST /transfers` 20.00 A→B | 201, group id + 2 legs, balances 50.00/20.00 exact, no double-apply (0005 no-op confirmed) |
| Same-account transfer | A→A | 422, balances unchanged |
| Budget validation | inverted period | 422 |
| Status walk | spent 0 → 40 → 85 → 110 | ok (0.0) → ok (0.4) → warn (0.85, spent 85.00/remaining 15.00 — exact spec values) → over (1.1, pct 1.1, remaining −10.00) |
| Remediated tests live | `reconciliation_signed_sum_matches_cached_balance`, `rollback_on_second_leg_failure_leaves_no_orphans` | both `ok`, zero SKIP |

## 4. Spec compliance matrix (13 requirements / 24 scenarios, all 4 specs)

- finance-accounts (4 req / 5 scenarios): COMPLIANT (live + passing covering tests).
- finance-transactions (3 req / 7 scenarios): COMPLIANT (live + passing covering tests).
- finance-transfers Atomic Execution + Data Integrity: COMPLIANT — rollback scenario now has a passing covering test live (`rollback_on_second_leg_failure_leaves_no_orphans ... ok`).
- finance-budgets (3 req / 7 scenarios): COMPLIANT — reconciliation scenario now has a passing covering test live (`reconciliation_signed_sum_matches_cached_balance ... ok`); budget status walk reproduced exactly per spec values.

## 5. Design coherence

- Hybrid balance strategy: confirmed live (trigger moves income/expense; app txn moves transfers; 0005 neutralizes transfer branch; no double-apply observed).
- `require_user_id` on all handlers; foreign access → 404: confirmed live.
- Money-as-string, `Decimal`, ≤2dp → 422: confirmed live.
- Sorted-UUID `FOR UPDATE` + single txn commit/rollback: confirmed in code and live.
- Budget single-SUM aggregate + Rust threshold mapping (boundaries on upper tier): confirmed live.
- Deviation noted (pre-existing, accepted): transfer legs use `type='transfer'` rather than spec-literal income/expense legs; money direction encoded by debit/credit updates. Keeps transfers out of income/expense totals and the budget aggregate. No spec break observed.

## 6. Issues

### CRITICAL

None. Both prior CRITICALs are resolved by commit `06c0724` and proven by live execution (zero SKIP, both `ok`).

### WARNING

- **WARNING-1 — Live prod DB still runs the pre-0005 trigger** (two-legged counterparty logic). Migration 0005 is additive (`CREATE OR REPLACE`, income/expense/card paths identical) and must be deployed together with this code; until then, transfers executed against prod would double-apply/skip. Verify deliberately did not mutate prod.
- **WARNING-2 — DB-gated coverage has never run in CI-like conditions** (no `DATABASE_URL` in the apply environment). Both prior CRITICALs were SKIP-masking escapes. Recommend a verify-time live-DB gate for all future finance changes (same-network PG is reachable).

### SUGGESTION

- **SUGGESTION-1** — `PATCH /transactions/:id` core-field rejection surfaces as an Axum `JsonRejection` 422 before handler logic. Spec-compliant (422 or 403), but a handler-level 422 with the project's `VALIDATION_ERROR` envelope would be more consistent for API consumers.

## 7. Final verdict

**PASS** — all 27 tasks complete, all 24 spec scenarios compliant with passing covering tests executed live against PG 18.6 (95/95 green, zero SKIP), static gates clean, design coherent.

**Next recommended: archive** (sync delta specs, then settle). Do NOT remediate further; WARNING-1 (0005 deployment) is an orchestrator/archival concern.
