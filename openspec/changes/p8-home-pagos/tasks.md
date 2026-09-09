# Tasks — p8-home-pagos (Fase 2: S3 Dashboard + S4 Avisos in-app)

> Change: `p8-home-pagos` · Proyecto: landing_personal / personal-dashboard · Fecha: 2026-09-09
> Insumos: `proposal.md` + `design.md` + `specs/dashboard-widgets/spec.md` + `specs/notifications/spec.md` + `exploration.md`
> Delivery strategy: ask-on-risk · STRICT TDD activo en apply (vitest + tsc; `cargo` solo si se toca BE — no se toca) · Sin BE nuevo · Sin tocar Fase 1 (S1/S2 en `main@8f452df`)
> Orden TDD vinculante: transforms → hooks → widgets → bell → toggles → i18n → e2e. Cada tarea ≤100 líneas de diff aprox.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1150–1450 (código ~550–700 + tests ~500–600 + e2e/i18n ~100–150) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 transforms+apiPatch+i18n → PR2 hooks+toggles/persistencia+mes-3-cards → PR3 listas (payments/debts/subs/tasks/events/goal) → PR4 bell+popover+e2e |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

> Por qué High: 9 widgets + bell + 6 hooks + 12 transforms + `apiPatch` + `dashboard_layout` + i18n + 2 e2e superan 400 líneas con tests TDD. Ningún PR individual debe superar ~350 líneas; aplicar en cadena PR1→PR4 con suite verde entre eslabones. Decisión pendiente (chain strategy `pending`): confirmar `stacked-to-main` vs `feature-branch-chain` antes del primer apply — por eso `Decision needed before apply: Yes`.

## Reglas globales (todas las tareas)

- FE-only: prohibido crear endpoints, migrar `user_preferences`, tocar `backend/src/routes/*` (incluido `me.rs`), o tocar `FinanceSections`, `ManualCapture`, `TransactionsLedger`, `TransferHistory`, `ProductivitySections`, `ProductivityForms`, tests `s1-capture`/`s2-crud`.
- Montos wire `string|number` → `toNumber` solo en `frontend/lib/dashboard/transforms.ts`; UI recibe `number` y formatea con `formatMoney` (`es-CO`/`COP` de `GET /me`).
- Textos solo vía `t()` con claves tipadas en `frontend/lib/i18n/es.ts`; cero hardcode ES/EN.
- Tokens `--color-*` sin hex, `prefers-reduced-motion`, foco visible, teclado, `output: export` SSR-safe (`typeof window` guards), charts con `next/dynamic(ssr:false)`.
- Verificación por tarea: `pnpm --dir frontend test -- <archivo>` + `pnpm --dir frontend exec tsc --noEmit`. Rollback por tarea: `git checkout -- <archivos de la tarea>`.

## Fase A — Transforms puros (RED → GREEN → TRIANGULATE)

- [x] RED: extender `frontend/lib/dashboard/transforms.test.ts` con `toMonthIncome/toMonthExpense/toMonthSavings` (punto `monthKey` actual, ahorro negativo, wire string) (~70 diff). <!-- sdd-owner: implementation -->
- [x] GREEN: implementar `toMonthIncome/toMonthExpense/toMonthSavings` en `frontend/lib/dashboard/transforms.ts` reutilizando `toNumber` (~40 diff). <!-- sdd-owner: implementation -->
- [x] RED: agregar casos `toUpcomingPayments` + `toOverdueItems` en `frontend/lib/dashboard/transforms.test.ts` (bordes hoy/hoy+7 incluido/hoy+8 excluido, deuda sin fecha excluida, desempate deudas>events>subs, vencidas task+debt+event) (~90 diff). <!-- sdd-owner: implementation -->
- [x] GREEN: implementar `toUpcomingPayments(subs, debts, events, now)` + `toOverdueItems(tasks, debts, events, now)` en `frontend/lib/dashboard/transforms.ts` con ventana `[hoy00:00, hoy+7 23:59]` local `es-CO` (~90 diff). <!-- sdd-owner: implementation -->
- [x] RED: agregar casos `toPendingDebts/toActiveSubs/toPendingTasks/toUpcomingEvents` + `toGoalProgress/toNotificationItems/toNotificationCount` en `frontend/lib/dashboard/transforms.test.ts` (filtros `active`/`is_active`, orden asc, `upcoming-events` 14d no contamina bell, 2 segmentos Metas/Ahorro, mute+widgets ocultos) (~90 diff). <!-- sdd-owner: implementation -->
- [x] GREEN: implementar `toPendingDebts/toActiveSubs/toPendingTasks/toUpcomingEvents/toGoalProgress/toNotificationItems/toNotificationCount` en `frontend/lib/dashboard/transforms.ts` (~95 diff). <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: agregar bordes TZ/RFC3339 y `installment` con fecha en `frontend/lib/dashboard/transforms.test.ts` + ajustar helpers fecha local en `frontend/lib/dashboard/transforms.ts` (sin inventar fechas) (~60 diff). <!-- sdd-owner: implementation -->

