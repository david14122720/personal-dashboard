# Budgets Write Specification

## Purpose

Completar la escritura de presupuestos: editar y borrar sobre contratos existentes, con formularios manuales en español y solo COP, sin bloquear nunca el gasto.

## Requirements

### Requirement: Budget Patch Endpoint

The system MUST expose `PATCH /budgets/{id}` to edit an owned budget. The request DTO MUST use `deny_unknown_fields` with allowlist exactly `amount, period_start, period_end, warning_threshold, danger_threshold, notes, category_id`. Amounts MUST be decimal strings. The system MUST set `updated_at = now()` on success and return 200 with the updated budget.

#### Scenario: Happy-path patch amount and period

- GIVEN an authenticated user owning budget `{id}` with amount `"500.00"`
- WHEN `PATCH /budgets/{id}` with `{"amount": "600.00", "period_start": "2026-09-01", "period_end": "2026-09-30"}`
- THEN the system returns 200 and persists amount `"600.00"` with the new period

#### Scenario: Patch thresholds and notes

- GIVEN an authenticated user owning budget `{id}`
- WHEN `PATCH /budgets/{id}` with `{"warning_threshold": 0.8, "danger_threshold": 1.0, "notes": "ajuste mes"}`
- THEN the system returns 200 with the updated thresholds and notes

### Requirement: Budget Patch Validation

The system MUST reject invalid patches with 422 and Spanish error messages. `period_end` MUST be `>= period_start`; `amount` MUST be `> 0`; thresholds MUST satisfy `0 < warning < danger`; `category_id` MUST reference an owned category of finance kind; any field outside the allowlist (including computed/trigger-owned status fields) MUST yield 422. Constraint violations MUST map `23505→409`, `23514/23503→422`, never 500.

#### Scenario: Invalid period rejected

- GIVEN an authenticated user owning budget `{id}`
- WHEN `PATCH /budgets/{id}` with `{"period_start": "2026-09-30", "period_end": "2026-09-01"}`
- THEN the system returns 422 with a Spanish validation error

#### Scenario: Unknown field rejected

- GIVEN an authenticated user owning budget `{id}`
- WHEN `PATCH /budgets/{id}` with `{"spent": "10.00"}`
- THEN the system returns 422

#### Scenario: Foreign or wrong-kind category rejected

- GIVEN an authenticated user owning budget `{id}`
- WHEN `PATCH /budgets/{id}` with a `category_id` belonging to another user or with kind != finance
- THEN the system returns 422 with a Spanish error

### Requirement: Budget Delete Endpoint

The system MUST expose `DELETE /budgets/{id}` returning 204 on success with no body.

#### Scenario: Happy-path delete

- GIVEN an authenticated user owning budget `{id}`
- WHEN `DELETE /budgets/{id}`
- THEN the system returns 204 and the budget no longer appears in `GET /budgets`

#### Scenario: Delete foreign or missing budget

- GIVEN an authenticated user
- WHEN `DELETE /budgets/{foreign_id}` or a non-existent id
- THEN the system returns 404 with a Spanish error and leaks no existence

### Requirement: Budget Write Auth and Ownership

The system MUST require authentication on both endpoints; unauthenticated requests MUST return 401 with Spanish envelope. Access to a budget owned by another user MUST return 404 (never 403) on PATCH and DELETE.

#### Scenario: Unauthenticated patch rejected

- GIVEN no `Authorization` header
- WHEN `PATCH /budgets/{id}` with a valid body
- THEN the system returns 401

#### Scenario: Foreign budget reads as not found

- GIVEN an authenticated user
- WHEN `PATCH /budgets/{foreign_id}` with a valid body
- THEN the system returns 404

### Requirement: Budgets Never Block

The system MUST treat budgets as visual warnings only. Over-budget status (`ok|warn|over`) MUST never reject transaction creation.

#### Scenario: Over budget still allows spending

- GIVEN a budget at 110% (`over`)
- WHEN the user records an expense in that category
- THEN the transaction returns 201 and the budget status remains `over`

### Requirement: Budget Write Form

The FE MUST provide a manual budget form in Spanish for editing (amount/period/thresholds/notes/category by name, never UUID input) and a delete action with explicit confirmation. Mutations MUST refresh the `finance/` SWR scope. All copy MUST come from `finance.*` i18n keys; hardcoding Spanish literals is forbidden. Amounts are entered via the shared manual-amount normalization and sent as strings; currency is always COP.

#### Scenario: User edits budget from UI

- GIVEN an authenticated user viewing their budgets
- WHEN they change the amount in the budget form and submit
- THEN the FE sends `PATCH /budgets/{id}` with the amount as string and refreshes the budgets list with updated status

#### Scenario: User deletes budget with confirmation

- GIVEN an authenticated user viewing a budget
- WHEN they confirm deletion
- THEN the FE sends `DELETE /budgets/{id}` and removes the entry from the list
