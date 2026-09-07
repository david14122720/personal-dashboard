# Task Management Specification

## Purpose
Manage individual tasks linked to goals, providing specialized views for productivity.

## Requirements

### Requirement: Task CRUD
The system SHALL provide endpoints to create, read, update, and delete tasks.
- Tasks MUST belong to a `user_id`.
- Tasks MAY be linked to a `goal_id`.

#### Scenario: Link Task to Goal
- GIVEN a goal owned by the user
- WHEN creating a task linked to that `goal_id`
- THEN the system SHALL return 201 Created

#### Scenario: Invalid Goal Link
- GIVEN a `goal_id` that does not exist
- WHEN creating a task linked to it
- THEN the system MUST return 422 Unprocessable Entity (FK violation)

### Requirement: Status-Based Views
The system SHALL provide filtered views of tasks based on `due_date` and `completed_at`.

#### Scenario: Today's View
- GIVEN tasks with various due dates
- WHEN requesting "today" view
- THEN the system SHALL return tasks where `due_date` is today AND `completed_at` is NULL

#### Scenario: Overdue View
- GIVEN tasks with past due dates
- WHEN requesting "overdue" view
- THEN the system SHALL return tasks where `due_date` < today AND `completed_at` is NULL

#### Scenario: Done View
- GIVEN completed tasks
- WHEN requesting "done" view
- THEN the system SHALL return tasks where `completed_at` is NOT NULL

### Requirement: Completion Tracking
The system SHALL record the exact timestamp when a task is completed.

#### Scenario: Mark Task Done
- GIVEN a pending task
- WHEN updating status to completed
- THEN the system SHALL set `completed_at` to the current timestamp
