# Delta for Frontend Dashboard

**Scope.** The Finance category chart and the compare sub-route move from div-bars to a two-series (and four-series) **line chart over time** with a Día/Semana/Mes/Año period selector whose points are aggregated time buckets. Same movements source, same single-currency and never-netted rules, same Spanish copy discipline.

**Edge cases.** Buckets with no movements MUST render as zero (no gaps in the trend). A bucket boundary MUST be computed on local dates from the `occurred_on` string, never by reparsing the wire value with a timezone. The selected bucket count MUST stay constant per period (14/8/12/5) regardless of data. A category with all-zero buckets MUST still render its chart plus a Spanish "sin movimientos en este periodo" note instead of an empty state, so a working period selector is never mistaken for a broken one. With no category selected the existing Spanish empty state MUST remain.

**Non-goals.** No new chart dependency (`recharts` is already a dependency), no change to the movements endpoint or to the category selector, no return of the removed flow/donut visuals, no change to `PeriodSelector` of Reportes (different range semantics, untouched), no new period kinds beyond Día/Semana/Mes/Año.

## MODIFIED Requirements

### Requirement: Finance Category Chart And Compare Split

The Finance category chart MUST render the movement aggregate for the selected category as a **line chart over time** with two series — `gasto` and `ingreso` — using theme tokens, Spanish labels and COP formatting, and MUST NOT net the two directions. Each point MUST be the aggregated total of one time bucket, and the chart MUST show a fixed number of consecutive buckets per period: **14 days, 8 weeks (Monday-based), 12 months and 5 years**, ending at the unit in progress and ordered oldest to newest. The chart MUST offer a period selector with the four periods `Día`, `Semana`, `Mes`, `Año`, keyboard reachable with visible focus and hit areas of at least 44×44 CSS pixels, and MUST expose a legend when more than one series renders. The compare view MUST show the same period selector and the same line-chart treatment with four series — expense and income for each of the two compared categories — distinguishing the two categories by line style as well as color, with no netting and no currency mixing (single-currency rule from `finance-movements`). The replaced div-bar visual MUST NOT return, and the i18n keys it used that no longer have a consumer MUST be removed together with it. The removed flow/donut visuals MUST NOT return through this chart.
(Previously: the chart rendered two labeled div-bars per category with a single all-time aggregate, no income series when income was zero and no period dimension; the compare view reused the same bars twice.)

#### Scenario: Two series over time

- GIVEN category `C` with one expense and one income in the current month
- WHEN the chart renders for period `Mes`
- THEN it renders a gasto line and an ingreso line with 12 points, the last point carrying the current month totals

#### Scenario: Period switch changes the bucket count

- GIVEN a rendered category chart on period `Mes` with 12 points
- WHEN the user selects `Día`, `Semana` and then `Año`
- THEN the chart renders 14, 8 and 5 points respectively, oldest to newest

#### Scenario: Empty buckets stay in the trend

- GIVEN a category with a single expense 3 days ago and period `Día`
- WHEN the chart renders
- THEN 14 points render and only the corresponding day carries a non-zero gasto

#### Scenario: No data in range is not an empty state

- GIVEN a selected category with no movements inside the selected period
- WHEN the chart renders
- THEN the chart renders a flat zero trend plus the Spanish "sin movimientos en este periodo" note

#### Scenario: Compare shows four labeled lines

- GIVEN two categories with mixed directions
- WHEN the compare view renders
- THEN four lines render — gasto and ingreso for each category — with the two categories separated by line style and no netted figure

#### Scenario: No currency mixing

- GIVEN accounts in COP and USD, user currency COP
- WHEN the chart and compare aggregate
- THEN only COP movements participate and no converted value appears

## ADDED Requirements

### Requirement: Category Trend Bucketing

The system MUST expose a pure, unit-testable helper that turns the movements payload into exactly N consecutive time buckets for a period, each with its own expense and income totals, so that the chart and the compare view share one aggregation rule. The helper MUST keep the single-currency account rule, MUST NOT net expense against income, MUST emit every bucket even when empty, MUST order buckets oldest to newest, and MUST include the unit in progress as the last bucket.
(Previously: the only aggregation helper, `toCategoryMovementTotals`, returned a single all-time total pair per category with no time dimension.)

#### Scenario: Bucket count and order

- GIVEN a movements payload with any dates
- WHEN the helper is asked for `Día`, `Semana`, `Mes` and `Año`
- THEN it returns 14, 8, 12 and 5 buckets respectively, oldest first and the current unit last

#### Scenario: Totals split by direction inside a bucket

- GIVEN a category with `25000` expense and `40000` income on the same day
- WHEN the helper buckets that day
- THEN the bucket carries both figures separately and no third netted figure

#### Scenario: Foreign-currency movements are excluded

- GIVEN the user currency is COP and a movement belongs to a USD account
- WHEN the helper aggregates
- THEN the movement is not counted in any bucket
