# finance-debts Specification

## Purpose

Tracking of owed amounts (debts) and the history of payments made towards them, including automatic status transitions.

## Requirements

### Requirement: Debt Management

The system MUST allow users to create, read, and delete debt records.

#### Scenario: Create Debt
- GIVEN an authenticated user
- WHEN the user creates a debt with a lender name and total amount
- THEN the system SHALL create the debt and set `pending_amount` equal to the total amount
- AND set status to `active`
- AND return 201 Created

#### Scenario: Access Other User's Debt
- GIVEN an authenticated user
- WHEN the user attempts to retrieve a debt ID belonging to another user
- THEN the system MUST return 404 Not Found

### Requirement: Debt Payments

The system MUST allow recording payments against an active debt.

#### Scenario: Valid Payment
- GIVEN a debt with `pending_amount` 500.00
- WHEN the user records a payment of 100.00
- THEN the system SHALL record the payment
- AND the debt's `pending_amount` MUST be updated to 400.00 via trigger
- AND return 201 Created

#### Scenario: Overpayment Guard
- GIVEN a debt with `pending_amount` 100.00
- WHEN the user attempts to record a payment of 150.00
- THEN the system MUST return 422 Unprocessable Entity (Overpayment forbidden)

#### Scenario: Invalid Money Format
- GIVEN an authenticated user
- WHEN the user submits a payment with an invalid amount string
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Debt Status Lifecycle

The system MUST automatically transition debt status when fully paid.

#### Scenario: Debt Paid Off Trigger
- GIVEN a debt with `pending_amount` 50.00
- WHEN a payment of 50.00 is recorded
- THEN the system MUST set `pending_amount` to 0
- AND automatically transition status to `paid_off`
- AND return 201 Created

### Requirement: Data Integrity

The system MUST prevent illegal state transitions.

#### Scenario: Payment to Paid Off Debt
- GIVEN a debt with status `paid_off`
- WHEN the user attempts to record a payment
- THEN the system MUST return 422 Unprocessable Entity
