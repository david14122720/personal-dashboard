## Exploration: p4-habits-productivity

### Current State
Migration `0004_habits_goals_tasks_calendar_notes.sql` creates five tables (`habits`, `habit_logs`, `goals`, `tasks`, `events`, `notes` — six incl. logs) with enums pre-declared in `0001` (`habit_direction`, `habit_frequency`, `habit_log_status`, `goal_status`, `task_priority`, `task_status`, `event_kind`). No route modules exist yet (`backend/src/routes/mod.rs` has 13 finance/auth/health modules only; P4 wiring lands in Phase 6 `main.rs`). The ONLY trigger-derived state in P4 scope is `tasks.completed_at` (`set_task_completed_at`, BEFORE UPDATE), plus `set_updated_at()` on all six tables and the `notes.search_tsv` GENERATED column. There are NO aggregate triggers (unlike P3 savings/debts): no streak column, no goal-progress derivation. P2/P3 conventions to reuse: `require_user_id` (401), every query scoped by `user_id`, detail/delete `id+user_id` → 404, orphaned-child writes → 422 via unscoped exists probe, string DTOs with boundary parsing → 422, `deny_unknown_fields` + no PATCH, `23505` → 409 / `23514`/`23503` → 422, kind-checked category helpers (`ensure_*_category` → 422).

### Affected Areas
- `backend/src/routes/habits.rs` (new) — habits CRUD + `habit_logs` writes; `UNIQUE(user_id,name)` → 409; `UNIQUE(habit_id,log_date)` → 409; `days_of_week` mask validation; `target_per_period`/`count_value` NUMERIC(8,2) string DTOs; category kind `habit` → 422
- `backend/src/routes/goals.rs` (new) — goals CRUD; no unique constraint (no 409); `progress` 0–100 CHECK → 422; category kind `goal` → 422
- `backend/src/routes/tasks.rs` (new) — tasks CRUD + today/upcoming/overdue/done views; `completed_at` trigger-owned never writable; `goal_id` link needs owned-goal check (404 foreign / 422 orphaned, mirroring savings/debts); category kind `task` → 422
- `backend/src/routes/events.rs` (new) — events CRUD + range query; `ends_at >= starts_at` guard → 422; six nullable cross-domain FKs (`habit_id`, `goal_id`, `task_id`, `debt_id`, `subscription_id`, `reminder_id`) each needing ownership checks
- `backend/src/routes/notes.rs` (new) — notes CRUD + pin + full-text search via generated `search_tsv` (`simple` dict, GIN); `search_tsv` never writable
- `backend/src/routes/mod.rs`, `backend/src/main.rs` — module registration + Phase 6 wiring
- `openspec/specs/` — new delta specs (no `habits-*`/`productivity-*` specs exist; `finance-savings`/`finance-debts` are pattern references only)

### Approaches
1. **Streak computation: on-demand aggregate** — compute streaks at read time with a single per-habit SQL query (window-function gaps-and-islands over `habit_logs` where `status='done'`, using `idx_habit_logs_habit_date`; `skipped` = neutral, `not_done` = breaks streak)
   - Pros: no schema change; no new migration; single source of truth; consistent with "trigger-derived state never writable" (nothing to write)
   - Cons: O(logs) scan per request; needs `generate_series` for gap handling on sparse histories
   - Effort: Medium

2. **Streak computation: trigger-maintained column** — add `current_streak`/`longest_streak` to `habits` via a new migration + AFTER INSERT/DELETE trigger on `habit_logs` (P3 savings/debts precedent)
   - Pros: O(1) reads; matches P3 derived-state pattern
   - Cons: new migration required; backfill needed; streak semantics (skip handling, weekly cadences, `days_of_week` mask) baked into PL/pgSQL — hard to evolve; trigger columns become never-writable DTO surface
   - Effort: High

3. **Task views: single list endpoint with query filters** — `GET /tasks?view=today|upcoming|overdue|done` (or `status`/`due_before`/`due_after` params) served by existing `idx_tasks_user_status` + partial `idx_tasks_user_due`
   - Pros: one handler, index-covered; no route explosion; mirrors list/get/delete-only P2/P3 shape
   - Cons: query-param validation surface (unknown view → 422); slightly more complex handler
   - Effort: Low

4. **Goal progress: manual 0–100 (P4 scope)** — keep `progress` user-writable with CHECK-guard → 422; do NOT auto-derive from linked `tasks.goal_id`
   - Pros: zero trigger work; matches migration as-is; unblocks P4
   - Cons: progress can drift from linked-task reality; future auto-derive needs a migration + trigger
   - Effort: Low

### Recommendation
Ship P4 with on-demand streak aggregates (Approach 1), single filtered list endpoints for tasks (Approach 3) and events (`?from&to` range on `idx_events_user_starts`), manual goal progress (Approach 4), and notes search via `plainto_tsquery('simple', q)` + `ts_rank` ordering with pinned-first sort (`is_pinned DESC, updated_at DESC`). This needs no new migration, keeps every trigger/generated column read-only, and reuses all P2/P3 error-mapping and ownership-check patterns verbatim. Revisit trigger-maintained streaks only if streak reads prove slow (measure with `EXPLAIN ANALYZE` first).

### Risks
- **Enum mismatch: `missed` vs `not_done`** — the launch brief says log states are `done/missed/skipped`, but `habit_log_status` is `('done','skipped','not_done')`. Proposal MUST resolve: spec language `missed` maps to `not_done`, or a new migration alters the enum. Unknown enum values surface as pgcode `22P02`/`23522` — map to 422 at the boundary.
- **Streak semantics undefined** — `skipped` neutral vs breaking, weekly/monthly cadences, `days_of_week` mask (0=Sun..6=Sat, empty = every day), and reduce/quit habits (`status='done'` means "avoided", `count_value` vs `target_per_period`) all need proposal decisions before spec.
- **Cross-domain FK ownership fan-out on events** — six nullable FKs each need owned/foreign/orphaned resolution (404 vs 422); `category_id` kind policy for events is undefined (any-owned-kind vs fixed kind). Proposal must fix the matrix.
- **Scope size vs 400-line review budget** — five domains + logs + search in one change will exceed budget; plan chained/stacked PR slices per domain (habits → goals → tasks → events → notes).
- **Generated `search_tsv` uses the `simple` dictionary** — no stemming; prefix/typo tolerance needs `pg_trgm` or `unaccent` later. Empty `q` behavior (return-all vs 422) needs a proposal decision.

### Ready for Proposal
Yes — with three clarifications for the orchestrator to confirm with the user: (1) map spec language `missed` to enum `not_done` (no migration) vs alter the enum; (2) streak rules for `skipped` and non-daily cadences; (3) goal progress manual (P4) vs auto-derived from linked tasks (needs new migration, defer to P5).
