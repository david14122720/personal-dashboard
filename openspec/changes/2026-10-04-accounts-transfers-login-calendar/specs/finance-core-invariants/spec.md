# Delta for Finance Core Invariants

**Scope.** Three new authorized migrations (0014–0016) carrying this change's additive transfer objects and the destructive removal of the credit-card layer, with the same never-edit discipline as 0001–0013; the transfer direction is explicitly not a resurrection of the deleted `/transfers` capability; and `objetivo.md` receives the two dated reversal notes this change requires (cards, transfers). Removal sequencing, shared-helper ownership, hermetic tests, atomic deployability and local-only delivery stay in force unchanged.

**Edge cases.** The split is forced: 0014 adds the enum value with `ADD VALUE IF NOT EXISTS` outside any explicit transaction (using a new value in the transaction that added it raises `55P04`), 0015 adds the column, CHECKs and index and references `'transfer'` in its own transaction (safe only because 0014 committed earlier), and 0016 carries the destructive block; the guard test proves the per-file content, the 0014 → 0015 order and the destructive ordering. The destructive block is authorized and lossless in practice (production holds 5 accounts and 0 cards, so every card column is NULL). The transfer feature returns under a new shape (movement rows), so the no-dangling-references invariant must forbid the old route/function without forbidding the new direction, column and endpoint.

**Non-goals.** No data migration, backup, compatibility view or dual read for the removed card layer; no re-creation of `/transfers`, `apply_transfer_counterparty`, transfer groups or the old transfer UI; no change to 0001–0013; no new dependency; no commit, push or deploy.

## MODIFIED Requirements

### Requirement: Removal Sequencing Without Dangling References

