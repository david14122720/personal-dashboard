# Delta for Finance Core Invariants

**Scope.** Cross-cutting invariants are extended from the 0011-era removals to this change's two migrations and their slices: **0012** is additive (`movements`, its indexes and enum, `subscriptions.last_paid_on`) and **0013** is destructive and gated (`savings_goals`, `savings_goal_movements`, `debts`, `debt_payments` plus `update_savings_goal_saved()`/`update_debt_pending()`). New invariants: the movement balance write is an application transaction (never a trigger), the destructive migration requires explicit owner authorization at apply time plus a deploy-gate re-confirmation, and the chain order is fixed so no deployable build ever reads a removed route. Requirement "Atomic Deployability Of Removal And Manual Balance" keeps its historical 0011 meaning and is not restated here.

**Edge cases.** 0013 is created in the change folder but MUST NOT be applied in any environment (local dev database included) before the owner's apply-time authorization. A test that asserts the absence of removed objects MUST tolerate the orphaned-enum fallback recorded for 0011.

**Non-goals.** No data migration, backup/dump automation, compatibility views or dual-read for the removed tables; no resurrection of the removed capabilities under new names; no re-introduction of a trigger that writes `accounts.balance`.

## MODIFIED Requirements

### Requirement: Removal Sequencing Without Dangling References

Each removal slice MUST land a workspace that builds and whose test suites pass, with zero surviving references to removed capabilities. No source file, test, migration, document or spec under active use MAY reference a removed route (`/transactions`, `/transfers`, `/budgets`, `/savings-goals`, `/debts`), table (`transactions`, `budgets`, `savings_goals`, `savings_goal_movements`, `debts`, `debt_payments`), enum/type (`transaction_type`), trigger or function (`apply_transaction_to_balance`, `apply_transfer_counterparty`, `update_savings_goal_saved`, `update_debt_pending`), component or MCP tool name.
(Previously: the list covered only the transaction/transfer/budget removals of the parent change.)

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
- WHEN the repository is searched for removed route paths, table names, function names and tool names
- THEN no live reference remains outside the specs that document the removal

#### Scenario: No UI reads a removed route at any point

- GIVEN any merge point of the slice chain before the gated migration
- WHEN the frontend requests are inspected
- THEN no request targets `/savings-goals*` or `/debts*` and no component imports their hooks or forms

### Requirement: Shared Finance Validation Helper Ownership

The date validation used by finance writes and the category ownership validation MUST live in a module that survives the removals (`finance/validation.rs`), and every consumer MUST keep identical observable behaviour: an invalid or missing date MUST yield 422 with a Spanish message, and a foreign or missing category MUST yield 422 with a Spanish message. Category kind MUST NOT gate any write: `ensure_finance_category` and `ensure_subscription_category` MUST verify ownership only.
(Previously: both helpers enforced a kind — `finance` for finance writes, `subscription` for subscriptions — and cross-kind writes were rejected with 422.)

#### Scenario: Invalid date still rejected

- GIVEN any surviving finance write that accepts a date (movement, subscription pay)
- WHEN the caller sends an unparseable date
- THEN the system returns 422 and persists nothing

#### Scenario: Foreign or missing category still rejected

- GIVEN any surviving finance write that accepts a category (movement write, subscription write)
- WHEN the caller sends a category that is not owned or does not exist
- THEN the system returns 422 and persists nothing

#### Scenario: Kind no longer gates writes

- GIVEN an owned category of any kind
- WHEN it is used as the category of a movement or a subscription
- THEN the write succeeds and no kind check runs

#### Scenario: Helpers have a surviving home

- GIVEN the final state of the change
- WHEN the helper definitions are located
- THEN they are defined outside any removed module and imported by every surviving consumer

### Requirement: Migration Discipline

