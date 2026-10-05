# Design — 2026-10-04-ui-polish-responsive

## Intent

The product already has a design language: **Control Deck** — dark-first, blue/cyan signal, `@theme` tokens in `frontend/app/globals.css`, `font-display` (Plus Jakarta Sans) for structure, `font-body` (Inter) for prose, `label-caps` for eyebrows, `.tnum` for figures, 44px controls in the newest surfaces. This change is a **polish pass**: it removes drift inside that language and makes it survive a 375px viewport. No new aesthetic direction, no new component library, no new dependency, no behaviour change.

Two rules govern every edit:

1. **One role, one look.** Each visual role (page title, section card, row, primary button, ghost button, field, pill, empty state) gets exactly one canonical class string, and every call site uses it.
2. **Tokens over palette literals.** Where a colour is needed, use an `@theme` token; add a token rather than repeat a hex.

## Token additions (`frontend/app/globals.css`)

```css
--color-panel: #0f131d;        /* the de-facto card/topbar/rail surface, used raw in 16 places */
--color-panel-soft: #171b26;   /* == --color-elevated; alias so call sites stop using hex */
```

No other token changes. Palette, type stack, radii, shadows and keyframes stay as they are.

## Canonical visual contract

Every value below is the exact class string a call site must use. `p-4 sm:p-5` is deliberate: 16px of card padding at 375px buys 8px per side for content that is squeezed today.

| Role | Canonical classes | Replaces |
|---|---|---|
| Page title `h1` | `font-display text-2xl font-semibold tracking-wide` | already uniform — keep |
| Page subtitle | `mt-1 text-sm text-slate-400` | `/60`, `/70`, `text-slate-400` mix |
| Section card (shell) | `rounded-xl border border-hull bg-panel/90 p-4 sm:p-5` | 5 variants (see `explore.md` §2) |
| Section card (tight, telemetry) | `rounded-xl border border-hull bg-panel/60 p-4` | keep shape, token colour |
| Hero card (login only) | `rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-2xl sm:p-9` | `bg-slate-900/80 p-7` |
| Section title `h2` | `font-display text-base font-medium tracking-wide` | `text-lg` in Configuración |
| Row (list item) | `rounded-lg border border-hull px-3 py-2` | already uniform — keep |
| Primary button | `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-signal px-4 font-display text-sm font-semibold text-deck transition-colors hover:bg-signal-soft disabled:cursor-not-allowed disabled:opacity-50` | 4 flavours |
| Ghost / secondary button | `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hull px-3 font-display text-sm text-instrument-dim transition-colors hover:border-signal hover:text-signal` | 2 flavours (one without hover/focus) |
| Icon button | `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-panel-soft hover:text-signal` | 26px eye toggle, inert icons |
| Field (input/select/date) | `min-h-11 w-full rounded-md border border-hull bg-deck px-3 text-sm text-instrument transition-colors placeholder:text-slate-500 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/30` | 3 flavours, one with no focus state |
| Pill / tab | `inline-flex min-h-11 items-center justify-center rounded-lg border border-hull px-3 font-display text-xs transition-colors hover:border-signal hover:text-signal` | `min-h-11` vs none vs 26px |
| Compact chip (card-header toggle only) | `inline-flex min-h-9 items-center justify-center rounded-md border border-hull px-3 text-xs transition-colors hover:border-signal hover:text-signal` | 22–26px toggles |
| Empty state | the shared `components/ui/EmptyState.tsx` (`role=status`, dashed, `min-h-32`), title + optional hint | 5 hint-only surfaces |
| Reveal motion | `animate-fade-in motion-reduce:animate-none` on content that appears (disclosure panel, day detail, dialog card) | no entrance today |

**Type floor.** Data text is ≥11px (`text-[11px]`); secondary prose is ≥12px (`text-xs`); no `text-[10px]` remains on a value a person must read (badges, dates, counts). `label-caps` (11px) is the only sanctioned 11px structural style.

**Touch floor.** Interactive controls are ≥44px tall (`min-h-11`), except compact chips inside card headers, which are ≥36px (`min-h-9`). Never shrink a control to make a layout fit; shrink padding, gaps or label size instead.

**Focus.** Rely on the global `:focus-visible` outline (`globals.css` `@layer base`); never remove it, never replace it with a ring that only exists on hover.

**Motion.** Only the declared `--animate-*` keyframes, only on reveal, never on layout, never on scroll. `prefers-reduced-motion` is already forced to 0.01ms globally — no per-component guard is required beyond keeping `motion-reduce:*` classes where tests assert them.

## Mobile geometry (the arithmetic that must hold)

