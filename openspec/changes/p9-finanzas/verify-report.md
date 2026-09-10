# Verify Report — p9-finanzas · PR-2 FE S5 (eslabón 2 de 3, stacked-to-main)

- change: `p9-finanzas` · project: `personal-dashboard` · date: 2026-09-09
- slice: PR-2 FE S5 únicamente (7 forms por dominio + mutadores + `toDebtProgress` + montaje S5 + patrimonio-número) · rama: `p9-pr1` (incluye BE PR-1)
- store: openspec (`openspec/changes/p9-finanzas/verify-report.md`, sección PR-2 arriba, PR-1 preservada abajo)
- skill_resolution: `none` (el padre no inyectó `## Skills to load before work`; no se descubrieron skills adicionales; se siguió el contrato del prompt + `~/.pi/agent/gentle-ai/support/sdd-status-contract.md`)
- veredicto PR-2: **PASS (slice S5) con 1 RIESGO abierto + 1 WARNING de tamaño** — el diff FE cumple spec/diseño para el alcance asignado salvo la excepción de montaje de `SubscriptionRow` (§ Riesgo foco extra)
- veredicto change completo: **NOT READY for archive** — quedan 12 tareas implementation PR-3 (puros/charts/period/analysis/i18n/e2e/refactor) + 2 parent sin hacer (ver § Task completion)

## Structured status consumed + produced

```yaml
schemaName: spec-driven
changeName: p9-finanzas
artifactStore: openspec
planningHome:
  root: /home/david/Nextcloud2/Ubuntu/landing_personal
  changesDir: openspec/changes
changeRoot: openspec/changes/p9-finanzas
artifactPaths:
  proposal: [openspec/changes/p9-finanzas/proposal.md]
  specs: [openspec/changes/p9-finanzas/specs/budgets-write/spec.md, openspec/changes/p9-finanzas/specs/savings-write/spec.md, openspec/changes/p9-finanzas/specs/debts-write/spec.md, openspec/changes/p9-finanzas/specs/subscriptions-write/spec.md, openspec/changes/p9-finanzas/specs/cards-write/spec.md, openspec/changes/p9-finanzas/specs/assets-write/spec.md]
  design: [openspec/changes/p9-finanzas/design.md]
  tasks: [openspec/changes/p9-finanzas/tasks.md]
  applyProgress: [openspec/changes/p9-finanzas/apply-progress.md]
  verifyReport: [openspec/changes/p9-finanzas/verify-report.md]
artifacts:
  proposal: done
  specs: done
  design: done
  tasks: done
  applyProgress: done
  verifyReport: done  # esta sección PR-2; el reporte full cierra tras PR-3
  syncReport: missing
taskProgress:
  total: 30  # implementation-owned
  complete: 18  # 12 PR-1 + 6 PR-2
  remaining: 12
  unchecked: [tasks.md:105, 106, 107, 108, 109, 122, 123, 124, 128, 129, 133, 134]
deferredParentActions:
  total: 2
  complete: 0
  remaining: 2
  unchecked: [tasks.md:138, 139]
applyState: ready
dependencies:
  apply: ready  # PR-3 pendiente
  verify: ready  # este reporte cubre PR-2; verify full tras PR-3
  sync: blocked
  archive: blocked  # 14 unchecked restantes (12 implementation + 2 parent)
actionContext:
  mode: repo-local
  workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal
  allowedEditRoots: [/home/david/Nextcloud2/Ubuntu/landing_personal]
  warnings: []
nextRecommended: parent-lifecycle
isNonAuthoritative: false
```

Notas `actionContext`: `mode: repo-local` (autoritativo, store openspec con directorio `openspec/` presente); edición segura dentro del repo. Esta fase es solo-lectura + escritura de este reporte: no se mutó código, no se lanzaron subagentes, no se hicieron commits. Change selection inequívoca (`p9-finanzas` fijado por el prompt delegado, existe en `openspec/changes/`).

## Scope verificado (PR-2 S5)

Diff contra `HEAD` (rama `p9-pr1`), solo FE + artefactos SDD (untracked incluidos):

- Nuevos (7 archivos, 819 líneas según apply-progress): `frontend/components/finance/BudgetForm.tsx`, `SavingsForms.tsx`, `DebtPayments.tsx`, `SubscriptionForms.tsx`, `CardForm.tsx`, `CardDetail.tsx`, `AssetForms.tsx` — verificados existentes en disco (`??` en `git status`), contenido leído íntegro en esta fase.
- Modificados: `frontend/components/containers/FinanceScreens.tsx` (+55/−5: hooks S5 no-bloqueantes + `S5Sections` con 6 `SectionShell`), `frontend/lib/api/finance.ts` (+43: 16 mutadores §3.2 + `DebtPaymentWire`/`fetchDebtPayments`/`useDebtPayments` key `finance/debt-payments/{id}` + `AssetWire`/`fetchAssets`/`useAssets` key `finance/assets` + wires ampliados), `frontend/lib/finance/finance.ts` (+11: `toDebtProgress`), `frontend/lib/i18n/es.ts` (+44: ~40 claves `finance.*` S5), tests `frontend/lib/finance/finance.test.ts` (+18) + `frontend/components/finance/finance.test.tsx` (+224 con handlers base `/assets` + `/net-worth`).
- Sin BE, sin migraciones, sin Fase 1/2: `git diff HEAD --name-only -- backend/ migrations/` → vacío; `git diff --name-only HEAD | grep -Ei "ManualCapture|TransactionsLedger|TransferHistory|DashboardHome|widgets|notifications|Productivity"` → limpio. `backend/`, `migrations/` sin cambios tracked ni untracked. ✅

## Test / validation commands (ejecutados en esta fase, tal cual)

- `pnpm --dir frontend exec vitest run` → `Test Files 19 passed (19)` / `Tests 182 passed (182)`, Duration ~13.86s. ✅ coincide con lo esperado (182 tests). S1 intactos (los 10 tests previos de `finance.test.tsx` + puros siguen verdes dentro de los 182).
- `pnpm --dir frontend exec tsc --noEmit` → exit 0, sin output de errores (solo WARN ajeno de pnpm `onlyBuiltDependencies`). ✅
- Comandos tal cual del slice, sin fallos que reportar. No se corrió `cargo test` (BE intacto por diseño del slice; PR-1 lo dejó en 395 passed) ni e2e (alcance PR-3).

## Spec coverage (FE S5; BE PR-1 no re-verificado en código, solo no-regresión por ausencia de diff)

### Transversal S5 → PASS
- Montos string al BE: todos los forms normalizan a mano con `normalizeManualAmount` y envían strings (`BudgetForm` `wireAmount`, `SavingsDepositForm`/`SavingsGoalForm` `wire`, `DebtPayForm` `wire`, `SubscriptionCreateForm` `wirePrice`, `CardForm` `wireLimit`, `AssetValuationForm` `wire`); mutadores en `lib/api/finance.ts` tipan `amount/price/credit_limit/value: string` y no parsean (`sin parseo local` comentado). Tests MSW asertan método/URL/cuerpo con montos string (`"500.00"`, `"50.00"`, `"100.00"`, `"19900"`, `"5000000"`, `"1200.00"`). ✅
- Selects por nombre, cero UUIDs visibles: `BudgetForm`/`SavingsGoalForm`/`SubscriptionCreateForm`/`AssetForms` renderizan `<option>{c.name}/{a.name}</option>` con `value={id}` interno; tests asertan `getByText("Alimentación")` + `queryByText("c1") === null` y `queryByText("a1") === null`; grep de UUIDs `[0-9a-f]{8}-...` en los 7 forms → 0. ✅
- i18n: ~40 claves nuevas `finance.*` (`manage*`, forms/confirmaciones/errores/guards, `cardLimitDetail/cardAlert`, `assets/assetsHint`, thresholds); genéricos reusados de `productivity.*`; grep de literales hardcodeados en JSX nuevo (`>[A-ZÁ...]</` / `placeholder="[A-Z]`) → vacío; todo copy vía `t()`. ✅
- Montaje `FinanceScreens`: 6 `SectionShell` S5 (`manageBudgets/manageSavings/manageDebts/manageSubs/manageCards/manageAssets`) DESPUÉS de las tres F1 intactas (`ManualCaptureSection`, `TransactionsLedger`, `TransferHistory` presentes líneas 87/90/93, keys sin tocar); hooks S5 (`useFinanceCategories/useAssets/useNetWorth`) fuera del skeleton/alert S1 (línea 64-70, `queries` S1 sin incluirlos → no bloquean). Títulos propios sin hints de lectura (evita colisión con asserts S1 `findByText` simples). ✅

