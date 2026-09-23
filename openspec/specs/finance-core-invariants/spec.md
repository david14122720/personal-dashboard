# Finance Core Invariants Specification

## Purpose

Cross-cutting invariants of the finance simplification: removal sequencing with no dangling references, ownership of the shared finance validation helpers, migration discipline for the destructive migration, the post-migration schema shape, hermetic tests for surviving modules, and the explicit no-backup decision.

## Scope

- In: compile/test integrity of the workspace across the removal slices (S0–S3), the location and behaviour of shared validation helpers, migration **0011** discipline and its post-conditions, test-fixture hygiene for surviving modules, and the recorded no-backup/no-dual-read decision.
- Out: individual endpoint contracts (see `finance-accounts`, `finance-debts`, `finance-savings`), removed capability contracts (see `finance-transactions`, `finance-transfers`, `finance-budgets`), UI composition (see `frontend-dashboard`, `dashboard-widgets`, `reports-screen`, `progress-score`), and MCP tool surface (see `mcp-dashboard`).
- Slices: S0 (helpers extraction + fixture replacement) is the enabler; S1–S3 MUST hold these invariants after every merge.

## Requirements

### Requirement: Removal Sequencing Without Dangling References

Each removal slice MUST land a workspace that builds and whose test suites pass, with zero surviving references to removed capabilities. No source file, test, migration, document or spec under active use MAY reference a removed route (`/transactions`, `/transfers`, `/budgets`), table (`transactions`, `budgets`), enum/type (`transaction_type`), trigger, function (`apply_transaction_to_balance`, `apply_transfer_counterparty`), component or MCP tool name.

#### Scenario: Backend builds and suite is green per slice

- GIVEN the workspace after any removal slice
- WHEN `cargo test` runs in `backend/`
- THEN it compiles and passes

#### Scenario: Frontend suite is green per slice

- GIVEN the workspace after any removal slice
- WHEN `pnpm test` runs in `frontend/`
- THEN it passes with no test importing a removed module

#### Scenario: Dead references removed

- GIVEN the final state of the change
- WHEN the repository is searched for removed route paths, table names and tool names
- THEN no live reference remains outside the specs that document the removal

### Requirement: Shared Finance Validation Helper Ownership

The date validation used by finance writes and the finance-kind category validation MUST live in a module that survives the removals, and every consumer MUST keep identical observable behaviour: an invalid or missing date MUST yield 422 and a foreign or wrong-kind category MUST yield 422, with Spanish messages.

#### Scenario: Invalid date still rejected

- GIVEN any surviving finance write that accepts a date (account, debt payment, savings movement)
- WHEN the caller sends an unparseable date
- THEN the system returns 422 and persists nothing

#### Scenario: Wrong-kind or foreign category still rejected

- GIVEN any surviving finance write that accepts a category
- WHEN the caller sends a category that is not owned or not of the required kind
- THEN the system returns 422 and persists nothing

#### Scenario: Helpers have a surviving home

- GIVEN the final state of the change
- WHEN the helper definitions are located
- THEN they are defined outside the removed modules and imported by every surviving consumer

### Requirement: Migration Discipline

The removals MUST be delivered as a new migration file **0011** with autocommit-compatible statements. Previously applied migrations (`0002`, `0005`, and the rest) MUST NOT be edited, and the existing assertion test that guards them MUST keep passing. Within 0011 the order MUST be: drop inbound foreign-key columns, then drop the removed tables (cascading their indexes and triggers), then drop the removed functions, then attempt to drop `transaction_type`.

#### Scenario: Applied migrations untouched

- GIVEN the migration history present before the change
- WHEN the change is applied
- THEN `0002_finance.sql` and `0005_*` are byte-identical to their previous content and the guard test passes

#### Scenario: 0011 is additive-destructive and idempotent-safe to review

- GIVEN the new migration file
- WHEN it is reviewed
- THEN it contains only removals of the removed capability objects plus the inbound FK column drops, and no data migration, backup or re-creation of removed objects

#### Scenario: Update triggers of surviving tables are untouched

- GIVEN `debt_payments`, `savings_goal_movements`, `accounts`, `debts`, `subscriptions`, `assets` and habit/productivity tables
- WHEN 0011 is applied
- THEN their columns, triggers and constraints other than the dropped `transaction_id` columns are unchanged

### Requirement: Post-Migration Schema Shape

After 0011 the database MUST contain no `transactions` table, no `budgets` table, no function `apply_transaction_to_balance()`, no function `apply_transfer_counterparty()`, and no column of the `transaction_type` enum type. `debt_payments.transaction_id` and `savings_goal_movements.transaction_id` MUST NOT exist. `accounts.balance` MUST still exist and MUST NOT be modified by any trigger. The removed enum type MUST either be dropped or, if a dependent object is unexpectedly found, left orphaned; re-creating the enum and re-converting columns MUST NOT be used.

#### Scenario: Removed objects are gone

- GIVEN a database with 0011 applied
- WHEN the catalog is inspected
- THEN the two tables, both functions and every `transaction_type` column are absent

#### Scenario: Inbound FK columns are gone

