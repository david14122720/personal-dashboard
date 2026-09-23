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
The system MUST allow updating the manual balance and the non-financial metadata of an account through `PATCH /api/accounts/{id}`. The accepted fields MUST be exactly `balance`, `notes`, `color`, `icon` and `is_archived`; anything outside that allowlist MUST yield 422. `balance` MUST arrive as a decimal string, MUST have at most 2 decimal places and an absolute value below 10^6, and MUST be persisted verbatim as the account's single source of truth.

#### Scenario: Update account notes
- GIVEN an authenticated user owning account {id}
- WHEN they update the `notes` or `color` field
- THEN the system returns 200 OK
- AND the changes are persisted

#### Scenario: Update manual balance
- GIVEN an authenticated user owning account {id} with balance `"-500.00"`
- WHEN they PATCH the account with `{"balance": "-750.50"}`
- THEN the system returns 200 OK
- AND the response serializes the stored balance as the string `"-750.50"`
- AND no trigger, aggregate or derived value rewrites it afterwards

#### Scenario: Balance validation rejects bad values
- GIVEN an authenticated user owning account {id}
- WHEN they PATCH with `"1000000.00"`, `"10.005"`, a JSON number, or a non-numeric string
- THEN the system returns 422 and the stored balance is unchanged

#### Scenario: Structural edits stay rejected
- GIVEN an authenticated user owning account {id}
- WHEN they PATCH with `name`, `type` or `credit_limit`
- THEN the system returns 422 and the account is unchanged

#### Scenario: Foreign or unauthenticated balance edit
- GIVEN a foreign account id, or no `Authorization` header
- WHEN a balance PATCH is attempted
- THEN the system returns 404 for the foreign id (never 403) and 401 without a token, and no balance changes

### Requirement: Manual Balance As Single Source Of Truth
The account balance MUST be treated as a value the user asserts. The system MUST NOT maintain, derive or expose any history, snapshot or valuation series for an account balance, and no surviving module MAY recompute it from other rows. Every dependent figure — net worth, total assets, card metrics — MUST read the stored `balance`.

#### Scenario: No history is created
- GIVEN a balance update through the API
- WHEN the request succeeds
- THEN exactly one row changes and no history, audit or snapshot row is written

#### Scenario: Dependents follow the stored balance
- GIVEN an account whose balance was updated manually
- WHEN net worth and card metrics are read
- THEN both reflect the new stored balance with no additional source consulted

### Requirement: Account Delete Guard Uses Live References Only
Account deletion MUST NOT query any removed table. Because the surviving foreign key from assets to accounts is `ON DELETE SET NULL` and no surviving table holds a blocking reference to an account, deleting an owned account MUST succeed with 204 regardless of its debts, savings movements or subscriptions. The existing constraint mapping (`23503→409` with a Spanish message) MUST be preserved for any future blocking reference, and a foreign or missing id MUST still resolve to 404.

#### Scenario: Delete an account with unrelated finance rows
- GIVEN an owned account referenced by nothing blocking
- WHEN `DELETE /api/accounts/{id}`
- THEN the system returns 204 and the account is gone

#### Scenario: No removed-table query
- GIVEN the delete path after the change
- WHEN its SQL is inspected
- THEN it contains no reference to the removed `transactions` table

#### Scenario: Blocking constraint still maps to 409
- GIVEN a future or unforeseen `RESTRICT` reference that blocks the delete
- WHEN the database rejects it with `23503`
- THEN the API returns 409 with a Spanish message, never 500

### Requirement: Account Archiving
The system MUST support soft-archiving of accounts to hide them from active views.

#### Scenario: Archive account
- GIVEN an authenticated user owning account {id}
- WHEN they set `is_archived` to true
- THEN the system returns 200 OK
- AND the account no longer appears in "active" account lists
