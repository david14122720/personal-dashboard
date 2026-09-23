# backend-base Specification

## Purpose

Lean Axum foundation: env-driven boot, tuned PgPool for 1 CPU / 1 GB, unified error envelope and request tracing. Grounds migration 0001 (`users`, `sessions`, `user_preferences`).

## Requirements

### Requirement: Server Boot and Env Config

The system MUST boot an Axum server from environment variables and fail closed on missing config. It SHOULD serve static assets when `STATIC_DIR` is set.

#### Scenario: Successful boot with valid env

- GIVEN `DATABASE_URL`, `PORT`, `SESSION_TTL_HOURS` are set
- WHEN the process starts
- THEN it binds on `PORT`, runs migrations check, and serves Axum routes

#### Scenario: Missing required env fails fast

- GIVEN `DATABASE_URL` is unset
- WHEN the process starts
- THEN it exits non-zero without opening a port and logs a sanitized message (no secret value)

#### Scenario: Optional static dir

- GIVEN `STATIC_DIR=/app/static` points to `frontend/out`
- WHEN `GET /` is requested and no API route matches
- THEN the server serves the static file or 404 without leaking filesystem paths

### Requirement: PgPool Tuned for 1 CPU / 1 GB

The system MUST create a `sqlx::PgPool` tuned for constrained resources with bounded connections, timeouts, and offline-checked queries.

#### Scenario: Pool with bounded size

- GIVEN `DATABASE_URL` for PostgreSQL 15+ with `citext`/`pgcrypto`
- WHEN pool is created
- THEN `max_connections` ≤ 5, `min_connections` ≥ 1, `acquire_timeout` ≤ 5 s, `idle_timeout` ≤ 300 s

#### Scenario: DB unreachable on boot

- GIVEN PG is down
- WHEN pool creation or `SELECT 1` health check times out
- THEN boot returns 503 on `/ready` while `/health` stays 200; no panic or stack trace leaks

### Requirement: Unified Error Envelope and Request ID

The system MUST map domain errors via `thiserror` → `IntoResponse` to `{ "error": { "code": "STRING", "message": "STRING" } }` and MUST include `x-request-id` on every response. It MUST NOT leak internal details.

| Domain variant | HTTP | `code` |
|---|---|---|
| `Auth` | 401 | `UNAUTHORIZED` |
| `Forbidden` | 403 | `FORBIDDEN` |
| `Validation` | 422 | `VALIDATION_ERROR` |
| `NotFound` | 404 | `NOT_FOUND` |
| `Conflict` | 409 | `CONFLICT` |
| `Internal`/`Db` | 500 | `INTERNAL_ERROR` |

#### Scenario: 401 maps to envelope with request-id

- GIVEN an unauthenticated request to a protected route
- WHEN the error is returned
- THEN status is 401, body is `{ error: { code: "UNAUTHORIZED", message: "<generic>" } }`, header `x-request-id` is present (UUID v4)

#### Scenario: 422 on validation failure

- GIVEN `POST /login` with `email=""` 
- WHEN validation fails
- THEN status 422, `code` is `VALIDATION_ERROR`, message is generic and does not echo raw SQL

#### Scenario: 500 never leaks internals

- GIVEN a `sqlx` failure
- WHEN the handler returns `AppError::Internal`
- THEN status 500 with message `"Internal server error"` and `code` `INTERNAL_ERROR`; details only in server logs with `x-request-id`

### Requirement: Same-Origin Only — No CORS Layer

The backend MUST NOT install a CORS layer and MUST NOT emit `Access-Control-*` response headers, and MUST NOT introduce an environment allow-list. Same-origin browser access (`STATIC_DIR` serving plus `Authorization: Bearer` from `localStorage`) MUST keep working unchanged.

#### Scenario: No CORS headers on any response

- GIVEN a request to any API route
- WHEN the response headers are inspected
- THEN `Access-Control-Allow-Origin` and the other `Access-Control-*` headers are absent

#### Scenario: Same-origin bearer access still works

- GIVEN a same-origin request carrying a valid bearer token
- WHEN it reaches a protected endpoint
- THEN it returns its normal 200 envelope

#### Scenario: Wildcard removal is greppable

- GIVEN the backend source
- WHEN searched for `allow_origin(Any)`
- THEN zero matches remain

#### Scenario: No env allow-list invented

- GIVEN the configuration surface
- WHEN environment variables are inspected
- THEN no new CORS or allowed-origin variable exists

### Requirement: Bounded Request Timeout on the API Nest

A `TimeoutLayer` with a 15 s budget MUST be applied to the `/api` nest only. It MUST NOT be applied as the outermost layer, MUST NOT cover `ServeDir` static streaming, and MUST NOT cover `/health` or `/ready`. The budget MUST be generous enough that an Argon2id login is never cut off. The `Cargo.toml` change MUST be feature-only (`tower-http` `timeout`) with no version-range change.

#### Scenario: Stalled handler terminates

- GIVEN a handler that stalls beyond the timeout budget
- WHEN a request reaches it
- THEN the request terminates with a bounded timeout status (504) instead of holding the connection open

#### Scenario: Probes and static assets stay outside the timeout

- GIVEN `/health`, `/ready` and a static asset
- WHEN requested while a slow handler runs
- THEN they answer normally, unaffected by the API timeout

#### Scenario: Login is never cut off

- GIVEN an Argon2id login that completes in less than the budget
- WHEN submitted
- THEN it completes without a timeout status

#### Scenario: Dependency edit is features-only

- GIVEN `backend/Cargo.toml`
- WHEN inspected
- THEN only the `tower-http` feature list gained `timeout` and no version range changed

### Requirement: Repo-Owned Security Headers on the Serving Path

The outer router MUST set, via a response-header layer, exactly: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Content-Security-Policy: frame-ancestors 'none'`. The layer MUST cover `ServeDir` responses and API JSON responses, including error responses (401/404/422/500) and the SPA fallback document. The app MUST NOT emit `script-src` and MUST NOT emit `Permissions-Policy`.

#### Scenario: Headers on a static path

- GIVEN `curl -sI` against a static path
- WHEN the response headers are inspected
- THEN all four values match exactly

#### Scenario: Headers on an API path

- GIVEN `curl -sI` against an API path
- WHEN the response headers are inspected
- THEN all four values match exactly

#### Scenario: Headers on error and fallback responses

- GIVEN a 401, 404, 422 or 500 response and the SPA fallback `index.html`
- WHEN each is inspected
- THEN each carries all four headers

#### Scenario: No script-src and no Permissions-Policy

- GIVEN the served CSP value
- WHEN inspected
- THEN it is exactly `frame-ancestors 'none'` with no `script-src`, and no `Permissions-Policy` header is emitted by the app

### Requirement: Accepted Plaintext-LAN Exposure

The deployment MUST be documented as an explicitly accepted plaintext-LAN deployment: no TLS, certificate, HSTS, Traefik or firewall work is in scope, and the acceptance MUST be recorded in the spec set so it cannot be rediscovered as a defect. Any exposure beyond the trusted LAN MUST invalidate the acceptance and requires its own change.

#### Scenario: Acceptance is written down

- GIVEN the spec set
- WHEN a reader looks for the transport decision
- THEN the plaintext-LAN acceptance and its invalidation condition are stated

#### Scenario: No TLS work smuggled in

- GIVEN the change diff
- WHEN inspected
- THEN no TLS, HSTS, certificate or edge-configuration change is present
