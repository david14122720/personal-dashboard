# Delta for Finance Transactions

**Scope.** Remove the transaction ledger end to end: `POST/GET /api/transactions`, `PATCH/DELETE /api/transactions/{id}`, `GET /api/transactions/stats/by-category`, `GET /api/transactions/stats/monthly-flow`, `backend/src/routes/transactions.rs`, the `transactions` table with its indexes, triggers and functions, the `transaction_type` enum usage, the ledger/capture/history UI, the six transaction MCP tools, the flow/category charts and their consumers, transaction i18n keys, and the transaction specs. Slice S3, delivered together with migration 0011 and the manual balance write path (see `finance-accounts`, `finance-core-invariants`).

**Edge cases.** The `transfer` enum value cannot be dropped in place — the removal MUST rely on table deletion first and accept an orphaned type as fallback (see `finance-core-invariants`). A card's link to its expenses disappears, so card debt is whatever the manual `balance` says. Any client caching an aggregate endpoint MUST be treated as gone.

**Non-goals.** No lightweight income/expense register, no replacement monthly flow, no category spend analytics, no history of balances, no compatibility shim for removed endpoints.

## REMOVED Requirements

### Requirement: Transaction Creation

(Removed behaviour: recording an income or expense against an owned account, with server-side validation of amount, date and ownership, and a DB trigger moving the account balance.)
(Reason: the user does not keep a ledger; the trigger was the only writer of `accounts.balance`, which becomes user-owned data operated by `PATCH /api/accounts/{id}`.)
(Migration: rows are destroyed by migration 0011. **No backup is taken (explicitly accepted).** Account balances keep their last stored value, which is now editable by hand. `objetivo.md` MUST record the reversal with date and reason.)

### Requirement: Transaction Immutability

(Removed behaviour: core financial fields were immutable and only description/notes were patchable, to avoid balance desync.)
(Reason: the desync risk disappears with the trigger; the resource is gone.)
(Migration: corrections of a past week/month are no longer expressible — the balance is whatever the user states today.)

### Requirement: Transaction Deletion

(Removed behaviour: deleting a transaction reversed its balance effect through the trigger.)
(Reason: no ledger and no trigger remain.)
(Migration: None — a wrong balance is corrected by editing the balance again, with no history of either value.)

### Requirement: Credit Card Purchase Linkage

(Removed behaviour: linking expenses to a card account, moving the card balance, rejecting over-limit purchases and income linkage with 422.)
(Reason: card spend is no longer itemised; the over-limit guard has no input and MUST NOT be re-implemented as a balance-write constraint.)
(Migration: a card's debt becomes the manual `balance` value; metrics derived from it MUST keep working (see `credit-card-summary`).)

### Requirement: Authenticated Transaction List

(Removed behaviour: `GET /transactions` with reverse-chronological order, filters by account/category/type/date, keyset pagination with cursor and limit, string amounts, 401 unauthenticated and empty pages for unknown filters.)
(Reason: the ledger is deleted; the list had no remaining consumer once capture and ledger UI were removed.)
(Migration: `TransactionsLedger`, its SWR hooks, its keys and its i18n copy MUST be deleted; no replacement list is in scope.)

### Requirement: Aggregate Reads for Dashboard Charts

(Removed behaviour: `GET /transactions/stats/by-category` and `GET /transactions/stats/monthly-flow` returned server-side aggregate money values scoped to the caller.)
(Reason: the aggregates were the only source of monthly flow and category spend; with the ledger gone they are deleted instead of left empty, so no widget, report or progress block may depend on them (see `frontend-dashboard`, `dashboard-widgets`, `reports-screen`, `progress-score`).)
(Migration: every consumer MUST be re-pointed to a surviving source or removed in the same slice; `STATEMENT_BALANCE_SQL`, `ACCOUNT_MOVEMENT_COUNT_SQL` and the MCP `list/create/update/delete_transaction` plus `stats_transactions_by_category`/`stats_transactions_monthly_flow` tools MUST be deleted with it (see `mcp-dashboard`).)
