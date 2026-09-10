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

The system MUST compute the total net worth on-demand.

#### Scenario: Calculate Net Worth
- GIVEN a user with:
    - Assets with total current value of 10,000.00
    - Active debts with total pending amount of 3,000.00
- WHEN the user requests the net worth aggregate
- THEN the system SHALL compute `10,000.00 - 3,000.00`
- AND return `{ "per_currency": [ { "currency": "USD", "assets": 10000.00, "debts": 3000.00, "net_worth": 7000.00 } ] }`

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

The FE MUST show patrimonio as a simple number reusing existing `GET /net-worth` (`useNetWorth`): `Σ current_value` no-archivados − `Σ pending` activas − deuda cards, per currency. Currency MUST come from `GET /me`, fallback first currency. No new home widget and no wealth-evolution chart SHALL be created.

#### Scenario: Net worth visible in finance

- GIVEN net worth `{"currency": "COP", "net_worth": "7000000.00"}`
- WHEN the finance screen renders
- THEN the COP-formatted number is shown

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
