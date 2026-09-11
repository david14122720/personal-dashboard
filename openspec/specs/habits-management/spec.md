# Habits Management Specification

## Purpose
Manage user habits and their daily logs, including on-demand streak calculation that handles neutral (skipped) and breaking (missed) states.

## Requirements

### Requirement: Habit CRUD
The system SHALL provide endpoints to create, read, update, and delete habits.
- Habits MUST belong to a `user_id`.
- Validations MUST ensure `habit_frequency` and `days_of_week` masks are consistent.

#### Scenario: Create Habit
- GIVEN an authenticated user
- WHEN they create a habit with valid frequency and mask
- THEN the system SHALL return 201 Created and the habit object

#### Scenario: Unauthorized Access
- GIVEN a habit owned by User A
- WHEN User B attempts to update it
- THEN the system MUST return 403 Forbidden

### Requirement: Habit Logging
The system SHALL allow users to log the status of a habit for a specific date.
- Status MUST be one of: `done`, `missed`, `skipped`.
- Only one log entry per habit per date is allowed.

#### Scenario: Log Daily Progress
- GIVEN a habit and a date
- WHEN the user logs status as `done`
- THEN the system SHALL return 200 OK and update the log

#### Scenario: Duplicate Log Entry
- GIVEN an existing log for a habit on a specific date
- WHEN the user attempts to create another log for the same date
- THEN the system MUST return 409 Conflict

### Requirement: On-Demand Streak Calculation
The system SHALL calculate the current streak for a habit based on `habit_logs`.
- `done`: Increments/maintains streak.
- `skipped`: Neutral; does not break streak, does not increment.
- `missed`: Breaks streak; resets to 0.
- Calculation MUST honor `days_of_week` mask (non-masked days are ignored).

#### Scenario: Healthy Streak
- GIVEN logs: [Day 1: done, Day 2: skipped, Day 3: done]
- WHEN requesting streak
- THEN the system SHALL return a streak of 2

#### Scenario: Broken Streak
- GIVEN logs: [Day 1: done, Day 2: missed, Day 3: done]
- WHEN requesting streak
- THEN the system SHALL return a streak of 1 (reset by missed)

#### Scenario: Masked Day
- GIVEN a habit masked only for weekdays
- WHEN a log exists for Saturday (skipped/done)
- THEN the system SHALL ignore the Saturday entry in streak computation

### Requirement: Today Status Read

The system MUST expose `GET /habits/today` returning the caller's habits with today's log state resolved in a single request. Each entry SHALL include `habit_id`, `name`, `habit_frequency`, `days_of_week`, `current_streak`, and `today_status` ∈ {`done`, `missed`, `skipped`, `pending`}. `pending` indicates no log yet for today on a scheduled day; non-scheduled days MAY be omitted or returned with `today_status: "skipped"`.

#### Scenario: Mixed today statuses

- GIVEN three habits: A (logged done today), B (logged missed today), C (scheduled today, no log)
- WHEN `GET /habits/today`
- THEN the response contains A with `today_status: "done"`, B with `"missed"`, C with `"pending"`
- AND each entry carries its `current_streak`

#### Scenario: No habits

- GIVEN a user with no habits
- WHEN `GET /habits/today`
- THEN the response is 200 with an empty array

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `GET /habits/today`
- THEN the system returns 401 with envelope `UNAUTHORIZED`

### Requirement: Range Logs Read

The system MUST expose `GET /habits/logs?from&to` returning the caller's habit logs
in a date range, multi-habit, in a single round-trip. `from` and `to` are REQUIRED
query params in `YYYY-MM-DD` format with `from <= to` and a range cap of 366 days.
Each entry SHALL include `habit_id`, `log_date`, and `status` where
`status ∈ {done, missed, skipped, not_done}` (`not_done` is legacy read-only and MUST
never be writable). Entries MUST be ordered by `(habit_id, log_date)` ascending.
The endpoint MUST return no aggregates. Unknown query fields MUST be rejected with
422 (`deny_unknown_fields`). The SQL MUST be `user_id`-scoped; a foreign `habit_id`
MUST yield 404 without disclosing existence. The query MUST reuse the existing
indexes `idx_habit_logs_user_date` / `idx_habit_logs_habit_date`, verified with
`EXPLAIN`. No migration is required; the range query MUST NOT widen `HabitRow`.

