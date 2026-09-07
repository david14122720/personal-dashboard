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
