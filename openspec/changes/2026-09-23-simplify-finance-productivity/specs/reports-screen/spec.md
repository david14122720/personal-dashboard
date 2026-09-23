# Delta for Reports Screen

**Scope.** Replace the flow/category finance block of `/reportes` with a snapshot built from surviving sources (net worth, monthly subscription cost, outstanding debt), and update the period-selection and error-isolation contracts accordingly. Slice S3.

**Edge cases.** The finance snapshot is not windowed by the selected period, so it MUST be labelled as a current value to avoid reading as "this month". A user with no debts or no subscriptions MUST see a neutral zero/empty label from a live source, never a hole where the block used to be. Errors in the snapshot MUST NOT take down the habit, goal or activity blocks.

**Non-goals.** No new backend endpoint, no period-scoped income/expense reconstruction, no PDF/Excel export, no new chart requirement, no change to habit/goal/activity blocks.

## MODIFIED Requirements

### Requirement: Period Selection

The system MUST expose a `/reportes` route with a `PeriodSelector` supporting week / month / year presets plus custom `from/to`. The selected period MUST drive the period-scoped blocks (habits, goals, activity) with a single consistent window. The finance block is a current snapshot and MUST be visibly labelled as such; it MUST NOT be presented as if it were computed over the selected window.
(Previously: the selected period drove all four blocks with a single window, including the finance block.)

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
- THEN it shows current values with an explicit current-value label and does not shift with the window

### Requirement: Screen-Only Composition Constraints

The system MUST compose `/reportes` FE-only with zero new backend endpoints, MUST read only surviving endpoints, and MUST NOT offer PDF/Excel export. Each block MUST handle `loading`, `error`, and `empty` independently: loading shows a per-block placeholder, error shows a Spanish panel with retry revalidating only its own keys, empty shows a Spanish `EmptyState` for a live source that happens to be empty. All strings MUST resolve via typed ES `t(key, vars)` keys; charts MUST use `next/dynamic(ssr:false)`; tokens `--color-*` with no hex; `prefers-reduced-motion` and visible keyboard focus MUST hold.
(Previously: the block-error scenario was driven by the category aggregate, and the constraint set did not state that only surviving endpoints may be read.)

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

## ADDED Requirements

### Requirement: Finance Snapshot Block From Surviving Sources

The finance block of `/reportes` MUST show only values with a surviving source: net worth from the existing net-worth read (valuations stay INSERT-only and read-only here), the current monthly cost of active subscriptions, and the total outstanding debt from active debts. It MUST NOT show period income, expense or savings, top categories, or any figure derived from the removed ledger. Amounts MUST display via `formatMoney` under `es-CO`/`COP`, with wire decimals coerced only at the boundary.

#### Scenario: Snapshot renders from live sources

- GIVEN net worth, two active subscriptions and one active debt with a pending amount
- WHEN the finance block renders
- THEN patrimonio, costo mensual de suscripciones and deuda pendiente appear with COP formatting

#### Scenario: No flow figures

- GIVEN the rendered finance block
- WHEN its figures are inspected
- THEN no ingreso, gasto, ahorro del período or top-categorías item is present

#### Scenario: Net worth stays read-only

- GIVEN the snapshot rendered
- WHEN the user interacts with it
- THEN no control writes or edits a valuation

#### Scenario: Legitimately empty source

- GIVEN a user with no subscriptions and no debts
- WHEN the snapshot renders
- THEN each figure shows a neutral zero or Spanish empty label from its live source

## REMOVED Requirements

### Requirement: Finance Period Block

(Removed behaviour: period income/expense/savings from the monthly-flow aggregate plus top categories from the category aggregate, composed FE-only with boundary-only coercion.)
(Reason: both aggregates are removed with the ledger, so the block had no source and would have rendered an eternal empty state; the period-scoped shaper is replaced by a current snapshot.)
(Migration: the block's hooks, transforms and i18n keys MUST be deleted; the replacement is "Finance Snapshot Block From Surviving Sources" above. A future period-scoped finance report would require a new change with a designed data source.)
