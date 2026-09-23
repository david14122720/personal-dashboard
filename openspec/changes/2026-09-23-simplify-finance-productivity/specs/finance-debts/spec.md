# Delta for Finance Debts

**Scope.** Make debt payments self-contained after the ledger removal: no `transaction_id` column, no ledger ownership guard, no ledger identifier on the payment wire. Debt creation, status lifecycle, patch rules, delete-with-reversal and UI contracts are unchanged. Slice S3 (relies on the FK column drop in migration 0011, see `finance-core-invariants`).

**Edge cases.** A payment previously linked to a ledger entry loses only that link — its `amount`, `paid_on`, `payment_method` and notes MUST survive untouched. A client that still sends a ledger id MUST be rejected as an unknown field (422) rather than silently accepted. `pending_amount` reversal on delete MUST keep working through the existing trigger.

**Non-goals.** No replacement "source of funds" linkage, no bank-account association for payments, no payment patch endpoint, no change to overpayment or status guards.

## MODIFIED Requirements

### Requirement: Debt Payments History

The system MUST expose `GET /debts/{id}/payments` returning the caller's payment history for that debt in a stable order with string amounts. Each entry MUST be self-contained (`amount`, `paid_on`, `payment_method`, `notes`, `created_at`) and MUST NOT expose a ledger identifier. Foreign or missing debt MUST return 404.
(Previously: each payment row carried the optional `transaction_id` of the ledger entry that funded it.)

#### Scenario: History lists payments

- GIVEN a debt with two payments `"100.00"` and `"50.00"`
- WHEN `GET /debts/{id}/payments`
- THEN the system returns 200 with both entries and string amounts

#### Scenario: No ledger identifier on the wire

- GIVEN a payment history response
- WHEN its fields are inspected
- THEN no `transaction_id` (or equivalent ledger reference) is present

#### Scenario: Existing payments keep their own data

- GIVEN a payment recorded before the change with a ledger link
- WHEN the history is read after the change
- THEN its amount, date, payment method and notes are unchanged and only the link is gone

### Requirement: Debt Payment Create Guards Preserved

`POST /debts/{id}/payments` MUST keep its guards: active-only, `amount <= pending`, string amount `> 0`, and debt ownership checks. It MUST NOT perform any ledger ownership check, and a payload carrying a ledger identifier MUST be rejected with 422 because the request schema rejects unknown fields. Violations MUST return 401/404/422 with Spanish messages.
(Previously: the handler also verified that an optional `transaction_id` belonged to the caller, returning 422 otherwise.)

#### Scenario: Overpayment rejected

- GIVEN a debt with pending `"100.00"`
- WHEN `POST /debts/{id}/payments` with `{"amount": "150.00"}`
- THEN the system returns 422

#### Scenario: Ledger field rejected as unknown

- GIVEN an active debt
- WHEN `POST /debts/{id}/payments` includes a `transaction_id` field
- THEN the system returns 422 and records no payment

#### Scenario: Valid payment recorded without a link

- GIVEN an active debt with pending `"500.00"`
- WHEN `POST /debts/{id}/payments` with amount `"100.00"` and a date
- THEN the system returns 201, the payment is self-contained and `pending_amount` becomes `"400.00"`

### Requirement: No Payment Patch

No `PATCH` for payments SHALL exist by design (amounts are immutable). UX "editable" MUST be implemented as DELETE + recreate with explicit confirmation.
(Previously: the immutability rationale was stated by analogy with transactions, a module that no longer exists.)

#### Scenario: Correct abono via UX recreate

- GIVEN a payment `"100.00"` recorded as `"1000.00"` by mistake
- WHEN the user confirms correction in the UI
- THEN the FE sends `DELETE .../payments/{pid}` then `POST .../payments` with the corrected string amount

## ADDED Requirements

### Requirement: Debt Payments Are Self-Contained

A debt payment MUST be fully described by its own amount, date, payment method and notes, with no dependency on any ledger row. The request schema MUST NOT contain a ledger field, the persistence MUST NOT hold a foreign key to a removed table, and the FE payment form and history MUST NOT offer or render any ledger selector or identifier.

#### Scenario: Payment form has no ledger control

- GIVEN the debt payment form rendered
- WHEN its inputs are inspected
- THEN no ledger/movement selector or identifier field is present

#### Scenario: No removed-table query

- GIVEN the payment create, list and delete paths
- WHEN their SQL is inspected
- THEN none references a removed table
