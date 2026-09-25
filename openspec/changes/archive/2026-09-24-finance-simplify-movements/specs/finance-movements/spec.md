# finance-movements Specification

## Purpose

Expense/income ledger for the personal dashboard: a recorded movement links one account, one category, a direction, an amount and a date, and writing, editing or deleting that movement adjusts the owning account balance atomically in the same database transaction. The ledger is the single source feeding the Finance history list, the category chart, the compare view and the Resumen «últimos movimientos» section. It replaces the charts proxy (`toCategoryTotals` read subscriptions + savings goals) and restores a scoped reversal of the parent change's deliberate ledger removal (`2026-09-23-simplify-finance-productivity`, migration 0011) — one table and one primitive, no transfers, no budgets, no stats endpoints.

## Requirements

### Requirement: Movement Record Model

The system MUST persist movements in a new table created by the additive migration **0012** (migration discipline lives in `finance-core-invariants`), shaped exactly as binding decision D4:

`movements(id UUID PK, user_id UUID FK→users ON DELETE CASCADE, account_id UUID FK→accounts ON DELETE RESTRICT NOT NULL, category_id UUID FK→categories ON DELETE SET NULL NULL, direction movement_direction NOT NULL, amount NUMERIC(18,2) NOT NULL CHECK (amount > 0), occurred_on DATE NOT NULL, description TEXT NULL, subscription_id UUID FK→subscriptions ON DELETE SET NULL NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`.

- `direction` MUST be a new Postgres enum with exactly the values `expense` and `income`; the stored `amount` is always positive and the direction carries the sign.
- `account_id` MUST be the blocking reference (`ON DELETE RESTRICT`) so the account delete guard is an integrity rule, not only an application check.
- `subscription_id` MUST be the non-blocking reference (`ON DELETE SET NULL`) so deleting a subscription preserves its recorded movements as audit.
- The table MUST carry the indexes `(user_id, occurred_on DESC)`, `(user_id, account_id)` and `(user_id, category_id)`.
- Migration 0012 MUST be additive only: it creates `movements` (and, in the same change, the `subscriptions.last_paid_on` column owned by `finance-subscriptions`); it MUST NOT modify or drop any existing table, trigger, column or enum.

#### Scenario: Table and indexes exist after 0012
- GIVEN a database with 0012 applied
- WHEN the catalog is inspected
- THEN `movements` exists with the columns, checks, foreign keys and three indexes above
- AND no pre-existing table, trigger or enum was altered

#### Scenario: Amount is positive and direction carries the sign
- GIVEN a movement persisted through the API
- WHEN the row is inspected
- THEN `amount > 0` and `direction` is `expense` or `income`

#### Scenario: Non-positive amounts rejected at the database
- GIVEN a direct insert into `movements`
- WHEN `amount` is `0` or negative
- THEN the check constraint rejects the row

### Requirement: Movement REST Contract

The system MUST expose user-scoped movement endpoints with `deny_unknown_fields` and decimal-string wire money:

- `GET /api/movements` — list the caller's movements ordered `occurred_on DESC, created_at DESC, id DESC`; no pagination in v1.
- `POST /api/movements` — create; the request allowlist MUST be exactly `direction`, `amount` (decimal string > 0, at most 2 decimals, absolute value below 10^6), `account_id`, `category_id`, `occurred_on` (`YYYY-MM-DD`) and optional `description`; `subscription_id` MUST NOT be accepted on create (only the subscription Pay action sets it).
- `GET /api/movements/{id}` — read one owned movement.
- `PATCH /api/movements/{id}` — edit; the request allowlist MUST be exactly `direction`, `amount`, `account_id`, `category_id`, `occurred_on`, `description`; any subset MAY be sent and omitted fields keep their stored value; `subscription_id` MUST be rejected as unknown.
- `DELETE /api/movements/{id}` — 204.

