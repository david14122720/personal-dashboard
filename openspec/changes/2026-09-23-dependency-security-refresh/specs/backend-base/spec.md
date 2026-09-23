# Delta for Backend Base

## ADDED Requirements

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

## Edge cases

- `ConnectInfo` is absent in the `oneshot` test harness, so the timeout and header requirements MUST be provable without a live socket.
- A layer placed only on success paths would be a false-confidence fix, which is why error responses and the fallback document are asserted explicitly.
- A duplicate `Permissions-Policy` (app plus edge) is forbidden, which is why the app does not own that header.
- A timeout on the outermost layer would kill `ServeDir` streaming and the probes; that placement is explicitly forbidden.

## Non-goals

- No TLS, HSTS, certificate, Traefik or Dokploy change.
- No CORS environment allow-list and no dev-proxy story.
- No `script-src` or full CSP, and no `Permissions-Policy` from the app.
- No request body-size limit change (axum's `Json` 2 MB default stays).
- No change to `GET /me`, finance routes, migrations or data.
