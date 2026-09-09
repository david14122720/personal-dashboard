# Proposal: Spanish i18n + Edge Header Prune + Futuristic Blue Theme (p7-es-futurista)

## Intent

Three user-facing gaps: (1) ~264 hardcoded English strings in UI/test files on a dashboard used in Spanish; (2) browser console "Unrecognized feature" warnings traced to an edge Traefik Permissions-Policy enumerating ad-tech tokens that are unrecognized/deprecated today (research C5–C7); (3) amber-accent theme with hardcoded chart hexes that misses the requested futuristic-blue, animated, readable look.

## Scope

### In Scope
- `lib/i18n` typed ES dictionary + `t()` + ES month/money formatters; full string sweep login → overview → finance → productivity (UI copy, aria-labels, metadata, `lang="es"`, money fallback en-US→es)
- Edge Permissions-Policy prune to research Q2 minimal allowlist, keep the pruned header (hardening preserved — the keep-vs-remove choice research flagged; removing entirely is NOT proposed), with `curl -sI` + console evidence
- Remove dead `/dashboard/wealth/` nav item in the i18n sweep (confirmed `wealth_quitar`; keep-vs-remove settled as remove)
- Blue/cyan OKLCH `@theme` tokens + `--animate-*` keyframes; charts read tokens, ES month labels, direct value labels, richer ES tooltips
- TDD: ES assertions written first (vitest + Playwright), per-page green

### Out of Scope
- `motion`/framer-motion library (deferred), Chart.js/ECharts migration, next-intl
- Backend Rust changes; building a new wealth page

## Capabilities

### New Capabilities
- `frontend-i18n`: typed ES dictionary, `t()` contract, ES month/money formatting, Spanish metadata and `lang="es"`
- `edge-security-headers`: edge Permissions-Policy minimal allowlist requirement + verifiable curl/browser evidence

### Modified Capabilities
- `frontend-dashboard`: Spanish UI/nav (wealth item removed), blue token theme + animation tokens (reduced-motion contract preserved), chart readability (ES axis, direct labels, token colors)

## Approach

Exploration recommendation A+A+A+A; research supplies exact header value and Traefik YAML (C8–C10). Slices (auto-chain, work-unit commits):

1. **Header prune**: locate on Dokploy host (`grep -rni permissions-policy /etc/dokploy/traefik/`), replace ad-tech denylist with `camera=(), microphone=(), geolocation=(), payment=(), display-capture=(), autoplay=()`, verify `curl -sI http://192.168.50.120:8055/` + zero console warnings. Judgment-day review (not unit-testable).
2. **i18n sweep**: dictionary + formatters; per-page red→green (login→overview→finance→productivity); wealth nav removed. Judgment-day review.
3. **Theme + charts**: blue tokens/keyframes; token-driven chart colors + ES readability; Playwright visual gates.

### TDD plan
- Slice 2: convert/write ES assertions first (red), implement page-by-page, suite green at every commit.
- Slices 1/3: evidence-based verification (curl headers, screenshots, reduced-motion test).

### Judgment-day plan
1–2 days, slices 1+2 only: slice 1 = infra evidence review; slice 2 = key-naming + missed-locale audit.

## Affected Areas

| Area | Impact |
|---|---|
| `frontend/lib/i18n/` (new) | New: dictionary, `t()`, formatters |
| `frontend/app/globals.css` | Modified: blue tokens, keyframes |
| `frontend/app/layout.tsx`, `app/**/page.tsx`, `components/**` | Modified: ES strings, nav prune |
| `frontend/components/ui/{FlowChart,CategoryDonut,BudgetBars,HabitsHeatmap,*.tsx}` | Modified: token colors, ES labels |
| `frontend/lib/api/money.ts` | Modified: ES fallback |
| all `*.test.tsx`, `e2e/*.spec.ts` | Modified: ES assertions |
| Dokploy/Traefik (outside repo) | Modified: header middleware |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Edge config not in git; origin curl ≠ user's browser path | Medium | Server grep + curl on `url_ip`; ask exact URL if warnings persist |
| Test churn during sweep | Medium | Per-page migration, green-per-commit |
| Animations vs accessibility | Medium | Keep `prefers-reduced-motion` hook + CSS kill-switch as spec requirement |
| Chart hex leaks re-fragment theme | Low | Grep check in verify |
| Token status drift (research U1/U2) | Low | Console re-check at apply time |

## Rollback Plan

Git revert per slice (slices are independent work units). Edge: restore previous Traefik YAML bytes (hot-reload). Theme: revert `globals.css`.

## Dependencies

- Dokploy host access (slice 1)
- Research rev 2 (done, obs 677) — consumed

## Success Criteria

- [ ] `curl -sI` on `url_ip` shows only allowlisted tokens; browser console shows zero Permissions-Policy warnings
- [ ] No hardcoded English UI strings; tests assert ES and pass
- [ ] `lang="es"`, Spanish metadata, chart months in Spanish, wealth nav item gone
- [ ] Blue token theme; all animation suppressed under reduced-motion
- [ ] CI green after every slice
