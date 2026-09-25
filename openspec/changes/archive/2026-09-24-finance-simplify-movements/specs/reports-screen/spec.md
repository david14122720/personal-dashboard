# Delta for Reports Screen

**Scope.** The `/reportes` finance snapshot loses its outstanding-debt figure; net worth and the monthly subscription cost survive unchanged. The other blocks and constraints keep their current behaviour.

**Edge cases.** A user with no subscriptions renders a neutral zero/label from the surviving source; no debt placeholder MAY take the removed figure's place.

**Non-goals.** No PDF/Excel export, no period-scoped finance figures, no new backend endpoint.

## MODIFIED Requirements

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
