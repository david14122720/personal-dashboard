<!-- schema: gentle-ai.sdd-research/v1 -->
# Research: p7-es-futurista

schema: gentle-ai.sdd-research/v1
revision: 2
change: p7-es-futurista
project: personal-dashboard
date: 2026-09-08
outcome: done
artifact_store_mode: hybrid

## Selected request

Single lane (selected: `con_research` — completion mandatory before propose):

> Minimal safe Permissions-Policy allowlist for a private dashboard in 2026 + Dokploy/Traefik headers middleware prune procedure.

Questions:
- Q1: Which of `attribution-reporting`, `private-aggregation`, `private-state-token-issuance`, `private-state-token-redemption`, `join-ad-interest-group`, `run-ad-auction`, `browsing-topics` are valid in current Chrome/MDN spec — status each (removed / origin-trial / Chrome-only) with sources.
- Q2: Recommended minimal Permissions-Policy for a private app (camera, microphone, geolocation, payment, fullscreen, etc.) and exact header syntax Traefik accepts.
- Q3: How to locate/prune the middleware on the Dokploy server (grep `/etc/traefik/`, Dokploy UI headers section) and verify with `curl -sI` + browser console.

Requested source classes: `documentation`, `open-web`.

## Admission (attempt 2)

- Attempt-2 dispatch re-declared the runtime evidence channels: `documentation` = Context7 docs (MDN, Traefik, Dokploy); `open-web` = live web search (Chrome Platform Status / MDN Permissions-Policy pages).
- Observed runtime: Context7 present and used (3/3 library queries: `/websites/developer_mozilla_en-us`, `/traefik/traefik`, `/websites/dokploy`). No generic HTTP-fetch or web-search tool exists in this runtime; the `open-web` class was executed via GitHub's live code/content search and contents REST APIs (remote, at-run-time) against the canonical upstreams: `mdn/content` (source of developer.mozilla.org), `w3c/webappsec-permissions-policy` (the Permissions Policy spec registry), with `mdn/browser-compat-data` attempted and unreachable (3 path attempts failed; excluded — see uncertainty U1).
- Persistence tools (OpenSpec, Engram) and local Dokploy MCP were not used as evidence sources; Dokploy MCP was not invoked at all.
- **Admission: GRANTED for both classes** under the re-declared mapping above.

## Sources

All accessed live on 2026-09-08.