- GIVEN the same database
- WHEN `debt_payments` and `savings_goal_movements` are inspected
- THEN neither has a `transaction_id` column and their own `amount`/date columns remain

#### Scenario: No trigger writes balance

- GIVEN an account row
- WHEN any surviving write path runs
- THEN `accounts.balance` changes only when a caller explicitly updates it

#### Scenario: Enum fallback never recreates the type

- GIVEN a dependent object that blocks `DROP TYPE transaction_type`
- WHEN the migration is adapted
- THEN the accepted outcome is an orphaned type with no owning column, never a `CREATE TYPE` plus column re-conversion

### Requirement: Hermetic Tests For Surviving Modules

Tests of surviving modules MUST NOT insert into removed tables and MUST NOT depend on data created by removed features. Balances and debts MUST be arranged through the surviving write paths or direct column updates on surviving tables.

#### Scenario: No test seeds a removed table

- GIVEN the backend test suite after the change
- WHEN tests of accounts, debts, savings and subscriptions run
- THEN none of them inserts into `transactions` or `budgets`

#### Scenario: Account balance arranged directly

- GIVEN a test that needs a non-zero account balance
- WHEN it arranges the fixture
- THEN it sets `accounts.balance` directly on the surviving table

### Requirement: No-Backup And No-Dual-Read Decision

The change MUST NOT include data migration, backup/dump automation, compatibility views, or dual-read code for the removed tables. The historical loss is intentional and MUST be recorded in the change artifacts and re-confirmed at the deployment gate before 0011 runs against production.

#### Scenario: No migration code exists

- GIVEN the change diff
- WHEN it is searched for backup, dump, restore or compatibility-view code
- THEN none exists

#### Scenario: Deploy gate reconfirms the loss

- GIVEN a deployment that would apply 0011
- WHEN the gate is executed
- THEN the destructive data loss is explicitly reconfirmed by the owner before the migration runs

### Requirement: Atomic Deployability Of Removal And Manual Balance

No deployable build MAY exist in which the transaction routes are absent while the manual balance write is still unavailable. The transaction removal, the migration and the account balance write path MUST land in the same slice so balances are never frozen with no way to correct them.

#### Scenario: Same-slice landing

- GIVEN the S3 slice diff
- WHEN it is reviewed
- THEN it contains the migration, the `PATCH` balance capability and the removal of the transaction routes together

#### Scenario: Wiring test asserts the pair

- GIVEN the backend wiring tests after S3
- WHEN they run
- THEN they assert that `PATCH /api/accounts/{id}` accepts `balance` and that no transaction route is mounted

### Requirement: Governing Document Reversal Recorded

`objetivo.md` MUST be edited in the same change that removes the capabilities it mandates. The "Transferencias" and "Presupuestos" sections MUST be replaced by (i) the rule that an account balance is written by hand, (ii) a reversal note carrying the date and the reason (the ledger and budgets were not used, their maintenance cost exceeded their value, and the manual balance covers the use case), and (iii) an updated financial-charts section that no longer lists charts whose only source was the removed monthly flow. No other part of the document MAY change.

#### Scenario: Mandated sections are replaced

- GIVEN the updated `objetivo.md`
- WHEN the transfer and budget sections are read
- THEN they no longer mandate transfers or budgets and instead record the manual balance rule plus the dated reversal reason

#### Scenario: Charts section loses flow-based entries

- GIVEN the updated charts section
- WHEN it is read
- THEN income-vs-expense, savings evolution and month-comparison charts sourced from the removed flow are gone or explicitly withdrawn

#### Scenario: No unrelated edits

- GIVEN the document diff produced by the change
- WHEN it is inspected
- THEN only the sections described here differ from the previous version

### Requirement: Frontend Test Suite Alignment

Tests whose subject was removed MUST be deleted or rewritten against surviving behaviour in the same slice as the removal. No test file MAY import a removed module, assert a removed component or mock a removed endpoint, and the end-to-end section sweep MUST cover only sections that still exist.

#### Scenario: No test imports a removed module

- GIVEN `frontend/` after the change
- WHEN every test file's imports are resolved
- THEN none imports a removed component, hook or API module

#### Scenario: Rewritten tests assert surviving behaviour

- GIVEN a test suite that previously asserted flow, category or budget behaviour
- WHEN it runs after the change
- THEN it either no longer exists or asserts surviving behaviour only

#### Scenario: Section sweep updated

- GIVEN the end-to-end section sweep
- WHEN it runs
- THEN it covers surviving sections and no longer asserts the presence of removed ones

## Edge cases

- A surviving module may still declare a DTO field for the removed link (`transaction_id`); that field MUST be deleted from request and response shapes, not merely left unset (see `finance-debts`, `finance-savings`).
- A migration test that asserts the absence of removed objects MUST tolerate the orphaned-enum fallback.
- If a surviving table turns out to keep a `RESTRICT` foreign key to `accounts`, its guard MUST be expressed against that live table, never against a removed one (see `finance-accounts`).

## Non-goals

- No new aggregation, history or snapshot model for account balances.
- No changes to asset valuations or their INSERT-only pattern.
- No migration of `api_tokens` scopes.
- No re-introduction of any removed capability under a new name.
