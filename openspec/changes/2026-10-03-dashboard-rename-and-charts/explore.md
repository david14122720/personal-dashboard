# Explore — 2026-10-03-dashboard-rename-and-charts

Read-only map gathered before the proposal (frontend only; backend, API, schema and dependencies untouched). This change supersedes one retired-visual clause of the canonical `frontend-dashboard` spec: the old flow chart and category donut were removed together with their data sources, and this change re-adds two distinct movement-sourced charts on the Dashboard home.

## 1. Rename surface map

| Visible surface | Source | Current copy | Change |
|---|---|---|---|
| Sidebar rail item (desktop) | `frontend/components/layout/AppShell.tsx:125` — `PRIMARY_NAV` entry `labelKey: "nav.overview"` | «Resumen» (`frontend/lib/i18n/es.ts:4`) | «Dashboard» |
| Mobile bottom tab (same item) | `AppShell.tsx:137` — `NAV_ITEMS` spreads `PRIMARY_NAV` | «Resumen» | «Dashboard» |
| Breadcrumb section | `AppShell.tsx:240-252` — `t(section.labelKey)` where `section` is the active nav item | «Panel / Resumen» | «Panel / Dashboard» |
| Home heading | `frontend/components/containers/DashboardHome.tsx:161` — `t("dashboard.overviewTitle")` | «Resumen General» (`es.ts:48`) | «Dashboard» |
| Route | `frontend/app/dashboard/page.tsx`; nav `href="/dashboard/"`; `isActive` special case in `AppShell.tsx:140` | `/dashboard/` | unchanged |

- Renaming `nav.overview` covers sidebar, mobile tab and breadcrumb because all three read the same key; no `href` changes.
- `dashboard.overview` (`es.ts:47`, «Resumen») has no consumer found by grep, but its value is renamed to «Dashboard» too so the dictionary retains no stale home identity copy. This is a copy-only key-value change: the key name stays, nothing is deleted and no route changes.
- `dashboard.overviewSubtitle` and `dashboard.panel` are not identity copy; unchanged.
- Tests asserting the old copy that implementation must re-point: `frontend/components/containers/DashboardHome.test.tsx:84,143,160,188`; `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx:138,164`; `frontend/lib/i18n/i18n.test.ts:6`; e2e `auth.spec.ts:16`, `dashboard.spec.ts:10`, `dashboard-widgets.spec.ts:8,23`.

## 2. Chart and data stack already in the repo

| Piece | Location | What it provides |
|---|---|---|
| Period type and fixed counts | `frontend/lib/finance/finance.ts:367-377` | `TrendPeriod` = day/week/month/year; `TREND_BUCKETS` = 14/8/12/5 |
| Bucket builder | `finance.ts:482-497` — `trendBuckets` | N consecutive windows oldest→newest, local `YYYY-MM-DD` boundaries (never `new Date(wire)`), last window is the unit in progress |
| One-category trend | `finance.ts:500-538` — `toCategoryTrend` | Per-bucket expense/income for one category; never nets; currency filter `currencyByAccountId.get(account_id) ?? userCurrency`; null-category rows skipped |
| Reusable line renderer | `frontend/components/finance/CategoryTrendChart.tsx` | Recharts 3 `LineChart`, 1..n series, compact Y ticks, Spanish money tooltip, tokens only, `role="img"` + `aria-label`, `animate` switch, Spanish empty state |
| Period pills | `frontend/components/finance/TrendPeriodSelector.tsx` | Día/Semana/Mes/Año radio pills, 44px hit area, keys `finance.trendPeriod*` |
| Chart helpers | `frontend/components/ui/chartTheme.ts` | `chartTok`, `chartTick`, `chartTooltipStyle`; tokens `--color-signal/flow/warn/violet/alert` exist in `app/globals.css` |
| Reduced motion | `frontend/lib/dashboard/useReducedMotion.ts` | `usePrefersReducedMotion()` — lazy, no first-paint flash |
| Code-split precedent | `frontend/components/productivity/HabitHistorySection.tsx:23` | `dynamic(() => import(...), { ssr:false, loading })` |

Gaps: no category-agnostic totals transform, no current-period range helper, no pie presentational component, no collapse/disclosure UI on the Dashboard. `toCategoryTrend` supports exactly one category; the pie needs all categories grouped. The Finance call site currently imports `CategoryTrendChart` statically (`CategoryCharts.tsx:9-12`); the new Dashboard call sites MUST use `next/dynamic(ssr:false)`, and retrofitting the Finance call site is out of scope.

