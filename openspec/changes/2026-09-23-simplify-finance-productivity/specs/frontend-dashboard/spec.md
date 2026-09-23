# Delta for Frontend Dashboard

**Scope.** Rewrite the dashboard shell contracts that were defined around the removed ledger: the telemetry strip (5 KPIs with live sources, no budget LEDs), the aggregate charts, the `BalanceChart`/`SavingsChart`/`MonthlyExpensesChart`/`MonthCompareChart`/income-donut set, the finance `PeriodSelector`, the flow/category analysis block, and the "intact" clause that protected removed artefacts. Slice S2 (budget artefacts) + S3 (flow artefacts).

**Edge cases.** A rendered block MUST never be permanently empty because its source disappeared; such a block MUST be removed, not greyed out. A financial widget or chart that keeps a live source MUST keep the chart contract (code-split, tokens, no hex, Spanish labels, reduced motion). The strip MUST stay a strip: five labelled KPIs, not a mixed strip plus hidden empties.

**Non-goals.** No new charts or KPI sources, no replacement monthly flow, no PDF/export, no theme, navigation, layout or session changes, no design of a lighter register (see `finance-transactions` non-goals).

## MODIFIED Requirements

### Requirement: Telemetry Strip

The dashboard home MUST render a full-width Telemetry Strip with exactly five KPIs whose sources survive the change: net worth, number of accounts, monthly subscription cost, outstanding debt and total savings. It MUST NOT render the previous current-month balance, savings rate, streak or budget status items, and MUST NOT render any KPI whose source endpoint was removed. Values MUST be formatted per user `locale`/`currency_code` preferences through the existing string-money coercion at the boundary. A card alert indicator MAY remain only if it keeps the backend enum mapping 1:1 (`alert_level` ∈ {`ok`, `warn`, `high`}); no LED MAY exist for `status` values of the removed budgeting feature.
(Previously: the strip showed net worth, current-month balance, savings rate, longest streak and budget status LEDs, all fed by the transaction aggregates.)

#### Scenario: Five live KPIs render

- GIVEN populated accounts, subscriptions, debts and savings goals
- WHEN the home renders
- THEN patrimonio, cuentas, suscripciones, deudas and ahorros each show a value from a surviving endpoint

#### Scenario: Removed items are gone

- GIVEN the rendered strip
- WHEN its items are inspected
- THEN neither a current-month balance, a savings rate, a streak nor a budget LED is present

#### Scenario: Card alert mapping preserved

- GIVEN a card account with `alert_level: "warn"`
- WHEN the corresponding indicator renders
- THEN it displays the warn visual state without reinterpreting the enum

#### Scenario: Money formatting

- GIVEN preferences `locale: "es-CO"`, `currency_code: "COP"` and net worth `"1500000.00"`
- WHEN the strip renders
- THEN the value displays as `$ 1.500.000`

### Requirement: Recharts Aggregates

The dashboard MUST NOT render the income-vs-expense flow chart nor the spend-by-category donut, because their only data sources were removed. Any chart that keeps a live data source MUST use Recharts 3 with `next/dynamic(ssr:false)`, coerce decimal-string amounts at the API boundary only, render Spanish axis and month labels, reference theme tokens instead of hardcoded hex, and carry currency-formatted Spanish tooltips with reduced-motion suppression of draw-in.
(Previously: the dashboard was required to render monthly income-vs-expense and spend-by-category charts from the transaction aggregate endpoints.)

#### Scenario: Flow and category charts absent

- GIVEN the dashboard rendered
- WHEN the chart region is inspected
- THEN no income-vs-expense chart and no spend-by-category donut are present

#### Scenario: No request to a removed endpoint

- GIVEN any dashboard render
- WHEN the network activity is inspected
- THEN no request targets the removed transaction aggregate paths

#### Scenario: Surviving chart keeps the contract

- GIVEN a chart with a live source
- WHEN it renders
- THEN it is code-split, token-coloured, Spanish-labelled and free of hardcoded hex

## ADDED Requirements

### Requirement: Retained Chart Contracts And Removed Visual Inventory

The change MUST replace the previous blanket "charts MUST remain intact" clause with an explicit inventory. Removed by name and MUST NOT be re-mounted or resurrected as empty shells: `FlowChart`, the expense `CategoryDonut` consumption, `BudgetBars`, `BudgetsList`, `BalanceChart`, `SavingsChart`, `MonthlyExpensesChart`, `MonthCompareChart`, the income-source donut reuse, the finance `PeriodSelector` and the `AnalysisSection` insight block. Retained and still binding: the telemetry strip structure, the Recharts composition pattern, the token-only colour rule, the string-money coercion boundary, keyboard focus, `prefers-reduced-motion` and Spanish typed copy.

#### Scenario: Removed visuals are not present

- GIVEN the finance screen and the dashboard home
- WHEN their rendered blocks are inspected
- THEN none of the removed visuals is mounted, and no placeholder stands in for them

#### Scenario: Retained contracts still hold

