# Exploration: p7-es-futurista

Change: `p7-es-futurista` · Project: personal-dashboard · Mode: hybrid (openspec + engram) · pace=auto · delivery=auto-chain

## Current State

**Frontend** (`frontend/`, Next.js 16.3.4 static export `output: "export"`, React 19, Tailwind v4, recharts 3.10.1, SWR):
- All UI strings are hardcoded English literals (~264 unique quoted English strings in `components/`, plus `app/` pages, metadata, aria-labels, error messages).
- No i18n layer exists. No locale routing (impossible with static export anyway — no middleware).
- `layout.tsx`: `<html lang="en">`, metadata title/description in English.
- `lib/api/money.ts`: `formatMoney` **already defaults to `es-CO` / COP** with `Intl.NumberFormat` — locale plumbing exists at the money boundary; only the fallback is `en-US/USD`.
- Chart month labels (`FlowChart` XAxis `dataKey="month"`) render raw backend `YYYY-MM` strings — no Spanish formatting layer.

**Theme** (`frontend/app/globals.css`, 51 lines): Tailwind v4 CSS-first `@theme` tokens, dark-first "telemetry deck": `--color-deck #0c1622`, `--color-hull #142433`, `--color-instrument`, accents `signal` (amber), `flow` (mint), `alert`, `violet`, `sky`. Fonts Space Grotesk / Inter / IBM Plex Mono. Light-mode via `.light` class + FOUC guard script. `prefers-reduced-motion` kill-switch already in base CSS; `usePrefersReducedMotion` hook feeds chart `isAnimationActive`. Current animation is minimal: `animate-pulse` skeletons, `transition-colors` hovers, recharts built-in animations. **No animation/keyframe tokens defined in `@theme`.** Charts hardcode hex colors (`#2DD4A7`, `#EAF1F7`, `#142433`) instead of referencing tokens.

**Tests**: vitest + Testing Library + MSW (`*.test.tsx` colocated), Playwright e2e (`frontend/e2e/`: auth, dashboard, guards, sections). Tests assert English literals ("Overview", "Sign in", "Finance", "Productivity", aria labels) — an ES sweep breaks them; they must lead the migration (TDD).

**Backend** (Rust Axum, single Docker image serving static `out/` + `/api`): CORS + request-id layers only. No security-header layer.

## Where do the Permissions-Policy warnings come from?

**Evidence**: `curl -sI http://192.168.50.120:8055/` (origin, Axum in Dokploy) returns **no `Permissions-Policy` header at all**. The repo contains zero matches for `Permissions-Policy`/`attribution-reporting`/`browsing-topics`. The Dokploy app record shows `domains: []`, `security: []`, host-published port 8055→80.

