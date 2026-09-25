# Delta for Finance Assets

**Scope.** The net-worth aggregation loses its active-debts leg (the `debts` table is dropped by gated migration 0013). The per-currency `debts` field survives with a redefined meaning: credit-card liabilities only (explore §5 open item 6, resolved in favour of the wire-compatible option). Everything else in the capability — asset CRUD, INSERT-only valuations, archive-delete, patch guards, forms — is unchanged.

**Edge cases.** A credit-card account with a positive balance contributes zero liability (`GREATEST(-balance, 0)`); an archived card contributes nothing. A currency that only has card liabilities still appears in `per_currency` with `assets: 0`. No consumer receives a renamed field.

**Non-goals.** No rename of the `debts` wire field, no new net-worth endpoint, no wealth-evolution chart, no change to asset valuation semantics.

## MODIFIED Requirements

### Requirement: Net Worth Aggregation

The system MUST compute the total net worth on-demand from surviving sources only: total non-archived asset `current_value` minus credit-card liabilities. The active-debts term MUST be removed from `NET_WORTH_SQL` (the `debts` table is dropped by 0013), and the per-currency `debts` field MUST be redefined as credit-card liabilities only (`GREATEST(-balance, 0)` over non-archived `credit_card` accounts), keeping the `{currency, assets, debts, net_worth}` wire shape unchanged for consumers.
(Previously: net worth subtracted both active debts' `pending_amount` and card balances, and the `debts` field meant "active debts plus cards".)

#### Scenario: Calculate Net Worth

- GIVEN a user with:
    - Assets with total current value of 10,000.00
    - An active credit-card balance of `-3,000.00`
- WHEN the user requests the net worth aggregate
- THEN the system SHALL compute `10,000.00 - 3,000.00`
- AND return `{ "per_currency": [ { "currency": "USD", "assets": 10000.00, "debts": 3000.00, "net_worth": 7000.00 } ] }`

#### Scenario: No debts table in the query

- GIVEN the net-worth SQL after the change
- WHEN it is inspected
- THEN it joins assets and credit-card accounts only, and contains no reference to the removed `debts` table

#### Scenario: Positive card balance is not a liability

- GIVEN a credit-card account with balance `"500.00"`
- WHEN the net-worth aggregate computes
- THEN its liability contribution is zero, not negative

#### Scenario: Per-currency shape preserved

- GIVEN assets in USD and card liabilities in COP
- WHEN the aggregate computes
- THEN it returns two `per_currency` entries with the same field names as before the change

### Requirement: Net Worth Number

The FE MUST show patrimonio as a simple number reusing existing `GET /net-worth` (`useNetWorth`): `Σ current_value` no-archivados − deuda cards, per currency. The removed active-debts term MUST NOT be reintroduced through any other source. Currency MUST come from `GET /me`, fallback first currency. No new home widget and no wealth-evolution chart SHALL be created.
(Previously: the formula also subtracted `Σ pending` of active debts, a source this change deletes.)

#### Scenario: Net worth visible in finance

- GIVEN net worth `{"currency": "COP", "net_worth": "7000000.00"}`
- WHEN the finance screen renders
- THEN the COP-formatted number is shown

#### Scenario: Outstanding debts are not part of the figure

- GIVEN the finance screen and progress/report consumers
- WHEN net worth renders
- THEN no debt-pending value is subtracted, added or displayed as part of it

#### Scenario: No new artefact

- GIVEN the change diff
- WHEN the dashboard and finance screens are inspected
- THEN no wealth widget, wealth route or evolution chart was added
