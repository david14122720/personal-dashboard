# health-checks Specification

## Purpose

Split probes for orchestration: cheap liveness vs DB-aware readiness. No auth required.

## Requirements

### Requirement: Liveness Probe GET /health

The system MUST expose `GET /health` that returns 200 without touching the database or requiring auth. It MUST include `x-request-id`.

#### Scenario: Liveness always 200

- GIVEN the Axum process is running (DB up or down)
- WHEN `GET /health`
- THEN status 200, body `{ status: "ok" }` (or `{ status: "healthy" }`), header `x-request-id` present; no DB query executed

#### Scenario: Liveness unauthenticated

- GIVEN no `Authorization` header
- WHEN `GET /health`
- THEN still 200; middleware skips auth for this path

### Requirement: Readiness Probe GET /ready

The system MUST expose `GET /ready` that executes `SELECT 1` with a bounded timeout (≤ 2 s) via `PgPool`. On success returns 200 `{ status: "ready" }`; on failure/timeout returns 503 `{ status: "not-ready" }`. It MUST include `x-request-id`.

#### Scenario: Ready when DB reachable

- GIVEN `PgPool` can `SELECT 1` within timeout
- WHEN `GET /ready`
- THEN status 200, body `{ status: "ready" }`

#### Scenario: Not-ready when DB down or timeout

- GIVEN PG is unreachable or `SELECT 1` exceeds 2 s
- WHEN `GET /ready`
- THEN status 503, body `{ status: "not-ready" }`, no panic, no stack trace, `x-request-id` present

#### Scenario: Readiness unauthenticated and not rate-limited as login

- GIVEN no `Authorization` header
- WHEN `GET /ready`
- THEN it runs without auth and is not counted toward login rate limit