Each removal slice MUST land a workspace that builds and whose test suites pass, with zero surviving references to removed capabilities. No source file, test, migration, document or spec under active use MAY reference a removed route (`/transactions`, `/transfers`, `/budgets`, `/savings-goals`, `/debts`), table (`transactions`, `budgets`, `savings_goals`, `savings_goal_movements`, `debts`, `debt_payments`), enum/type (`transaction_type`), trigger or function (`apply_transaction_to_balance`, `apply_transfer_counterparty`, `update_savings_goal_saved`, `update_debt_pending`), component or MCP tool name. This change additionally removes the `account_type` enum and its card columns/constraints (0016) and MUST leave no surviving reference to them either. The transfer capability MAY return **only** as the `movement_direction` value `transfer`, the `movements.transfer_account_id` column and the `POST /api/movements/transfer` endpoint; the `/transfers` route, the `apply_transfer_counterparty` function, transfer groups and the removed transfer history UI MUST remain absent, and none of them MAY be reintroduced under any name.
(Previously: the prohibition could be read as forbidding every return of transfer behaviour; this change scopes it to the removed implementation shapes while allowing the owner's one-ledger-row decision.)

#### Scenario: Removed account/card objects are gone
- GIVEN a database with 0014–0016 applied
- WHEN the catalog and the repository are searched for `account_type`, `chk_card_*`, `idx_accounts_user_card` and the four card/type columns
- THEN none exists in the database and no live source reference remains

#### Scenario: Transfer returns only in its new shape
- GIVEN the change diff
- WHEN the repository is searched for `/transfers`, `apply_transfer_counterparty` and transfer group identifiers
- THEN none is present, while the `transfer` enum value, the `transfer_account_id` column and `/api/movements/transfer` exist

#### Scenario: Backend and frontend suites are green per slice
- GIVEN the workspace after W1 and W2
- WHEN `cargo test` and `pnpm test` run
- THEN they compile and pass with no test importing or asserting a removed object

### Requirement: No-Backup And No-Dual-Read Decision

The change MUST NOT include data migration, backup/dump automation, compatibility views, or dual-read code for the removed tables of 0011 or 0013, **nor for the account type and credit-card columns dropped by 0016**. The historical loss is intentional and MUST be recorded in the change artifacts and re-confirmed at the deployment gate before any destructive migration runs against production. For 0016 the accepted loss is the credit-card semantic layer; the owner's 2026-10-04 decision records that production holds 0 credit-card accounts, so no card row, statement or usage figure is destroyed.
(Previously: the decision named the 0011 and 0013 removals only.)

#### Scenario: No migration code exists
- GIVEN the change diff
- WHEN it is searched for backup, dump, restore or compatibility-view code
- THEN none exists

#### Scenario: Card-layer loss is recorded and lossless
- GIVEN the change artifacts and the production catalog
- WHEN the accepted loss is checked
- THEN the artifacts state the 0-cards evidence, 0016 contains no backup or data-migration statement, and the owner authorization is recorded with its date

### Requirement: Frontend Test Suite Alignment

Tests whose subject was removed MUST be deleted or rewritten against surviving behaviour in the same slice as the removal. No test file MAY import a removed module, assert a removed component or mock a removed endpoint. This change additionally requires every test that asserted the account type chip, the Settings `row.type === "bank"` filter, the hardcoded `{"name","type":"bank"}` create payload or any card metric (`isCard`, `credit_limit`, `used_balance`, `available_balance`, `usage_pct`, `alert_level`, `statement_balance`) to be deleted or rewritten in W1, and every movement test to accept the third direction in W2.
(Previously: the requirement covered savings/debts modules and direction-based movement tests; the accounts type/card surface was not named.)

#### Scenario: No test asserts a removed account surface
- GIVEN `frontend/` after W1
- WHEN every test that touched accounts is inspected
- THEN none asserts an account type, a card metric or the `type === "bank"` filter

#### Scenario: Movement tests accept the third direction
- GIVEN the movement and aggregate tests after W2
- WHEN they run
- THEN transfer fixtures exist and the ten exclusion points are covered

## ADDED Requirements

### Requirement: Migrations 0014–0016 Discipline And Account-Type Removal

The change MUST add exactly three migration files — `backend/migrations/0014_movement_transfer_enum.sql`, `backend/migrations/0015_movement_transfer_account.sql` and `backend/migrations/0016_remove_account_type_and_card_fields.sql` — and MUST NOT edit `0001`–`0013`; `0008_credit_cards.sql` in particular MUST stay byte-identical (its historical CHECKs, partial index and dead `idx_tx_card_user_date` remain). The three files MUST be ordered and disciplined as follows:

1. `0014` adds the value with `ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer'` **outside any explicit transaction block** (using a new value in the transaction that added it raises `55P04`), with a comment stating that reason, and contains no other statement;
2. `0015`, in its own `BEGIN; … COMMIT;` and safe only because 0014 committed earlier, adds `movements.transfer_account_id` with its `ON DELETE RESTRICT` foreign key, the `chk_transfer_account_presence`, `chk_transfer_not_self` and `chk_transfer_no_category` CHECKs, and the `idx_movements_transfer_account` index; it is the only file that may reference the value in a statement other than its declaration (0014 declares it, 0016 never mentions it);
3. `0016` carries the destructive block, in exactly this order and without `CASCADE`: drop `chk_card_limit_presence`, `chk_card_limit_pos` and `chk_card_days_presence`; drop index `idx_accounts_user_card`; drop columns `credit_limit`, `statement_day`, `payment_due_day`; drop column `type`; drop type `account_type`;
4. no data migration, backup, dump, compatibility view, dual read or object re-creation; the destructive block is removal-only and owner-authorized (2026-10-04) as an accepted loss with the 0-cards evidence recorded;
5. the files MUST apply one at a time in numeric order with per-file autocommit, and `0014` and `0015` MUST never be folded into a single transaction.

A guard test (`backend/tests/migration_0014_0016_transfers_account_type.rs`) MUST assert the per-file content, the 0014 → 0015 order (the transfer objects before the destructive block), the absence of `CASCADE`, `CREATE TYPE`, `CREATE TABLE`, `BACKUP`, `DUMP` and any `transactions` reference, and the byte-identity proxy for `0008`. Live post-conditions MUST assert the final catalog (no type/card columns, no `account_type`, no `chk_card_*`, no `idx_accounts_user_card`; exactly three enum values; transfer column, FK, index and CHECKs present). Live destructive assertions MUST run against the dev database only — never production.

#### Scenario: 0014–0016 are three ordered files
- GIVEN the three migration files
- WHEN they are reviewed
- THEN 0014 contains only the enum `ADD VALUE IF NOT EXISTS` outside a transaction, 0015 contains the transfer column, its three CHECKs and its index inside its own transaction, and 0016 contains the destructive block in the stated order, with no `CASCADE` and no re-creation

#### Scenario: Applied migrations untouched
- GIVEN the migration history present before the change
- WHEN the change is applied
- THEN `0001`–`0013` are byte-identical and the existing guards (`migration_0008_credit_cards.rs`, `migration_0011_removal.rs`, `migration_0012_movements.rs`, `migration_0013_gate.rs`) still pass

#### Scenario: Post-conditions hold
- GIVEN a database with 0014–0016 applied
- WHEN the catalog is inspected
- THEN the type/card objects are absent, `movement_direction` holds exactly `expense`/`income`/`transfer`, and the transfer column, foreign key, index and all three CHECKs exist

#### Scenario: Destructive live checks stay off production
- GIVEN the 0014–0016 guard test
- WHEN it is run without an explicit dev `DATABASE_URL`
- THEN the destructive live assertions skip, and no documented run targets production

### Requirement: Governing Document Dated Reversal Notes

`objetivo.md` MUST be edited in this same change, mirroring the 2026-09-23 and 2026-09-24 precedents. Two sections change, each with a dated **2026-10-04** note:

- **Transferencias**: the note MUST record that the 2026-09-23 reversal is itself reversed, that money movement between own accounts is recorded as one ledger row (`direction = 'transfer'`, origin in `account_id`, destination in `transfer_account_id`, both balances adjusted atomically), and that no `/transfers` module, route, trigger or dedicated UI returns.
- **Cuentas**: the «Tarjeta de crédito» kind MUST be removed and the note MUST record the removal of the entire card layer (type, limit, cycle days, card metrics) as an owner decision, with the 0-cards production evidence.

Both previous dated notes MUST remain readable, and the diff MUST touch only those sections.

#### Scenario: Transfer reversal note is dated and readable
- GIVEN the updated `objetivo.md`
- WHEN the Transferencias section is read
- THEN it carries the 2026-10-04 note describing the one-ledger-row shape and the 2026-09-23 note is still readable

#### Scenario: Card removal is recorded
- GIVEN the updated Cuentas section
- WHEN it is read
- THEN no credit-card account kind is offered and the dated removal note names the owner decision and the 0-cards evidence

#### Scenario: No unrelated edits
- GIVEN the `objetivo.md` diff
- WHEN it is inspected
- THEN only the Transferencias and Cuentas sections differ from the previous version
