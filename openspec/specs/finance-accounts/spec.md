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

The account balance MUST be treated as a value the user asserts or the movement transaction adjusts. The system MUST NOT maintain, derive or expose any history, snapshot or valuation series for an account balance beyond the movement rows themselves, and no surviving module MAY recompute it from other rows. Exactly two write paths MUST exist and no others: the manual `PATCH /api/accounts/{id}` correction and the movement transaction (`finance-movements`: insert/delete/edit with signed-delta reversal). No trigger, cron, aggregate or derived job MAY write `balance`. Every dependent figure — net worth, total assets, card metrics, total balance — MUST read the stored `balance`.
(Previously: balance was written only by the manual `PATCH`; the statement of truth said "a value the user asserts" and no movement transaction existed.)

#### Scenario: No history is created

- GIVEN a manual balance update through the API
- WHEN the request succeeds
- THEN exactly one row changes and no history, audit or snapshot row is written

#### Scenario: Dependents follow the stored balance

- GIVEN an account whose balance was updated manually
- WHEN net worth and card metrics are read
- THEN both reflect the new stored balance with no additional source consulted

#### Scenario: The movement transaction is the second sanctioned writer

- GIVEN account `A` with balance `"100000.00"`
- WHEN a movement is created, edited or deleted through `/api/movements`
- THEN `A.balance` changes by the signed delta inside that transaction and no other module recomputes it

#### Scenario: No third writer exists

- GIVEN the final schema and codebase after the change
- WHEN writes to `accounts.balance` are searched
- THEN only the manual `PATCH /api/accounts/{id}` and the movement transaction write it, and no trigger does

### Requirement: Account Delete Guard Uses Live References Only

Account deletion MUST NOT query any removed table. The surviving `movements.account_id` reference is blocking (`ON DELETE RESTRICT`): deleting an owned account that has at least one movement MUST be blocked with 409 Conflict and a Spanish message, surfaced in the UI through a typed `finance.*` i18n key (never a raw status or hardcoded string). Because the surviving `assets.account_id` foreign key is `ON DELETE SET NULL` and no other surviving table blocks, deleting an owned account without movements MUST succeed with 204. The existing constraint mapping (`23503 → 409` with a Spanish message) MUST be preserved, and a foreign or missing id MUST still resolve to 404 (never 403).
(Previously: the guard was unconditional — deletion succeeded with 204 regardless of debts, savings movements or subscriptions, because no surviving table held a blocking reference.)

#### Scenario: Delete an account without movements

- GIVEN an owned account referenced by no movement and nothing else blocking
- WHEN `DELETE /api/accounts/{id}`
- THEN the system returns 204 and the account is gone

#### Scenario: Account with movements is blocked

- GIVEN an owned account with at least one movement
- WHEN `DELETE /api/accounts/{id}`
- THEN the system returns 409 with a Spanish message
- AND the account and its balance are unchanged

#### Scenario: No removed-table query

- GIVEN the delete path after the change
- WHEN its SQL is inspected
- THEN it contains no reference to the removed `transactions`, `savings_goals` or `debts` tables

#### Scenario: Blocking constraint still maps to 409

- GIVEN the `movements.account_id` restriction (or any future `RESTRICT` reference) that blocks the delete
- WHEN the database rejects it with `23503`
- THEN the API returns 409 with a Spanish message, never 500

#### Scenario: Foreign delete still reads as not found

- GIVEN an authenticated user
- WHEN they delete a foreign account id
- THEN the system returns 404 without leaking existence

#### Scenario: The FE surfaces the block with a typed key

- GIVEN an account with movements and its delete confirmation in Settings
- WHEN the 409 arrives
- THEN the UI shows the Spanish block message resolved from a typed `finance.*` key and keeps the account listed
### Requirement: Account Balance Inline Edit
The finance UI MUST expose the manual balance write on the account card as an inline edit: it MUST display the current balance before editing, require an explicit confirmation before saving, send the new value as a string, and refresh the `finance/` SWR scope on success. The control MUST be keyboard reachable with visible focus, MUST have a hit area of at least 44×44 CSS pixels, MUST format values with es-CO/COP through the existing money formatter, and MUST use typed `finance.*` i18n keys with no UUID input and no hardcoded copy.

#### Scenario: User edits balance from the card
- GIVEN a user viewing account `"Ahorros"` with balance `$ 1.500.000`
- WHEN they replace the value with `980000.00` and confirm
- THEN the FE sends `PATCH /api/accounts/{id}` with the balance as a decimal string and the card shows the new formatted value

#### Scenario: Cancelling leaves the value untouched
- GIVEN an inline edit in progress
- WHEN the user cancels
- THEN no request is sent and the previous balance is still displayed

#### Scenario: Invalid input blocked before the request
- GIVEN an inline edit with more than 2 decimals or an out-of-range value
- WHEN the user tries to confirm
- THEN the FE shows a Spanish validation error and sends no request

### Requirement: Account Archiving
The system MUST support soft-archiving of accounts to hide them from active views.

#### Scenario: Archive account
- GIVEN an authenticated user owning account {id}
- WHEN they set `is_archived` to true
- THEN the system returns 200 OK
- AND the account no longer appears in "active" account lists
