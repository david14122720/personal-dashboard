# Tasks — 2026-10-03-dashboard-rename-and-charts

- status: `ready_for_apply`
- delivery: none (owner: no commit, no push, no deploy — local review only)
- commands: all frontend commands below run from `frontend/`
- ODD: this list is T2–T7 of `odd/tasks/dashboard-rename-and-charts.md`; T1 (explore) and T2 (these artifacts) are done.

## W0 — SDD artifacts (this task)

- [x] W0.1 — `explore.md` with the source map, retired-visual evidence and verification assumptions
- [x] W0.2 — `proposal.md` with scope, decisions, impact and verification outline
- [x] W0.3 — delta specs for `frontend-dashboard`, `finance-movements` and `frontend-i18n`
- [x] W0.4 — `design.md` (reuse plan, component boundaries, D1–D10, risks) and this task list

## W1 — Visible identity becomes «Dashboard» (T3)

Owns `frontend/lib/i18n/es.ts` and the old-copy assertions.

- [x] W1.1 — RED: re-point the identity assertions so they fail on the old copy (`lib/i18n/i18n.test.ts` including all three identity keys, `DashboardHome.test.tsx`, `DashboardHome.widgets.test.tsx`, e2e `auth.spec.ts` / `dashboard.spec.ts` / `dashboard-widgets.spec.ts`)
- [x] W1.2 — Set `nav.overview`, `dashboard.overview` and `dashboard.overviewTitle` to «Dashboard» (value-only change; key names, route, `href` and `isActive` untouched)
- [x] W1.3 — Confirm no home identity value resolves to «Resumen»/«Resumen General» (scoped grep plus rendered assertions)
- [x] W1.4 — Focused unit suites green: 39 passed. TypeScript and live Playwright are deferred to W5; report the pre-existing stale `e2e/dashboard.spec.ts:14` «Flujo mensual» assertion and do not fix it here.

## W2 — Totals trend, shared disclosure and chart (T4)

Owns `frontend/lib/finance/finance.ts`, `frontend/lib/finance/finance.test.ts`, `frontend/lib/i18n/es.ts` (the `dashboard.totalTrend*` keys only), `frontend/components/dashboard/DashboardDisclosure.tsx` + `DashboardDisclosure.test.tsx`, `frontend/components/finance/TrendPeriodSelector.tsx` + `TrendPeriodSelector.test.tsx`, `frontend/components/dashboard/TotalTrendSection.tsx` + `TotalTrendSection.test.tsx`. No `DashboardHome` wiring in this unit.

- [x] W2.1 — RED observed (missing `toTotalTrend`): 6 failed / 28 passed; GREEN after implementation: 49 focused tests passed. Coverage: exact 14/8/12/5 buckets, oldest→newest, separate expense/income, null-category rows included, USD-account rows excluded without conversion, out-of-range rows excluded, empty buckets at 0/0.
- [x] W2.2 — Implemented `toTotalTrend` reusing `trendBuckets` and the existing currency-fallback rule; focused transform tests are GREEN.
- [x] W2.3 — RED observed for disclosure, selector-group independence and trend section. The radio collision reproduced with two default-name selectors; the section correctly asserts its own period group name.
- [x] W2.4 — GREEN: added the `dashboard.totalTrend*` keys, backwards-compatible optional selector `name` (Finance default retained), shared persistent-target `DashboardDisclosure`, and `TotalTrendSection` with its own period group, lazy SWR panel and dynamic two-series `CategoryTrendChart`.
- [x] W2.5 — Focused GREEN runs: 49/49 and 21/21; `node node_modules/typescript/bin/tsc --noEmit` completed with explicit `TS_EXIT=0`. Full suite/build/Playwright remain W5.

## W3 — Expense-by-category pie aggregation and chart (T5)

