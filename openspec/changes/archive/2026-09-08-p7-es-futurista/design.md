# Design: Spanish i18n + Edge Header Prune + Futuristic Blue Theme

## Technical Approach

Three independent slices (auto-chain, work-unit commits), each rollback-safe:

1. **Edge header prune** — infra-only, no repo code. On the Dokploy host: `grep -rni permissions-policy /etc/dokploy/traefik/`, replace the ad-tech denylist value with the research C8–C10 allowlist in the Traefik headers middleware `customResponseHeaders` map, hot-reload, evidence-gate with `curl -sI http://192.168.50.120:8055/` + browser console. Judgment-day infra evidence review.
2. **i18n sweep** — new typed `lib/i18n/` dictionary + `t()` + Intl formatters; per-page red→green (login → overview → finance → productivity); wealth nav removed. Judgment-day key-naming/missed-locale audit.
3. **Theme + charts** — OKLCH blue/cyan `@theme` tokens + `--animate-*` keyframes; token-driven chart colors, ES month labels, direct value labels, ES currency tooltips; reduced-motion contract preserved; Playwright screenshots as evidence.

## Architecture Decisions

| # | Decision | Options | Choice & rationale |
|---|---|---|---|
| D1 | i18n mechanism | next-intl; hand-rolled dict | Hand-rolled typed dict + `t()` — single locale, static-export safe, zero deps, keys type-checked (next-intl out of scope) |
| D2 | Dictionary typing | loose `Record`; `as const` + recursive `Paths<T>` union | `as const` + `Paths<T>` — unknown `t("missing.key")` fails `tsc`/build (spec R1) |
| D3 | Formatters | static arrays; Intl | `Intl.DateTimeFormat`/`NumberFormat` (bundled ICU) — build-time safe for `output: "export"` |
| D4 | `formatMoney` fallback | en-US/USD; es-CO/COP | es-CO/COP — spec: never en-US |
| D5 | Chart series colors | hex constants; `var()` strings; `getComputedStyle` resolver | Runtime `chartToken()` reading `@theme` custom props — token change re-renders charts with no code change (spec scenario); charts are `ssr:false` so `window` is safe; tokens are stable (no light-class overrides exist), single mount-time read |
| D6 | Chart locale/currency | i18n context; props | Props from containers (already own `prefs`), defaults es-CO/COP |
| D7 | Dead wealth route | keep; remove | Remove entry from `AppShell` `NAV_ITEMS` (`wealth_quitar` confirmed) |
| D8 | Theme shape | new token names; keep semantic names, swap values | Keep `signal/flow/alert/hull/deck/instrument/sky/violet`, swap hex→OKLCH blue/cyan; add `--animate-*` keyframes in `@theme`; glass = existing `bg-hull/40` + `backdrop-blur`, gradients = token `from-/to-` utilities |
| D9 | Reduced motion | new hook; existing CSS kill-switch | Existing global `@media (prefers-reduced-motion: reduce)` block already zeroes all animations incl. `--animate-*`; charts keep `isAnimationActive={!reducedMotion}` via `usePrefersReducedMotion`. Verify only, no new code |
| D10 | Edge header | remove; prune | Prune + keep (research Q2: preserves hardening; 7 banned tokens gone) |

## Data Flow

```
es.ts (as const) ──t(key, vars?)──> components/tests (typed ES strings)
formatMonth("2026-09") ──Intl es-CO──> XAxis tickFormatter → "sep 2026"
chartToken("--color-flow") ──getComputedStyle──> Recharts fill/stroke
formatMoney(v,{locale,currency}) ──Intl; catch→es-CO/COP──> tooltips + direct labels
```

## File Changes