| Fix | Before | After | Check at 375px |
|---|---|---|---|
| Bottom bar | 7 items in one `justify-around` row, min-content ≈539px | `grid grid-cols-4 gap-y-0.5` (two rows of 4+3), item `min-h-11 px-1`, label `text-[11px]`, `pb-[env(safe-area-inset-bottom)]` | cell ≈ 89px, label `Productividad` ≈74px → fits; `main` gains `pb-32 md:pb-10` for the taller bar |
| Calendar grid | `gap-1` + day cell `min-w-[44px]` → 332px min-content | `gap-0.5 sm:gap-1`, day cell `min-h-[44px] min-w-0`, day number `text-xs sm:text-sm`, counts `text-[11px]` | available ≈ 375−32 (main) −32 (card p-4) = 311px; cells flex to ≈42px wide, 44px tall → no overflow |
| Charts | fixed `width={560}` / `width={360}` inside `overflow-x-auto` | measure the container (`ResizeObserver`, fallback to today's number when unmeasurable, e.g. jsdom) and pass the measured width | chart renders at ≈311px wide, legible, no in-panel scroll |
| Modals | `max-w-md p-5`, no height cap, no scroll lock | `max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-4 sm:p-5` + body scroll lock while open; actions `flex-col sm:flex-row` (DOM order unchanged) | the 7-field modal scrolls inside itself; the page behind cannot scroll |
| Two-column forms | `grid-cols-2` with no fallback (`SubscriptionsSection.tsx:199,282`, `AssetForms.tsx:75,140`) | `grid-cols-1 gap-3 sm:grid-cols-2` | one field per line, full width |
| Definition lists | `dl grid grid-cols-2` (`sesiones/page.tsx:152`, `tokens/page.tsx:242`) | `grid grid-cols-1 gap-1 sm:grid-cols-2` | long es-CO dates no longer wrap in a 150px column |

## Guardrails (asserted today — do not rename, reorder or drop)

- `AppShell`: `aria-current="page"`, `aria-label={t("nav.primary")}`, skip link, `id="main-content"`.
- `DashboardDisclosure` trigger: keep the 44px + focus-visible class list (`DashboardDisclosure.test.tsx:76-79`).
- `ProductivityCalendar`: keep `min-h-[44px]` on the month nav buttons, `data-marker` attributes, panel ids, `motion-reduce:transition-none` on the day panel; the **only** intended test edit is the day cell's `min-w-[44px]` → `min-w-0`.
- `ProductivitySections.rowActionClass` and `MovementHistory` action buttons: keep the 44px ghost string.
- `MovementHistory` rows: keep `data-direction`, `border-signal` on the selected row, `data-testid="movement-transfer-badge"`.
- `TelemetryStrip` LEDs: keep `bg-signal` / `bg-alert`.
- `productivity.test.tsx`: keep `.grid.grid-cols-12`, `col-span-12`, and exactly five `.animate-pulse` blocks in the loading state.
- `MovementForms`: keep `role="dialog"`, `aria-modal`, the label texts, the focus-trap order and `data-testid="movement-modal-overlay"`.
- Login: keep `id="login-heading"`, `login-email`, `login-password`, `login-remember`, the aria-labels and `role="alert"`.
- Tokens/Sessions pages: keep the accessible names `Crear token`, `Copiar`, `Eliminar: <name>`.
- e2e: no horizontal overflow at 390/768/1440; every productivity control ≥43.5px; at 390 inputs equal the form width; `xl:` spans sum to 12.

## Decisions

1. **The bottom bar keeps all seven destinations.** A five-item bar would be prettier but would leave `/dashboard/ajustes/tokens/` unreachable on mobile (the Ajustes hub links only to sessions — `ajustes/page.tsx:30-38`), which is a functional change. Two rows of four and three is pure layout and keeps every destination one tap away.
2. **No new abstraction layer.** Canonical strings are applied in place; a shared `Card`/`Button` component would be a refactor, and the owner asked for polish. `design.md` is the single source of truth for the strings.
3. **i18n stays additive.** Empty states may reuse existing keys; where a title is missing (bank accounts, custom categories, subscriptions, sessions) one new key per surface is added to `frontend/lib/i18n/es.ts`. No existing copy changes.
4. **`rounded-2xl` stays exclusive to the login hero**, `rounded-xl` for in-app cards: a deliberate one-off, documented instead of flattened.
5. **Charts scale, they do not scroll.** `overflow-x-auto` stays as a safety net but the measured width makes it inert.

## Verification strategy

1. `cd frontend && pnpm test` (vitest, 50 files) and `pnpm exec tsc --noEmit` after every workstream; `pnpm build` before the live pass.
2. Live stack: `pnpm build` → backend on `PORT=3000` with `STATIC_DIR=frontend/out` against the production database (throwaway user created with `--create-user`, deleted at the end; every row cascades from `users(id)`).
3. Playwright (system Brave) at **1440×900** and **390×844** over: login, dashboard, finance, productivity (calendar collapsed and expanded), ajustes, ajustes/sesiones, ajustes/tokens, plus the movement, transfer and balance modals. Per viewport: full-page screenshot, `scrollWidth <= clientWidth` assertion, touch-target audit (`getBoundingClientRect` on every button/input/select), and the console error log.
4. Judgment Day: two blind reviewers over the five areas at both viewports, then a final owner-facing summary.

## Risks

- Live measurement is blocked while the production database is down; the fixes above are arithmetic, not observations. Every one of them is re-measured before closing.
- Test churn is limited to the calendar cell class and any new empty-state assertion; anything else that fails is treated as a regression, not a test to edit.