- GIVEN the surviving chart or strip elements
- WHEN they are inspected
- THEN no hardcoded hex, no untyped copy and no animation under reduced motion is found

#### Scenario: A future change cannot read "intact" as "undeletable"

- GIVEN a reader of the canonical specification
- WHEN they look for the removed artefacts
- THEN the removal is stated by name, with the reason being the loss of their data source

### Requirement: Finance Screen Source Integrity

Every finance block, KPI or chart that remains rendered MUST have at least one surviving data source, and MUST NOT render a permanent empty state caused by a missing source. Data whose only origin was the removed ledger MUST be deleted from the screen, along with its hooks, transforms and i18n keys, rather than displayed with zeros.

#### Scenario: No perpetual empty block

- GIVEN the finance screen and home rendered with real data
- WHEN the blocks are inspected
- THEN no block shows an empty state for a source that no longer exists

#### Scenario: Deleted chain is complete

- GIVEN a removed visual
- WHEN its supporting code is searched
- THEN its hook, transform and i18n keys were removed together

## REMOVED Requirements

### Requirement: Balance Chart

(Removed behaviour: an area chart of accumulated balance from the monthly-flow series.)
(Reason: the monthly-flow endpoint is removed; the chart had no other source and the account balance is now manual with no history.)
(Migration: the chart, its transform (`toFlowPoints().balance`) and its copy MUST be deleted; balance evolution is explicitly out of scope.)

### Requirement: Savings Chart

(Removed behaviour: monthly savings computed as income minus expense per month from the flow series.)
(Reason: no income/expense series exists after the ledger removal.)
(Migration: the chart and its transform MUST be deleted; savings remain visible as goal progress (see `dashboard-widgets`, `reports-screen`).)

### Requirement: Monthly Expenses Chart

(Removed behaviour: bars of the monthly expense column from the flow series.)
(Reason: no expense series exists after the ledger removal.)
(Migration: the chart and its copy MUST be deleted.)

### Requirement: Month Compare Chart

(Removed behaviour: paired bars plus delta percentage comparing the current and previous month from the flow series.)
(Reason: the comparison needs two months of income/expense that no longer exist.)
(Migration: the chart and its delta helper MUST be deleted.)

### Requirement: Income Source Reuse

(Removed behaviour: income-by-source rendering by reusing the category donut with the income aggregate.)
(Reason: the category aggregate endpoint is removed.)
(Migration: the hook parameter introduced for this reuse MUST be deleted if it has no other consumer.)

### Requirement: Period Selector

(Removed behaviour: a finance period selector (week/month/quarter/year/custom) whose `from`/`to` fed the flow and category aggregates.)
(Reason: every consumer of that window belonged to a removed chart.)
(Migration: the finance-screen selector MUST be deleted with its range helpers; the reports screen keeps its own selector (see `reports-screen`).)

### Requirement: Existing Charts Intact and Transfer Exclusion

(Removed behaviour: a blanket instruction that `FlowChart`, `CategoryDonut`, `BudgetBars`/`BudgetsList` and the transfer-exclusion rule MUST remain intact.)
(Reason: the clause protected artefacts this change deletes, and it had already begun to read as "never delete X"; the explicit inventory in "Retained Chart Contracts And Removed Visual Inventory" replaces it so the removal is intentional and reviewable.)
(Migration: superseded by the new inventory requirement; the transfer-exclusion scenario is obsolete because no transfer or transaction aggregates remain.)

### Requirement: Month-over-Month Computation

(Removed behaviour: a pure transform computing current vs previous month deltas and percentages from the flow series.)
(Reason: no monthly series survives.)
(Migration: the transform and its tests MUST be deleted.)

### Requirement: Savings and Averages Indicators

(Removed behaviour: savings rate, income/expense averages, top category and extreme months computed from flow plus category aggregates.)
(Reason: all of its inputs were removed.)
(Migration: the indicator block MUST be deleted; no replacement indicator is required by this change.)

### Requirement: Direct ES Template Insights

(Removed behaviour: a closed list of fixed Spanish insight templates fed by flow and category data.)
(Reason: the templates were parameterised exclusively with removed aggregates.)
(Migration: the templates and their `analysis.*` keys MUST be deleted; no LLM or free-generation replacement is introduced.)

### Requirement: Recurrent Versus Extraordinary Heuristic v1

(Removed behaviour: labelling recurrent versus extraordinary spend from description frequency inside the period.)
(Reason: descriptions belonged to the removed ledger.)
(Migration: the heuristic and its tests MUST be deleted.)

### Requirement: Analysis Empty and i18n Contract

(Removed behaviour: the analysis block's empty state plus disclaimer and its i18n-only copy rule.)
(Reason: the block is removed, so its empty-state contract has no subject; keeping it would imply the section still exists.)
(Migration: `AnalysisSection` MUST be unmounted and its `analysis.*` keys deleted; the fixed non-advisor disclaimer belongs to `progress-score`, which keeps its own requirement.)
