# Delta for Finance Debts — RETIRE

**Scope.** This capability is fully retired: every requirement below is removed. The owner never used Debts (scope point 1), the finance surface keeps only Accounts, Subscriptions (pay-only), Assets/net worth and the new movements ledger, and the four tables plus their two trigger functions are dropped by the gated destructive migration **0013** (`finance-core-invariants` owns the migration discipline and the apply-time authorization gate).

**Migration.** `debts` and `debt_payments` (and `update_debt_pending()`) are dropped by 0013 with no data migration, no backup and no compatibility view (standing no-backup decision, same as 0011). 0013 MUST NOT run until the owner authorizes it explicitly at apply time and the deploy gate re-confirms the data loss.

**Consumers removed with the capability.** Backend routes `/debts` and `/debts/{id}/payments*`; frontend `DebtPayments.tsx`, the debts shell/S5 blocks, `useDebts`/`useDebtPayments` hooks and `toDebtRows`; `mcp-dashboard` `list_debts`; i18n `finance.debts*`/`finance.manageDebts*`/`finance.paymentHistory*` key families; net-worth, upcoming-payments, notifications, progress-score and reports-screen inputs (each named in its own delta).

## REMOVED Requirements

### Requirement: Debt Management

(Reason: owner scope point 1 — the Debts feature was never used; its list/create/delete surface disappears with the Finance reduction.)
(Migration: None. Debt rows are intentionally destroyed by gated migration 0013; no replacement entity is created.)

### Requirement: Debt Payments

(Reason: the payment workflow is removed with its parent feature; the new movements ledger does not model debts.)
(Migration: None. Recorded payments are destroyed with 0013; the movement ledger starts from zero.)

### Requirement: Debt Status Lifecycle

(Reason: `pending_amount`/status transitions were trigger-owned and have no consumer once Debts is retired.)
(Migration: None. `update_debt_pending()` is dropped by 0013.)

### Requirement: Data Integrity

(Reason: the whole validation surface (paid-off payment rejection, orphan prevention) is deleted with the routes.)
(Migration: None.)

### Requirement: Debt Patch Endpoint

(Reason: `PATCH /debts/{id}` is removed with the route module.)
(Migration: None. No debt metadata is preserved.)

### Requirement: Debt Patch Guards

(Reason: guard semantics are deleted with the endpoint they protect.)
(Migration: None.)

### Requirement: Debt Payments History

(Reason: payment history has no consumer after the Debts UI is removed.)
(Migration: None. `debt_payments` rows are destroyed by 0013; nothing reads or exports them.)

### Requirement: Debt Payment Delete With Reversal

(Reason: delete-with-trigger-reversal disappears with the payments surface.)
(Migration: None.)

### Requirement: Debt Payment Create Guards Preserved

(Reason: the create guards are removed with the payments endpoint.)
(Migration: None.)

### Requirement: No Payment Patch

(Reason: the immutability rule is moot once payments no longer exist.)
(Migration: None.)

### Requirement: Debt Write Auth and Ownership

(Reason: authentication/ownership rules are removed with the endpoints they applied to.)
(Migration: None.)

### Requirement: Debt Payments Are Self-Contained

(Reason: the self-containment contract was about ledger independence; both the payments surface and the concern disappear.)
(Migration: None.)

### Requirement: Debt Payments UI

(Reason: the Finance Debts section, its forms and its progress bar are removed from the UI by scope point 1.)
(Migration: None. Any future debt-tracking need would be a new change, not a revival of this capability.)
