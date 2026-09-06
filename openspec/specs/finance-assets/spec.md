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