### budgets-write (FE form) → PASS (slice S5)
- `createBudget/patchBudget/deleteBudget` con claves reales `warn_threshold/over_threshold` (`finance.ts:280-282`); `BudgetForm` crear+editar (`budget?` opcional, categoría por nombre, monto `normalizeManualAmount`, dates `type="date"` YYYY-MM-DD, thresholds 0–2 defaults 0.8/1.0, notes, borrar con `window.confirm(finance.confirmDeleteBudget)`); invalidación `dashboard/budgets`. Test: POST/PATCH(`warn_threshold: 0.8`)/DELETE vía MSW + render + `monto abc → role=alert` + `sin UUID`. ✅ Never-block no afectado (sin tocar transactions). Draft-vs-wire resuelto en PR-1 (`warn/over`, no `warning/danger`).

### savings-write (FE forms) → PASS (slice S5)
- `patchGoal` + `createMovement/deleteMovement` (signed amount); `SavingsDepositForm` (abonar/retirar, guard cliente over-withdrawal `toNumber(wire) > saved → finance.overWithdrawal`), `SavingsGoalForm` (allowlist `name/description/target_amount/target_date/category_id/color`, crear vía `POST /savings-goals`, eliminar con `confirmDeleteGoal`); invalidación `finance/savings-goals` + `dashboard/savings-goals`. Tests: movements signed + patchGoal + renders + `sobrerretiro → alert`. ✅ Append-only preservado (sin PATCH de movements).

### debts-write (FE UI) → PASS (slice S5)
- `patchDebt` (nombres reales `creditor/installment/interest_rate`, nunca montos) + `createPayment/deletePayment` + `fetchDebtPayments/useDebtPayments` (key `finance/debt-payments/{id}`); `DebtPayForm` (guard `amount<=pending → finance.overPayment`, `paid_on` date, método), `DebtPaymentHistory` (vía `useDebtPayments`, corregir = `DELETE` + prefill `onCorrect` con `confirmDeletePayment`), `DebtProgressBar` (`toDebtProgress`, `role=progressbar`), `DebtEditForm` (solo metadata); invalidación `finance/debts` + `finance/debt-payments/{id}`. `toDebtProgress({original,pending})→{paid,remaining,pct,status}` verificado (`500/400 → paid 100, pct 0.2, ok`; `pending 0 → paid`; `pct≥0.7 → warn`; clamp [0,1]). Tests: abono feliz + `150>100 → alert` + historial (`/100/`) + corregir (DELETE 204 con `window.confirm=true`) + `Acreedor` label. ✅ Corrección DELETE+recreate con confirmación explícita cumple `No Payment Patch`.

### subscriptions-write (solo-FE) → PASS con RIESGO (ver § Riesgo foco extra)
- Wrappers `createSubscription/setSubscriptionActive(id,is_active)/deleteSubscription` (PATCH solo `{is_active}` línea 298); `SubscriptionCreateForm` (name/price manual/COP fija/frequency enum real 7 valores `daily…annual`/next_billing/category/payment_method/url/notes; precio `abc → alert`, sin request); `SubscriptionRow` (toggle solo `{is_active}` + borrar con `confirmDeleteSub`); invalidación `finance/subscriptions` + `dashboard/subscriptions`. Tests: POST/PATCH `{is_active}`/DELETE vía MSW + renders + `precio abc → alert` + fila `Cancelar`. ✅ Contrato BE intacto (sin endpoints nuevos; BE sin diff).
- RIESGO: acciones por fila NO expuestas en pantalla (solo en tests) — ver sección dedicada. No invalida el slice pero bloquea considerar la spec 100% visible al usuario.

### cards-write (solo-FE) → PASS (slice S5)
- `createCard` (`POST /accounts type=credit_card`, exige `credit_limit` string + ambos cycle days 1–31, espejo `validate_card_fields`); `CardForm` (incompleto → `alert`); `CardDetail` (solo formato: `límite=usado+disponible`, `cardLimitDetail/cardAlert` del BE, `limitChangeHint` DELETE+recreate ES `elimina y recrea`); invalidación `dashboard/accounts` + `dashboard/net-worth`. Tests: `POST /accounts` + renders + `incompleto → alert` + hint. ✅ Sin PATCH de límite (jamás enviado); anti-N+1 preservado (statement solo en detail vía `toAccountCards`, sin query por tarjeta).

### assets-write (FE forms + patrimonio) → PASS (slice S5)
- `patchAsset` (allowlist real) + `createValuation` (POST existente, guard cliente `recorded_on>máx → valuationDateError`); `AssetEditForm` (allowlist + archivar vía DELETE con `confirmArchiveAsset`) + `AssetValuationForm` (value + recorded_on date); `useAssets` key `finance/assets`; invalidación `finance/assets` + `dashboard/net-worth`. Patrimonio-número con `useNetWorth` existente (moneda de `GET /me`, fallback primera currency, `formatMoney`, `dashboard.netWorth`, `—` sin datos) montado en sección `manageAssets`. Tests: PATCH/valuation + renders + `fecha vieja → alert` + `a1 ausente`. ✅ Sin `GET /assets/{id}/valuations`, sin evolución del patrimonio, sin widget home.

## Riesgo foco extra — ¿acciones de suscripción por fila en pantalla o solo en tests?

**RIESGO CONFIRMADO: solo en tests, NO expuestas en pantalla.**