Responses MUST serialize `amount` as a decimal string and `occurred_on` as `YYYY-MM-DD`, and MUST include `id`, `direction`, `amount`, `occurred_on`, `description`, `account_id`, `category_id`, `subscription_id`, `created_at`, `updated_at`. Violations MUST be Spanish: 401 without a token; 404 for a foreign or missing URL-addressed movement id (never 403); 422 for a missing required field, an unknown field, a non-string or out-of-range amount, an unparseable date, a referenced foreign or missing body `account_id`, and an unowned or missing body `category_id`.

The persisted `category_id` stays nullable per D4 (so a database-level category deletion cannot orphan or block a movement), while the create contract requires it; rows that end up without a category are excluded from category aggregates (see "Movement Category Aggregation").

#### Scenario: Create an expense against an owned account
- GIVEN an authenticated user owning account `A` and category `C`
- WHEN `POST /movements` with `{"direction":"expense","amount":"25000.00","account_id":"<A>","category_id":"<C>","occurred_on":"2026-09-24","description":"mercado"}`
- THEN the system returns 201 with the movement, `amount` as the string `"25000.00"` and `direction` `"expense"`

#### Scenario: Required, unknown and malformed fields rejected
- GIVEN an authenticated user
- WHEN `POST /movements` omits `occurred_on`, or sends `amount` as a JSON number, or sends `subscription_id`, or sends a date `"24/09/2026"`
- THEN the system returns 422 with a Spanish message and persists nothing

#### Scenario: Create income on a card account is allowed
- GIVEN an authenticated user owning a credit-card account
- WHEN they create an `income` movement on it
- THEN the system returns 201 and the direction is stored as `income`

#### Scenario: Foreign or missing movement reads as not found
- GIVEN a movement owned by another user (or an id that exists for nobody)
- WHEN any URL-addressed movement endpoint (`GET`/`PATCH`/`DELETE /movements/{id}`) is called with that id
- THEN the system returns 404 and does not leak existence
- AND a body-referenced foreign or missing `account_id`/`category_id` on `POST`/`PATCH` returns 422 with a Spanish message and persists nothing

#### Scenario: Edit cannot re-point the subscription link
- GIVEN a movement created by the subscription Pay action
- WHEN `PATCH /movements/{id}` includes `subscription_id`
- THEN the system returns 422 and the link is unchanged

#### Scenario: Unauthenticated access rejected
- GIVEN no `Authorization` header
- WHEN any `/api/movements` endpoint is called
- THEN the system returns 401 with a Spanish message and no row is read or written

### Requirement: Atomic Balance Effect

The balance effect of a movement MUST be applied by an application-level database transaction in the same request that writes the movement row. No database trigger SHALL write `accounts.balance` (D4 explicitly rejects the trigger pattern the parent change killed).

- `POST`: insert the row and apply the signed delta — `expense` subtracts `amount`, `income` adds `amount` — in one transaction.
- `DELETE`: reverse the same signed delta in one transaction.
- `PATCH`: reverse the old signed delta and apply the new signed delta in one transaction, including when `account_id` changes (both the old and the new account are updated inside that transaction).
- On any failure the transaction MUST roll back completely: no movement row, no partial balance change and no `updated_at` mutation MAY survive a partially failed operation.
- The account row lock taken by the `UPDATE` MUST serialize concurrent writes to the same account (a concurrent writer waits and then applies against the current value).

#### Scenario: Insert reflects in balance atomically
- GIVEN account `A` with balance `"100000.00"`
- WHEN an expense of `"25000.00"` is created
- THEN the response is 201, `A.balance` is `"75000.00"` and exactly one movement row exists

#### Scenario: Income adds to balance
- GIVEN account `A` with balance `"75000.00"`
- WHEN an income of `"110000.00"` is created
- THEN the response is 201 and `A.balance` is `"185000.00"`

#### Scenario: Delete reverses the balance
- GIVEN an expense of `"25000.00"` on account `A` (balance `"75000.00"`)
- WHEN `DELETE /movements/{id}`
- THEN the response is 204 and `A.balance` returns to `"100000.00"`

