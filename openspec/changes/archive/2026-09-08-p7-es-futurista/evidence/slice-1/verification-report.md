# Slice 1 Verification Report — Header Prune & Evidence (2026-09-09)

Change: `p7-es-futurista` · Slice 1 (tasks 1.1–1.4) · Mode: Standard (strict_tdd=false)
Spec: `specs/edge-security-headers/spec.md` · Design D10 · Research rev2 (C8–C10)

## Task outcomes

- [ ] 1.1 Locate Traefik `permissions-policy` config — PARTIAL. Repo grep: zero matches
  (`Permissions-Policy`/`customResponseHeaders` only in SDD artifacts + skill docs).
  Dokploy MCP `application-one` (app `fhhbVxFYT1qyQEeh90sOo`): `domains: []`,
  `security: []`, host port publish `8055→80`, `server: null`. MCP
  `readTraefikConfig` failed with schema error (`data must have required property
  'message'`) — same failure recorded in exploration. Host grep
  (`grep -rni permissions-policy /etc/dokploy/traefik/`) NOT runnable: no SSH/exec
  channel to the Dokploy host exists in this runtime.
- [ ] 1.2 Replace denylist with allowlist — NOT PERFORMED. No located file to edit and
  no safe write path (blind `updateTraefikConfig` without readback would risk the live
  edge; deliberately not attempted).
- [ ] 1.3 Verify via curl + console — PARTIAL. curl performed (see below); browser
  console check NOT performed (no browser harness in this runtime).
- [x] 1.4 Evidence stored — this directory (`curl-headers.txt` + this report).

## Key finding

`curl -sI http://192.168.50.120:8055/` returns HTTP 200 with NO `Permissions-Policy`
header at all (full headers in `curl-headers.txt`). Banned-token grep: 0 matches.
Because the app uses host-published port `8055→80` with `domains: []`, Traefik is not
in the request path for `url_ip` — there is no middleware to prune on this path.
The spec requires the edge to SERVE exactly
`camera=(), microphone=(), geolocation=(), payment=(), display-capture=(), autoplay=()`,
so the current state (header absent) satisfies "no banned tokens" but NOT "header
matches allowlist". The assumed pre-state (ad-tech denylist served) does not hold on
`url_ip` from this runtime; the warnings observed earlier must come from a different
browsed origin (e.g. a Traefik-routed domain) or an already-changed edge.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `curl -sI --max-time 15 http://192.168.50.120:8055/ \| grep -i -c permissions-policy` → `0` (exit 1 from grep = no match); full response `HTTP/1.1 200 OK`, no `Permissions-Policy` line |
| Runtime harness command/scenario and exact result | Browser console Permissions-Policy check: N/A — no browser/Playwright harness available in this runtime; console capture not produced |
| Rollback boundary | No files changed outside `openspec/changes/p7-es-futurista/evidence/slice-1/`; nothing to revert (no edge or repo code touched) |

## Decision needed before 1.2 can proceed

1. Exact browsed URL that shows the warnings (if it is a Traefik-routed domain rather
   than `url_ip`, the middleware lives on that router, not on `:8055`).
2. SSH/operator access to the Dokploy host for the server-side grep + YAML edit, OR an
   explicit decision to serve the allowlist from the Axum origin instead (repo change,
   out of slice-1 scope as currently tasked).
3. If the orchestrator confirms `url_ip` is the only origin and wants the header
   present, slice 1 must be re-tasked (origin header in backend, with `cargo test`) —
   the current infra-only tasking cannot satisfy the spec on this path.