- Evidencia: `FinanceScreens.tsx:31` importa solo `{ SubscriptionCreateForm }` (no `SubscriptionRow`); `S5Sections` línea 198 monta únicamente `<SubscriptionCreateForm categories={categories} onDone={noop} />` en `SectionShell manageSubs`. `grep SubscriptionRow FinanceScreens.tsx` → 0 hits. `SubscriptionRow` existe (`SubscriptionForms.tsx:105`), funciona (toggle `{is_active}` + borrar con confirmación) y está unit-testeado (`finance.test.tsx:553` render directo con `sub s1` + assert botón `Cancelar`), pero ningún `S5Sections` ni otra pantalla lo instancia con datos reales (`useSubscriptions`).
- Consecuencia: el usuario puede CREAR suscripciones desde `/dashboard/finance`, pero NO puede cancelar/reactivar ni borrar ninguna suscripción existente desde la UI — las acciones `cancelSub/reactivateSub/confirmDeleteSub` son código muerto en producción hasta que se monten. La spec `subscriptions-write` exige exponer cancelar/reactivar (`PATCH {is_active}`) y borrar con confirmación; el criterio e2e PR-3 (`cancelar/reactivar sub`) fallará si intenta hacerlo desde pantalla.
- Causa declarada (apply-progress PR-2 desviación #2): montarlo duplicaría filas `Music`/lista S1 y rompería tests S1 (`findByText` simples). Decisión consciente para no romper S1, pero deja un gap de montaje.
- Alcance del riesgo: MEDIO. No rompe S1 ni BE; el componente está listo y testeado, el fix es solo montaje (p. ej. lista S5 propia con `useSubscriptions` filtrado o reutilización con queries disjuntas + asserts S1 endurecidos). Se reporta como RIESGO (no CRITICAL del slice porque la tarea `subs-forms` describe `por fila` como parte del componente, y el componente existe; pero el dueño debe decidir antes de PR-3/e2e si acepta el gap o exige el montaje).
- Observación vecina (no pedida, mismo patrón): `BudgetForm` se monta sin `budget` (solo crear; editar/borrar requieren prop no conectada a lista) y `SavingsGoalForm` sin `goal` (solo crear). No se marcan como riesgo formal porque sus specs FE se satisfacen vía mutadores + forms testeados, pero el e2e S5 (`confirmaciones crear/editar/borrar por dominio`) necesitará cablear edición contra listas reales igual que subs.

## Strict TDD compliance (STRICT activo vía prompt delegado + apply-progress; `openspec/config.yaml` trae `strict_tdd: false` pero el slice FE se trabajó en STRICT)

1. Guía: `~/.pi/agent/gentle-ai/support/strict-tdd-verify.md` consumida como referencia (sin override local `.pi/gentle-ai/support/strict-tdd-verify.md`). ✅
2. `apply-progress.md` contiene tabla `TDD Cycle Evidence` PR-2 (7 filas: `toDebtProgress`, budgets, savings, debts, subs, cards, assets+montaje) con RED/GREEN/TRIANGULATE/SAFETY/REFACTOR por tarea. ✅
3. Test files cross-referenciados y existentes: `frontend/lib/finance/finance.test.ts` (`toDebtProgress (S5 RED)`, 2 casos), `frontend/components/finance/finance.test.tsx` (bloques `finance S5 mutators` 2 tests + `finance S5 forms` 6 tests), `frontend/lib/finance/finance.ts:260-268` (`toDebtProgress`), `frontend/lib/api/finance.ts:276-309` (16 mutadores). Todos resuelven en el diff real. ✅
4. GREEN sigue vigente: `pnpm exec vitest run` 182 passed + `tsc --noEmit` exit 0 ejecutados en esta fase. ✅
5. Auditoría de calidad de asserts (muestreo): mutadores asertan método/URL/cuerpo concretos vía MSW (`warn_threshold === 0.8`, `url contiene /budgets/b1`, `seen contiene POST .../movements`); forms ejecutan handlers y muestran `role=alert` reales (monto `abc`, sobrerretiro 150>100, sobreabono 150>100, precio `abc`, tarjeta incompleta, valuación desordenada 09-01 ≤ 09-05); `toDebtProgress` compara objetos exactos (`{paid:100,remaining:400,pct:0.2,status:ok}`) + umbrales (`paid`/`warn`/`pct 0`); selects asertan ausencia de UUIDs (`queryByText("c1"/"a1") === null`). Sin tautologías, sin ghost-loops, sin asserts solo-de-tipo aislados, sin smoke-only (cada GREEN tiene compañera de borde), sin asserts CSS de detalle de implementación. ✅
6. Evidencia TDD completa para el slice S5; puros restantes (`toPeriodRange`, `toMonthOverMonth`, `toSavingsSeries`, `toBalanceSeries`, `toMonthCompare`, `toInsights`) y `useSpendByCategory(type)` quedan para PR-3 con sus ciclos propios (tareas 105-109 `- [ ]`, no se exige aquí). Sin faltantes CRITICAL en el slice. ✅

## Assertion quality findings

- PASS: asserts concretos y triangulares en mutadores + 6 forms + `toDebtProgress` (happy + borde por dominio).
- Sin hallazgos de tautología/ghost-loop/type-only/smoke-only/CSS-implementation-detail en la muestra S5.

## Review workload / PR boundary findings

- Forecast (tasks.md): `Chained PRs: Yes`, `Chain strategy: pending`, `Decision needed: Yes`, `400-line budget risk: High`, split sugerido PR-1 BE → PR-2 FE puros + forms S5 → PR-3 charts/analysis/i18n/e2e.
- Resolución: el padre fijó `stacked-to-main, eslabón 2 de 3` (registrado en apply-progress). Esta verificación confirma que **solo el slice asignado fue implementado**: 7 forms FE + mutadores + `toDebtProgress` + i18n S5 + montaje S5; cero BE, cero migraciones, cero Fase 1/2, cero archivos prohibidos. Sin scope creep (lo implementado es exactamente las 6 tareas S5 marcadas `[x]`). ✅
- `size:exception` NO registrada: el eslabón suma ~1210 líneas (7 nuevos 819 + 4 modificados ~150 prod + tests ~242 + i18n ~44), ~3× sobre el HARD BUDGET 400. El volumen es 6 forms funcionales con TDD (los tests S5 solos son 242), no alcance extra — pero si el mantenedor exige ≤400 por PR, hay que partir PR-2 (p. ej. budgets+savings+debts vs subs+cards+assets+montaje) o aceptar `size:exception`. **WARNING: el padre debe decidirlo antes del merge; no se partió unilateralmente.** (Hereda el WARNING ya levantado en apply-progress PR-2 + precedente PR-1 +1766.)
- `Chain strategy` coincide con el borde retornado: base `p9-pr1` (incluye BE PR-1), apila PR-3 (puros restantes + charts + PeriodSelector + Analysis + i18n cierre + e2e). Rollback FE = revert de los 11 archivos (7 nuevos + 4 modificados; S1 intacto: agregados, keys y tests S1 sin tocar). ✅
- `skills-lock.json` (+6) sigue modificado en el working tree, ajeno al slice (heredado de PR-1). WARNING menor: excluirlo del PR o justificarlo.
- Desviaciones aceptadas del apply (sin cambio de conducta pactada): `frequency yearly` → enum real 7 valores; títulos S5 propios `manage*` sin hints; `puros-1/api-wires` parciales (solo lo que S5 necesita); historial vacío sin `EmptyState` dedicado; `PATCH subs` siempre booleano. Todas documentadas en apply-progress y consistentes con el diff. ✅

## Task completion status

PR-2 S5: **6/6 implementation done** (budgets-form, savings-forms, debts-ui, subs-forms, cards, assets-forms+montaje S5) — todas en `- [x]` verificadas por grep (18/32 implementation acumuladas con PR-1). ✅

Restantes: **14 unchecked** (12 implementation PR-3 + 2 parent del dueño/orquestador). No son fallo de PR-2; son alcance de PR-3 y decisiones parent. **Archive NOT READY** mientras sigan unchecked.

Líneas `- [ ]` exactas restantes (verbatim de `tasks.md`):

```text
- [ ] RED FE puros-1: extender `frontend/lib/finance/finance.test.ts` con `toDebtProgress({original,pending})→{paid,remaining,pct,status}` (paid=original−pending, pct clamp [0,1], `paid` si pending≤0) y `toPeriodRange(sel,now)→{from,to}` (week=hoy−6..hoy, month=mes actual default, quarter/year naturales, custom valida `from<=to`, todo `YYYY-MM-DD`, `now` inyectado). Verificar que fallan: `pnpm test finance.test`. Archivo: `frontend/lib/finance/finance.test.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE puros-1: implementar `toDebtProgress` + `toPeriodRange` en `frontend/lib/finance/finance.ts` sin tocar firmas existentes (`toLedgerRows, toBudgetViews, toAccountCards, toSubscriptionRows, toDebtRows, toSavingsViews, normalizeManualAmount, toNumber`, etc.). Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivo: `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE puros-2: tests + implementación de `toMonthOverMonth(cur,prev)→{delta,pct|null si prev==0}`, `toSavingsSeries(flow)→{month,savings:income−expense}[]`, `toBalanceSeries(flow)→{month,balance acumulado cronológico}[]`, `toMonthCompare(flow)→{cur,prev,deltaPct}|null (<2 meses→null)`; coerción string→number solo en transforms. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE puros-3: tests + implementación de `toInsights({flow,byCatExpense,byCatIncome,budgets})→Insight[]` (máx 6, ordenadas, plantillas §AnalysisSection; heurística recurrente v1 por frecuencia de `description` ≥3, si no concluye se omite). Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE api-wires: parametrizar `useSpendByCategory(from,to,type:"income"|"expense"="expense")` con `type` en la key en `frontend/lib/api/dashboard.ts` (1 toque, default preserva conducta) + agregar `fetchDebtPayments`/`useDebtPayments(debt_id)` (key `finance/debt-payments/{id}`) y `useAssets()` (key `finance/assets`) en `frontend/lib/api/finance.ts`; ampliar wires `useDebts` (`installment?, start_date?`), `useSavingsGoals` (`target_date?, category_id?, color?`), `useSubscriptions` (`frequency, payment_method, next_billing_on, category_id?`) sin cambiar formato string-money. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/dashboard.ts`, `frontend/lib/api/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE charts-1: `BalanceChart.tsx` (`AreaChart` desde `toBalanceSeries(monthly-flow)`) + `SavingsChart.tsx` (área/línea desde `toSavingsSeries`, admite negativo con eje en 0); patrón `FlowChart.tsx` (`accessibilityLayer`, `chartToken()`/tokens `--color-*` cero hex, `CartesianGrid --color-hull`, ticks 12px, `Tooltip formatMoney`, `isAnimationActive={animate}` + `prefers-reduced-motion`, foco teclado, `EmptyState` i18n, 560×260 `overflow-x-auto`, `next/dynamic(ssr:false)`, sin `window` en import). Tests en `charts.test.tsx` (con datos + `EmptyState` + reduced-motion). Verificar: `pnpm test charts.test` + `npx tsc --noEmit`. Archivos: `frontend/components/ui/BalanceChart.tsx`, `frontend/components/ui/SavingsChart.tsx`, `frontend/components/ui/charts.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE charts-2: `MonthlyExpensesChart.tsx` (`BarChart` columna `expense`) + `MonthCompareChart.tsx` (`BarChart` pareado actual vs anterior + delta % vía `toMonthCompare`, <2 meses→`EmptyState`); mismo patrón/vales que charts-1; `FlowChart`/`CategoryDonut`/`BudgetBars` intactos; heredan exclusión de `transfer` sin "corregirla". Tests en `charts.test.tsx`. Verificar: `pnpm test charts.test` + `npx tsc --noEmit`. Archivos: `frontend/components/ui/MonthlyExpensesChart.tsx`, `frontend/components/ui/MonthCompareChart.tsx`, `frontend/components/ui/charts.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE period+reuse: `PeriodSelector.tsx` (`{kind:week|month|quarter|year|custom}`, 5 radio-pills + 2 date inputs solo en custom, default `{kind:"month"}`, `toPeriodRange`→`{from,to}` alimenta `useMonthlyFlow` + ambos `useSpendByCategory`; custom valida `from<=to` + formato, error inline ES) + reuse ingresos-por-fuente (`CategoryDonut` existente + `useSpendByCategory(from,to,"income")`; `IncomeSourceDonut` solo si reuse no calza) + montar secciones S6 en `FinanceScreens.tsx`. Tests con `now` inyectado. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/PeriodSelector.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/lib/finance/finance.test.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE analysis: `AnalysisSection.tsx` (tasa de ahorro, promedios, top categoría, MoM, mes mayor gasto/ahorro desde `monthly-flow` + `by-category` ambos tipos + `budgets`; ≥3 insights tono directo, máx 6, valores interpolados; heurística recurrente v1 omitida si no concluye; disclaimer fijo `analysis.disclaimer` "Análisis personal, no asesoramiento financiero." siempre visible; `EmptyState`+disclaimer sin datos; respeta reduced-motion y foco teclado). Tests: MoM correcto, delta nulo con 1 mes, disclaimer siempre, heurística omitida/presente. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/AnalysisSection.tsx`, `frontend/lib/i18n/es.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE i18n cierre: completar claves `finance.*` (todos los forms/confirmaciones/errores S5), `charts.*` (4 nuevos + `period{Week,Month,Quarter,Year,Custom,From,To,InvalidRange}` + empties), `analysis.*` (title/hint/disclaimer + 7 plantillas + métricas); cero literales en JSX nuevo (reusar `productivity.*` donde exista, no duplicar); extender test i18n (render cada form/chart con `es`, assert ausencia de strings fuera de `t`). Verificar: `pnpm test i18n` + `npx tsc --noEmit` + grep hex en charts = 0 fuera de tokens. Archivos: `frontend/lib/i18n/es.ts`, `frontend/lib/i18n/i18n.test.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE e2e S5/S6: extender `sections.spec.ts` (S5: montos manuales string, date-inputs `YYYY-MM-DD`, selects por nombre, confirmaciones crear/editar/borrar por dominio, corregir abono delete+recreate, cancelar/reactivar sub, crear tarjeta, valuar activo; S6: 5 rangos del `PeriodSelector` filtran ambos agregados, 4 charts + donut income renderizan, insights ≥3 + disclaimer, patrimonio-número visible). Verificar: `pnpm test:e2e sections`. Archivo: `frontend/e2e/sections.spec.ts` (o ruta `*.spec.ts` vigente del repo si difiere). <!-- sdd-owner: implementation -->
- [ ] REFACTOR final: eliminar duplicación entre forms/charts/transforms sin cambiar conducta, confirmar `FinanceSections.tsx` solo reusa (`SectionShell/ProgressBar/LedDot/EmptyState`) sin cambios, y re-verde total: `cargo test` + `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/*`, `frontend/components/ui/*`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] Run bounded review of PR-1 → PR-2 → PR-3 chain (scope, DTO reconciliation, F1/F2 intact, i18n, a11y vales) before merge. <!-- sdd-owner: parent -->
- [ ] Decide chain strategy (stacked-to-main vs feature-branch-chain) and grant apply gate for PR-1 BE. <!-- sdd-owner: parent -->
```

Nota: las tareas `puros-1`/`api-wires` aparecen `- [ ]` aunque S5 ya implementó su subconjunto (`toDebtProgress`, `fetchDebtPayments/useDebtPayments`, `useAssets`, expansiones de wires). El remanente (`toPeriodRange`, `useSpendByCategory(type)`, resto de puros) es PR-3 por diseño; no es fallo de PR-2. Las tareas S5 marcadas `[x]` no tienen `- [ ]` pendientes en el slice.

## Blockers (exactos)

1. **Archive bloqueado por alcance restante (no por defecto de PR-2):** 12 tareas implementation PR-3 + 2 parent sin completar (tasks 105–109, 122–124, 128–129, 133–134, 138–139). El ciclo completo cierra tras PR-3. Ninguna es archive-exception: son trabajo futuro aprobado en la cadena, no checkboxes obsoletos.
2. **RIESGO — acciones de suscripción por fila no montadas en pantalla (solo en tests):** `SubscriptionRow` (cancelar/reactivar con `PATCH {is_active}` + borrar con confirmación) existe y pasa tests pero `FinanceScreens` solo monta `SubscriptionCreateForm`. El usuario no puede cancelar/reactivar/borrar subs desde la UI. El dueño debe decidir antes de PR-3/e2e: montar la lista S5 (con queries disjuntas para no romper S1) o aceptar el gap. Sin este montaje, el e2e `cancelar/reactivar sub` desde pantalla fallará.
3. **WARNING — decisión de tamaño pendiente (pre-merge, no bloquea el slice):** ~1210 líneas superan el budget 400 sin `size:exception` registrada. El padre debe partir PR-2 o aceptar la excepción antes del merge.
4. **WARNING menor — `skills-lock.json` (+6) ajeno al slice:** excluirlo del PR o justificarlo.
5. Sin bloqueos de código en PR-2: cero defectos CRITICAL en el diff FE; nada que corregir antes de apilar PR-3 salvo la decisión del riesgo #2.

---

# Verify Report — p9-finanzas · PR-1 BE (eslabón 1 de 3, stacked-to-main)

- change: `p9-finanzas` · project: `personal-dashboard` · date: 2026-09-09
- slice: PR-1 BE únicamente (7 endpoints, sin migraciones) · rama: `p9-pr1` (= main)
- store: openspec (`openspec/changes/p9-finanzas/verify-report.md`, sección PR-1)
- skill_resolution: `none` (el padre no inyectó `## Skills to load before work`; no se descubrieron skills adicionales; se siguió el contrato del prompt + `~/.pi/agent/gentle-ai/support/sdd-status-contract.md`)
- veredicto PR-1: **PASS (slice BE)** — el diff BE cumple spec/diseño para el alcance asignado
- veredicto change completo: **NOT READY for archive** — quedan 18 tareas implementation FE + 2 parent sin hacer (ver § Task completion)