The change MUST be delivered as two new migration files and MUST NOT edit previously applied migrations. **0012** is additive: it creates the `movements` table, its enum and indexes, and the `subscriptions.last_paid_on` column, and MUST NOT modify or drop any pre-existing object. **0013** is destructive and gated: it drops `savings_goals`, `savings_goal_movements`, `debts`, `debt_payments` and their trigger functions, in the 0011 order (inbound foreign-key columns → tables → functions) with autocommit-compatible statements, and MUST NOT run before the explicit owner authorization gate (see "Gated Destructive Migration 0013"). The existing assertion test that guards previous migrations MUST keep passing.
(Previously: the discipline described a single destructive migration 0011; additive migrations and a second gated destructive migration did not exist.)

#### Scenario: Applied migrations untouched

- GIVEN the migration history present before the change
- WHEN the change is applied
- THEN `0001`–`0011` are byte-identical to their previous content and the guard test passes

#### Scenario: 0012 is additive and reviewable

- GIVEN the new additive migration
- WHEN it is reviewed
- THEN it contains only `CREATE TABLE`/`CREATE TYPE`/`CREATE INDEX`/`ALTER TABLE ... ADD COLUMN` statements and no modification or deletion of pre-existing objects

#### Scenario: 0013 is removal-only and idempotent-safe to review

- GIVEN the gated migration
- WHEN it is reviewed
- THEN it contains only removals of the retired capability objects plus the inbound FK column drops, and no data migration, backup or re-creation

#### Scenario: Update triggers of surviving tables are untouched

- GIVEN `accounts`, `subscriptions`, `assets`, `asset_valuations`, `movements` and habit/productivity tables
- WHEN 0012 and 0013 are applied
- THEN their surviving columns, triggers and constraints are unchanged

### Requirement: Post-Migration Schema Shape

After **0012** the database MUST contain the `movements` table (shape per `finance-movements`), its three indexes and the `subscriptions.last_paid_on` column, and MUST still contain no trigger that writes `accounts.balance`. After **0013** the database MUST contain no `savings_goals` table, no `savings_goal_movements` table, no `debts` table, no `debt_payments` table, no `update_savings_goal_saved()` function and no `update_debt_pending()` function. The 0011-era post-conditions (`transactions`/`budgets` absent, `transaction_type` enum absent or orphaned, no trigger writes balance) MUST remain true.
(Previously: the requirement described only the post-0011 shape.)

#### Scenario: 0012 objects exist

- GIVEN a database with 0012 applied
- WHEN the catalog is inspected
- THEN `movements`, its indexes and `subscriptions.last_paid_on` exist and are usable

#### Scenario: 0013 removed objects are gone

- GIVEN a database with 0013 applied
- WHEN the catalog is inspected
- THEN the four tables and both functions are absent

#### Scenario: No trigger writes balance

- GIVEN an account row
- WHEN any surviving write path runs (manual PATCH or movement transaction)
- THEN `accounts.balance` changes only because the application wrote it, never because a trigger fired

#### Scenario: Enum fallback never recreates the type

- GIVEN a dependent object that blocks a `DROP TYPE`
- WHEN the migration is adapted
- THEN the accepted outcome is an orphaned type with no owning column, never a `CREATE TYPE` plus column re-conversion

### Requirement: Hermetic Tests For Surviving Modules

Tests of surviving modules MUST NOT insert into removed tables (`transactions`, `budgets`, `savings_goals`, `savings_goal_movements`, `debts`, `debt_payments`) and MUST NOT depend on data created by removed features. Balances MUST be arranged through the surviving write paths (manual `PATCH balance` or the movement transaction) or direct column updates on surviving tables; movement fixtures MUST go through the API or the `movements` table.
(Previously: the removed-table list covered only `transactions` and `budgets`.)

#### Scenario: No test seeds a removed table

- GIVEN the backend test suite after the change
- WHEN tests of accounts, subscriptions, movements and assets run
- THEN none of them inserts into `transactions`, `budgets`, `savings_goals`, `savings_goal_movements`, `debts` or `debt_payments`

#### Scenario: Account balance arranged directly

- GIVEN a test that needs a non-zero account balance without a movement
- WHEN it arranges the fixture
- THEN it sets `accounts.balance` directly on the surviving table

