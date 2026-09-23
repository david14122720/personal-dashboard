# Delta for Health Checks

## ADDED Requirements

### Requirement: Probes Exempt from the API Request Timeout

`GET /health` and `GET /ready` MUST remain outside the `/api` request timeout. Their existing contracts are unchanged: liveness returns 200 without touching the database, readiness returns 200/503 within its own ≤ 2 s `SELECT 1` budget, and neither probe MUST be answered with a timeout status introduced by the API layer.

#### Scenario: Liveness unaffected by the timeout layer

- GIVEN the timeout layer is installed on `/api`
- WHEN `GET /health` is requested, including while a slow `/api` handler runs
- THEN it returns 200 `{ status: "ok" }` with `x-request-id` present

#### Scenario: Readiness keeps its own budget

- GIVEN PG is unreachable
- WHEN `GET /ready` is requested
- THEN it returns 503 `{ status: "not-ready" }` within its ≤ 2 s probe budget, not a timeout status from the API layer

#### Scenario: Probes stay unauthenticated and out of the login limit

- GIVEN no `Authorization` header
- WHEN either probe is requested
- THEN neither requires auth nor counts toward the login rate limit

## Edge cases

- A timeout layer on the outermost router would also cover the probes and `ServeDir`; that placement is forbidden (see `backend-base`).
- Liveness must stay DB-free, so readiness's probe budget must not become a liveness dependency.

## Non-goals

- No change to probe paths, response bodies, status codes or auth rules.
- No new probe and no new dependency in the liveness path.
