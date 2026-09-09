# Verify Report — p8-home-pagos · PR2 (hooks SWR dashboard/* + 3 cards mes + toggles PATCH optimista/rollback)

> Change: `p8-home-pagos` · Scope verificado: PR2 (eslabón 2 de 4, stacked-to-main, base `p8-pr1`) · Fecha: 2026-09-09
> Base: `4ff492a feat(p8-pr1)` (working tree actual) · Modo: STRICT TDD activo (vía `apply-progress.md` + prompt delegado; `openspec/config.yaml` dice `strict_tdd: false`, override por padre — se aplican checks estrictos)
> Verificador: solo lectura + comandos de test (única escritura: este archivo; ningún fix aplicado, ningún otro archivo mutado)

## Verdict

**Status: PASS (PR2 slice) — NOT READY FOR ARCHIVE/SYNC**

- PR2 (hooks SWR `dashboard/*` + 3 cards mes + `WidgetToggle` + `PATCH /me/preferences` optimista/rollback) está verde, fiel a spec/diseño para su slice y sin scope-creep a PR3/PR4, Fase 1 ni backend.
- El change global NO está listo para archive ni sync: quedan 11 tareas implementation `- [ ]` (listas PR3, bell PR4 parcial, composición completa, e2e, refactor) + 2 parent diferidas. Esto es lo esperado en cadena 2/4 y no es un fallo de PR2, pero bloquea archive por regla de checkboxes.

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
  tasks: done (17/28 implementation [x], resto PR3–PR4 por diseño de cadena)
  applyProgress: done (PR2 acumulativo PR1+PR2)
  verifyReport: done (este archivo, sección PR2 + PR1 preservado)
  syncReport: missing
taskProgress:
  total: 28
  complete: 17
  remaining: 11
deferredParentActions:
  total: 2
  complete: 0
  remaining: 2
taskArtifactErrors: []
applyState: ready (PR3 pendiente, nada bloquea el siguiente eslabón)
dependencies:
  apply: ready
  verify: done (PR2 slice)
  sync: blocked (11 implementation restantes)
  archive: blocked (11 implementation restantes)
actionContext:
  mode: repo-local
  workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal
  allowedEditRoots: [/home/david/Nextcloud2/Ubuntu/landing_personal]
  warnings: ["verificación read-only salvo este reporte; ningún fix aplicado", "strict TDD activo por override de padre (config strict_tdd=false)", "HARD 350 cumplido vía compactación de tests declarada"]
