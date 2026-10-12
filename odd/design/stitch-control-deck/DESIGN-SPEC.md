# Control Deck — design spec for `rediseno-integral-responsivo`

Source of truth = the 10 Stitch prototypes in `odd/design/stitch-control-deck/html/` (downloaded 2026-10-11 from Stitch project `projects/13900739064191642738`). **Read the HTML you are porting; this file only fixes the decisions, the token mapping and the pitfalls.**

## Canonical reference per surface

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Shell chrome + IA | `dashboard-desktop.html` (`aside` L72, `header` L175) | `dashboard-mobile.html` (header L3, bottom nav L364) |
| Resumen / Dashboard | `dashboard-desktop.html` (body L234-670) | `dashboard-mobile.html` (body L4-358) |
| Finanzas | `finanzas-desktop.html` (body) | `finanzas-mobile.html` |
| Productividad | `productividad-desktop-v2.html` (body) | `productividad-mobile.html` |
| Hábitos | `habitos-desktop.html` (body **only**) | `habitos-mobile.html` |
| Login | `login-desktop.html` | — |
| Delta reference only | `productividad-desktop-v1.html` | — |

## Decisions (do not relitigate per surface)

- **D1 canonical shell**: shell + IA always from `dashboard-desktop.html`. The `habitos-desktop.html` sidebar (Panel Principal / Rastreador de Hábitos / Tareas y Proyectos / Finanzas / Notas / Configuración) and the `finanzas-desktop.html` sidebar footer ("Enlace Cuántico", `v4.8.2-prod`) are **divergent generations and are ignored**.
- **D2 IA is not invented**: real IA = **Plataforma**: `Resumen / Dashboard`, `Finanzas`, `Productividad`, `Hábitos` (with `3 activos` chip) · **Sistema**: `Tokens de API`, `Preferencias`. This matches `dashboard-desktop.html` exactly. No new routes. Labels that only exist in divergent prototypes (`Movimientos`, `Inicio`, `Tareas`, `Bloc de notas`, `Panel Principal`, `Notas`, `Configuración`) never become routes.
- **D3 icons are inline SVG**: Material Symbols names (`space_dashboard`, `bolt`, `check_circle`, `account_balance_wallet`, `key`, `tune`, `code`, `terminal`, `visibility`, `verified_user`, `help_outline`, `person`, `more_vert`) are mapped to equivalent inline SVG paths in the existing icon style (`AppShell.tsx:11-137`). No icon-font dependency, no CDN `<script>`, no new npm package.
- **D4 no git**: nothing is committed or pushed. Work stays in the working tree.
- **D5 verification**: per task → focused vitest + `node node_modules/typescript/bin/tsc --noEmit` + Playwright screenshots at 390/768/1440 reviewed by the parent. One full Judgment Day at the end.
- **D6 prod DB only**: `postgres://pdbuser:***@192.168.50.120:5434/pdbname`. Local app = backend on `:3000` serving `frontend/out`. Throwaway user `e2e-*@example.com` for e2e, deleted at close. Never create/init/migrate a local DB.
- **D7 palette unification**: the prototypes use two nearly identical dark palettes. Rule: **elements that exist on desktop use the desktop `deck.*` palette** (now the repo's `deck`/`panel`/`card`/`hair` family) — that is the canonical visual language for every shared surface; **mobile-only chrome** (bottom tab bar, mobile header, per-habit day strips) may use the Material-3 family that the repo already carries with the mobile prototype's exact hexes (`container`, `container-high`, `container-highest`, `panel`). Never add a second token for a color the repo already holds, and never let the *same* element change color only because the breakpoint changed. `deckStyles.listRow` is the desktop row, `listRowMobile` is the mobile-branch row — they are different markup, not one element with two colors.
- **D11 real labels win**: group headers adopt the design (`Plataforma`, `Sistema`), but the app's real nav labels stay (`Dashboard`, `Finanzas`, `Productividad`, `Hábitos`, `Ajustes`, `Tokens de API`, `Sesiones`). The prototype's `Resumen / Dashboard` and `Preferencias` are generation artifacts; a settings hub called Ajustes that holds accounts, subscriptions, categories, tokens and sessions is not renamed to match a thumbnail.
- **D8 charts**: the prototypes draw hand-authored SVG. Real data + tooltips + responsiveness beat hand-drawn geometry, so **charts that already use Recharts keep Recharts** and are restyled through `frontend/components/ui/chartTheme.ts` (colors, dashed grid, hidden axis lines, card-colored tooltips, glow on the primary series) to read like the prototype. A chart that was already hand-rolled before this redesign stays hand-rolled — `WeeklyChart.tsx`, `HabitsHeatmap` and the old `FlowChart` were never Recharts, so "keep Recharts" does not apply to them and claiming it did is a spec error, not a defect. Chart colors are read from CSS variables at runtime, so **never rename an existing `--color-*` token** — add new ones instead.
- **D9 light mode is out of scope**: `.light` only overrides 3 tokens today and nothing writes `localStorage["dashboard-theme"]`. Keep the dark-first result correct and do not spend effort on light parity; just do not make it worse.
- **D10 real data, honest omissions**: every panel renders real data from existing hooks. A card the app has no data for renders the prototype's empty state, never fake numbers.

## Token mapping (`frontend/app/globals.css`)

Prototype palette (`dashboard-desktop.html:13-36`) → repo token. **Add** the missing ones; do not rename existing ones.

| Prototype | hex | Repo token | Action |
| --- | --- | --- | --- |
| `deck.bg` | `#0a0e18` | `--color-deck` (currently `#0b0f19`) | align to `#0a0e18` |
| `deck.surface` | `#0f1422` | `--color-panel` (currently `#0f131d`) | align to `#0f1422` |
| `deck.card` | `#151a28` | *(new)* `--color-card` | add |
| `deck.cardHover` | `#1a2133` | *(new)* `--color-card-hover` | add |
| `deck.border` | `#1f273d` | *(new)* `--color-hair` | add |
| `deck.borderLight` | `#2a3552` | *(new)* `--color-hair-strong` | add |
| `deck.cyan` | `#38bdf8` | `--color-signal` | exists |
| `deck.emerald` | `#10b981` | `--color-flow` is `#22c55e`; mobile uses `#2ccb63` | keep `flow` for badges/positive text; `#10b981` only where the prototype's icon tile needs it |
| `deck.amber` | `#f59e0b` | `--color-warn` | exists |
| `deck.muted` | `#64748b` | `--color-faint` | exists |
| `deck.text` | `#94a3b8` | `--color-muted` | exists |
| `deck.white` | `#f8fafc` | `--color-instrument` | exists |

Utilities to add in `@layer utilities` (exact CSS from `dashboard-desktop.html:39-69`, `login-desktop.html:30-39`, `dashboard-mobile.html:3`):
`.glow-cyan-sm` (`0 0 15px -3px rgba(56,189,248,.25)`), `.glow-cyan-btn` (`0 0 20px -2px rgba(56,189,248,.4)`), `.custom-scrollbar` track `#0f1422` / thumb `#1f273d` / hover `#2a3552` (6px), `.margin-safe` helpers for `env(safe-area-inset-*)`, and `overscroll-behavior:none` on body. `.bg-grid-pattern` already exists with the login prototype's exact values — reuse it.

Type scale + spacing to add as `@theme` tokens so ported class names resolve verbatim (from the prototypes' config):
`--text-display-lg` 40/48/-0.02em/700 · `--text-headline-xl` 32/40/-0.02em/700 · `--text-headline-xl-mobile` 24/32/-0.01em/700 · `--text-headline-lg` 24/32/-0.01em/600 · `--text-headline-md` 20/28/-0.01em/600 · `--text-metric-val` 28/32/-0.02em/700 · `--text-body-lg` 16/24/400 · `--text-body-md` 14/20/400 · `--text-body-sm` 12/16/0.01em/400 · `--text-label-lg` 14/20/0.01em/600 · `--text-label-md` 12/16/0.02em/500 · `--text-label-caps` 11/14/0.08em/700.
Spacing: `--spacing-space-xs` .25rem · `-sm` .5rem · `-md` 1rem · `-lg` 1.5rem · `-xl` 2rem · `--spacing-gutter` 1.25rem · `--spacing-gutter-desktop` 1.5rem.

## Shell chrome (canonical, from `dashboard-desktop.html`)

Sidebar `w-64`, `hidden md:flex`, sticky, `h-screen`: brand block (cube SVG in a `h-9 w-9 rounded-lg bg-sky-500/10 border border-sky-500/30` tile with `glow-cyan-sm`, wordmark `Control Deck` + `v2.4` mono badge + subline `Centro de Mando`) → group header `Plataforma` → nav items → group header `Sistema` → nav items → footer user card (avatar initials in a `from-sky-500 to-indigo-600` gradient circle, name + email, `Cerrar sesión` ghost icon button) → `p-4 border-t border-deck-border`.
Active nav item: `bg-sky-500/10 border border-sky-500/30 text-deck-white` + sky label + right `w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]`. Idle: `text-slate-400 hover:text-deck-white hover:bg-deck-card`.
Topbar: `h-16 sticky top-0 z-20` with `bg-deck-bg/80 backdrop-blur-md border-b`, containing breadcrumb (`Panel › <current>`), search (`hidden sm:block`, placeholder `Buscar métricas, transacciones... (Ctrl+K)` + `⌘K` kbd), date pill (`hidden lg:flex`), `Avisos` button with amber ping + count pill, primary CTA `Registrar actividad`.

Mobile chrome (from the four mobile files, identical): fixed top bar (`h-14`, brand chip + `v2.4` pill + notification count + avatar + overflow menu) and a **fixed bottom nav with 5 items**: `Deck` · `Finanzas` · `Enfoque` · `Hábitos` · `Ajustes`, each `w-14 h-12` column with a 22px glyph and a `label-caps` label; active = `text-primary-container font-semibold` + `aria-current="page"`.
**Known current defect**: `AppShell.tsx` mobile tabs use `basis-1/4` with 7 items and wrap into two rows — replace with the 5-item design.

## Per-surface pointers

- **Resumen**: header (h1 + subtitle + `Sincronización activa` pill) → 4 KPI tiles (`Cuentas`, `Suscripciones`, `Saldo Total`, `Gasto del Ciclo`, each with a mono uppercase label + icon chip, a `text-2xl font-bold font-mono` value, and a footer note) → `lg:grid-cols-12` with `Gastos vs. ingresos` (Día/Semana/Mes/Año pills + SVG area chart + legend) / `Últimos movimientos` / `Hoy` on the left (`col-span-7`) and `Gastos por categoría` (donut) / `Próximas suscripciones` / `Próximos pagos` on the right (`col-span-5`) → footer bar with latency + region.
- **Finanzas**: header + 4 KPI tiles → left `col-span-7`: `Cuentas` (3-col grid of account tiles), `Movimientos Recientes` (Cuenta/Categoría/Tipo filters + rows), 2 media cards → right `col-span-5`: `Suscripciones`, `Gastos e Ingresos por Categoría` (select + period pills + area chart), `Accesos Rápidos`.
- **Productividad**: header + 2 status chips → collapsible calendar → 4 KPIs (`TASA DE CUMPLIMIENTO`, `TAREAS ACTIVAS`, `METAS EN CURSO`, `EVENTOS DE HOY`) → 2-col grid: `Metas`, `Eventos y Agenda` (pills `TODOS/HOY/PRÓXIMOS/VENCIDOS`), `Tareas` (pills incl. `COMPLETADAS`), `Notas y Bitácora` (search + note cards with `#tags`).
- **Hábitos**: hero + KPI row + tabs/legend + month matrix with streak and success columns, plus `HabitHistorySection` heatmap and evolution chart. Desktop body only from `habitos-desktop.html`.
- **Login**: single card, top gradient hairline, hexagon logo tile, `Control` + gradient `Deck` wordmark, `v1.4 Enterprise` badge, two fields (`Correo electrónico o ID de usuario`, `Contraseña maestra` + visibility toggle), `Recordar sesión en este equipo` + `¿Olvidaste tu clave?`, gradient CTA `Iniciar sesión`, `o autenticar con` divider, `Passkey` / `Token CLI` buttons, security footer, page footer links. Fields keep the real login flow and real error/pending states. **No real passkey/CLI auth exists** — those buttons must not fake a login; render them disabled/inert with an honest note, or omit them (decide in favour of not inventing behavior).

## Pitfalls found in the prototypes (do not copy blindly)

1. `py-0.2` (`dashboard-desktop.html:221`) is invalid Tailwind — use `py-[0.1rem]`.
2. `shadow-sky-500/30` without a `shadow-<size>` class contributes nothing — the primary CTA wants `shadow-lg shadow-sky-500/30`.
3. `dashboard-desktop.html` has no `dark:` variants although `darkMode:'class'` is set; theming is unconditional.
4. The desktop prototypes have **no mobile chrome at all** below `md` — the mobile files are an independent shell, so mobile needs a real component branch, not just breakpoints.
5. The desktop chart's y-axis labels (`36 k … 0`) do not match its annotated peak `$ 34.100`; the chart is hand-authored and not to scale. With real data, keep the axis honest.
6. Version strings conflict across prototypes (`v2.4` vs `v1.4 Enterprise`). **Resolved**: the brand version badge is part of the design and stays, but its *value* must be the app's real version taken from `frontend/package.json` (`0.1.0`), never a prototype's `v2.4` or `v1.4 Enterprise`. One module-level constant in `frontend/lib/i18n/es.ts` feeds both `nav.brandVersion` and `login.version`, and `frontend/app/login/page.test.tsx:91` (which asserts `v1.4`) moves with it. Tracked as T7's work; flagged by the T2 verifier as F2 and again by the T5a verifier, which correctly noticed that this pitfall contradicted the sidebar spec above (the shell spec does prescribe the badge).
7. Period labels differ (`Semana` vs `Sem`); the app already has a period control — keep its real state and labels.
8. Donut caps differ (butt vs round) — pick round cap for the mobile variant only if the same component draws both.

## Test fragility (update in lockstep, never delete an assertion to make a redesign pass)

Class-string assertions: `frontend/app/dashboard/habitos/page.test.tsx:268,273,277,541,722` (`bg-signal`, `bg-hull/60`, `bg-black/40`, `text-[#4ADE80]`), `dashboard/DashboardDisclosure.test.tsx:76-79`, `productivity/ProductivityCalendar.test.tsx:310-322`, `productivity/productivity.test.tsx:407` (`col-span-12`), `finance/MovementHistory.test.tsx:336` (`border-signal`), `ui/TelemetryStrip.test.tsx:24,25,38,39`.
`data-testid` contracts: `movement-modal-overlay`, `transfer-modal-overlay`, `movement-transfer-badge`, `p8-badge`, `dynamic-chart`, `total-trend-chart`.
A11y-name contracts (break if copy changes): region/heading names `Metas/Tareas/Eventos/Notas`, `getByRole("grid",{name:"Rastreador de Hábitos"})`, switch names matching `/upcoming-payments/`, `#login-heading`.
`frontend/e2e/productivity-layout.spec.ts` already asserts, at 390/768/1440, no horizontal overflow, ≥44px hit areas and `xl` column spans — it is a usable responsive gate, but it rewrites 4 tracked files under `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` on every run (`git checkout --` them afterwards, and never commit anything here).

## Local run recipe (already verified working)

```bash
cd frontend && pnpm build            # static export -> frontend/out (~17 s)
cd backend && DATABASE_URL='postgres://pdbuser:<DB_PASSWORD>@192.168.50.120:5434/pdbname' \
  PORT=3000 SESSION_TTL_HOURS=720 STATIC_DIR='<repo>/frontend/out' RUST_LOG=info \
  ./target/debug/personal-dashboard-backend
# login: e2e-<stamp>@example.com / <E2E_USER_PASSWORD>   (see /tmp/e2e-user.env)
```