## Structured status consumed + produced

```yaml
schemaName: spec-driven
changeName: p9-finanzas
artifactStore: openspec
planningHome:
  root: /home/david/Nextcloud2/Ubuntu/landing_personal
  changesDir: openspec/changes
changeRoot: openspec/changes/p9-finanzas
artifactPaths:
  proposal: [openspec/changes/p9-finanzas/proposal.md]
  specs: [openspec/changes/p9-finanzas/specs/budgets-write/spec.md, openspec/changes/p9-finanzas/specs/savings-write/spec.md, openspec/changes/p9-finanzas/specs/debts-write/spec.md, openspec/changes/p9-finanzas/specs/assets-write/spec.md]
  design: [openspec/changes/p9-finanzas/design.md]
  tasks: [openspec/changes/p9-finanzas/tasks.md]
  applyProgress: [openspec/changes/p9-finanzas/apply-progress.md]
  verifyReport: [openspec/changes/p9-finanzas/verify-report.md]
artifacts:
  proposal: done
  specs: done
  design: done
  tasks: done
  applyProgress: done
  verifyReport: done  # esta sección PR-1; el reporte full cierra tras PR-2/PR-3
  syncReport: missing
taskProgress:
  total: 30  # implementation-owned
  complete: 12
  remaining: 18
  unchecked: [tasks.md:105, 106, 107, 108, 109, 113, 114, 115, 116, 117, 118, 122, 123, 124, 128, 129, 133, 134]
deferredParentActions:
  total: 2
  complete: 0
  remaining: 2
  unchecked: [tasks.md:138, 139]
applyState: ready
dependencies:
  apply: ready  # PR-2/PR-3 pendientes
  verify: ready  # este reporte cubre PR-1; verify full tras PR-2/PR-3
  sync: blocked
  archive: blocked  # 20 unchecked restantes
actionContext:
  mode: repo-local
  workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal
  allowedEditRoots: [/home/david/Nextcloud2/Ubuntu/landing_personal]
  warnings: []
nextRecommended: parent-lifecycle
isNonAuthoritative: false
```

