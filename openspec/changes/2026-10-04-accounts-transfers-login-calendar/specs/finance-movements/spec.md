# Delta for Finance Movements

**Scope.** The ledger gains a third direction, `transfer`, and the shape the owner chose for money movement between own accounts: one `movements` row with `account_id` = origin, `transfer_account_id` = destination, `category_id` NULL and `subscription_id` NULL, created through a new `POST /api/movements/transfer` and reversed with two balance legs on delete. Transfers carry no category, never appear in income/expense or category aggregates, and cannot be edited. The existing expense/income contract, atomic balance effect, history list and modal flow stay in force; only the parts listed below change. This delta withdraws the canonical non-goal «No transfers» and the `finance-movements` purpose sentence that says "no transfers": a transfer now exists as one ledger row, but the deleted `/api/transfers` module, its groups, its trigger and its history UI do not return.

**Edge cases.** `account_id` is the origin for a transfer; the destination is only in `transfer_account_id`. The stored `amount` stays positive and the direction carries the sign (origin is debited, destination credited). Transfers between accounts with different currencies are rejected with 422 — a deliberate refusal consistent with the single-currency rule and the earlier currency-leak fix, never a silent conversion. A transfer cannot point at its own origin account. Deleting an account that is either leg of a transfer is blocked by the `ON DELETE RESTRICT` foreign keys (and counted by the account-delete 409 guard, including when the account is only the destination). A transfer has no category and no client-provided subscription link, so category aggregation is excluded by construction and the exclusion is additionally pinned by tests. The 50-row history and the dashboard snapshot render transfers as a third row kind, never as income. Transfers are listed through the existing `(user_id, occurred_on DESC, created_at DESC, id DESC)` index.

**Non-goals.** No `/api/transfers` route, no `apply_transfer_counterparty` function, no transfer group id, no transfer table, no transfer page, no transfer chart, no transfer MCP tool, no currency conversion, no recurring or scheduled transfers, no transfer editing (`PATCH` is 422 because a two-leg reversal plus lock ordering is out of scope for this change), no transfer category, no partial transfer, no fees.

## MODIFIED Requirements

### Requirement: Movement Record Model

The system MUST persist movements in the existing table (0012) extended by the additive migrations **0014** (enum value) and **0015** (column and constraints), shaped exactly as binding decision D4 plus the transfer extension:

`movements(id UUID PK, user_id UUID FK→users ON DELETE CASCADE, account_id UUID FK→accounts ON DELETE RESTRICT NOT NULL, transfer_account_id UUID FK→accounts ON DELETE RESTRICT NULL, category_id UUID FK→categories ON DELETE SET NULL NULL, direction movement_direction NOT NULL, amount NUMERIC(18,2) NOT NULL CHECK (amount > 0), occurred_on DATE NOT NULL, description TEXT NULL, subscription_id UUID FK→subscriptions ON DELETE SET NULL NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`.

- `direction` MUST hold exactly the values `expense`, `income` and `transfer`; the stored `amount` is always positive and the direction carries the sign.
- For `direction = 'transfer'`, `account_id` MUST be the origin, `transfer_account_id` the destination and `category_id` MUST be NULL; for `expense`/`income`, `transfer_account_id` MUST be NULL.
- The consistency CHECK `chk_transfer_account_presence` MUST enforce `(direction = 'transfer') = (transfer_account_id IS NOT NULL)`.
- The CHECK `chk_transfer_not_self` MUST enforce `transfer_account_id IS NULL OR transfer_account_id <> account_id`.
- The CHECK `chk_transfer_no_category` MUST enforce `(direction <> 'transfer') OR (category_id IS NULL)`.
- Both account foreign keys MUST be `ON DELETE RESTRICT`, so deleting an account referenced as the origin or the destination of a transfer is blocked by integrity, not only by an application check.
- The partial index `idx_movements_transfer_account` on `(transfer_account_id)` MUST support destination lookups and the `ON DELETE RESTRICT` probe, and MUST NOT replace or alter the 0012 indexes.
- `0014` MUST add the value with `ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer'` **outside any explicit transaction block** (a value cannot be used in the transaction that added it — Postgres `55P04`), with a comment stating that reason, and MUST contain no other statement; `0015` MUST add the column, the CHECKs and the index in its own `BEGIN; … COMMIT;`, safe only because 0014 committed earlier, and is the only file that may reference the value in a statement other than its declaration (0014 declares it, 0016 never mentions it). Neither file MAY modify or drop the pre-existing indexes or the `amount > 0` check.

