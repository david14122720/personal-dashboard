# Delta for Finance Budgets

**Scope.** Remove budgeting end to end: the `/api/budgets` routes (`POST`, `GET`, `GET/PATCH/DELETE /{id}`, `GET /{id}/status`), `backend/src/routes/budgets.rs`, the `budgets` table with its indexes and update trigger, `BudgetForm`/`BudgetsList`/`BudgetBars`, the budget LED and worst-status logic in the dashboard strip, budget insights, budget i18n keys, the MCP `list_budgets` tool and its README entry, and the transfers/budgets requirements in `objetivo.md`. Slice S2.

**Edge cases.** Removing the strip LED MUST NOT leave a slot rendering emptiness (see `frontend-dashboard`); a persisted `dashboard_layout` naming a removed widget MUST NOT break the home (see `dashboard-widgets`); budget-shaped insights MUST be dropped rather than shown with zeroed values.

**Non-goals.** No lighter "spending target" replacement, no per-category caps, no spending warnings, no history of past budgets.

## REMOVED Requirements

### Requirement: Budget Creation & Validation

(Removed behaviour: creating a per-category budget over a date range with amount, warn/over thresholds and notes, rejecting non-positive amounts and inverted periods with 422.)
(Reason: the user does not set budgets; the feature was never used in practice and only added surface to maintain.)
(Migration: budget rows are destroyed by migration 0011; `objetivo.md` MUST record the reversal with date and reason. **No backup is taken (explicitly accepted).**)

### Requirement: Budget Status Computation

(Removed behaviour: spent/remaining/percentage computed on demand from period transactions.)
(Reason: the computation depended on the transaction ledger being removed; without it a budget has no observable meaning.)
(Migration: consumers of spent/remaining/pct MUST stop rendering those figures.)

### Requirement: Threshold Alerting

(Removed behaviour: mapping the spend percentage to `ok`/`warn`/`over` status through the configured thresholds.)
(Reason: no spend percentage is computed after the ledger removal, so thresholds have no input.)
(Migration: the FE MUST NOT show any budget status chip, bar or colour.)

### Requirement: Budgets Collection With Inline Status

(Removed behaviour: `GET /budgets` returned the caller's budgets for the current period with inline `spent`, `remaining`, `pct` and `status`, decimal strings and 401 unauthenticated.)
(Reason: the endpoint is deleted with its module; no client keeps a compatible contract.)
(Migration: any cached client MUST be treated as gone; there is no read-compatible replacement.)

### Requirement: Budget Patch Endpoint

(Removed behaviour: `PATCH /budgets/{id}` with a fixed allowlist updated amount, period, thresholds, notes and category, returned 200 and set `updated_at`.)
(Reason: the resource no longer exists.)
(Migration: None — the route stops being mounted; requests receive the standard not-found behaviour of an unmounted path.)

### Requirement: Budget Patch Validation

(Removed behaviour: 422 with Spanish messages for invalid periods, non-positive amounts, threshold ordering, foreign/wrong-kind categories, and unknown fields; constraint mapping `23505→409`, `23514/23503→422`.)
(Reason: no patchable resource remains; its validation contract is deleted with it.)
(Migration: None.)

### Requirement: Budget Delete Endpoint

(Removed behaviour: `DELETE /budgets/{id}` returned 204 and removed the budget from the collection.)
(Reason: the resource no longer exists.)
(Migration: None.)

### Requirement: Budget Write Auth and Ownership

(Removed behaviour: 401 unauthenticated and 404 for foreign budgets on patch/delete, never 403.)
(Reason: no budget endpoint remains to protect; the same auth invariants stay in force for surviving finance endpoints.)
(Migration: None.)

### Requirement: Budgets Never Block

(Removed behaviour: budget status was visual only and never rejected a transaction.)
(Reason: neither budgets nor transactions exist after the change; the invariant has no subject.)
(Migration: None — no surviving write path may reference budget status.)

### Requirement: Budget Write Form

(Removed behaviour: FE budget create/edit form and confirmed delete with `finance/` SWR refresh, Spanish copy and string amounts.)
(Reason: the budget UI is removed together with its endpoints.)
(Migration: `BudgetForm`, `BudgetsList`, `BudgetBars`, `toBudgetViews` and the budget i18n keys MUST be deleted; the strip MUST NOT keep a budget LED; `list_budgets` MUST be removed from the MCP server and its README.)
