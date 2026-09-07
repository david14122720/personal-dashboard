# Delta for finance-transactions

## ADDED Requirements

### Requirement: Credit Card Purchase Linkage

The system MUST allow expenses to be linked to a specific credit card account to track card-specific debt.

- When an expense is linked to a `credit_card_account_id`, the system MUST update the balance of that card account (incrementing debt/reducing balance).
- The linkage is optional; expenses may remain unlinked.

#### Scenario: Link expense to card
- GIVEN a credit card account {id} with balance 0.00
- WHEN a user records an expense of 50.00 linked to `credit_card_account_id: {id}`
- THEN the system SHALL return 201 Created
- AND the account balance MUST become -50.00

#### Scenario: Over-limit purchase guard
- GIVEN a credit card account {id} with `credit_limit: 1000.00` and current balance -950.00
- WHEN a user attempts to record an expense of 100.00 linked to `{id}`
- THEN the system MUST return 422 Unprocessable Entity (Over-limit purchase forbidden)
- AND no transaction is recorded

#### Scenario: Non-expense linkage
- GIVEN a credit card account {id}
- WHEN a user attempts to link an income transaction to `credit_card_account_id: {id}`
- THEN the system MUST return 422 Unprocessable Entity (Only expenses can be linked to credit cards)
