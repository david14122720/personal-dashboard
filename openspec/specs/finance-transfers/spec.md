# Finance Transfers Specification

## Purpose
Atomic movement of funds between two accounts owned by the same user.

## Requirements

### Requirement: Atomic Transfer Execution
The system MUST implement transfers as a single atomic database transaction ensuring both legs are created and balances updated.

#### Scenario: Successful transfer
- GIVEN an authenticated user owning accounts {src} and {dest}
- WHEN they request a transfer of '100.00' from {src} to {dest}
- THEN the system:
    1. Generates a unique `transfer_group_id`
    2. Inserts an 'expense' leg for {src}
    3. Inserts an 'income' leg for {dest}
    4. Updates balance of {src} (-100.00)
    5. Updates balance of {dest} (+100.00)
- AND returns 201 Created

#### Scenario: Transfer to same account
- GIVEN an authenticated user
- WHEN they attempt to transfer from account {id} to account {id}
- THEN the system returns 422 Unprocessable Entity
- AND no funds are moved

#### Scenario: Transfer involving foreign account
- GIVEN an authenticated user
- WHEN they attempt to transfer to/from account {foreign_id}
- THEN the system returns 404 Not Found

### Requirement: Transfer Atomicity (Rollback)
The system MUST guarantee that a failure in any part of the transfer process rolls back all changes.

#### Scenario: Failure during second leg
- GIVEN a transfer process that successfully inserts the first leg
- WHEN a database error occurs while inserting the second leg or updating the destination balance
- THEN the entire transaction is rolled back
- AND the source account balance remains unchanged
- AND no orphaned transaction legs are persisted

### Requirement: Data Integrity
Money MUST be handled as strings in DTOs to avoid floating-point drift.

#### Scenario: Decimal precision
- GIVEN a transfer amount of '10.005'
- WHEN the system processes the request
- THEN it must either round according to project policy or reject as 422 if it exceeds 2 decimal places

### Requirement: Card Payments via Transfers

The system SHOULD support the use of transfers to record payments made from a bank account to a credit card account.

#### Scenario: Pay credit card bill
- GIVEN a bank account {bank_id} with balance 1000.00 and a credit card account {card_id} with balance -500.00
- WHEN a user records a transfer of 500.00 from `{bank_id}` to `{card_id}`
- THEN the system SHALL return 201 Created
- AND `{bank_id}` balance MUST become 500.00
- AND `{card_id}` balance MUST become 0.00
