# Progress Score Specification

## Purpose

Dashboard de progreso personal que combina finanzas, hábitos, metas y
productividad, con puntuación visual por área y disclaimer fijo siempre visible,
sin conclusiones sensibles.

## Requirements

### Requirement: Combined Progress Dashboard

The system MUST expose a `/progreso` route combining: monthly savings + expenses
(`monthly-flow`), simple net-worth number (read-only, existing value — valuaciones
stay INSERT-only, no writes), goal progress (`GET /goals` + savings-goals),
habits (overall compliance, best streaks, pending, weekly evolution via
habits-management transforms), and productivity (completed tasks, advanced goals,
upcoming events). Composition MUST be FE-only with zero new backend endpoints.

#### Scenario: Progress combines areas

- GIVEN populated finance, habits, goals, and productivity data
- WHEN `/progreso` renders
- THEN all five areas appear with their current values in Spanish

#### Scenario: Net worth is read-only

- GIVEN `/progreso` rendered
- WHEN inspected
- THEN no control writes or edits any valuation

### Requirement: Visual Area Score

The system MUST render a visual score indicator per area
(finanzas / hábitos / metas / productividad) computed by a pure `scoreByArea`
transform. The score MUST be presentational only — no diagnosis, no advice, no
sensitive conclusion.

#### Scenario: Scores render per area

- GIVEN computable data for all four areas
- WHEN the score section renders
- THEN four labelled visual indicators appear, one per area

#### Scenario: Empty score degrades gracefully

- GIVEN an area with no data
- WHEN the score section renders
- THEN that area shows a neutral empty visual, never a fabricated score

### Requirement: Fixed Disclaimer

Every render of `/progreso` MUST include the fixed Spanish disclaimer
("orientativo, sin conclusiones médicas/psicológicas/financieras"), always
visible alongside populated or empty states.

#### Scenario: Disclaimer always visible

- GIVEN any `/progreso` state, including empty
- WHEN the page renders
- THEN the fixed disclaimer is visible without scrolling tricks or dismissal

### Requirement: Progress Composition Constraints

The system MUST respect the inherited contracts: typed ES `t(key, vars)` with
zero hardcoded literals, `formatMoney` es-CO/COP with boundary-only coercion,
`--color-*` tokens without hex, `prefers-reduced-motion`, visible keyboard
focus, `next/dynamic(ssr:false)` for charts, bearer localStorage with
single-flight 401, and per-section `loading`/`error`/`empty` handling with
Spanish `EmptyState` plus retry.

#### Scenario: Spanish typed copy

- GIVEN `/progreso` rendered
- WHEN inspected
- THEN all visible strings resolve via the typed ES dictionary
