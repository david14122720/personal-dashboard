# Apply Progress — p8-home-pagos · PR2 (stacked-to-main, eslabón 2 de 4)

> Change: `p8-home-pagos` · PR2 alcance: hooks SWR + 3 cards mes + toggles/persistencia
> Fecha: 2026-09-09 · Modo: STRICT TDD (vitest + tsc) · Delivery: stacked-to-main eslabón 2/4, base rama `p8-pr1`
> Budget: HARD 350 líneas — real 313 insertions + 6 deletions = 319 (ver §6) · FE-only, sin bell (PR3), sin resto widgets (PR4), sin backend, sin Fase 1

## 1. Completed tasks (PR2) + persisted checkbox updates

Persisted in `openspec/changes/p8-home-pagos/tasks.md` — 17/28 implementation `- [x]` acumuladas (11 PR1 + 6 PR2). Este eslabón marca:

- [x] Fase B RED hooks `useDebts/useSubscriptions/useTasks(view)/useEvents(from,to)` (keys `dashboard/*`, `null` si oculto, montos `string|number`)
- [x] Fase B GREEN wires `DebtWire/SubscriptionWire/TaskWire/EventWire` + hooks `useDebts/useSubscriptions/useTasks/useEvents`
- [x] Fase B RED `useGoals/useSavingsGoals/usePreferences/useUpdateLayout` (envelope exacto `PATCH /me/preferences { dashboard_layout }`, optimista + rollback 422, fallback default)
- [x] Fase B GREEN `GoalWire/SavingsGoalWire` + `useGoals/useSavingsGoals/useUpdateLayout` + re-export `NotificationItem` (sin duplicar lógica)
- [x] Fase D 3 `MetricCard` mes separado (`month-income/10`, `month-expense/11`, `month-savings/12`) directos en `DashboardHome.tsx` + test `DashboardHome.widgets.test.tsx`
- [x] Fase F `WidgetToggle.tsx` (switch accesible `role="switch" aria-checked`, `WidgetShell` con prop `action` opcional sin romper firma) + test `WidgetToggle.test.tsx`

Verificación: `grep -c "^- \[x\]" tasks.md` = 17. Parent-owned intactas, diferidas (§7). Fase F composición completa sigue `- [ ]` (parcial PR2: solo trio mes + toggles; 9 widgets + bell quedan para PR3/PR4).

## 2. Files changed (solo PR2, tracked + untracked nuevos)

Tracked (`git diff HEAD --numstat`):

- `frontend/lib/api/dashboard.ts` (+90/-2, wires + keys + helpers layout + 7 hooks + `useUpdateLayout` + re-export `NotificationItem`)
- `frontend/components/containers/DashboardHome.tsx` (+38/-2, `WidgetShell.action?`, trio mes con `toMonthSummary`/`formatMoney`, toggles `buildNextLayout` + `useUpdateLayout`, `visible=null→no render`)
- `frontend/components/containers/DashboardHome.test.tsx` (+7/-2, mock `...mod` + `useUpdateLayout` stub para no-regresión)

Nuevos (untracked, líneas `wc -l`):

- `frontend/lib/api/dashboard.test.ts` (106, MSW + `SWRConfig`, keys/null-key, fetch string-money, hidden skip, layout fallback/toggle, envelope + 422 rollback, triangulación)
- `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx` (39, 3 cards `formatMoney` + toggles + PATCH envelope + round-trip)
- `frontend/components/ui/WidgetToggle.tsx` (17, botón `role="switch"` + `t(widgetHide/Show)` + tokens sin hex + foco visible)
- `frontend/components/ui/WidgetToggle.test.tsx` (16, `aria-checked` + `onToggle(false)`)

Total PR2: 313 insertions + 6 deletions = 319 ≤ 350 HARD. Cero diff en `backend/src/routes/*`, Fase 1 (`FinanceSections`, `ManualCapture`, `TransactionsLedger`, `TransferHistory`, `ProductivitySections`, `ProductivityForms`, `s1-capture`/`s2-crud`), notificaciones, resto widgets, e2e. `skills-lock.json` + `tsconfig.tsbuildinfo` preexistentes/no tocados por este apply (excluidos del budget).

## 3. Test commands run (evidencia)

Baseline pre-PR2: `tsc --noEmit` 0; `vitest run` 15 files / 150 tests verdes (heredado PR1).

Ciclo PR2 (todos `pnpm --dir frontend`):

- RED hooks: `exec vitest run lib/api/dashboard.test.ts` → 6 failed (`debtsKey/useDebts/... is not a function`, `useUpdateLayout is not a function`); GREEN → 6 passed; TRIANGULATE (+null view/events-all + `toNotificationCount` sin duplicar) → 7 passed; REFACTOR (compactado 156→106 líneas para budget, sin cambiar lógica) → 7 passed, `tsc` 0.
- RED UI: `exec vitest run components/ui/WidgetToggle.test.tsx "...DashboardHome.widgets.test.tsx"` → 2 failed (`Failed to resolve ./WidgetToggle`, `Unable to find Ingreso del mes`); GREEN (`WidgetToggle.tsx` + trio mes en `DashboardHome.tsx`) → 3 passed (1 toggle + 2 widgets); `tsc` 0 tras fix `dashboard.test.ts` default-import + mock `DashboardHome.test.tsx ...mod`.
- Final: `exec vitest run` → **18 files / 160 tests passed** (+10 vs PR1: +7 dashboard hooks, +1 toggle, +2 widgets); `exec tsc --noEmit` → **0 errores**.

