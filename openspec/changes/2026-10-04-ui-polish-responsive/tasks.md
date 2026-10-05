# Tasks — 2026-10-04-ui-polish-responsive

- status: `verified_local`
- delivery: none (owner: no commit, no push, no deploy — local review only)
- commands: frontend commands run from `frontend/`; live stack from the repo root
- ODD: P1–P7 are the ODD units; P0 (these artifacts) and P8 (verification + Judgment Day) are bookends
- guardrail: every canonical string, touch floor and asserted class list is in `design.md` — follow it literally

## P0 — SDD artifacts

- [x] P0.1 — `explore.md`: five-area inventory, consistency deviations, mobile risk register, test coupling, risks
- [x] P0.2 — `proposal.md`: why, P1–P7, decisions, impact, non-goals, verification
- [x] P0.3 — `design.md`: token additions, canonical visual contract, mobile geometry arithmetic, guardrails, decisions
- [x] P0.4 — Three capability deltas (`frontend-visual-system` added, `frontend-dashboard` and `productivity-layout` extended)
- [x] P0.5 — This task list

## P1 — Tokens and surface foundation

- [x] P1.1 — Add `--color-panel` and `--color-panel-soft` to `@theme` and normalise raw-hex surfaces to tokens
  - route: implementer (frontend)
  - files: `frontend/app/globals.css`
  - acceptance: both tokens exist in `@theme` with the documented values; no `@theme` token is renamed or removed; the canonical utility class(es) documented in `design.md` exist; `pnpm test` and `pnpm exec tsc --noEmit` stay green
  - evidence — `pnpm test`, `tsc --noEmit`

## P2 — Shell and mobile navigation

- [x] P2.1 — Make the mobile bottom bar fit 375px with all seven destinations and 44px items
  - route: implementer (frontend)
  - files: `frontend/components/layout/AppShell.tsx`
  - acceptance: the tab bar is a `grid-cols-4` two-row layout with `min-h-11` items, `text-[11px]` labels, no truncation of `Productividad`/`Tokens de API`, `pb-[env(safe-area-inset-bottom)]`; `main` reserves `pb-32 md:pb-10`; `aria-current`, `aria-label={t("nav.primary")}`, the skip link and `id="main-content"` unchanged; rail and top bar untouched; no destination removed
  - evidence — live measurement at 375/390 (bar `scrollWidth <= clientWidth`), screenshot

## P3 — Dashboard

- [x] P3.1 — Canonical surfaces, one title rank, touch-sized chips and consistent skeletons
  - route: implementer (frontend)
  - files: `frontend/components/containers/DashboardHome.tsx`, `frontend/components/dashboard/DashboardDisclosure.tsx`, `frontend/components/dashboard/widgets/*.tsx`, `frontend/components/ui/TelemetryStrip.tsx`, `frontend/components/ui/WidgetToggle.tsx`
  - acceptance: every card uses the canonical shell (telemetry the tight variant); section titles are `text-base`; widget toggles are ≥36px with hover; disclosure panels reveal with `animate-fade-in motion-reduce:animate-none` while the trigger keeps its asserted 44px + focus-visible class list; skeletons match the Finance/Productivity pulse pattern; LED classes `bg-signal`/`bg-alert` preserved; widget visibility behaviour, keys and persisted layout untouched
  - evidence — `pnpm test`, live screenshots at both viewports

## P4 — Finanzas

- [x] P4.1 — Charts scale to the container instead of scrolling
  - route: implementer (frontend)
  - files: `frontend/components/ui/useContainerWidth.ts` (new), `frontend/components/finance/CategoryTrendChart.tsx`, `frontend/components/finance/CategoryCharts.tsx`
  - acceptance: both charts take their width from a measured container with a `ResizeObserver`, falling back to today's literal (560 / 360) whenever measurement is unavailable so jsdom keeps rendering an `<svg>`; no in-panel horizontal scroll at 390px; legends/labels legible at ≈310px; chart data, series, tooltips and empty states unchanged; no literal hex colour
  - evidence — `pnpm test` (chart tests keep passing), live measurement at 390 (chart box `scrollWidth <= clientWidth`)

- [x] P4.2 — Dialogs fit a phone and cannot be scrolled behind
  - route: implementer (frontend)
  - files: `frontend/components/finance/MovementForms.tsx`
  - acceptance: movement, transfer and delete dialogs use `max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-4 sm:p-5`, lock the body while open and restore it on close, and stack their actions with `flex-col sm:flex-row` **without changing DOM order**; `role="dialog"`, `aria-modal`, the overlay testid, label texts and the focus-trap order are unchanged; the balance dialog gets the same treatment
  - evidence — `pnpm test` (dialog tests), live check at 390: dialog `getBoundingClientRect().height <= viewport`, `document.body` scroll locked while open

- [x] P4.3 — Finance shells, forms, rows and badges
  - route: implementer (frontend)
  - files: `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/finance/MovementHistory.tsx`, `frontend/components/finance/AssetForms.tsx`, `frontend/components/finance/TrendPeriodSelector.tsx`, `frontend/components/finance/CategoryCharts.tsx`
  - acceptance: canonical cards and title rank; `AssetForms` two-column grids become `grid-cols-1 sm:grid-cols-2`; `TrendPeriodSelector` pills ≥44px with hover; movement rows keep `data-direction`, the transfer badge testid and the selected-row `border-signal`, and no data text below 11px; empty states unchanged
  - evidence — `pnpm test`, live screenshots

## P5 — Productividad

