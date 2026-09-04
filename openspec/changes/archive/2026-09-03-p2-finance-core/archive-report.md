# Archive Report: p2-finance-core

## Change Overview
**Change**: `p2-finance-core`
**Status**: CLOSED (Pass)
**Archive Date**: 2026-09-03
**Archived Path**: `openspec/changes/archive/2026-09-03-p2-finance-core`

## Final State Authority
This report reflects the state AT CLOSE, overriding intermediate snapshots in `apply-progress` and `verify-report`.

### Completion Visibility
- **Tasks**: 27/27 complete [x].
- **Verification**: PASS.
- **Execution History**:
  - Planning $\rightarrow$ Implementation (PR1-PR4) $\rightarrow$ Verify (FAIL) $\rightarrow$ Test-Harness Remediation (commit `06c0724`) $\rightarrow$ Final Verify (PASS).
- **Test Evidence**: 95/95 green (90 unit + 5 integration) executed against live PG 18.6. Zero SKIP lines.

### Spec Compliance
All 24 scenarios across 4 specs are compliant and verified:
- `finance-accounts`: COMPLIANT
- `finance-transactions`: COMPLIANT
- `finance-transfers`: COMPLIANT (including rollback atomicity)
- `finance-budgets`: COMPLIANT (including status walk)

## Residual State & Risks

### Warnings (Carried to Close)
1. **Production Trigger Drift**: The production DB still runs the pre-0005 trigger. Migration `0005` (additive `CREATE OR REPLACE`) MUST be deployed synchronously with this code to prevent transfers from double-applying or skipping balances.
2. **Testing Gap**: DB-gated tests never ran in CI (due to missing `DATABASE_URL`). Prior CRITICALs were hidden by SKIP-masking. Recommendation: Implement a live-DB gate for all future finance-domain changes.

### Suggestions
- **API Consistency**: `PATCH /transactions/:id` core-field rejection currently surfaces as a generic Axum `JsonRejection` (422). Recommend mapping this to the project's standard `VALIDATION_ERROR` envelope.

## Artifacts Synced
The following delta specs were merged into the main source of truth:
- `openspec/specs/finance-accounts/spec.md` (Created)
- `openspec/specs/finance-transactions/spec.md` (Created)
- `openspec/specs/finance-transfers/spec.md` (Created)
- `openspec/specs/finance-budgets/spec.md` (Created)

## Verification Readback
Mechanical archival verified via `diff -r` between pre-move snapshot and archived tree: **No differences found.**
