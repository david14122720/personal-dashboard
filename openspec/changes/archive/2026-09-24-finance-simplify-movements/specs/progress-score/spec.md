# Delta for Progress Score

**Scope.** The `/progreso` finance area loses its debt and savings-goal inputs (both capabilities retired). The finance score is renormalized minimally over the only surviving input, net worth; no replacement figures are invented and no new product semantics are added.

**Edge cases.** With no net-worth data the finance indicator shows the neutral empty visual (never a fabricated score). A negative net worth scores 0 — the indicator is presentational only and MUST NOT become a verdict.

**Non-goals.** No new finance metric, no movements-based score input, no change to habits/metas/productivity areas, no backend endpoint.

## MODIFIED Requirements

### Requirement: Combined Progress Dashboard

The system MUST expose a `/progreso` route combining: a simple net-worth number (read-only; valuations stay INSERT-only with no writes), goal progress (`GET /goals`), habits (overall compliance, best streaks, pending, weekly evolution via habits-management transforms), and productivity (completed tasks, advanced goals, upcoming events). The outstanding-debt and savings-goal inputs MUST be removed, and the finance area MUST NOT query or display monthly savings, expenses, debt pending or any figure from the removed flow aggregate. Composition MUST be FE-only with zero new backend endpoints.
(Previously: the finance area combined net worth, outstanding debt and savings-goal progress, reading `GET /debts` and `GET /savings-goals`.)

#### Scenario: Progress combines areas

- GIVEN populated finance, habits, goals, and productivity data
- WHEN `/progreso` renders
- THEN all areas appear with their current values in Spanish, with finance drawn from net worth only

#### Scenario: Net worth is read-only

- GIVEN `/progreso` rendered
- WHEN inspected
- THEN no control writes or edits any valuation

#### Scenario: No removed flow or debt figures

- GIVEN the rendered finance area
- WHEN its figures are inspected
- THEN no monthly savings, expense, income or outstanding-debt value is present

#### Scenario: No request to a removed endpoint

- GIVEN any `/progreso` render
- WHEN the network activity is inspected
- THEN no request targets the removed transaction aggregate paths, `/debts` or `/savings-goals`

### Requirement: Visual Area Score

The system MUST render a visual score indicator per area (finanzas / hábitos / metas / productividad) computed by a pure `scoreByArea` transform whose finance input comes only from the surviving source: net worth via `toFinanceScore`. With the debt and savings inputs removed, the finance indicator MUST renormalize minimally: 100 when net worth is greater than zero, 0 when net worth is zero or negative, and `null` (neutral empty visual, never a fabricated score) when no net-worth data is available. The score MUST be presentational only — no diagnosis, no advice, no sensitive conclusion.
(Previously: the finance score combined net worth, savings and debt in a positive/(positive+debt) ratio.)

#### Scenario: Scores render per area

- GIVEN computable data for all four areas
- WHEN the score section renders
- THEN four labelled visual indicators appear, one per area

#### Scenario: Empty score degrades gracefully

- GIVEN an area with no data
- WHEN the score section renders
- THEN that area shows a neutral empty visual, never a fabricated score

#### Scenario: Finance score has a live basis

- GIVEN a user with positive net worth and no debts or savings goals
- WHEN the finance indicator renders
- THEN it is computed from net worth alone and no removed figure is read

#### Scenario: No data yields the neutral visual

- GIVEN a user with no net-worth data
- WHEN the finance indicator renders
- THEN it resolves to `null` and shows the neutral empty visual
