# Delta for Frontend Dashboard

**Scope.** The home surface gains its visible identity name «Dashboard» and exactly two movement-sourced Recharts charts, each inside its own initially collapsed disclosure: a totals trend (expense vs income per bucket, no category grouping) and an expense-by-category pie scoped to the current local period. Both read `GET /movements` plus the existing account/category/preference reads only. No backend, endpoint, migration or dependency change. This delta intentionally supersedes the canonical "the home MUST NOT render the flow chart nor the spend donut" clause, but NOT the retirement of the old visuals themselves: the new artefacts are distinct, differently named components.

**Edge cases.** Both disclosures start collapsed and their open state is independent. The totals trend always returns every bucket (empty buckets at 0/0) so the line has no gaps, and it includes rows with a null `category_id` because it is not a category aggregate. The pie excludes those rows, excludes income, excludes non-user-currency accounts without converting, and drops zero totals; a user with no expenses in range sees a Spanish empty note inside an open disclosure, never a bare empty shell behind a closed header. The pie's Week is the trailing seven days ending today, deliberately different from the Monday-first calendar week used by the trend buckets. Charts stay code-split so the static export carries no chart bundle until a disclosure opens.

**Non-goals.** No change to the telemetry strip, the home widgets, the Finance category chart or compare view; no date navigation (previous/next period); no new period kinds; no `GET /movements/stats`; no currency conversion; no top-N/«Otras» bucketing; no reinstatement of the removed `FlowChart`/`CategoryDonut` names or their subscription/savings sources.

## MODIFIED Requirements

### Requirement: Recharts Aggregates

The dashboard home MUST offer exactly two Recharts charts, both inside the chart disclosures and sourced only from `GET /movements` and the existing account/category/preference reads: (a) a totals trend line of expense vs income per consecutive period bucket, and (b) an expense-only pie grouped by persisted backend category for the current local period. The retired income-vs-expense `FlowChart` and the spend-by-category `CategoryDonut` MUST remain removed and MUST NOT be resurrected by name or as empty shells, and no request MAY target their removed aggregate endpoints. Every chart MUST use Recharts 3 with `next/dynamic(ssr:false)`, coerce decimal-string amounts at the API boundary only, render Spanish labels and currency-formatted Spanish tooltips, reference theme tokens instead of hardcoded hex, and suppress draw-in under `prefers-reduced-motion`. The Finance screen's movement-sourced category chart remains a different artefact and MUST NOT be mounted on the home.
(Previously: the home MUST NOT render the flow chart nor the spend-by-category donut at all, because their only data sources were removed.)

#### Scenario: Two movement-sourced home charts render

- GIVEN a user with movements
- WHEN the dashboard home renders with both disclosures open
- THEN the totals trend and the expense-by-category pie each render from `GET /movements` data and no other aggregate source

#### Scenario: The retired visuals stay retired

- GIVEN the dashboard home rendered
- WHEN the chart region is inspected
- THEN no `FlowChart` and no `CategoryDonut` component or label is present, and no request targets their removed aggregate paths

#### Scenario: Home charts keep the surviving chart contract

- GIVEN either home chart
- WHEN its implementation is inspected
- THEN it is dynamically imported with `ssr:false`, token-coloured, Spanish-labelled, currency-formatted and free of hardcoded hex

#### Scenario: Reduced motion suppresses draw-in

- GIVEN `prefers-reduced-motion: reduce`
- WHEN a home chart renders
- THEN its draw-in animation is suppressed

#### Scenario: Finance chart stays off the home

- GIVEN the Finance category chart and the Dashboard home
- WHEN the home blocks are inspected
- THEN the Finance chart is not mounted there

### Requirement: Retained Chart Contracts And Removed Visual Inventory (S3b)

The explicit visual inventory is extended: removed by name and MUST NOT be re-mounted or resurrected as empty shells: `FlowChart`, the expense `CategoryDonut` consumption, `BudgetBars`, `BudgetsList`, `BalanceChart`, `SavingsChart`, `MonthlyExpensesChart`, `MonthCompareChart`, the income-source donut reuse, the finance `PeriodSelector` and the `AnalysisSection` insight block — plus, by this change, nothing new is retired. This change adds two distinct movement-sourced home charts (the totals trend and the expense-by-category pie) that MUST NOT be confused with the retired visuals, MUST NOT be named after them and MUST NOT read the removed aggregate paths. Retained and still binding: the telemetry strip structure (rewritten per D1), the Recharts composition pattern where used, the category chart re-pointed to movements (its form is owned by `Finance Category Chart And Compare Split`), the token-only colour rule, the string-money coercion boundary, keyboard focus, `prefers-reduced-motion` and Spanish typed copy.
(Previously: the inventory listed the same removals and stated the removed visuals MUST NOT be re-mounted, without distinguishing the new movement-sourced home charts.)