Notas `actionContext`: `mode: repo-local` (autoritativo, store openspec con directorio `openspec/` presente); edición segura dentro del repo. Esta fase es solo-lectura + escritura de este reporte: no se mutó código, no se lanzaron subagentes, no se hicieron commits.

## Scope verificado (PR-1)

Diff contra `HEAD` (rama `p9-pr1`), solo BE:

- `backend/src/routes/budgets.rs` (+535): `PatchBudgetRequest` + `patch_budget_handler` + `delete_budget_handler` + `mod patch_tests` (7 tests)
- `backend/src/routes/savings.rs` (+334): `PatchGoalRequest` + `patch_goal_handler` + `mod patch_goal_tests` (5 tests)
- `backend/src/routes/debts.rs` (+548): `PatchDebtRequest` + `patch_debt_handler` + `list_payments_handler` + `delete_payment_handler` + `mod patch_debt_tests` (6 tests)
- `backend/src/routes/assets.rs` (+286): `PatchAssetRequest` + `patch_asset_handler` + `mod patch_asset_tests` (4 tests)
- `backend/src/main.rs` (+62 −5): wiring §2.8 del diseño + test `p9_finanzas_write_routes_are_wired`
- Total: `+1766/−5` en 5 archivos BE. `skills-lock.json` (+6) también aparece modificado en el working tree pero es ajeno al slice (ver § Review workload).
- Sin migraciones, sin FE, sin Fase 1/2: `git diff --name-only HEAD` no contiene `migrations/`, `frontend/`, `accounts.rs`, `subscriptions.rs`, `transactions.rs` ni `me.rs`. ✅

## Spec coverage (BE PR-1; requisitos FE fuera de alcance de este eslabón)

### budgets-write → PASS (slice BE)
- `PATCH /budgets/{id}` expuesto, DTO `PatchBudgetRequest` con `#[serde(deny_unknown_fields)]`, allowlist real exacta `category_id, amount, period_start, period_end, warn_threshold, over_threshold, notes` (`budgets.rs:76-88`). `updated_at = now()` vía `PATCH_BUDGET_BASE_SQL`, `RETURNING` = GET, 200 con `BudgetResponse` (montos string). ✅
- Validación 422 ES: `period_end >= period_start` (`validate_budget_period`), `amount > 0` (`parse_money_amount`), `0 < warn < over` (`validate_thresholds`), `category_id` owned + finance-kind (`ensure_finance_category`), campo fuera de allowlist → 422 por deny (test `patch_dto_rejects_trigger_owned_and_alias_fields` cubre `spent/status/currency` + alias `warning/danger_threshold` → 422). Mapeo `23505→409`, `23514/23503/22P02→422` (`map_budget_patch_db_err`), nunca 500. ✅
- `DELETE /budgets/{id}` → 204 sin cuerpo / 404 si `rows_affected==0` (`DELETE FROM budgets WHERE id=$1 AND user_id=$2`). ✅
- Auth/ownership: `require_user_id` primero en ambos handlers (sin sesión → 401 vía `AppError`); ajeno/inexistente → 404, nunca 403. ✅
- Never-block: no se tocó `transactions`; presupuestos siguen solo-aviso (`ok|warn|over`). ✅
- Form FE: fuera de PR-1 (tarea FE budgets-form unchecked, ver § Task completion). No se exige en este eslabón.

