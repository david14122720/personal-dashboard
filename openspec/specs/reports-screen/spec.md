# Reports Screen Specification

## Purpose

Reportes por período solo en pantalla: finanzas, hábitos, metas y actividad
compuestos FE-only desde endpoints existentes, con `PeriodSelector` y sin
PDF/Excel.

## Requirements

### Requirement: Period Selection

The system MUST expose a `/reportes` route with a `PeriodSelector` supporting
week / month / year presets plus custom `from/to`. The selected period MUST drive
all four blocks with a single consistent window.

#### Scenario: Period drives all blocks

- GIVEN the user selects month 2026-09
- WHEN `/reportes` renders
- THEN finance, habits, goals, and activity blocks all reflect 2026-09-01..30

#### Scenario: Custom range

- GIVEN a custom `from/to` selection
- WHEN the report renders
- THEN every block queries within that exact window

### Requirement: Finance Period Block

The finance block MUST show period income / expense / savings from `monthly-flow`
and top categories from `by-category`, composed FE-only with zero new backend
endpoints. Amounts MUST display via `formatMoney` under `es-CO`/`COP`; wire
decimals stay strings with coercion only at the boundary.

#### Scenario: Finance summary renders

- GIVEN `monthly-flow` income `"1000.00"` and expense `"400.00"`
- WHEN the finance block renders
- THEN it shows ingreso, gasto, and ahorro `$ 600` with top categories listed

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

The system MUST compose `/reportes` FE-only with zero new backend endpoints and
MUST NOT offer PDF/Excel export. Each block MUST handle `loading`, `error`, and
`empty` independently: loading shows a per-block placeholder, error shows a
Spanish panel with retry revalidating only its own keys, empty shows a Spanish
`EmptyState`. All strings MUST resolve via typed ES `t(key, vars)` keys; charts
MUST use `next/dynamic(ssr:false)`; tokens `--color-*` with no hex;
`prefers-reduced-motion` and visible keyboard focus MUST hold.

#### Scenario: No export exists

- GIVEN `/reportes` rendered
- WHEN inspected
- THEN no PDF/Excel button, link, or route exists

#### Scenario: Block error isolates

- GIVEN a failed `by-category` fetch
- WHEN `/reportes` renders
- THEN only the finance block shows the Spanish error panel with retry
- AND the other three blocks keep rendering
