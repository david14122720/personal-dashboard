# Design — 2026-10-03-finance-panel-consolidation

## Approach

All three points are composition and deletion changes inside existing components. No new component, hook,
endpoint or dependency is introduced, and no data logic changes. The work is therefore split by **file
ownership**, because three of the target files overlap between points:

| Unit | Files owned | Points |
|---|---|---|
| **W1** | `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/layout/AppShell.tsx`, `frontend/lib/i18n/es.ts` | merge the panel, drop the Finance patrimony line, drop the live pill |
| **W2** | `frontend/components/containers/DashboardHome.tsx`, `frontend/components/dashboard/widgets/ActiveSubs.tsx`, `frontend/lib/dashboard/transforms.ts`, `frontend/lib/i18n/es.ts` | drop the strip's patrimonio item, delete the active-subscriptions widget and its transform |

`es.ts` is touched by both, so the two units run **sequentially**, never in parallel.

## D1 — One movements panel (W1)

Replace the two sibling `SectionShell`s (`FinanceScreens.tsx:313-336` and `:337-351`) with a single card:

- `title={t("finance.movementsTitle")}` («Movimientos»), `hint={t("finance.movementsHint")}`, `span="col-span-12"`.
- Children, in this order: the existing buttons row (`<div className="flex flex-wrap gap-2">` with both refs and
  classes untouched) and then `<MovementHistory …>` with the same props as today.
- The card must read as one panel: controls on top, the history below separated by a hairline
  (`border-t border-hull/60`) with vertical breathing room, using existing token classes only.
- **The accessible name stays `Movimientos`** because `finance.test.tsx:166` and the sections e2e locate the
  region by that name; the removed card is the one named «Agregar movimiento».
- The controls MUST NOT move inside `MovementHistory`'s loading/error/empty branches: they stay mounted in
  every state (a failed history must not block adding a movement).
- Keys `finance.addMovementTitle`/`finance.addMovementHint` (es.ts:177-178) lose their only consumer → delete.

## D2 — Finance loses the read-only patrimony line (W1)

`S5Sections` (`FinanceScreens.tsx:399-417`) currently renders `<p>Patrimonio: {…}</p>` at `:415`. Remove that
line and the plumbing that exists only for it: the `netWorth` prop at `:353`, the parameter at `:399`, the
`worth` computation at `:402`, the `useNetWorth()` call at `:204` and its import. `dashboard.netWorth` stays
in the dictionary: Reports (`ReportsScreens.tsx:123`) and Progress (`ProgressScreens.tsx:142`) still render it.

The card's title ("Activos y patrimonio", `finance.manageAssets`) is **not** changed: the assets are patrimony,
so the heading still describes what is left. Renaming it is copy work for the owner, reported as a follow-up.

## D3 — No live pill (W1)

Delete the decorative pill in `AppShell.tsx:268-278` (the source comment already says there is no live feed).
Its label `nav.live` (es.ts:16) loses its only consumer → delete. The header keeps breadcrumb, search, date and
notifications bell.

## D4 — The strip drops patrimonio (W2)

In `DashboardHome.tsx`, remove the `{ id: "net-worth", … }` item from `strip` (`:153`) and the wiring that
exists only for it: the `useNetWorth()` call (`:110`), its import, its participation in `telemetryLoading`
(`:129`) and `telemetryError` (`:132`), and `worthEntry`/`netWorthValue` (`:143-145`). `fmt` and `toNumber`
stay (other items use them). The remaining strip is: cuentas, suscripciones, saldo total.

Owner's decision, recorded: the patrimony display is removed in **both** places where it appeared, so this and
D2 are one product decision, not two.

## D5 — "Suscripciones activas" disappears (W2)

- `DashboardHome.tsx`: remove the `active-subs` widget block (`:252-261`), its import (`:11`) and its
  `customizeRows` entry (`:163`) — the toggle row would otherwise control a widget that does not exist.
