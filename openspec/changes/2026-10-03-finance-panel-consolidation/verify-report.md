# Verify report — 2026-10-03-finance-panel-consolidation

- change: `2026-10-03-finance-panel-consolidation`
- phase: verify
- date: 2026-10-03
- delivery: **none** (owner decision: no commit, no push to any branch, no deploy) — the working tree is the deliverable, preserved as `odd/tasks/finance-panel-consolidation-delta.patch` (20 paths including the documentation edit), sha256 `b869f9c64d46055e0f93ea2671bd895b14e8e2c08d6850e4e347d96eac6bd05e`
- verdict: **PASS** — 3/3 requested points implemented and observed live; full gate green; zero console errors; one coupling the request did not mention was found and fixed with its own RED

## 1. Requested points, observed

1. **A single movements panel.** The Finance screen renders exactly one section named «Movimientos» (`col-span-12`) holding, in order: the «Agregar gasto» and «Agregar ingreso» buttons, a hairline separator, the three filters (Cuenta, Categoría, Tipo) and the list. Zero sections named «Agregar movimiento». Both buttons were activated live: they open their modal, Esc closes it and focus returns to the button that opened it (`document.activeElement.textContent === "Agregar gasto"`). The pagination still works inside the merged panel: 5 rows → 7 with the control disappearing, and the first five rows unchanged.
2. **No redundant patrimonio, no live pill.** The read-only `Patrimonio: $X` line is gone from Finance (its `useNetWorth` hook, prop and computation went with it) while the «Activos y patrimonio» card survives. The Resumen strip now reads `CUENTAS · 2 · SUSCRIPCIONES · $ 155.900 · SALDO TOTAL · $ 4.550.000` — the patrimonio KPI and its net-worth read are gone, saldo total stays. The green «Tiempo real» pill is gone from the header (it lived in `AppShell`, visible on every page), and the date and notifications bell that shared that corner still render.
3. **"Suscripciones activas" removed from the Resumen.** The string appears nowhere in the rendered page; «Próximas suscripciones» still renders both seeded subscriptions ordered by due date (`Streaming Panel 2026-10-06`, then `Gimnasio Panel 2026-10-15`); the customize list dropped from 5 rows to 4; the other four widgets and their sections are intact.

## 2. What was verified, and how

| Layer | Command | Result |
|---|---|---|
| Focused suites per unit | `pnpm test <paths>` | W1 30/30 (re-run by the parent), W2 52/52, W3 85/85 across 6 files |
| Full suite | `pnpm test` (from `frontend/`) | **44 files, 423 tests passed**, 0 failed, 0 skipped |
| Types | `node node_modules/typescript/bin/tsc --noEmit` | exit 0, no output |
| Static export | `pnpm build` | exit 0, all 12 routes `○ Static`, `frontend/out/` refreshed 10:51:43 |
| Live UI (Playwright, `@playwright/test` already in the repo — no install) | `/tmp/verify-panel.cjs` against the debug backend on `:3010` serving `frontend/out`, `DATABASE_URL` → production | **32/32 checks PASS**, console errors 0, `pageerror` 0, failed requests 0 |

Live environment: ephemeral user `verify-panel@example.com` created with the backend's one-shot `--create-user`, seeded by `odd/tasks/prod-seed-panel-consolidation.sql` (2 accounts, 2 categories, 7 movements, 2 active subscriptions due in 3 and 12 days). Screenshots in `/tmp/verify-panel/` (1440/768/390 + the merged panel and the chart with a category chosen). Responsive checks pass at 768 and 390.

A second, targeted live run (`/tmp/verify-badge.cjs`) proved the notification fix end to end: with no stored layout — so the **new four-widget default** was in force — the bell read `1 avisos pendientes` and its panel listed `Próximos cobros · Streaming Panel · $ 35.900 · vence 2026-10-06` (the subscription due in 12 days correctly stayed outside the 7-day window). Before the fix this badge counted zero subscription items.