#### Scenario: Full edit reverses and reapplies, including account change
- GIVEN an expense of `"25000.00"` on account `A` and account `B`
- WHEN `PATCH /movements/{id}` changes direction to `income`, amount to `"30000.00"` and account to `B`
- THEN `A.balance` gains back `"25000.00"`, `B.balance` gains `"30000.00"`, and one transaction performed both updates

#### Scenario: Failed update leaves no partial effect
- GIVEN a movement PATCH whose target account is concurrently deleted
- WHEN the transaction fails on the foreign key
- THEN the API returns a Spanish 422/404, the movement is unchanged and no balance was adjusted

#### Scenario: No trigger writes balance
- GIVEN the schema after 0012
- WHEN the triggers on `accounts` are inspected
- THEN no trigger updates `balance`, and `accounts.balance` is written only by `PATCH /api/accounts/{id}` and the movement transaction

### Requirement: Account Delete Guard Blocks Referenced Accounts

`DELETE /api/accounts/{id}` MUST be blocked when the account has at least one movement. A blocked deletion MUST return **409 Conflict** with a Spanish message; the frontend MUST surface the block through a typed `finance.*` i18n key (e.g. `finance.accountDeleteBlocked`) and MUST NOT remove the account locally. Foreign or missing ids MUST still resolve to 404 (never 403) and unauthenticated requests to 401. The existing constraint mapping MUST be preserved: `23503 → 409` with a Spanish message, never 500.

#### Scenario: Account with movements cannot be deleted
- GIVEN an owned account with one movement
- WHEN `DELETE /api/accounts/{id}`
- THEN the system returns 409 with a Spanish message
- AND the account still exists with its balance unchanged

#### Scenario: Account without movements still deletes
- GIVEN an owned account with no movements and no other blocking reference
- WHEN `DELETE /api/accounts/{id}`
- THEN the system returns 204 and the account is gone

#### Scenario: Foreign account delete still reads as not found
- GIVEN an authenticated user
- WHEN they delete a foreign account id
- THEN the system returns 404 without leaking existence

#### Scenario: Frontend shows the blocked message
- GIVEN the delete confirmation for an account with movements
- WHEN the 409 arrives
- THEN the UI shows the Spanish message resolved from a typed `finance.*` key and keeps the account listed

### Requirement: Movement History List

The Finance screen MUST render a movements history section listing the most recent **50** movements of the caller in the API order (`occurred_on DESC`). Each row MUST show direction, amount formatted `es-CO`/`COP` through the existing money formatter, date in Spanish, category name, account name and the description when present. The section MUST offer filters by account, by category and by direction; activating an account card in Finance MUST set the account filter, which MUST be clearable. The section MUST handle `loading`, `error` and `empty` independently in Spanish, MUST refresh the `finance/movements` SWR scope after every mutation, and MUST apply `content-visibility: auto` to list rows. No pagination SHALL exist in v1.

#### Scenario: Recent movements render in order
- GIVEN 60 movements for the user
- WHEN the history renders
- THEN the 50 most recent appear ordered by `occurred_on` descending with COP amounts

#### Scenario: Account card click filters the history
- GIVEN the finance screen with accounts `A` and `B`
- WHEN the user activates account `A`
- THEN the history shows only movements of `A` and the active filter is visible and clearable

#### Scenario: Direction and category filters compose
- GIVEN movements of both directions in two categories
- WHEN the user filters direction `expense` and category `C`
- THEN only expense movements of `C` are listed

#### Scenario: Empty and error states
- GIVEN no movements, or a failed `GET /movements`
- WHEN the section renders
- THEN a Spanish `EmptyState` or a Spanish error panel with retry appears and the rest of Finance keeps rendering

### Requirement: Add Expense And Income UI

