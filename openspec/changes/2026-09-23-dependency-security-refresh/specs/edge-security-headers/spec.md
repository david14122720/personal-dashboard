# Delta for Edge Security Headers

## ADDED Requirements

### Requirement: App-Owned vs Edge-Owned Header Boundary

Header ownership MUST be unambiguous: the Axum serving path owns `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and the `frame-ancestors` CSP directive; the edge keeps `Permissions-Policy`. The app MUST NOT emit `Permissions-Policy`, and the edge's existing minimal `Permissions-Policy` allowlist MUST remain unchanged by this change.

#### Scenario: No duplicate Permissions-Policy

- GIVEN a response from the app's serving path
- WHEN the response headers are inspected
- THEN no `Permissions-Policy` header is present

#### Scenario: Edge header set untouched

- GIVEN the deployed edge response
- WHEN `curl -sI` output is inspected
- THEN the six-denied-directive `Permissions-Policy` value and the banned-token absence from the existing requirement still hold

#### Scenario: Ownership is documented

- GIVEN the spec set
- WHEN a reader asks who sets which header
- THEN the app-owned set and the edge-owned header are both stated

### Requirement: Deferred script-src / Full CSP Decision

This change MUST NOT introduce a `script-src` directive or a broader CSP. The served policy MUST be exactly `Content-Security-Policy: frame-ancestors 'none'`. Any future full CSP MUST resolve the inline FOUC guard in `frontend/app/layout.tsx` (hash or nonce rather than a default `'unsafe-inline'`) as its own decision.

#### Scenario: Served policy is exactly frame-ancestors

- GIVEN `curl -sI` on a static path and on an API path
- WHEN the CSP value is inspected
- THEN it is exactly `frame-ancestors 'none'` with no `script-src` directive

#### Scenario: Deferral is recorded with its reason

- GIVEN the spec set and the verify report
- WHEN the CSP decision is looked up
- THEN the inline FOUC guard is named as the blocker and no `'unsafe-inline'` script policy was shipped

## Edge cases

- Setting `Permissions-Policy` in the app while the edge also sets it risks the duplicated header the existing requirement forbids.
- The edge cannot be observed from CI, so app-owned headers are the only version CI can evidence.

## Non-goals

- No edge, Traefik or Dokploy configuration change.
- No `Permissions-Policy` change in the app or at the edge.
- No HSTS; plaintext-LAN exposure is accepted and recorded in `backend-base`.
