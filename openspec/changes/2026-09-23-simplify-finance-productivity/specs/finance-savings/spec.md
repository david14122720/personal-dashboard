# Delta for Finance Savings

**Scope.** Make savings movements self-contained after the ledger removal: no `transaction_id` column or wire field, no ledger validation. Goal management, movement append-only behaviour, completion trigger, patch rules and forms are unchanged. Slice S3 (relies on the FK column drop in migration 0011, see `finance-core-invariants`).

**Edge cases.** A movement that previously linked a ledger entry keeps its own amount, date and notes. A client still sending a ledger id MUST be rejected as an unknown field (422). Over-withdrawal protection and `saved_amount`/`is_completed` reversal on delete MUST keep working.

**Non-goals.** No "funding account" association for deposits or withdrawals, no movement patch endpoint, no change to the goal completion trigger or to the savings forms beyond dropping the removed field.

## MODIFIED Requirements

### Requirement: Savings Movements Write Preserved

The system MUST keep movements append-only: abonar/retirar via `POST /savings-goals/{id}/movements` with signed string amount and date, and correction exclusively via `DELETE /savings-goals/{id}/movements/{mid}` + recreate. No ledger identifier MAY be accepted or returned, and a request carrying one MUST be rejected with 422. No `PATCH` for movements SHALL exist. Over-withdrawal (resulting balance < 0) MUST return 422. DELETE MUST return 204 and the trigger MUST revert `saved_amount`/`is_completed`.
(Previously: a movement could optionally reference the ledger entry that funded it, validated for ownership.)

#### Scenario: Deposit and withdraw

- GIVEN a goal with balance `"100.00"`
- WHEN `POST .../movements` with `{"amount": "50.00"}` then `{"amount": "-30.00"}`
- THEN responses are 201 and balance becomes `"120.00"`

#### Scenario: Correct movement via delete plus recreate

- GIVEN a movement `{mid}` of `"+50.00"` recorded by mistake
- WHEN `DELETE .../movements/{mid}` then `POST .../movements` with `{"amount": "80.00"}`
- THEN the first returns 204 with balance reverted and the second returns 201

#### Scenario: Over-withdrawal rejected

- GIVEN a goal with balance `"100.00"`
- WHEN `POST .../movements` with `{"amount": "-150.00"}`
- THEN the system returns 422 with a Spanish error

#### Scenario: Ledger field rejected as unknown

- GIVEN an owned savings goal
- WHEN `POST .../movements` includes a ledger identifier field
- THEN the system returns 422 and records no movement

## ADDED Requirements

### Requirement: Savings Movements Are Self-Contained

A savings movement MUST be fully described by its own signed amount, date and optional notes, with no dependency on any ledger row. The request and response schemas MUST NOT contain a ledger field, the persistence MUST NOT hold a foreign key to a removed table, and the savings UI MUST NOT offer or render any ledger selector or identifier.

#### Scenario: Movement form has no ledger control

- GIVEN the savings deposit/withdrawal form rendered
- WHEN its inputs are inspected
- THEN no ledger/movement selector or identifier field is present

#### Scenario: No ledger identifier on the wire

- GIVEN a movement list or create response
- WHEN its fields are inspected
- THEN no `transaction_id` (or equivalent ledger reference) is present

#### Scenario: No removed-table query

- GIVEN the movement create, list and delete paths
- WHEN their SQL is inspected
- THEN none references a removed table
