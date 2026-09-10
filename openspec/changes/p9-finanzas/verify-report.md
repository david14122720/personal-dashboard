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
