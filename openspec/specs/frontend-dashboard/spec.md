# Frontend Dashboard Specification

## Purpose

Static-export Next.js control center rendering aggregates as Recharts charts, with a telemetry-deck home, preferences persistence, and bearer-token session handling. Served same-origin by Axum via `STATIC_DIR` in production.

## Requirements

### Requirement: Telemetry Strip

The dashboard home MUST render a full-width Telemetry Strip showing net worth, current-month balance, savings rate, longest streak, and budget status LEDs. Each LED MUST map backend enums 1:1: `alert_level` ∈ {`ok`, `warn`, `high`} and budget `status` ∈ {`ok`, `warn`, `over`} to their documented visual states. Values MUST be formatted per user `locale`/`currency_code` preferences using the string-money coercion layer.

#### Scenario: Enum mapping

- GIVEN a card account with `alert_level: "warn"` and a budget with `status: "over"`
- WHEN the dashboard renders
- THEN the corresponding LEDs display the warn and over visual states

#### Scenario: Money formatting

- GIVEN preferences `locale: "es-CO"`, `currency_code: "COP"` and net worth `"1500000.00"`
- WHEN the strip renders
- THEN the value displays as `$ 1.500.000` (tabular, locale-correct)

### Requirement: Recharts Aggregates

The dashboard MUST render monthly income-vs-expense and spend-by-category charts using Recharts 3. Data MUST come from the authenticated aggregate endpoints; the client MUST coerce decimal-string amounts to numbers at the API boundary only. Charts MUST be code-split per route. Month axis labels MUST render in Spanish, series colors MUST reference theme tokens (never hardcoded hex), and charts MUST carry direct value labels and currency-formatted Spanish tooltips.
(Previously: raw `YYYY-MM` axis labels, hardcoded hex series colors, no direct value labels or currency tooltips.)

#### Scenario: Chart renders from aggregates

- GIVEN authenticated aggregates `[{ month: "2026-09", income: "1000.00", expense: "400.00" }]`
- WHEN the dashboard mounts
- THEN the chart plots coerced values with a Spanish month label

#### Scenario: Empty aggregates

- GIVEN an empty aggregate response
- WHEN the chart mounts
- THEN the chart renders an empty state without errors

#### Scenario: Token-driven colors

- GIVEN a theme color token is changed
- WHEN charts re-render
- THEN series colors follow the token with no code change

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

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/finance-charts/spec.md (alias draft resolved to wire names) -->

### Requirement: Balance Chart

The system MUST render `BalanceChart` (area) showing balance evolution as accumulated `income − expense` from `monthly-flow` (`toFlowPoints().balance`). Data MUST be coerced string→number only at the transform boundary.

#### Scenario: Balance renders from flow

- GIVEN `monthly-flow` `[{month: "2026-08", income: "1000.00", expense: "400.00"}, {month: "2026-09", income: "1200.00", expense: "500.00"}]`
- WHEN `BalanceChart` renders
- THEN it plots accumulated balances `600` then `1300` with Spanish month labels

#### Scenario: Empty balance shows EmptyState

- GIVEN an empty `monthly-flow` response
- WHEN `BalanceChart` renders
- THEN it shows the Spanish empty state without errors

### Requirement: Savings Chart

The system MUST render `SavingsChart` (line/area) showing monthly savings `income − expense` per month from `monthly-flow`.

#### Scenario: Savings renders

- GIVEN `monthly-flow` with September income `"1000.00"` expense `"400.00"`
- WHEN `SavingsChart` renders
- THEN September point equals `600` COP-labeled in Spanish

### Requirement: Monthly Expenses Chart

The system MUST render `MonthlyExpensesChart` (bars) showing the `expense` column of `monthly-flow` per month.

#### Scenario: Expenses render

- GIVEN `monthly-flow` with expenses `"300.00"` (Aug) and `"500.00"` (Sep)
- WHEN the chart renders
- THEN both bars appear with COP tooltips in Spanish

### Requirement: Month Compare Chart

The system MUST render `MonthCompareChart` (paired bars + delta %) comparing the current month vs the previous month from `monthly-flow`.

#### Scenario: Compare with delta

- GIVEN August expense `"400.00"` and September `"500.00"`
- WHEN the chart renders
- THEN it shows both bars plus delta `+25%` in Spanish

### Requirement: Income Source Reuse

The system MUST render ingresos-por-fuente by reusing the existing `CategoryDonut` with `by-category?type=income`. The `useSpendByCategory` hook MUST accept a `type` param instead of hardcoding `expense`. A separate `IncomeSourceDonut` SHALL only be created if reuse proves impossible.

#### Scenario: Income donut reuses component

- GIVEN `by-category?type=income` rows `[{name: "Salario", total: "2000000.00"}]`
- WHEN the income-source chart renders
- THEN the shared donut shows `"Salario"` with COP tooltip in Spanish

### Requirement: Period Selector

