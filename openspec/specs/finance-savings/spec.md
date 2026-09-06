# finance-savings Specification

## Purpose

Management of financial savings goals and the tracked movements (deposits and withdrawals) that contribute to those goals.

## Requirements

### Requirement: Savings Goal Management

The system MUST allow users to create, read, and delete savings goals.

#### Scenario: Create Goal
- GIVEN an authenticated user
- WHEN the user creates a goal with a name and a target amount
- THEN the system SHALL create the goal and initialize its current balance to 0
- AND return 201 Created

#### Scenario: Access Other User's Goal
- GIVEN an authenticated user
- WHEN the user attempts to retrieve a goal ID belonging to another user
- THEN the system MUST return 404 Not Found

### Requirement: Savings Movements

The system MUST allow tracking of signed monetary movements against a goal.

#### Scenario: Deposit Movement
- GIVEN a savings goal with current balance 100.00
- WHEN the user records a movement of +50.00
- THEN the system SHALL record the movement
- AND the goal's current balance MUST be updated to 150.00 via trigger
- AND return 201 Created

#### Scenario: Withdrawal Movement
- GIVEN a savings goal with current balance 100.00
- WHEN the user records a movement of -30.00
- THEN the system SHALL record the movement
- AND the goal's current balance MUST be updated to 70.00 via trigger
- AND return 201 Created

#### Scenario: Invalid Money Format
- GIVEN an authenticated user
- WHEN the user submits a movement with an invalid amount string (e.g., "abc")
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Goal Completion State

The system MUST automatically track if a goal is completed based on its balance.

#### Scenario: Goal Completion Trigger
- GIVEN a goal with target 100.00 and current balance 90.00
- WHEN a movement of +10.00 is recorded
- THEN the system MUST set `is_completed` to true automatically
- AND the response MUST reflect the updated state

### Requirement: Data Integrity

The system MUST ensure consistency between movements and goals.

#### Scenario: Orphaned Movement Prevention
- GIVEN an authenticated user
- WHEN the user attempts to record a movement for a non-existent goal ID
- THEN the system MUST return 422 Unprocessable Entity (FK violation)