### savings-write → PASS (slice BE)
- `PATCH /savings-goals/{id}` expuesto, `PatchGoalRequest` con `deny_unknown_fields`, allowlist exacta `name, description, target_amount, target_date, category_id, color` (`savings.rs:90-99`). `saved_amount/is_completed/completed_at` → 422 por deny (test dedicado por campo). Montos string, `updated_at=now()`, 200. ✅
- Validación: `target_amount > 0` (`parse_money_amount`), `target_date YYYY-MM-DD` (`validate_target_date`), `category_id` owned finance-kind; `23505→409` (rename duplicado, reuse `map_goal_db_err`), `23514/23503→422`. ✅
- Movements append-only preservado: no se creó PATCH de movements; `POST`/`DELETE` existentes intactos (suite savings 30 passed). Over-withdrawal 422 y `DELETE` 204 con reversión por trigger siguen cubiertos por tests preexistentes. ✅
- `DELETE` goal 204 preservado (no tocado). Auth: 401 sin sesión, ajeno → 404 PATCH/DELETE/movements (`ensure_goal_writable`: ajeno→404, inexistente puro→422 por contrato heredado). ✅
- Forms FE: fuera de PR-1 (tarea FE savings-forms unchecked).

### debts-write → PASS (slice BE)
- `PATCH /debts/{id}` expuesto, `PatchDebtRequest` con `deny_unknown_fields`, nombres reales `name, creditor, due_date, installment, interest_rate, notes` (`debts.rs:90-103`; comentarios inline documentan que nunca son `creditor_name/installment_amount`). `pending_amount/status/original_amount` → 422 por deny (tests `patch_dto_uses_real_names_and_rejects_trigger_owned`, `triangulate_patch_guards_reject_paid_off_and_trigger_owned`). Montos string, fechas `YYYY-MM-DD`, `updated_at=now()`, 200. ✅
- Guards: `status != active` → 422 `"debt is not editable when paid_off"` (desviación documentada en apply-progress: el diseño ofrecía dos strings, se fijó este; tests afirman status, no string). `23505→409`, `23514/23503→422` con mensajes ES. ✅
- `GET /debts/{id}/payments` expuesto: `ensure_debt_writable` + `SELECT … WHERE debt_id=$1 AND user_id=$2 ORDER BY paid_on ASC, created_at ASC`, 200 `Vec<PaymentResponse>` montos string, vacía → `[]`. Ajeno → 404, inexistente → 422 (contrato heredado). ✅
- `DELETE /debts/{id}/payments/{pid}` expuesto: `DELETE FROM debt_payments WHERE id=$1 AND debt_id=$2 AND user_id=$3`, 204/404; permitido en `paid_off` (el trigger `update_debt_pending` reabre a `active` — corrección DELETE+recreate pactada). Test de reversión dedicado obligatorio presente (`pending 500 → pay 100 → pending 400 → DELETE → pending 500 active`; payoff total → DELETE último → `active` de nuevo; 404 cruzado pid-deuda-A vía deuda-B). ✅
- `POST` guards preservados (active-only, `amount <= pending`, string `> 0`, ownership) — no tocados, tests verdes. Sin `PATCH` payments por diseño. ✅
- Auth: 401 sin sesión, ajeno → 404 nunca 403. ✅
- UI FE: fuera de PR-1 (tarea FE debts-ui unchecked).

### assets-write → PASS (slice BE)
- `PATCH /assets/{id}` expuesto, `PatchAssetRequest` con `deny_unknown_fields`, allowlist exacta `name, category, account_id, currency, acquired_on, notes` (`assets.rs:128-137`). `current_value/is_archived` → 422 por deny (tests dedicados). Fechas `YYYY-MM-DD`, COP-only (`validate_currency`), `updated_at=now()`, cast `$::asset_category`, `WHERE id AND user_id AND NOT is_archived`, 200. ✅
- Valuaciones INSERT-only preservadas: sin PATCH/DELETE de valuations, sin `GET /assets/{id}/valuations` nuevo; `DELETE /assets/{id}` sigue archive-flag 204. Tests preexistentes verdes (422 out-of-order, 409 duplicada). ✅
- Auth: 401 sin sesión, ajeno → 404 nunca 403; `23505→409`, `23514/23503/422` (`map_asset_db_err`); archivado → 404 (`ensure_asset_writable`). ✅
- Net-worth/form FE: fuera de PR-1 (tareas FE assets-forms/analysis unchecked).

### Conciliación draft-vs-wire (vinculante, tasks.md)
Apply usó los nombres reales según la tabla vinculante, no los alias del draft: budgets `warn_threshold/over_threshold` (draft decía `warning/danger_threshold`), debts `creditor/installment/interest_rate` (draft decía `creditor_name/installment_amount`). Los tests rechazan explícitamente los alias (budgets) y los nombres alternativos (debts). Desviación #5 de apply-progress lo documenta. ✅ Sin otros desvíos de nombres.

## Test / validation commands (ejecutados en esta fase, tal cual)

- `cargo test --manifest-path backend/Cargo.toml` → `395 passed` (lib) + `5/3/10` integración, `0 failed`. `DATABASE_URL` ausente (`<unset>`); 142 líneas `SKIP ...: no DATABASE_URL` (tests DB-gated en SKIP según patrón del repo — esperado, NO se apuntó a ninguna DB). ✅ coincide con lo esperado (~395 pass).
- `cargo clippy --manifest-path backend/Cargo.toml -- -D warnings` → verde (`Finished dev profile`, sin warnings). ✅
- `cargo fmt --check` no se ejecutó en esta fase (apply-progress ya registra diffs preexistentes + decisión de no formatear global para no ensuciar el slice; se respeta).
- `git diff --stat HEAD` → 5 archivos BE `+1766/−5` (+ `skills-lock.json` +6 ajeno al slice). `git diff --name-only HEAD | grep -i "migrat|frontend/|..."` → limpio. ✅
- FE (`pnpm test`, `tsc`, e2e) no se corrió: FE intacto en PR-1 por diseño del slice; corresponde a PR-2/PR-3.

## Strict TDD compliance (STRICT activo vía apply-progress + prompt delegado; `openspec/config.yaml` trae `strict_tdd: false` pero el slice BE se trabajó en STRICT)

1. Guía: `~/.pi/agent/gentle-ai/support/strict-tdd-verify.md` consumida como referencia (sin override local `.pi/gentle-ai/support/strict-tdd-verify.md`). ✅
2. `apply-progress.md` contiene tabla `TDD Cycle Evidence` (12 filas: Preflight ×2, BE-1 ×3, BE-2 ×2, BE-3 ×3, BE-4 ×2) con RED/GREEN/TRIANGULATE/SAFETY/REFACTOR por tarea. ✅
3. Test files cross-referenciados y existentes: `backend/src/routes/budgets.rs:1244 mod patch_tests` (7 tests), `savings.rs:1325 mod patch_goal_tests` (5), `debts.rs:1335 mod patch_debt_tests` (6), `assets.rs:1358 mod patch_asset_tests` (4), `main.rs:418 p9_finanzas_write_routes_are_wired`. Todos resuelven en el diff real. ✅
4. GREEN sigue vigente: `cargo test` 395 passed ejecutado en esta fase, 0 failed. ✅
5. Auditoría de calidad de asserts (muestreo): `assert_eq!` sobre `StatusCode` concretos (401/404/422/204/201), montos string exactos (`"85.00"`, `"15.00"`), estados (`"warn"`/`"ok"`), fragmentos SQL (`user_id`, `updated_at = now()`), reversiones numéricas exactas del trigger (500→400→500 + reapertura de status), 404 cruzado. Sin tautologías (`assert!(true)`), sin ghost-loops (cada `for` de wiring termina en `assert_eq!` por ruta), sin asserts solo-de-tipo aislados, sin smoke-only (cada GREEN tiene compañera de borde: happy + 422/404/409), sin asserts CSS (BE puro). El único `[]` afirmado (lista vacía de payments) tiene precondición vacía + compañera no-vacía/ordenada en debts. ✅
6. Evidencia TDD completa para el slice BE; no hay TDD FE en PR-1 por diseño (las tareas FE conservan sus ciclos RED→GREEN para PR-2/PR-3). Sin faltantes CRITICAL en el slice. ✅