#### Scenario: Removed visuals are not present

- GIVEN the finance screen and the dashboard home
- WHEN their rendered blocks are inspected
- THEN none of the removed visuals is mounted, and no placeholder stands in for them

#### Scenario: New home charts are not the retired visuals

- GIVEN the totals trend and the expense pie
- WHEN their names, props and data sources are inspected
- THEN they are new components fed by `GET /movements`, not the retired `FlowChart`/`CategoryDonut` and not their removed endpoints

#### Scenario: Retained contracts still hold

- GIVEN the surviving chart or strip elements
- WHEN they are inspected
- THEN no hardcoded hex, no untyped copy and no animation under reduced motion is found

#### Scenario: A future change cannot read "intact" as "undeletable"

- GIVEN a reader of the canonical specification
- WHEN they look for the removed artefacts
- THEN the removal is stated by name, with the reason being the loss of their data source or the owner's scope decision

## ADDED Requirements

### Requirement: Dashboard Identity Copy

The application MUST present the home section as «Dashboard» in every visible identity surface: the primary navigation item (desktop rail and mobile tab), the breadcrumb section label and the Dashboard home `h1`. Subtitle and non-identity labels are out of scope. No visible identity surface MAY keep the previous copy «Resumen» or «Resumen General». The dictionary MUST NOT keep a stale home identity value either: `nav.overview`, `dashboard.overview` and `dashboard.overviewTitle` MUST all resolve to «Dashboard» while keeping their key names — a copy-only key-value change with no key deletion. The `/dashboard/` route, its navigation `href` and its static-export path MUST remain exactly as they are: no redirect, no renamed route and no navigation to a different path MAY be introduced.

#### Scenario: Sidebar and mobile navigation show «Dashboard»

- GIVEN an authenticated user
- WHEN the navigation renders on desktop and on a ≤768px viewport
- THEN the home entry reads «Dashboard» and still links to `/dashboard/`

#### Scenario: Breadcrumb shows «Dashboard»

- GIVEN an authenticated user on any dashboard section
- WHEN the header renders
- THEN the breadcrumb reads «Panel / Dashboard»

#### Scenario: Home heading shows «Dashboard»

- GIVEN the user opens `/dashboard/`
- WHEN the home renders
- THEN its `h1` reads «Dashboard» and no «Resumen General» heading exists

#### Scenario: Stale identity values are renamed

- GIVEN the dictionary after the change
- WHEN `nav.overview`, `dashboard.overview` and `dashboard.overviewTitle` are resolved
- THEN each returns «Dashboard», the key names are unchanged and no key was deleted

#### Scenario: Route stays stable

- GIVEN the statically exported build
- WHEN `GET /dashboard/` is served
- THEN the home renders at the same path, the navigation `href` is still `/dashboard/`, and no renamed or redirecting route was added

### Requirement: Dashboard Chart Disclosures

The Dashboard home MUST render two separate chart disclosures — totals trend and expense pie — each collapsed on first render and each owning its open state independently. Each disclosure MUST expose a keyboard-operable trigger with `aria-expanded` and `aria-controls` targeting its panel, a visible focus indicator and a hit area of at least 44×44 CSS pixels. While collapsed, the panel contents MUST NOT render. Each disclosure MUST own its own Día/Semana/Mes/Año period control, defaulting to Mes, reused from the existing period labels; opening or toggling one disclosure MUST NOT open, close or change the period of the other. All new copy MUST come from typed keys (`dashboard.*` for the new strings; the period pills and series legends MAY reuse the existing `finance.*` keys). No new dependency, backend endpoint or migration MAY be added.

#### Scenario: Both disclosures start collapsed

- GIVEN a freshly rendered dashboard home
- WHEN the two disclosure triggers are inspected
- THEN each reports `aria-expanded="false"` and no chart panel content is rendered

#### Scenario: Toggling is independent

- GIVEN both disclosures collapsed
- WHEN the user opens the totals trend
- THEN the trend panel renders, the pie trigger still reports `aria-expanded="false"`, and its period selection is unchanged

