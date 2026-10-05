# Explore — 2026-10-04-ui-polish-responsive

Read-only reconnaissance for a **visual polish + responsive pass** over the five areas (Dashboard, Finanzas, Productividad, Configuración, Login). No behaviour, route, logic or data change. Mobile (~375–414px) is the priority; desktop ~1440px second.

Owner request (2026-10-04): «Pulir la interfaz de toda la aplicación (visual y responsive), sin tocar funcionalidad, priorizando que la versión móvil deje de verse mal/desalineada.»

## 0. Orchestrator resolutions

- **Method**: SDD artifacts first (this file, `proposal.md`, `design.md`, `tasks.md`, three capability deltas), then implementation by workstream, then live verification at 1440/390, then a Judgment Day review of the five areas.
- **Rules in force**: no commit, no push, no deploy (local review only); no new dependencies; production database for any live data (`CLAUDE.md`).
- **Environment blocker (2026-10-04, 01:20 UTC)**: the production database `192.168.50.120:5434` refuses TCP connections (host answers ICMP; port closed, 3 attempts). Owner decision: continue with code work and verify live once the port answers again. No local Postgres was started.
- **Playwright**: `@playwright/test@1.63.0` is installed in `frontend/`; the ms-playwright browser cache is absent, so live checks launch the **system Brave** (`/var/lib/flatpak/app/com.brave.Browser/current/active/files/brave/brave`) with `--no-sandbox`. No browser download, no new dependency.
- **Static export**: `frontend/` builds with `pnpm build` (`output: 'export'`), API base defaults to `/api` (`frontend/lib/api/client.ts:37`), so the local stack is `backend` + `STATIC_DIR=frontend/out` on one origin.

## 1. Surface inventory (five areas)

| Area | Route | Container | Shared primitives |
|---|---|---|---|
| Dashboard | `frontend/app/dashboard/page.tsx:11` | `components/containers/DashboardHome.tsx` (`DashboardHomeShell`) | `ui/TelemetryStrip`, `ui/WidgetToggle`, `ui/EmptyState`, `dashboard/DashboardDisclosure` |
| Finanzas | `app/dashboard/finance/page.tsx:11`, `finance/compare/page.tsx:120` | `containers/FinanceScreens.tsx` | `ui/EmptyState` |
| Productividad | `app/dashboard/productivity/page.tsx:11` | `containers/ProductivityScreens.tsx` | `ui/EmptyState`, `dashboard/DashboardDisclosure` |
| Configuración | `app/dashboard/ajustes/page.tsx:24`, `ajustes/sesiones/page.tsx:31`, `ajustes/tokens/page.tsx:27` | none (inline `AppShell` + `max-w-3xl` column) | `ui/EmptyState` **not used** |
| Login | `app/login/page.tsx:117` | the page is the container (no `AppShell`) | none |

Shell: `components/layout/AppShell.tsx` (rail ≥ `md`, bottom tab bar < `md`, `main` padding at `:325`).

## 2. Consistency deviations (evidence)

**Card shells — five variants for one role.** `rounded-xl border-slate-800/80 bg-[#0f131d]/90 p-5` at `FinanceSections.tsx:22`, `ProductivitySections.tsx:175`, `DashboardHome.tsx:95`, `ajustes/page.tsx:32`, `BankAccountsSection.tsx:77`, `CustomCategoriesSection.tsx:59`, `sesiones/page.tsx:100`, `tokens/page.tsx:132/164/206`; `rounded-xl border-hull bg-deck/60 p-5` at `DashboardDisclosure.tsx:26`; `rounded-xl border-hull p-5` (no surface) at `SubscriptionsSection.tsx:74,85`; `rounded-xl border-slate-800/80 bg-[#0f131d]/60 p-4` at `TelemetryStrip.tsx:23`; `rounded-2xl border-white/10 bg-slate-900/80 p-7 sm:p-9 shadow-2xl` at `login/page.tsx:133`. Inner rows are already uniform (`rounded-lg border border-hull px-3 py-2`). Unused utilities `.deck-panel`/`.deck-panel-focus` exist at `globals.css:87-99`.

**Raw hex outside tokens.** `bg-[#0f131d]` (10 call sites), `bg-[#171b26]` (== `--color-elevated`, 6 sites), `bg-slate-900/80`, `border-slate-800/80` (== `--color-hull`). `frontend-dashboard` requires components to consume tokens, not raw hex.