#### Scenario: Three directions exist after 0014
- GIVEN a database with 0014 applied
- WHEN the `movement_direction` enum is inspected
- THEN it holds exactly `expense`, `income` and `transfer`

#### Scenario: Transfer row shape is enforced
- GIVEN a direct insert into `movements`
- WHEN it stores `direction = 'transfer'` with NULL or self-referencing `transfer_account_id`, stores a `transfer` with a non-null `category_id`, or stores `expense`/`income` with a non-null `transfer_account_id`
- THEN the CHECK constraints reject the row

#### Scenario: Destination account is protected
- GIVEN a transfer from account `A` to account `B`
- WHEN `DELETE /api/accounts/{B}` is attempted
- THEN the database rejects the delete with `23503` and the API returns 409 in Spanish, exactly as for an origin account with movements

### Requirement: Movement REST Contract

The system MUST keep the existing user-scoped endpoints with `deny_unknown_fields` and decimal-string wire money, extended by the transfer path:

- `GET /api/movements` — list the caller's movements ordered `occurred_on DESC, created_at DESC, id DESC`; no pagination in v1.
- `POST /api/movements` — create an expense or income; the request allowlist MUST stay exactly `direction` (`expense`/`income` only), `amount`, `account_id`, `category_id`, `occurred_on` and optional `description`; `subscription_id` and `transfer_account_id` MUST be rejected as unknown.
- `POST /api/movements/transfer` — create a transfer; the request allowlist MUST be exactly `from_account_id`, `to_account_id`, `amount` (decimal string > 0, at most 2 decimals, below 10^6), `occurred_on` (`YYYY-MM-DD`) and optional `description`. Every other field (`direction`, `category_id`, `subscription_id`, `transfer_account_id`) MUST be rejected as unknown with 422. The response MUST be 201 with the standard movement shape plus `transfer_account_id`, `direction` `transfer` and `category_id` null. It MUST return 422 in Spanish when the two accounts are the same, when either account is foreign or missing, when the two accounts have different currencies, or when amount/date/description fail their checks.
- `GET /api/movements/{id}` — read one owned movement.
- `PATCH /api/movements/{id}` — edit an expense/income; the request allowlist MUST stay exactly `direction` (`expense`/`income`), `amount`, `account_id`, `category_id`, `occurred_on`, `description`; `subscription_id` and `transfer_account_id` MUST be rejected as unknown; a `PATCH` against a stored `transfer` row MUST return 422 with a Spanish message before any balance change and no request MAY set `direction` to `transfer`.
- `DELETE /api/movements/{id}` — 204; for a transfer it reverses both legs.

Responses MUST serialize `amount` as a decimal string, `occurred_on` as `YYYY-MM-DD` and include `id`, `direction`, `amount`, `occurred_on`, `description`, `account_id`, `transfer_account_id`, `category_id`, `subscription_id`, `created_at`, `updated_at`. Violations MUST be Spanish: 401 without a token; 404 for a foreign or missing URL-addressed movement id (never 403); 422 for a missing required field, an unknown field, a non-string or out-of-range amount and an unparseable date.
(Previously: the contract knew exactly two directions; `POST /movements` required `category_id`; responses had no `transfer_account_id`; no transfer endpoint existed.)

#### Scenario: Create a transfer through the dedicated endpoint
- GIVEN an authenticated user owning same-currency accounts `A` and `B`
- WHEN `POST /movements/transfer` with `{"from_account_id":"<A>","to_account_id":"<B>","amount":"25000.00","occurred_on":"2026-10-04"}`
- THEN the system returns 201 with `direction` `"transfer"`, `account_id` `A`, `transfer_account_id` `B`, `category_id` null and `amount` `"25000.00"`

#### Scenario: Transfer request rejects everything outside the allowlist
- GIVEN an authenticated user
- WHEN the transfer body carries `direction`, `category_id`, `subscription_id` or `transfer_account_id`, or an amount as a JSON number, or a missing account
- THEN the system returns 422 with a Spanish message and persists nothing

#### Scenario: Same-account and cross-currency transfers are rejected
- GIVEN accounts `A` and `B` with different currencies, and a self-transfer request `A → A`
- WHEN each is submitted
- THEN both return 422 in Spanish and no movement row or balance change survives

