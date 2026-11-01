# Edge Security Headers Specification

## Purpose

Governs the `Permissions-Policy` header the Dokploy/Traefik edge serves for `http://192.168.50.120:8055/`.

## Requirements

### Requirement: Minimal Recognized Allowlist

The edge MUST keep the header (pruned, not removed) and serve exactly `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), display-capture=(), autoplay=()`; the ad-tech tokens `attribution-reporting`, `browsing-topics`, `private-aggregation`, `private-state-token-issuance`, `private-state-token-redemption`, `join-ad-interest-group`, `run-ad-auction` MUST NOT appear. Other edge security headers MUST stay unchanged.

#### Scenario: Header matches allowlist

- GIVEN `curl -sI http://192.168.50.120:8055/`
- WHEN the response is inspected
- THEN only the six denied directives are listed

#### Scenario: No banned tokens

- GIVEN the served header value
- WHEN checked against the banned-token list
- THEN zero matches

### Requirement: Warning-Free, Evidence-Gated Acceptance

The policy MUST produce no Permissions-Policy console messages (unrecognized feature / origin-trial) in Chromium, Firefox, or Safari, and slice 1 MUST be accepted only on stored `curl -sI` output plus a console capture, with a judgment-day infra evidence review hook (CI cannot observe the edge).

#### Scenario: Console clean

- GIVEN a hard reload of the dashboard
- WHEN the console is filtered for Permissions-Policy
- THEN zero messages appear

#### Scenario: Evidence recorded

- GIVEN slice 1 completion
- WHEN verification runs
- THEN curl output and console capture are in the verify report

### Requirement: App-Owned vs Edge-Owned Header Boundary

Header ownership MUST be unambiguous: the Axum serving path owns `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and the full `Content-Security-Policy`; the edge keeps `Permissions-Policy`. The app MUST NOT emit `Permissions-Policy`, and the edge's existing minimal `Permissions-Policy` allowlist MUST remain unchanged by this change.

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

### Requirement: Full Content-Security-Policy Decision

The served policy MUST be exactly `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. `script-src` and `style-src` MUST carry `'unsafe-inline'` because a static export inlines its bootstrap scripts and React writes inline style attributes, and no build-time nonce or hash exists for them; `'unsafe-eval'` and wildcard sources MUST NOT appear. `Permissions-Policy` stays edge-owned and MUST NOT be emitted by the app. Any later tightening (hashes or a nonce for the inline FOUC guard in `frontend/app/layout.tsx`) is its own decision.

#### Scenario: Served policy is the full CSP

- GIVEN `curl -sI` on a static path and on an API path
- WHEN the CSP value is inspected
- THEN it is the full policy above, with `'unsafe-inline'` limited to `script-src` and `style-src`, and no `'unsafe-eval'` or wildcard source

#### Scenario: Deferral is recorded with its reason

- GIVEN the spec set and the verify report
- WHEN the CSP decision is looked up
- THEN the inline FOUC guard is named as the blocker and no `'unsafe-inline'` script policy was shipped
