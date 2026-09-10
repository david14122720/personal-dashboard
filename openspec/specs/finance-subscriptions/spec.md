# finance-subscriptions Specification

## Purpose

Lifecycle management of recurring financial commitments (subscriptions), including tracking of costs and activation status.

## Requirements

### Requirement: Subscription Management

The system MUST allow users to create, read, and delete subscription records.

#### Scenario: Create Subscription
- GIVEN an authenticated user
- WHEN the user creates a subscription with a name, cost, and billing cycle
- THEN the system SHALL create the record and set status to `active`
- AND return 201 Created

#### Scenario: Create Free Subscription
- GIVEN an authenticated user
- WHEN the user creates a subscription with a cost of 0.00
- THEN the system SHALL accept the record (Free tiers supported)
- AND return 201 Created

#### Scenario: Invalid Cost Format
- GIVEN an authenticated user
- WHEN the user submits a subscription with an invalid cost string
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Lifecycle Management

The system MUST support activation and cancellation of subscriptions.

#### Scenario: Cancel Subscription
- GIVEN an active subscription
- WHEN the user marks it as cancelled
- THEN the system SHALL update the status to `cancelled`
- AND return 200 OK

#### Scenario: Reactivate Subscription
- GIVEN a cancelled subscription
- WHEN the user marks it as active
- THEN the system SHALL update the status to `active`
- AND return 200 OK

### Requirement: Category Scoping

The system MUST ensure subscriptions are linked to the correct category kind.

#### Scenario: Invalid Category Kind
- GIVEN an authenticated user
- WHEN the user creates a subscription linked to a category with kind `savings` (instead of `subscription`)
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Ownership & Security

The system MUST restrict access to the user's own subscriptions.

#### Scenario: Unauthorized Access
- GIVEN an authenticated user
- WHEN the user attempts to modify a subscription belonging to another user
- THEN the system MUST return 404 Not Found

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/subscriptions-write/spec.md (alias draft resolved to wire names) -->

### Requirement: Subscription Create Form

The FE MUST provide a manual Spanish create form (name, price as string, frequency, next_billing `YYYY-MM-DD`, category by name, payment method) sending `POST /subscriptions`. No new BE endpoint SHALL be created. All copy MUST come from `finance.*` i18n keys; currency is always COP.

#### Scenario: User creates subscription

- GIVEN an authenticated user in the subscriptions section
- WHEN they submit name `"Streaming"`, price `"19900"`, frequency mensual and next billing date
- THEN the FE sends `POST /subscriptions` with price as string and refreshes the `finance/` SWR scope

#### Scenario: Invalid price blocked with Spanish error

- GIVEN a user typing price `"abc"` in the subscription form
- WHEN they submit
- THEN the FE shows a Spanish validation error and sends no request

### Requirement: Subscription Cancel and Reactivate

The FE MUST expose cancelar/reactivar actions using the existing `PATCH /subscriptions/{id}` which accepts only `is_active` under `deny_unknown_fields`. Any other PATCH field MUST remain rejected with 422 by the BE.

#### Scenario: User cancels subscription

- GIVEN an active subscription `{id}`
- WHEN the user confirms cancellation
- THEN the FE sends `PATCH /subscriptions/{id}` with `{"is_active": false}` and shows state cancelled

#### Scenario: User reactivates subscription

- GIVEN a cancelled subscription `{id}`
- WHEN the user reactivates it
- THEN the FE sends `PATCH /subscriptions/{id}` with `{"is_active": true}` and shows state active

### Requirement: Subscription Delete

The FE MUST expose borrar with explicit confirmation using existing `DELETE /subscriptions/{id}` (204).

#### Scenario: User deletes subscription

- GIVEN a subscription `{id}`
- WHEN the user confirms deletion
- THEN the FE sends `DELETE /subscriptions/{id}` and removes it from the list

### Requirement: Subscription Contract Preserved

The BE contract MUST remain unchanged: authentication required (401), foreign access → 404 never 403, cost as string, category kind `subscription` else 422, `deny_unknown_fields`, Spanish errors, 401/404/422. The FE MUST surface those errors in Spanish via i18n keys and MUST NOT invent new endpoints or fields.

#### Scenario: Foreign subscription reads as not found

- GIVEN an authenticated user
- WHEN the FE requests `PATCH /subscriptions/{foreign_id}` (e.g. stale id)
- THEN the BE returns 404 and the FE shows the Spanish not-found message

### Requirement: Subscription Manual ES COP Contract

All subscription UI MUST be manual (selectors by name, never UUID input), Spanish-only, COP-only, with shared manual-amount normalization. The subscriptions hook MUST expose the wires the UI needs (`frequency`, `payment_method`, price/target fields) without changing wire format (string money).

#### Scenario: List shows Spanish frequency and COP price

- GIVEN subscriptions `"Streaming"` mensual `"19900.00"` and `"Gym"` anual `"600000.00"`
- WHEN the section renders
- THEN each row shows its Spanish frequency label and COP-formatted price
