# Verify Report — p8-home-pagos · PR1 (transforms + apiPatch + i18n)

> Change: `p8-home-pagos` · Scope verificado: PR1 (eslabón 1 de 4, stacked-to-main) · Fecha: 2026-09-09
> Base: `main@8f452df` · Modo: STRICT TDD activo (vía delegado; `openspec/config.yaml` dice `strict_tdd: false`, override por prompt padre + `apply-progress.md`)
> Verificador: solo lectura + comandos de test (única escritura: este archivo)

## Verdict

**Status: PASS (PR1 slice) — NOT READY FOR ARCHIVE/SYNC**

- PR1 (transforms puros + `apiPatch` + tipos layout + i18n base) está verde, fiel a spec/diseño y sin scope-creep a PR2/PR3/PR4, Fase 1 ni backend.
- El change global NO está listo para archive ni sync: quedan 17 tareas implementation `- [ ]` (PR2 hooks/widgets, PR3 listas, PR4 bell/e2e) + 2 parent diferidas. Esto es lo esperado en una cadena 1/4 y no es un fallo de PR1, pero bloquea archive por regla de checkboxes.

## Structured status / actionContext

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
artifacts:
  proposal: done
  specs: done
  design: done
  tasks: done (11/28 implementation [x], resto PR2–PR4 por diseño de cadena)
  applyProgress: done
  verifyReport: done (este archivo)
  syncReport: missing
taskProgress:
  total: 28
  complete: 11
  remaining: 17
applyState: ready (PR2 pendiente, nada bloquea el siguiente eslabón)
dependencies:
  apply: ready
  verify: done (PR1 slice)
  sync: blocked (17 implementation restantes)
  archive: blocked (17 implementation restantes)
actionContext:
  mode: repo-local
  workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal
  allowedEditRoots: [/home/david/Nextcloud2/Ubuntu/landing_personal]
  warnings: ["verificación read-only salvo este reporte; ningún fix aplicado"]
