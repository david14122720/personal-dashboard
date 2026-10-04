# Delta for Session Auth

**Scope.** W3 applies the security audit's owner-approved scope (`security-audit.md`, 2026-10-04): A1 (spoofable rate-limit key), A2 (global lockout and successes consuming quota), A3 (timing enumeration on login), A4 (`is_active=false` ignored on existing sessions and API tokens), A7 (`Cache-Control: no-store` missing on secret responses) and A5 (no session listing/revoke-all). A6 (token scopes/expiry), A8 (transport), A9 (`--create-user` argv) and A10 (localStorage token) stay documented and out of scope.

**Edge cases.** The limiter must stay in front of Argon2 (A3 adds one dummy verification per failed login, so the failure quota is the CPU bound). Failure-only counting admits a small concurrency overshoot where several requests pass the check before failures are recorded; that is accepted and the pre-Argon2 gate still bounds work. The account key is the normalized (`trim().to_lowercase()`) email, matching CITEXT lookup semantics; a successful login clears the account bucket but not the IP bucket. Because the account bucket is keyed by email, an attacker who knows an email can delay that account's next successful login for at most `WINDOW` (15 min); the delay is accepted and measured — it is bounded by the window and a limiter test pins the expiry. The limiter gates `POST /api/login` only: a request presenting a valid session or API token is never throttled by it, and no other route consults the buckets. `X-Forwarded-For` is only consulted for a trusted peer, and an unparseable right-most element falls back to the peer, never to an older client-controlled element. Deactivation revokes nothing and rewrites nothing: existing credentials simply stop resolving. Session management is session-only (API tokens get 401) and never reveals `token_hash`.

**Non-goals.** No HttpOnly-cookie migration, no CSRF surface, no API-token scope enforcement or default expiry, no idle timeout, no session rotation beyond revoke-all, no per-session revoke-by-id endpoint, no audit log, no Redis or cross-process limiter, no change to the login/logout envelopes or the 401 code payload.

## MODIFIED Requirements

### Requirement: Login — Opaque Token Issuance

The system MUST authenticate via `POST /login` with `{ email, password }`, verify `password_hash` with Argon2id, check `is_active`, enforce a failure-based rate limit, generate a 256-bit random token (≥ 32 bytes, base64url), store only `SHA-256(token)` in `sessions.token_hash`, and return the raw token once. It MUST NOT log passwords or raw tokens. The rate limit MUST count **failures only**: 10 failures / 15 min per client IP and 5 failures / 15 min per normalized account email; successful authentications MUST NOT consume quota and MUST clear the account's bucket. The 11th (or 6th) qualifying failure MUST return 429 with `Retry-After` and the generic envelope. The limiter MUST gate `POST /login` only: a request presenting a valid session or API token MUST NOT be throttled by it. The residual self-lockout — an attacker who knows an email can delay that account's login for at most the window — is accepted and measured: the delay MUST NOT exceed `WINDOW`. Every syntactically valid login attempt MUST execute exactly one Argon2id verification — against the stored hash, or against a fixed dummy PHC hash with the same parameters when the account is unknown or inactive — before the generic 401 is returned; `is_active` MUST be evaluated only after that verification, and the missing/oversized-input path MUST still short-circuit with 422 before Argon2.
(Previously: the limit counted every request including successes, keyed only by peer address, and unknown or inactive accounts returned before Argon2, making the code path measurably shorter.)

#### Scenario: Successful login
- GIVEN a `users` row with `email` (CITEXT) and Argon2id `password_hash`, `is_active=true`
- WHEN `POST /login` with correct `email`+`password`
- THEN status 200, body `{ token, expires_at }`, DB row has `token_hash=hex(SHA256(token))`, `user_id` matches, `revoked_at IS NULL`, `expires_at = now() + SESSION_TTL_HOURS`
- AND no failure is recorded against the IP or the account

#### Scenario: Wrong password returns generic 401
- GIVEN valid email but wrong password
- WHEN `POST /login`
- THEN status 401, `code` `UNAUTHORIZED`, message `"Invalid credentials"`; no password in logs
- AND exactly one Argon2 verification ran and one failure was recorded for both buckets

#### Scenario: Unknown and inactive accounts verify too
- GIVEN an email with no `users` row, or a row with `is_active=false`
- WHEN `POST /login` with any password
- THEN status 401 with the same generic message
- AND exactly one Argon2 verification against the dummy hash ran before the response (no early return)

#### Scenario: Failures only consume quota
- GIVEN repeated successful logins from one IP within 15 minutes
- WHEN the IP reaches any number of successes
- THEN no 429 is produced and the account bucket for that email is empty