## Assertion quality findings

- PASS: asserts concretos y triangulares en los 4 módulos + wiring (7 rutas → 401 sin sesión, distingue 405/404 de ruta ausente).
- Observación menor (no bloqueante): `skills-lock.json` modificado fuera del slice — ver § Review workload.

## Review workload / PR boundary findings

- Forecast (tasks.md): `Chained PRs: Yes`, `Chain strategy: pending`, `Decision needed: Yes`, `400-line budget risk: High`, split sugerido PR-1 BE → PR-2 FE forms → PR-3 charts/analysis/i18n/e2e.
- Resolución: el padre fijó `stacked-to-main, eslabón 1 de 3` (registrado en apply-progress). Esta verificación confirma que **solo el slice asignado fue implementado**: 5 archivos BE, cero FE, cero migraciones, cero Fase 1/2, cero archivos prohibidos (`accounts/subscriptions/transactions/me` intactos). Sin scope creep. ✅
- `size:exception` NO registrada: el slice BE+tests suma `+1766/−5` líneas, muy por encima del budget 400. El volumen es tests TDD (~1150) + handlers (~600), no alcance extra — pero si el mantenedor exige ≤400 por PR, hay que partir PR-1 (p. ej. budgets+savings vs debts+assets+wiring) o aceptar `size:exception`. **WARNING: el padre debe decidirlo antes del merge; no se partió unilateralmente.** (Hereda el WARNING ya levantado en apply-progress.)
- `skills-lock.json` (+6) en el working tree es ajeno al slice PR-1. WARNING menor: excluirlo del PR o justificarlo; no afecta conducta BE.
- `Chain strategy` coincide con el borde retornado: base `p9-pr1` (= main), apila PR-2 (FE puros + forms S5) y PR-3 (charts + PeriodSelector + Analysis + i18n + e2e). Rollback = revert de los 5 archivos (BE aditivo, triggers intactos). ✅

## Task completion status

BE PR-1: **12/12 implementation done** (Preflight ×2, BE-1 ×3, BE-2 ×2, BE-3 ×3, BE-4 ×2) — todas en `- [x]` verificadas por grep (12 filas checked). ✅

Restantes: **20 unchecked** (18 implementation FE + refactor + e2e, fuera del slice PR-1 + 2 parent del dueño/orquestador). No son fallo de PR-1; son alcance de PR-2/PR-3 y decisiones parent. **Archive NOT READY** mientras sigan unchecked.

Líneas `- [ ]` exactas restantes (verbatim de `tasks.md`):

