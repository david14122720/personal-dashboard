# Proposal: p4-habits-productivity

## Intent

Introduce productivity tracking (habits, goals, tasks, events, notes) to the personal dashboard. This change implements the core logic for habits/streaks, goal tracking with automated progress, task management, calendar events with cross-domain ownership, and searchable notes.

## Scope

### In Scope
- **Habits**: CRUD + log writes; on-demand streak computation (neutral `skipped`, breaking `missed`).
- **Goals**: CRUD + auto-derived progress based on linked tasks (via NEW trigger).
- **Tasks**: CRUD + views (today, upcoming, overdue, done); `completed_at` trigger-owned.
- **Events**: CRUD + range queries; 6-FK ownership matrix (ensure owner owns the linked entity).
- **Notes**: CRUD + pin + `plainto_tsquery` search on generated `search_tsv` (empty query returns all).
- **Database**: 2 new migrations:
    - `ALTER TYPE habit_log_status` to add `missed`.
    - New trigger + column logic to auto-derive `goals.progress` from `tasks`.

### Out of Scope
- Frontend implementation / Dashboard UI.
- Advanced search stemming (keeping `simple` dictionary).
----

## Capabilities

### New Capabilities
- `habits-management`: Habit CRUD and log tracking with on-demand streak calculation.
- `goal-tracking`: Goal CRUD with automated progress derivation from tasks.
- `task-management`: Task CRUD and status-based views (Today/Upcoming/Overdue/Done).
- `calendar-events`: Event CRUD with cross-domain foreign key ownership validation.
- `notes-search`: Note CRUD with pinning and full-text search via GIN index.

### Modified Capabilities
- None

## Approach

- **Streaks**: On-demand aggregate using window functions over `habit_logs`. `skipped` is neutral; `missed` breaks the streak. Honor `days_of_week` masks and `habit_frequency`.
- **Goal Progress**: Move `goals.progress` to trigger-owned state. A new `AFTER INSERT OR UPDATE OR DELETE` trigger on `tasks` will update the linked goal's progress percentage.
- **Ownership Matrix**: For `events`, validate that the `user_id` of the event matches the `user_id` of any provided FK (`habit_id`, `goal_id`, etc.). 404 for missing entities, 422 for ownership mismatch.
- **Notes Search**: Use `plainto_tsquery('simple', q)` on the generated `search_tsv` column. Order by `is_pinned DESC, updated_at DESC`. Empty search queries return all notes.
- **Error Mapping**: Reuse P2/P3 patterns: `23505` $\to$ 409, `23514`/`23503` $\to$ 422.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/` | New | `habits.rs`, `goals.rs`, `tasks.rs`, `events.rs`, `notes.rs` |
| `backend/src/routes/mod.rs` | Modified | Register new route modules |
| `backend/src/main.rs` | Modified | Wiring for P4 routes |
| `migrations/` | New | Additive enum alter and goal-progress trigger |
| `openspec/specs/` | New | New delta specs for each capability |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Performance of on-demand streaks | Low | Use `idx_habit_logs_habit_date`; monitor with `EXPLAIN ANALYZE`. |
| Review budget overflow | High | Split implementation into chained PRs (Habits $\to$ Goals $\to$ Tasks $\to$ Events $\to$ Notes). |
| Trigger complexity for progress | Medium | Keep trigger logic simple (count done tasks / total linked tasks). |

## Rollback Plan

- Revert migrations via standard `down` scripts (or additive migration removals).
- Revert code changes via Git.

## Dependencies

- P1-P3 core infrastructure (Auth, Finance, Database).

## Success Criteria

- [ ] Habits logs support `done`, `missed`, `skipped` states.
- [ ] Streaks are correctly calculated on-demand, ignoring `skipped` days.
- [ ] Goal progress updates automatically when linked tasks are completed.
- [ ] Events reject linked entities owned by other users.
- [ ] Notes search returns relevant results ordered by pin and date.
