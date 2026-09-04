# Finance Transactions Specification

## Purpose
Recording of income and expense events, maintaining strict balance consistency via triggers for simple entries.

## Requirements

### Requirement: Transaction Creation
The system MUST allow users to record income or expense transactions.

#### Scenario: Successfully record expense
- GIVEN an authenticated user and an owned account {id}
- WHEN they create a transaction: type='expense', amount='50.00', account_id={id}, occurred_on='2026-09-01'
- THEN the system returns 201 Created
- AND the account balance is decreased by 50.00 via DB trigger

#### Scenario: Invalid amount (zero or negative)
- GIVEN an authenticated user
- WHEN they create a transaction with amount='0.00' or '-10.00'
- THEN the system returns 422 Unprocessable Entity
- AND no transaction is created

#### Scenario: Invalid date format
- GIVEN an authenticated user
- WHEN they provide an invalid date string for `occurred_on`
- THEN the system returns 422 Unprocessable Entity

#### Scenario: Non-owned account
- GIVEN an authenticated user
- WHEN they attempt to record a transaction for account {foreign_id}
- THEN the system returns 404 Not Found

### Requirement: Transaction Immutability
To prevent balance desync, the system MUST forbid updates to financial core fields.

#### Scenario: Attempt to update amount
- GIVEN an authenticated user owning transaction {id}
- WHEN they attempt to update the `amount`, `account_id`, or `type`
- THEN the system returns 422 Unprocessable Entity (or 403 Forbidden)
- AND the balance remains unchanged

#### Scenario: Update transaction description
- GIVEN an authenticated user owning transaction {id}
- WHEN they update the `description` or `notes`
- THEN the system returns 200 OK

### Requirement: Transaction Deletion
The system MUST allow deleting transactions, reversing the balance effect.

#### Scenario: Delete expense
- GIVEN an authenticated user owning transaction {id} (type='expense', amount='20.00')
- WHEN they delete the transaction
- THEN the system returns 204 No Content
- AND the account balance is increased by 20.00 via DB trigger
