# Design — 2026-10-03-dashboard-rename-and-charts

## Approach

Reuse-first: the rename is three dictionary values (one of them currently unconsumed), and both charts are composed from pieces that already exist — `trendBuckets`, `toCategoryTrend`'s currency rule, `CategoryTrendChart`, `TrendPeriodSelector`, `chartTheme` and `usePrefersReducedMotion`. The only genuinely new pieces are two pure transforms (`toTotalTrend`, `currentPeriodRange` + `toExpenseByCategory`), one presentational `PieChart` component, one disclosure shell and the Dashboard wiring. No endpoint, hook key, dependency or migration is added.

| Unit | Files owned | ODD |
|---|---|---|
| **W1 — rename** | `frontend/lib/i18n/es.ts`, plus the old-copy assertions in `frontend/lib/i18n/i18n.test.ts`, `frontend/components/containers/DashboardHome.test.tsx`, `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx`, `frontend/e2e/auth.spec.ts`, `frontend/e2e/dashboard.spec.ts`, `frontend/e2e/dashboard-widgets.spec.ts` | T3 |
| **W2 — totals trend + shared disclosure** | `frontend/lib/finance/finance.ts`, `frontend/lib/finance/finance.test.ts` (`toTotalTrend`), `frontend/lib/i18n/es.ts` (`dashboard.totalTrend*` only), `frontend/components/dashboard/DashboardDisclosure.tsx` + test, `frontend/components/finance/TrendPeriodSelector.tsx` + test, `frontend/components/dashboard/TotalTrendSection.tsx` + test | T4 |
| **W3 — expense pie** | `frontend/lib/finance/finance.ts`, `frontend/lib/finance/finance.test.ts` (`currentPeriodRange`, `toExpenseByCategory`), `frontend/lib/i18n/es.ts` (`dashboard.expensePie*` only), `frontend/components/dashboard/charts/ExpenseCategoryPieChart.tsx` + test, `frontend/components/ui/chartTheme.ts` (pie palette), `frontend/components/dashboard/ExpensePieSection.tsx` + test; reuses W2's `DashboardDisclosure` | T5 |
| **W4 — integration** | `frontend/components/containers/DashboardHome.tsx` and its integration tests (including any needed test update); renders the W2/W3 components and keys, adds no `es.ts` key and no second disclosure implementation | T6 |
| **W5 — verification** | remaining spec updates, focused/full suites, `tsc --noEmit`, `pnpm build`, local Playwright with ephemeral user + cleanup | T7 |

`frontend/lib/i18n/es.ts` is touched by W1 (rename), W2 (`dashboard.totalTrend*`) and W3 (`dashboard.expensePie*`), and `frontend/lib/finance/finance.ts` by W2 and W3, so both files are touched sequentially across units, never concurrently. Each i18n key lands in the same unit that consumes it, so no intermediate branch references an untyped key.

## D1 — Rename map

| Value | Change | Visible effect |
|---|---|---|
| `frontend/lib/i18n/es.ts:4` `nav.overview` | «Resumen» → «Dashboard» | Desktop rail item, mobile tab, breadcrumb section (all read the same key) |
| `frontend/lib/i18n/es.ts:47` `dashboard.overview` | «Resumen» → «Dashboard» | None today (no consumer); renamed so the dictionary keeps no stale home identity copy |
| `frontend/lib/i18n/es.ts:48` `dashboard.overviewTitle` | «Resumen General» → «Dashboard» | Home `h1` |

- Route `/dashboard/`, `AppShell.tsx:125` `href` and the `isActive` special case stay untouched.
- `dashboard.overview` (`es.ts:47`) is unconsumed today; rename its value without deleting the key or changing its name. This is a copy-only key-value change, not a key deletion and not a route change.
- Do not touch `dashboard.overviewSubtitle` or `dashboard.panel`.

## D2 — Disclosure shell (`DashboardDisclosure`)

One presentational component in `frontend/components/dashboard/`, following the existing `NewEntryButton` accessibility pattern (`frontend/components/productivity/ProductivitySections.tsx:133-160`) instead of native `<details>`:

- Outer `<section>`; the title lives in an `h2` that contains the trigger `<button type="button" aria-expanded={open} aria-controls={panelId}>`; the chevron is `aria-hidden`.
- The trigger keeps the 44×44 hit area and `focus-visible:ring-2 focus-visible:ring-signal` used elsewhere.
- The panel target always exists in the DOM: `<div id={panelId} hidden={!open}>{open ? children : null}</div>` — `aria-controls` always resolves to that element, `aria-expanded` tracks state, and the closed panel holds no children, so contents and the dynamic Recharts chunk mount only on first open and hidden charts never mount or fetch.
- Props: `title`, `hint`, `open`, `onToggle`, `panelId`, `children`. It owns no state: each section component owns its own `open` boolean, which makes the two disclosures independent by construction.
- One implementation only: created in W2 with the totals trend and reused unchanged by W3's pie section. No second disclosure component and no native `<details>` variant.

## D3 — Component boundaries and state ownership

