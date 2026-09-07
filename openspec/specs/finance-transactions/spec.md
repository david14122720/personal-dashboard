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

### Requirement: Authenticated Transaction List

The system MUST expose `GET /transactions` returning the caller's transactions in reverse-chronological order. The endpoint SHALL support optional filters (`account_id`, `category_id`, `type` ∈ {income, expense}, `from`/`to` ISO-8601 dates) and keyset pagination via `cursor` + `limit` (default 50, max 200). Amounts MUST be serialized as decimal strings. Unauthenticated requests MUST receive 401; unknown filter targets MUST yield an empty page (not 404).

#### Scenario: Default list

- GIVEN an authenticated user with 120 transactions
- WHEN they call `GET /transactions`
- THEN the response is 200 with `items` (50 entries), `next_cursor`, and `total_count`
- AND every `amount` is a decimal string (e.g. `"12500.00"`)

#### Scenario: Filtered by date range and type

- GIVEN transactions on 2026-08-15 (expense) and 2026-09-02 (income)
- WHEN `GET /transactions?type=expense&from=2026-09-01&to=2026-09-30`
- THEN only expenses inside the range are returned
- AND the income entry is excluded

#### Scenario: Pagination via cursor

- GIVEN a first page returned `next_cursor = "abc"`
- WHEN `GET /transactions?cursor=abc&limit=50`
- THEN the response contains the next 50 items with no overlap

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `GET /transactions`
- THEN the system returns 401 with envelope `UNAUTHORIZED`

### Requirement: Aggregate Reads for Dashboard Charts

The system MUST expose read-only aggregate endpoints that return decimal-string money values:
- `GET /transactions/stats/by-category?from=&to=&type=` → rows of `{ category_id, name, total }`.
- `GET /transactions/stats/monthly-flow?from=&to=` → rows of `{ month, income, expense }`.

Aggregates MUST be computed server-side from the caller's transactions and MUST NOT expose other users' data.

#### Scenario: Category totals for current month

- GIVEN three September expenses of `"10.00"`, `"20.50"`, `"5.25"` in category "Food"
- WHEN `GET /transactions/stats/by-category?from=2026-09-01&to=2026-09-30&type=expense`
- THEN the response includes `{ category_id, name, total: "35.75" }` for Food

#### Scenario: Monthly flow series

- GIVEN income `"1000.00"` and expense `"400.00"` in September
- WHEN `GET /transactions/stats/monthly-flow?from=2026-09-01&to=2026-09-30`
- THEN the response contains `{ month: "2026-09", income: "1000.00", expense: "400.00" }`

#### Scenario: Empty range

- GIVEN no transactions in the requested window
- WHEN either aggregate endpoint is called
- THEN the response is 200 with an empty array