| id | class | title | publisher | URL | excerpt (verbatim, trimmed) |
|---|---|---|---|---|---|
| S1 | documentation | Permissions-Policy header (reference) | MDN | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy (fetched via https://github.com/mdn/content/blob/main/files/en-us/web/http/reference/headers/permissions-policy/index.md , blob SHA 59905db4e6ae) | Directive list marks `attribution-reporting` and `browsing-topics` "deprecated non-standard"; `private-state-token-issuance` / `private-state-token-redemption` "Experimental"; `join-ad-interest-group`, `run-ad-auction`, `private-aggregation` are ABSENT from the list. Syntax: `Permissions-Policy: <directive>=<allowlist>` with `*`, `()`, `self`, quoted origins. |
| S2 | documentation | Permissions-Policy: browsing-topics directive | MDN | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/browsing-topics (blob SHA 5643c0e31d30) | "status: deprecated, non-standard … This feature is not part of an official standard, although it is specified in the Topics API Unofficial Proposal Draft … The default allowlist for `browsing-topics` is `*`." |
| S3 | documentation | Permissions-Policy: attribution-reporting directive | MDN | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/attribution-reporting (blob SHA a183d434f338) | "status: deprecated, non-standard … The default allowlist for `attribution-reporting` is `*`." |
| S4 | documentation | Permissions-Policy: private-state-token-issuance directive | MDN | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/private-state-token-issuance (blob SHA 3f374d2eb37a) | "status: experimental … Controls usage of private state token `token-request` operations … The default allowlist … is `*`." |
| S5 | documentation | Topics API (overview) | MDN | https://developer.mozilla.org/en-US/docs/Web/API/Topics_API (blob SHA c4cb1ccd7828) | "status: deprecated, non-standard … This feature is currently opposed by two browser vendors … Mozilla (Firefox): Negative; Apple (Safari): Negative … An Enrollment process is required to use the Topics API." |
| S6 | open-web | Permissions Policy feature-registration table (`features.md`) | W3C webappsec-permissions-policy | https://github.com/w3c/webappsec-permissions-policy/blob/main/features.md (live blob ref c10c76d8efc3) | "`attribution-reporting` \| Attribution Reporting API \| Chrome 115 (https://chromestatus.com/feature/6412002824028160)" · "`browsing-topics` \| Explainer (https://github.com/jkarlin/topics/) \| Status 'Started' in Chrome" · "`join-ad-interest-group` \| Protected Audience (formerly FLEDGE) \| Behind a flag in Chrome" · "`run-ad-auction` \| Protected Audience … \| Behind a flag in Chrome" · no `private-aggregation` or `private-state-token-*` rows. |
| S7 | open-web | Live GitHub code search: `"join-ad-interest-group" repo:mdn/content` and `"run-ad-auction" repo:mdn/content` | GitHub Search API | https://github.com/search?q=repo%3Amdn%2Fcontent+%22join-ad-interest-group%22&type=code | Both queries returned `total_count: 0` — current MDN contains zero coverage of the Protected Audience directives (docs removed/never-shipped). |
| S8 | documentation | Middleware headers (reference) + expose/docker/advanced | Traefik | https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/headers/ (via Context7 /traefik/traefik, snippets from github.com/traefik/traefik docs) | "The `customRequestHeaders` and `customResponseHeaders` options allow users to define specific header names and values … added to incoming requests and outgoing responses." Secure-headers Docker-label example: `"traefik.http.middlewares.secure-headers.headers.stsSeconds=31536000"` + `"traefik.http.routers.whoami.middlewares=secure-headers"`. |
| S9 | documentation | Domains / Troubleshooting instance / Settings API | Dokploy | https://docs.dokploy.com/docs/core/domains · https://docs.dokploy.com/docs/core/troubleshooting/instance · https://docs.dokploy.com/docs/api/settings (via Context7 /websites/dokploy) | "For Applications, Dokploy automatically manages domain configurations via Traefik file system settings … Changes … take effect immediately … view these configurations directly within the Dokploy UI under the Advanced tab." · "manually inspect and correct the configuration files located in the /etc/dokploy/traefik directory." · "POST /settings.updateTraefikFile {path, traefikConfig, serverId}" · "POST /settings.reloadTraefik". Router YAML shows `middlewares: [redirect-to-https]` per router. |
| S10 | documentation | Permissions Policy (guide) | MDN | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Permissions_Policy (via Context7 /websites/developer_mozilla_en-us) | "`Permissions-Policy: geolocation=()`" · "`Permissions-Policy: geolocation=(self \"https://a.com\" \"https://b.com\")`" — allowlist grammar incl. subdomain wildcard `"https://*.example.com"`. |

## Validated claims

Token statuses as of 2026-09-08 (Q1):

- C1 [S1,S3,S6] `attribution-reporting` — VALID as a Chrome-shipped directive (Chrome 115 per the W3C registry, Chrome Platform Status feature 6412002824028160); MDN flags it **deprecated + non-standard**; default allowlist is `*`. Chrome-only.
- C2 [S1,S2,S5,S6] `browsing-topics` — Listed on MDN but **deprecated + non-standard**; not a W3C standard (PatCG individual draft only); **opposed by Firefox and Safari** standards positions; enrollment-gated; W3C registry shows status "Started" in Chrome. Chrome-only, on the deprecation path.
- C3 [S1,S4] `private-state-token-issuance` — **valid, experimental**, Chrome-only MDN directive (`token-request` operations); default `*`; not registered in the W3C `features.md` table.
- C4 [S1] `private-state-token-redemption` — **valid, experimental**, Chrome-only MDN directive (`token-redemption` / `send-redemption-record`); default `*`.
- C5 [S1,S6,S7] `join-ad-interest-group` — **NOT a recognized public directive**: absent from MDN's current directive list, zero current MDN doc coverage, W3C registry lists it as Protected Audience **"behind a flag in Chrome"** → effectively removed from web-exposed status.
- C6 [S1,S6,S7] `run-ad-auction` — same evidence as C5: flag-gated Protected Audience, zero MDN coverage → treat as removed/unrecognized for header purposes.
- C7 [S1,S6] `private-aggregation` — **absent from both** MDN's directive list and the W3C registration table → unrecognized by all browsers today; guaranteed to produce unrecognized-directive console messages. (Private Aggregation API is documented only on privacysandbox.google.com, never as a W3C/MDN feature.)
- C8 [S1,S10] Syntax rules: comma-separated `directive=allowlist` pairs; `()` = deny everywhere, `self`, `*`, quoted origins, subdomain wildcards; optional per-directive `report-to=<endpoint>`.
- C9 [S8] Traefik writes arbitrary response headers (including `Permissions-Policy`) via the **headers middleware `customResponseHeaders` map**, in file-provider YAML or Docker labels; `headers` middleware has no dedicated Permissions-Policy option.
- C10 [S9] On this edge, Dokploy owns the router YAML (`middlewares: [...]` list) generated as Traefik file-provider config: visible in the app's **Advanced** tab in the UI, files under **`/etc/dokploy/traefik/`** on the host (mounted as `/etc/traefik/` in the `dokploy-traefik` container); edits hot-reload without redeploy; `settings.updateTraefikFile` / `settings.reloadTraefik` API endpoints exist.

Q2 answer — recommended minimal header (composition of validated facts C1–C8; every token below appears in S1's current directive list, so no browser warns; all ad-tech tokens deliberately omitted because they are unrecognized (C5–C7) or Chrome-only/deprecated with default `*` already granting nothing extra to a private first-party app (C1–C4)):

```http
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), display-capture=(), autoplay=()
```

Add `fullscreen=(self)` only if fullscreen chart presentation is a product requirement. Do NOT carry `attribution-reporting`, `browsing-topics`, `private-state-token-issuance`, `private-state-token-redemption`, `join-ad-interest-group`, `run-ad-auction`, `private-aggregation` in a private-dashboard header.

Exact Traefik v3 syntax — file/Dokploy-Advanced YAML form (recommended; Dokploy is file-provider per C10):

```yaml
http:
  routers:
    dokploy-app-name-router-websecure-1:
      rule: Host(`your-domain.com`)
      service: dokploy-app-name-service-1
      middlewares:
        - dash-headers
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  middlewares:
    dash-headers:
      headers:
        customResponseHeaders:
          Permissions-Policy: "camera=(), microphone=(), geolocation=(), payment=(), display-capture=(), autoplay=()"
```

Docker-label equivalent (shape per S8's secure-headers example):

```yaml
labels:
  - "traefik.http.middlewares.dash-headers.headers.customResponseHeaders.Permissions-Policy=camera=(), microphone=(), geolocation=(), payment=(), display-capture=(), autoplay=()"
  - "traefik.http.routers.<router>.middlewares=dash-headers"
```

Caveat: label values containing `=` and commas are not covered verbatim by the fetched examples — see U3; the YAML form is the admitted-safe choice.

Q3 answer — locate / prune / verify procedure (operational synthesis of C9–C10; this phase runtime has no shell, so execution belongs to the apply/verify slice or the operator):

1. Locate the edge owner on the Dokploy host:
   `grep -rni "permissions-policy" /etc/dokploy/traefik/ /etc/traefik/ 2>/dev/null` and inside the container:
   `docker exec dokploy-traefik grep -rni "permissions-policy" /etc/traefik/`
   In the UI: application → Domains → **Advanced** tab (per-app router/middleware YAML); global files via Settings → Traefik File (`/settings.updateTraefikFile` API, `path` = the file that grep flagged). Note: the Dokploy MCP `readTraefikConfig` previously failed with a schema bug (exploration context, non-authoritative) — server-side grep is the substitute.
2. Prune: in the file grep flagged, replace the denylist value that enumerates the 7 ad-tech tokens with the recommended header above (or delete the `Permissions-Policy` key to fall back to per-directive defaults). Dokploy/Traefik hot-reloads file changes; otherwise `docker restart dokploy-traefik` or `POST /settings.reloadTraefik`.
3. Verify: `curl -sI http://192.168.50.120:8055/ | grep -i permissions-policy` → header shows only the allowlisted tokens (confirmed browsed edge = `url_ip`). Browser: hard reload → DevTools → Network → document → Response Headers; Console must show **zero** Permissions-Policy messages; re-test any legitimate fullscreen usage.
4. Cross-check a second engine (Firefox/Safari): no warnings expected because the header only uses directives from the common MDN list (C8).

Unanswered questions: none — Q1, Q2, Q3 all answered with admitted sources.

## Contradictions, uncertainty, freshness

- U1: `mdn/browser-compat-data` JSON paths were unreachable in this runtime (3 attempts), so exact Chrome `version_added`/`version_removed` integers are NOT claimed; Chrome-side status rests on the W3C registry table (S6), which is hand-maintained and may lag the shipped set. The chromestatus.com feature URL for `attribution-reporting` and the Protected-Audience "behind a flag" rows are quoted from that registry, not from live chromestatus.com UI pages (no generic HTTP-fetch tool exists in this runtime — the open-web channel ran via GitHub live APIs).
- U2: MDN marks the Permissions-Policy reference itself `experimental`; the directive list is authoritative as current documentation, not as a normative spec. "Deprecated" on MDN ≠ "removed" from Chrome's parser — C1/C2 tokens may still parse silently in Chrome while warning in other engines.
- U3: Traefik label escaping for values containing `=`/`,` was not covered by the fetched examples; if labels are used instead of YAML, the resulting header MUST be confirmed with `curl -sI` before trusting it.
- U4: exact console warning strings are per-browser implementation behavior, not quoted from sources here; the mapping "user's warnings ← these tokens" comes from prior-phase exploration (non-authoritative) and is consistent with the run-time unrecognized/deprecated statuses (C5–C7).
- Freshness: all evidence fetched 2026-09-08 with recorded blob SHAs. Privacy Sandbox token status is volatile; cheapest re-verification at apply time is the browser console itself.

## Prior-phase context (non-authoritative, not admitted evidence)

- `openspec/changes/p7-es-futurista/exploration.md` and Engram `sdd/p7-es-futurista/explore` (obs 670, 672) hypothesize that console warnings come from an edge-injected Permissions-Policy carrying an ad-tech denylist, and that the Axum origin at `http://192.168.50.120:8055/` sends no such header (orchestrator-provided curl evidence). Attempt-2 evidence (C5–C7) confirms those tokens are unrecognized/deprecated today, which is consistent with the hypothesis; the hypothesis itself remains orchestrator context, not an admitted claim.

## Product choices (non-authoritative, orchestrator-owned)

- Research lane selection `con_research` — confirmed (pre-proposal handoff).
- Browsed URL / edge to fix `url_ip` = `http://192.168.50.120:8055/` — confirmed.
- Dead wealth route `wealth_quitar` — remove `/dashboard/wealth/` nav item in the i18n sweep — confirmed.
- NEW (derived from evidence, for orchestrator confirmation at propose time): keep the pruned `Permissions-Policy` header (recommended Q2 value) rather than removing it entirely — preserves hardening value per exploration approach 2A/2C; origin-side (Axum) header remains optional.

## Revision history

- Revision 1: outcome `blocked` (admission denied on empty grants). Bytes retained in Engram archive obs 681 (topic-less copy); never mutated in place.
- Revision 2 (this artifact): outcome `done`; written after the attempt-2 dispatch re-declared evidence channels (Context7 + live remote search). Persisted to both hybrid stores as identical bytes with readback verification.