## 4. TDD Cycle Evidence (STRICT TDD activo)

| Task | RED (failing first) | GREEN (min code, pass) | TRIANGULATE (≥2 casos) | REFACTOR (still green) |
|------|---------------------|------------------------|------------------------|------------------------|
| hooks keys/null-key | `debtsKey is not a function` + 5 más | `debtsKey/subscriptionsKey/tasksKey/eventsKey/goalsKey/savingsGoalsKey` + `dashboard/*` | `tasksKey(null,true)="dashboard/tasks"` + `eventsKey(null,null,true)="dashboard/events"` + hidden→null (3 ramas) | compactado imports/handlers 1-línea, re-run 7 green |
| hooks fetch string-money | `useDebts is not a function` | MSW `/debts` `"320.00"` intacto + `/subs` `"9.99"` + `/goals` `60` + `/savings` `"1000.00"` | `d1:320.00` + `t1:e1:g1:sg1:s1` (wire string y number) | sin cambio lógica, 7 green |
| hidden skip | `hidden` no render | `visible=false`→`"hidden"` + `seen.length 0` (sin fetch) | `DebtsProbe visible=false` + `eventsKey(...,false)=null` | re-run green |
| layout fallback/toggle | `resolveDashboardLayout is not a function` | `[]/null→DEFAULT` + `isWidgetVisible` + `buildNextLayout` hide/show | vacío→9 ids + hide `month-income`→false + show→true | `sort(order)` estable, green |
| `useUpdateLayout` envelope+rollback | `useUpdateLayout is not a function` | `PATCH {dashboard_layout}` exacto + `optimisticData` + `rollbackOnError:true` | ok→`done` contiene envelope + 422→`threw=true` | `satisfies PatchPreferencesBody`, green |
| `NotificationItem` sin duplicar | tipo ausente en `dashboard.ts` | `export type { NotificationItem } from transforms` (cero lógica) | `toNotificationCount` 1→0 con mute (reúso, no reimpl) | `tsc` 0, green |
| `revalidateOnFocus:false` | estructural (mismo `config` para 7 hooks, 1 salida) | reúso `config` existente | Triangulation skipped: purely structural shared constant, no branching (igual que PR1 `apiPatch` espejo) | `tsc` 0 |
| WidgetToggle | `Failed to resolve ./WidgetToggle` | botón `role=switch` + `aria-checked` + `onToggle(!v)` + `t()` | `true→click→false` + `rerender false→aria false` | tokens + foco visible, 1 green |
| Trio mes + toggles/round-trip | `Unable to find Ingreso del mes` | `toMonthSummary(flow,monthKey)` + `fmt()` + `visible?id:null` + `toggle→PATCH` | `1.000/400/600` 3 cards + `switches≥3` + envelope sin `month-income` | compactado mock 1-línea, 2 green |
| No-regresión `DashboardHome.test` | 5 failed tras añadir `useUpdateLayout` | mock `...mod` + stub `useUpdateLayout` | error/loading/telemetry/streak intactos | 5 green |

Three Laws: nunca producción antes de RED; GREEN mínimo; cada REFACTOR re-ejecutó enfocados + `tsc`.

## 5. Deviations from design

1. `dashboard.test.ts` en `.ts` con `createElement` (sin JSX) para respetar path exacto de tasks (`dashboard.test.ts`, no `.tsx`). JSX habría exigido `.tsx`; se evitó renombrar.
2. `eventsKey/tasksKey/...` puros exportados para testear `null`-key sin mockear SWR. Diseño fija claves `dashboard/*` pero no los nombres de helpers; exponerlos es aditivo y facilita `null`-key por widget visible.
3. `resolveDashboardLayout` fallback = `[]`/ausente→`DEFAULT`; validación profunda (type/size/order) delegada a BE (`deny_unknown_fields`→422) + `useUpdateLayout` rollback. Suficiente para PR2; validación FE estricta queda para REFACTOR PR4.
4. Trio mes envuelto en `div col-span + WidgetToggle` + `MetricCard` (no `WidgetShell`), porque `MetricCard` no acepta `action`. `WidgetShell.action?` se añade igual (tarea exige extender firma) para listas PR3/PR4.
5. `DashboardHome.test.tsx` mock pasa a `...mod` + stub. Sin esto, el mock cerrado de 7 hooks rompe al añadir `useUpdateLayout`/helpers (5 failed). Cambio mínimo no-regresión.
6. i18n sin diff: claves mes/toggles ya existían PR1 (`monthIncome/Expense/Savings`, `widgetHide/Show`). Cero hardcode nuevo verificado; no se añadió `es.ts`.
7. Composición Fase F parcial consciente: header `h1+Bell`, 9 widgets, loading extendido y error `dashboard/` completo quedan para PR3/PR4. PR2 solo trio mes + toggles para no superar 350.

