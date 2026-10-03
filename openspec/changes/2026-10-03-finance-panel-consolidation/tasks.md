# Tasks — 2026-10-03-finance-panel-consolidation

- status: `ready_for_apply`
- delivery: none (owner: no commit, no push, no deploy — review in local)

## W0 — SDD artifacts (parent)

- [ ] W0.1 — explore.md with the read-only map (done, `explore.md`)
- [ ] W0.2 — proposal.md with the owner's scope decision (both patrimony displays)
- [ ] W0.3 — delta specs for `frontend-dashboard`, `dashboard-widgets`, `finance-movements`, `frontend-i18n`
- [ ] W0.4 — design.md (file-ownership split, decisions D1–D7) and this task list

## W1 — One movements panel, no Finance patrimony line, no live pill

Owns `FinanceScreens.tsx`, `AppShell.tsx`, `es.ts`.

- [ ] W1.1 — RED: component test for the merged panel (one region «Movimientos» with both entry controls and the history inside it; no «Agregar movimiento» region)
- [ ] W1.2 — Merge the two `SectionShell`s into one full-width card titled «Movimientos», controls on top, history below behind a hairline
- [ ] W1.3 — Remove the read-only patrimony line from the assets card and the `netWorth` plumbing that existed only for it
- [ ] W1.4 — Remove the header's green «Tiempo real» pill
- [ ] W1.5 — Delete the orphaned keys `finance.addMovementTitle`, `finance.addMovementHint`, `nav.live`
- [ ] W1.6 — Focused suite green for the touched files + `tsc --noEmit`

## W2 — Resumen drops patrimonio and the active-subscriptions widget

Owns `DashboardHome.tsx`, `ActiveSubs.tsx` (delete), `transforms.ts`, `es.ts`.

- [x] W2.1 — RED: widget test asserting no «Suscripciones activas» section and no patrimonio strip item
- [x] W2.2 — Remove the net-worth strip item and the net-worth read that existed only for it
- [x] W2.3 — Remove the active-subscriptions widget, its import and its customize-list row
- [x] W2.4 — Delete `ActiveSubs.tsx`, `toActiveSubs` and the keys `dashboard.activeSubs`/`dashboard.activeSubsHint`
- [x] W2.5 — Update the parity tests (strip 3 items, 4 widgets/toggles, stale `active-subs` layout entry ignored)
- [x] W2.6 — Focused suite green for the touched files + `tsc --noEmit`

## W3 — Notifications stop depending on the removed widget

Owns `lib/api/dashboard.ts`, `lib/api/dashboard.test.ts`, `components/notifications/useNotifications.ts`, `components/notifications/__tests__/notifications.test.tsx`, `lib/i18n/i18n.test.ts`, `e2e/*` parity.

- [x] W3.1 — RED: prove that with the default four-widget layout subscription notifications vanish (the removed widget was their visibility gate)
- [x] W3.2 — Drop `active-subs` from `DEFAULT_DASHBOARD_LAYOUT` and from the notification gates; the surviving `upcoming-payments` widget is the only layout signal
- [x] W3.3 — Update `lib/api/dashboard.test.ts` (default layout) and `lib/i18n/i18n.test.ts` (4 widget titles)
- [x] W3.4 — Re-point the live-smoke specs that assert removed UI (`e2e/sections.spec.ts`, `dashboard.spec.ts`, `dashboard-widgets.spec.ts`, `notifications.spec.ts`)
- [x] W3.5 — Focused suite green for the touched files + `tsc --noEmit`

## Close (parent-owned)

- [x] C1 — Full suite + `tsc --noEmit` + `pnpm build` (static export refreshed)
- [x] C2 — Playwright in local against the production DB (ephemeral user, deleted afterwards): merged panel working, no «Tiempo real», no patrimony in Finance, Resumen with only «Próximas suscripciones», console clean at 1440/768/390
- [x] C3 — Judgment day over the Finance screen container, two blind judges: **APPROVED ✅** in round 1 (judge A zero findings; judge B six SUGGESTIONs, no severe), no correction round
- [x] C4 — `verify-report.md`, feature doc and Engram mirror updated, summary delivered to the owner
