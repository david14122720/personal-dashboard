# Proposal — 2026-10-04-ui-polish-responsive

## Why

The owner reports that the app **looks broken on a phone** and asks for a visual polish pass over all five areas (Dashboard, Finanzas, Productividad, Configuración, Login) with mobile as the priority. Reconnaissance (`explore.md`) confirms it with arithmetic, not taste:

- the mobile bottom bar holds **seven** items whose min-content is ≈539px inside a ≈386px viewport;
- the monthly calendar needs **332px** of grid inside the ≈311px a 375px phone leaves it;
- the movement, transfer and balance dialogs have **no height cap and no scroll containment**, so they clip on a phone;
- two chart panels render at a **fixed 560px/360px** width inside a scroll box, so they are cut or scrolled on every phone;
- four forms use `grid-cols-2` with **no small-screen fallback**, and two definition lists squeeze long es-CO dates into half a phone;
- touch targets drop to **16–26px** (login eye toggle, remember checkbox, widget toggles, view tabs);
- the same visual role is rendered **five different ways** (card shells), section titles split between `text-base` and `text-lg`, primary buttons come in four flavours, inputs in three, and five surfaces show a bare hint where every other surface shows a real empty state.

All of it is presentation. Nothing here needs a behaviour, route, logic or data change — and none is proposed.

## What changes

### P1 — Token and surface foundation
Add `--color-panel` / `--color-panel-soft` to `@theme` so the sixteen raw `bg-[#0f131d]`/`bg-[#171b26]` call sites become token-based, and collapse the five card-shell variants into one canonical shell (`rounded-xl border border-hull bg-panel/90 p-4 sm:p-5`).

### P2 — Shell and mobile navigation
Keep all seven destinations, laid out as two rows of four and three at ≥44px per item, with `env(safe-area-inset-bottom)` padding and `main` re-padded for the taller bar. Top bar, rail and skip link are untouched.

### P3 — Dashboard
Canonical cards, one section-title rank, compact chips raised to 36px, consistent skeletons, and a real entrance on the disclosures that already exist.

### P4 — Finanzas
Charts scale to their container instead of scrolling, dialogs gain a height cap, scroll containment and a body scroll lock, forms stack on phones, and movement rows/badges leave the 10px floor.

### P5 — Productividad
The calendar fits a 375px screen (flexible cells, tighter gaps, legible counts) without losing its 44px row height, its day detail or its disclosure behaviour.

### P6 — Configuración
Canonical cards and titles, real empty states in every settings section, controls with hover and focus states, and stacked definition lists on phones.

### P7 — Login
Touch-sized password toggle and remember row, a field style that matches the app, and the same token palette.

## Decisions taken before implementation

1. **No functional change, including navigation.** The bottom bar keeps all seven destinations; the cheaper-looking alternative (a five-item bar) would orphan `/dashboard/ajustes/tokens/` on mobile because the Ajustes hub links only to sessions. This is recorded in `design.md` and re-offered to the owner at close.
2. **No new abstraction.** Canonical class strings are applied in place; no `Card`/`Button` component, no new dependency, no CSS-in-JS.
3. **No redesign.** The Control Deck language (palette, type stack, radii, keyframes) is kept exactly; only drift inside it is removed.
4. **i18n is additive.** Four new empty-state titles; zero existing copy changes.
5. **The only intended test edit** is the calendar day cell's `min-w-[44px]` → `min-w-0` (needed to fit 375px, with `min-h-[44px]` preserved). Everything else that fails is a regression.
6. **Habits, Progreso and Reportes are out of scope**, except where they consume a shared primitive that is normalised.

## Impact

| Layer | Files touched (approx.) | Nature |
|---|---|---|
| Tokens | `frontend/app/globals.css` | additive tokens + canonical utilities |
| Shell | `components/layout/AppShell.tsx` | mobile bar geometry, main padding |
| Shared primitives | `ui/TelemetryStrip.tsx`, `ui/WidgetToggle.tsx`, `ui/EmptyState.tsx`, new `ui/useContainerWidth.ts` | canonical surface/controls, measurement hook |
| Dashboard | `containers/DashboardHome.tsx`, `dashboard/DashboardDisclosure.tsx`, `dashboard/widgets/*` | shells, titles, chips |
| Finanzas | `containers/FinanceScreens.tsx`, `finance/MovementForms.tsx`, `finance/MovementHistory.tsx`, `finance/CategoryCharts.tsx`, `finance/CategoryTrendChart.tsx`, `finance/AssetForms.tsx`, `finance/TrendPeriodSelector.tsx` | shells, dialogs, charts, forms |
| Productividad | `productivity/ProductivityCalendar.tsx`, `productivity/ProductivitySections.tsx`, `containers/ProductivityScreens.tsx` | calendar fit, chips, skeletons |
| Configuración | `app/dashboard/ajustes/page.tsx`, `ajustes/sesiones/page.tsx`, `ajustes/tokens/page.tsx`, `settings/*Section.tsx` | shells, empties, lists |
| Login | `app/login/page.tsx` | touch targets, field style |
| Copy | `lib/i18n/es.ts` | four additive keys |

Review workload: a wide but shallow diff — most hunks are one-line class strings. No backend, no migration, no route, no data.

## Non-goals

- No new component library, no dependency, no design-token overhaul, no dark/light rework.
- No new screen, route, navigation entry, or reachability change.
- No behaviour change in charts, filters, transfers, calendar, forms, focus traps, persistence or the API contract.
- No accessibility rework beyond keeping what exists (focus visibility, aria, 44px targets).
- No cleanup of dead code (`ui/MetricCard.tsx`) or of adjacent areas (Habits, Progreso, Reportes).

## Verification

`pnpm test` + `tsc --noEmit` + `pnpm build`, then a live stack (backend + `frontend/out`, production database, throwaway user) driven by Playwright with the system Brave at **1440×900** and **390×844** over the five areas, the three dialogs and the expanded calendar, asserting per viewport: no horizontal overflow, every control ≥44px (chips ≥36px), no console error. Closes with a two-reviewer Judgment Day and an owner-facing summary of the mobile fixes.