#### Scenario: Range returns multi-habit logs ordered

- GIVEN habits A and B with logs on 2026-09-01 (`done`) and 2026-09-03 (`missed`)
- WHEN `GET /habits/logs?from=2026-09-01&to=2026-09-30`
- THEN the response is 200 with entries ordered by `(habit_id, log_date)`
- AND each entry carries `habit_id`, `log_date`, and `status`

#### Scenario: Empty range

- GIVEN a user with no logs in the range
- WHEN `GET /habits/logs?from=2026-09-01&to=2026-09-30`
- THEN the response is 200 with an empty array

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `GET /habits/logs?from=2026-09-01&to=2026-09-30`
- THEN the system returns 401

#### Scenario: Invalid query rejected

- GIVEN any of: malformed date, `from > to`, range over 366 days, unknown field
- WHEN `GET /habits/logs` is called with that query
- THEN the system returns 422

#### Scenario: Foreign habit not disclosed

- GIVEN a `habit_id` owned by another user
- WHEN the caller requests a range covering it
- THEN those rows are absent and no existence signal leaks (404 semantics on direct access)

### Requirement: Habit History Calendar and Heatmap

The system MUST render a per-habit calendar with 4 states (cumplido / no cumplido /
omitido / sin registro) fed by `GET /habits/logs?from&to`, plus a real monthly
heatmap over the existing `HabitsHeatmap` grid. The fake `heatmapCells` derivation
MUST be removed once the real heatmap is green (no dual implementation). Data
fetching MUST use the SWR key `habits-history` with `revalidateOnFocus: false`.
Copy MUST be Spanish without guilt. The existing `#calendario-habitos` anchor MUST
resolve to this calendar.

#### Scenario: Calendar shows four states

- GIVEN logs `done`, `missed`, `skipped`, and a day with no log in range
- WHEN the history calendar renders
- THEN each day shows cumplido, no cumplido, omitido, or sin registro respectively

#### Scenario: Heatmap uses real logs

- GIVEN a month of range logs
- WHEN the heatmap renders
- THEN every cell derives from an actual log or absence thereof, never from streak math

#### Scenario: Empty history

- GIVEN no logs in the selected range
- WHEN the history view renders
- THEN a Spanish `EmptyState` appears without errors

### Requirement: Habit Period Stats

The system MUST compute period stats client-side with pure transforms
(`habitStats`, `complianceRate` pattern) over the fetched range: current streak
(existing), best streak, compliance %, and counts of done / missed / skipped /
unlogged. Stats MUST honor the `days_of_week` mask and the `skipped`-neutral /
`missed`-breaks semantics of On-Demand Streak Calculation; `not_done` MUST break
streak as legacy read-only. All strings MUST come from typed `t(key, vars)` ES keys.

#### Scenario: Stats from range

- GIVEN 10 scheduled days: 6 done, 1 missed, 1 skipped, 2 unlogged
- WHEN stats compute
- THEN done=6, missed=1, skipped=1, unlogged=2 and compliance reflects scheduled days

#### Scenario: Best streak survives a break

- GIVEN logs [done ×3, missed, done ×2]
- WHEN stats compute
- THEN best streak is 3 and current streak is 2

### Requirement: Habit Evolution and Compare

The system MUST render habit evolution over week / month / year granularities using
Recharts code-split with `next/dynamic(ssr:false)`, and MUST support multi-series
comparison across habits in the same chart. Charts MUST respect
`prefers-reduced-motion` and keyboard focus like all dashboard charts.

#### Scenario: Evolution renders per granularity

- GIVEN range logs spanning a year
- WHEN the user selects week, month, or year view
- THEN the chart aggregates accordingly without errors

#### Scenario: Multi-habit compare

- GIVEN two habits with logs in range
- WHEN compare is enabled
- THEN both series render labelled by habit name (never by technical id)