#### Scenario: Movement fixtures follow the real path

- GIVEN a test that needs a movement
- WHEN it arranges the fixture
- THEN it uses the movements API or the `movements` table and the balance effect it asserts comes from the transaction under test

### Requirement: No-Backup And No-Dual-Read Decision

The change MUST NOT include data migration, backup/dump automation, compatibility views, or dual-read code for the removed tables of 0011 or 0013. The historical loss is intentional and MUST be recorded in the change artifacts and re-confirmed at the deployment gate before 0013 runs against production.
(Previously: the decision named 0011 only; it now covers both destructive migrations.)

#### Scenario: No migration code exists

- GIVEN the change diff
- WHEN it is searched for backup, dump, restore or compatibility-view code
- THEN none exists

#### Scenario: Deploy gate reconfirms the loss

- GIVEN a deployment that would apply 0013
- WHEN the gate is executed
- THEN the destructive data loss (savings goals, their movements, debts and their payments) is explicitly reconfirmed by the owner before the migration runs

### Requirement: Governing Document Reversal Recorded

`objetivo.md` MUST be edited in this same change, mirroring the parent change's precedent. The finance rule "an account balance is written by hand" MUST be amended with a **dated ledger-reintroduction reversal note**: balance is written by manual `PATCH` (corrections) **and** by the movement transaction (recorded expense/income), a movements section replaces the withdrawn flow-based chart entries, and the rules that mandated the removed savings/debts sections are withdrawn. The previous dated reversal record MUST remain readable; only the mandated sections MAY change.
(Previously: the requirement recorded the parent's reversal — transfers/budgets replaced by the manual-balance rule — and did not contemplate a ledger re-introduction.)

#### Scenario: Ledger reversal note is dated and readable

- GIVEN the updated `objetivo.md`
- WHEN the finance rules are read
- THEN they record the dated reversal of the "balance written by hand only" rule and name the movement transaction as the second write path

#### Scenario: Charts section reflects the movements source

- GIVEN the updated charts section
- WHEN it is read
- THEN the category chart and compare views are described as movement-sourced (gasto/ingreso) and the withdrawn flow-based entries are not reintroduced

#### Scenario: Prior reversal history preserved

- GIVEN the document diff produced by the change
- WHEN it is inspected
- THEN the parent-era rules remain readable except in the mandated sections, which now carry both dated reversals

#### Scenario: No unrelated edits

- GIVEN the document diff produced by the change
- WHEN it is inspected
- THEN only the sections described here differ from the previous version

### Requirement: Frontend Test Suite Alignment

Tests whose subject was removed MUST be deleted or rewritten against surviving behaviour in the same slice as the removal. No test file MAY import a removed module, assert a removed component or mock a removed endpoint; MSW handlers for savings and debts MUST be deleted with their consumers, movement tests MUST key on `direction` (not on the removed kind semantics), and the end-to-end section sweep MUST cover only sections that still exist.
(Previously: the requirement covered the parent change's removed modules; direction-based movement tests and the retirement of savings/debts tests did not exist.)

#### Scenario: No test imports a removed module

- GIVEN `frontend/` after the change
- WHEN every test file's imports are resolved
- THEN none imports a removed component, hook or API module (savings, debts)

#### Scenario: Rewritten tests assert surviving behaviour

- GIVEN a test suite that previously asserted savings or debt behaviour
- WHEN it runs after the change
- THEN it either no longer exists or asserts surviving behaviour only

#### Scenario: Movement tests are direction-based

- GIVEN the movement and chart test suites
- WHEN they assert aggregation behaviour
- THEN they use `(category, direction)` fixtures and no kind-based fixture

#### Scenario: Section sweep updated

- GIVEN the end-to-end section sweep
- WHEN it runs
- THEN it covers the surviving finance sections (accounts, subscriptions, assets, movements, chart) and no longer asserts the presence of removed ones

## ADDED Requirements

### Requirement: Movement Balance Write Discipline

The movement balance effect MUST be applied in an application-level database transaction inside the request that writes the movement row; no database trigger SHALL write `accounts.balance`. `accounts.balance` MUST have exactly two writers: the manual `PATCH /api/accounts/{id}` and the movement transaction (insert/delete/edit with signed-delta reversal). A rollback MUST leave neither a movement row nor a balance delta.

#### Scenario: No trigger exists

- GIVEN the schema after 0012
- WHEN triggers on `accounts` are inspected
- THEN none updates `balance`

#### Scenario: Exactly two writers

- GIVEN the final codebase
- WHEN writes to `accounts.balance` are searched
- THEN only the manual PATCH and the movement transaction write it

#### Scenario: Failure leaves no partial effect

- GIVEN a movement insert or update whose transaction fails after the movement row was staged
- WHEN the request returns an error
- THEN no movement row and no balance change survive

### Requirement: Gated Destructive Migration 0013

`openspec/changes/finance-simplify-movements/migrations/0013_remove_savings_debts.sql` MUST exist in the change folder (staged, not applied) but MUST NOT be copied into `backend/migrations/` nor applied — in the local development database, CI, or production — until the owner authorizes it explicitly at sdd-apply time. The recorded gate order MUST be: (1) explicit owner authorization at apply time; (2) deploy-gate re-confirmation of the intentional data loss with the no-backup posture restated; (3) 0013 runs only after every reversible slice has merged and every reference to the removed routes and tables has been cleared. No automatic runner MAY apply 0013 before the gate.

#### Scenario: File exists but is not applied

- GIVEN the change folder and a database at the 0012 state
- WHEN migrations are listed
- THEN 0013 exists as a file and no environment has it applied

#### Scenario: Gate sequence is recorded

- GIVEN the change artifacts
- WHEN the gate is read
- THEN it names the apply-time owner authorization and the deploy-time re-confirmation, in that order

#### Scenario: No automatic application

- GIVEN the local and CI pipelines
- WHEN they run before the gate
- THEN neither applies 0013

### Requirement: Movement And Removal Chain Ordering

No deployable build MAY exist in which a UI reads a removed route or the subscription pay flow references a missing movement primitive. The chain MUST be: the movements endpoints and the balance mechanics land together (S-A is atomic by construction); no frontend slice MAY read a removed route at any merge point; all frontend removal and cascade slices MUST merge before 0013; 0013 is the last slice and the only gated one.

#### Scenario: Movements land atomically

- GIVEN the S-A slice diff
- WHEN it is reviewed
- THEN it contains the migration, the movement routes and the transactional balance effect together

#### Scenario: Frontend removals precede the destructive migration

- GIVEN the merge order
- WHEN the chain is inspected
- THEN every frontend slice that deletes savings/debts reads has merged before 0013 is applied

#### Scenario: No 404-producing build

- GIVEN any merge point of the chain
- WHEN the frontend requests are inspected
- THEN no request targets a route that the backend no longer mounts

### Requirement: No New Dependencies And Local-Only Delivery

The change MUST NOT add, install or upgrade any dependency: no `Cargo.toml`/`Cargo.lock` addition, no `package.json`/lockfile addition for the frontend or the MCP server, and no chart, modal, toast, date or state library. If a slice appears to need one, the work MUST STOP and the need MUST be flagged instead of installing. Delivery MUST stay local: no commit, push or deploy is performed by this change.

#### Scenario: Manifests and lockfiles unchanged

- GIVEN the change diff
- WHEN the Rust, frontend and MCP manifests and lockfiles are compared with their previous versions
- THEN no dependency entry was added, removed or bumped

#### Scenario: Existing stack is sufficient

- GIVEN the movements, pay, chart and modal implementations
- WHEN their imports are inspected
- THEN they use only existing dependencies (SWR, sqlx, React/Next, existing UI primitives)

#### Scenario: Delivery is local

- GIVEN the completed change
- WHEN the repository history is inspected
- THEN no commit, push or deploy was performed
