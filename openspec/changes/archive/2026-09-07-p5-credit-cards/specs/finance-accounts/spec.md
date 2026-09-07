# Delta for finance-accounts

## ADDED Requirements

### Requirement: Credit Card Account Constraints

The system MUST enforce specific constraints for accounts of type `credit_card`.

- If `type` is `credit_card`, `credit_limit` MUST be provided and MUST be greater than 0.
- If `type` is NOT `credit_card`, `credit_limit` MUST be NULL.
- `statement_day` and `payment_due_day` MUST be between 1 and 31. Values greater than the last day of the current month MUST be clamped to the last day of that month.

#### Scenario: Valid credit card creation
- GIVEN an authenticated user
- WHEN they create an account with `type: "credit_card"`, `credit_limit: 5000.00`, `statement_day: 15`, and `payment_due_day: 25`
- THEN the system returns 201 Created
- AND the account is persisted with these values

#### Scenario: Missing limit for credit card
- GIVEN an authenticated user
- WHEN they create an account with `type: "credit_card"` but omit `credit_limit`
- THEN the system MUST return 422 Unprocessable Entity

#### Scenario: Limit provided for non-credit card
- GIVEN an authenticated user
- WHEN they create an account with `type: "savings"` and provide a `credit_limit`
- THEN the system MUST return 422 Unprocessable Entity

#### Scenario: Month-end date clamping
- GIVEN an authenticated user
- WHEN they set `statement_day` to 31 for a month that only has 30 days
- THEN the system SHALL clamp the value to 30 for that period's calculations

## MODIFIED Requirements

### Requirement: Account Creation

The system MUST allow users to create new financial accounts, including specialized credit card accounts.
(Previously: Basic account creation with name and type)

#### Scenario: Successfully create account
- GIVEN an authenticated user
- WHEN they create an account with a unique name (e.g., "Main Bank") and valid type
- THEN the system returns 201 Created
- AND the account is persisted with a default balance of 0.00

#### Scenario: Duplicate account name
- GIVEN an authenticated user who already has an account named "Savings"
- WHEN they attempt to create another account named "Savings"
- THEN the system returns 409 Conflict
- AND no new account is created
