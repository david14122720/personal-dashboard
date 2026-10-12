# ODD Feature: Dashboard rename and finance charts

**Status:** Closed and verified. Judgment Day **APPROVED** after the final gate (full suite 494/494, `TS_EXIT=0`, 13 routes, browser checks all PASS). Owner decision: local only — no commit, push or deploy.  
**Branch:** `feat/2026-10-03-dashboard-rename-and-charts` (local only)  
**Base:** `main` at `5d92b66`  
**Delivery boundary:** no commit, push, or deploy (explicit user instruction).

## Goal
Rename the visible home identity from «Resumen» to «Dashboard» while preserving `/dashboard/`. Add two independently collapsible, initially hidden Dashboard charts:
1. A category-free total-expense vs total-income trend, with the existing Day/Week/Month/Year controls.
2. An expense-only pie grouped by persisted backend category and recalculated for the current selected period.

## Decisions and constraints
- Keep `/dashboard/`, its `href` and route matching unchanged.
- Set the values of `nav.overview`, `dashboard.overview` (currently unconsumed), and `dashboard.overviewTitle` to «Dashboard»; retain the typed keys.
- **Currency:** include only movements whose account currency matches the user's Dashboard/preference currency; no conversion or mixed-currency sums. Confirmed by the user.
- Reuse trend counts Day `14`, Week `8`, Month `12`, Year `5`, in oldest-to-newest order.
- Pie ranges use current local periods: Day = today; Week = trailing seven days ending today; Month = current calendar month; Year = current calendar year. Each chart owns an independent period state, defaulting to Month.
- The totals trend includes rows with a null category id; the pie excludes null category ids and uses persisted backend categories (no local-only custom categories).
- Reuse Recharts and existing tokens, accessible focus/disclosures, Spanish labels, currency formatting and reduced-motion conventions. Each disclosure's `aria-controls` target stays in the DOM while closed (`hidden`), but chart children mount only when open. No new dependency, endpoint or migration.
- Production DB is used only for local Playwright verification with a disposable user and verified cleanup; no destructive migrations.

## Work units
- [x] T1 — Explore existing labels, chart/data/period/test conventions; resolve currency behavior with the user.
- [x] T2 — Complete SDD artifacts and reconcile the deliberate spec change.
- [x] T3 — Rename all three home identity values, preserve route and update assertions.
- [x] T4 — Add/test the category-agnostic totals trend, its typed `dashboard.totalTrend*` copy, shared accessible disclosure, isolated trend radio group and trend section.
- [x] T5 — Add current-period expense-by-category aggregation and pie; test dates/categories/currency and use a distinct native radio-group name.
- [x] T6 — Integrate independent collapsed disclosures and period controls; add accessible component tests and typed copy.
- [x] T7 — Run focused/full checks and local Playwright with production DB + ephemeral user, clean up, record evidence. **Done twice: the initial pass and the post-T8 rerun (482/482 tests, `TS_EXIT=0`, 13 routes, browser evidence at 1440/768/390, cleanup proven).**
- [x] T8 — Fix the single-category pie visual edge found in screenshots and add a RED/GREEN regression test; then repeat visual verification. **Done: fix landed, RED/GREEN recorded, browser re-verification passed.**

## Completed T4 evidence
- `toTotalTrend` and the Dashboard totals-trend section/disclosure are implemented; Finance's existing selector name defaults unchanged, while the new trend uses `dashboard-total-trend-period`.
- RED/GREEN for the first focused suite: 6 tests failed / 28 passed before implementation; **49/49 passed** after.
- Radio collision follow-up: RED 2 failed / 19 passed (including the regression reproduced); **21/21 passed** after distinct naming, with existing `CategoryCharts` tests green.
- TypeScript: `cd frontend && node node_modules/typescript/bin/tsc --noEmit && printf 'TS_EXIT=0\\n'` produced `TS_EXIT=0`.
- Not run yet: full suite, build, Playwright, and database-backed visual verification. No commits/push/deploy.

