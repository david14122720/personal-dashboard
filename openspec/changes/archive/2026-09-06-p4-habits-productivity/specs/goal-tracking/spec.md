# Goal Tracking Specification

## Purpose
Manage high-level goals with automated progress tracking derived from linked tasks.

## Requirements

### Requirement: Goal CRUD
The system SHALL provide endpoints to create, read, update, and delete goals.
- Goals MUST belong to a `user_id`.

#### Scenario: Create Goal
- GIVEN an authenticated user
- WHEN they create a goal with a title and description
- THEN the system SHALL return 201 Created

### Requirement: Automated Progress Derivation
The system MUST automatically update `goals.progress` whenever linked tasks are modified.
- Progress = (Count of completed tasks / Total linked tasks) * 100.
- This MUST be handled via a database trigger to ensure consistency.

#### Scenario: Task Completion Updates Goal
- GIVEN a goal with 2 linked tasks (both pending)
- WHEN one task is marked as done
- THEN the system SHALL update the goal's progress to 50%

#### Scenario: Task Deletion Updates Goal
- GIVEN a goal with 1 completed task and 1 pending task (50%)
- WHEN the pending task is deleted
- THEN the system SHALL update the goal's progress to 100%

#### Scenario: No Tasks
- GIVEN a goal with no linked tasks
- WHEN querying progress
- THEN the system SHALL return 0%
