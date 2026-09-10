# Finance Budgets Specification

## Purpose
Category-based spending caps with on-demand status monitoring.

## Requirements

### Requirement: Budget Creation & Validation
The system MUST allow users to set spending limits for specific categories over a date range.

#### Scenario: Successfully create budget
- GIVEN an authenticated user and a category {id}
- WHEN they create a budget: amount='500.00', period_start='2026-09-01', period_end='2026-09-30'
- THEN the system returns 201 Created

#### Scenario: Invalid period
- GIVEN an authenticated user
- WHEN they set `period_end` earlier than `period_start`
- THEN the system returns 422 Unprocessable Entity

#### Scenario: Negative or zero amount
- GIVEN an authenticated user
- WHEN they set budget amount to '0.00' or '-10.00'
- THEN the system returns 422 Unprocessable Entity

### Requirement: Budget Status Computation
The system MUST compute the spent, remaining, and percentage used on-demand.

#### Scenario: Compute budget status
- GIVEN a budget of '100.00' for "Food" and total expenses of '85.00' in that period
- WHEN the user requests budget status
- THEN the system returns:
    - spent: '85.00'
    - remaining: '15.00'
    - pct: 0.85

### Requirement: Threshold Alerting
The system MUST map the computed percentage to a status based on `warn_threshold` and `over_threshold`.

#### Scenario: Warning status
- GIVEN a budget with `warn_threshold` = 0.8 and `over_threshold` = 1.0
- WHEN current spending is 85% (0.85)
- THEN the system returns status: 'warn'

#### Scenario: Over budget status
- GIVEN a budget with `over_threshold` = 1.0
- WHEN current spending is 110% (1.10)
- THEN the system returns status: 'over'

#### Scenario: OK status
- GIVEN a budget with `warn_threshold` = 0.8
- WHEN current spending is 40% (0.40)
- THEN the system returns status: 'ok'

### Requirement: Budgets Collection With Inline Status

The system MUST expose `GET /budgets` returning all caller budgets for the current period with each entry including computed status fields (`spent`, `remaining`, `pct`, `status`) — eliminating the per-id N+1 required by the existing single-budget status endpoint. Amounts MUST be decimal strings; `pct` is a number in `[0, ∞)`. `status` MUST be one of `ok`, `warn`, `over` derived from `warn_threshold` / `over_threshold` as in the existing Threshold Alerting requirement.

#### Scenario: List budgets with computed status

- GIVEN two budgets: Food (spent 85%, warn_threshold 0.8) and Transport (spent 40%)
- WHEN `GET /budgets`
- THEN the response is 200 with an array where Food has `status: "warn"` and Transport has `status: "ok"`
- AND each entry carries `spent`, `remaining`, `pct` as documented

#### Scenario: Empty budgets

- GIVEN a user with no active budgets
- WHEN `GET /budgets`
- THEN the response is 200 with an empty array

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `GET /budgets`
- THEN the system returns 401 with envelope `UNAUTHORIZED`

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/budgets-write/spec.md (alias draft resolved to wire names) -->

### Requirement: Budget Patch Endpoint

The system MUST expose `PATCH /budgets/{id}` to edit an owned budget. The request DTO MUST use `deny_unknown_fields` with allowlist exactly `amount, period_start, period_end, warn_threshold, over_threshold, notes, category_id`. Amounts MUST be decimal strings. The system MUST set `updated_at = now()` on success and return 200 with the updated budget.

#### Scenario: Happy-path patch amount and period

- GIVEN an authenticated user owning budget `{id}` with amount `"500.00"`
- WHEN `PATCH /budgets/{id}` with `{"amount": "600.00", "period_start": "2026-09-01", "period_end": "2026-09-30"}`
- THEN the system returns 200 and persists amount `"600.00"` with the new period

#### Scenario: Patch thresholds and notes

- GIVEN an authenticated user owning budget `{id}`
- WHEN `PATCH /budgets/{id}` with `{"warn_threshold": 0.8, "over_threshold": 1.0, "notes": "ajuste mes"}`
- THEN the system returns 200 with the updated thresholds and notes

### Requirement: Budget Patch Validation

The system MUST reject invalid patches with 422 and Spanish error messages. `period_end` MUST be `>= period_start`; `amount` MUST be `> 0`; thresholds MUST satisfy `0 < warn_threshold < over_threshold`; `category_id` MUST reference an owned category of finance kind; any field outside the allowlist (including computed/trigger-owned status fields) MUST yield 422. Constraint violations MUST map `23505→409`, `23514/23503→422`, never 500.

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