nextRecommended: apply-PR2 (hooks + toggles/persistencia + 3 cards mes)
isNonAuthoritative: false
```

- Selección de change: explícita por el delegado (`p8-home-pagos`), confirmada en disco (`openspec/changes/p8-home-pagos/` con proposal/spec/design/tasks/apply-progress).
- Ownership de implementación y scope de edición verificables dentro del workspace autoritativo; no se editaron archivos de implementación (solo lectura + test + este reporte).

## Test / validation commands (exactos, con resultado)

| Comando | Resultado |
|---|---|
| `pnpm --dir frontend exec vitest run` | ✅ **15 files / 150 tests passed** (Duration ~10s). Baseline pre-cambio citado en apply-progress: 15 files / 127 tests → +23 (+16 transforms, +3 client, +4 i18n). |
| `pnpm --dir frontend exec vitest run lib/dashboard/transforms.test.ts lib/api/client.test.ts lib/i18n/i18n.test.ts` | ✅ **3 files / 51 tests passed**. |
| `pnpm --dir frontend exec tsc --noEmit` | ✅ **0 errores** (`TSC_EXIT:0`). |
| Fallos en la corrida final | Ninguno. Los RED históricos (3+5+5+3+4 failed) están registrados en `apply-progress.md` §3 como evidencia del ciclo y no son reproducibles ahora porque el código ya está en GREEN — esto es lo esperado. |

## Diff verificado (PR1)

`git diff --name-only` (unstaged, rama `master` sobre `8f452df`):

- `frontend/lib/dashboard/transforms.ts` (+489)
- `frontend/lib/dashboard/transforms.test.ts` (+236)
- `frontend/lib/api/client.ts` (+18, `apiPatch`)
- `frontend/lib/api/client.test.ts` (+48, 3 casos apiPatch + handlers MSW PATCH)
- `frontend/lib/api/dashboard.ts` (+37/-1, solo tipos layout + default, sin hooks)
- `frontend/lib/i18n/es.ts` (+37, `dashboard.*` 25 claves + `notifications.*` 10 claves, aditivo)
- `frontend/lib/i18n/i18n.test.ts` (+36)
- `skills-lock.json` (+6, preexistente ajeno al change: entrada `grill-me` mattpocock/skills; no tocado por este apply, verificado por diff)

Total: 906 insertions(+), 1 deletion(-) en 8 files (7 del change + skills-lock ajeno).

### Confirmación 2: sin widgets/bell/hooks (PR2/PR3) ni Fase 1 ni backend

- `git diff --name-only | grep -E "^backend/"` → **CLEAN: no backend diff**.
- `grep -E "FinanceSections|ManualCapture|TransactionsLedger|TransferHistory|ProductivitySections|ProductivityForms|s1-capture|s2-crud"` → **CLEAN: no Fase1 diff**.
- `grep -E "widgets/|notifications/|DashboardHome|WidgetToggle|dashboard\.test|e2e/"` → **CLEAN: no widgets/bell/e2e diff**.
- `git diff frontend/lib/api/dashboard.ts | grep -E "useDebts|useSubscriptions|useTasks|useEvents|useGoals|useSavingsGoals|useUpdateLayout|useNotifications|NotificationBell"` → **CLEAN: dashboard.ts es tipos-only** (`DashboardWidgetType/Size`, `DashboardWidgetPref`, `DashboardLayout`, `DEFAULT_DASHBOARD_LAYOUT` 9 ids/orders §5.1 diseño, `PreferencesWire.dashboard_layout?`, `PatchPreferencesBody`). Hooks quedan para PR2 como declara `apply-progress.md` §1/§5.6.
- Contenido spot-check: `apiPatch` espejo exacto de `apiPost` (JSON+Bearer+401 single-flight+`toApiError`); `transforms.ts` expone `UPCOMING_PAYMENTS_WINDOW_DAYS=7`, `UPCOMING_EVENTS_WINDOW_DAYS=14`, `upcomingRank` deudas(0)>events(1)>subs(2), `parseDueDate` YYYY-MM-DD local vs RFC3339 con null ante inválido, `installment` nunca usado como fecha, `compareDayAscNullsLast`, `clampPct`, `toNumber` solo en borde; i18n copia exacta `noOverdue: "Sin vencidas 🎉"`, `noUpcoming: "Nada por vencer en 7 días"`.

## Spec coverage (PR1 slice)

PR1 cubre la capa pura/tipos/i18n; los escenarios de render UI, bell, toggles, persistencia round-trip y e2e pertenecen a PR2–PR4 por diseño de cadena y quedan pendientes (no es gap de PR1).

### dashboard-widgets/spec.md

| Requirement / Scenario | PR1 | Evidencia |
|---|---|---|
| Month Split (three cards income=1000/expense=400/savings=600; string-money boundary) | ✅ lógica pura | `toMonthIncome/Expense/Savings/Summary` + tests (monthKey actual, ahorro negativo, wire string, null/ausente → 0). Render en cards → PR2/PR3. |
| Upcoming Payments 7d (unión, bordes hoy/+7 incl., +8 excl., dateless excluida, orden deudas>events>subs) | ✅ lógica pura | `toUpcomingPayments` + 3 tests unión/orden + bordes + dateless + triangulación RFC3339 bueno/malo + `kind` filtro. Widget `UpcomingPayments.tsx` → PR3. |
| Pending Debts (solo active + pending_amount) | ✅ lógica pura | `toPendingDebts` + test filtro active/paid_off + orden nulos-al-final. Widget → PR3. |
| Active Subs (solo is_active) | ✅ lógica pura | `toActiveSubs` + test. Widget → PR3. |
| Pending Tasks (orden asc) | ✅ lógica pura | `toPendingTasks` + test. Widget → PR3. |
| Upcoming Events 14d sin contaminar bell | ✅ lógica pura | `toUpcomingEvents(windowDays=14 default)` + test e10 10d visible en widget pero `kind=event` excluido de `toUpcomingPayments`/bell. Widget → PR3. |
| Goal Progress 2 segmentos (Metas progress + Ahorro saved/goal, un widget) | ✅ lógica pura | `toGoalProgress` + tests pct 60/50 + clamp 250→100 + goal 0→0 + `target_amount/saved_amount` alterno. Widget → PR3. |
| Loading/Error/Empty, Customization/Persistencia, Composición (toggles, PATCH envelope, fallback 9 visibles, no-BE, ES tipado, no-Fase1) | ➖ parcial PR1 | Tipos `DashboardLayout`/`DEFAULT_DASHBOARD_LAYOUT` (9 ids/orders 10/11/12/20/21/22/23/24/30 exactos) + `PatchPreferencesBody` + `apiPatch` + i18n aditivo verificados. Comportamiento UI (toggle=null-key, round-trip, EmptyState render, retry) → PR2–PR4. Cero diff BE/Fase1 confirmado. |

### notifications/spec.md

| Requirement / Scenario | PR1 | Evidencia |
|---|---|---|
| Bell placement/badge, Panel secciones, Mute semántica, Delivery constraints (UI) | ➖ pendiente PR4 | Sin `NotificationBell/List/useNotifications` en el diff (confirmado CLEAN). |
| Item Contract pura (overdue=task+debt+event; upcoming=misma unión 7d; bordes; dateless excluida; montos string→number en borde; `NotificationItem`) | ✅ lógica pura | `toOverdueItems` (task vencida+debt ayer+event hace 1h; excluye futuro/completado/paid_off) + `toUpcomingPayments` bordes + `toNotificationItems` (concat 5) + `toNotificationCount` (mute 1→4, hidden debt/task→3; firmas `Set|string[]|Record|null`) + `NotificationItem` en `transforms.ts` (desviación declarada §5.2: PR2 lo re-exporta desde `dashboard.ts`). Copy vacíos `noOverdue/noUpcoming` exactos en `es.ts`. |

Desviaciones de `apply-progress.md` §5 (`toMonthSummary` wrapper, `NotificationItem` en transforms, `source`=kind, `windowDays` param, `SavingsGoalLike` dual, dashboard.ts tipos-only): revisadas, coherentes con spec/diseño, declaradas explícitamente. Ninguna rompe aceptación. La ubicación final de `NotificationItem` debe cerrarse en PR2 (re-export, sin duplicar lógica).

## Task completion (checkboxes)

- Completadas PR1: **11/28 implementation `- [x]`** (Fase A 7 + Fase B apiPatch 2 + Fase C i18n 2). `grep -c "^- \[x\]" tasks.md` = 11. ✅ Ninguna tarea PR1 queda sin marcar.
- Restantes (bloquean archive, esperadas en cadena 1/4) — 17 implementation + 2 parent, líneas exactas:

```text
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
- [ ] Start or reuse bounded review of PR1→PR4 chain before merge. <!-- sdd-owner: parent -->
- [ ] Confirm lifecycle gate (Judgment Day + `s1-capture`/`s2-crud` green) before `main` merge. <!-- sdd-owner: parent -->
```

Archivo: `openspec/changes/p8-home-pagos/tasks.md` líneas 50–53, 62–66, 70–72, 76–77, 81–83, 87–88.

## TDD Compliance (Strict TDD activo)

| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | ✅ | Tabla `TDD Cycle Evidence` presente en `apply-progress.md` §4 (10 filas). |
| All tasks have tests | ✅ | 11/11 tareas PR1 con test file (transforms/client/i18n). |
| RED confirmed (tests exist) | ✅ | 3 test files existen y contienen los casos RED citados (month 3, upcoming 3+2, pending/goal/notif 5, triangulate 3, apiPatch 3, i18n 4). |
| GREEN confirmed (tests pass) | ✅ | 51/51 en los 3 files + 150/150 suite completa en ejecución propia. |
| Triangulation adequate | ✅ | ≥2 casos por comportamiento (happy+edge: ahorro negativo/wire-string/null; bordes hoy/+7/+8; RFC3339 bueno/malo; installment-sin-fecha; nulos-al-final+clamp; JSON+Bearer/401/422; 9 títulos+empties+interpolación). `➖ Single` no aplica; skips declarados solo para `apiPatch`-refactor espejo y tipos estructurales sin branching (aceptable). |
| Safety Net for modified files | ✅ | Baseline pre-cambio citado (tsc 0 + 127 verdes); `client.ts`/`es.ts` son extensiones aditivas con MSW/handlers y suite previa intacta; `dashboard.ts` tipos-only verificado por `tsc --noEmit` 0. |

**TDD Compliance**: 6/6 checks passed (10/10 filas de evidencia con RED→GREEN→TRIANGULATE/skip-justificado→REFACTOR re-green).

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit (funciones puras, sin render/red) | ~43 | 2 (`transforms.test.ts` 27+11 preexistentes parcial, `i18n.test.ts` 12+5 preexistentes parcial) | vitest |
| Integration (MSW HTTP real: JSON+Bearer+401+422) | ~12 | 1 (`client.test.ts`, incluye 9 preexistentes) | vitest + msw/node |
| E2E | 0 | 0 | no aplica en PR1 (Playwright reservado a PR4) |
| **Total (foco PR1)** | **51** | **3** | |
| **Total (suite FE)** | **150** | **15** | |

Capas coherentes con el slice: la lógica pura se testea en unit, `apiPatch` en integración MSW, sin E2E todavía. Sin warnings de capabilities.

## Changed File Coverage

Coverage analysis skipped — no coverage tool detected (no se invocó `--coverage`; `openspec/config.yaml` no define umbral). Los 7 files del change están ejercitados por los 51 tests del foco (cada export nuevo tiene al menos un caso directo), pero sin porcentajes instrumentados.

## Assertion Quality

| File | Line | Assertion | Issue | Severity |
|---|---|---|---|---|
| `frontend/lib/i18n/i18n.test.ts` | 35–43, 47–51, 55–57 | `expect(t("dashboard.*")).toBeTruthy()` (14× presencia) | Type-only/presencia sin valor exacto — combinado en el mismo bloque con aserciones exactas (`noOverdue`/`noUpcoming` literales + interpolación `{n}/{date}/{amount}` exacta), por lo que es aceptable para presencia de diccionario | INFO (no bloquea) |
| `frontend/lib/dashboard/transforms.test.ts` | 38–41, 170, 204, 248, 303 | `toEqual([])` vacíos | Cada vacío tiene compañero non-empty con mismo setup (unión 3 items, overdue 3 items, filtros active, evento 14d, installment fechado) — no es violación | — |
| general | — | `expect(true).toBe(true)` / tautologías | No encontradas | — |
| general | — | Ghost loops (`forEach`/`queryAll` con asserts) | No encontrados | — |
| general | — | Smoke-only (`render` + `toBeInTheDocument` sin conducta) | No encontrados (sin tests de render en PR1) | — |
| general | — | CSS/implementation-detail (`className`, `mock.calls.length`) | No encontrados | — |
| general | — | Mock-heavy | 1 `vi.fn` (redirect) vs 128 `expect()` en los 3 files — ratio sano | — |

**Assertion quality**: 0 CRITICAL, 0 WARNING (1 INFO aceptada en presencia i18n). ✅ Todas las aserciones verifican conducta real (valores, orden, ventanas, filtros, envelopes, copy exacta crítica).

## Quality Metrics

- **Type Checker**: ✅ 0 errores (`tsc --noEmit`, `TSC_EXIT:0`; incluye `@ts-expect-error` de llave desconocida en i18n).
- **Linter**: ➖ No ejecutado (el delegado pidió solo vitest + tsc).

## Review Workload / PR boundary

- Forecast (`tasks.md`): 1150–1450 líneas, `400-line budget risk: High`, `Chained PRs: Yes`, `Chain strategy: pending`, `Decision needed: Yes`.
- Resolución consumida: `stacked-to-main, eslabón 1 de 4, ask-on-risk con cadena aprobada` (citada en apply-progress). ✅ Estrategia cerrada, ya no `pending`.
- Slice implementado: SOLO PR1 (transforms+apiPatch+tipos+i18n). ✅ Sin widgets/bell/hooks/e2e (verificado CLEAN arriba). Sin scope-creep.
- Tamaño: ⚠️ PR1 real 900 insertions / 1 deletion en 7 files (el grueso es `transforms.ts` 489 + su test 236, inseparables sin romper el orden TDD `transforms → hooks → widgets`). Supera el ideal ~350/PR pero está **explícitamente registrado y justificado** en `apply-progress.md` §7 con plan de compensación (PR2/PR3/PR4 ≤350 c/u) y comando de rollback por archivo. No hay marcador `size:exception` literal en `tasks.md`; se trata como WARNING aceptado para este eslabón, no como CRITICAL, condicionado a que la cadena cumpla el budget restante. No se observó alternativa de partición viable sin romper GREEN.
- `skills-lock.json` (+6 `grill-me`): ajeno al change, preexistente, no atribuible a PR1. Señalado para que el orquestador lo excluya del merge de la cadena.

## Blockers (exactos)

1. **CRITICAL — Archive/sync bloqueados por 17 tareas implementation `- [ ]` restantes** (PR2 hooks, Fase D widgets, Fase E bell, Fase F composición, Fase G e2e/refactor; líneas exactas en §Task completion). Esperado en cadena 1/4; el siguiente paso es apply-PR2, no archive.
2. **INFO — 2 tareas `sdd-owner: parent` diferidas** (bounded review PR1→PR4, lifecycle gate Judgment Day + `s1-capture`/`s2-crud` green). Dueño orquestador, intactas.
3. Sin otros bloqueadores: specs/diseño/tasks/apply-progress presentes y coherentes; suite verde; cero diff BE/Fase1/widgets.

## Recomendación

- **Merge del slice PR1 dentro de la cadena stacked-to-main: SÍ** (verde, acotado, con evidencia TDD completa y rollback documentado).
- **Merge a `main` / archive del change: NO** hasta PR2→PR4 + `s1-capture`/`s2-crud` verdes + Judgment Day (dueño orquestador).
- PR2 debe: re-exportar/alinear `NotificationItem` en `dashboard.ts` (cerrar desviación §5.2), mantener budget ≤350 líneas, y no reabrir archivos PR1 salvo el refactor final previsto.
