# Delta for Finance Savings — RETIRE

**Scope.** This capability is fully retired: every requirement below is removed. Savings goals and deposits were never used (owner scope point 1), the Finance surface drops the Savings section, and `savings_goals`, `savings_goal_movements` and the `update_savings_goal_saved()` trigger are dropped by the gated destructive migration **0013** (`finance-core-invariants` owns the migration discipline and the apply-time authorization gate).

**Migration.** 0013 drops the two tables and the trigger function with no data migration, no backup and no compatibility view (standing no-backup decision, same as 0011). 0013 MUST NOT run until the owner authorizes it explicitly at apply time and the deploy gate re-confirms the data loss.

**Consumers removed with the capability.** Backend routes `/savings-goals` and `/savings-goals/{id}/movements*`; frontend `SavingsForms.tsx`, the savings shell/S5 blocks, `useSavingsGoals` (`fetchSavingsGoals`, `patchGoal`, `createMovement`, `deleteMovement`) and `toSavingsViews`; i18n `finance.savings*`/`finance.manageSavings*`/`finance.deposit*`/`finance.withdraw*`/`finance.overWithdrawal*` key families; the `upcoming-payments` debt union is untouched by this file but the savings reads in `dashboard-widgets`, `finance-assets`, `progress-score` and `reports-screen` are named in their own deltas.

## REMOVED Requirements

### Requirement: Savings Goal Management

(Reason: owner scope point 1 — the Savings feature was never used; its list/create/delete surface disappears with the Finance reduction.)
(Migration: None. Goal rows are intentionally destroyed by gated migration 0013; no replacement entity is created.)

### Requirement: Savings Movements

(Reason: the deposit/withdrawal workflow is removed with its parent feature; the new movements ledger is a different primitive (account-scoped expense/income), not a savings replacement.)
(Migration: None. Recorded movements are destroyed with 0013.)

### Requirement: Goal Completion State

(Reason: `is_completed` was trigger-owned and has no consumer once Savings is retired.)
(Migration: None. `update_savings_goal_saved()` is dropped by 0013.)

### Requirement: Data Integrity

(Reason: the orphan-prevention contract disappears with the movements endpoint it protected.)
(Migration: None.)

### Requirement: Savings Goal Patch Endpoint

(Reason: `PATCH /savings-goals/{id}` is removed with the route module.)
(Migration: None. No goal metadata is preserved.)

### Requirement: Savings Goal Patch Validation

(Reason: validation semantics are deleted with the endpoint they protect.)
(Migration: None.)

### Requirement: Savings Movements Write Preserved

(Reason: the append-only signed-movement contract has no consumer after the Savings UI is removed.)
(Migration: None.)

### Requirement: Savings Movements Are Self-Contained

(Reason: the self-containment contract was about ledger independence; both the savings surface and the concern disappear.)
(Migration: None.)

### Requirement: Savings Goal Delete

(Reason: goal delete is removed with the route module.)
(Migration: None.)

### Requirement: Savings Write Auth and Ownership

(Reason: authentication/ownership rules are removed with the endpoints they applied to.)
(Migration: None.)

### Requirement: Savings Forms

(Reason: the Finance Savings forms and deposit/withdraw controls are removed from the UI by scope point 1.)
(Migration: None. Any future savings-tracking need would be a new change, not a revival of this capability.)
