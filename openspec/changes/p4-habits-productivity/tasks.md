# Tasks: p4-habits-productivity

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1800 - 2200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 $\to$ PR 2 $\to$ PR 3 $\to$ PR 4 $\to$ PR 5 $\to$ PR 6 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Foundation & Habits | PR 1 | `cargo test tests/habits_integration` | `POST /habits/:id/logs` $\to$ `GET /habits/:id/streak` | `backend/migrations/0006`, `backend/src/routes/habits.rs` |
| 2 | Goal Tracking | PR 2 | `cargo test tests/goals_integration` | `POST /goals` $\to$ `GET /goals/:id` | `backend/src/routes/goals.rs` |
| 3 | Task Management | PR 3 | `cargo test tests/tasks_integration` | `POST /tasks` $\to$ `GET /tasks?view=today` | `backend/migrations/0007`, `backend/src/routes/tasks.rs` |
| 4 | Calendar Events | PR 4 | `cargo test tests/events_integration` | `POST /events` (cross-user FK) $\to$ 422 | `backend/src/routes/events.rs` |
| 5 | Searchable Notes | PR 5 | `cargo test tests/notes_integration` | `GET /notes/search?q=...` $\to$ pin-order | `backend/src/routes/notes.rs` |
| 6 | Routing & Wiring | PR 6 | `cargo test tests/integration/wiring` | `GET /habits` (smoke test) | `backend/src/routes/mod.rs`, `backend/src/main.rs` |

## Phase 1: Foundation & Infrastructure

- [x] 1.1 Create `backend/migrations/0006_habit_log_missed.sql` with `ALTER TYPE habit_log_status ADD VALUE 'missed'` (no txn block)
- [x] 1.2 Create `backend/migrations/0007_goal_progress_trigger.sql` with `recalc_goal_progress()` function and trigger
- [x] 1.3 Create `backend/tests/migration_0007_goal_progress.rs` to verify `goals.progress` auto-updates on task completion (RED $\to$ GREEN)

## Phase 2: Habits Implementation (Slice 1)

- [x] 2.1 Create `backend/src/routes/habits.rs` with CRUD for habits and logs
- [x] 2.2 Implement on-demand streak SQL in `backend/src/routes/habits.rs` using design's gaps-and-islands query
- [x] 2.3 Write integration tests for Habits:
    - [x] 2.3.1 RED: Streak breaks on `missed` or `not_done` status
    - [x] 2.3.2 RED: Streak ignores `skipped` days
    - [x] 2.3.3 GREEN: CRUD operations and log duplication (409)
- [x] 2.4 Verify streak performance with `EXPLAIN (ANALYZE, BUFFERS)`

## Phase 3: Goals Implementation (Slice 2)

- [x] 3.1 Create `backend/src/routes/goals.rs` with CRUD for goals
- [x] 3.2 Implement read-only access to `progress` (reject updates via `deny_unknown_fields`)
- [x] 3.3 Write integration tests for Goals:
    - [x] 3.3.1 GREEN: Goal CRUD and user-scoping
    - [x] 3.3.2 GREEN: Verify `progress` is read-only

## Phase 4: Tasks Implementation (Slice 3)

- [x] 4.1 Create `backend/src/routes/tasks.rs` with CRUD for tasks
- [x] 4.2 Implement view filters in `GET /tasks`: `today`, `upcoming`, `overdue`, `done`
- [x] 4.3 Implement `completed_at` timestamp logic on task completion
- [x] 4.4 Write integration tests for Tasks:
    - [x] 4.4.1 RED: Goal progress updates from 0% $\to$ 100% $\to$ 0% via task changes
    - [x] 4.4.2 GREEN: Filter views return correct subsets
    - [x] 4.4.3 GREEN: Foreign goal link returns 404

## Phase 5: Events Implementation (Slice 4)

- [x] 5.1 Create `backend/src/routes/events.rs` with CRUD and range queries (`from`/`to`)
- [x] 5.2 Implement ownership matrix probes for the 6-FKs (Habit, Goal, Task, Event, Note, User)
- [x] 5.3 Write integration tests for Events:
    - [x] 5.3.1 RED: Linked entity owned by other user returns 422
    - [x] 5.3.2 RED: Non-existent linked entity returns 404
    - [x] 5.3.3 GREEN: Date range queries filter correctly

## Phase 6: Notes Implementation (Slice 5)

- [ ] 6.1 Create `backend/src/routes/notes.rs` with CRUD and pin toggle
- [ ] 6.2 Implement FTS search using `plainto_tsquery('simple', q) @@ search_tsv`
- [ ] 6.3 Write integration tests for Notes:
    - [ ] 6.3.1 RED: Search results ordered by `is_pinned DESC, updated_at DESC`
    - [ ] 6.3.2 RED: Blank search query returns all notes
    - [ ] 6.3.3 GREEN: Body size limit ($\le$ 1 MiB) returns 422
- [ ] 6.4 Verify FTS performance with `EXPLAIN (ANALYZE, BUFFERS)`

## Phase 7: Wiring & Cleanup

- [ ] 7.1 Register all 5 new modules in `backend/src/routes/mod.rs`
- [ ] 7.2 Wire routes in `backend/src/main.rs`
- [ ] 7.3 Run full integration suite to verify cross-domain ownership and triggers
- [ ] 7.4 Final `cargo clippy --all-targets -- -D warnings`
