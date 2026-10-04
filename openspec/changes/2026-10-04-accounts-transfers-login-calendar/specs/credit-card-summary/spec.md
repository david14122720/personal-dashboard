# Delta for Credit Card Summary

**Scope.** The `credit-card-summary` capability is retired in full by owner decision 2026-10-04. Every requirement below is removed, together with its backend computation, wire fields, frontend components/copy and tests. No replacement capability is created: accounts no longer have a type, a limit, cycle days, usage metrics, alert levels or a statement figure, and patrimonio is assets-only (`finance-assets`). This file is the delete-record for the capability; once synced, `openspec/specs/credit-card-summary/` has no surviving requirement.

**Edge cases.** Production holds 5 accounts and 0 credit-card accounts (`explore.md` §0/§1), so every removed column is NULL and every removed figure was never produced for real data — the deletion is a capability retirement, not a data loss event. A reader who remembers a card surface MUST find the removal stated here and in `finance-accounts`, `finance-assets` and `frontend-i18n`, never a renamed substitute.

**Non-goals.** No replacement card model, no credit-limit tracking, no statement cycle, no usage alert, no card-specific net-worth treatment, no data export of the removed fields before the drop.

## REMOVED Requirements

### Requirement: Usage Metrics Calculation

(Removed behaviour: `used_balance`, `available_balance` and `usage_pct` were derived from `credit_limit` and the manual balance and exposed on the account response.)
(Reason: no component read the metrics outside tests, and the owner removed the whole card semantic layer on 2026-10-04.)
(Migration: 0016 drops `credit_limit` and the Rust `compute_card_metrics`; the response fields are deleted, never zeroed or kept as placeholders.)

### Requirement: Usage Alert Levels

(Removed behaviour: `alert_level` mapped `usage_pct` to `ok`/`warn`/`high`.)
(Reason: the alert had no live consumer (the dashboard "card alert mapping" scenario was never exercised) and its only producer disappears with the limit.)
(Migration: 0016 drops the limit; `alert_level` is deleted from the backend response, and this change's tenth delta retires `frontend-dashboard`'s permissive card-alert sentence together with its "Card alert mapping preserved" scenario. No LED, badge or threshold MAY be reintroduced.)

### Requirement: Balance Types

(Removed behaviour: the summary distinguished current balance from `statement_balance`, which was already always `null` after the ledger removal of 0011 and was fed by the card layer.)
(Reason: the card layer is gone; a statement concept without a card is meaningless.)
(Migration: no statement computation exists after 0016; no `statement_balance` field MAY appear on any response.)

### Requirement: Net Worth Liability Treatment

(Removed behaviour: card balances were summed as liabilities into total net worth.)
(Reason: the owner decision makes patrimonio assets-only; the liability leg existed only for card accounts and production has none.)
(Migration: `finance-assets`'s `NET_WORTH_SQL` becomes assets-only and the per-currency `debts` field is removed in the same change.)

### Requirement: Card Create Form

(Removed behaviour: a manual Spanish card-create form posted `type=credit_card` with `credit_limit` and both cycle days, with 422 fallbacks.)
(Reason: the card capability is retired; no type may exist anywhere.)
(Migration: the form and its copy are deleted; the Settings/account create path posts `{name}` only, and `POST /accounts` rejects `type` and card fields as unknown with 422.)

### Requirement: Card Detail View

(Removed behaviour: card detail rendered límite, disponible, corte, pago and an alert from Rust-computed metrics.)
(Reason: the metrics and fields no longer exist.)
(Migration: the card detail component and its `cards.*`/`finance.*` copy are deleted with the fields; no `$ 0.00` placeholder MAY stand in.)

### Requirement: No Card Limit Patch

(Removed behaviour: limit and cycle-day changes were deliberately DELETE + recreate.)
(Reason: with the fields dropped there is nothing to patch or recreate; only the manual `balance` write survives.)
(Migration: the recreate guidance and its copy are deleted. `PATCH /api/accounts/{id}` keeps its `balance`/`notes`/`color`/`icon`/`is_archived` allowlist.)

### Requirement: Card Contract Preserved

(Removed behaviour: the BE card contract (`chk_card_*` CHECKs, card 422s, card delete behaviour) was preserved.)
(Reason: 0016 removes the CHECKs, columns and enum the contract guarded.)
(Migration: the three `chk_card_*` constraints and `idx_accounts_user_card` are dropped; the account delete guard and 23503→409 mapping stay binding through the surviving `movements.account_id` and `movements.transfer_account_id` RESTRICT references.)

### Requirement: Card Manual ES COP Contract

(Removed behaviour: card UI was manual, Spanish, COP-only, keyboard-accessible with `finance/` SWR refresh and typed i18n keys.)
(Reason: the card UI is deleted, so the contract has no subject.)
(Migration: card components and any card-specific i18n keys are removed; no new card key MAY be added. The generic Spanish/COP/keyboard/SWR rules remain binding for the surviving account surfaces through `finance-accounts`.)

## Verification Of The Retirement

A verifier MUST be able to confirm the retirement mechanically:

- `openspec/specs/credit-card-summary/` (after sync) contains no requirement.
- The repository contains no live reference to `credit_limit`, `statement_day`, `payment_due_day`, `used_balance`, `available_balance`, `usage_pct`, `alert_level`, `statement_balance`, `chk_card_*`, `idx_accounts_user_card` or `account_type` outside archived change records and the migration history.
- The frontend dictionary contains no card metric or alert key, and no component renders a limit, available amount, usage percentage, alert level or statement figure.
- `NET_WORTH_SQL` and its wire entry contain no liabilities term.
