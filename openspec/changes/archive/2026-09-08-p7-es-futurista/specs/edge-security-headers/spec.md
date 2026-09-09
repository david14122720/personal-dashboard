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