| File | Action | Description |
|---|---|---|
| `frontend/lib/i18n/es.ts` | Create | `as const` ES dictionary (login/nav/overview/finance/productivity/common) |
| `frontend/lib/i18n/index.ts` | Create | `Paths<T>` + `EsKey`, `t()`, `formatMonth()`, `chartToken()` |
| `frontend/lib/api/money.ts` | Modify | Catch fallback en-US/USD → es-CO/COP |
| `frontend/app/layout.tsx` | Modify | `lang="es"`, Spanish `title`/`description` |
| `frontend/app/globals.css` | Modify | OKLCH blue/cyan token values, `--animate-*` keyframes in `@theme` |
| `frontend/app/login/page.tsx`, `app/page.tsx` | Modify | ES strings via `t()` ("Cargando…" etc.) |
| `frontend/components/layout/AppShell.tsx` | Modify | `t()` nav labels, wealth entry removed |
| `frontend/components/containers/{DashboardHome,FinanceScreens,ProductivityScreens}.tsx` | Modify | `t()` strings; pass `locale`/`currency` to charts |
| `frontend/components/finance/*`, `components/productivity/ProductivitySections.tsx` | Modify | `t()` strings incl. sr-only compositions (`"{label}: {n} por ciento, estado {status}"`) |
| `frontend/components/ui/{FlowChart,CategoryDonut,BudgetBars}.tsx` | Modify | `chartToken()` colors, `formatMonth` ticks, `formatMoney` tooltips, direct `LabelList` values, `var(--color-*)` grid/axis |
| `frontend/lib/i18n/i18n.test.ts` | Create | `t()`/`formatMonth`/fallback tests + `// @ts-expect-error` unknown-key type gate |
| `frontend/{app/login/page.test.tsx, components/finance/finance.test.tsx, components/productivity/productivity.test.tsx, components/ui/charts.test.tsx, components/ui/TelemetryStrip.test.tsx, lib/api/money.test.ts}` | Modify | ES assertions first (red) per page |
| `frontend/e2e/{auth,dashboard,sections}.spec.ts` | Modify | ES selectors ("Iniciar sesión", "Resumen", "Finanzas", "Productividad"); screenshots |
| `frontend/lib/productivity/productivity.ts` etc. | Unchanged | Backend enums (`done/pending/over…`) stay as wire values; only UI copy translates |
| `/etc/dokploy/traefik/*.yml` (Dokploy host) | Modify | `customResponseHeaders.Permissions-Policy` pruned value |

## Interfaces / Contracts

```ts
// lib/i18n/es.ts
export const es = {
  nav: { overview: "Resumen", finance: "Finanzas", productivity: "Productividad", signOut: "Cerrar sesión" },
  dashboard: { overview: "Resumen", flow: "Flujo mensual", noFlow: "Sin datos de flujo aún" },
  common: { retry: "Reintentar", loading: "Cargando…" },
} as const;

// lib/i18n/index.ts
type Paths<T, P extends string = ""> = T extends string ? P
  : { [K in keyof T]: Paths<T[K], `${P}${P extends "" ? "" : "."}${K & string}`> }[keyof T];
export type EsKey = Paths<typeof es>;           // "nav.overview" | …
export function t(key: EsKey, vars?: Record<string, string | number>): string; // {name} substitution
export function formatMonth(monthKey: string, locale = "es-CO"): string;       // "2026-09" → "sep 2026"; invalid → raw key
export function chartToken(prop: `--color-${string}`): string;                 // getComputedStyle read, "" on SSR
```

`formatMoney` keeps signature; catch branch returns `Intl.NumberFormat("es-CO", {style:"currency", currency:"COP", maximumFractionDigits:0})`.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (vitest) | `t()` substitution, `formatMonth` ES output, `formatMoney` es-CO fallback | New `lib/i18n/i18n.test.ts`; `// @ts-expect-error` compiles as type gate for unknown keys |
| Component (vitest) | ES copy per page, wealth nav absent, chart ES labels/tooltips | Flip assertions to ES **before** each page sweep (red) → green per commit; `pnpm test` |
| Type/build | Unknown key fails build | `tsc` via `next build` |
| Backend | none | `cargo test` untouched (no Rust changes) |
| E2E (Playwright) | ES headings/labels; screenshots | `test:e2e` with `E2E_SMOKE_LIVE=1`; screenshots as verify-report evidence (no golden baseline exists) |
| Slice 3 gates | hex leaks, reduced motion | `rg -n '#[0-9a-fA-F]{3,8}' components/ui` → zero; reduced-motion test asserts no `--animate-*`/chart animation |

Slice 1 evidence (not unit-testable): stored `curl -sI` output showing only the six denied directives + zero banned tokens; console capture with zero Permissions-Policy messages.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary in shipped code. Slice 1's Traefik edit is an operator-run config-file change (grep/curl are verification commands, not code boundaries). No RED tests applicable.

## Migration / Rollout

No data migration. Per-slice git revert rollback; edge = restore prior YAML bytes + hot-reload (`docker restart dokploy-traefik` fallback); theme = revert `globals.css`. Judgment-day hooks: slice 1 infra-evidence review, slice 2 key-naming + missed-locale audit. Slice 1 requires Dokploy host access and live-URL confirmation.

## Open Questions

- [ ] Exact Spanish copy choices (e.g. "Resumen" vs "General", brand "Control Deck" kept?) — defer to apply with judgment-day audit.
- [ ] Slice 1: exact Traefik file/router name unknown until host grep; confirm `url_ip` is the browsed origin.
- [ ] Playwright screenshots: evidence-only (no golden regression baseline — none exists today).