## 3. The coupling the request did not mention

`components/notifications/useNotifications.ts` used the **removed widget's visibility as the gate for subscription notifications** (to fetch subscriptions and to admit subscription items into the badge), and `lib/api/dashboard.ts` listed that id in `DEFAULT_DASHBOARD_LAYOUT`. Because `isWidgetVisible` is `widgets.some(w => w.id === id)`, any layout not listing the id reads as hidden.

Evidence this was real and not theoretical: with the widget deleted but the gate untouched, the notification probe returned `0|0|0` where it must return `1|0|1` — the subscriptions were fetched and then filtered out of the badge. The failure is **latent in the suite** because the stale default layout still listed the id, so the notifications tests kept passing; the RED had to be constructed explicitly with a four-widget layout.

Fixed as its own unit: the id left `DEFAULT_DASHBOARD_LAYOUT` (four widgets, orders 20/22/23/30) and the surviving `upcoming-payments` widget became the only layout signal for those items, with a comment recording why. A user with the new default layout still sees subscription notifications; hiding `upcoming-payments` still silences the category and stops the fetch.

## 4. Delta

- `git diff --shortstat`: **20 files changed, 163 insertions(+), 170 deletions(-)** — the change removes more than it adds (19 code paths plus the `CLAUDE.md` documentation edit).
- Touched: `FinanceScreens.tsx`, `AppShell.tsx`, `DashboardHome.tsx`, `useNotifications.ts`, `lib/api/dashboard.ts`, `lib/dashboard/transforms.ts`, `lib/i18n/es.ts`, `e2e/sections.spec.ts`, `e2e/dashboard.spec.ts`, `e2e/dashboard-widgets.spec.ts`, `e2e/notifications.spec.ts` and their test files; deleted `components/dashboard/widgets/ActiveSubs.tsx`.
- Untracked-by-design paths untouched: `odd/`, `.pi/`, `.codegraph/`, `frontend/AGENTS.md`, `frontend/CLAUDE.md`, `frontend/tsconfig.tsbuildinfo`.
- One documentation-only edit outside the code delta: `CLAUDE.md` gained a **Development rules** section recording the owner's standing instruction to work against the production database (throwaway users, cleanup, and the note that this does not authorize destructive migrations). Easy to revert if the owner prefers it elsewhere.

## 5. Deviations, findings and follow-ups

| Item | Nature | Detail |
|---|---|---|
| The category chart needs a chosen category | **Pre-existing, not this change** | With no category selected the chart shows «Sin movimientos en esta categoría aún» and draws nothing; the live check only reaches a rendered series (2 lines) after selecting one. Worth a product decision: defaulting to the first category would remove a click. |
| Live smoke specs updated but not executed | Reported | `e2e/*.spec.ts` are gated behind `E2E_SMOKE_LIVE=1` and were never run in this session. The four specs that asserted removed UI (Finance patrimonio ×2, Resumen patrimonio, the 5-widget list, the `active-subs` switch) were re-pointed to the new truth and are type-checked by `tsc`, but they are unverified by execution. |
| Pre-existing stale smoke assertion | Reported, untouched | `e2e/dashboard.spec.ts:12` still expects a «Flujo mensual» chart that an earlier change removed. Out of scope here; it will fail if the smoke suite is ever run live. |
| Scratch-named tests are tracked | Reported, untouched | `components/finance/jd-round1.test.tsx`, `components/finance/s1-capture.test.tsx`, `lib/finance/jd-round1.test.ts` keep phase names from earlier sessions. Not orphans, but their names lie about their role. |
| Notification badge unchanged for users who had hidden the widget | Consequence | The removed widget no longer has a privacy/quiet function: subscription items now follow `upcoming-payments`. Recorded in the delta spec, not left implicit. |
| `finance.manageAssets` still says «Activos y patrimonio» | Reported | The line with the number is gone; the heading still names patrimony, which is accurate for the asset list. Renaming it is copy work for the owner. |
| Console/log hygiene | Clean | Zero console errors, zero page errors, zero failed requests across 1440/768/390. |

