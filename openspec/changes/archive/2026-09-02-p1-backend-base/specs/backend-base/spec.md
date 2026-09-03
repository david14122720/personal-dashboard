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
