# Calendar Events Specification

## Purpose
Manage calendar events with strict ownership validation across multiple linked domains (Habits, Goals, Tasks, Notes).

## Requirements

### Requirement: Event CRUD
The system SHALL provide endpoints to create, read, update, and delete events.
- Events MUST have a `start_time` and `end_time`.
- Events MUST belong to a `user_id`.

#### Scenario: Create Range Event
- GIVEN valid start and end times
- WHEN creating an event
- THEN the system SHALL return 201 Created

### Requirement: Cross-Domain Ownership Matrix
The system MUST validate that the event owner is also the owner of any linked entity (`habit_id`, `goal_id`, `task_id`, `note_id`).

#### Scenario: Valid Ownership Link
- GIVEN an event and a goal both owned by User A
- WHEN linking the goal to the event
- THEN the system SHALL return 200 OK

#### Scenario: Ownership Mismatch
- GIVEN an event owned by User A and a goal owned by User B
- WHEN attempting to link the goal to the event
- THEN the system MUST return 422 Unprocessable Entity

#### Scenario: Missing Entity Link
- GIVEN a non-existent `task_id`
- WHEN linking it to an event
- THEN the system MUST return 404 Not Found

### Requirement: Range Queries
The system SHALL allow fetching events within a specific time range.

#### Scenario: Fetch Weekly Events
- GIVEN a start and end date for a week
- WHEN querying events in that range
- THEN the system SHALL return all events overlapping that period