| Component | Role | State |
|---|---|---|
| `DashboardDisclosure` | Pure disclosure chrome; created in W2 and reused by W3 | none |
| `TotalTrendSection` | Owns `open` (default `false`) and `period` (default `"month"`); renders the disclosure, `TrendPeriodSelector`, and a lazily mounted panel | `open`, `period` |
| `ExpensePieSection` | Same shape for the pie | `open`, `period` |
| Panel content (inline in each section) | Owns the SWR reads + memoized aggregation; renders loading/error/empty and the dynamic chart | none |
| Reused `CategoryTrendChart` (dynamic at the call site) | Presentational line chart, 2 series | none |
| New `ExpenseCategoryPieChart` (dynamic at the call site) | Presentational Recharts `PieChart` | none |

Keeping `open`/`period` in the section component (which stays mounted) means collapsing a panel preserves its selected period; only the panel's children unmount while the empty `aria-controls` target stays in the DOM.

## D4 — Data path

Inside the lazily mounted panel content, per section:

```ts
const movements = useMovements();      // "finance/movements"
const accounts = useAccounts();        // "dashboard/accounts"
const categories = useCategories();    // "finance/categories" (pie only)
const prefs = usePreferences();        // "dashboard/me"
const currencyByAccountId = useMemo(
  () => new Map((accounts.data ?? []).map((a) => [a.id, a.currency])),
  [accounts.data],
);
const userCurrency = prefs.data?.preferences.currency_code ?? "COP";
const locale = prefs.data?.preferences.locale ?? "es-CO";
```

- SWR dedupes on the same keys already used by `MovementsSnapshot`, so opening a disclosure adds no new request when the widget is mounted; when it is not, the panel fetches only on open.
- Loading/error handling mirrors `MovementsSnapshot`: Spanish `role="status"` / `role="alert"` with retry mutating `finance/movements`, `dashboard/accounts` and (pie) `finance/categories`.
- No currency conversion anywhere; the fallback rule is the existing one: `currencyByAccountId.get(m.account_id) ?? userCurrency`.

## D5 — `toTotalTrend` (new pure function, `lib/finance/finance.ts`)

```ts
export function toTotalTrend(
  movements: MovementWire[] | undefined,
  opts: {
    period: TrendPeriod;
    currencyByAccountId: Map<string, string>;
    userCurrency: string;
    now?: Date;
    buckets?: number;
  },
): TrendBucket[]
```

- Windows come from the existing `trendBuckets(period, now, buckets)` (local `YYYY-MM-DD` boundaries, oldest→newest, counts 14/8/12/5).
- Iterates all movements, applies the currency filter, never filters by category and never nets: `direction === "expense"` adds to `expense`, `"income"` adds to `income`.
- Rows with `category_id: null` participate — the totals trend is not a category aggregate.
- Mirrors `toCategoryTrend`'s always-N-rows output, so the chart never has gaps and needs no empty-axis state.

## D6 — `currentPeriodRange` + `toExpenseByCategory` (new pure functions)

```ts
export function currentPeriodRange(
  period: TrendPeriod,
  now: Date = new Date(),
): { from: string; to: string }
```

Built from the file's existing local-date helpers (`toISODateLocal`, `addLocalDays`):

| Period | `from` | `to` |
|---|---|---|
| `day` | today | today |
| `week` | today − 6 days | today |
| `month` | first day of the current month | last day of the current month |
| `year` | January 1 of the current year | December 31 of the current year |

```ts
export function toExpenseByCategory(
  movements: MovementWire[] | undefined,
  opts: {
    range: { from: string; to: string };
    categories: CategoryWire[] | null | undefined; // API-backed set only
    currencyByAccountId: Map<string, string>;
    userCurrency: string;
  },
): { categoryId: string; name: string; value: number }[]
```

- Filters: `direction === "expense"`, `category_id` non-null, `from <= occurred_on <= to`, account currency equals `userCurrency`.
- Groups by `category_id`, joins the name from the API-backed category list (a movement whose category id is absent from that list is ignored, which is exactly how local-only custom categories stay out), drops zero totals and sorts by value descending for a stable legend.
- The Month/Year `to` may extend past today because the user decision defines the scope as the current calendar month/year; the comparison is a plain string range over `occurred_on`, so no special casing is needed.

## D7 — Period controls

- Both sections reuse `TrendPeriodSelector` and the existing `finance.trendPeriod*` labels; no duplicate pill component and no new period keys.
- Default `"month"` in both, matching the existing `CategoryChartSection` and the ODD decision.
- The labels carry different meanings per disclosure (trend = last N bucket windows; pie = current period). The hints (`dashboard.totalTrendHint`, `dashboard.expensePieHint`) state the meaning in Spanish; the pie hint names the current-period scope and the trend hint says "sin agrupar por categoría".
- `TrendPeriodSelector` gains an optional `name` prop defaulting to `"trend-period"` (backwards compatible: Finance renders unchanged). `TotalTrendSection` passes `dashboard-total-trend-period` and `ExpensePieSection` passes `dashboard-expense-pie-period`, so the two instances are distinct native radio groups.
- Each disclosure owns its own `period` state and native radio group (distinct fixed names); no shared context, no coupling, and a selection in one chart can never move the other's checked radio.