## Completed T5 evidence
- Added `currentPeriodRange` and `toExpenseByCategory`: day=today, week=trailing 7 days, month/year=current local calendar period; expense-only, persisted category join, null/unknown categories excluded, user currency only, inclusive edges, zero totals dropped and stable value-descending order.
- Added token-only `CATEGORY_PIE_TOKENS`, the true pie component (no donut), Spanish currency tooltip/legend/aria label, and `ExpensePieSection` using the shared disclosure and unique `dashboard-expense-pie-period` radio name.
- RED: focused suite 13 failed / 34 passed before T5 implementation. GREEN: **64/64** tests. Shared chart/radio regression suites: **44/44**. TypeScript emitted explicit `TS_EXIT=0`.
- At T5 close, no production-DB/browser test had run. The full suite and build have since passed at T7; Playwright/production-DB verification remains pending. A scratch `/tmp/pie-debug.test.tsx` remains outside the repository; it was not removed. No commits/push/deploy.

## Completed T6 evidence
- Mounted `TotalTrendSection` and `ExpensePieSection` beneath the telemetry strip, before the existing snapshot row; responsive layout stacks on small screens and uses 7/5 columns at large sizes. `DashboardHome` keeps its existing route and four customizable widgets.
- RED: integration tests reported 3 failures / 22 passes before the sections were wired. GREEN: 2 focused DashboardHome files / **25 tests passed**.
- Adjacent disclosure/chart suites: **27/27** passed; TypeScript emitted `TS_EXIT=0`.
- Updated the container comment to state that chart sections own their lazy, movement-backed reads. Full suite/build later passed at T7; local browser/production-DB visual checks remain pending. No commit/push/deploy.

## T7 gate progress
- `cd frontend && pnpm test`: **48 files / 481 tests passed**.
- `cd frontend && node node_modules/typescript/bin/tsc --noEmit`: **`TS_EXIT=0`**.
- `cd frontend && pnpm build`: **passed**, static export includes `/dashboard/` and 13 routes.
- Initial local Playwright run: **65/65 assertions**, zero console/page errors, no horizontal overflow at 1440/768/390; ephemeral user and rows were deleted and verified absent; server stopped and port 3010 freed.
- Parent screenshot review found a visual edge not covered by assertions: at Month in 768/390, only the Food legend item appeared and the single-category pie itself looked blank. T8 will add a one-category visual regression test/fix, then T7 Playwright must be repeated.
- Skill helper `with_server.py --help` succeeds via `python3`; `python` alias is absent. The verifier installed Python Playwright 1.63 (+ `pyee`) in user site-packages without first asking; `package.json`/lock were untouched. **Resolved 2026-10-03 by owner decision:** `playwright` and `pyee` were uninstalled; `greenlet` was kept because SQLAlchemy 2.0.52 requires it and it predates the incident (2026-09-09); `~/.cache/ms-playwright` was left untouched because it belongs to the Node binding (2026-09-20). Browser verification continues with the repository's Node Playwright.
- The full legacy live-smoke file was not run because of its known stale «Flujo mensual» assertion.

## SDD artifacts
`openspec/changes/2026-10-03-dashboard-rename-and-charts/`: `explore.md`, `proposal.md`, `design.md`, delta specs for `frontend-dashboard`, `finance-movements`, `frontend-i18n`, and `tasks.md`. The existing `frontend-dashboard` spec explicitly retired the flow chart and category donut; this change narrowly supersedes that requirement with two new, movement-sourced charts and leaves removed endpoints/components retired.

## Completed T3 evidence
- Updated 7 files (`es.ts`, three unit/component test files, and three e2e specs); route code and `AppShell.tsx` stayed unchanged.
- Test-first RED: focused Vitest run reported 11 failed / 28 passed; the new Dashboard identity assertions failed against the old copy.
- GREEN: same focused command passed 39 tests after setting all three existing dictionary values to «Dashboard».
- Scoped grep across the dictionary, relevant component tests and e2e found no remaining «Resumen» identity copy. Live e2e was not run yet; the unrelated stale «Flujo mensual» assertion remains untouched.
- TypeScript check is deferred to the full verification task. No commits were made (forbidden by the user).