#### Scenario: Transfer rows cannot be patched
- GIVEN a stored transfer
- WHEN `PATCH /movements/{id}` is called with any body
- THEN the system returns 422 with a Spanish message, both balances are unchanged and no field is written

#### Scenario: Expense and income creation is unchanged
- GIVEN an authenticated user owning account `A` and category `C`
- WHEN `POST /movements` with the existing expense body
- THEN the system returns 201 with `transfer_account_id` null and the same validation precedence as before

### Requirement: Atomic Balance Effect

The balance effect of a movement MUST be applied by an application-level database transaction in the same request that writes the movement row. No database trigger SHALL write `accounts.balance`.

- `POST` (expense/income): insert the row and apply the signed delta — `expense` subtracts `amount`, `income` adds `amount` — in one transaction.
- `POST /api/movements/transfer`: lock both accounts in ascending UUID order, insert the transfer row, subtract `amount` from `from_account_id` and add `amount` to `to_account_id`, all in one transaction.
- `DELETE`: reverse the same signed delta in one transaction; for a transfer, lock both accounts in ascending UUID order and undo both legs (`+amount` on the origin, `-amount` on the destination).
- `PATCH`: reverse the old signed delta and apply the new signed delta in one transaction, including when `account_id` changes; a stored transfer MUST be rejected before any delta math.
- The signed-delta helper MUST fail closed: any direction outside `expense`/`income`/`transfer` MUST be an error, never an implicit addition. `expense` and `transfer` are negative on the origin; `income` is positive.
- On any failure the transaction MUST roll back completely: no movement row, no partial balance change and no `updated_at` mutation MAY survive a partially failed operation.
- The account row locks MUST serialise concurrent writers; two opposite transfers (`A→B` and `B→A`) MUST NOT deadlock because the lock set is ordered by ascending UUID.

#### Scenario: Transfer moves both balances atomically
- GIVEN account `A` with balance `"100000.00"` and account `B` with balance `"50000.00"`
- WHEN a transfer of `"25000.00"` from `A` to `B` is created
- THEN the response is 201, `A.balance` is `"75000.00"`, `B.balance` is `"75000.00"` and exactly one movement row exists with `direction` `transfer`

#### Scenario: Deleting a transfer restores both balances
- GIVEN the transfer above
- WHEN `DELETE /movements/{id}`
- THEN the response is 204, `A.balance` is `"100000.00"`, `B.balance` is `"50000.00"` and the row is gone

#### Scenario: Failed transfer leaves no partial effect
- GIVEN a transfer whose second account is concurrently deleted
- WHEN the transaction fails on the foreign key
- THEN the API returns Spanish 422/404, no row exists and neither balance moved

#### Scenario: Unknown direction never adds money
- GIVEN the signed-delta helper
- WHEN it is called with a direction outside `expense`/`income`/`transfer`
- THEN it returns an error and no balance update is issued

#### Scenario: Opposite transfers do not deadlock
- GIVEN concurrent `A→B` and `B→A` transfers
- WHEN both run
- THEN both serialise on the ascending-UUID lock order and each commits or fails cleanly

### Requirement: Movement History List

The Finance screen MUST render the movements history listing the most recent **50** movements in API order (`occurred_on DESC`). Each row MUST show direction, amount formatted `es-CO`/`COP`, date in Spanish, category name when present, account name and the description when present; a transfer row MUST show its origin and destination account names and MUST NOT be labelled «Ingreso». The section MUST offer filters by account, by category and by direction, where the direction filter MUST include `Transferencia`; a transfer row MUST NOT offer the edit control (correction is delete + recreate). The section MUST handle `loading`, `error` and `empty` in Spanish, MUST refresh `finance/movements` and `dashboard/accounts` after every mutation, and MUST keep `content-visibility: auto`. No pagination SHALL exist in v1.
(Previously: the history knew exactly two directions and every row offered edit; nothing distinguished a transfer.)

#### Scenario: Transfers render as transfers
- GIVEN a transfer from `Ahorros` to `Nequi` among other movements
- WHEN the history renders
- THEN the row shows `Transferencia: Ahorros → Nequi` and never `Ingreso`, with the amount formatted COP

#### Scenario: Direction filter includes transfers
- GIVEN movements of all three directions
- WHEN the user filters direction `Transferencia`
- THEN only transfer rows are listed