## D8 — Charts: code splitting, tokens, reduced motion

- Both dynamic imports live at the section call sites: `dynamic(() => import("@/components/finance/CategoryTrendChart"), { ssr: false, loading })` and `dynamic(() => import("@/components/dashboard/charts/ExpenseCategoryPieChart"), { ssr: false, loading })`, following `HabitHistorySection.tsx:23`.
- `usePrefersReducedMotion()` runs in the panel; pass `animate={!reduced}` to `CategoryTrendChart` and `isAnimationActive={!reduced}` to the pie's `<Pie>`.
- The line chart keeps the existing token/tooltip contract for free. The pie adds a token list to `chartTheme.ts` (for example `--color-signal`, `--color-flow`, `--color-warn`, `--color-violet`, `--color-alert`, `--color-signal-soft`, cycled deterministically when more categories exist) and uses `chartTok` for `Cell` fills; all labels/legend names are Spanish, all values money-formatted with `formatMoney(locale, currency)`, and `role="img"` + `aria-label` describe the chart.
- The pie maps values to `number` at the transform boundary (`toNumber`), never renders a raw wire string.

## D9 — New i18n keys

| Key | Unit | Purpose |
|---|---|---|
| `dashboard.totalTrendTitle` | W2 | Disclosure title «Gastos vs. ingresos» |
| `dashboard.totalTrendHint` | W2 | Scope hint: totals per period, no category grouping |
| `dashboard.totalTrendChartLabel` | W2 | Chart `aria-label` |
| `dashboard.totalTrendEmpty` | W2 | Spanish note when the period has no movements |
| `dashboard.expensePieTitle` | W3 | Disclosure title «Gastos por categoría» |
| `dashboard.expensePieHint` | W3 | Scope hint: expenses only, current period |
| `dashboard.expensePieChartLabel` | W3 | Chart `aria-label` |
| `dashboard.expensePieEmpty` | W3 | Spanish empty state for no expenses in period |

The `totalTrend*` keys ship inside W2 and the `expensePie*` keys inside W3, each with the tests that consume them; W4 adds none.

Series legend labels reuse `finance.chartExpenses` / `finance.chartIncome`; period labels reuse `finance.trendPeriod*`. Disclosure triggers need no toggle copy: the visible title is the label and the chevron is `aria-hidden`.

## D10 — Test strategy

Test-first applies to every deterministic behavior:

1. **RED → GREEN, transforms** (`lib/finance/finance.test.ts`, Spanish test names as in the existing file): `toTotalTrend` (exact N per period, oldest→newest, two separate sums, null-category included, currency exclusion, out-of-range excluded, empty buckets zero); `currentPeriodRange` (day/week/month/year boundaries, week trailing and inclusive of today, month/year calendar edges); `toExpenseByCategory` (expenses only, grouping and descending order, null category excluded, unknown/local-only category excluded, zero totals dropped, currency exclusion, range edges inclusive).
2. **RED → GREEN, disclosure behavior** (component tests with `next/dynamic` mocked as the existing DashboardHome tests do): heading «Dashboard», both triggers `aria-expanded="false"` initially, independent toggling, panel content absent while collapsed, period default Mes and independent per disclosure, keyboard/hit area, Spanish copy.
3. **Update parity assertions**: `DashboardHome.test.tsx` and `DashboardHome.widgets.test.tsx` heading queries; `lib/i18n/i18n.test.ts` identity key; e2e heading assertions. The pre-existing stale `Flujo mensual` assertion in `e2e/dashboard.spec.ts:14` is reported, not fixed.
4. **Presentational chart test** for the pie (empty state, slices/legend from data, token fills) since the dynamic mock hides it from the container tests; `CategoryTrendChart.test.tsx` already covers the reused line renderer.
5. Full frontend suite + `tsc --noEmit` + `pnpm build` after the units converge.

## Risks

| Risk | Mitigation |
|---|---|
| Renaming `nav.overview` changes three visible surfaces at once (rail, mobile tab, breadcrumb) | One key, same href; e2e covers rail, breadcrumb and both viewport navigations |
| Same period labels mean different windows per chart (buckets vs current period) | Hints state each scope in Spanish; the two states are independent so no silent coupling |
| Pie unreadable with many categories | Deterministic token cycling plus a value-sorted legend; top-N/«Otras» is an explicit non-goal flagged for future work |
| Dynamic mock hides chart internals in container tests | Transform tests own the data contract; a dedicated presentational pie test covers rendering |
| Recharts in the static export | `next/dynamic(ssr:false)` at the section call sites, same as the habit chart precedent |
| Live smoke cannot pass because of the pre-existing `Flujo mensual` assertion | Report it as an out-of-scope pre-existing limitation; verification uses the targeted checks plus the suite run, and does not silently edit that line |