## 6. Remaining tasks (exact unchecked `- [ ]` lines)

11 implementation + 2 parent (deferred, byte-for-byte):

- [ ] Implementar `frontend/components/dashboard/widgets/UpcomingPayments.tsx` (lista `list/lg/20`, unión 7d ordenada, top 5–7 + link Finanzas + `EmptyState` ES) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/PendingDebts.tsx` + `ActiveSubs.tsx` (`list/md/21`, `list/md/22`, filtros `active`/`is_active`, `pending_amount`/`price` COP) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/PendingTasks.tsx` + `UpcomingEvents.tsx` (`list/md/23` desde `view=today+upcoming`, `list/md/24` ventana 14d visual, top 5–7 + links Productividad) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/GoalProgress.tsx` (`chart/md/30`, 2 segmentos Metas `progress` + Ahorro `saved/goal` en el mismo widget, sin Recharts o con `ssr:false`) + casos en `DashboardHome.widgets.test.tsx` (~90 diff). <!-- sdd-owner: implementation -->
- [ ] RED+GREEN: crear `frontend/components/notifications/useNotifications.ts` (deriva de hooks S3 + `toOverdueItems/toUpcomingPayments`, filtra `localStorage p8-notif-muted` + `visibleSources`, SSR-safe, expone `{ overdue, upcoming, count, muted, toggleMute }`) + casos en `frontend/components/notifications/__tests__/notifications.test.tsx` (badge = vencidas+7d − muteados − ocultos, bordes 7/8d) (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/notifications/NotificationBell.tsx` (botón header home, badge, `aria-label`/`aria-expanded`, teclado, `Esc`, foco visible, popover SSR-safe) + casos en `notifications.test.tsx` (~90 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/notifications/NotificationList.tsx` (secciones Vencidas/Próximos cobros ordenadas, switch por ítem con `role="switch"`, `EmptyState` ES, tokens sin hex) + casos mute persiste `p8-notif-muted` tras reload (~90 diff). <!-- sdd-owner: implementation -->
- [ ] Componer `frontend/components/containers/DashboardHome.tsx` (header-row `h1`+`NotificationBell`, grid bento 12-col con 9 widgets + existentes, `WidgetToggle` por widget, loading `some(isLoading)` extendido, error panel + retry `dashboard/`, ocultar = `null` key + no render, round-trip `GET→PATCH→GET`, layout vacío = 9 visibles) + casos integración en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Crear `frontend/e2e/dashboard-widgets.spec.ts` (Playwright: 9 widgets con datos reales, toggle persiste tras reload, `EmptyState` ES, links ver-en-sección, Telemetría/charts intactos) (~80 diff). <!-- sdd-owner: implementation -->
- [ ] Crear `frontend/e2e/notifications.spec.ts` (Playwright: badge vencidas+7d, panel 2 secciones, mute ítem persiste `p8-notif-muted`, mute categoría vía ocultar widget excluye del badge) (~80 diff). <!-- sdd-owner: implementation -->
- [ ] REFACTOR: deduplicar helpers fecha/moneda entre `frontend/lib/dashboard/transforms.ts` y `frontend/lib/api/dashboard.ts`, verificar `pnpm --dir frontend test` + `tsc --noEmit` + `s1-capture`/`s2-crud` verdes y cero diff fuera de §4.1–4.2 del diseño (~50 diff). <!-- sdd-owner: implementation -->

Parent (deferred, no tocar):

- [ ] Start or reuse bounded review of PR1→PR4 chain before merge. <!-- sdd-owner: parent -->
- [ ] Confirm lifecycle gate (Judgment Day + `s1-capture`/`s2-crud` green) before `main` merge. <!-- sdd-owner: parent -->

Siguiente eslabón PR3: listas (payments/debts/subs/tasks/events/goal) sobre hooks PR2 ya verdes.

## 7. Workload / PR boundary

- Forecast original: 1150–1450 líneas, `400-line budget risk: High`, `Chained: Yes`, `Chain strategy: pending`, `Decision needed: Yes`.
- Resolución consumida: `stacked-to-main, eslabón 2 de 4, base rama p8-pr1` (delegado PR2) → solo slice hooks + trio mes + toggles/persistencia.
- PR2 real: 313 insertions + 6 deletions = 319 ≤ 350 HARD (tracked 135 + nuevos 178). Compactado tests 249→178 para cumplir sin perder cobertura (RED/GREEN/TRIANGULATE intactos). `DashboardHome.test` +7 líneas incluidas como no-regresión obligatoria.
- Rollback PR2: `git checkout -- frontend/lib/api/dashboard.ts frontend/components/containers/DashboardHome.tsx frontend/components/containers/DashboardHome.test.tsx` + `rm frontend/lib/api/dashboard.test.ts frontend/components/ui/WidgetToggle.tsx frontend/components/ui/WidgetToggle.test.tsx "frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx"` (más `rm -rf frontend/components/dashboard` si queda vacío).
- Review gate: este eslabón no inicia bounded-review ni valida gates (dueño orquestador).

## 8. Structured status consumed / produced

Consumed (fallback manual + global `~/.pi/agent/gentle-ai/support/sdd-status-contract.md`; `openspec/` autoritativo; sin `gentle-ai sdd-status` nativo):

```yaml
schemaName: spec-driven
changeName: p8-home-pagos
artifactStore: openspec
planningHome: { root: /home/david/Nextcloud2/Ubuntu/landing_personal, changesDir: openspec/changes }
changeRoot: openspec/changes/p8-home-pagos
artifactPaths: { proposal: [openspec/changes/p8-home-pagos/proposal.md], specs: [openspec/changes/p8-home-pagos/specs/dashboard-widgets/spec.md, openspec/changes/p8-home-pagos/specs/notifications/spec.md], design: [openspec/changes/p8-home-pagos/design.md], tasks: [openspec/changes/p8-home-pagos/tasks.md], applyProgress: [openspec/changes/p8-home-pagos/apply-progress.md] }
artifacts: { proposal: done, specs: done, design: done, tasks: done, applyProgress: done, verifyReport: missing, syncReport: missing }
taskProgress: { total: 28, complete: 17, remaining: 11 }
deferredParentActions: { total: 2, complete: 0, remaining: 2 }
taskArtifactErrors: []
applyState: ready
dependencies: { apply: ready, verify: blocked, sync: blocked, archive: blocked }
actionContext: { mode: repo-local, workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal, allowedEditRoots: [/home/david/Nextcloud2/Ubuntu/landing_personal], warnings: ["400-line High but stacked-to-main 2/4 approved", "strict TDD active (config strict_tdd=false overridden by parent)", "HARD 350 enforced via test compaction"] }
nextRecommended: parent-lifecycle
isNonAuthoritative: false
```

Produced: este `apply-progress.md` (merge acumulativo PR1+PR2) + 6 checkboxes `- [x]` en `tasks.md` (re-leídos: 17). Sin receipts, sin review, sin gate.

## 9. Risks / notes

- Mes trio comparte `useMonthlyFlow`; ocultar 1 card no anula fetch (correcto: otras 2 lo usan). `null`-key por widget aplica a hooks dedicados (`debts/subs/tasks/events/goals`) usados en PR3/PR4.
- `PATCH` retorna `Preferences` plano; `useUpdateLayout` lo envuelve a `MeWire` para `dashboard/me`. 422 deja fila intacta (BE valida antes de escribir); rollback SWR + `revalidate:true` restaura.
- `WidgetToggle` `aria-label` incluye `id` (`"Ocultar bloque: month-income"`) para distinguir 3 switches en tests/a11y; copy base sigue `t()`.
- `DashboardHome.widgets.test` usa `currentMonthKey(new Date())` dinámico → determinista en cualquier TZ; e2e PR4 debe fijar `America/Bogota`.
- `tsconfig.tsbuildinfo` untracked ignorado (build artifact, no parte del PR).

---

## PR1 history (preserved, no overwrite — contenido original íntegro debajo)

# Apply Progress — p8-home-pagos · PR1 (stacked-to-main, eslabón 1 de 4)

> Change: `p8-home-pagos` · PR1 alcance: transforms + apiPatch + i18n base
> Fecha: 2026-09-09 · Modo: STRICT TDD (vitest + tsc) · Delivery: ask-on-risk, cadena aprobada 4 PRs stacked-to-main
> Base: `main@8f452df` · FE-only, sin widgets (PR2/PR3), sin bell (PR4), sin Fase 1, sin backend

## 1. Completed tasks (PR1) + persisted checkbox updates

Persisted in `openspec/changes/p8-home-pagos/tasks.md` — 11/28 implementation marcadas `- [x]` en este eslabón:

- [x] Fase A RED `toMonthIncome/toMonthExpense/toMonthSavings`
- [x] Fase A GREEN `toMonthIncome/toMonthExpense/toMonthSavings` (+ `toMonthSummary` wrapper, ver §5 desviaciones)
- [x] Fase A RED `toUpcomingPayments` + `toOverdueItems`
- [x] Fase A GREEN `toUpcomingPayments` + `toOverdueItems` (ventana `[hoy00:00, hoy+7 23:59]` local)
- [x] Fase A RED `toPendingDebts/toActiveSubs/toPendingTasks/toUpcomingEvents` + `toGoalProgress/toNotificationItems/toNotificationCount`
- [x] Fase A GREEN mismos 7 puros
- [x] Fase A TRIANGULATE TZ/RFC3339 + `installment` (sin inventar fechas)
- [x] Fase B RED `apiPatch` (JSON+Bearer, 401 single-flight, 422 `toApiError`)
- [x] Fase B GREEN `apiPatch<T>` espejo de `apiPost`
- [x] Fase C RED i18n `dashboard.*` + `notifications.*`
- [x] Fase C GREEN claves aditivas en `es.ts` (`noOverdue: "Sin vencidas 🎉"`, `noUpcoming: "Nada por vencer en 7 días"`)

Verificación de persistencia: `grep -c "^- \[x\]" tasks.md` = 11. Parent-owned (`sdd-owner: parent`) intactas, diferidas al orquestador (§7).

Parcial PR1 no marcado como completo (diseño §4.1, tarea Fase B GREEN 2/2):
- `frontend/lib/api/dashboard.ts`: solo tipos `DashboardWidgetType/Size`, `DashboardWidgetPref`, `DashboardLayout`, `DEFAULT_DASHBOARD_LAYOUT` (9 ids/orders §5.1), `PreferencesWire.dashboard_layout?`, `PatchPreferencesBody`. Hooks `useDebts/useSubscriptions/useTasks/useEvents/useGoals/useSavingsGoals/useUpdateLayout` + wires + `NotificationItem` quedan para PR2 (tareas Fase B restantes siguen `- [ ]`).

## 2. Files changed (solo PR1, `git diff --name-only`)

- `frontend/lib/dashboard/transforms.ts` (+489, puros nuevos + `UPCOMING_PAYMENTS_WINDOW_DAYS=7`, `UPCOMING_EVENTS_WINDOW_DAYS=14`)
- `frontend/lib/dashboard/transforms.test.ts` (+236, RED→GREEN→TRIANGULATE)
- `frontend/lib/api/client.ts` (+18, `apiPatch`)
- `frontend/lib/api/client.test.ts` (+48, 3 casos apiPatch + handlers MSW PATCH)
- `frontend/lib/api/dashboard.ts` (+37/-1, tipos layout + default, sin hooks)
- `frontend/lib/i18n/es.ts` (+37, `dashboard.*` 25 claves + `notifications.*` 10 claves, aditivo)
- `frontend/lib/i18n/i18n.test.ts` (+36, 4 bloques PR1 + interpolación `{n}/{date}/{amount}`)

Total PR1: 7 files, 900 insertions(+), 1 deletion(-). Cero diff en `backend/src/routes/*`, `FinanceSections`, `ManualCapture`, `TransactionsLedger`, `TransferHistory`, `ProductivitySections`, `ProductivityForms`, widgets, notifications, e2e. `skills-lock.json` modificado preexistente (no tocado por este apply).

## 3. Test commands run (evidencia)

Baseline pre-cambio (safety net): `pnpm --dir frontend exec tsc --noEmit` → 0 errores; `vitest run` → 15 files / 127 tests verdes.

Ciclo PR1 (comandos enfocados, todos con `pnpm --dir frontend`):
- `exec vitest run lib/dashboard/transforms.test.ts` RED1 → 3 failed (`toMonthIncome is not a function`); GREEN1 → 14 passed; RED2 → 5 failed (`toUpcomingPayments/toOverdueItems is not a function`); GREEN2 → 19 passed; RED3 → 5 failed (`toPendingDebts/.../toNotificationItems is not a function`); GREEN3 → 24 passed; TRIANGULATE → 27 passed; REFACTOR (constantes ventana + limpieza `is_active`) → 27 passed, `tsc --noEmit` → 0.
- `exec vitest run lib/api/client.test.ts` RED → 3 failed (`apiPatch is not a function`); GREEN → 12 passed; `tsc --noEmit` → 0.
- `exec vitest run lib/i18n/i18n.test.ts` RED → 4 failed (`Unknown i18n key` + errores TS2345 `EsKey`); GREEN → 12 passed (luego 12 con triangulación `amountDue`); `tsc --noEmit` → 0.
- Final: `exec vitest run` → **15 files / 150 tests passed** (+23 vs baseline: +16 transforms, +3 client, +4 i18n); `exec tsc --noEmit` → **0 errores** (`TSC_EXIT:0`).

## 4. TDD Cycle Evidence (STRICT TDD activo)

| Task | RED (failing test first) | GREEN (min code, exec pass) | TRIANGULATE (≥2 casos, edge) | REFACTOR (tests still green) |
|------|--------------------------|-----------------------------|------------------------------|------------------------------|
| toMonthIncome/Expense/Savings/Summary | 3 failed, `toMonthIncome is not a function` | 14 passed, `toNumber` + `monthKey` lookup | ahorro negativo + wire string + null/ausente (3 casos) | extraído a `toMonthSummary`, re-run 14 green |
| toUpcomingPayments 7d | 3 failed (unión/orden, bordes hoy/+7/+8, sin-fecha) | 19 passed, ventana local inclusiva + rank deudas>events>subs | segundo pase: RFC3339 válido/inválido + `kind` filtro (incluido en TRIANGULATE global) | constante `UPCOMING_PAYMENTS_WINDOW_DAYS`, re-run 27 green |
| toOverdueItems | 2 failed (deriva 3 fuentes, excluye futuro/completado) | 19 passed, `due<hoy` + `payment_due<ahora` | evento hace 1h vs futuro, `paid_off` excluido | rank deudas>events>tasks, re-run green |
| toPendingDebts/ActiveSubs/PendingTasks/UpcomingEvents | 5 failed (filtros `active`/`is_active`, orden, 14d vs 7d) | 24 passed, filtros + `compareDayAscNullsLast` + ventana 14d param | `upcoming-events` 10d visible pero fuera de bell 7d; nulos al final | helper `compareDayAscNullsLast` extraído, re-run green |
| toGoalProgress (2 segmentos) | incluido en RED3 (pct 60 + 50%) | 24 passed, `progress` + `saved/goal` con clamp | `target_amount/saved_amount` alterno + clamp 250→100 + goal 0→0 | `clampPct` extraído, re-run green |
| toNotificationItems/Count | incluido en RED3 (5 items, mute 1→4, hidden→3) | 24 passed, concat + `muted` + `visibleSources` Set/Array/Record/null | `Set` + `null` (todo visible) + `Record` (triangulado en Count) | firma genérica `Set\|string[]\|Record\|null`, re-run green |
| TRIANGULATE TZ/installment | 3 nuevos (RFC3339 bueno/malo, installment sin fecha excluido, nulos+clamp) | 27 passed, `parseDueDate` YYYY-MM-DD local vs ISO + `installment` nunca fecha | happy + edge por comportamiento (mínimo 2 casos c/u) | sin cambios lógica, solo consts, 27 green |
| apiPatch | 3 failed (`apiPatch is not a function`) | 12 passed, espejo `apiPost` (JSON+Bearer+401+`toApiError`) | JSON+Bearer assert + 401 single-flight + 422 `VALIDATION` (3 caminos) | Triangulation skipped (refactor): espejo exacto, sin duplicación extra; 12 green |
| dashboard_layout tipos | estructural (solo tipos + const, 1 salida posible) | `tsc --noEmit` 0 | Triangulation skipped: purely structural type export, no branching | `DEFAULT_DASHBOARD_LAYOUT` 9 entradas §5.1, `PatchPreferencesBody` envelope exacto |
| i18n dashboard.* + notifications.* | 4 failed (`Unknown i18n key` + TS2345) | 12 passed, claves aditivas sin reescribir | 9 títulos + toggles/links/vacíos + `noOverdue/noUpcoming` exactos + `{n}/{date}` + `{amount}·{date}` | copy ES revisado, cero hardcode, 12 green |

Regla Three Laws respetada: nunca se escribió producción antes del test en rojo; GREEN mínimo (Fake It no necesario, lógica directa); cada refactor re-ejecutó tests enfocados + `tsc`.

## 5. Deviations from design

1. `toMonthSummary(flow, monthKey) → { income, expense, savings }` añadido como wrapper sobre `toMonthIncome/Expense/Savings`. Diseño/tasks piden los tres granulares; el delegado PR1 pide `toMonthSummary`. Se implementan los cuatro para satisfacer ambas fuentes sin romper specs (aceptación `income=1000, expense=400, savings=600` intacta).
2. `NotificationItem` definido en `transforms.ts` para PR1 (puros `toNotificationItems/Count` lo necesitan tipado). Diseño §4.1 lo ubica en `dashboard.ts`; PR2 lo re-exportará/alineará allí junto a `useNotifications` (sin duplicar lógica, solo mover tipo o `export type ... from`).
3. `source` puro = `kind` (`"debt"|"event"|"subscription"|"task"`). Diseño deja `source` como “origen query” abierto; el mapeo widget→fuente (`active-subs`, `pending-debts`, etc.) se fija en PR4 `useNotifications` sin cambiar firma pura.
4. `toUpcomingEvents(events, now, windowDays=14)` expone `windowDays` con default `UPCOMING_EVENTS_WINDOW_DAYS`. Spec fija 14d visual; el param solo facilita test sin afectar bell 7d.
5. `SavingsGoalLike` acepta ambas formas (`goal/saved` diseño + `target_amount/saved_amount` finance.ts) con `toNumber` en borde. Evita acoplar transforms a un solo wire y respeta “montos string solo en transforms”.
6. `dashboard.ts` PR1 es tipos-only (desviación parcial consciente): la tarea GREEN 2/2 pide hooks, pero el slice PR1 aprobado es `PreferencesWire/dashboard_layout` extensión. Hooks van a PR2 para no superar aún más el budget ni mezclar TDD de hooks con puros.

## 6. Remaining tasks (exact unchecked `- [ ]` lines)

17 implementation + 2 parent (deferred lifecycle, byte-for-byte preservadas):

- [ ] RED: agregar tests de hooks `frontend/lib/api/dashboard.test.ts` para `useDebts/useSubscriptions/useTasks(view)/useEvents(from,to)` (keys `dashboard/*`, `null` key si oculto, `revalidateOnFocus:false`, montos `string|number`) (~90 diff). <!-- sdd-owner: implementation -->
- [ ] GREEN: implementar wires `DebtWire/SubscriptionWire/TaskWire/EventWire` + hooks `useDebts/useSubscriptions/useTasks/useEvents` en `frontend/lib/api/dashboard.ts` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] RED: agregar tests en `frontend/lib/api/dashboard.test.ts` para `useGoals/useSavingsGoals/usePreferences/useUpdateLayout` (envelope exacto `PATCH /me/preferences { dashboard_layout }`, optimista + rollback en 422, fallback layout default) (~90 diff). <!-- sdd-owner: implementation -->
- [ ] GREEN: implementar `GoalWire/SavingsGoalWire`, `DashboardWidgetPref/DashboardLayout`, `useGoals/useSavingsGoals/useUpdateLayout` en `frontend/lib/api/dashboard.ts` + tipo `NotificationItem` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar 3 `MetricCard` mes separado (`month-income/metric/sm/10`, `month-expense/metric/sm/11`, `month-savings/metric/sm/12`) directos en `frontend/components/containers/DashboardHome.tsx` o wrappers en `frontend/components/dashboard/widgets/Month*.tsx` + test en `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx` (cards independientes con `formatMoney`) (~90 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/UpcomingPayments.tsx` (lista `list/lg/20`, unión 7d ordenada, top 5–7 + link Finanzas + `EmptyState` ES) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/PendingDebts.tsx` + `ActiveSubs.tsx` (`list/md/21`, `list/md/22`, filtros `active`/`is_active`, `pending_amount`/`price` COP) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/PendingTasks.tsx` + `UpcomingEvents.tsx` (`list/md/23` desde `view=today+upcoming`, `list/md/24` ventana 14d visual, top 5–7 + links Productividad) + casos en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/dashboard/widgets/GoalProgress.tsx` (`chart/md/30`, 2 segmentos Metas `progress` + Ahorro `saved/goal` en el mismo widget, sin Recharts o con `ssr:false`) + casos en `DashboardHome.widgets.test.tsx` (~90 diff). <!-- sdd-owner: implementation -->
- [ ] RED+GREEN: crear `frontend/components/notifications/useNotifications.ts` (deriva de hooks S3 + `toOverdueItems/toUpcomingPayments`, filtra `localStorage p8-notif-muted` + `visibleSources`, SSR-safe, expone `{ overdue, upcoming, count, muted, toggleMute }`) + casos en `frontend/components/notifications/__tests__/notifications.test.tsx` (badge = vencidas+7d − muteados − ocultos, bordes 7/8d) (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/notifications/NotificationBell.tsx` (botón header home, badge, `aria-label`/`aria-expanded`, teclado, `Esc`, foco visible, popover SSR-safe) + casos en `notifications.test.tsx` (~90 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/notifications/NotificationList.tsx` (secciones Vencidas/Próximos cobros ordenadas, switch por ítem con `role="switch"`, `EmptyState` ES, tokens sin hex) + casos mute persiste `p8-notif-muted` tras reload (~90 diff). <!-- sdd-owner: implementation -->
- [ ] Implementar `frontend/components/ui/WidgetToggle.tsx` (switch accesible genérico `role="switch" aria-checked`, extiende `WidgetShell` con prop `action` sin romper firma) + test en `frontend/components/ui/WidgetToggle.test.tsx` (~70 diff). <!-- sdd-owner: implementation -->
- [ ] Componer `frontend/components/containers/DashboardHome.tsx` (header-row `h1`+`NotificationBell`, grid bento 12-col con 9 widgets + existentes, `WidgetToggle` por widget, loading `some(isLoading)` extendido, error panel + retry `dashboard/`, ocultar = `null` key + no render, round-trip `GET→PATCH→GET`, layout vacío = 9 visibles) + casos integración en `DashboardHome.widgets.test.tsx` (~95 diff). <!-- sdd-owner: implementation -->
- [ ] Crear `frontend/e2e/dashboard-widgets.spec.ts` (Playwright: 9 widgets con datos reales, toggle persiste tras reload, `EmptyState` ES, links ver-en-sección, Telemetría/charts intactos) (~80 diff). <!-- sdd-owner: implementation -->
- [ ] Crear `frontend/e2e/notifications.spec.ts` (Playwright: badge vencidas+7d, panel 2 secciones, mute ítem persiste `p8-notif-muted`, mute categoría vía ocultar widget excluye del badge) (~80 diff). <!-- sdd-owner: implementation -->
- [ ] REFACTOR: deduplicar helpers fecha/moneda entre `frontend/lib/dashboard/transforms.ts` y `frontend/lib/api/dashboard.ts`, verificar `pnpm --dir frontend test` + `tsc --noEmit` + `s1-capture`/`s2-crud` verdes y cero diff fuera de §4.1–4.2 del diseño (~50 diff). <!-- sdd-owner: implementation -->

Parent (deferred, no tocar):
- [ ] Start or reuse bounded review of PR1→PR4 chain before merge. <!-- sdd-owner: parent -->
- [ ] Confirm lifecycle gate (Judgment Day + `s1-capture`/`s2-crud` green) before `main` merge. <!-- sdd-owner: parent -->

Siguiente eslabón sugerido PR2: hooks `useDebts/useSubscriptions/useTasks/useEvents/useGoals/useSavingsGoals/usePreferences/useUpdateLayout` + toggles/persistencia + 3 cards mes (tasks Fase B restantes + Fase F parcial + Fase D mes).

## 7. Workload / PR boundary

- Review Forecast original: 1150–1450 líneas totales, `400-line budget risk: High`, `Chained PRs: Yes`, `Chain strategy: pending`, `Decision needed: Yes`.
- Resolución consumida del delegado: `stacked-to-main, eslabón 1 de 4, ask-on-risk con cadena aprobada` → se implementó SOLO el slice PR1 (transforms+apiPatch+i18n base), sin widgets/bell/hooks/e2e.
- PR1 real: 900 insertions / 1 deletion en 7 files (transforms.ts 489 es el grueso puro + tipos). Supera el ideal ~350/PR, pero es el slice mínimo coherente TDD (puros + su RED + apiPatch + i18n no se pueden partir sin romper GREEN). Riesgo anotado: PR2/PR3/PR4 deben mantenerse ≤350 c/u (hooks+toggles+mes ≈300, listas ≈300, bell+e2e ≈300) para compensar. Alternativa (partir transforms en dos PRs) se descartó por romper el orden TDD vinculante `transforms → hooks → widgets`.
- Rollback PR1: `git checkout -- frontend/lib/dashboard/transforms.ts frontend/lib/dashboard/transforms.test.ts frontend/lib/api/client.ts frontend/lib/api/client.test.ts frontend/lib/api/dashboard.ts frontend/lib/i18n/es.ts frontend/lib/i18n/i18n.test.ts`.

## 8. Structured status consumed / produced

Consumed (fallback manual, sin `gentle-ai sdd-status` nativo en este cwd; `openspec/` autoritativo en disco):
```yaml
schemaName: spec-driven
changeName: p8-home-pagos
artifactStore: openspec
planningHome:
  root: /home/david/Nextcloud2/Ubuntu/landing_personal
  changesDir: openspec/changes
changeRoot: openspec/changes/p8-home-pagos
artifactPaths:
  proposal: [openspec/changes/p8-home-pagos/proposal.md]
  specs: [openspec/changes/p8-home-pagos/specs/dashboard-widgets/spec.md, openspec/changes/p8-home-pagos/specs/notifications/spec.md]
  design: [openspec/changes/p8-home-pagos/design.md]
  tasks: [openspec/changes/p8-home-pagos/tasks.md]
  applyProgress: [openspec/changes/p8-home-pagos/apply-progress.md]
  verifyReport: [openspec/changes/p8-home-pagos/verify-report.md]
  syncReport: [openspec/changes/p8-home-pagos/sync-report.md]
contextFiles:
  proposal: [openspec/changes/p8-home-pagos/proposal.md]
  specs: [openspec/changes/p8-home-pagos/specs/dashboard-widgets/spec.md, openspec/changes/p8-home-pagos/specs/notifications/spec.md]
  design: [openspec/changes/p8-home-pagos/design.md]
  tasks: [openspec/changes/p8-home-pagos/tasks.md]
  applyProgress: [openspec/changes/p8-home-pagos/apply-progress.md]
  verifyReport: []
  syncReport: []
artifacts:
  proposal: done
  specs: done
  design: done
  tasks: done
  applyProgress: done
  verifyReport: missing
  syncReport: missing
taskProgress:
  total: 28
  complete: 11
  remaining: 17
  unchecked: [Fase B hooks x4, Fase D widgets x5, Fase E bell x3, Fase F toggles/composición x2, Fase G e2e/refactor x3]
deferredParentActions:
  total: 2
  complete: 0
  remaining: 2
  unchecked: [bounded review PR1→PR4, lifecycle gate Judgment Day + s1-capture/s2-crud]
taskArtifactErrors: []
applyState: ready
dependencies:
  apply: ready
  verify: blocked
  sync: blocked
  archive: blocked
actionContext:
  mode: repo-local
  workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal
  allowedEditRoots: [/home/david/Nextcloud2/Ubuntu/landing_personal]
  warnings: ["400-line budget risk High but stacked-to-main chain approved (1/4); PR1 slice only", "strict TDD active via parent (openspec/config strict_tdd=false overridden)", "skills-lock.json pre-modified, untouched"]
nextRecommended: parent-lifecycle
isNonAuthoritative: false
```

Produced: este `apply-progress.md` + 11 checkboxes `- [x]` persistidos en `tasks.md` (re-leídos y confirmados). No se crean receipts, no se inicia bounded-review, no se valida delivery gate (dueño orquestador).

## 9. Risks / notes

- Ventana 7d/14d usa día local del runtime (`es-CO` en prod). Tests usan `new Date(y,m,d)` local → deterministas en cualquier TZ del runner, pero e2e PR4 debe fijar TZ `America/Bogota` para no falsear bordes.
- `installment` es dinero, nunca fecha: deuda sin `due_date` excluida de próximos aunque tenga `installment`. Si BE añade `installment_due_date` futuro, se extenderá `UpcomingDebtLike` sin inventar.
- `source` puro = `kind`; el mapeo a `dashboard_layout` ids se cierra en PR4. `toNotificationCount` ya acepta `Set|string[]|Record|null`.
- i18n aditivo: `EsKey` ahora incluye `dashboard.*` + `notifications.*`; `t()` con `{n}/{date}/{amount}` verificado. Cero hardcode nuevo.

