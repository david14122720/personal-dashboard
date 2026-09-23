# Delta for Finance Accounts

**Scope.** Make `accounts.balance` user-owned data: `PATCH /api/accounts/{id}` accepts a manual `balance` string, no trigger or aggregate writes it, and the account card exposes an inline edit with explicit confirmation. Also rewrite the delete guard so it never consults the removed `transactions` table. Slice S3, inseparable from migration 0011 (see `finance-core-invariants`).

**Edge cases.** A mis-typed balance is undetectable without history — the UI MUST show the current value and require confirmation, and validation MUST reject `scale > 2` and `|balance| ≥ 10^6` with 422. Cards with a `statement_day` but no statement figure MUST omit the figure rather than print zero (see `credit-card-summary`). A persisted `balance` of an archived account stays readable.

**Non-goals.** No balance history, snapshot, valuation log or "movement" screen for accounts; no change to account creation defaults, naming rules, card limits or archive semantics; no currency other than COP.

## MODIFIED Requirements

### Requirement: Account Updates

The system MUST allow updating the manual balance and the non-financial metadata of an account through `PATCH /api/accounts/{id}`. The accepted fields MUST be exactly `balance`, `notes`, `color`, `icon` and `is_archived`; anything outside that allowlist MUST yield 422. `balance` MUST arrive as a decimal string, MUST have at most 2 decimal places and an absolute value below 10^6, and MUST be persisted verbatim as the account's single source of truth.
(Previously: only non-financial metadata (`notes`, `color`, `icon`, `is_archived`) was updatable; `balance` was rejected as an unknown field with 422.)

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

## ADDED Requirements

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

#### Scenario: Foreign account delete

- GIVEN an authenticated user
- WHEN they delete a foreign account id
- THEN the system returns 404 without leaking existence

#### Scenario: Blocking constraint still maps to 409

- GIVEN a future or unforeseen `RESTRICT` reference that blocks the delete
- WHEN the database rejects it with `23503`
- THEN the API returns 409 with a Spanish message, never 500