The Finance screen MUST expose exactly two entry controls — add expense and add income — each opening a modal with: Amount (required), Account (required, owned accounts by name, never UUID input), Category (required, all owned categories without kind restriction), Date (required, `YYYY-MM-DD`, defaulting to today) and Description (optional). Client-side validation MUST block the request with Spanish messages when a required field is missing, the amount is not a valid decimal string, or it has more than 2 decimals. On success the modal MUST show a CSS-only confirmation (no toast library), refresh the `finance/movements` scope and close returning focus to the control that opened it. Cancel and Esc MUST close without sending a request. Every control MUST be keyboard reachable with visible focus and a hit area of at least 44×44 CSS pixels, and all copy MUST come from typed `finance.*` i18n keys.

#### Scenario: Saving an expense reflects in balance
- GIVEN a user on Finance
- WHEN they submit an expense of `25000` on account `A`, category `C`, dated today
- THEN `POST /movements` is sent with the amount as a decimal string
- AND on success the confirmation shows and the account card and history revalidate

#### Scenario: Required validation blocks the request
- GIVEN the expense modal with no category selected
- WHEN the user submits
- THEN a Spanish validation message appears and no request is sent

#### Scenario: Esc closes and restores focus
- GIVEN an open modal
- WHEN the user presses Esc
- THEN the modal closes, no request is sent and focus returns to the opening control

#### Scenario: Editing and deleting from the history
- GIVEN a movement in the history list
- WHEN the user edits it (or deletes it after confirmation)
- THEN the FE sends the corresponding `PATCH` (or `DELETE`) and the balance shown on the account card updates

### Requirement: Movement Category Aggregation

Category aggregates (chart and compare) MUST be computed client-side over the movements response, grouped by `(category_id, direction)`. The chart MUST render a `gasto` series and an `ingreso` series when both directions have at least one movement in the aggregated set, and a single series otherwise. The compare view MUST show per-category expense and income side by side; values MUST NOT be netted into one signed number. Aggregation MUST be single-currency: only movements whose owning account currency equals the user currency (`GET /me`, fallback COP) participate; movements on accounts in any other currency MUST be excluded, never summed as if they were the user currency. No per-movement currency field is introduced and no conversion is performed. Rows without a category (possible only through a database-level deletion) MUST be excluded from category aggregates rather than lumped into a bucket. No `GET /movements/stats` endpoint SHALL be created.

#### Scenario: Two series when both directions exist
- GIVEN category `C` with one expense `"100.00"` and one income `"50.00"`
- WHEN the chart renders
- THEN `C` shows a gasto bar of 100 and an ingreso bar of 50, never a netted 50

#### Scenario: Single series otherwise
- GIVEN categories with expenses only
- WHEN the chart renders
- THEN only the gasto series is mounted

#### Scenario: Foreign-currency accounts are excluded
- GIVEN the user currency is COP and an account `USD` holds movements
- WHEN totals and charts aggregate
- THEN the `USD` movements are excluded from the COP aggregates and no sum mixes currencies

#### Scenario: Compare never nets
- GIVEN category `C` with expenses `"100.00"` and incomes `"20.00"`
- WHEN the compare view renders
- THEN it shows expense 100 and income 20 as separate figures

## Edge cases

- An archived account keeps its movements visible in history; archiving hides the account from active lists but MUST NOT delete or hide movement rows.
- A movement deleted after a subscription payment reverses the balance but MUST NOT recompute `subscriptions.last_paid_on`/`next_billing_on` (cycle state is not re-derived from the audit row; no trigger, no cron).
- Concurrent writes on the same account serialize on the account row lock; the second writer applies against the value the first left behind.
- A movement whose `amount` is valid but whose category belongs to another user MUST be rejected as 422 (FK + ownership check), never persisted with a null category.

## Non-goals

- No transfers, budgets, recurring movements, multi-currency ledger semantics or currency conversion.
- No per-account movement drill-down, no pagination, no `GET /movements/stats`, no MCP movement tools.
- No new dependencies (charts stay div-bars, modals stay native, confirmation stays CSS-only); flag and stop if implementation appears to need one.
- No balance history, snapshot or valuation series for accounts beyond the movement rows themselves.