## Fase B — API client + hooks SWR (RED → GREEN)

- [x] RED: agregar casos `apiPatch` en `frontend/lib/api/client.test.ts` (JSON+Bearer, 401 single-flight, 422 `toApiError`) (~60 diff). <!-- sdd-owner: implementation -->
- [x] GREEN: implementar `apiPatch<T>(path, body, init?)` en `frontend/lib/api/client.ts` espejo de `apiPost` (~35 diff). <!-- sdd-owner: implementation -->
- [x] RED: agregar tests de hooks `frontend/lib/api/dashboard.test.ts` para `useDebts/useSubscriptions/useTasks(view)/useEvents(from,to)` (keys `dashboard/*`, `null` key si oculto, `revalidateOnFocus:false`, montos `string|number`) (~90 diff). <!-- sdd-owner: implementation -->
- [x] GREEN: implementar wires `DebtWire/SubscriptionWire/TaskWire/EventWire` + hooks `useDebts/useSubscriptions/useTasks/useEvents` en `frontend/lib/api/dashboard.ts` (~95 diff). <!-- sdd-owner: implementation -->
- [x] RED: agregar tests en `frontend/lib/api/dashboard.test.ts` para `useGoals/useSavingsGoals/usePreferences/useUpdateLayout` (envelope exacto `PATCH /me/preferences { dashboard_layout }`, optimista + rollback en 422, fallback layout default) (~90 diff). <!-- sdd-owner: implementation -->
- [x] GREEN: implementar `GoalWire/SavingsGoalWire`, `DashboardWidgetPref/DashboardLayout`, `useGoals/useSavingsGoals/useUpdateLayout` en `frontend/lib/api/dashboard.ts` + tipo `NotificationItem` (~95 diff). <!-- sdd-owner: implementation -->

## Fase C — i18n ES (RED → GREEN, aditivo)

- [x] RED: extender `frontend/lib/i18n/i18n.test.ts` con claves `dashboard.*` (9 widgets, toggles, ver-en-sección, vacíos) y `notifications.*` (bell, vencidas, próximos, mutear, vacíos, `{n}`/`{date}`) (~70 diff). <!-- sdd-owner: implementation -->
- [x] GREEN: agregar claves aditivas en `frontend/lib/i18n/es.ts` sin reescribir diccionario (`noOverdue: "Sin vencidas 🎉"`, `noUpcoming: "Nada por vencer en 7 días"`) (~70 diff). <!-- sdd-owner: implementation -->

## Fase D — Widgets (GREEN sobre transforms+hooks verificados)

