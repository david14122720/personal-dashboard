# Finance Accounts Specification

## Purpose
Management of financial accounts and their cached balances, ensuring strict ownership scoping and unique naming per user.

## Requirements

### Requirement: Account Creation
The system MUST allow users to create new financial accounts.

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
