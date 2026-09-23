# Delta for Session Auth

## MODIFIED Requirements

### Requirement: Login — Opaque Token Issuance

The system MUST authenticate via `POST /login` with `{ email, password }`, verify `password_hash` with Argon2id, check `is_active`, enforce rate limit 10 requests / 15 min per peer address, generate a 256-bit random token (≥ 32 bytes, base64url), store only `SHA-256(token)` in `sessions.token_hash`, and return the raw token once. It MUST NOT log passwords or raw tokens.
(Previously: the rate limit was keyed by a client-supplied `X-Forwarded-For` / `X-Real-Ip` header with a `127.0.0.1` fallback, so a spoofed header bought unlimited attempts.)

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

- GIVEN 10 `POST /login` from the same peer address within 15 min
- WHEN the 11th request arrives
- THEN status 429 with `Retry-After` header; the counter is keyed by the peer socket address and survives only in-process (no Redis)

#### Scenario: CITEXT email case-insensitive

- GIVEN `users.email='Test@Example.com'`
- WHEN `POST /login` with `email='test@example.com'`
- THEN lookup succeeds (uses `WHERE email = $1` on CITEXT)

## ADDED Requirements

### Requirement: Rate-Limit Key Derivation with Empty-by-Default Trusted Proxies

The rate-limit key MUST be the peer socket address taken from `ConnectInfo<SocketAddr>`. `X-Forwarded-For` and `X-Real-Ip` MUST be ignored unless the peer is in a configured trusted-proxy set, and that set MUST be empty by default. When `ConnectInfo` is absent (for example in the `oneshot` harness), the key MUST fall back to a fixed non-spoofable local default and never to a header-derived value. The opt-in and its consequence (all clients behind a proxy share one bucket) MUST be documented.

#### Scenario: Spoofed XFF buys nothing

- GIVEN two different peers each sending different `X-Forwarded-For` values
- WHEN each exhausts the login limit
- THEN each gets an independent bucket keyed by its own peer address and rotating the header never creates a new bucket

#### Scenario: Trusted proxy opt-in

- GIVEN an operator-configured trusted-proxy set containing the peer
- WHEN a login request carries `X-Forwarded-For`
- THEN the first XFF element is used as the key

#### Scenario: Malformed XFF falls back to the peer

- GIVEN a malformed `X-Forwarded-For` value
- WHEN the request is processed
- THEN the peer address is used and requests never share a constant bucket

#### Scenario: ConnectInfo absent in tests

- GIVEN the `oneshot` harness without a connect-info extension
- WHEN the login handler runs
- THEN it uses the fixed local default and neither panics nor returns 500

### Requirement: Bounded Rate-Limiter State

The limiter map MUST remove keys whose window is empty, MUST cap the number of distinct keys with eviction of the least-recently-relevant entries, and MUST tolerate a poisoned mutex by recovering the guard instead of panicking inside the request path. Eviction MUST NOT silently reset a currently blocked key.

#### Scenario: Key count stays bounded

- GIVEN repeated requests using many distinct keys
- WHEN the limiter is inspected
- THEN the number of retained keys never exceeds the cap

#### Scenario: Expired key is removed

- GIVEN a key whose window is empty
- WHEN the limiter is inspected
- THEN the key is gone

#### Scenario: Block survives eviction pressure

- GIVEN a key currently blocked by the 10-per-15-min rule
- WHEN other keys are inserted up to the cap
- THEN the blocked key still returns 429

#### Scenario: Poisoned mutex does not panic

- GIVEN a panic occurred while the limiter lock was held
- WHEN a login request acquires the lock
- THEN the guard is recovered and the request is processed

## Edge cases

- Behind a future reverse proxy every LAN user collapses onto one key until the opt-in is configured; this is documented rather than "fixed" by trusting private ranges.
- The 10-per-15-min budget is unchanged; only the key identity and the map's growth are.
- `require_user_id` still has no per-token throttle; this change does not add one.

## Non-goals

- No Redis or out-of-process limiter.
- No change to the login response envelope, token generation, hashing or TTL.
- No per-email or per-token throttling.