- [x] Implementar 3 `MetricCard` mes separado (`month-income/metric/sm/10`, `month-expense/metric/sm/11`, `month-savings/metric/sm/12`) directos en `frontend/components/containers/DashboardHome.tsx` o wrappers en `frontend/components/dashboard/widgets/Month*.tsx` + test en `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx` (cards independientes con `formatMoney`) (~90 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/UpcomingPayments.tsx` (lista `list/lg/20`, unión 7d ordenada, top 5–7 + link Finanzas + `EmptyState` ES) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/PendingDebts.tsx` + `ActiveSubs.tsx` (`list/md/21`, `list/md/22`, filtros `active`/`is_active`, `pending_amount`/`price` COP) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/PendingTasks.tsx` + `UpcomingEvents.tsx` (`list/md/23` desde `view=today+upcoming`, `list/md/24` ventana 14d visual, top 5–7 + links Productividad) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/GoalProgress.tsx` (`chart/md/30`, 2 segmentos Metas `progress` + Ahorro `saved/goal` en el mismo widget, sin Recharts o con `ssr:false`) + casos en `DashboardHome.widgets.test.tsx` (~90 diff). <!-- sdd-owner: implementation -->

## Fase E — Campanita S4 (RED → GREEN)

- [x] RED+GREEN: crear `frontend/components/notifications/useNotifications.ts` (deriva de hooks S3 + `toOverdueItems/toUpcomingPayments`, filtra `localStorage p8-notif-muted` + `visibleSources`, SSR-safe, expone `{ overdue, upcoming, count, muted, toggleMute }`) + casos en `frontend/components/notifications/__tests__/notifications.test.tsx` (badge = vencidas+7d − muteados − ocultos, bordes 7/8d) (~95 diff). <!-- sdd-owner: implementation -->
- [x] Implementar `frontend/components/notifications/NotificationBell.tsx` (botón header home, badge, `aria-label`/`aria-expanded`, teclado, `Esc`, foco visible, popover SSR-safe) + casos en `notifications.test.tsx` (~90 diff). <!-- sdd-owner: implementation -->
- [x] Implementar `frontend/components/notifications/NotificationList.tsx` (secciones Vencidas/Próximos cobros ordenadas, switch por ítem con `role="switch"`, `EmptyState` ES, tokens sin hex) + casos mute persiste `p8-notif-muted` tras reload (~90 diff). <!-- sdd-owner: implementation -->

## Fase F — Toggles + composición home

- [x] Implementar `frontend/components/ui/WidgetToggle.tsx` (switch accesible genérico `role="switch" aria-checked`, extiende `WidgetShell` con prop `action` sin romper firma) + test en `frontend/components/ui/WidgetToggle.test.tsx` (~70 diff). <!-- sdd-owner: implementation -->
- [ ] Componer `frontend/components/containers/DashboardHome.tsx` (header-row `h1`+`NotificationBell`, grid bento 12-col con 9 widgets + existentes, `WidgetToggle` por widget, loading `some(isLoading)` extendido, error panel + retry `dashboard/`, ocultar = `null` key + no render, round-trip `GET→PATCH→GET`, layout vacío = 9 visibles) + casos integración en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->

## Fase G — E2E + no-regresión (REFACTOR + verificación)

- [ ] Crear `frontend/e2e/dashboard-widgets.spec.ts` (Playwright: 9 widgets con datos reales, toggle persiste tras reload, `EmptyState` ES, links ver-en-sección, Telemetría/charts intactos) (~80 diff). <!-- sdd-owner: implementation -->
- [ ] Crear `frontend/e2e/notifications.spec.ts` (Playwright: badge vencidas+7d, panel 2 secciones, mute ítem persiste `p8-notif-muted`, mute categoría vía ocultar widget excluye del badge) (~80 diff). <!-- sdd-owner: implementation -->
- [ ] REFACTOR: deduplicar helpers fecha/moneda entre `frontend/lib/dashboard/transforms.ts` y `frontend/lib/api/dashboard.ts`, verificar `pnpm --dir frontend test` + `tsc --noEmit` + `s1-capture`/`s2-crud` verdes y cero diff fuera de §4.1–4.2 del diseño (~50 diff). <!-- sdd-owner: implementation -->

## Post-apply (dueño/orquestador)

- [ ] Start or reuse bounded review of PR1→PR4 chain before merge. <!-- sdd-owner: parent -->
- [ ] Confirm lifecycle gate (Judgment Day + `s1-capture`/`s2-crud` green) before `main` merge. <!-- sdd-owner: parent -->