#### Scenario: Per-account lockout is independent of the IP bucket
- GIVEN 5 failed attempts for one email from an IP that has fewer than 10 failures
- WHEN a 6th attempt for that email arrives
- THEN it is 429 with `Retry-After`, while another email from the same IP is still served

#### Scenario: Self-lockout is bounded and accepted
- GIVEN 5 failed attempts for one email and an attacker who keeps failing it
- WHEN the legitimate owner retries before the window drains
- THEN the retry is 429 with `Retry-After` no longer than `WINDOW`, after which the bucket is empty and a correct login succeeds

#### Scenario: Authenticated sessions are never throttled
- GIVEN a valid session or API token
- WHEN authenticated endpoints are called repeatedly
- THEN no login-limiter 429 is produced and no login counter is consulted

#### Scenario: Inactive user denied
- GIVEN `users.is_active=false`
- WHEN `POST /login` with correct password
- THEN status 401 with the same generic message as bad password

#### Scenario: CITEXT email case-insensitive
- GIVEN `users.email='Test@Example.com'`
- WHEN `POST /login` with `email='test@example.com'`
- THEN lookup succeeds and the account bucket key is the normalized lowercase email

### Requirement: Rate-Limit Key Derivation with Empty-by-Default Trusted Proxies

The rate-limit key MUST be derived from the peer socket address taken from `ConnectInfo<SocketAddr>`. `X-Forwarded-For` and `X-Real-Ip` MUST be ignored unless the peer is in a configured trusted-proxy set, and that set MUST be empty by default. When the peer is trusted, the key MUST be the **right-most** comma-separated `X-Forwarded-For` element that parses as an IP and is **not** itself in the trusted set, walking right to left. If the header is absent, every parseable element is trusted, or the right-most element is unparseable, the key MUST fall back to the peer address — never to an older client-controlled element. When `ConnectInfo` is absent (for example in the `oneshot` harness), the key MUST fall back to the fixed non-spoofable local default and never to a header-derived value.
(Previously: the first parseable `X-Forwarded-For` element was used, which a client can prepend when the fronting proxy appends, buying a fresh bucket per request.)

#### Scenario: Append-style proxy cannot be spoofed
- GIVEN a trusted proxy that appends the real client address, and a client sending `X-Forwarded-For: 10.0.0.99`
- WHEN the request arrives as `X-Forwarded-For: 10.0.0.99, 192.0.2.7`
- THEN the key is `192.0.2.7` (right-most element) and rotating the spoofed left element never creates a new bucket

#### Scenario: Trusted hop skipped, right-most untrusted wins
- GIVEN `trusted = {192.0.2.1, 192.0.2.2}` and `X-Forwarded-For: 203.0.113.5, 192.0.2.1, 192.0.2.2`
- WHEN the key is derived
- THEN it is `203.0.113.5`

#### Scenario: All-trusted or malformed falls back to the peer
- GIVEN `X-Forwarded-For: 192.0.2.1` where every element is trusted, or a right-most element that does not parse
- WHEN the key is derived
- THEN the peer address is used and requests never share a constant header-derived bucket

#### Scenario: Spoofed XFF buys nothing from an untrusted peer
- GIVEN two different untrusted peers each sending different `X-Forwarded-For` values
- WHEN each exhausts the login limit
- THEN each gets an independent bucket keyed by its own peer address

#### Scenario: ConnectInfo absent in tests
- GIVEN the `oneshot` harness without a connect-info extension
- WHEN the login handler runs
- THEN it uses the fixed local default and neither panics nor returns 500

### Requirement: Bounded Rate-Limiter State

The limiter MUST keep two independent, bounded maps (one per IP, one per normalized account email), remove keys whose window is empty, cap the number of distinct keys in each map with eviction of the least-recently-relevant entries, and tolerate a poisoned mutex by recovering the guard instead of panicking inside the request path. Eviction MUST NOT silently reset a currently blocked key in either map. The account map MUST be cleared for an email only by a successful authentication.
(Previously: the limiter kept a single map and every check call appended to it.)

#### Scenario: Key count stays bounded per map
- GIVEN repeated requests using many distinct IPs and many distinct emails
- WHEN the limiter is inspected
- THEN neither map exceeds its cap

#### Scenario: Expired key is removed
- GIVEN a key whose window is empty in either map
- WHEN the limiter is inspected
- THEN the key is gone

#### Scenario: Block survives eviction pressure
- GIVEN a key currently blocked in either map
- WHEN other keys are inserted up to the cap
- THEN the blocked key still returns 429

