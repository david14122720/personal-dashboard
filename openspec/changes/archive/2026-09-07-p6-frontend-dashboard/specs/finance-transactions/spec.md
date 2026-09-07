# Delta for Finance Transactions

## ADDED Requirements

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
