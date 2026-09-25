# Delta for Frontend Dashboard

**Scope.** The Finance screen is reduced to a single equal-card view (Accounts, Subscriptions with Pay, Assets/net worth, Add expense/income, Movements history, Category chart — no tabs), the Resumen strip is rewritten per D1 (net worth, accounts, monthly sub cost, total balance) and gains the latest-movements and upcoming-subscriptions sections, and the chart/compare contract is re-pointed to the movement aggregates (two series, no netting, no cloned currency bug). Slice S-H plus the S-C/S-E UI slices.

**Edge cases.** An account in a currency other than the user currency is excluded from the total balance rather than converted; the movements sections show a Spanish empty state instead of a zero placeholder; cards keep equal height within a row via the existing `h-full` `SectionShell` discipline.

**Non-goals.** No new chart library (div-bars stay div-bars), no tabs, no route for movements, no `/wealth` route, no design-token changes beyond the existing `--color-*` usage.

## MODIFIED Requirements

### Requirement: Telemetry Strip

The dashboard home MUST render a full-width Resumen strip whose KPIs all have surviving sources, exactly four: net worth (patrimonio), number of non-archived accounts (cuentas), monthly-equivalent cost of active subscriptions (suscripciones) and total balance (saldo total = Σ `accounts.balance` over non-archived accounts whose currency equals the user currency, per D1). Outstanding debt and total savings MUST be absent, no KPI whose source endpoint was removed MAY render, and no placeholder MAY stand in for one. Movements are shown in the dedicated sections below the strip, not as KPIs. Values MUST be formatted per user `locale`/`currency_code` preferences through the existing string-money coercion at the boundary. A card alert indicator MAY remain only if it keeps the backend enum mapping 1:1 (`alert_level` ∈ {`ok`, `warn`, `high`}); no LED MAY exist for `status` values of the removed budgeting feature.
(Previously: exactly five KPIs — net worth, accounts, monthly subscription cost, outstanding debt and total savings — with no total-balance item.)

#### Scenario: Four live KPIs render

- GIVEN populated accounts and subscriptions
- WHEN the home renders
- THEN patrimonio, cuentas, suscripciones and saldo total each show a value from a surviving source

#### Scenario: Debt and savings KPIs are gone

- GIVEN the rendered strip
- WHEN its items are inspected
- THEN neither a deudas nor an ahorros item is present, and no `GET /debts` or `/savings-goals` request is issued by the strip

#### Scenario: Total balance uses the user currency only

- GIVEN accounts in COP and one account in USD, user currency COP
- WHEN the strip renders
- THEN saldo total sums only the COP accounts and no conversion is applied

#### Scenario: Card alert mapping preserved

- GIVEN a card account with `alert_level: "warn"`
- WHEN the corresponding indicator renders
- THEN it displays the warn visual state without reinterpreting the enum

#### Scenario: Money formatting

- GIVEN preferences `locale: "es-CO"`, `currency_code: "COP"` and net worth `"1500000.00"`
- WHEN the strip renders
- THEN the value displays as `$ 1.500.000`

### Requirement: Recharts Aggregates

The dashboard home MUST NOT render the income-vs-expense flow chart nor the spend-by-category donut, because their only data sources were removed. Any surviving Recharts chart MUST use Recharts 3 with `next/dynamic(ssr:false)`, coerce decimal-string amounts at the API boundary only, render Spanish axis and month labels, reference theme tokens instead of hardcoded hex, and carry currency-formatted Spanish tooltips with reduced-motion suppression of draw-in. The Finance screen's movement-sourced category chart is a different artefact from the removed flow chart and donut: it MAY remain a token-coloured div-bar composition (no chart library is added by this change) and MUST NOT be mounted on the home. No removed visual MAY be resurrected as an empty shell.
(Previously: the clause applied "Recharts 3" to any surviving chart without distinguishing the div-bar category bars, and no movement-sourced category chart existed.)

#### Scenario: Flow and category charts absent

- GIVEN the dashboard home rendered
- WHEN the chart region is inspected
- THEN no income-vs-expense chart and no spend-by-category donut are present