#### Scenario: Poisoned mutex does not panic
- GIVEN a panic occurred while the limiter lock was held
- WHEN a login request acquires the lock
- THEN the guard is recovered and the request is processed

#### Scenario: Success clears only the account bucket
- GIVEN an account bucket with recorded failures and a successful login
- WHEN the limiter is inspected
- THEN the account bucket is empty and any IP-bucket state is unchanged

### Requirement: Auth Middleware and GET /me

The system MUST protect `GET /me` (and every private route) with middleware that extracts `Bearer <token>`, computes `SHA-256(token)` hex, resolves the caller through `sessions` **joined to `users` with `is_active = true`**, or through `api_tokens` with the same active-user join, then injects user context. Expired, revoked, unknown or inactive-user credentials MUST all resolve to 401; the middleware MUST fail closed on any error. `GET /me`'s own query MUST also require `users.is_active`.
(Previously: neither lookup consulted `users.is_active`, so deactivation did not stop existing sessions or API tokens.)

#### Scenario: Deactivated user's session stops working
- GIVEN an active session for user `U` and then `U.is_active = false`
- WHEN any authenticated endpoint is called with that session token
- THEN the response is 401 with the `UNAUTHORIZED` envelope

#### Scenario: Deactivated user's API token stops working
- GIVEN an unexpired, unrevoked API token for user `U` and then `U.is_active = false`
- WHEN any authenticated endpoint is called with that token
- THEN the response is 401 and no domain row is read or written

#### Scenario: Logout follows the same rule
- GIVEN a deactivated user's session token
- WHEN `POST /logout` is called
- THEN the response is 401 and no session row is revoked

#### Scenario: Valid token still returns profile
- GIVEN an active user with an active session and preferences
- WHEN `GET /me` is called
- THEN status 200 with the same body as before, and no `password_hash` or `token_hash` appears

## ADDED Requirements

### Requirement: Session Management Endpoints

The system MUST expose `GET /api/sessions` and `DELETE /api/sessions`, both usable only with a session bearer token (an API token MUST receive 401, mirroring `require_session_user_id`).

- `GET /api/sessions` MUST return only the caller's sessions, ordered `created_at DESC`, with exactly `{ id, created_at, expires_at, revoked_at, user_agent, ip_address, current }` per row; `current` MUST be true only for the presenting session. `token_hash` MUST NOT be selected into the response or serialized under any circumstance.
- `DELETE /api/sessions` MUST revoke every active session of the caller **except the presenting one** (`revoked_at = now()` where `token_hash <> <presenting hash>`, `revoked_at IS NULL` and `expires_at > now()`), MUST return 204, MUST be idempotent, and MUST NOT revoke the caller's own session.

#### Scenario: List sessions without secrets
- GIVEN a user with two active sessions
- WHEN `GET /api/sessions` is called with one of them
- THEN both rows are returned ordered newest first, exactly one has `current: true`, and the response body contains no `token_hash` key or hash value

#### Scenario: Revoke all but the current session
- GIVEN three active sessions for one user
- WHEN `DELETE /api/sessions` is called with one token
- THEN the response is 204, the calling session still resolves, and the other two return 401

#### Scenario: Revoke is idempotent
- GIVEN a user with only the presenting session active
- WHEN `DELETE /api/sessions` is called twice
- THEN both responses are 204 and the presenting session still works

#### Scenario: API tokens cannot manage sessions
- GIVEN a valid API token (`pd_…`)
- WHEN `GET /api/sessions` or `DELETE /api/sessions` is called
- THEN the response is 401 and no session row is read or written

#### Scenario: Foreign sessions are not touched
- GIVEN two users each with sessions
- WHEN one calls `DELETE /api/sessions`
- THEN only that caller's other sessions are revoked

### Requirement: No-Store On Credential Responses

Responses that carry a one-shot secret or a freshly minted credential MUST set `Cache-Control: no-store`: `POST /api/login` (session token) and `POST /api/tokens` (raw API token). The header MUST be set on those handlers specifically, not by a layer applied to every response; read endpoints and static assets MUST NOT be blanket-stamped.

#### Scenario: Login response is not stored
- GIVEN `POST /api/login` with valid credentials
- WHEN the response headers are inspected
- THEN `Cache-Control: no-store` is present

#### Scenario: API token creation response is not stored
- GIVEN `POST /api/tokens` with a valid session
- WHEN the response headers are inspected
- THEN `Cache-Control: no-store` is present

#### Scenario: Read endpoints are untouched
- GIVEN `GET /api/movements`, `GET /api/me` and a static asset
- WHEN their response headers are inspected
- THEN `Cache-Control: no-store` is absent unless the response already carried it before the change