#### Scenario: Keyboard operation and hit area

- GIVEN a keyboard-only user
- WHEN they tab to a disclosure trigger and activate it
- THEN the panel opens, focus is visible and the focused control is at least 44×44 CSS pixels

#### Scenario: Each disclosure owns its period control

- GIVEN both disclosures open
- WHEN the user changes the pie period to Día
- THEN the pie recalculates for today and the trend period selection does not change

### Requirement: Dashboard Totals Trend Chart

The totals trend MUST chart two separate series — total expense and total income — over N consecutive period buckets ordered oldest to newest, reusing the existing counts: Día 14, Semana 8, Mes 12, Año 5. It MUST aggregate every movement of the caller whose account currency equals the user's Dashboard currency, regardless of category (including rows with a null `category_id`), MUST never net expense against income and MUST NOT group by category. Movements outside the bucket windows MUST be excluded; every bucket MUST render, empty ones at zero. Y ticks MUST be compact, tooltips MUST be Spanish currency-formatted and colours MUST come from theme tokens.

#### Scenario: Exact bucket count per period

- GIVEN a period selection of Día, Semana, Mes or Año
- WHEN the totals trend renders
- THEN it shows exactly 14, 8, 12 or 5 buckets respectively, ordered oldest to newest with the current bucket last

#### Scenario: Expense and income never net

- GIVEN one bucket with expense `100.00` and income `20.00`
- WHEN the trend renders
- THEN it shows an expense series of 100 and an income series of 20, never a single netted figure

#### Scenario: No category grouping

- GIVEN movements in two categories plus one row with a null `category_id`, all in the same bucket
- WHEN the totals aggregate
- THEN every matching movement contributes to the bucket totals and no per-category series or grouping exists

#### Scenario: Currency mismatch is excluded

- GIVEN user currency COP and one account in USD with movements in the selected window
- WHEN the totals aggregate
- THEN the USD movements are excluded and no converted or mixed-currency value appears

#### Scenario: Empty buckets render as zero

- GIVEN a period with some buckets without movements
- WHEN the trend renders
- THEN those buckets appear with 0 expense and 0 income, keeping the fixed row count

### Requirement: Dashboard Expense Category Pie

The pie MUST show expenses only, grouped by persisted backend `category_id`, scoped to the current local period selected by its own control: Day = today; Week = trailing seven days ending today; Month = current calendar month; Year = current calendar year. It MUST exclude income movements, rows whose `category_id` is null, movements on accounts whose currency differs from the user's Dashboard currency (never converting), and categories whose total is zero. Category names MUST come from the API-backed category set; categories that exist only in local storage MUST NOT appear in the legend or as slices. A date navigator MUST NOT exist. Every new visible string MUST come from a typed `dashboard.*` key; the period pills MAY reuse the existing `finance.trendPeriod*` labels.

#### Scenario: Expenses only

- GIVEN a period with an expense of `100.00` and an income of `50.00` in the same category
- WHEN the pie renders
- THEN only the `100.00` expense is represented and no income is aggregated

#### Scenario: Grouping by persisted category

- GIVEN two expenses in category `C` and one expense in category `D` in the period
- WHEN the pie renders
- THEN `C` appears as one slice of the summed value and `D` as a separate slice, named from the backend category

#### Scenario: Current period per option

- GIVEN today is `W`, with movements dated `W`, `W-6`, `W-7`, earlier in the current month, and earlier in the current year
- WHEN the pie period is Día, then Semana, then Mes, then Año
- THEN Día includes only `W`, Semana includes `W-6..W`, Mes includes the current calendar month and Año the current calendar year, with no previous/next navigation control present

#### Scenario: Null category is excluded

- GIVEN an expense row with `category_id: null` in the period
- WHEN the pie aggregates
- THEN the row does not appear as a slice and no «sin categoría» bucket is created

#### Scenario: Local-only category stays out

- GIVEN a category that exists only in `localStorage` and a period with expenses
- WHEN the pie renders
- THEN that category appears in neither the legend nor the slices

#### Scenario: Currency mismatch is excluded

- GIVEN user currency COP and an expense on a USD account in the period
- WHEN the pie aggregates
- THEN the USD expense is excluded and no converted value appears

#### Scenario: Empty period

- GIVEN no expenses in the selected current period
- WHEN the pie disclosure is open
- THEN a Spanish empty state replaces the chart
