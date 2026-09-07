# Delta for Finance Budgets

## ADDED Requirements

### Requirement: Budgets Collection With Inline Status

The system MUST expose `GET /budgets` returning all caller budgets for the current period with each entry including computed status fields (`spent`, `remaining`, `pct`, `status`) — eliminating the per-id N+1 required by the existing single-budget status endpoint. Amounts MUST be decimal strings; `pct` is a number in `[0, ∞)`. `status` MUST be one of `ok`, `warn`, `over` derived from `warn_threshold` / `over_threshold` as in the existing Threshold Alerting requirement.

#### Scenario: List budgets with computed status

- GIVEN two budgets: Food (spent 85%, warn_threshold 0.8) and Transport (spent 40%)
- WHEN `GET /budgets`
- THEN the response is 200 with an array where Food has `status: "warn"` and Transport has `status: "ok"`
- AND each entry carries `spent`, `remaining`, `pct` as documented

#### Scenario: Empty budgets

- GIVEN a user with no active budgets
- WHEN `GET /budgets`
- THEN the response is 200 with an empty array

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `GET /budgets`
- THEN the system returns 401 with envelope `UNAUTHORIZED`
