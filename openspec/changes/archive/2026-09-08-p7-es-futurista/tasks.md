# Tasks: Spanish i18n + Edge Header Prune + Futuristic Blue Theme (p7-es-futurista)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 800-1200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Header) $\to$ PR 2 (i18n Foundation) $\to$ PR 3 (i18n Sweep) $\to$ PR 4 (i18n E2E) $\to$ PR 5 (Theme Foundation) $\to$ PR 6 (Charts/Visuals) |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Header Prune & Evidence | PR 1 | `curl -sI http://192.168.50.120:8055/` | Browser Console (Warnings) | Traefik YAML on host |
| 2 | i18n Foundation | PR 2 | `pnpm test lib/i18n` | `tsc` (build) | `frontend/lib/i18n/` |
| 3 | i18n Page Sweep | PR 3 | `pnpm test app/ components/` | Browser (ES Copy) | Page-specific components |
| 4 | i18n E2E | PR 4 | `pnpm test:e2e` | Playwright (ES Selectors) | `frontend/e2e/*.spec.ts` |
| 5 | Theme Foundation | PR 5 | `rg -n '#[0-9a-fA-F]{3,8}'` | Browser (Blue Theme) | `frontend/app/globals.css` |
| 6 | Chart Readability | PR 6 | `pnpm test components/ui` | Browser (Chart Labels) | `frontend/components/ui/*.tsx` |

## Phase 1: Header Prune Infra (Slice 1)

- [ ] 1.1 Locate Traefik `permissions-policy` config on Dokploy host using `grep -rni permissions-policy /etc/dokploy/traefik/`.
- [ ] 1.2 Update Traefik YAML `customResponseHeaders` to use allowlist: `camera=(), microphone=(), geolocation=(), payment=(), display-capture=(), autoplay=()`.
- [ ] 1.3 Verify header via `curl -sI http://192.168.50.120:8055/` and check browser console for zero `Permissions-Policy` warnings.
- [ ] 1.4 Store `curl` output and console capture as evidence for Judgment Day review.

## Phase 2: i18n Sweep (Slice 2)

- [x] 2.1 Create `frontend/lib/i18n/es.ts` with `as const` Spanish dictionary.
- [x] 2.2 Create `frontend/lib/i18n/index.ts` implementing `Paths<T>`, `t(key, vars)`, and `formatMonth(month, locale)`.
- [x] 2.3 Write `frontend/lib/i18n/i18n.test.ts`: Test `t()` substitution, `formatMonth` output, and `// @ts-expect-error` for unknown keys (RED $\to$ GREEN).
- [x] 2.4 Update `frontend/lib/api/money.ts` to use `es-CO/COP` fallback when Intl throws (RED $\to$ GREEN).
- [x] 2.5 Update `frontend/app/layout.tsx` with `lang="es"` and Spanish metadata (title/description).
- [x] 2.6 Login Page: Update `frontend/app/login/page.test.tsx` assertions (RED) $\to$ sweep `frontend/app/login/page.tsx` with `t()` $\to$ verify (GREEN).
- [x] 2.7 Overview Page: Update `frontend/app/page.test.tsx` assertions (RED) $\to$ sweep `frontend/app/page.tsx` with `t()` $\to$ verify (GREEN).
- [x] 2.8 Finance Page: Update `frontend/components/finance/finance.test.tsx` assertions (RED) $\to$ sweep `frontend/components/finance/*` with `t()` $\to$ verify (GREEN).
- [x] 2.8-followup Finance remainder (slice-2h): ledger filters/headers + budget/card row details via `t()` (RED $\to$ GREEN); errors/progress-aria/hints/empties deferred explicitly.
- [x] 2.9 Productivity Page primary shells (slice-2k): `productivity.test.tsx` ES region/empty/error assertions (RED) $\to$ `productivity.*` keys in `es.ts` + `ProductivityScreens.tsx` shells/header/loading/error via `t()` + `ProductivitySections.tsx` empty states via `t()` $\to$ verify (GREEN).
- [x] 2.9-followup Productivity row details (slice-2l): streak text, habit log-button labels/aria, goal progressbar aria + due strings, task group headers + priority/due + Done/Reopen labels/aria via `t()` (RED $\to$ GREEN).
- [x] 2.9-followup2 Productivity remainder (slice-2m): event kind/location/when labels (transform-layer `eventWhenLabel` ES + lib asserts), goal status strings, notes search placeholder/aria, pinned badge via `t()` (RED $\to$ GREEN).
- [x] 2.10 Nav Prune: Update `frontend/components/layout/AppShell.tsx` nav labels via `t()` and remove `/dashboard/wealth/` entry.
- [x] 2.11 E2E Update: Update selectors in `frontend/e2e/{auth,dashboard,sections}.spec.ts` for ES strings (RED $\to$ GREEN).

## Phase 3: Theme & Visuals (Slice 3)

- [x] 3.1 Update `frontend/app/globals.css` with OKLCH blue/cyan tokens and `--animate-*` keyframes in `@theme`.
- [x] 3.2 Add `chartToken(prop)` utility to `frontend/lib/i18n/index.ts` to read CSS custom properties via `getComputedStyle`.
- [x] 3.3 FlowChart: Update `frontend/components/ui/FlowChart.tsx` with token colors, `formatMonth` axis ticks, and `formatMoney` tooltips.
- [x] 3.4 CategoryDonut: Update `frontend/components/ui/CategoryDonut.tsx` with token colors and `formatMoney` tooltips.
- [x] 3.5 BudgetBars: Update `frontend/components/ui/BudgetBars.tsx` with token colors and `formatMoney` tooltips.
- [x] 3.6 Verify `prefers-reduced-motion` kill-switch in `frontend/app/globals.css` and chart animation suppression.
- [x] 3.7 Visual Gates: `rg -n '#[0-9a-fA-F]{3,8}' frontend/components/ui` → zero hex leaks; `pnpm build` (static export) + full vitest suite green as evidence. Playwright screenshots deferred to a browser-equipped environment (no browsers installed here) — slice-3c.
- [x] 3b-followup Final Polish (slice-3c): TelemetryStrip `aria-label` + LED status via `t("dashboard.telemetryStrip" / "dashboard.telemetryStatus")`; CategoryDonut direct `LabelList` money values + legend money; BudgetBars direct `LabelList` pct via exported `budgetBarLabel()` + sr-only ES ("por ciento, estado"); ES-first ui tests RED→GREEN.

## Judgment Day Plan (Slices 1 & 2)

- **Schedule**: 1–2 days.
- **Target**: Slice 1 (Header evidence) + Slice 2 (i18n dictionary & sweep).
- **Evidence**: `curl` logs, console captures, `es.ts` source, and page-by-page string audit.
- **Slots**:
  - Judge A: Audit `es.ts` key naming and search for missed English literals in `frontend/app`.
  - Judge B: Verify `Permissions-Policy` matches allowlist and check for browser warnings.
- **Verdict**: `APPROVED` if zero banned tokens and zero English UI strings remain.

## Rollback Plan

- **Slice 1**: Restore Traefik YAML bytes $\to$ `docker restart dokploy-traefik`.
- **Slice 2**: Git revert to pre-i18n commit.
- **Slice 3**: Git revert `globals.css` and chart components.