- [x] P5.1 — The calendar fits 375px without losing its grid contract
  - route: implementer (frontend)
  - files: `frontend/components/productivity/ProductivityCalendar.tsx`, `frontend/components/productivity/ProductivityCalendar.test.tsx`
  - acceptance: grid `gap-0.5 sm:gap-1`; day cells `min-h-[44px] min-w-0`; month nav keeps `min-h-[44px]`; day numbers `text-xs sm:text-sm`; counts `text-[10px] sm:text-[11px]`; the empty month uses the shared `EmptyState` with the existing copy; `data-marker` contract, panel ids, `motion-reduce:transition-none` and the day-detail behaviour unchanged; the only test edit is the day cell's `min-w-[44px]` → `min-w-0`
  - evidence — `pnpm test`, live measurement at 375/390 with the calendar expanded (`scrollWidth <= clientWidth`), screenshot

- [x] P5.2 — Productivity shells, chips, skeletons and day detail
  - route: implementer (frontend)
  - files: `frontend/components/productivity/ProductivitySections.tsx`, `frontend/components/containers/ProductivityScreens.tsx`, `frontend/components/productivity/ProductivityForms.tsx`
  - acceptance: canonical cards and titles; view tabs ≥44px with hover; due-date and pinned badges leave the 11px floor for 12px; skeleton pulse pattern preserved with exactly five blocks and `.grid.grid-cols-12`/`col-span-12` intact; `rowActionClass` keeps its asserted 44px string; creation forms keep `grid-cols-1 sm:grid-cols-2` and their labels
  - evidence — `pnpm test`, live screenshots

## P6 — Configuración

- [x] P6.1 — Cards, titles, empty states and controls in the settings surfaces
  - route: implementer (frontend)
  - files: `frontend/app/dashboard/ajustes/page.tsx`, `frontend/app/dashboard/ajustes/sesiones/page.tsx`, `frontend/app/dashboard/ajustes/tokens/page.tsx`, `frontend/components/settings/BankAccountsSection.tsx`, `frontend/components/settings/CustomCategoriesSection.tsx`, `frontend/components/settings/SubscriptionsSection.tsx`, `frontend/lib/i18n/es.ts`
  - acceptance: canonical cards and `text-base` titles; every list surface renders the shared `EmptyState` (bank accounts, custom categories, subscriptions, sessions, tokens) with the existing copy plus at most one new title key per surface; ghost buttons gain hover + focus + 44px; token inputs gain the canonical field style with a focus ring; `SubscriptionsSection` two-column grids become `grid-cols-1 sm:grid-cols-2`; the sessions/tokens definition lists stack below `sm`; accessible names `Crear token`, `Copiar`, `Eliminar: <name>` unchanged; no copy removed
  - evidence — `pnpm test`, live screenshots at both viewports

## P7 — Login

- [x] P7.1 — Touch-sized login controls and app-consistent field styling
  - route: implementer (frontend)
  - files: `frontend/app/login/page.tsx`
  - acceptance: the password toggle is ≥44×44 with a hover state; the remember row is ≥44px tall and still toggles the checkbox; the submit button is ≥44px; fields use the canonical field style; the hero card uses the token surface with `p-6 sm:p-9`; `id="login-heading"`, `login-email`, `login-password`, `login-remember`, aria-labels and `role="alert"` unchanged; no auth behaviour touched
  - evidence — `pnpm test`, live screenshots at both viewports

## P8 — Verification and close

- [x] P8.1 — Suites and build: `pnpm test` (50 files), `pnpm exec tsc --noEmit`, `pnpm build`
- [x] P8.2 — Live pass at 1440×900 and 390×844 over the five areas, three dialogs and the expanded calendar: no horizontal overflow, control-size audit, console clean, screenshots archived
- [x] P8.3 — Regression check that no functionality moved: transfers, movement filters, dashboard widget persistence, calendar day detail, forms CRUD, session revoke, token create/copy/delete
- [x] P8.4 — Judgment Day: two blind reviewers over the five areas at both viewports; findings triaged and fixed or recorded
- [x] P8.5 — Owner-facing summary of the visual changes with emphasis on the mobile fixes

## Verification evidence (2026-10-05, live stack, throwaway user)

- Suites: `pnpm test` → **50/50 files, 568/568 tests**; `pnpm exec tsc --noEmit` → exit 0; `pnpm build` → static export OK.
- Live measurements (system Brave, `@playwright/test` core, production database, throwaway user `polish-qa@local.test`):
  - **bottom bar**: 375px → before `scrollWidth 534 / clientWidth 375` (clipped), after `375/375`, 7 destinations, 2 rows, 44px items; 390px → `390/390`.
  - **charts**: before `inner 560 (trend) / 360 (pie)` inside 301–340px panels → in-panel scroll at 375/390/414/768; after `inner == wrapper` (309/324/301/316) → fits everywhere.
  - **dialogs**: movement modal at 390×640 → `358×608` (exactly `100dvh − 2rem`), `body.overflow = hidden`; transfer modal `358×558`; the balance panel is an inline editor (no dialog, no lock — deliberate).
  - **calendar**: before `panelScroll 312/309` at 375 (3px inner overflow); after `309/309` and `324/324`, cells 42.4×44 and 44.6×44.
  - **overflow**: zero document overflow on all 7 routes × 1440/390 with the calendar expanded; **console errors: none**.
  - **remaining sub-36px controls** (all deliberate): sr-only skip link `1×1`, login remember checkbox `16×16` inside a ≥44px label, trend-period radios `13×13` inside ≥44px labels.
- Functional regression (`/tmp/verify/regression.mjs`, final build): **16/16** — modal create `POST /api/movements → 201`, transfer `201` with exact debit/credit deltas, one ledger row with `transfer_account_id`, calendar 42 cells + day detail, `Tipo=transfer` filter isolating transfer rows with badges, token create/list/delete, sessions list/revoke, no console errors.
- Judge review: see `judgment-day.md`.
