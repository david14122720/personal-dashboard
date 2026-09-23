# Frontend Dashboard Specification

## Purpose

Static-export Next.js control center rendering aggregates as Recharts charts, with a telemetry-deck home, preferences persistence, and bearer-token session handling. Served same-origin by Axum via `STATIC_DIR` in production.

## Requirements

### Requirement: Telemetry Strip

The dashboard home MUST render a full-width Telemetry Strip with exactly five
KPIs whose sources survive the change: net worth, number of accounts, monthly
subscription cost, outstanding debt and total savings. It MUST NOT render the previous current-month balance, savings rate, streak or
budget status items, and MUST NOT render any KPI whose source endpoint was
removed. Values MUST be formatted per user `locale`/`currency_code` preferences
through the existing string-money coercion at the boundary. A card alert
indicator MAY remain only if it keeps the backend enum mapping 1:1
(`alert_level` ∈ {`ok`, `warn`, `high`}); no LED MAY exist for `status` values
of the removed budgeting feature.

#### Scenario: Five live KPIs render

- GIVEN populated accounts, subscriptions, debts and savings goals
- WHEN the home renders
- THEN patrimonio, cuentas, suscripciones, deudas and ahorros each show a value
  from a surviving endpoint

#### Scenario: Removed items are gone

- GIVEN the rendered strip
- WHEN its items are inspected
- THEN neither a current-month balance, a savings rate, a streak nor a budget
  LED is present

#### Scenario: Card alert mapping preserved

- GIVEN a card account with `alert_level: "warn"`
- WHEN the corresponding indicator renders
- THEN it displays the warn visual state without reinterpreting the enum

#### Scenario: Money formatting

- GIVEN preferences `locale: "es-CO"`, `currency_code: "COP"` and net worth `"1500000.00"`
- WHEN the strip renders
- THEN the value displays as `$ 1.500.000`

### Requirement: Recharts Aggregates

The dashboard MUST NOT render the income-vs-expense flow chart nor the
spend-by-category donut, because their only data sources were removed. Any
chart that keeps a live data source MUST use Recharts 3 with
`next/dynamic(ssr:false)`, coerce decimal-string amounts at the API boundary
only, render Spanish axis and month labels, reference theme tokens instead of
hardcoded hex, and carry currency-formatted Spanish tooltips with
reduced-motion suppression of draw-in.
(Previously: the dashboard rendered monthly income-vs-expense and
spend-by-category charts from the transaction aggregate endpoints.)

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
- THEN it is code-split, token-coloured, Spanish-labelled and free of
  hardcoded hex

### Requirement: Bento Layout and Responsiveness

The dashboard MUST use a bento "instrument rack" layout that adapts from a desktop left rail to a mobile bottom tab bar. All interactive elements MUST be keyboard-accessible with visible focus. The layout MUST respect `prefers-reduced-motion`: when set, page-load orchestrations, `--animate-*` token-driven keyframes, and chart draw-in animations are suppressed.
(Previously: reduced-motion suppression covered only page-load orchestrations and chart draw-in; token-driven CSS animation did not exist yet.)

#### Scenario: Mobile navigation

- GIVEN a viewport width ≤ 768px
- WHEN the dashboard loads
- THEN navigation is exposed as a bottom tab bar

#### Scenario: Reduced motion

- GIVEN `prefers-reduced-motion: reduce`
- WHEN the dashboard loads
- THEN count-up, chart draw-in, and all `--animate-*` entrance keyframes are skipped

#### Scenario: Keyboard focus

- GIVEN a keyboard-only user
- WHEN they tab through the dashboard
- THEN every interactive element shows a visible focus indicator

### Requirement: Static Export Served by Axum

The frontend MUST build via Next.js `output: 'export'`. The backend Dockerfile MUST copy `frontend/out` into `STATIC_DIR`; Axum MUST serve those assets same-origin with the API fallback. In development, the frontend MAY run cross-origin; the API client MUST read its base URL from configuration.

#### Scenario: Production serving

- GIVEN a built `frontend/out` directory
- WHEN the backend container starts
- THEN `GET /` returns `index.html` and `GET /api/...` routes to the API

#### Scenario: SPA fallback

- GIVEN a request for `/dashboard/finance`
- WHEN no matching static file exists
- THEN Axum returns `index.html` so the client router handles the route

### Requirement: Session and 401 Contract

The client MUST store the bearer token in `localStorage`, attach it to every `/api/*` request, and on any 401 response perform a single-flight redirect to `/login` clearing the token. Concurrent 401s MUST dedupe so only one redirect occurs.

#### Scenario: Token attached

- GIVEN a stored token
- WHEN any `/api/*` request is made
- THEN the request includes `Authorization: Bearer <token>`

#### Scenario: Single-flight 401 redirect

- GIVEN three concurrent requests that all receive 401
- WHEN responses arrive
- THEN exactly one redirect to `/login` occurs and the token is cleared once
### Requirement: Futuristic Blue Token Theme

The palette MUST be defined as semantic blue/cyan OKLCH tokens plus `--animate-*` keyframes in Tailwind v4 `@theme`; components and charts MUST consume tokens, not raw hex.

#### Scenario: No hex leaks in charts

- GIVEN the chart component sources
- WHEN grepped for literal hex colors
- THEN zero matches remain outside token definitions

### Requirement: Navigation Route Integrity

Primary navigation MUST link only to existing sections; the dead `/dashboard/wealth/` item MUST be removed.

#### Scenario: Wealth item gone

- GIVEN an authenticated user on any dashboard page
- WHEN the navigation renders
- THEN no wealth entry appears

### Requirement: Retained Chart Contracts And Removed Visual Inventory (S3b)

The change replaces the previous blanket "charts MUST remain intact" clause
with an explicit inventory. Removed by name and MUST NOT be re-mounted or
resurrected as empty shells: `FlowChart`, the expense `CategoryDonut`
consumption, `BudgetBars`, `BudgetsList`, `BalanceChart`, `SavingsChart`,
`MonthlyExpensesChart`, `MonthCompareChart`, the income-source donut reuse, the
finance `PeriodSelector` and the `AnalysisSection` insight block. Retained and
still binding: the telemetry strip structure, the Recharts composition pattern,
the token-only colour rule, the string-money coercion boundary, keyboard focus,
`prefers-reduced-motion` and Spanish typed copy.

#### Scenario: Removed visuals are not present

- GIVEN the finance screen and the dashboard home
- WHEN their rendered blocks are inspected
- THEN none of the removed visuals is mounted, and no placeholder stands in
  for them

#### Scenario: Retained contracts still hold

- GIVEN the surviving chart or strip elements
- WHEN they are inspected
- THEN no hardcoded hex, no untyped copy and no animation under reduced motion
  is found

#### Scenario: A future change cannot read "intact" as "undeletable"

- GIVEN a reader of the canonical specification
- WHEN they look for the removed artefacts
- THEN the removal is stated by name, with the reason being the loss of their
  data source

### Requirement: Finance Screen Source Integrity (S3b)

Every finance block, KPI or chart that remains rendered MUST have at least one
surviving data source, and MUST NOT render a permanent empty state caused by a
missing source. Data whose only origin was the removed ledger MUST be deleted
from the screen, along with its hooks, transforms and i18n keys, rather than
displayed with zeros.

#### Scenario: No perpetual empty block

- GIVEN the finance screen and home rendered with real data
- WHEN the blocks are inspected
- THEN no block shows an empty state for a source that no longer exists

#### Scenario: Deleted chain is complete

- GIVEN a removed visual
- WHEN its supporting code is searched
- THEN its hook, transform and i18n keys were removed together