The system MUST provide `PeriodSelector` with ranges semana (last 7 days) / mes / trimestre / año / custom (two `YYYY-MM-DD` date inputs). Default MUST be the current month (owner decision). Selection MUST compute `from/to` for the existing `by-category` + `monthly-flow` endpoints (whose `validate_stats_range` already supports the range); charts MUST aggregate in FE what the range returns. No new BE endpoint SHALL be created.

#### Scenario: Default is current month

- GIVEN a user opening finance on 2026-09-09
- WHEN the screen loads
- THEN `PeriodSelector` starts on September 2026 and charts query that `from/to`

#### Scenario: Custom range filters aggregates

- GIVEN a user picking custom `2026-07-01` to `2026-09-09`
- WHEN they apply it
- THEN charts re-query both aggregates with that `from/to` and re-render

### Requirement: Charts Visual and A11y Contract

All S6 charts MUST use Recharts 3 with `next/dynamic(ssr:false)`, theme tokens `--color-*` (never hardcoded hex), Spanish labels and COP tooltips, `prefers-reduced-motion` suppression of draw-in animation, keyboard focus visibility, and Spanish `EmptyState` on no data. No `window` access at import time (static-export safe).

#### Scenario: Reduced motion suppresses animation

- GIVEN `prefers-reduced-motion: reduce`
- WHEN any S6 chart renders
- THEN draw-in animation is skipped

#### Scenario: No hex leaks

- GIVEN S6 chart sources
- WHEN grepped for literal hex colors
- THEN zero matches remain outside token definitions

### Requirement: Existing Charts Intact and Transfer Exclusion

`FlowChart` (income vs expense), `CategoryDonut` (expense), and `BudgetBars`/`BudgetsList` MUST remain intact. All S6 charts MUST inherit the existing `transfer` exclusion from aggregates without "fixing" it.

#### Scenario: Transfers excluded

- GIVEN a transfer movement in the period
- WHEN S6 charts render
- THEN transfer amounts appear in no income/expense/balance figure

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/finance-analysis/spec.md (alias draft resolved to wire names) -->

### Requirement: Month-over-Month Computation

The system MUST compute MoM variation with a pure `toMonthOverMonth` transform over `monthly-flow` (current vs previous month income/expense deltas + %).

#### Scenario: MoM delta correct

- GIVEN August expense `"400.00"` and September `"500.00"`
- WHEN `toMonthOverMonth` runs
- THEN it returns `+100.00` and `+25%` for expense

#### Scenario: Single month yields no delta

- GIVEN only one month in `monthly-flow`
- WHEN the analysis renders
- THEN the MoM line is omitted without errors

### Requirement: Savings and Averages Indicators

The `AnalysisSection` MUST show pure-computed indicators from `monthly-flow` + `by-category`: savings rate, income/expense averages, top category, highest-spend and highest-saving months. All money MUST be coerced string→number only in transforms and formatted COP.

#### Scenario: Indicators render

- GIVEN three months of flow plus `by-category` top `"Mercado"`
- WHEN `AnalysisSection` renders
- THEN it shows tasa de ahorro, promedios, top categoría and extreme months with correct COP values

### Requirement: Direct ES Template Insights

Insights MUST be a closed list of fixed Spanish templates in direct tone (owner decision, e.g. "Este mes gastaste N% más en X que el mes anterior"). At least 3 insights MUST render when data suffices. No LLM or free generation SHALL exist; templates live in `analysis.*` i18n keys with value interpolation only.

#### Scenario: Direct insight renders

- GIVEN September food spend 18% above August
- WHEN insights render
- THEN one line reads direct-tone Spanish with `18%` and category `"Mercado"` (exact template wording from i18n)

### Requirement: Non-Advisor Disclaimer

Every analysis render MUST include the Spanish non-advisor disclaimer ("análisis personal, no asesoramiento financiero").

#### Scenario: Disclaimer always visible

- GIVEN any populated or empty analysis
- WHEN `AnalysisSection` renders
- THEN the Spanish disclaimer is visible

### Requirement: Recurrent Versus Extraordinary Heuristic v1

The v1 heuristic MUST use `description` frequency within the selected period to label recurrent vs extraordinary spend. If frequency is inconclusive, that line MUST be omitted — never invented.

#### Scenario: Inconclusive heuristic omitted

- GIVEN all descriptions appear once in the period
- WHEN insights render
- THEN no recurrent/extraordinary line appears

#### Scenario: Recurrent line renders on frequency

- GIVEN `"Arriendo"` appearing every month in the period
- WHEN insights render
- THEN the recurrent template line names `"Arriendo"` in Spanish

### Requirement: Analysis Empty and i18n Contract

With no data the section MUST render the Spanish `EmptyState` plus the disclaimer. All strings MUST come from `analysis.*`/`finance.*` keys; hardcoded literals are forbidden. The section MUST respect `prefers-reduced-motion` and keyboard focus like all finance sections.

#### Scenario: Empty analysis

- GIVEN empty `monthly-flow` and empty `by-category`
- WHEN `AnalysisSection` renders
- THEN it shows the Spanish empty state and the disclaimer