Owns `frontend/lib/finance/finance.ts`, `frontend/lib/finance/finance.test.ts`, `frontend/lib/i18n/es.ts` (the `dashboard.expensePie*` keys only), `frontend/components/dashboard/charts/ExpenseCategoryPieChart.tsx` (+ test), `frontend/components/ui/chartTheme.ts`, `frontend/components/dashboard/ExpensePieSection.tsx` (+ test). Reuses W2's `DashboardDisclosure`; adds no second disclosure implementation, and touches `finance.ts`/`es.ts` after W2, never concurrently.

- [x] W3.1 — RED/GREEN for `currentPeriodRange`: day = today; week = today−6..today inclusive; month = current calendar month; year = current calendar year (includes a year-boundary week case).
- [x] W3.2 — RED/GREEN for `toExpenseByCategory`: expenses only; grouping by persisted category id and descending order; null-category row excluded; local-only/unknown category excluded; zero totals dropped; USD-account rows excluded with missing-account fallback; inclusive range edges.
- [x] W3.3 — Implemented both pure functions; GREEN in the focused suite.
- [x] W3.4 — RED/GREEN: presentational pie tests (empty state, cells, legend, token fills, true pie not donut) and `ExpensePieSection` tests (open/period, range recalculation, pie/trend radio independence, closed aria target, loading/error Spanish states).
- [x] W3.5 — Added token palette and true `ExpenseCategoryPieChart`, typed `dashboard.expensePie*` keys, and `ExpensePieSection` with `TrendPeriodSelector name="dashboard-expense-pie-period"`, API-backed category join and dynamic import.
- [x] W3.6 — Focused pie suite GREEN: 64/64; shared chart regression suite: 44/44; TypeScript sentinel `TS_EXIT=0`. Full suite/build/Playwright remain W5.

## W4 — Dashboard integration (T6)

Owns `frontend/components/containers/DashboardHome.tsx` and its integration tests (`DashboardHome.test.tsx`, `DashboardHome.widgets.test.tsx`, including any update they need). Reuses the W2 `DashboardDisclosure` and both section components and keys; adds no `es.ts` key and no second disclosure implementation.

- [x] W4.1 — RED observed: 3 integration tests failed / 22 passed before the sections were wired (the expected disclosure buttons were absent); the widgets-parity suite remained green.
- [x] W4.2 — GREEN: rendered both sections after the telemetry strip and before the existing latest-movements/upcoming-subscriptions row, responsive 7/5 columns at large widths, and corrected the DashboardHome data-ownership comment.
- [x] W4.3 — Confirmed token-only colors, reduced-motion handling in the section suites (T4/T5), and no new chart hex literals.
- [x] W4.4 — Focused DashboardHome suites GREEN: 2 files / 25 tests; TypeScript printed explicit `TS_EXIT=0`. Full suite/build/Playwright remain W5.

## W5 — Verification (T7)

- [x] W5.1 — Full frontend suite `pnpm test`: 48 files, 481 tests passed.
- [x] W5.2 — `node node_modules/typescript/bin/tsc --noEmit`: `TS_EXIT=0`.
- [x] W5.3 — `pnpm build` succeeded; static export includes `/dashboard/` and 13 routes.
- [ ] W5.4 — Follow `webapp-testing/SKILL.md`: run the bundled `with_server.py --help` via `python3` (`python` shim is absent), then use its helper and a native Python Playwright script against the local stack pointed at production DB with a disposable backend `--create-user`. Verify Dashboard labels, collapsed/independent disclosures, radio periods, two non-netted trend series, expense-only pie category distribution, responsive 1440/768/390 and clean browser logs. Do not run the full stale live-smoke suite (its pre-existing «Flujo mensual» assertion is documented).
- [ ] W5.5 — Delete the throwaway user (all rows cascade) and confirm no test data remains
- [ ] W5.6 — Record evidence in the ODD task file and report the pre-existing `Flujo mensual` assertion as an out-of-scope known limitation

## Explicitly absent

- No commit, push, deploy or release task: the owner forbids delivery for this feature.
- No schema migration, endpoint, dependency or unrelated behavior-change task.
- No fix for the pre-existing stale `frontend/e2e/dashboard.spec.ts:14` assertion.