**Section heading rank.** `text-base` in `SectionShell`/`WidgetShell`/`DashboardDisclosure` (`FinanceSections.tsx:23`, `ProductivitySections.tsx:176`, `DashboardHome.tsx:97`, `DashboardDisclosure.tsx:29`) vs `text-lg` in every Configuración card (`BankAccountsSection.tsx:81`, `SubscriptionsSection.tsx:92`, `CustomCategoriesSection.tsx:57`, `tokens/page.tsx:133`). Page `h1` is already uniform (`font-display text-2xl font-semibold tracking-wide`); subtitle tone splits `/60`, `/70`, `text-slate-400`.

**Controls.** Primary buttons appear in four flavours (`FinanceScreens.tsx:356` 44px + focus ring; `DashboardHome.tsx:173` `text-xs` no 44px; `login/page.tsx:253` gradient + `active:scale`; `tokens/page.tsx:178` opacity-only transition, no hover). Ghost buttons split between 44px + focus (`ProductivitySections.tsx:23`, `MovementHistory.tsx:276-306`, `SubscriptionsSection.tsx:26`) and 32px without focus (`BankAccountsSection.tsx:16`, `CustomCategoriesSection.tsx:16`). Pills: `TrendPeriodSelector.tsx:9` (`min-h-11`) vs `PeriodSelector.tsx:9` (no min) vs `ProductivitySections.tsx:80,116` (~26px). Inputs: app standard `rounded-md bg-deck focus:border-signal` (no ring) vs login `rounded-xl focus:ring-2` vs `tokens/page.tsx:190,200` (**no focus class at all**).

**Empty states.** Real `EmptyState` (`role=status`, dashed, `min-h-32`) in every Finance, Productivity and Dashboard list/aggregate; **plain hint text only** at `BankAccountsSection.tsx:155`, `CustomCategoriesSection.tsx:82`, `SubscriptionsSection.tsx:106`, `sesiones/page.tsx:139`, `tokens/page.tsx:229` (that one has a real empty *title* key already: `es.ts:677-678`), and the calendar's empty month is a bare `<p role="status">` (`ProductivityCalendar.tsx:219`).

**Motion.** Disclosure reveals by flipping `hidden` (`DashboardDisclosure.tsx:35`) with no entrance; the calendar day panel carries `transition-opacity motion-reduce:transition-none` with no opacity change (`ProductivityCalendar.tsx:301`); modals have no entrance. `--animate-fade-in`/`--animate-slide-up` are declared at `globals.css:48-49` and used nowhere.

## 3. Mobile risk register (375–414px)

| # | Path:line | Offending | Why it breaks |
|---|---|---|---|
| 1 | `AppShell.tsx:199` + `NAV_ITEMS` (`:153`) | `flex flex-row justify-around`, **7** items, `px-3`, `text-[11px]` | min-content ≈ 539px (`Dashboard` 75 + `Finanzas` 70 + `Productividad` 98 + `Hábitos` 64 + `Ajustes` 64 + `Tokens de API` 98 + `Sesiones` 70) vs ~386px available at 390px: the row cannot shrink below min-content, so the bar overflows / squeezes. Nothing measures this outside the productivity route |
| 2 | `ProductivityCalendar.tsx:231` + `:35` | `grid-cols-7 gap-1`, day cell `min-w-[44px]` | 7×44 + 6×4 = 332px min-content vs ~311px available at 375px (main `px-4` + card `p-5`): in-panel overflow **when expanded**; the e2e no-overflow assertion never opens the calendar |
| 3 | `MovementForms.tsx:220,228`, `:509,517` | dialog `max-w-md p-5`, **no `max-h`**, no `overflow-y-auto`, no body scroll lock | the 7-field movement modal and the transfer modal clip on a 390×640 viewport or landscape; the page behind keeps scrolling |
| 4 | `SubscriptionsSection.tsx:199,282`, `AssetForms.tsx:75,140` | `grid grid-cols-2 gap-3` with **no `sm:` fallback** | at 375px each field ≈ 140px: date/select + label cramped; `productivity-layout` already requires one field per line at 390px for its own forms |
| 5 | `CategoryTrendChart.tsx:58` / `ExpenseCategoryPieChart.tsx:46` | fixed `width={560}` / `width={360}` inside `overflow-x-auto` | in-panel horizontal scroll on every phone; the chart is cut or scrolled instead of scaling |
| 6 | `login/page.tsx:213` (eye toggle ≈26px), `:231` (checkbox 16px) | sub-40px touch targets | hard to hit with a thumb; the remember row is the only clickable area |
| 7 | `WidgetToggle.tsx:12`, `NotificationList.tsx:20`, `ProductivitySections.tsx:80,116` | `px-2 py-1 text-xs` / `px-3 py-1 text-xs` ≈ 22–26px | dense inline controls below any touch minimum |
| 8 | `sesiones/page.tsx:152`, `tokens/page.tsx:242` | `dl grid grid-cols-2` (flex only ≥ `sm`) | long es-CO dates wrap inside two narrow columns at 375px |
| 9 | `MovementHistory.tsx:255` (`text-[10px]`), `ProductivityCalendar.tsx:275,281` (`font-mono text-[10px]`), `ProductivitySections.tsx:277,482` (`text-[11px]`) | data rendered at 10–11px | real values (dates, counts, badges) below the legibility floor |

