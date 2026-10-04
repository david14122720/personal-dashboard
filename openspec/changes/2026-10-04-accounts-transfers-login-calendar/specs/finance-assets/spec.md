# Delta for Finance Assets

**Scope.** Patrimonio becomes assets-only. `NET_WORTH_SQL` stops joining `accounts` and stops computing credit-card liabilities (`GREATEST(-balance, 0)` over cards, which is also the last non-account SQL predicate on `accounts.type`), and the per-currency wire entry becomes `{currency, assets, net_worth}` with `net_worth = assets`. Asset CRUD, valuations, the archive-delete pattern, the net-worth endpoint and `useNetWorth` are otherwise untouched.

**Edge cases.** A user with accounts but no assets now gets an empty `per_currency` list instead of a card-liability entry with `assets: 0` — this is intended: with no cards (production: 0) that row could only ever be produced by the removed leg. A user with assets in two currencies keeps one entry per currency exactly as before. The removed `debts` field was read by no live consumer (verified: `ProgressScreens` and `ReportsScreens` read `net_worth` only), so no UI fallback is needed.

**Non-goals.** No new net-worth formula, no debts term from any source, no wealth-evolution chart, no new widget, no change to the asset list, valuation ordering, archive flow or `finance-assets` write contracts.

## MODIFIED Requirements

### Requirement: Net Worth Aggregation

The system MUST compute total net worth on demand from surviving sources only: the sum of every non-archived asset `current_value`, grouped by currency. `NET_WORTH_SQL` MUST NOT reference `accounts`, the removed card layer or any liability term, and MUST NOT reintroduce the removed `debts` table. The per-currency wire shape MUST be `{currency, assets, net_worth}` with `net_worth = assets`; the always-zero `debts` field MUST be removed from the wire, and the removed card metrics MUST NOT be substituted into it.
(Previously: net worth subtracted credit-card liabilities and the per-currency shape was `{currency, assets, debts, net_worth}` where `debts` came from `GREATEST(-balance, 0)` over non-archived `credit_card` accounts.)

#### Scenario: Assets-only net worth
- GIVEN a user with assets totalling `10000.00` in COP, and no card accounts
- WHEN the net-worth aggregate is requested
- THEN the COP entry is `{currency: "COP", assets: 10000.00, net_worth: 10000.00}` and no other term is subtracted or added

#### Scenario: No account reference in the query
- GIVEN `NET_WORTH_SQL` after the change
- WHEN it is inspected
- THEN it joins no account table, contains no `type=` predicate and contains no reference to the removed `debts` table

#### Scenario: Per-currency entries preserved
- GIVEN non-archived assets in COP and USD
- WHEN the aggregate computes
- THEN it returns one entry per currency with `currency`, `assets` and `net_worth`, and every entry has `net_worth == assets`

#### Scenario: Liabilities are gone, not zeroed
- GIVEN any user after migration 0016
- WHEN the net-worth response is inspected
- THEN no `debts` key exists in any per-currency entry and no card-derived figure is exposed anywhere

### Requirement: Net Worth Number

The FE MUST show patrimonio as a simple number reusing `GET /net-worth` (`useNetWorth`): Σ non-archived `current_value` per currency, with the user currency coming from `GET /me` and falling back to the first currency. A debts or liabilities term MUST NOT exist, be displayed or be reintroduced from any source.
(Previously: the formula subtracted card liabilities, and the removed active-debts term was also forbidden; the card term is now forbidden too.)

#### Scenario: Net worth visible in finance
- GIVEN net worth `{"per_currency": [{"currency": "COP", "assets": "7000000.00", "net_worth": "7000000.00"}]}`
- WHEN the finance/progress surfaces render
- THEN the COP-formatted `7000000` is shown and no debts figure is rendered

#### Scenario: No card term anywhere
- GIVEN the change diff
- WHEN `NET_WORTH_SQL`, its handler and its tests are inspected
- THEN no `credit_card`, `credit_limit`, `alert_level` or `debts` term remains in the net-worth path