nextRecommended: apply-PR3 (listas payments/debts/subs/tasks/events/goal sobre hooks PR2)
isNonAuthoritative: false
```

- Selección de change: explícita por el delegado (`p8-home-pagos`), confirmada en disco (`openspec/changes/p8-home-pagos/` con proposal/spec/design/tasks/apply-progress).
- Status contract resuelto vía fallback: `.pi/gentle-ai/support/sdd-status-contract.md` ausente → global `~/.pi/agent/gentle-ai/support/sdd-status-contract.md` usado como contrato (shape-compatible, verificado). `artifactStore: openspec` autoritativo en disco; no aplica carve-out `resolve-via-engram`.
- Ownership y edit-roots verificables dentro del workspace autoritativo; no se editaron archivos de implementación (solo lectura + `vitest`/`tsc` + este reporte).

## Test / validation commands (exactos, con resultado)

| Comando | Resultado |
|---|---|
| `pnpm --dir frontend exec vitest run` | ✅ **18 files / 160 tests passed** (Duration ~15.24s, jsdom). Esperado por delegado: 160 — **coincide exacto**. Baseline PR1: 15/150 → +10 (+7 dashboard hooks, +1 toggle, +2 widgets). Incluye `s1-capture`/`s2-crud` verdes (verbo `✓` en corrida verbose: S1 api/transforms/forms/history/ledger, S2 tareas/eventos/notas/metas). |
| `pnpm --dir frontend exec vitest run lib/api/dashboard.test.ts components/ui/WidgetToggle.test.tsx "components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx"` | ✅ **3 files / 10 tests passed** (Duration ~3.30s). Foco PR2: 7 hooks + 1 toggle + 2 widgets. |
| `pnpm --dir frontend exec tsc --noEmit` | ✅ **0 errores** (`TSC_EXIT:0`). |
| Fallos en la corrida final | Ninguno. Los RED históricos (`debtsKey/useDebts/... is not a function`, `useUpdateLayout is not a function`, `Failed to resolve ./WidgetToggle`, `Unable to find Ingreso del mes`) están en `apply-progress.md` §3 como evidencia del ciclo y no son reproducibles ahora porque el código ya está en GREEN — esto es lo esperado. |

## Diff verificado (PR2)

`git diff HEAD --stat` (HEAD=`4ff492a p8-pr1`, working tree = PR2) + `wc -l` untracked:

- Tracked código: `frontend/lib/api/dashboard.ts` (+90/-2), `frontend/components/containers/DashboardHome.tsx` (+38/-2), `frontend/components/containers/DashboardHome.test.tsx` (+7/-2) = **135 insertions / 6 deletions**.
- Nuevos untracked: `frontend/lib/api/dashboard.test.ts` (106), `frontend/components/ui/WidgetToggle.tsx` (17), `frontend/components/ui/WidgetToggle.test.tsx` (16), `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx` (39) = **178 líneas**.
- **Total PR2 código: 313 insertions + 6 deletions = 319 ≤ 350 HARD → ✅ PASS.** Excluidos del budget (no código PR2): `openspec/changes/p8-home-pagos/apply-progress.md` (+141), `tasks.md` (+6/-6), `skills-lock.json` (+6 preexistente `grill-me`), `tsconfig.tsbuildinfo` (build artifact), `.agents/.claude/.codegraph` (artefactos entorno, `??` preexistentes).
- Rollback documentado en apply-progress §7 coincide con este diff (checkout 3 tracked + rm 4 nuevos).

### Confirmación: sin backend, sin Fase 1, sin bell/resto-widgets

- `git diff HEAD --name-only | grep -E "^backend/"` → **CLEAN: cero diff backend** (también `git status --short | grep backend` CLEAN). Requisito spec `No backend change` y diseño §4.3 cumplido.
- `git diff HEAD --name-only | grep -Ei "FinanceSections|ManualCapture|TransactionsLedger|TransferHistory|ProductivitySections|ProductivityForms|s1-capture|s2-crud"` → **CLEAN: cero diff Fase 1**. Suite `s1-capture`/`s2-crud` verde en corrida propia confirma no-regresión.
- Bell/resto-widgets: `ls frontend/components/dashboard/widgets/` → solo `__tests__/DashboardHome.widgets.test.tsx`; `ls frontend/components/notifications/` → **no existe**; `ls frontend/e2e/` → solo `auth/dashboard/guards/helpers/sections` (sin `dashboard-widgets.spec` ni `notifications.spec`); `git status --short | grep -Ei "NotificationBell|NotificationList|useNotifications|UpcomingPayments|PendingDebts|ActiveSubs|PendingTasks|UpcomingEvents|GoalProgress|e2e"` → **CLEAN**. ✅ Solo slice PR2 (hooks + trio mes + toggles), resto queda para PR3/PR4 por diseño.
- Contenido spot-check: `debtsKey/subscriptionsKey/tasksKey/eventsKey/goalsKey/savingsGoalsKey` con prefijo `dashboard/` + `null` si oculto; `config { revalidateOnFocus:false }` reutilizado para los 7 hooks; `useUpdateLayout` con `apiPatch("/me/preferences", { dashboard_layout: next } satisfies PatchPreferencesBody)` + `optimisticData` + `rollbackOnError:true` + `revalidate:true`; `export type { NotificationItem } from transforms` (cero lógica duplicada, cierra desviación PR1 §5.2); `DashboardHome.tsx` trio mes con `toMonthSummary(flow.data, monthKey)` + `fmt()` (`formatMoney` con `locale/currency` de `GET /me`, default `es-CO`/`COP`) + `visible(id) ? ... : null` + `toggle→buildNextLayout→useUpdateLayout`; `WidgetShell` con prop `action?` sin romper firma + `MetricCard` con `t(dashboard.monthIncome/Expense/Savings)`; `WidgetToggle` botón `role="switch"` + `aria-checked` + `aria-label "${t(widgetHide/Show)}: ${id}"` + tokens `border-hull/text-instrument/hover:border-signal` sin hex + `focus-visible:outline-signal`; i18n sin diff (claves mes/toggles ya existían PR1, cero hardcode nuevo verificado por `grep t(`).

## Spec coverage (PR2 slice)

PR2 cubre hooks + trio mes + toggles/persistencia; listas, bell, composición completa y e2e pertenecen a PR3/PR4 por cadena y quedan pendientes (no es gap de PR2).

### dashboard-widgets/spec.md

| Requirement / Scenario | PR2 | Evidencia |
|---|---|---|
| Month Split — three separate `MetricCard` (`month-income/10`, `month-expense/11`, `month-savings/12`) con toggles propios; income/expense desde punto `monthKey` de `monthly-flow`, savings=income-expense, `formatMoney es-CO/COP` de `GET /me` | ✅ implementado + testeado | `DashboardHome.tsx` 3 bloques `visible(id)` + `MetricCard label=t(monthIncome/Expense/Savings) display=fmt(summary.*)` + `currentMonthKey(new Date())` dinámico; tests `DashboardHome.widgets.test.tsx` 2 casos: 3 títulos + `/1\.000/` + `/400/` + `/600/` (fixtures `income:"1000.00" expense:"400.00"`) y toggles `≥3 switches` + PATCH sin `month-income` + round-trip. `locale=prefs...locale ?? es-CO`, `currency=... ?? COP` verificado líneas 160-164. |
| String-money boundary (wire `string\|number` → `toNumber` solo en borde, UI recibe numbers) | ✅ | Wires `pending_amount/price/goal/saved: string\|number\|null` intactos en MSW (`"320.00"`, `"9.99"`, `"1000.00"`); UI usa `toMonthSummary`/`formatMoney`, nunca `parseFloat` directo (grep `formatMoney/toMonthSummary` + `toNumber` solo en transforms/money). |
| Customization/Persistence — toggle propio por widget, `PATCH /me/preferences { dashboard_layout: { widgets:[...] } }` exacto, hidden ⇒ no fetch + no render, fallback 9 visibles, round-trip `GET→PATCH→GET` | ✅ parcial PR2 (trio mes + fundación para 9) | `resolveDashboardLayout([]/null→DEFAULT 9 ids)`, `isWidgetVisible`, `buildNextLayout` hide/show + `sort(order)`; `debtsKey(v)/.../eventsKey(...,v)` → `null` cuando oculto + `useSWR(null)` ⇒ no fetch (test `hidden→"hidden"` + `seen.length 0`); `visible(id)?...:null` ⇒ no render; `useUpdateLayout` envelope exacto + optimista + rollback 422 (test `patchBody toEqual {dashboard_layout...}` + `threw=true` en 422); round-trip trio mes (`layoutWidgets` mutado + `seenPatch` sin `month-income`). Composición 9 widgets + header Bell + loading extendido + retry `dashboard/` completo queda para PR3/PR4 (declarado §5.7, consciente para budget). |
| Composition Constraints — FE-only, cero BE, wire contracts, `frontend-dashboard` (bento, teclado/foco, `prefers-reduced-motion`, tokens sin hex, `output:export`+Axum+SPA, bearer+401, sin `/wealth`), `frontend-i18n` (ES único, `t(key,vars)`), no Fase 1 | ✅ para este slice | Cero BE/Fase1 (CLEAN arriba); `dashboard/*` keys + `revalidateOnFocus:false` heredado; `t()` en `WidgetToggle`+trio mes, cero hardcode nuevo; sin hex en nuevos (grep CLEAN); `role=switch`+`aria-checked`+foco visible; SSR-safe (hooks con `null` key, sin `window` directo en este slice); Fase 1 intacta + `s1/s2` verdes. Full bento 9 + Bell + `prefers-reduced-motion` se verifica en PR3/PR4. |
| Upcoming Payments / Pending Debts / Active Subs / Pending Tasks / Upcoming Events / Goal Progress / Loading-Error-Empty (listas) | ➖ pendiente PR3 | Hooks base ya verdes (`useDebts/subs/tasks/events/goals/savingsGoals` + MSW `t1:e1:g1:sg1:s1`), pero sin `UpcomingPayments/PendingDebts/ActiveSubs/PendingTasks/UpcomingEvents/GoalProgress.tsx` ni sus casos (CLEAN confirmado). Lógica pura ya cubierta en PR1. |

### notifications/spec.md

| Requirement / Scenario | PR2 | Evidencia |
|---|---|---|
| Bell/badge/panel/mute/delivery (UI) | ➖ pendiente PR4 (correcto) | Sin `useNotifications/NotificationBell/NotificationList`, sin `p8-notif-muted`, sin e2e notif (CLEAN). |
| Item Contract fundación (`NotificationItem` sin duplicar + `toNotificationCount` reúso) | ✅ | `export type { NotificationItem } from transforms` + test triangulación `toNotificationCount(items,null,null)=1` y con mute `{a:true}=0` (reúso, no reimpl). Mapeo widget→fuente se cierra en PR4. |

Desviaciones `apply-progress.md` §5 (7 ítems: `.ts` con `createElement` por path exacto, helpers `*Key` exportados, fallback `[]`/ausente→DEFAULT con validación profunda delegada a BE, trio mes en `div+MetricCard` no `WidgetShell` por firma, mock `...mod`+stub, i18n sin diff, composición Fase F parcial): revisadas, coherentes con spec/diseño, declaradas explícitamente. Ninguna rompe aceptación; validación FE estricta queda para REFACTOR PR4.

## Task completion (checkboxes)

- Completadas acumuladas: **17/28 implementation `- [x]`** (11 PR1 + 6 PR2: Fase B 4 hooks + Fase D mes + Fase F toggle). `grep -c "^- \[x\]" tasks.md` = 17 (verificado; coincide con apply-progress §1). ✅ Ninguna tarea PR2 queda sin marcar; Fase F composición completa sigue `- [ ]` correctamente como parcial (solo trio mes + toggles, 9 widgets + bell para PR3/PR4).
- Restantes (bloquean archive, esperadas en cadena 2/4) — 11 implementation + 2 parent, líneas exactas byte-for-byte:

```text
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
- [ ] Start or reuse bounded review of PR1→PR4 chain before merge. <!-- sdd-owner: parent -->
- [ ] Confirm lifecycle gate (Judgment Day + `s1-capture`/`s2-crud` green) before `main` merge. <!-- sdd-owner: parent -->
```

Archivo: `openspec/changes/p8-home-pagos/tasks.md` (11 implementation + 2 parent; `grep -n "^- \[ \]"` verificado).

## TDD Compliance (Strict TDD activo por override)

Soporte leído: global `~/.pi/agent/gentle-ai/support/strict-tdd-verify.md` (proyecto `.pi/.../strict-tdd-verify.md` ausente → se usa global sin override). Tabla `TDD Cycle Evidence` presente en `apply-progress.md` §4 (10 filas PR2). Verificación fila por fila:

| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | ✅ | Tabla §4 con 10 filas (keys/null-key, fetch string-money, hidden skip, layout fallback/toggle, envelope+rollback, NotificationItem, revalidateOnFocus estructural, WidgetToggle, trio mes+round-trip, no-regresión). |
| All tasks have tests | ✅ | 6/6 tareas PR2 con test file (`dashboard.test.ts` 7 casos, `WidgetToggle.test.tsx` 1, `DashboardHome.widgets.test.tsx` 2). |
| RED confirmed (tests exist) | ✅ | 3 test files existen con los casos RED citados (`debtsKey/useDebts/... is not a function`, `useUpdateLayout is not a function`, `Failed to resolve ./WidgetToggle`, `Unable to find Ingreso del mes`); cross-ref paths exactos de tasks. |
| GREEN confirmed (tests pass) | ✅ | Foco 3/10 passed + suite 18/160 passed en ejecución propia; `tsc` 0. Ningún GREEN reportado falla ahora. |
| Triangulation adequate | ✅ | ≥2 casos por comportamiento: keys (6 asserts `dashboard/*` + null-hidden + `tasksKey(null)` + `eventsKey(null,null)`), fetch (MSW `d1:320.00` + `t1:e1:g1:sg1:s1` wire string/number), hidden (probe `visible=false` + `eventsKey(...,false)=null`), layout (vacío→9 ids + hide→false + show→true), envelope (ok→`done` contiene envelope + 422→`threw`), toggle (`true→click→false` + rerender `false→aria false`), trio (`1.000/400/600` + `switches≥3` + envelope sin `month-income`). Skip justificado solo para `revalidateOnFocus:false` estructural (constante compartida, sin branching — aceptable igual que PR1 `apiPatch` espejo). |
| Safety Net for modified files | ✅ | Baseline pre-PR2 citado (tsc 0 + 15/150 verdes heredado PR1); `DashboardHome.test.tsx` mock extendido `...mod`+stub mantiene 5 casos previos verdes (error/loading/telemetry/streak); `dashboard.ts`/`DashboardHome.tsx` son extensiones aditivas verificadas por suite completa + `tsc`. |

**TDD Compliance**: 6/6 checks passed (10/10 filas con RED→GREEN→TRIANGULATE/skip-justificado→REFACTOR re-green; Three Laws respetada según reporte).

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit (funciones puras sin render/red: keys, layout helpers, count) | ~4 (dentro de `dashboard.test.ts`: keys/null-key, layout fallback/toggle, count triangulación) | 1 parcial (`dashboard.test.ts`) | vitest |
| Integration (MSW HTTP + render Testing Library: fetch string-money, hidden skip, PATCH envelope/rollback, cards, toggles) | ~6 (3 MSW fetch/hidden/PATCH + 1 toggle + 2 widgets) | 3 (`dashboard.test.ts` MSW + `WidgetToggle.test.tsx` + `DashboardHome.widgets.test.tsx`) | vitest + msw/node + @testing-library/react |
| E2E | 0 | 0 | no aplica en PR2 (Playwright reservado a PR4) |
| **Total (foco PR2)** | **10** | **3** | |
| **Total (suite FE)** | **160** | **18** | |

Capas coherentes con el slice: hooks con MSW real + UI con Testing Library, sin E2E todavía. Sin warnings de capabilities (msw/testing-library ya presentes).

## Changed File Coverage

Coverage analysis skipped — no coverage tool detected (no se invocó `--coverage`; `openspec/config.yaml` no define umbral). Los 7 artefactos código PR2 (3 tracked + 4 nuevos) están ejercitados por los 10 tests del foco (cada export nuevo — `debtsKey/subscriptionsKey/tasksKey/eventsKey/goalsKey/savingsGoalsKey`, `resolveDashboardLayout/isWidgetVisible/buildNextLayout`, `useDebts/subs/tasks/events/goals/savingsGoals/useUpdateLayout`, `WidgetToggle`, trio mes — tiene al menos un caso directo), pero sin porcentajes instrumentados.

## Assertion Quality

| File | Line | Assertion | Issue | Severity |
|---|---|---|---|---|
| `frontend/lib/api/dashboard.test.ts` | keys block | `toBe("dashboard/debts")` / `toBeNull()` / `toContain("dashboard/events?")` (10 asserts) | Verifican conducta real (prefijo + null-key por visible); sin tautología | — |
| `frontend/lib/api/dashboard.test.ts` | fetch blocks | `findByText("d1:320.00")` + `seen.includes("/debts")`, `findByText("t1:e1:g1:sg1:s1")`, `findByText("hidden")` + `seen.length 0` | String-money intacto + skip-fetch; compañero non-empty/hidden por setup — no es `toEqual([])` huérfano | — |
| `frontend/lib/api/dashboard.test.ts` | layout block | `toContain("month-income")`, `toBe(true/false)` hide/show | Fallback 9 + toggle; valores reales | — |
| `frontend/lib/api/dashboard.test.ts` | PATCH block | `toEqual({ dashboard_layout: objectContaining({widgets:any(Array)}) })` + `toContain("dashboard_layout")` + `toBe(true)` threw en 422 | Envelope exacto + rollback; no solo `toBeDefined` | — |
| `frontend/components/ui/WidgetToggle.test.tsx` | switch | `toHaveAttribute("aria-checked","true"/"false")` + `toHaveBeenCalledWith(false)` | Conducta accesible + callback con valor exacto; no smoke-only, no CSS | — |
| `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx` | trio | `findByText("Ingreso del mes"/"Gasto del mes"/"Ahorro del mes")` + `/1\.000/` + `/400/` + `/600/` + `switches.length ≥3` | `/400/`/`/600/` son regex laxas pero ancladas por los 3 títulos + `formatMoney`; aceptable para este slice (e2e PR4 debe fijar `America/Bogota` y asserts exactos) | INFO (no bloquea) |
| general | — | `expect(true).toBe(true)` / tautologías | No encontradas | — |
| general | — | Ghost loops (`forEach`/`queryAll` con asserts) | No encontrados (`getAllByText` con `length ≥1` tiene asserts directos, no loop fantasma) | — |
| general | — | Smoke-only (`render` + `toBeInTheDocument` sin conducta) | No: cada render sigue con toggle/PATCH/round-trip o valores | — |
| general | — | CSS/implementation-detail (`className`, `mock.calls.length`) | No encontrados (solo `aria-checked`/`role=switch`, conducta pública) | — |
| general | — | Mock-heavy | `vi.fn` (mutate/onToggle/seenPatch) vs ~30 `expect()` en foco — ratio sano; mocks siguen patrón existente (`...mod`, `next/dynamic→null`) | — |

**Assertion quality**: 0 CRITICAL, 0 WARNING (1 INFO por regex laxa aceptada). ✅ Todas las aserciones verifican conducta real (keys, fetch, skip, envelope, rollback, copy ES, montos).

## Quality Metrics

- **Type Checker**: ✅ 0 errores (`tsc --noEmit`, `TSC_EXIT:0` en ejecución propia).
- **Linter**: ➖ No ejecutado (el delegado pidió solo vitest + tsc).

## Review Workload / PR boundary

- Forecast (`tasks.md`): 1150–1450 líneas, `400-line budget risk: High`, `Chained PRs: Yes`, `Chain strategy: pending`, `Decision needed: Yes`.
- Resolución consumida: `stacked-to-main, eslabón 2 de 4, base rama p8-pr1` (delegado PR2, citado en apply-progress) → solo slice hooks + trio mes + toggles/persistencia. ✅ Estrategia cerrada, ya no `pending`.
- Slice implementado: SOLO PR2. ✅ Sin bell/resto-widgets/e2e (CLEAN arriba), sin backend/Fase 1 (CLEAN), sin reabrir PR1 salvo extensión aditiva (`dashboard.ts` + `DashboardHome.tsx` + mock no-regresión). Sin scope-creep.
- Tamaño: ✅ **319 ≤ 350 HARD** (313 insertions + 6 deletions; tracked 135 + nuevos 178). Compactado tests 249→178 declarado sin perder cobertura (RED/GREEN/TRIANGULATE intactos). No hay marcador `size:exception` en `tasks.md` y no se necesita (dentro de budget). Rollback por archivo documentado y coincide con el diff.
- `skills-lock.json` (+6 `grill-me`) + `tsconfig.tsbuildinfo` + `.agents/.claude/.codegraph`: ajenos al change, preexistentes, excluidos del budget. Señalado para que el orquestador los excluya del merge de la cadena.

## Blockers (exactos)

1. **CRITICAL — Archive/sync bloqueados por 11 tareas implementation `- [ ]` restantes** (listas PR3 ×4, bell PR4 ×3, composición completa ×1, e2e ×2, refactor ×1; líneas exactas en §Task completion). Esperado en cadena 2/4; el siguiente paso es apply-PR3, no archive. No se retorna PASS limpio ni ready-for-archive.
2. **INFO — 2 tareas `sdd-owner: parent` diferidas** (bounded review PR1→PR4, lifecycle gate Judgment Day + `s1-capture`/`s2-crud` green). Dueño orquestador, intactas.
3. Sin otros bloqueadores: specs/diseño/tasks/apply-progress presentes y coherentes; suite 160 verde; `tsc` 0; cero diff BE/Fase1/bell; budget cumplido; TDD 6/6; assertions 0 CRITICAL.

## Recomendación

- **Merge del slice PR2 dentro de la cadena stacked-to-main: SÍ** (verde, acotado a 319, con evidencia TDD completa y rollback documentado).
- **Merge a `main` / archive del change: NO** hasta PR3→PR4 + `s1-capture`/`s2-crud` verdes + Judgment Day (dueño orquestador).
- PR3 debe: construir listas sobre hooks PR2 ya verdes, mantener budget ≤350, y no reabrir hooks salvo REFACTOR final previsto.

---

## PR1 history (preserved, no overwrite — contenido original íntegro debajo)

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
