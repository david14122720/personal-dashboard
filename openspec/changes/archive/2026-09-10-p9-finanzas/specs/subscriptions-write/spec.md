# Subscriptions Write Specification

## Purpose

Completar el CRUD de suscripciones como trabajo solo-FE sobre el backend ya completo, con formularios manuales en español y solo COP.

## Requirements

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