- Delete `frontend/components/dashboard/widgets/ActiveSubs.tsx`.
- Delete `toActiveSubs` (`frontend/lib/dashboard/transforms.ts:361`) and its test block
  (`transforms.test.ts:245`): the widget was its only consumer.
- Delete keys `dashboard.activeSubs`/`dashboard.activeSubsHint` (es.ts:67-68).
- **Not** touched: `lib/api/dashboard`'s `useSubscriptions` (also feeds `UpcomingPayments` and notifications),
  `UpcomingSubs`, `finance.noSubscriptionsHint`, and every other subscriptions surface.

### D5b — The coupling the request did not mention (W3)

The removed widget was also the **visibility gate for subscription notifications**:
`components/notifications/useNotifications.ts:21,27` asks `isWidgetVisible(layout, "active-subs")` both to
fetch subscriptions and to admit subscription items into the badge, and `lib/api/dashboard.ts:61` lists that
id in `DEFAULT_DASHBOARD_LAYOUT`. Because `isWidgetVisible` is `widgets.some(w => w.id === id)`, any layout
that does not list the id reads as hidden. Deleting the widget without touching this would silently drop
every subscription notification for any user whose persisted layout was saved from the new UI (and for
everyone once the default layout stops listing it). Verification of this is non-obvious: the notifications
suite keeps passing after W2 precisely because the stale default still lists `active-subs`, so W3 must
construct the RED explicitly with a four-widget layout.

W3 therefore owns: drop the id from `DEFAULT_DASHBOARD_LAYOUT` (and its "5-widget" docstring), make the
surviving `upcoming-payments` widget the only layout signal for subscription items, update
`lib/api/dashboard.test.ts:71` (default layout) and `lib/i18n/i18n.test.ts:36` (four widget titles), and
re-point the live-smoke specs that assert removed UI.

## D6 — Test strategy

Test-first applies where a behaviour is observable and a RED is meaningful:

- **RED then GREEN**: a component test asserting the merged panel (one region named «Movimientos» holding both
  entry controls and the history, and no «Agregar movimiento» region) and a widget test asserting the home
  renders no «Suscripciones activas» and no patrimonio strip item. Both fail before the change.
- **Rewrite parity tests**: assertions that count widgets, toggles or strip items move from 5 KPIs/5 widgets to
  3 KPIs/4 widgets, keeping their intent (the toggle round-trip, the stale-entry tolerance).
- **Removal assertions**: the strip must no longer request or render net worth; a persisted `active-subs` layout
  entry must still be ignored silently (the existing stale-entry test is re-pointed at the new removed id).
- No test is deleted except the blocks that only exercised `toActiveSubs`, whose subject is removed.

## D7 — Verification

1. Focused suites per unit, then the full suite, `tsc --noEmit` and `pnpm build` (static export).
2. Playwright against the local server pointed at the **production DB** with an ephemeral user (rule of the
   project from today): merged panel visible with both buttons working and the list inside it; no «Tiempo
   real» pill; Finance without the patrimony line; Resumen with «Próximas suscripciones», without
   «Suscripciones activas» and without the patrimonio KPI; console clean at 1440/768/390.
3. Judgment day over one important component (chosen after the change lands): the Finance screen container
   (`FinanceScreens.tsx`), the piece that carries the merge and the removal, with the project's frontend skills
   passed to both judges.

## Risks

| Risk | Mitigation |
|---|---|
| Merging removes the region name the tests/e2e rely on | Keep the title `Movimientos`; the removed region name is only asserted by tests we update |
| Add controls become unreachable when the history errors | Controls stay outside the history's state branches; explicit scenario and test |
| Deleting the subscriptions widget breaks notifications or the weekly payments widget | Both use `lib/api/dashboard`'s hook, which is untouched; the transform deleted is the widget-only one |
| A KPI removal leaves a dangling fetch on the home | The net-worth hook is removed with the item; the e2e/test asserts the home renders without it |
