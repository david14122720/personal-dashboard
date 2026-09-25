# finance-assets Specification

## Purpose

Tracking of owned assets, their historical valuations, and the aggregation of total net worth.

## Requirements

### Requirement: Asset Management

The system MUST allow users to define assets.

#### Scenario: Create Asset
- GIVEN an authenticated user
- WHEN the user creates an asset (e.g., "Stock A", "Gold")
- THEN the system SHALL create the asset record
- AND return 201 Created

### Requirement: Asset Valuations

The system MUST track asset values over time using an append-only valuation log.

#### Scenario: Add Valuation
- GIVEN an asset
- WHEN the user adds a valuation of 1000.00 recorded on 2026-09-01
- THEN the system SHALL record the valuation
- AND the asset's `current_value` MUST be updated to 1000.00 via trigger
- AND return 201 Created

#### Scenario: Valuation Ordering Guard
- GIVEN an asset with the latest valuation recorded on 2026-09-05
- WHEN the user attempts to add a valuation recorded on 2026-09-01
- THEN the system MUST return 422 Unprocessable Entity (Out-of-order valuation rejected)

#### Scenario: Invalid Value Format
- GIVEN an authenticated user
- WHEN the user submits a valuation with an invalid amount string
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Net Worth Aggregation

The system MUST compute the total net worth on-demand from surviving sources only: total non-archived asset `current_value` minus credit-card liabilities. The active-debts term MUST be removed from `NET_WORTH_SQL` (the `debts` table is dropped by 0013), and the per-currency `debts` field MUST be redefined as credit-card liabilities only (`GREATEST(-balance, 0)` over non-archived `credit_card` accounts), keeping the `{currency, assets, debts, net_worth}` wire shape unchanged for consumers.
(Previously: net worth subtracted both active debts' `pending_amount` and card balances, and the `debts` field meant "active debts plus cards".)

#### Scenario: Calculate Net Worth

- GIVEN a user with:
    - Assets with total current value of 10,000.00
    - An active credit-card balance of `-3,000.00`
- WHEN the user requests the net worth aggregate
- THEN the system SHALL compute `10,000.00 - 3,000.00`
- AND return `{ "per_currency": [ { "currency": "USD", "assets": 10000.00, "debts": 3000.00, "net_worth": 7000.00 } ] }`

#### Scenario: No debts table in the query

- GIVEN the net-worth SQL after the change
- WHEN it is inspected
- THEN it joins assets and credit-card accounts only, and contains no reference to the removed `debts` table

#### Scenario: Positive card balance is not a liability

- GIVEN a credit-card account with balance `"500.00"`
- WHEN the net-worth aggregate computes
- THEN its liability contribution is zero, not negative

#### Scenario: Per-currency shape preserved

- GIVEN assets in USD and card liabilities in COP
- WHEN the aggregate computes
- THEN it returns two `per_currency` entries with the same field names as before the change

### Requirement: Ownership & Security

The system MUST restrict access to the user's own assets and valuations.

#### Scenario: Unauthorized Valuation
- GIVEN an authenticated user
- WHEN the user attempts to add a valuation to an asset belonging to another user
- THEN the system MUST return 404 Not Found

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/assets-write/spec.md (alias draft resolved to wire names) -->

### Requirement: Asset Patch Endpoint

The system MUST expose `PATCH /assets/{id}` with `deny_unknown_fields` and allowlist exactly `name, category, account_id, currency, acquired_on, notes`. The system MUST never accept `current_value, is_archived` — attempts MUST yield 422. Dates MUST be `YYYY-MM-DD`; currency MUST be COP-only. The system MUST set `updated_at = now()` and return 200 on success.

#### Scenario: Happy-path edit meta

- GIVEN an authenticated user owning asset `{id}`
- WHEN `PATCH /assets/{id}` with `{"name": "Apartamento", "notes": "avalúo 2026"}`
- THEN the system returns 200 with the updated fields

#### Scenario: Trigger-owned field rejected

- GIVEN an authenticated user owning asset `{id}`
- WHEN `PATCH /assets/{id}` with `{"current_value": "999.00"}`
- THEN the system returns 422 with a Spanish error

### Requirement: Asset Valuations Insert-Only

Valuations MUST remain INSERT-only via existing `POST /assets/{id}/valuations` with string amount and `recorded_on YYYY-MM-DD`. Out-of-order dates (`recorded_on <= max`) MUST return 422 and duplicate dates MUST return 409, with Spanish messages. No `PATCH`/`DELETE` for valuations and no `GET /assets/{id}/valuations` SHALL be created. Correction MUST be archive + recreate.

#### Scenario: Add valuation updates current value

- GIVEN an asset with latest valuation `"1000.00"` on 2026-09-01
- WHEN `POST .../valuations` with `{"value": "1200.00", "recorded_on": "2026-09-05"}`
- THEN the system returns 201 and `current_value` becomes `"1200.00"`

#### Scenario: Out-of-order valuation rejected

- GIVEN latest valuation on 2026-09-05
- WHEN `POST .../valuations` with `recorded_on 2026-09-01`
- THEN the system returns 422

#### Scenario: Duplicate valuation date conflicts

- GIVEN a valuation already recorded on 2026-09-05
- WHEN `POST .../valuations` with the same `recorded_on`
- THEN the system returns 409

### Requirement: Asset Archive Delete Preserved

`DELETE /assets/{id}` MUST remain archive-flag (`is_archived`) with history preserved, returning 204.

#### Scenario: Archive asset

- GIVEN an owned asset `{id}`
- WHEN `DELETE /assets/{id}`
- THEN the system returns 204 and the asset hides from active lists

### Requirement: Net Worth Number

The FE MUST show patrimonio as a simple number reusing existing `GET /net-worth` (`useNetWorth`): `Σ current_value` no-archivados − deuda cards, per currency. The removed active-debts term MUST NOT be reintroduced through any other source. Currency MUST come from `GET /me`, fallback first currency. No new home widget and no wealth-evolution chart SHALL be created.
(Previously: the formula also subtracted `Σ pending` of active debts, a source this change deletes.)

#### Scenario: Net worth visible in finance

- GIVEN net worth `{"currency": "COP", "net_worth": "7000000.00"}`
- WHEN the finance screen renders
- THEN the COP-formatted number is shown

#### Scenario: Outstanding debts are not part of the figure

- GIVEN the finance screen and progress/report consumers
- WHEN net worth renders
- THEN no debt-pending value is subtracted, added or displayed as part of it

#### Scenario: No new artefact

- GIVEN the change diff
- WHEN the dashboard and finance screens are inspected
- THEN no wealth widget, wealth route or evolution chart was added
### Requirement: Assets Write Auth and Ownership

PATCH and valuation endpoints MUST require authentication (401 unauthenticated, Spanish). Foreign asset access MUST return 404, never 403. Constraint maps `23505→409`, `23514/23503→422`.

#### Scenario: Foreign asset patch reads as not found

- GIVEN an authenticated user
- WHEN `PATCH /assets/{foreign_id}` with a valid body
- THEN the system returns 404

### Requirement: Asset Forms

The FE MUST provide manual Spanish forms: editar metadatos (PATCH allowlist) and valuar (POST valuation), plus archivar with confirmation. Selectors by name, never UUID input; amounts via shared manual-amount normalization as strings; always COP; `finance.*` i18n only; `finance/` SWR refresh.

#### Scenario: User revalues asset from UI

- GIVEN a user viewing asset `"Apartamento"`
- WHEN they submit value `"350000000"` with date `2026-09-09`
- THEN the FE sends `POST .../valuations` with the value as string and shows the new current value
