# Delta for Finance Movements

**Scope.** The Dashboard home consumes the movement ledger directly for two client-side aggregates: an all-category totals trend and a current-period expense-by-category pie. The REST contract, the atomic balance effect, the history list and the add/edit UI are untouched. What changes is that the movement source now also feeds chart aggregates outside the Finance screen.

**Edge cases.** The totals trend includes rows whose `category_id` is null (it is not a category aggregate); the pie excludes them, per the existing category-aggregation rule. Both aggregates apply the single-currency rule with the same fallback used by `toCategoryTrend`: movements whose owning account currency differs from the user currency are excluded, and an account missing from the currency map falls back to the user currency. Bucket boundaries compare local `YYYY-MM-DD` strings, never reparsed wire dates. The pie's Week is a trailing seven-day window ending today, deliberately different from the Monday-first calendar week used by the trend buckets.

**Non-goals.** No `GET /movements/stats`, no server-side aggregation, no pagination, no per-movement currency field, no conversion, no change to `GET /api/movements` ordering or payload, no change to history, filters, modals or balance semantics.

## ADDED Requirements

### Requirement: Dashboard Movement Aggregates

The Dashboard home MUST derive, client-side from the existing `GET /movements` response, two aggregates. (a) Totals per consecutive period bucket: N buckets oldest to newest using the existing counts (Día 14, Semana 8, Mes 12, Año 5), with separate expense and income sums, never netted and never grouped by category; every matching movement participates, including rows with a null `category_id`. (b) Expense-by-category for the current local period: Day = today, Week = trailing seven days ending today, Month = current calendar month, Year = current calendar year; expenses only, grouped by persisted `category_id`, with rows lacking a category and categories whose total is zero excluded. Both aggregates MUST use the single-currency rule of `Movement Category Aggregation` (user currency from `GET /me`, fallback COP; never convert or mix) and MUST NOT introduce or call a new endpoint. No per-movement currency field MAY be added to the wire contract.

#### Scenario: Totals include null-category movements

- GIVEN a user with an expense in category `C` and an expense with `category_id: null`, both in the same bucket and user currency
- WHEN the totals aggregate
- THEN both amounts contribute to the bucket expense total

#### Scenario: Pie excludes null-category movements

- GIVEN the same two expenses
- WHEN the expense-by-category aggregate runs
- THEN only category `C` receives a total and no null/«sin categoría» bucket exists

#### Scenario: Buckets are exact and ordered

- GIVEN any of the four periods
- WHEN the totals aggregate runs
- THEN it returns exactly the fixed count for that period, adjacent windows oldest to newest, with the current window last

#### Scenario: Never netted

- GIVEN a bucket with expense `100.00` and income `50.00`
- WHEN either aggregate runs
- THEN the two values stay separate and no `50.00` net figure is produced

#### Scenario: Single currency only

- GIVEN user currency COP, a COP account and a USD account each holding movements in the period
- WHEN either aggregate runs
- THEN only the COP movements participate and no conversion or mixed sum appears

#### Scenario: Current-period ranges for the pie

- GIVEN today `W`
- WHEN the pie aggregate runs per option
- THEN Día covers `W..W`, Semana covers `W-6..W`, Mes covers the first to the last day of the current calendar month and Año covers the current calendar year

#### Scenario: No new endpoint

- GIVEN the Dashboard charts rendered and interacted with
- WHEN the network activity is inspected
- THEN both aggregates were computed client-side from the existing movements response and no `/movements/stats` or other new request was issued