#### Scenario: Transfers are delete-only
- GIVEN a transfer row
- WHEN the user inspects it
- THEN no edit control is offered and delete requires confirmation, after which both balances update

### Requirement: Movement Category Aggregation

Category aggregates (chart and compare) MUST be computed client-side over the movements response, grouped by `(category_id, direction)`, and MUST exclude transfers entirely: a `direction === "transfer"` row MUST NOT contribute to any expense or income series, any total, any trend, any pie or any category figure, regardless of its absent category. Every aggregation helper MUST gate on `expense`/`income` explicitly (no "non-expense is income" default). The single-currency rule stays unchanged and applies to transfers too. No `GET /movements/stats` endpoint SHALL be created and no transfer chart, transfer total or net-transfer figure MAY be introduced.
(Previously: the requirement excluded rows without a category and defined the two-series rule, but the direction handling had no transfer case and three transforms treated non-expense as income.)

#### Scenario: Transfers never enter a category aggregate
- GIVEN category `C` with one expense `"100.00"`, one income `"50.00"` and one transfer of `"500.00"` in the same period
- WHEN the category chart, the compare view, the totals trend and the expense pie run
- THEN the transfer contributes nowhere, including the income series, and the figures stay `100`/`50`

#### Scenario: Transfer-only period is empty
- GIVEN a period whose only movement is a transfer
- WHEN the chart, trend and pie render
- THEN the period has no expense and no income and the empty states show

#### Scenario: Currency rule applies to transfers
- GIVEN user currency COP and a transfer between USD accounts
- WHEN aggregates run
- THEN the transfer is excluded and no converted value appears

### Requirement: Add Expense And Income UI

The Finance screen MUST expose exactly three entry controls — add expense, add income and transfer — each opening a modal. The transfer modal MUST contain: origin account (required, owned accounts by name, never UUID input), destination account (required, owned accounts by name), amount (required), date (required, `YYYY-MM-DD`, defaulting to today) and optional description. Client-side validation MUST block the request with Spanish messages when a required field is missing, origin and destination are equal, the amount is not a valid decimal string, or it has more than 2 decimals. On success the modal MUST show a CSS-only confirmation, refresh `finance/movements` and `dashboard/accounts`, and close returning focus to the opener. Cancel and Esc MUST close without sending a request. The expense/income modal MUST keep its two-direction contract and the edit modal MUST NEVER offer `transfer`. Every control MUST be keyboard reachable with visible focus, a hit area of at least 44×44 CSS pixels and typed `finance.*` i18n keys.
(Previously: exactly two entry controls, a two-option direction select and no transfer form.)

#### Scenario: Saving a transfer reflects in both balances
- GIVEN a user on Finance with accounts `A` and `B`
- WHEN they submit a transfer of `25000` from `A` to `B` dated today
- THEN `POST /movements/transfer` is sent with the amount as a decimal string and both account cards revalidate

#### Scenario: Same-account selection blocks the request
- GIVEN the transfer modal with origin and destination set to `A`
- WHEN the user submits
- THEN a Spanish validation message appears and no request is sent

#### Scenario: Expense and income modal unchanged
- GIVEN the add-expense modal
- WHEN it renders
- THEN its direction select still offers exactly Gasto and Ingreso and no transfer option

## ADDED Requirements

### Requirement: Transfer Exclusion Is Enforced At Every Aggregation Point

The change MUST exclude transfers at all ten points identified by `explore.md` §2 and each MUST be covered by a test: (1) `toCategoryMovementTotals`, (2) `toCategoryTrend`, (3) `toTotalTrend`, (4) `toExpenseByCategory`, (5) the movement row type and history filter, (6) the Dashboard `MovementsSnapshot` widget, (7) the pie/trend/category/compare sections that read the shared transforms, (8) the `isUserCurrencyMovement` guard (transfers obey it unchanged), (9) the backend balance effect (two legs, direction-aware and fail-closed), and (10) the MCP surface (no movement or transfer tool added). A verifier MUST be able to name the test that proves each point.

#### Scenario: The ten points are covered
- GIVEN the change diff and test suite
- WHEN each point of the ten-point inventory is checked
- THEN it has an explicit exclusion (or a documented unchanged rule for the currency guard) and a named passing test

#### Scenario: No default-to-income path remains
- GIVEN every frontend transform that reads `direction`
- WHEN its code is inspected
- THEN each branches on `expense`/`income`/`transfer` explicitly and no branch defaults a third value to income
