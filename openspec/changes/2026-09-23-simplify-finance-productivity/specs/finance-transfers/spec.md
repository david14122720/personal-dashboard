# Delta for Finance Transfers

**Scope.** Remove the atomic transfer capability end to end: the two `/api/transfers` routes, `backend/src/routes/transfers.rs`, the transfer-leg trigger function, `TransferHistory.tsx`, the transfer API layer, transfer i18n keys, the dedicated backend test file, and the transfers/transfer-cards requirements in `objetivo.md`. Slice S1. Paying a card or moving money between own accounts becomes two manual balance edits (see `finance-accounts`).

**Edge cases.** Transfer-only local state (movement group ids, keyset cursors) MUST NOT survive as dead code; the shared finance validation helpers MUST already have a surviving home before this slice (see `finance-core-invariants`); a card-payment habit MUST be answerable with the manual balance UI, never by a residual endpoint.

**Non-goals.** No replacement transfer UI, no "recent movements" view, no history or audit log, no reinterpretation of transfers as income/expense.

## REMOVED Requirements

### Requirement: Atomic Transfer Execution

(Removed behaviour: transfers were executed as one atomic DB transaction that emitted an expense leg for the source account and an income leg for the destination under a shared movement group id, updated both balances, and returned 201; same-account transfers were 422 and foreign accounts 404.)
(Reason: the user does not use transfers; the module's cost (route + tests + dedicated history UI) exceeds its value, and money movement between own accounts is fully covered by editing two manual balances.)
(Migration: no data conversion; transfer rows disappear with their legs in migration 0011; `objetivo.md` MUST record the reversal with date and reason. **No backup is taken (explicitly accepted).**)

### Requirement: Transfer Atomicity (Rollback)

(Removed behaviour: a failure while writing the second leg rolled back the whole transfer, leaving the source balance unchanged and no orphaned legs.)
(Reason: the guarantee belonged to a capability that no longer exists; manual balance edits are single-row writes with no cross-account invariant to preserve.)
(Migration: consumers relying on pairwise consistency MUST instead update both balances deliberately; nothing enforces or verifies the pair.)

### Requirement: Data Integrity

(Removed behaviour: transfer amounts travelled as decimal strings with scale ≤ 2 and never as floats.)
(Reason: no transfer DTO remains; the same money-on-the-wire rule is reasserted for the surviving manual balance write in `finance-accounts`.)
(Migration: None — the rule survives under `finance-accounts` and `finance-core-invariants`.)

### Requirement: Card Payments via Transfers

(Removed behaviour: paying a credit card bill was expressed as a transfer from a bank account to the card account, moving both balances.)
(Reason: card payment is now recorded by lowering the bank balance and raising the card balance manually; keeping a dedicated card-payment path would preserve the module being removed.)
(Migration: the card UI and copy MUST NOT mention transfers or card payments by transfer; card debt remains visible through `balance` and the derived card metrics.)