**Positive evidence (do not regress).** No `whitespace-nowrap` anywhere; long names/amounts already truncate (`FinanceScreens.tsx:135-137`, `FinanceSections.tsx:43-46`, `AppShell.tsx:247`); topbar date and inert search are already `hidden md:` (`AppShell.tsx:268,274`); `main` already reserves `pb-24` for the bottom bar (`AppShell.tsx:325`).

## 4. Test coupling (what a visual pass must not break)

| Surface | Assertion | File |
|---|---|---|
| Bottom bar / any route | no horizontal overflow at 390/768/1440 | `e2e/productivity-layout.spec.ts:334` |
| Productivity controls | every control ≥43.5×43.5 | `e2e/productivity-layout.spec.ts:350-354` |
| Productivity forms at 390 | each select/date input width == form width | `e2e/productivity-layout.spec.ts:343-349` |
| Productivity grid | `xl:` spans sum to 12 | `e2e/productivity-layout.spec.ts:337` |
| Disclosure trigger | className keeps 44px + focus-visible ring | `DashboardDisclosure.test.tsx:76-79` |
| Calendar cells/nav | `min-h-[44px]`, day panel keeps `motion-reduce:transition-none`, `data-marker` contract | `ProductivityCalendar.test.tsx:310-318,177-191` |
| Skeletons | exactly 5 `.animate-pulse` + `.grid.grid-cols-12` + `col-span-12` | `productivity.test.tsx:346,405-407` |
| Telemetry LEDs | `bg-signal` / `bg-alert` | `ui/TelemetryStrip.test.tsx:24-25,38-39` |
| Movement rows | `data-direction`, transfer badge testid, row `border-signal` | `MovementHistory.test.tsx:336-337` |
| Modals | `role=dialog`, label texts, focus-trap order, overlay testid | `MovementForms.test.tsx:242-248,439-445` |
| Login | `id="login-heading"`, `login-email`, `login-password`, `login-remember`, `role=alert` | `e2e/guards.spec.ts:10`, `login` tests |
| Configuración | accessible names `Crear token`, `Copiar`, `Eliminar: cli` | `tokens` tests |

## 5. Risks

1. **Blind styling**: the DB outage blocks live measurement, so every mobile number in §3 is min-content arithmetic, not a rendered observation. Mitigation: implement the fixes that are provably correct (fit arithmetic, touch sizes, scroll containment), then measure live before closing.
2. **Test churn**: the calendar's `min-w-[44px]` cell assertion must change to `min-w-0` to let the grid fit at 375px; that is the only intended test edit, and it is a class-string change with the behaviour (no overflow, ≥44px tall) preserved.
3. **Nav surface**: the bottom bar keeps all seven destinations (no reachability change) at the cost of a second row; the alternative (a five-item bar plus a Tokens card in the Ajustes hub) is a functional change and is therefore offered to the owner, not taken.
4. **jsdom vs browser**: chart width must fall back to today's fixed number when no layout is measurable, or the chart tests lose their `<svg>`.

## 6. Non-binding

- Habits, Progreso and Reportes are adjacent surfaces that share the same shells and modal pattern; they are **out of the owner's five areas** and stay untouched except where a shared primitive (card shell, control, empty state) is normalised.
- `ui/MetricCard.tsx` is imported nowhere; deleting it is a cleanup outside a visual pass.
