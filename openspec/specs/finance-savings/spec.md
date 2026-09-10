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

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/savings-write/spec.md (alias draft resolved to wire names) -->

### Requirement: Savings Goal Patch Endpoint

The system MUST expose `PATCH /savings-goals/{id}` with `deny_unknown_fields` and allowlist exactly `name, description, target_amount, target_date, category_id, color`. The system MUST never accept `saved_amount, is_completed, completed_at` (trigger-owned) — attempts MUST yield 422. Amounts MUST be decimal strings. The system MUST set `updated_at = now()` and return 200 on success.

#### Scenario: Happy-path edit meta

- GIVEN an authenticated user owning goal `{id}` with name `"Viaje"`
- WHEN `PATCH /savings-goals/{id}` with `{"name": "Viaje playa", "target_amount": "2000000.00"}`
- THEN the system returns 200 with the new name and target

#### Scenario: Trigger-owned field rejected

- GIVEN an authenticated user owning goal `{id}`
- WHEN `PATCH /savings-goals/{id}` with `{"saved_amount": "999.00"}`
- THEN the system returns 422 with a Spanish error

#### Scenario: Duplicate name conflicts

- GIVEN a user with goals `"A"` and `"B"`
- WHEN `PATCH /savings-goals/{B}` with `{"name": "A"}`
- THEN the system returns 409 with a Spanish error

### Requirement: Savings Goal Patch Validation

The system MUST validate `target_amount > 0` as string, `target_date` as `YYYY-MM-DD`, and `category_id` as an owned finance-kind category; violations MUST return 422 with Spanish messages. Constraint violations MUST map `23505→409`, `23514/23503→422`.

#### Scenario: Invalid target rejected

- GIVEN an authenticated user owning goal `{id}`
- WHEN `PATCH /savings-goals/{id}` with `{"target_amount": "0.00"}`
- THEN the system returns 422

### Requirement: Savings Movements Write Preserved

The system MUST keep movements append-only: abonar/retirar via `POST /savings-goals/{id}/movements` with signed string amount, and correction exclusively via `DELETE /savings-goals/{id}/movements/{mid}` + recreate. No `PATCH` for movements SHALL exist. Over-withdrawal (resulting balance < 0) MUST return 422. DELETE MUST return 204 and the trigger MUST revert `saved_amount`/`is_completed`.

#### Scenario: Deposit and withdraw

- GIVEN a goal with balance `"100.00"`
- WHEN `POST .../movements` with `{"amount": "50.00"}` then `{"amount": "-30.00"}`
- THEN responses are 201 and balance becomes `"120.00"`

#### Scenario: Correct movement via delete plus recreate

- GIVEN a movement `{mid}` of `"+50.00"` recorded by mistake
- WHEN `DELETE .../movements/{mid}` then `POST .../movements` with `{"amount": "80.00"}`
- THEN the first returns 204 with balance reverted and the second returns 201

#### Scenario: Over-withdrawal rejected

- GIVEN a goal with balance `"100.00"`
- WHEN `POST .../movements` with `{"amount": "-150.00"}`
- THEN the system returns 422 with a Spanish error

### Requirement: Savings Goal Delete

The system MUST support deleting a goal (existing behavior) returning 204.

#### Scenario: Happy-path goal delete

- GIVEN an authenticated user owning goal `{id}`
- WHEN `DELETE /savings-goals/{id}`
- THEN the system returns 204

### Requirement: Savings Write Auth and Ownership

The system MUST require authentication (401 unauthenticated, Spanish). Foreign goal access MUST return 404 for PATCH/DELETE/movements (never 403); non-existent goal movement targets MUST return 422 per existing movement contract.

#### Scenario: Foreign goal patch reads as not found

- GIVEN an authenticated user
- WHEN `PATCH /savings-goals/{foreign_id}` with a valid body
- THEN the system returns 404

### Requirement: Savings Forms

The FE MUST provide manual Spanish forms: abonar/retirar (signed POST), editar meta (PATCH allowlist), eliminar (with confirmation). Category and goal selectors MUST be by name, never UUID input. Amounts MUST use shared manual-amount normalization and travel as strings; currency is always COP. Mutations MUST refresh the `finance/` SWR scope. All copy MUST come from `finance.*` i18n keys.

#### Scenario: User deposits from UI

- GIVEN a user viewing goal `"Viaje"`
- WHEN they submit an abono of `"50000"` in the savings form
- THEN the FE sends `POST .../movements` with amount as string and shows the updated saved/target progress

#### Scenario: User edits goal meta from UI

- GIVEN a user viewing goal `"Viaje"`
- WHEN they rename it and submit
- THEN the FE sends `PATCH /savings-goals/{id}` with only allowlisted fields