**Conclusion**: the header is injected by an edge layer the browser actually reaches (Dokploy's global Traefik config or a custom headers middleware pasted from a "hardened headers" snippet — those snippets enumerate the full ad-tech denylist verbatim: `attribution-reporting`, `private-aggregation`, `private-state-token-issuance/redemption`, `join-ad-interest-group`, `run-ad-auction`, `browsing-topics`). These tokens are Chrome-only, origin-trial-gated, or already removed from the spec (Topics/FLEDGE sunset), so browsers log "Unrecognized feature" / "Origin trial controlled feature not enabled". The MCP `readTraefikConfig` failed with a schema bug — verification must happen on the server (`grep -ri permissions-policy /etc/traefik/` + `curl -sI <the URL the user browses>`).

## Affected Areas

- `frontend/app/globals.css` — token redesign (futuristic blue), animation tokens/keyframes
- `frontend/app/layout.tsx` — `lang="es"`, metadata in Spanish
- `frontend/components/**` (18 files) + `frontend/app/**/page.tsx` — English string extraction to dictionary
- `frontend/lib/i18n/` (new) — typed ES dictionary + `t()` helper, date/month formatters
- `frontend/components/ui/{FlowChart,CategoryDonut,BudgetBars,HabitsHeatmap,MetricCard,TelemetryStrip}.tsx` — token-driven colors, readability (direct labels, Spanish tooltips/axis), animation polish
- `frontend/lib/api/money.ts` — keep es-CO default, fix en-US fallback to es
- `frontend/components/layout/AppShell.tsx` — nav labels; also **dead route `/dashboard/wealth/` with no page** (404 nav item — fix or remove in this change)
- All `*.test.tsx` + `frontend/e2e/*.spec.ts` — string assertions move to ES first (TDD red)
- **Outside repo**: Dokploy/Traefik headers middleware — Permissions-Policy fix (infra task, not code)

## Approaches

### 1. Spanish i18n

| Option | Pros | Cons | Effort |
|---|---|---|---|
| **A. Typed dictionary module** (`lib/i18n/es.ts` + `t()` + Intl helpers) | Zero deps, ideal for static export + personal single-locale use, fully testable, keeps keys close to types | No lazy locale switching (not needed) | Medium |
| B. next-intl | Ecosystem, message validation | Provider + locale machinery for a single-locale private app; static-export caveats; overkill | High |
| C. String-by-string hardcode | Fastest short-term | Untestable sweep, no single source, future changes hurt | Low |

### 2. Permissions-Policy fix

| Option | Pros | Cons | Effort |
|---|---|---|---|
| **A. Prune edge middleware to recognized allowlist** (camera/mic/geolocation/payment/fullscreen/clipboard…; drop all ad-tech tokens) | Root-cause fix where the header lives | Requires Dokploy server access; manual infra task outside git | Low |
| B. Remove the header entirely | Warnings gone | Loses real hardening value | Low |
| C. Set header from Axum origin instead | Repo-controlled, testable via `cargo test` | Only works if edge stops overriding (Traefik headers middleware replaces origin values) — must combine with A | Medium |

### 3. Futuristic-blue animated theme

| Option | Pros | Cons | Effort |
|---|---|---|---|
| **A. CSS-first tokens**: new blue/cyan palette in `@theme` (OKLCH), `--animate-*` keyframes (fade/slide/glow/count-up), gradient/glass surfaces; charts read colors from tokens | No new dependency, static-export safe, respects existing reduced-motion contract, Tailwind v4 native | Entrance choreography limited vs JS libs | Medium |
| B. Add `motion` (framer-motion) for orchestrated entrances/layout animation | Richer "muy animado" feel | Bundle weight, new dep, SSR/hydration care in client components; CSS layer still needed for ambience | High |

### 4. Charts readability

| Option | Pros | Cons | Effort |
|---|---|---|---|
| **A. Keep recharts, improve legibility**: ES month labels (`Intl` "ene feb…"), direct value labels / delta badges, larger fonts, token colors, richer tooltips with currency format, animated draw-in gated by reduced-motion | No migration risk, already installed and tested | Less fancy than custom D3 | Medium |
| B. Migrate to Chart.js / ECharts | Different look | New dep, rewrite of 4 chart components + tests for zero clear gain | High |

## Recommendation

**A + A + A + A** (single-locale typed dictionary; prune edge header + optional origin fallback; CSS-token theme with keyframes; keep recharts with ES readability pass). Rationale: personal single-user static export — dependency weight and locale machinery buy nothing; the existing `@theme` + `usePrefersReducedMotion` + `money.ts` Intl groundwork makes the token/dictionary path the natural extension, not a rewrite. Keep `motion` as an explicitly deferred option if CSS animation proves insufficient for the "muy animado" bar.

Sequence for auto-chain (each slice = TDD red→green, work-unit commits, Dokploy auto-deploys on main):
1. **Header fix slice** (infra verification + minimal allowlist; judgment-day candidate: not unit-testable, needs curl evidence).
2. **i18n core slice**: `lib/i18n` dictionary + tests in ES first; sweep components/screens page-by-page (login → overview → finance → productivity); update e2e assertions alongside; fix `lang`, metadata, money fallback, chart month labels.
3. **Theme slice**: blue token pass + animation tokens + chart readability; visual gates via Playwright screenshots.
4. **Dead `/dashboard/wealth/` nav** — remove or stub within i18n/layout sweep.

Judgment-day (1–2 days): slice 2 (cross-cutting string migration, every test file touched — dual review of key naming + missed-locale audit) and slice 1 (infra change invisible to CI — needs server-side evidence review).

## Risks

- **Edge config not in git**: the Permissions-Policy fix can't be verified by CI; requires one manual probe on the Dokploy host. If the user actually browses via Traefik (unknown hostname), origin curl evidence may not match their browser path — ask them for the exact URL if the prune doesn't clear warnings.
- **Test churn**: string-heavy test suites will be red during the sweep; slices must keep tests-green per commit (migrate per-page, not globally).
- **Animation accessibility**: "muy animado" must stay behind `prefers-reduced-motion` (hook + CSS kill-switch already exist — treat as a spec requirement, not a nicety).
- **Hardcoded chart hexes**: forgetting token migration in chart internals re-fragments the theme; add a lint-style grep check in verify.
- **Artifact language**: UI copy in Spanish is user-mandated for this artifact — dictionary values are es by design, code/comments stay English.

## Ready for Proposal

**Yes.** All four asks are scoped with clear recommended options. Orchestrator should confirm with the user only: (1) exact browser URL used to access the dashboard (to pin the header-owning edge layer), (2) whether the missing `/dashboard/wealth/` section should be built now or removed from nav. Everything else can proceed in pace=auto.
