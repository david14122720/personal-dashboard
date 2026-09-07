# Finance Accounts Specification

## Purpose
Management of financial accounts and their cached balances, ensuring strict ownership scoping and unique naming per user.

## Requirements

### Requirement: Account Creation
The system MUST allow users to create new financial accounts, including specialized credit card accounts.

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

### Requirement: Account Retrieval & Ownership
The system MUST ensure users can only access their own accounts.

#### Scenario: Retrieve owned account
- GIVEN an authenticated user who owns account {id}
- WHEN they request GET /accounts/{id}
- THEN the system returns 200 OK with account details

#### Scenario: Access foreign account
- GIVEN an authenticated user
- WHEN they request GET /accounts/{foreign_id}
- THEN the system returns 404 Not Found
- AND does not leak the existence of the account

### Requirement: Account Updates
The system SHOULD allow updating non-financial metadata of an account.

#### Scenario: Update account notes
- GIVEN an authenticated user owning account {id}
- WHEN they update the `notes` or `color` field
- THEN the system returns 200 OK
- AND the changes are persisted

### Requirement: Account Archiving
The system MUST support soft-archiving of accounts to hide them from active views.

#### Scenario: Archive account
- GIVEN an authenticated user owning account {id}
- WHEN they set `is_archived` to true
- THEN the system returns 200 OK
- AND the account no longer appears in "active" account lists
