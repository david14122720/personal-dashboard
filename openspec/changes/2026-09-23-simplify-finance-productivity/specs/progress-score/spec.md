# Delta for Progress Score

**Scope.** Re-point the finance part of `/progreso` from the removed flow aggregate to surviving sources (net worth, outstanding debt, savings-goal progress) and update the area-score inputs accordingly; habits, goals and productivity areas keep their contracts. The canonical `Fixed Disclaimer` requirement is unchanged. Slice S3.

**Edge cases.** A user with no debts or no savings goals MUST get a neutral finance visual from live data, never a fabricated score or a permanent empty block. The fixed disclaimer MUST keep rendering in every state, including when the finance area degrades. No area score may be computed from a removed endpoint.

**Non-goals.** No new endpoint, no balance-history chart, no diagnostic or advisory copy, no change to habit/goal/productivity scoring semantics, no export.

## MODIFIED Requirements

### Requirement: Combined Progress Dashboard

The system MUST expose a `/progreso` route combining: a simple net-worth number and outstanding debt (read-only; valuations stay INSERT-only with no writes), savings-goal and goal progress (`GET /goals` + savings goals), habits (overall compliance, best streaks, pending, weekly evolution via habits-management transforms), and productivity (completed tasks, advanced goals, upcoming events). The finance area MUST NOT query or display monthly savings or expenses from the removed flow aggregate. Composition MUST be FE-only with zero new backend endpoints.
(Previously: the finance area was built on monthly savings and expenses from `monthly-flow` plus the net-worth number.)

#### Scenario: Progress combines areas

- GIVEN populated finance, habits, goals, and productivity data
- WHEN `/progreso` renders
- THEN all areas appear with their current values in Spanish, with finance drawn from net worth, debt and savings progress

#### Scenario: Net worth is read-only

- GIVEN `/progreso` rendered
- WHEN inspected
- THEN no control writes or edits any valuation

#### Scenario: No removed flow figures

- GIVEN the rendered finance area
- WHEN its figures are inspected
- THEN no monthly savings, expense or income value from the removed aggregate is present

#### Scenario: No request to a removed endpoint

- GIVEN any `/progreso` render
- WHEN the network activity is inspected
- THEN no request targets the removed transaction aggregate paths

### Requirement: Visual Area Score

The system MUST render a visual score indicator per area (finanzas / hábitos / metas / productividad) computed by a pure `scoreByArea` transform whose finance input comes only from surviving sources (net worth, debt, savings-goal progress). The score MUST be presentational only — no diagnosis, no advice, no sensitive conclusion.
(Previously: the finance score was derived from the monthly-flow savings figure.)

#### Scenario: Scores render per area

- GIVEN computable data for all four areas
- WHEN the score section renders
- THEN four labelled visual indicators appear, one per area

#### Scenario: Empty score degrades gracefully

- GIVEN an area with no data
- WHEN the score section renders
- THEN that area shows a neutral empty visual, never a fabricated score

#### Scenario: Finance score has a live basis

- GIVEN a user with a net worth and no savings goals
- WHEN the finance indicator renders
- THEN it is computed from the surviving inputs and no removed figure is read