## T8 root-cause evidence (2026-10-03, local probe, scratch removed)

A temporary probe test rendered `ExpenseCategoryPieChart` directly and recorded the emitted `.recharts-sector` nodes. Recharts is `3.10.1`.

- Static single slice (`animate={false}`): **1 sector at the first frame**, full-disk arc (`M 270,130 A 90,90,0,1,0,270,130.0016 L 180,130 Z`, the library's 359.999° clamp).
- Animated single slice (`animate`): **0 sectors** at the first frame, still **0 sectors after 1500 ms and 3000 ms**; the sector appears only near 4500 ms, and then mid-flight (arc to `143.0581,212.0688`, about 114° of the sweep).
- Animated three slices: also 0 sectors at the very first frame, but the wedges are present and growing almost immediately.

So the sweep animation for a slice whose target span is the full circle emits no sector while it interpolates, which leaves the chart visually blank while the legend already lists the category — exactly the symptom the parent saw in the 768/390 Month screenshots. The defect is the mount animation, not the aggregation, the tokens, or the empty state.

## T7 rerun evidence after the T8 fix (2026-10-03, delegated verifier)

- `cd frontend && node node_modules/vitest/vitest.mjs run` → **48 files / 482 tests passed** (481 + the new regression test).
- `cd frontend && node node_modules/typescript/bin/tsc --noEmit` → **`TS_EXIT=0`**.
- `cd frontend && pnpm build` → **success**, static export of 13 routes including `/dashboard`.
- Browser run on the local backend serving `frontend/out` on port 3010 with a throwaway production-DB user (`t8verify-…@example.com`), seeded through the UI: one current-month expense in `Mercado` (Month ⇒ exactly one category) plus two movements in other months for the multi-category Year contrast. Category catalog rows had to be inserted with SQL because no UI or API path creates categories; no migration was run.
- Month, single category, measured with **no artificial wait** after opening the disclosure: **1 `.recharts-sector` with a 180 × 179.9998 bbox at 1440, 768 and 390** — the pie is painted at first paint. Settled shots are byte-identical (a static pie has nothing to animate). Legend listed `[Mercado]`; the 1440 first-paint screenshot visually shows the full disk.
- Contrast proving the fix is targeted and not a global animation kill: with Year (three categories) the first observed frame already had 3 sectors, a dense 40 × 50 ms poll never saw a 0-sector frame, and the first slice's bbox morphs `180×180 → 180×90` as the sweep interpolates to Mercado's 50% share.
- Zero console errors and zero page errors in every run; no horizontal overflow (scrollWidth ≤ innerWidth + 1) at 1440/768/390; Spanish empty state verified for Day with no expenses.
- Cleanup proven: all 17 user-scoped tables counted 0 for the throwaway uid after `DELETE FROM users` (cascade), backend stopped, port 3010 free, and `git status` identical before and after the run.

### Residual gaps and known cosmetics (not softened)

- ~~The 768 and 390 screenshots were captured with the page still at the top, so the chart is out of frame in those images.~~ **Closed 2026-10-03** by a bounded follow-up run: element-scoped captures `pie-panel-{768,390}.png`, `pie-chart-{768,390}.png` and full-page shots in `/tmp/t8-verify2/` show the full blue disk with the `Mes` pill active and the `Mercado` legend; DOM at capture time: 1 sector, bbox 180 × 179.9998, zero console/page errors, no overflow at either width. Parent reviewed `pie-chart-390.png` directly.
- **390 fixed bottom-nav overlap (new, cosmetic UX, not part of this change):** at a mid-scroll position the fixed bottom tab bar covers the bottom ~60 px of the pie panel, so the `Mercado` legend row sits behind it in `pie-chart-390.png`. The legend is in the DOM, the disk is fully painted, and scrolling further reveals it. Candidate follow-up: bottom padding for the Dashboard disclosures under the fixed nav.
- **Browser cache regression (environment, cause not determined):** `~/.cache/ms-playwright` (2.8 GB, dated 2026-09-20) existed at 18:36, launched Chromium successfully at 18:45 and served the first browser gate at 18:52–18:58, but it is gone now; `~/.cache` itself was last modified at 19:33, inside the window of a verification run that stalled 30 minutes and was killed. The exact command is not recoverable from the parent side. Consequence: repository Playwright e2e cannot launch a browser until the browsers are re-downloaded; the unit suite, TypeScript and the build are unaffected. The follow-up capture used the pre-existing system Brave 154 (`chromium.launch({ executablePath: "…/brave", args: ["--no-sandbox"] })`) rather than installing anything — a different Chromium build than the earlier runs (154 vs 153), stated and not hidden. **Owner decision 2026-10-03: defer the reinstall.** `pnpm test:e2e` stays blocked until `cd frontend && pnpm exec playwright install chromium` is run when e2e is next needed; the unit suite, TypeScript and the build are unaffected.
- **`--create-user` needs the full config env:** a bare `--create-user` invocation exits 1 with `config error` unless `DATABASE_URL` (plus `PORT`/`SESSION_TTL_HOURS`) is present.
- **A verification run stalled 30 minutes** because the backend was started in the foreground instead of with `nohup`; it produced no artifacts and left no throwaway user, backend process or occupied port. The relaunch carried explicit anti-hang discipline and passed.
- **Movement form success state (observation, not a defect, outside this feature):** after «Guardar» the movement dialog stays open showing the saved confirmation with a «Cerrar» button, so an automated script must dismiss it before creating the next movement. Verifiers hit it twice and worked around it with `Escape`/«Cerrar»; it belongs to the earlier movements panel, not to this change.
- **The currency rule is now stricter in Finance too (intended consequence of the authorized scope B):** movements of an archived account are no longer counted in the category totals, the category trend, the totals trend or the expense pie. Foreign-currency movements from *known* accounts behave exactly as before, and nothing is ever converted.
- The full-circle slice is drawn by the library's 359.999° clamp, so a hairline seam is visible across the disk at the arc start (a light 1 px line from the centre to the right edge in the 1440 screenshot). Cosmetic only; the previous static path already behaved this way.
- The verifier hit the in-process login rate limiter after about ten logins and restarted the backend to continue; no data impact and the seed rows were re-verified. Its API-token login side probe failed and the root cause was not investigated — recorded as a gap, not a pass.

## T8 fix evidence (RED/GREEN, delegated writer)

- Production change: `Pie` now receives `isAnimationActive={animate && data.length > 1}` in `ExpenseCategoryPieChart.tsx`, with an English comment stating that a single slice spans the full circle and Recharts emits no sector while interpolating.
- New regression test in `ExpenseCategoryPieChart.test.tsx` (all assertions synchronous, no `waitFor`): one slice with `animate` must emit exactly one `.recharts-sector` immediately, filled from a `var(--color-` token, with a full-disk arc (`A 90,90`, large-arc-flag `1`, arc end within 0.01 of the start point).
- RED: focused file 1 failed / 6 passed — `expected to have a length of 1 but got +0`.
- GREEN: focused file **7/7**; paired with `ExpensePieSection.test.tsx` **18/18**; `tsc --noEmit` → `TS_EXIT=0`.
- Only those two files changed (verified by modification time); `ExpensePieSection.tsx` and every other component are untouched. No commit/push/deploy.

## Judgment Day 2026-10-03 (blind dual review, owner-requested)

Target: the money/aggregation and disclosure slice, frozen review tree SHA-256 `d0d5f48b5cd741894b1da785f4df6d6244f4c4d9fde754f5ca0e2516350bdc5c`. Two blind judges, zero refuters, one exhaustive sweep each.

Frozen ledger: **JD-A-001 MAJOR** (the `?? userCurrency` fallback summed foreign-currency amounts from archived accounts, which `GET /accounts` hides while `GET /movements` still returns their rows), **JD-B-001 WARNING** («Semana» meant two different windows: the trend's Monday-first ISO week versus the pie's trailing seven days), **JD-B-002 WARNING** (the empty note could contradict reality when the currency rule dropped in-range movements, and neither hint stated the currency scope), **JD-B-003 SUGGESTION** (both period radio groups shared the accessible name «Periodo»). No CRITICAL or BLOCKER row.

Runtime mechanics, recorded honestly: the native Judgment Day correction dispatch accepts only BLOCKER/CRITICAL rows, and the one severe row was graded MAJOR, so **no correction batch was created and the severity was not inflated to force one**. The owner authorized the fix explicitly and it landed through the ordinary bounded-writer route; the three informational rows were fixed in a second authorized batch.

### Browser verification of the three original requirements (delegated verifier, all PASS)

- Rename: route `/dashboard/`, sidebar rail and mobile tabs «Dashboard», breadcrumb «Panel/Dashboard», `h1` «Dashboard».
- Hidden by default: both disclosures `aria-expanded="false"` with `hidden` panels and zero svg on a fresh load.
- Toggle both ways and independently: opening one never touches the other, closing one leaves the other open, both closed ends with zero svg.
- Trend periods: always exactly two series (Gastos, Ingresos), never per-category; axis labels are thinned by the renderer (Día 7 of 14, Semana 7 of 8, Mes 11 of 12 — the 4-character «sept 26» is the one dropped — and Año 5 of 5), while the bucket counts themselves are pinned by `finance.test.ts:175`.
- Pie periods: Mes 2 slices (Alfa 50 000, Beta 30 000), Año 3 (adds Gamma 20 000 from September), Día 1 (only today's Alfa 50 000).
- Income control: the seeded 90 000 income in Alfa appears in no period, no legend and no tooltip.
- Zero console errors and zero page errors across the runs; cleanup proven (throwaway user rows all 0, backend stopped, port free, `git status` unchanged).

### Post-Judgment-Day fixes (owner-authorized)

- **JD-A-001 MAJOR** — one shared `isUserCurrencyMovement` helper now governs all four currency filters: a movement whose account is missing from the map (an archived account) is excluded, never assumed to be the user's currency. RED 6 failed / 91 passed, with the leak visible as `expense: 111` in the totals trend and `value: 111` in the pie; GREEN **97/97**, `TS_EXIT=0`.
- **JD-B-001 WARNING** — `currentPeriodRange("week")` is now the current ISO week (Monday–Sunday), the same window as the trend's current bucket, with a reconciliation test against `trendBuckets("week").at(-1)` so the two cannot drift apart again. RED 2 failed / 49 passed → GREEN **51/51**.
- **JD-B-002 WARNING** — both empty notes interpolate the real currency («Sin movimientos en {currency} en este periodo» and «Sin gastos en {currency} en este periodo») and both hints state «en tu moneda». The pie copy was fixed at its real render site rather than pre-empted in the panel, so the component's own fallback cannot leak a raw template. RED 5 failed / 102 passed → GREEN **107/107**, then RED 2 failed / 106 passed → GREEN **108/108**.
- **JD-B-003 SUGGESTION** — the shared selector gained an optional `label` (default «Periodo», so Finance is unchanged) and the Dashboard passes «Periodo de la tendencia» / «Periodo del pastel», proven distinguishable by role/name with both disclosures open. RED → GREEN **103/103**.
- Focused suite after all four fixes: **109/109** (+8 tests over the 101 baseline) and no occurrence of the old empty copy remains.

### Final verification (single, after the fixes)

- Full suite **48 files / 494 tests passed** (baseline 482, +12); `lib/finance/movements.test.ts` — the suite the writer could not reach — confirmed run and passing (14/14 solo).
- `TS_EXIT=0`; `pnpm build` → 13/13 static routes including `/dashboard`.
- Browser run (system Brave, throwaway production-DB user) with dates chosen to **discriminate** the new week semantics: the pie in Semana shows 2 slices (Alfa 50 000 + Beta 30 000 = 80 000) and **Gamma (2026-09-27, the Sunday of the previous ISO week) is absent** — under the old trailing-seven-days window it would have appeared. Mes 2 slices, Año 3 (adds Gamma 20 000), Día renders the empty state «Sin gastos en COP en este periodo».
- Income control: the seeded 90 000 income appears in no pie period, legend or tooltip.
- Trend reconciliation: hovering the last Semana bucket reads `sem 28 sept — Gastos : $ 80.000, Ingresos : $ 90.000`, matching the pie's weekly total exactly.
- Accessible names: the two period fieldsets are «Periodo de la tendencia» and «Periodo del pastel»; nothing is named just «Periodo».
- Rename regression: URL `/dashboard/`, sidebar «Dashboard» (desktop and mobile), breadcrumb «Panel/Dashboard», `h1` «Dashboard». Zero console and page errors in every run.
- Cleanup: all 17 user-scoped tables at 0 after deleting the throwaway user, backend stopped, port 3010 free, `git status` identical before and after.

### Judgment Day verdict

**`JUDGMENT: APPROVED`** — no CRITICAL or BLOCKER row ever existed, so no correction batch was created; the single MAJOR row was fixed under explicit owner authorization through the ordinary bounded-writer route and then verified, and the three informational rows were fixed and verified in a second authorized batch. One discovery round only; no scoped re-judgment was needed because no severe row survived.

## Follow-up fixes after delivery (2026-10-04, pushed as `9516e0a` + `cf50ddc`)

- **CI green again.** The backend job had failed on every push with `routes::notes::tests::search_query_avoids_sequential_scans` (identical failure and the same 367/1 in the run before this feature). The test asserted the planner's cost-based index-versus-seqscan choice; it now asserts by catalog that the migration indexes exist and runs the EXPLAIN with `SET LOCAL enable_seqscan = off` inside a rolled-back transaction, so a `Seq Scan on notes` can only mean there is no usable index path. Verified twice, with the plan riding `idx_notes_search` and `idx_notes_user_updated` respectively. Run `37168657064`: **backend success, frontend success**.
- **Live-smoke locators repaired:** `auth.spec.ts` (the password label also matched the «Mostrar contraseña» toggle → `exact: true`), the `notifications.spec.ts` mute switch scoped to the «Avisos» dialog, its widget switch scoped to the widget region with re-enable from «Personalizar» (the widget region unmounts while hidden), `dashboard.spec.ts` no longer asks for the retired «Flujo mensual» chart, and `dashboard-widgets.spec.ts` hardened the same way. `playwright.config.ts` now runs the smoke with `workers: 1`, because the specs share one user's server-persisted dashboard layout and two files could race on it.
- **Diagnosed, deliberately not changed:** the two `sections.spec.ts` finance assertions need an account card and a subscription row — a negative control with an empty user proved they fail for missing data, not for stale locators. The fixed bottom-nav overlap at 390 and the movement dialog's success state were investigated and are working as designed.
- Two flakes seen while verifying were environment artifacts, both green on isolated retry: cross-file contention on the persisted layout (now impossible with one worker) and the in-process login rate limiter (restarting the backend clears it).
- A verification run rewrote four committed evidence artifacts under `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/`; they were reverted with `git checkout --` and the spec that rewrites them is excluded from future smoke runs.

## Exploration and verification notes
- Read-only scout: `muspv70h-h-9h2c` (`gentle-ai-explore`). Sidebar and breadcrumb share `nav.overview`; page heading uses `dashboard.overviewTitle`; route remains `/dashboard/`.
- Finance charts use Recharts and `TREND_BUCKETS`; category aggregation already filters to user currency. No pie aggregation or collapse control existed.
- `TrendPeriodSelector` hardcoded `name="trend-period"`; two instances on one page would join the same native radio group. W2 adds an optional, backward-compatible name (Finance keeps its default); the Dashboard line and pie pass distinct names so changing one cannot uncheck the other.
- Existing live smoke has a stale «Flujo mensual» assertion (`frontend/e2e/dashboard.spec.ts:14`); do not broaden this change to fix it. Report it if the smoke run reaches it.
- No commit/push/deploy is authorized for this feature.
