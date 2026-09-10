# finance-debts Specification

## Purpose

Tracking of owed amounts (debts) and the history of payments made towards them, including automatic status transitions.

## Requirements

### Requirement: Debt Management

The system MUST allow users to create, read, and delete debt records.

#### Scenario: Create Debt
- GIVEN an authenticated user
- WHEN the user creates a debt with a lender name and total amount
- THEN the system SHALL create the debt and set `pending_amount` equal to the total amount
- AND set status to `active`
- AND return 201 Created

#### Scenario: Access Other User's Debt
- GIVEN an authenticated user
- WHEN the user attempts to retrieve a debt ID belonging to another user
- THEN the system MUST return 404 Not Found

### Requirement: Debt Payments

The system MUST allow recording payments against an active debt.

#### Scenario: Valid Payment
- GIVEN a debt with `pending_amount` 500.00
- WHEN the user records a payment of 100.00
- THEN the system SHALL record the payment
- AND the debt's `pending_amount` MUST be updated to 400.00 via trigger
- AND return 201 Created

#### Scenario: Overpayment Guard
- GIVEN a debt with `pending_amount` 100.00
- WHEN the user attempts to record a payment of 150.00
- THEN the system MUST return 422 Unprocessable Entity (Overpayment forbidden)

#### Scenario: Invalid Money Format
- GIVEN an authenticated user
- WHEN the user submits a payment with an invalid amount string
- THEN the system MUST return 422 Unprocessable Entity

### Requirement: Debt Status Lifecycle

The system MUST automatically transition debt status when fully paid.

#### Scenario: Debt Paid Off Trigger
- GIVEN a debt with `pending_amount` 50.00
- WHEN a payment of 50.00 is recorded
- THEN the system MUST set `pending_amount` to 0
- AND automatically transition status to `paid_off`
- AND return 201 Created

### Requirement: Data Integrity

The system MUST prevent illegal state transitions.

#### Scenario: Payment to Paid Off Debt
- GIVEN a debt with status `paid_off`
- WHEN the user attempts to record a payment
- THEN the system MUST return 422 Unprocessable Entity

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/debts-write/spec.md (alias draft resolved to wire names) -->

### Requirement: Debt Patch Endpoint

The system MUST expose `PATCH /debts/{id}` with `deny_unknown_fields` and allowlist exactly `name, creditor, due_date, installment, interest_rate, notes`. The system MUST never accept `pending_amount, status` (trigger-owned) — attempts MUST yield 422. Amounts MUST be decimal strings; dates `YYYY-MM-DD`. The system MUST set `updated_at = now()` and return 200 on success.

#### Scenario: Happy-path edit meta

- GIVEN an authenticated user owning debt `{id}`
- WHEN `PATCH /debts/{id}` with `{"creditor": "Banco X", "installment": "200000.00"}`
- THEN the system returns 200 with the updated fields

#### Scenario: Trigger-owned field rejected

- GIVEN an authenticated user owning debt `{id}`
- WHEN `PATCH /debts/{id}` with `{"pending_amount": "0.00"}`
- THEN the system returns 422 with a Spanish error

### Requirement: Debt Patch Guards

The system MUST reject patches on debts with status != active with 422, validate owned categories where applicable, and map `23505→409`, `23514/23503→422` with Spanish messages.

#### Scenario: Patch paid-off debt rejected

- GIVEN a debt with status `paid_off`
- WHEN `PATCH /debts/{id}` with `{"notes": "x"}`
- THEN the system returns 422

### Requirement: Debt Payments History

The system MUST expose `GET /debts/{id}/payments` returning the caller's payment history for that debt in a stable order with string amounts. Foreign or missing debt MUST return 404.

#### Scenario: History lists payments

- GIVEN a debt with two payments `"100.00"` and `"50.00"`
- WHEN `GET /debts/{id}/payments`
- THEN the system returns 200 with both entries and string amounts

### Requirement: Debt Payment Delete With Reversal

The system MUST expose `DELETE /debts/{id}/payments/{pid}` returning 204; the existing trigger MUST revert `pending_amount`/status. The handler MUST verify payment ownership, debt ownership, and active-only guard. Deleting the only payment of a `paid_off` debt MUST be rejected with 422 unless the debt is active (correction happens while active; UX recreates after delete).

#### Scenario: Delete reverts pending

- GIVEN an active debt with pending `"400.00"` after a `"100.00"` payment
- WHEN `DELETE /debts/{id}/payments/{pid}`
- THEN the system returns 204 and pending returns to `"500.00"`

#### Scenario: Delete foreign payment reads as not found

- GIVEN an authenticated user
- WHEN `DELETE /debts/{foreign_debt}/payments/{pid}`
- THEN the system returns 404

### Requirement: Debt Payment Create Guards Preserved

`POST /debts/{id}/payments` MUST keep existing guards: active-only, `amount <= pending`, string amount `> 0`, ownership checks. Violations MUST return 401/404/422 with Spanish messages.

#### Scenario: Overpayment rejected

- GIVEN a debt with pending `"100.00"`
- WHEN `POST /debts/{id}/payments` with `{"amount": "150.00"}`
- THEN the system returns 422

### Requirement: No Payment Patch

No `PATCH` for payments SHALL exist by design (amounts immutable like transactions). UX "editable" MUST be implemented as DELETE + recreate with explicit confirmation.

#### Scenario: Correct abono via UX recreate

- GIVEN a payment `"100.00"` recorded as `"1000.00"` by mistake
- WHEN the user confirms correction in the UI
- THEN the FE sends `DELETE .../payments/{pid}` then `POST .../payments` with the corrected string amount

### Requirement: Debt Write Auth and Ownership

Both PATCH and payment endpoints MUST require authentication (401 unauthenticated, Spanish). Foreign debt or payment access MUST return 404, never 403.

#### Scenario: Unauthenticated payment list rejected

- GIVEN no `Authorization` header
- WHEN `GET /debts/{id}/payments`
- THEN the system returns 401

### Requirement: Debt Payments UI

The FE MUST provide a manual Spanish debt section: new abono form (string amount), visible payment history, and a progress bar showing debo/aboné/falta with percentage from pure view-models (string→number coercion only in the transform layer). Correction MUST be delete + recreate with confirmation. Selectors by name, always COP, `finance.*` i18n keys only, `finance/` SWR refresh.

#### Scenario: User sees progress and history

- GIVEN a debt of `"500.00"` with one abono `"100.00"`
- WHEN the debt section renders
- THEN it shows debo `"500.00"`, aboné `"100.00"`, falta `"400.00"`, 20% progress, and the payment in history
