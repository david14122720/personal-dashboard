# session-auth Specification

## Purpose

Opaque session-token auth grounded in migration 0001: `users(email CITEXT UNIQUE, password_hash, is_active)` and `sessions(token_hash TEXT UNIQUE, user_id FK CASCADE, expires_at, revoked_at, user_agent, ip_address)` with partial index on active sessions.

## Requirements

### Requirement: Login — Opaque Token Issuance

The system MUST authenticate via `POST /login` with `{ email, password }`, verify `password_hash` with Argon2id, check `is_active`, enforce rate limit 10 requests / 15 min per IP, generate a 256-bit random token (≥ 32 bytes, base64url), store only `SHA-256(token)` in `sessions.token_hash`, and return the raw token once. It MUST NOT log passwords or raw tokens.

#### Scenario: Successful login

- GIVEN a `users` row with `email` (CITEXT) and Argon2id `password_hash`, `is_active=true`
- WHEN `POST /login` with correct `email`+`password`
- THEN status 200, body `{ token, expires_at }`, DB row has `token_hash=hex(SHA256(token))`, `user_id` matches, `revoked_at IS NULL`, `expires_at = now() + SESSION_TTL_HOURS`

#### Scenario: Wrong password returns generic 401

- GIVEN valid email but wrong password
- WHEN `POST /login`
- THEN status 401, `code` `UNAUTHORIZED`, message `"Invalid credentials"`; timing does not reveal user existence; no password in logs

#### Scenario: Inactive user denied

- GIVEN `users.is_active=false`
- WHEN `POST /login` with correct password
- THEN status 401 with same generic message as bad password

#### Scenario: Rate limit exceeded

- GIVEN 10 `POST /login` from same IP within 15 min
- WHEN the 11th request arrives
- THEN status 429 with `Retry-After` header; counter is keyed by IP (and optionally email hash), survives only in-process for P1 (no Redis)

#### Scenario: CITEXT email case-insensitive

- GIVEN `users.email='Test@Example.com'`
- WHEN `POST /login` with `email='test@example.com'`
- THEN lookup succeeds (uses `WHERE email = $1` on CITEXT)

### Requirement: Logout — Token Revocation

The system MUST revoke the calling session via `POST /logout` with `Authorization: Bearer <token>`.

#### Scenario: Successful logout

- GIVEN an active session (`revoked_at IS NULL`, `expires_at > now()`)
- WHEN `POST /logout` with its Bearer token
- THEN status 204, DB row updated `revoked_at = now()`; subsequent use of same token yields 401

#### Scenario: Logout without token

- GIVEN no `Authorization` header
- WHEN `POST /logout`
- THEN status 401 with envelope `UNAUTHORIZED`

### Requirement: Auth Middleware and GET /me

The system MUST protect `GET /me` (and future private routes) with middleware that: extracts `Bearer <token>`, computes `SHA-256(token)` hex, queries `sessions` where `token_hash=$1 AND revoked_at IS NULL AND expires_at > now()`, joins `users` and `user_preferences`, and injects user context. It MUST fail closed on any error.

#### Scenario: Valid token returns profile

- GIVEN an active session and `user_preferences` row (currency `COP`, locale `es-CO`, timezone `America/Bogota`)
- WHEN `GET /me` with `Authorization: Bearer <valid>`
- THEN status 200 with `{ id, email, display_name, preferences: { currency_code, locale, timezone, dashboard_layout } }`; no `password_hash` or `token_hash` in response

#### Scenario: Expired session rejected

- GIVEN `sessions.expires_at < now()`
- WHEN `GET /me` with its token
- THEN status 401, `code` `UNAUTHORIZED`

#### Scenario: Revoked session rejected

- GIVEN `sessions.revoked_at IS NOT NULL`
- WHEN `GET /me` with its token
- THEN status 401 even if `expires_at` is future

#### Scenario: Missing or malformed Bearer

- GIVEN header absent or not `Bearer <token>`
- WHEN `GET /me`
- THEN status 401 with envelope; handler is never reached

### Requirement: Auth Security Invariants

The system MUST never log `password`, `password_hash`, or raw `token`; MUST use constant-time comparison for hashes where applicable; MUST return identical 401 messages for bad email vs bad password.

#### Scenario: Password never appears in logs

- GIVEN `POST /login` with any password
- WHEN server logs the request
- THEN logs contain `email` (or its hash) and `x-request-id` but no `password` substring and no raw `token`

#### Scenario: Token hash not reversible via API

- GIVEN a valid token
- WHEN any endpoint returns session data
- THEN `token_hash` is never exposed; only DB stores the hash

### Requirement: Preferences Persistence

The system MUST expose `PATCH /me/preferences` accepting a partial body of `{ currency_code, locale, timezone, dashboard_layout }`. Only supplied fields SHALL be updated; omitted fields MUST remain unchanged. The endpoint MUST return 200 with the merged preferences object. Invalid values (unknown currency code, malformed locale/timezone) MUST return 422.

#### Scenario: Partial update of dashboard layout

- GIVEN a user with `currency_code: "COP"`, `dashboard_layout: null`
- WHEN `PATCH /me/preferences` with `{ dashboard_layout: { widgets: [{ id: "monthly-flow", type: "chart", order: 0, size: "lg" }] } }`
- THEN the response is 200 with the new `dashboard_layout` and `currency_code` still `"COP"`

#### Scenario: Invalid timezone rejected

- GIVEN an authenticated user
- WHEN `PATCH /me/preferences` with `{ timezone: "Not/AZone" }`
- THEN the system returns 422 and no field is modified

#### Scenario: Unauthenticated request

- GIVEN no `Authorization` header
- WHEN `PATCH /me/preferences`
- THEN the system returns 401 with envelope `UNAUTHORIZED`

### Requirement: Client-Side 401 Handling Contract

Any authenticated endpoint that receives an expired, revoked, or malformed token MUST return 401 with the JSON envelope `{ code: "UNAUTHORIZED", message: string }` and MUST NOT return 403 for authentication failures. Clients rely on this contract to perform a single-flight redirect to login and clear stored tokens.

#### Scenario: Expired token returns 401 envelope

- GIVEN a request with an expired bearer token to any protected endpoint
- WHEN the request is processed
- THEN the response is 401 with body `{ code: "UNAUTHORIZED", ... }`

#### Scenario: 403 is not used for auth failures

- GIVEN any request failing authentication (missing, malformed, expired, or revoked token)
- WHEN the request is processed
- THEN the response status is 401 (never 403)
