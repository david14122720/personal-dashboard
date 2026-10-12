# Judgment ledger — movements ledger (round 1, blind dual)

## Target (frozen)
- File: `backend/src/routes/movements.rs` (~1225 lines, new, uncommitted worktree on HEAD `d22a220`)
- Scope: handlers create/list/get/patch/delete, lock-first transactions, delta-reversal, 404-vs-422 matrix
- Intent context: `openspec/changes/finance-simplify-movements/specs/finance-movements/spec.md` + `design.md` (Judge A read; Judge B judged without them — wrong relative path supplied — yet converged independently)
- Skills passed to both judges + fix actor: `next-best-practices`, `vercel-react-best-practices` N/A (backend-only target — only rust + postgres passed), actually: rust-best-practices + postgresql-database-engineering

## Judges (blind, parallel, identical scope)
- jd-judge-a: COMPLETED — 1 CRITICAL (inferential, introduced) + 1 WARNING (inferential, introduced)
- jd-judge-b: COMPLETED — 1 CRITICAL (deterministic, introduced) + 1 WARNING (deterministic, introduced)

## Findings (merged)
- CONFIRMED-1 CRITICAL (both judges): concurrent PATCH on the SAME movement reverses a stale snapshot. Old direction/amount/account read outside the tx (`:321-330`, autocommit pool, `GET_MOVEMENT_SQL` without `FOR UPDATE`), never re-read under the account lock (`:362-418`); deltas computed from `old_response`; UPDATE has no snapshot guard. Two serialized PATCHes drift the balance (A: +15000 drift example; B: 140 vs correct 125). Account-move variant restores the wrong account. Violates spec "reverse the old signed delta" + serialize-against-what-first-left-behind.
- INFO-1 WARNING (both judges, stays info per skill): DELETE locks movement→account, PATCH locks account→movement — opposing order can deadlock (40P01 unhandled → 500) or hit RowNotFound → spurious 500. Data stays consistent (rollback). NOT auto-fixed.
- Suspect: NONE. Contradictions: NONE.

## Fix round 1 (executed, owner-authorized "Corregir ahora")
- Actor: jd-fix-agent. Only file touched: `backend/src/routes/movements.rs` (rollback boundary = that file).
- Change: movement row re-read `FOR UPDATE` after ascending account locks, deltas from locked row, account-drift → rollback + refreshed retry (≤5, then clean 500), deleted-while-waiting → 404. DELETE path untouched.
- Proof: 2 new DB-gated tests red-before (75000 vs 60000; row re-pointed to stale account) → green-after (`cargo test --locked movements`: 30 passed, 0 failed). Full suite: only known notes-FTS flake (isolated green).
- Unit message (uncommitted): `fix(movements): reverse PATCH deltas from the movement row re-read under the account lock`

## Scoped re-judgment (round 1, ledger + delta only)
- jd-judge-a: `{"findings":[]}` — re-read placement (402-407 after locks 386-398, before first write 447), money math from locked row only, snapshot used solely for lock set + drift compare, retry bound with rollback-before-continue, no fix-caused deadlock (PATCH↔PATCH order identical; only pre-existing INFO-1 pair remains).
- jd-judge-b: `{"findings":[]}` — no stale-snapshot money path remains; exhaustion → Internal with tx rolled back.
- Fix-caused severe defects: NONE (both judges).

## Verdict (terminal)
- round: 1 | confirmed: [] (CONFIRMED-1 fixed + re-judged clean) | suspect: [] | contradictions: [] | info: [INFO-1 lock-order WARNING — intentional, data-safe by rollback] | fix_work_units: [locked re-read + 2 regression tests] | scoped_rejudgment: approved | terminal_state: approved | skill_resolution: paths-injected
- JUDGMENT: APPROVED ✅ (one fix round used of two; one re-judgment used of two)
- Follow-up (not a judgment finding, reported by fix actor): `backend/tests/migration_0013_gate.rs` 4/7 fail — pre-existing drift: archive moved the change folder to `openspec/changes/archive/2026-09-24-finance-simplify-movements/` but the test hardcodes the pre-archive path. Tracked below; fix holds regardless.
- Follow-up RESOLVED by orchestrator (mechanical, 2026-09-24): updated the hardcoded staged path to the archive location (1 line); `cargo test --locked --test migration_0013_gate` → 7 passed, 0 failed (live catalog tests SKIP without DATABASE_URL; file/token/gate-order tests green). No commit.