### The notification fix, end to end

| Layer | Evidence |
|---|---|
| Unit (RED) | with the four-widget layout the probe returned `0|0|0` where it must return `1|0|1` |
| Unit (GREEN) | after re-pointing the gate: `1|0|1`, 85/85 across the six affected files |
| Live | bell = `1 avisos pendientes`; panel = `Próximos cobros · Streaming Panel · vence 2026-10-06`, with the new default layout in force |

## 6. Database hygiene

- Seed: `odd/tasks/prod-seed-panel-consolidation.sql` (project rule: work against production, throwaway data only).
- Cleanup executed: the ephemeral user was deleted with cascade. Post-check: **0** `verify-*` users, **0** accounts/movements/subscriptions named `*Panel*`, **0** orphan movements, and the database back to the owner's own data (2 users, 37 movements).
- The local backend was stopped and port 3010 is closed.

## 7. Judgment day (independent adversarial review)

Two blind judges (`jd-judge-a`, `jd-judge-b`) swept the same frozen target in parallel with identical criteria, and were given the same three project skills to load (`vercel-react-best-practices`, `web-design-guidelines`, `next-best-practices` — skill resolution: `paths-injected`). Target identity: `FinanceScreens.tsx` `fa1ba3c704b04a4e68ae9b360dd54ef5957439df4648c36434b49dad6641a313`, plus `MovementHistory.tsx` `664d67279edfe079a46c6eec83022ea0a2341eb402c352a38600919d27942d97` and `FinanceSections.tsx` `8afd37a2306a83b96a367a85574cb0416fe2ed58a46f16220fd6ee7c61d703ac`.

```yaml
target_identity: fa1ba3c7… + 664d6727… + 8afd37a2…
round: 1
confirmed: []          # no CRITICAL and no WARNING from either judge
suspect: []
contradictions: []
info: 6                # all from judge B, all SUGGESTION; judge A reported zero findings
fix_work_units: []
scoped_rejudgment: not_run
terminal_state: approved
skill_resolution: paths-injected — the three project SKILL.md paths were supplied to both judges
```

**JUDGMENT: APPROVED ✅** — no severe finding was raised, so no correction round was opened and no re-judgment was needed (the method fixes only severe findings confirmed by both judges, at most two rounds).

INFO items, with the causality each judge assigned (none blocks the change):

| # | Item | Causality |
|---|---|---|
| 1 | The «Activos y patrimonio» card has **no empty state**: with zero assets it now renders a bare title, because the removed patrimonio line was its only always-rendered child. Every sibling section uses `EmptyState`. | introduced |
| 2 | The merged panel's **focus return has no automated test**: `finance.test.tsx` asserts the presence of the two controls, not that focus lands on the exact control that opened the modal (`openMovementModal` picks between `expenseBtnRef`/`incomeBtnRef`). Verified manually live, not by the suite. | introduced (inferential) |
| 3 | `MovementHistory` delete confirmation swaps the focused button for confirm/cancel **without focus management** (pre-existing; the same panel uses `openerRef` for the modal). | pre_existing |
| 4 | A **failed delete renders the error twice**, with two `role="alert"` nodes (`confirmingDeleteId` is not cleared in the catch branch). | pre_existing |
| 5 | `AccountBalanceEdit` has **no focus management** when the inline editor opens or closes. | pre_existing |
| 6 | `SectionShell` chrome uses **raw colours** (`bg-[#0f131d]/90`, `border-slate-800/80`, `text-white`, `text-slate-400`) instead of theme tokens, so it ignores the `.light` overrides. | pre_existing |

Items 3–6 are pre-existing and were deliberately left untouched (this change's rules forbid rewriting unmentioned behaviour). Items 1 and 2 are the ones this change introduced, and they are the two follow-ups worth the owner's attention; both are small (an `EmptyState` branch, one focus assertion).