```text
- [ ] RED FE puros-1: extender `frontend/lib/finance/finance.test.ts` con `toDebtProgress({original,pending})→{paid,remaining,pct,status}` (paid=original−pending, pct clamp [0,1], `paid` si pending≤0) y `toPeriodRange(sel,now)→{from,to}` (week=hoy−6..hoy, month=mes actual default, quarter/year naturales, custom valida `from<=to`, todo `YYYY-MM-DD`, `now` inyectado). Verificar que fallan: `pnpm test finance.test`. Archivo: `frontend/lib/finance/finance.test.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE puros-1: implementar `toDebtProgress` + `toPeriodRange` en `frontend/lib/finance/finance.ts` sin tocar firmas existentes (`toLedgerRows, toBudgetViews, toAccountCards, toSubscriptionRows, toDebtRows, toSavingsViews, normalizeManualAmount, toNumber`, etc.). Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivo: `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE puros-2: tests + implementación de `toMonthOverMonth(cur,prev)→{delta,pct|null si prev==0}`, `toSavingsSeries(flow)→{month,savings:income−expense}[]`, `toBalanceSeries(flow)→{month,balance acumulado cronológico}[]`, `toMonthCompare(flow)→{cur,prev,deltaPct}|null (<2 meses→null)`; coerción string→number solo en transforms. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE puros-3: tests + implementación de `toInsights({flow,byCatExpense,byCatIncome,budgets})→Insight[]` (máx 6, ordenadas, plantillas §AnalysisSection; heurística recurrente v1 por frecuencia de `description` ≥3, si no concluye se omite). Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE api-wires: parametrizar `useSpendByCategory(from,to,type:"income"|"expense"="expense")` con `type` en la key en `frontend/lib/api/dashboard.ts` (1 toque, default preserva conducta) + agregar `fetchDebtPayments`/`useDebtPayments(debt_id)` (key `finance/debt-payments/{id}`) y `useAssets()` (key `finance/assets`) en `frontend/lib/api/finance.ts`; ampliar wires `useDebts` (`installment?, start_date?`), `useSavingsGoals` (`target_date?, category_id?, color?`), `useSubscriptions` (`frequency, payment_method, next_billing_on, category_id?`) sin cambiar formato string-money. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/dashboard.ts`, `frontend/lib/api/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE budgets-form: mutadores `createBudget/patchBudget/deleteBudget` (montos string, `apiPost/apiPatch/apiDelete`, claves reales `warn_threshold/over_threshold`) + `BudgetForm.tsx` crear+editar (`budget?` opcional: categoría select por nombre, monto `normalizeManualAmount`, dates `YYYY-MM-DD`, thresholds 0–2 default 0.8/1.0, notes; borrar con `confirm()` i18n) + invalidación `dashboard/budgets`. Tests con SWR mockeado en `finance.test.tsx`. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/BudgetForm.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE savings-forms: `patchGoal` + wrappers `createMovement/deleteMovement` (signed amount) + `SavingsForms.tsx` (`SavingsDepositForm` abonar/retirar con guard cliente over-withdrawal, `SavingsGoalForm` crear+editar meta allowlist, eliminar con confirmación) + invalidación `finance/savings-goals` + `dashboard/savings-goals`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/SavingsForms.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE debts-ui: `patchDebt` (nombres reales `creditor/installment/interest_rate`, nunca montos) + `createPayment/deletePayment` + `DebtPayments.tsx` (`DebtPayForm` con guard `amount<=pending`, `DebtPaymentHistory` vía `useDebtPayments` + corregir = DELETE+prefill con confirmación, barra debo/aboné/falta con `toDebtProgress` + `ProgressBar` reuse, `DebtEditForm` solo metadata) + invalidación `finance/debts` + `finance/debt-payments/{id}`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/DebtPayments.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE subs-forms: wrappers `createSubscription/setSubscriptionActive(id,is_active)/deleteSubscription` (PATCH solo `{is_active}`, resto→422 BE) + `SubscriptionForms.tsx` (crear: name/price manual/currency default COP/frequency `weekly|monthly|quarterly|yearly`/next_billing/category/payment_method/url/notes; por fila cancelar/reactivar + borrar con confirmación) + invalidación `finance/subscriptions` + `dashboard/subscriptions`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/SubscriptionForms.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE cards: `createCard` (`POST /accounts type=credit_card`, exige `credit_limit` string + ambos cycle days, espejo `validate_card_fields`) + `CardForm.tsx`/`CardDetail.tsx` (detalle: límite/disponible/corte/pago/alerta `ok|warn|high` del BE solo formateado, reuse `AccountsList`; cambio de límite = guía DELETE+recreate con copy ES, jamás PATCH de límite; anti-N+1: statement solo en detail) + invalidación `dashboard/accounts` + `dashboard/net-worth`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/CardForm.tsx`, `frontend/components/finance/CardDetail.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE assets-forms + montaje S5: `patchAsset` + `createValuation` (POST existente, guard cliente `recorded_on>máx`) + `AssetForms.tsx` (`AssetEditForm` allowlist real + `AssetValuationForm` + archivar con confirmación vía DELETE existente) + montar las 6 `SectionShell` S5 en `frontend/components/containers/FinanceScreens.tsx` DESPUÉS de las tres F1 intactas (prohibido tocar `ManualCaptureSection`/`TransactionsLedger`/`TransferHistory` y sus keys) + sección patrimonio-número con `useNetWorth` existente (moneda de `GET /me`, fallback primera currency; sin widget home, sin gráfico evolución). Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/AssetForms.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE charts-1: `BalanceChart.tsx` (`AreaChart` desde `toBalanceSeries(monthly-flow)`) + `SavingsChart.tsx` (área/línea desde `toSavingsSeries`, admite negativo con eje en 0); patrón `FlowChart.tsx` (`accessibilityLayer`, `chartToken()`/tokens `--color-*` cero hex, `CartesianGrid --color-hull`, ticks 12px, `Tooltip formatMoney`, `isAnimationActive={animate}` + `prefers-reduced-motion`, foco teclado, `EmptyState` i18n, 560×260 `overflow-x-auto`, `next/dynamic(ssr:false)`, sin `window` en import). Tests en `charts.test.tsx` (con datos + `EmptyState` + reduced-motion). Verificar: `pnpm test charts.test` + `npx tsc --noEmit`. Archivos: `frontend/components/ui/BalanceChart.tsx`, `frontend/components/ui/SavingsChart.tsx`, `frontend/components/ui/charts.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE charts-2: `MonthlyExpensesChart.tsx` (`BarChart` columna `expense`) + `MonthCompareChart.tsx` (`BarChart` pareado actual vs anterior + delta % vía `toMonthCompare`, <2 meses→`EmptyState`); mismo patrón/vales que charts-1; `FlowChart`/`CategoryDonut`/`BudgetBars` intactos; heredan exclusión de `transfer` sin "corregirla". Tests en `charts.test.tsx`. Verificar: `pnpm test charts.test` + `npx tsc --noEmit`. Archivos: `frontend/components/ui/MonthlyExpensesChart.tsx`, `frontend/components/ui/MonthCompareChart.tsx`, `frontend/components/ui/charts.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE period+reuse: `PeriodSelector.tsx` (`{kind:week|month|quarter|year|custom}`, 5 radio-pills + 2 date inputs solo en custom, default `{kind:"month"}`, `toPeriodRange`→`{from,to}` alimenta `useMonthlyFlow` + ambos `useSpendByCategory`; custom valida `from<=to` + formato, error inline ES) + reuse ingresos-por-fuente (`CategoryDonut` existente + `useSpendByCategory(from,to,"income")`; `IncomeSourceDonut` solo si reuse no calza) + montar secciones S6 en `FinanceScreens.tsx`. Tests con `now` inyectado. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/PeriodSelector.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/lib/finance/finance.test.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE analysis: `AnalysisSection.tsx` (tasa de ahorro, promedios, top categoría, MoM, mes mayor gasto/ahorro desde `monthly-flow` + `by-category` ambos tipos + `budgets`; ≥3 insights tono directo, máx 6, valores interpolados; heurística recurrente v1 omitida si no concluye; disclaimer fijo `analysis.disclaimer` "Análisis personal, no asesoramiento financiero." siempre visible; `EmptyState`+disclaimer sin datos; respeta reduced-motion y foco teclado). Tests: MoM correcto, delta nulo con 1 mes, disclaimer siempre, heurística omitida/presente. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/AnalysisSection.tsx`, `frontend/lib/i18n/es.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE i18n cierre: completar claves `finance.*` (todos los forms/confirmaciones/errores S5), `charts.*` (4 nuevos + `period{Week,Month,Quarter,Year,Custom,From,To,InvalidRange}` + empties), `analysis.*` (title/hint/disclaimer + 7 plantillas + métricas); cero literales en JSX nuevo (reusar `productivity.*` donde exista, no duplicar); extender test i18n (render cada form/chart con `es`, assert ausencia de strings fuera de `t`). Verificar: `pnpm test i18n` + `npx tsc --noEmit` + grep hex en charts = 0 fuera de tokens. Archivos: `frontend/lib/i18n/es.ts`, `frontend/lib/i18n/i18n.test.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE e2e S5/S6: extender `sections.spec.ts` (S5: montos manuales string, date-inputs `YYYY-MM-DD`, selects por nombre, confirmaciones crear/editar/borrar por dominio, corregir abono delete+recreate, cancelar/reactivar sub, crear tarjeta, valuar activo; S6: 5 rangos del `PeriodSelector` filtran ambos agregados, 4 charts + donut income renderizan, insights ≥3 + disclaimer, patrimonio-número visible). Verificar: `pnpm test:e2e sections`. Archivo: `frontend/e2e/sections.spec.ts` (o ruta `*.spec.ts` vigente del repo si difiere). <!-- sdd-owner: implementation -->
- [ ] REFACTOR final: eliminar duplicación entre forms/charts/transforms sin cambiar conducta, confirmar `FinanceSections.tsx` solo reusa (`SectionShell/ProgressBar/LedDot/EmptyState`) sin cambios, y re-verde total: `cargo test` + `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/*`, `frontend/components/ui/*`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] Run bounded review of PR-1 → PR-2 → PR-3 chain (scope, DTO reconciliation, F1/F2 intact, i18n, a11y vales) before merge. <!-- sdd-owner: parent -->
- [ ] Decide chain strategy (stacked-to-main vs feature-branch-chain) and grant apply gate for PR-1 BE. <!-- sdd-owner: parent -->
```

## Blockers (exactos)

1. **Archive bloqueado por alcance restante (no por defecto de PR-1):** 18 tareas implementation FE + 2 parent sin completar ( Tasks 105–109, 113–118, 122–124, 128–129, 133–134, 138–139). El ciclo completo cierra tras PR-2/PR-3. Ninguna es archive-exception: son trabajo futuro aprobado en la cadena, no checkboxes obsoletos.
2. **WARNING — decisión de tamaño pendiente (pre-merge, no bloquea el slice):** `+1766/−5` supera el budget 400 sin `size:exception` registrada. El padre debe partir PR-1 o aceptar la excepción antes del merge.
3. **WARNING menor — `skills-lock.json` (+6) ajeno al slice:** excluirlo del PR o justificarlo.
4. Sin bloqueos de código en PR-1: cero defectos CRITICAL en el diff BE; nada que corregir antes de apilar PR-2.

## Desviaciones conocidas heredadas de apply (aceptadas en este verify, sin cambio de conducta)

1. Nullable-clearing con `Option<T>` plano: `null`/ausente = mantener (convención del repo); desvincular explícito vía `null` es no-op. Documentado, sin test que lo exija.
2. Mensaje PATCH deuda saldada fijado en `"debt is not editable when paid_off"` (el diseño ofrecía dos; tests afirman status 422, no string).
3. `map_budget_patch_db_err` nuevo (el `create` existente mapea todo a 500; el PATCH sigue el contrato 422/409 del diseño).
4. Sin `cargo fmt` global (repo no rustfmt-limpio; formatear ensuciaría el slice).
5. Nombres reales vs alias del draft (tabla vinculante aplicada; única divergencia spec-vs-wire y correctamente resuelta).

---

*Verificado sin mutar código: solo lectura + `cargo test`/`clippy` tal cual (sin `DATABASE_URL`, sin apuntar a ninguna DB) + escritura de este reporte. Sin subagentes, sin commits.*
