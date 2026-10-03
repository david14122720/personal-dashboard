# Explore — 2026-10-03-finance-panel-consolidation

Read-only map gathered before the proposal (frontend only; backend/API untouched).

## 1. The two Finance panels to merge

| Element | Location |
|---|---|
| Finance page entry | `frontend/app/dashboard/finance/page.tsx:13` → `FinanceScreensShell` (`frontend/components/containers/FinanceScreens.tsx:421`) |
| Grid parent | `FinanceScreens.tsx:258` `<div className="mt-6 grid grid-cols-12 gap-6">` |
| "Agregar movimiento" panel | `FinanceScreens.tsx:313-336` — `SectionShell title={t("finance.addMovementTitle")}` `:314`, hint `:315`, `span="col-span-12 md:col-span-6 xl:col-span-6"` `:316`; inline `<div className="flex flex-wrap gap-2">` `:317` with both buttons `:318-335` (refs `expenseBtnRef`/`incomeBtnRef`, keys `finance.addExpense`/`finance.addIncome`) |
| "Movimientos" panel | `FinanceScreens.tsx:337-351` — `title={t("finance.movementsTitle")}` `:338`, hint `:339`, same span `:340`, child `<MovementHistory …>` `:342-350` |
| Panel chrome | `frontend/components/finance/FinanceSections.tsx:12-26` — `<section aria-label={title}>` `:20`, `<h2>` `:21`, hint `<p>` `:22`, children `:23`. **The `region` role used by tests comes from here.** |
| History internals | `frontend/components/finance/MovementHistory.tsx` — filters grid `:130`, three labelled selects Cuenta/Categoría/Tipo `:133-174`, loading `role="status"` `:105`, errors `role="alert"` `:115`/`:194`, window of 5 + "Ver más" |

Neighbouring panels in the same grid (untouched): Cuentas `:287-300`, Suscripciones `:301-312`, `CategoryChartSection` `:352`, `S5Sections` `:353` (definitions `:399-417`).

## 2. Patrimony and the live pill

Both requested removals are real and independently confirmed by the owner:

- `dashboard.netWorth` ("Patrimonio", `es.ts:694`) appears in **two** places that must go:
  - `DashboardHome.tsx:153` — telemetry strip item `{ id: "net-worth" }`, the only screen where it sits beside `dashboard.totalBalance` ("Saldo total") at `:156`.
  - `FinanceScreens.tsx:415` — read-only line inside the "Activos y patrimonio" panel, fed by `netWorth` prop `:353`, param `:399`, `worth` `:402`, query `useNetWorth()` `:204`.
- The key stays alive after both removals: `ReportsScreens.tsx:123` and `ProgressScreens.tsx:142` still consume it.
- `nav.live` ("Tiempo real", `es.ts:16`) has exactly **one** consumer: the green pill in `frontend/components/layout/AppShell.tsx:268-278` (header, visible on every page), whose own comment reads `no live feed yet`. No test asserts it.

## 3. "Suscripciones activas" vs "Próximas suscripciones"

Composed side by side in the Resumen General (`frontend/components/containers/DashboardHome.tsx`):

| Section | WidgetShell | Widget |
|---|---|---|
| Próximas suscripciones (**stays**) | `:206-213`, keys `dashboard.upcomingSubscriptionsTitle/Hint` | `frontend/components/dashboard/widgets/UpcomingSubs.tsx` |
| Suscripciones activas (**goes**) | `:252-261`, keys `dashboard.activeSubs`/`activeSubsHint` | `frontend/components/dashboard/widgets/ActiveSubs.tsx` |

Blast radius of deleting it:

- `ActiveSubs.tsx` is imported only at `DashboardHome.tsx:11`, rendered only at `:260`.
- `dashboard.activeSubs` is also consumed at `DashboardHome.tsx:163` (`customizeRows`, the widget on/off list) → that row goes too.
- `toActiveSubs` (`frontend/lib/dashboard/transforms.ts:361`) is used only by `ActiveSubs.tsx:13` and `transforms.test.ts:245` → dead once the widget goes.
- Still needed afterwards: `lib/api/dashboard`'s `useSubscriptions` (also used by `UpcomingPayments.tsx:4,8` and `notifications/useNotifications.ts:30`), `UpcomingSubs`, `finance.noSubscriptionsHint`, and every other subscriptions surface (`FinanceScreens.tsx:301-312`, `:405-412`, `components/settings/SubscriptionsSection.tsx`, Reports).

## 4. Test surface to expect

- Finance screen: `frontend/components/finance/finance.test.tsx` (imports `FinanceScreens`, asserts region `Movimientos` `:166`), `MovementHistory.test.tsx` (13 tests incl. the 5/10 window).
- Resumen: `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx` (strip `:40`, widget set `:91,144`), `frontend/components/containers/DashboardHome.test.tsx` (`:74-213`), `lib/dashboard/transforms.test.ts:245`, e2e `dashboard-widgets.spec.ts:10`, `sections.spec.ts:34,43,62`.
- Patrimony: `ProgressScreens.test.tsx` and `ReportsScreens.test.tsx` assert the key and keep passing (their consumers stay).

## 5. Repository hygiene note (out of scope, reported)

`frontend/components/finance/jd-round1.test.tsx`, `frontend/components/finance/s1-capture.test.tsx` and `frontend/lib/finance/jd-round1.test.ts` are **tracked** tests with phase-scratch names (added by `8f452df` and `82bc80d`). They are not orphans — they exercise `AssetEditForm`, the S1 API helpers and `AccountBalanceEdit` and count in the run — but their names lie about their role. Renaming them is a separate cleanup, not part of this change.

## Uncertainty

None outstanding: the one scope ambiguity (which patrimony display to remove) was resolved by the owner, who chose **both**.