#### Scenario: No request to a removed endpoint

- GIVEN any dashboard render
- WHEN the network activity is inspected
- THEN no request targets the removed transaction aggregate paths

#### Scenario: Surviving chart keeps the contract

- GIVEN a chart with a live source
- WHEN it renders
- THEN it is code-split when it uses Recharts, token-coloured, Spanish-labelled and free of hardcoded hex

#### Scenario: The div-bar category chart is not the removed donut

- GIVEN the Finance category chart rendered from movement aggregates
- WHEN its implementation is inspected
- THEN it is the existing div-bar composition, no chart dependency was added, and it is absent from the home

### Requirement: Retained Chart Contracts And Removed Visual Inventory (S3b)

The explicit visual inventory is extended: removed by name and MUST NOT be re-mounted or resurrected as empty shells: `FlowChart`, the expense `CategoryDonut` consumption, `BudgetBars`, `BudgetsList`, `BalanceChart`, `SavingsChart`, `MonthlyExpensesChart`, `MonthCompareChart`, the income-source donut reuse, the finance `PeriodSelector` and the `AnalysisSection` insight block — plus, by this change, the Savings goals/deposits blocks (forms, progress bar) and the Debts/payments blocks (forms, history, progress bar), and the old `CategoryBars` proxies (`chartExpenses` from subscriptions and `chartSavings` from savings goals). Retained and still binding: the telemetry strip structure (rewritten per D1), the Recharts composition pattern where used, the div-bar category chart re-pointed to movements, the token-only colour rule, the string-money coercion boundary, keyboard focus, `prefers-reduced-motion` and Spanish typed copy.
(Previously: the inventory named the parent change's removed visuals; the savings/debts blocks and the subscription/savings chart proxies were not yet retired.)

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
- THEN the removal is stated by name, with the reason being the loss of their data source or the owner's scope decision

### Requirement: Finance Screen Source Integrity (S3b)

Every finance block, KPI or chart that remains rendered MUST have at least one surviving data source, and MUST NOT render a permanent empty state caused by a missing source. Data whose only origin was a removed capability MUST be deleted from the screen, along with its hooks, transforms and i18n keys, rather than displayed with zeros. The chart, the compare view and the history list MUST read the movements source; the retired savings and debts blocks MUST be absent with their hooks, transforms and keys.
(Previously: the requirement predated the movements source and did not name the savings/debts retirement.)

#### Scenario: No perpetual empty block

- GIVEN the finance screen and home rendered with real data
- WHEN the blocks are inspected
- THEN no block shows an empty state for a source that no longer exists

#### Scenario: Deleted chain is complete

- GIVEN a removed visual
- WHEN its supporting code is searched
- THEN its hook, transform and i18n keys were removed together

#### Scenario: Surviving chart has a live source

- GIVEN the category chart and the compare view
- WHEN their data is inspected
- THEN both aggregate `GET /movements` and no other source is read

## ADDED Requirements

### Requirement: Finance Single-View Composition

The Finance screen MUST remain a single view with no tabs and one `grid-cols-12` of equal cards: Accounts, Subscriptions (amount + Pay), Assets/net worth, Add expense/income, Movements history and Category chart, each `col-span-12 md:col-span-6` with the existing `h-full` `SectionShell` discipline so cards in the same row keep equal height. The Savings and Debts sections, their S5 blocks, forms, hooks and empty placeholders MUST be absent. The compare view stays a Finance sub-route (not in the primary nav) reachable from the chart. Add controls, the history filters and the Pay control MUST satisfy the keyboard/focus and 44×44 hit-area rules and use typed `finance.*` keys.

#### Scenario: Single view without tabs

- GIVEN the Finance screen rendered
- WHEN its layout is inspected
- THEN it is one grid of section cards and no tab control or tab router exists

#### Scenario: Equal cards

- GIVEN two cards in the same row at a desktop viewport
- WHEN their boxes are measured
- THEN both span `md:col-span-6` and render equal height

#### Scenario: Removed sections are absent

- GIVEN the Finance screen
- WHEN its sections are enumerated
- THEN no Savings and no Debts section, control or placeholder appears

#### Scenario: Compare view reachable

- GIVEN the Finance category chart
- WHEN the user follows its compare affordance
- THEN the compare sub-route opens and is not added to the primary navigation

### Requirement: Resumen Latest Movements And Upcoming Subscriptions Sections

The Resumen MUST render two sections below the strip: (a) «Últimos movimientos» — the latest **5** movements from `GET /movements` ordered `occurred_on DESC`, each showing direction, COP amount, Spanish date and its category/account; and (b) «Próximas suscripciones» — active subscriptions with a non-null `next_billing_on >= today`, ordered ascending, top 5, showing name, COP amount and due date plus the paid state. Each section MUST handle `loading`, `error` and `empty` independently in Spanish, MUST use typed `dashboard.*`/`finance.*` keys, MUST NOT create a new backend endpoint, and MUST refresh only its own SWR keys on retry. The movements section MUST link to Finance.

#### Scenario: Latest five movements

- GIVEN 12 movements for the user
- WHEN the Resumen renders
- THEN exactly the 5 most recent appear in `occurred_on` descending order

#### Scenario: Upcoming subscriptions

- GIVEN three active subscriptions, two with future due dates and one with a past due date
- WHEN the section renders
- THEN the two future ones appear ordered ascending by due date with their paid state

#### Scenario: Empty and error states

- GIVEN no movements or a failed movements fetch
- WHEN the section renders
- THEN a Spanish `EmptyState` or a Spanish error panel with retry appears and the strip keeps rendering

### Requirement: Finance Category Chart And Compare Split

The Finance category chart MUST render the movement aggregate as two series per category — `gasto` and `ingreso` — when both directions exist, and a single series otherwise; bars MUST use theme tokens, Spanish labels and COP formatting, and MUST NOT net the two directions. The compare view MUST show per-category expense and income side by side as separate figures, with no netting and no currency mixing (single-currency rule from `finance-movements`). The removed flow/donut visuals MUST NOT return through this chart.

#### Scenario: Two series render

- GIVEN category `C` with one expense and one income
- WHEN the chart renders
- THEN `C` shows a gasto bar and an ingreso bar as separate series

#### Scenario: Compare shows the split

- GIVEN categories with mixed directions
- WHEN the compare view renders
- THEN each category shows expense and income side by side with no netted figure

#### Scenario: No currency mixing

- GIVEN accounts in COP and USD, user currency COP
- WHEN the chart and compare aggregate
- THEN only COP movements participate and no converted value appears

### Requirement: Kind-Free Category UI

No UI in the app MAY render a category kind selector, kind badge, kind filter or kind-split list (D3). Every category picker and chart MUST present all owned categories together in one list, and the finance options passed to the expense/income modals, the subscription form and the chart MUST come from a single unfiltered category set rather than the previous `finance` + `subscription` split. The Settings custom-categories form MUST drop its kind control and version its localStorage schema (`pd-custom-categories` v2, no kind field), migrating existing entries by preserving `id`/`name` and dropping the kind without data loss; custom categories stay localStorage-only and remain excluded from API-backed movement/subscription selects (their ids are unknown to the API), with copy that says so honestly. The database enum, `kind` column and `UNIQUE(user_id, kind, name)` stay untouched.

#### Scenario: No kind control anywhere

- GIVEN the Finance selects, the Settings custom-categories form and the chart controls
- WHEN their inputs are inspected
- THEN no kind selector, badge or filter is present

#### Scenario: All categories visible together

- GIVEN owned categories of kinds `finance`, `subscription` and `habit`
- WHEN a category picker opens
- THEN all of them appear in one unfiltered list

#### Scenario: Custom categories schema migration

- GIVEN stored `pd-custom-categories` entries with a kind field
- WHEN the app loads after the change
- THEN the v2 schema is used, ids and names survive, the kind is dropped and no entry is lost

#### Scenario: Database shape untouched

- GIVEN the database after the change
- WHEN `categories` is inspected
- THEN the `kind` column, the enum and the unique constraint still exist unchanged
