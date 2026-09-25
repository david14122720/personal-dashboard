# Delta for Finance Accounts

**Scope.** Two requirements change. `accounts.balance` remains the stored source of truth and stays trigger-free, but gains a second sanctioned write path: the movement transaction (D4, see `finance-movements`). The delete guard stops being unconditional: an account with at least one movement MUST NOT be deletable, and the 409 response shape is fixed here (status + Spanish message + FE i18n key).

**Unchanged.** "Account Creation", "Credit Card Account Constraints", "Account Retrieval & Ownership", "Account Updates" (the manual `PATCH balance` write contract) and "Account Balance Inline Edit" (the inline correction control) keep their current behaviour; the manual balance write is a correction path, not a replacement for movements.

**Edge cases.** A `PATCH balance` correction on an account with movements is allowed and is not recomputed from the movement rows — the stored balance is the truth. Archiving an account with movements is allowed and keeps history readable. A balance adjusted by a movement may legitimately become negative; no rule forbids it (overdraft is a real state, not an error).

**Non-goals.** No balance history, snapshot or valuation series; no reconciliation job that recomputes `balance` from movements; no change to account naming, card limits or archive semantics.

## MODIFIED Requirements

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
