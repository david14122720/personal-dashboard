# Finance Charts Specification

## Purpose

Análisis visual simple de finanzas: 4 gráficos nuevos FE-only más reuso del donut, con selector de período cuyo default es el mes actual.

## Requirements

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