## 3. Data path available on the Dashboard

- `useMovements()` → SWR key `finance/movements` (`frontend/lib/api/finance.ts:142`), full `MovementWire[]`: `category_id` nullable, `occurred_on` a `YYYY-MM-DD` string, no currency field (`finance.ts:109-120`).
- `useAccounts()` → `dashboard/accounts` (`frontend/lib/api/dashboard.ts:102`); needed for the account→currency map.
- `useCategories()` → `finance/categories` (`frontend/lib/api/finance.ts:173`); API-backed categories only. Local-only custom categories live in `localStorage` and have no backend id, so a movement can never reference them.
- `usePreferences()` → `dashboard/me` (`dashboard.ts:110`); `preferences.locale` / `preferences.currency_code` are the Dashboard currency, with `es-CO` / `COP` fallbacks — same rule as `FinanceScreens.tsx:224-225` and `DashboardHome.tsx:130-131`.
- SWR dedupes by key: mounting chart readers next to `MovementsSnapshot` adds no new requests and no new endpoints.

## 4. Period semantics evidence

`trendBuckets` uses existing period units: day = calendar day, week = Monday-first calendar week, month = calendar month, year = calendar year, taking the N most recent unit windows. The pie's user-decided Week is a trailing seven days ending today (`today-6..today`), which is not the calendar week; the pie therefore needs a new `currentPeriodRange(period, now)` helper and cannot call `trendBuckets("week")` for its scope. Day, Month and Year are the current calendar day/month/year.

Defaults: the existing category chart starts at `month` (`frontend/components/finance/CategoryCharts.tsx:40`), and the ODD record states the pie "starts at Month". Each disclosure owns its own period state, so the two selections do not couple.

## 5. Historical removals this change partially supersedes

- Canonical `frontend-dashboard` spec, `Recharts Aggregates`: "The dashboard home MUST NOT render the income-vs-expense flow chart nor the spend-by-category donut, because their only data sources were removed."
- Canonical `frontend-dashboard` spec, `Retained Chart Contracts And Removed Visual Inventory (S3b)`: `FlowChart` and the expense `CategoryDonut` consumption are removed by name and MUST NOT be re-mounted or resurrected as empty shells.
- Prior change `2026-10-03-finance-ui-fixes` repeated the non-goal "no return of the removed flow/donut visuals".

This request intentionally supersedes that prohibition for exactly two new, movement-sourced artefacts: a totals trend line and an expense-by-category pie. The old visuals' data sources stay dead; the new charts MUST read only `GET /movements` plus existing accounts/categories/preferences reads, MUST NOT request removed aggregate paths, and use component names deliberately distinct from the retired `FlowChart`/`CategoryDonut` names.

## 6. User decisions recorded

- Currency: Dashboard/preference currency only; movements on accounts in another currency are excluded, never converted or summed together.
- Route `/dashboard/` stays; the rename is copy only (three dictionary values: `nav.overview`, `dashboard.overview`, `dashboard.overviewTitle`; key names unchanged).
- No new backend endpoint, no migration, no new dependency.
- No commit, push or deploy; verification is local against the production DB with a disposable user deleted afterwards.
- Both disclosures start collapsed and toggle independently.

## 7. Verification assumptions and known limitations

- `frontend/e2e/dashboard.spec.ts:14` asserts `Flujo mensual`, a label that no longer exists in the source since the flow chart was retired. This is a pre-existing stale assertion that only surfaces when the live smoke runs (`E2E_SMOKE_LIVE=1`); it is reported, not fixed by this change.
- The rename requires updating the old-copy assertions listed in section 1; that belongs to the implementation units, not to this doc task.
- `tsc --noEmit` is the guard that unknown i18n keys (including any leftover reference to a removed key) fail the build.

## Uncertainty

None blocking. Two interpretations are taken from the ODD record and stated as explicit choices in `design.md`:

1. Each disclosure owns its own Día/Semana/Mes/Año control (pie "recalculated for the selected period", "starts at Month"), with no date navigator.
2. The totals trend includes rows with a null `category_id` because it is not a category aggregate, while the pie excludes them per the existing `finance-movements` contract.
