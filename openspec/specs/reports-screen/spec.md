# Reports Screen Specification

## Purpose

Reportes solo en pantalla: una foto actual de finanzas (patrimonio, costo
mensual de suscripciones, deuda pendiente) más hábitos, metas y actividad por
período, compuestos FE-only desde endpoints existentes, con `PeriodSelector`
propio y sin PDF/Excel.

## Requirements

### Requirement: Period Selection

The system MUST expose a `/reportes` route with a `PeriodSelector` supporting
week / month / year presets plus custom `from/to`. The selected period MUST
drive the period-scoped blocks (habits, goals, activity) with a single
consistent window. The finance block is a current snapshot and MUST be visibly
labelled as such (`reports.financeCurrent`); it MUST NOT be presented as if it
were computed over the selected window.

#### Scenario: Period drives the period-scoped blocks

- GIVEN the user selects month 2026-09
- WHEN `/reportes` renders
- THEN habits, goals and activity all reflect 2026-09-01..30

#### Scenario: Custom range

- GIVEN a custom `from/to` selection
- WHEN the report renders
- THEN every period-scoped block queries within that exact window

#### Scenario: Finance snapshot is not period-scoped

- GIVEN any selected period
- WHEN the finance snapshot renders
- THEN it shows current values with an explicit current-value label and does
  not shift with the window

### Requirement: Finance Snapshot Block From Surviving Sources

The finance block of `/reportes` MUST show only values with a surviving source: net worth from the existing net-worth read (valuations stay INSERT-only and read-only here) and the current monthly cost of active subscriptions. It MUST NOT show total outstanding debt, period income, expense or savings, top categories, or any figure derived from the removed ledger or from the retired debts/savings capabilities. Amounts MUST display via `formatMoney` under `es-CO`/`COP`, with wire decimals coerced only at the boundary.
(Previously: the block also showed the total outstanding debt from active debts.)

#### Scenario: Snapshot renders from live sources

- GIVEN net worth and two active subscriptions
- WHEN the finance block renders
- THEN patrimonio and costo mensual de suscripciones appear with COP formatting and no debt figure exists

#### Scenario: No flow or debt figures

- GIVEN the rendered finance block
- WHEN its figures are inspected
- THEN no ingreso, gasto, ahorro del período, top-categorías or deuda pendiente item is present

#### Scenario: No debt request

- GIVEN `/reportes` rendered
- WHEN the network activity is inspected
- THEN no request targets `/debts` or `/savings-goals`

#### Scenario: Net worth stays read-only

- GIVEN the snapshot rendered
- WHEN the user interacts with it
- THEN no control writes or edits a valuation

#### Scenario: Legitimately empty source

- GIVEN a user with no subscriptions
- WHEN the snapshot renders
- THEN the subscription figure shows a neutral zero or Spanish empty label from its live source
### Requirement: Habits Period Block

The habits block MUST show period compliance per habit computed with the
habits-management period-stats transforms over `GET /habits/logs?from&to` data.
Copy MUST be Spanish without guilt.

#### Scenario: Habits compliance renders

- GIVEN range logs for two habits in the period
- WHEN the habits block renders
- THEN each habit shows its compliance % and counts, labelled by name

### Requirement: Goals and Activity Blocks

The goals block MUST show progress from `GET /goals` (`progress` read-only).
The activity block MUST show completed tasks from `GET /tasks?view=` and events
from `GET /events?from&to` (overlap semantics) within the period.

#### Scenario: Goals and activity render

- GIVEN goals with `progress: 60` and completed tasks plus events in range
- WHEN the blocks render
- THEN goal progress, completed tasks, and period events appear

### Requirement: Screen-Only Composition Constraints

The system MUST compose `/reportes` FE-only with zero new backend endpoints,
MUST read only surviving endpoints, and MUST NOT offer PDF/Excel export. Each
block MUST handle `loading`, `error`, and `empty` independently: loading shows
a per-block placeholder, error shows a Spanish panel with retry revalidating
only its own keys, empty shows a Spanish `EmptyState` for a live source that
happens to be empty. All strings MUST resolve via typed ES `t(key, vars)` keys;
charts MUST use `next/dynamic(ssr:false)`; tokens `--color-*` with no hex;
`prefers-reduced-motion` and visible keyboard focus MUST hold.

#### Scenario: No export exists

- GIVEN `/reportes` rendered
- WHEN inspected
- THEN no PDF/Excel button, link, or route exists

#### Scenario: Block error isolates

- GIVEN a failed subscriptions fetch
- WHEN `/reportes` renders
- THEN only the finance snapshot shows the Spanish error panel with retry
- AND the other three blocks keep rendering

#### Scenario: No request to a removed endpoint

- GIVEN `/reportes` rendered
- WHEN the network activity is inspected
- THEN no request targets the removed transaction aggregate paths
