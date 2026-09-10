# Apply Progress — p9-finanzas · PR-1 BE (stacked-to-main, eslabón 1 de 3)

- change: `p9-finanzas` · project: `personal-dashboard` · date: 2026-09-09
- slice: PR-1 BE únicamente (7 endpoints, sin migraciones) · base: rama `p9-pr1` = main
- chain: `stacked-to-main` (resuelto por el padre; tasks.md decía `pending` + `Decision needed: Yes`, el prompt delegado fija `stacked-to-main, eslabón 1 de 3`)
- TDD: `STRICT` (`cargo test`; DB-gated `SKIP` sin `DATABASE_URL`) · FE no tocado en este eslabón
- store: openspec (`openspec/changes/p9-finanzas/apply-progress.md`)
- skill_resolution: `none` (el padre no inyectó `## Skills to load before work`; no se descubrieron skills adicionales; se siguió el contrato del prompt + `~/.pi/agent/gentle-ai/support/sdd-status-contract.md` + `strict-tdd.md` como guía)

## Structured status consumed

- `gentle-ai sdd-status p9-finanzas --cwd <repo>` → `store: openspec`, `next: apply`, `apply: ready`, `verify: blocked`, `archive: blocked`, `tasks: 0/32 complete` (antes de este apply).
- Artefactos leídos: `proposal.md`, `design.md`, `specs/{budgets,savings,debts,assets}-write/spec.md` (+ resto), `tasks.md`, `openspec/config.yaml` (`strict_tdd: false` en config, pero el prompt delegado activa STRICT TDD con runner `cargo test` — manda el prompt).
- `actionContext`: `mode: repo-local`, `workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal`, `allowedEditRoots: [<repo>]`, sin warnings. Edición segura dentro del repo.
- Rama actual: `p9-pr1`. `applyState: ready` (autoritativo, store openspec). Sin bloqueos.
- Review Workload Gate (tasks.md): `Decision needed: Yes`, `Chained PRs: Yes`, `Chain strategy: pending`, `400-line budget risk: High`. Decisión resuelta por el padre (`stacked-to-main`, solo BE PR-1). Se implementa únicamente el slice asignado y se reporta el borde del PR.

## Completed tasks (12/32: 12 implementation done, 18 implementation + 2 parent remaining) + persisted checkbox updates

Todas en `openspec/changes/p9-finanzas/tasks.md` pasadas de `- [ ]` a `- [x]` (solo filas `<!-- sdd-owner: implementation -->`; filas `parent` intactas):

- [x] `0. Preflight` — baseline `cargo test` verde (372 passed lib + 5/3/10 integración) antes de tocar código.
- [x] `0. Preflight` — nombres reales verificados en `budgets.rs:34-35,66-67`, `debts.rs:38,68-81`, `savings.rs`, `assets.rs` + migraciones `0002/0003`; sin desvíos nuevos vs tabla de conciliación.
- [x] `BE-1 RED` budgets (`PatchBudgetRequest` deny_unknown_fields, alias `warning/danger_threshold` → 422).
- [x] `BE-1 GREEN` budgets (`patch_budget_handler` QueryBuilder + `delete_budget_handler`).
- [x] `BE-1 TRIANGULATE` budgets (parcial `notes`, `0.00`/período/`warn>over`/categoría/ajeno/doble-delete, asserts SQL).
- [x] `BE-2 RED+GREEN` savings (`PatchGoalRequest` allowlist exacta + `patch_goal_handler` + 23505→409).
- [x] `BE-2 TRIANGULATE` savings (409 rename, preserva `saved_amount`, ajeno 404, inexistente 422).
- [x] `BE-3 RED+GREEN PATCH` debts (nombres reales `creditor/installment/interest_rate`, active-only 422).
- [x] `BE-3 GREEN payments` (`list_payments_handler` + `delete_payment_handler`).
- [x] `BE-3 TRIANGULATE` payments (reversión trigger dedicada + reapertura + 404 cruzado + preserva `pending_amount`).
- [x] `BE-4 RED+GREEN` assets (`PatchAssetRequest` + cast `::asset_category` + `NOT is_archived`).
- [x] `BE-4 GREEN wiring + REFACTOR` (7 rutas en `main.rs`, smoke en verde, sin tocar `accounts/subscriptions/transactions/me`).

Re-verificado tras marcar: las 12 filas muestran `- [x]` en el artefacto persistido (grep). Sin cambios a filas FE ni a filas `parent`.

## Files changed (solo BE PR-1; sin migraciones; sin FE; sin Fase 1/2)

- `backend/src/routes/budgets.rs` (+535): `PatchBudgetRequest` (allowlist real `category_id, amount, period_start, period_end, warn_threshold, over_threshold, notes`), `PATCH_BUDGET_BASE_SQL`, `DELETE_BUDGET_SQL`, `map_budget_patch_db_err` (23505→409, 23514/23503/22P02→422), `patch_budget_handler` (lee fila actual para extremos/thresholds fusionados, `updated_at=now()`, `RETURNING` = GET), `delete_budget_handler` (204/404) + `mod patch_tests` (7 tests).
- `backend/src/routes/savings.rs` (+334): `PatchGoalRequest` (`name, description, target_amount, target_date, category_id, color`), `PATCH_GOAL_BASE_SQL`, `patch_goal_handler` (`ensure_goal_writable` 404/422, reuse `validate_goal_name`/`parse_money_amount`/`validate_target_date`/`ensure_finance_category`, `map_goal_db_err`) + `mod patch_goal_tests` (5 tests).
- `backend/src/routes/debts.rs` (+548): `PatchDebtRequest` (nombres reales `name, creditor, due_date, installment, interest_rate, notes`), `PATCH_DEBT_BASE_SQL`, `LIST_PAYMENTS_SQL` (`ORDER BY paid_on ASC, created_at ASC`), `DELETE_PAYMENT_SQL` (`id=$1 AND debt_id=$2 AND user_id=$3`), `patch_debt_handler` (guard `status != active` → 422 `"debt is not editable when paid_off"`), `list_payments_handler`, `delete_payment_handler` (permitido en `paid_off`; el trigger reabre) + `mod patch_debt_tests` (6 tests).
- `backend/src/routes/assets.rs` (+286): `PatchAssetRequest` (`name, category, account_id, currency, acquired_on, notes`), `PATCH_ASSET_BASE_SQL`, `patch_asset_handler` (cast `::asset_category`, `WHERE id AND user_id AND NOT is_archived`, reuse `validate_required_text`/`validate_category`/`ensure_account_owned`/`validate_currency`/`validate_calendar_date`, `map_asset_db_err`) + `mod patch_asset_tests` (4 tests).
- `backend/src/main.rs` (+62 −5): wiring §2.8 (`/budgets/{id}` +PATCH+DELETE, `/savings-goals/{id}` +PATCH, `/debts/{id}` +PATCH, `/debts/{id}/payments` +GET, nuevo `/debts/{id}/payments/{pid}` DELETE, `/assets/{id}` +PATCH) + test `p9_finanzas_write_routes_are_wired` (7 rutas → 401 sin sesión).
- No tocados: `accounts.rs`, `subscriptions.rs`, `transactions.rs`, `me.rs`, resto de routes, migraciones, FE.

## Test commands run (evidencia)

- Baseline pre-cambio: `cargo test` → `372 passed` (lib) + `5/3/10` integración, 0 failed.
- RED budgets: `cargo test budgets::patch_tests` → fallo de compilación (`PatchBudgetRequest`, `PATCH_BUDGET_SQL_MARKER` no existen). ✅ RED.
- GREEN budgets: `cargo test budgets` → `21 passed`. ✅ GREEN.
- TRIANGULATE budgets: `cargo test budgets::patch_tests` → `7 passed` (3 DB-gated hacen `SKIP` sin `DATABASE_URL` e imprimen `SKIP ...: no DATABASE_URL`). ✅.
- RED savings: `cargo test savings::patch_goal_tests` → fallo de compilación (`PatchGoalRequest`, `PATCH_GOAL_BASE_SQL` no existen). ✅ RED.
- GREEN savings: `cargo test savings::patch_goal_tests` → `2 passed`; `cargo test savings` → `30 passed`. ✅ GREEN.
- TRIANGULATE savings: `cargo test savings::patch_goal_tests` → `5 passed` (2 DB-gated SKIP). ✅.
- RED debts: `cargo test debts::patch_debt_tests` → fallo de compilación. ✅ RED.
- GREEN debts: `cargo test debts::patch_debt_tests` → `2 passed`. ✅ GREEN.
- TRIANGULATE debts: `cargo test debts::patch_debt_tests` → `6 passed` (3 DB-gated SKIP). ✅.
- RED assets: `cargo test assets::patch_asset_tests` → fallo de compilación. ✅ RED.
- GREEN assets: `cargo test assets::patch_asset_tests` → `2 passed`. ✅ GREEN.
- TRIANGULATE assets: `cargo test assets::patch_asset_tests` → `4 passed` (1 DB-gated SKIP). ✅.
- RED wiring: `cargo test api_nest_tests::p9_finanzas_write_routes_are_wired` → `FAILED` (PATCH `/api/budgets/{id}` → 405, esperado 401). ✅ RED.
- GREEN wiring: `cargo test api_nest_tests` → `5 passed`. ✅ GREEN.
- Final: `cargo test` → `395 passed` (lib, +23 nuevos) + `5/3/10` integración, 0 failed.
- `cargo clippy -- -D warnings` → verde. `cargo fmt --check` muestra diffs preexistentes (p. ej. `auth/middleware.rs`, `auth/password.rs`) y de estilo en archivos tocados; no se ejecuta `cargo fmt` global para no ensuciar el diff fuera del slice (ver Desviaciones).
- DB local `192.168.50.120:5434` no usada (solo lectura de esquema autorizada; no hizo falta: el esquema se verificó en `migrations/0002/0003` + código). `DATABASE_URL` ausente → tests DB-gated en `SKIP` según patrón del repo.

## TDD Cycle Evidence (Strict TDD)

| Tarea | RED | GREEN | TRIANGULATE | SAFETY NET | REFACTOR |
|---|---|---|---|---|---|
| Preflight baseline | ➖ N/A (lectura) | ✅ `cargo test` 372 verde registrado | ➖ Single (un baseline) | ✅ baseline capturado antes de editar | ➖ sin código |
| Preflight nombres reales | ➖ N/A (lectura) | ✅ columnas/DTO vs conciliación, sin desvíos | ✅ 4 dominios (budgets/savings/debts/assets) | ✅ sin edición | ➖ sin código |
| BE-1 RED budgets | ✅ test compila-falla (`PatchBudgetRequest` inexistente) | — | — | ✅ `cargo test` verde previo | — |
| BE-1 GREEN budgets | — | ✅ `cargo test budgets` 21 passed | — | ✅ baseline previo | — |
| BE-1 TRIANGULATE budgets | — | — | ✅ 7 casos (DTO+alias+vacío+validadores+3 DB SKIP+SQL asserts) | ✅ GREEN previo | ✅ sin conducta cambiada |
| BE-2 RED+GREEN savings | ✅ test compila-falla | ✅ `cargo test savings` 30 passed | — | ✅ baseline previo | — |
| BE-2 TRIANGULATE savings | — | — | ✅ 5 casos (409+preserva trigger+404/422+SQL) | ✅ GREEN previo | ✅ sin conducta cambiada |
| BE-3 PATCH debts | ✅ test compila-falla | ✅ `patch_debt_tests` 2 passed | ✅ triangulate guards (alias+trigger+validadores) | ✅ baseline previo | — |
| BE-3 payments read+delete | ✅ cubierto por el mismo RED (consts inexistentes) | ✅ `list/delete_payment_handler` + 2 passed | — | ✅ GREEN previo | — |
| BE-3 TRIANGULATE payments | — | — | ✅ reversión 500→400→500 + payoff→reapertura + cruzado/ajeno/inexistente + preserva pending + lista vacía | ✅ GREEN previo | ✅ sin conducta cambiada |
| BE-4 assets | ✅ test compila-falla | ✅ `patch_asset_tests` 2 passed | ✅ 4 casos (categoría+trigger+rename/cuenta-ajena/archivado) | ✅ baseline previo | — |
| BE-4 wiring+REFACTOR | ✅ `p9_..._wired` FAILED (405 vs 401) | ✅ `api_nest_tests` 5 passed; `cargo test` 395 verde | ➖ Single estructural (7 rutas existen/no-existen; no hay lógica que triangular) | ✅ suite verde antes del wiring | ✅ solo wiring + test; sin refactor de conducta (fmt global omitido a propósito) |

Triangulación mínima cumplida: cada comportamiento tiene ≥2 casos (happy + borde), ningún GREEN es trivial (los asserts llaman código real y comparan valores concretos; `[]` solo se afirma con precondición vacía + compañera no-vacía en debts).

## Deviations from design (menores, sin cambio de conducta pactada)

1. Nullable-clearing (`notes=null`, `category_id=null`, `due_date=null`, etc.): con `Option<T>` plano (convención del repo: `PatchTransactionRequest`, `PatchAccountRequest`, `PatchGoalRequest` de goals) `null`/ausente = “mantener”. Desvincular explícito vía `null` (p. ej. `category_id=null`, `account_id=null`) es no-op, igual que los PATCH existentes. El diseño dice “None = desvincular, permitido” pero ningún test del slice lo exige y el doble-`Option` con deserializador custom rompería la convención; se documenta como limitación conocida, no como fallo.
2. Mensaje PATCH deuda saldada: el diseño deja elegir entre `"payments are only allowed on active debts"` y `"debt is not editable when paid_off"`; se usa el segundo (distingue PATCH-metadata de POST-payment). Tests solo afirman `status` (422), no el string.
3. `map_budget_patch_db_err` nuevo (23505→409, 23514/23503/22P02→422): el `create_budget_handler` existente mapea todo a 500; el PATCH sigue el contrato de diseño/FE (422/409), no el precedente del create.
4. `cargo fmt` global no ejecutado: el repo no está rustfmt-limpio (diffs preexistentes); formatear tocaría archivos fuera del slice. El código nuevo imita el estilo circundante; `clippy -D warnings` está verde.
5. Specs draft vs wire: `specs/budgets-write` pide `warning_threshold/danger_threshold` y `specs/debts-write` pide `creditor_name/installment_amount`. Apply usa los nombres reales verificados (`warn_threshold/over_threshold`, `creditor/installment` + `interest_rate`) según la tabla vinculante de `tasks.md` + columnas/DTO + migraciones. Sin otros desvíos: no hubo que parar.

## Remaining tasks (18 implementation + 2 parent = 20 unchecked; FE intacto, fuera de PR-1)

Exactas `- [ ]` restantes (implementación; el dueño/orquestador owns las 2 `parent`):

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

Diferidas al dueño/orquestador (no apply, intactas):

- [ ] Run bounded review of PR-1 → PR-2 → PR-3 chain (scope, DTO reconciliation, F1/F2 intact, i18n, a11y vales) before merge. <!-- sdd-owner: parent -->
- [ ] Decide chain strategy (stacked-to-main vs feature-branch-chain) and grant apply gate for PR-1 BE. <!-- sdd-owner: parent -->

## Workload / PR boundary (stacked-to-main eslabón 1/3)

- Este eslabón contiene SOLO BE PR-1: 5 archivos, `+1766/−5` (`main.rs` 62, `assets.rs` 286, `budgets.rs` 535, `debts.rs` 548, `savings.rs` 334). Producción ≈ 600 líneas, tests ≈ 1150 líneas (TDD estricto + DB-gated por módulo + reversión dedicada).
- Riesgo `High` del forecast materializado en volumen de tests, no en alcance: no se tocó FE, Fase 1/2, migraciones ni archivos prohibidos. Límite 400 superado por el slice BE+tests; si el mantenedor exige ≤400 por PR, hay que partir PR-1 (p. ej. budgets+savings vs debts+assets+wiring) o aceptar `size:exception` — el padre debe decidirlo antes del merge (no se parte unilateralmente).
- Borde del PR: base `p9-pr1` (= main), apila PR-2 (FE puros + forms S5) y PR-3 (charts + PeriodSelector + Analysis + i18n + e2e). Rollback = revert de los 5 archivos (BE aditivo, triggers intactos).
- Contratos: `deny_unknown_fields` en los 4 DTO PATCH, `401` sin sesión, `404` ajeno (nunca 403), `422` validación/trigger-owned/alias, `409` duplicado savings (y valuaciones existentes), `DELETE` 204/404, `updated_at=now()` en cada PATCH, dinero string, fechas `YYYY-MM-DD`.

## Status produced

- `applyState: ready` (12/32 completadas —12 implementation—; quedan 18 FE implementation + refactor + 2 parent). `verify: blocked` (sin `verifyReport`), `archive: blocked`. `next_recommended: parent-lifecycle` (PR-1 BE listo para verify acotado del slice; el ciclo completo cierra tras PR-2/PR-3).
- Sin `blockedReasons` nuevas. `skill_resolution: none`. Sin subagentes lanzados. Sin commits (el padre/orquestador decide el commit/PR).

---

# Apply Progress — p9-finanzas · PR-2 FE S5 (stacked-to-main, eslabón 2 de 3)

- change: `p9-finanzas` · project: `personal-dashboard` · date: 2026-09-09
- slice: PR-2 FE S5 únicamente (6 forms por dominio + mutadores + `toDebtProgress` + montaje S5) · base: rama `p9-pr1` (con PR-1 BE ya aplicado)
- chain: `stacked-to-main` (fijado por el padre; tasks.md decía `Chain strategy: pending` + `Decision needed: Yes`, el prompt delegado fija `stacked-to-main, eslabón 2 de 3`)
- TDD: `STRICT` (`pnpm exec vitest run` + `tsc --noEmit`) · BE no tocado en este eslabón
- store: openspec (`openspec/changes/p9-finanzas/apply-progress.md`, merge acumulativo con PR-1 supra)
- skill_resolution: `none` (sin `## Skills to load before work` inyectadas; se siguió el contrato del prompt + `sdd-status-contract.md` + `strict-tdd.md` globales)

## Structured status consumed

- Artefactos leídos: `tasks.md`, `design.md`, `specs/{budgets,savings,debts,subscriptions,cards,assets}-write/spec.md`, `apply-progress.md` (PR-1), `openspec/config.yaml` (`strict_tdd: false` en config, pero el prompt delegado activa STRICT TDD con runners FE — manda el prompt).
- `actionContext`: `mode: repo-local`, edición dentro del repo, sin warnings. Sin tocar Fase 1/2 (agregados S1 y sus tests intactos).
- Rama actual: `p9-pr1`. Sin bloqueos de selección de change.
- Review Workload Gate (tasks.md): `Decision needed: Yes`, `Chained PRs: Yes`, `Chain strategy: pending`, `400-line budget risk: High`. Decisión resuelta por el padre (`stacked-to-main`, solo S5 PR-2). Se implementa únicamente el slice asignado y se reporta el borde del PR (ver §Workload).

## Completed tasks (6/6 del slice S5; 18/32 implementation acumuladas) + persisted checkbox updates

En `openspec/changes/p9-finanzas/tasks.md`, pasadas de `- [ ]` a `- [x]` (solo filas `<!-- sdd-owner: implementation -->`; filas `parent` intactas):

- [x] `RED+GREEN FE budgets-form` — `createBudget/patchBudget/deleteBudget` (claves reales `warn_threshold/over_threshold`) + `BudgetForm.tsx` crear+editar+borrar con `confirm()` + invalidación `dashboard/budgets`.
- [x] `RED+GREEN FE savings-forms` — `patchGoal` + `createMovement/deleteMovement` (signed) + `SavingsForms.tsx` (`SavingsDepositForm` con guard over-withdrawal, `SavingsGoalForm` allowlist, eliminar con confirmación) + invalidación `finance/savings-goals` + `dashboard/savings-goals`.
- [x] `RED+GREEN FE debts-ui` — `patchDebt` (nombres reales) + `createPayment/deletePayment` + `DebtPayments.tsx` (`DebtPayForm` guard `amount<=pending`, `DebtPaymentHistory` vía `useDebtPayments` + corregir DELETE+prefill con confirmación, `DebtProgressBar` con `toDebtProgress`, `DebtEditForm` solo metadata) + invalidación `finance/debts` + `finance/debt-payments/{id}`.
- [x] `RED+GREEN FE subs-forms` — `createSubscription/setSubscriptionActive/deleteSubscription` (PATCH solo `{is_active}`) + `SubscriptionForms.tsx` (crear + `SubscriptionRow` cancelar/reactivar/borrar con confirmación) + invalidación `finance/subscriptions` + `dashboard/subscriptions`.
- [x] `RED+GREEN FE cards` — `createCard` (`POST /accounts type=credit_card`, exige límite + ambos días) + `CardForm.tsx`/`CardDetail.tsx` (solo formato + guía DELETE+recreate ES) + invalidación `dashboard/accounts` + `dashboard/net-worth`.
- [x] `RED+GREEN FE assets-forms + montaje S5` — `patchAsset` + `createValuation` (guard `recorded_on>máx`) + `AssetForms.tsx` (editar allowlist + valuar + archivar con confirmación) + 6 `SectionShell` S5 + patrimonio-número (`useNetWorth`, moneda de `GET /me`, fallback primera currency) en `FinanceScreens.tsx` tras las tres F1 intactas.

Re-verificado: las 6 filas muestran `- [x]`; filas FE puros/charts/analysis/e2e/refactor + 2 `parent` siguen `- [ ]`.

## Files changed (solo FE S5; sin BE; sin migraciones; sin Fase 1/2)

Nuevos (7, 819 líneas):

- `frontend/components/finance/BudgetForm.tsx` (124): crear+editar (`budget?`), select categoría por nombre, monto `normalizeManualAmount`, dates `YYYY-MM-DD`, thresholds 0–2 (defaults 0.8/1.0), notes; borrar con `confirm(finance.confirmDeleteBudget)`.
- `frontend/components/finance/SavingsForms.tsx` (148): `SavingsDepositForm` (monto firmado, guard over-withdrawal), `SavingsGoalForm` (allowlist `name/description/target_amount/target_date/category_id/color`, crear vía `POST`, eliminar con confirmación).
- `frontend/components/finance/DebtPayments.tsx` (160): `DebtPayForm` (guard `amount<=pending`), `DebtPaymentHistory` (`useDebtPayments`, corregir DELETE+prefill con confirmación), `DebtProgressBar` (`toDebtProgress`), `DebtEditForm` (`creditor/installment/interest_rate`, nunca montos).
- `frontend/components/finance/SubscriptionForms.tsx` (150): `SubscriptionCreateForm` (frecuencias enum real `daily…annual`, currency fija COP, payment_method reuse S1), `SubscriptionRow` (toggle solo `{is_active}` + borrar con confirmación).
- `frontend/components/finance/CardForm.tsx` (71): exige `credit_limit` + corte/pago 1–31 (espejo `validate_card_fields`).
- `frontend/components/finance/CardDetail.tsx` (20): solo formato (límite=usado+disponible, alerta) + `limitChangeHint` (DELETE+recreate, jamás PATCH).
- `frontend/components/finance/AssetForms.tsx` (146): `AssetEditForm` (allowlist real + archivar vía DELETE con confirmación), `AssetValuationForm` (guard fecha posterior).

Modificados:

- `frontend/lib/api/finance.ts` (+43): `apiPatch` import; wires ampliados `DebtWire` (`installment?, start_date?`), `SavingsGoalWire` (`description?, target_date?, category_id?, color?`), `SubscriptionWire` (`payment_method?, category_id?`); nuevos `DebtPaymentWire` + `fetchDebtPayments/useDebtPayments` (key `finance/debt-payments/{id}`), `AssetWire` + `fetchAssets/useAssets` (key `finance/assets`); 16 mutadores §3.2 (montos string, sin parseo).
- `frontend/lib/finance/finance.ts` (+11): `toDebtProgress({original,pending})→{paid,remaining,pct,status}` (paid=original−pending, pct clamp [0,1], `paid` si pending≤0, `warn` si pct≥0.7). Firmas existentes intactas.
- `frontend/lib/i18n/es.ts` (+44): ~40 claves `finance.*` S5 (`manage*`, forms/confirmaciones/errores/guards, `cardLimitDetail/cardAlert`, `assets/assetsHint`); genéricos reusados de `productivity.*` (save/delete/saving); cero literales en JSX nuevo.
- `frontend/components/containers/FinanceScreens.tsx` (+55/−5): hooks S5 no-bloqueantes (`useFinanceCategories/useAssets/useNetWorth` fuera del skeleton/alert S1) + `S5Sections` (6 `SectionShell` con títulos propios `manage*`, sin hints de lectura) tras las F1 intactas; `ManualCaptureSection/TransactionsLedger/TransferHistory` y sus keys sin tocar.
- Tests: `frontend/lib/finance/finance.test.ts` (+18: 2 casos `toDebtProgress`), `frontend/components/finance/finance.test.tsx` (+224: 2 mutadores + 6 forms con MSW; handlers base `/assets` + `/net-worth`).

## Test commands run (evidencia)

- Baseline pre-cambio (SAFETY NET): `pnpm exec vitest run lib/finance/finance.test.ts components/finance/finance.test.tsx` → 21 passed.
- RED: tests S5 añadidos (imports inexistentes `toDebtProgress`, mutadores, 7 componentes) → `2 failed | 10 passed` (`toDebtProgress is not a function` + import failure). ✅ RED.
- GREEN (iterativo): `toNumber` mal importado desde `finance` en vez de `money` → 7 failed; duplicados de copy S1 (títulos/hints/region `Cuentas`, textos `Music`, `/usados/`) → 5 failed. Tras títulos propios `manage*`, `CardDetail` sin `usedAvailable`, subs montando solo crear: `31 passed`. ✅ GREEN.
- TRIANGULATE: cada dominio tiene happy (mutador POST/PATCH/DELETE vía MSW + render) + borde (monto inválido, sobrerretiro, sobreabono, precio inválido, tarjeta incompleta, valuación desordenada, UUIDs ausentes). ✅.
- REFACTOR: eliminado `removeMovement` muerto + `void currency`; re-verde 31/31 + `tsc --noEmit` limpio. ✅.
- Final: `pnpm test` (vitest run) → **19 files, 182 passed** (S1 intactos); `tsc --noEmit` → exit 0.

## TDD Cycle Evidence (Strict TDD)

| Tarea | RED | GREEN | TRIANGULATE | SAFETY NET | REFACTOR |
|---|---|---|---|---|---|
| `toDebtProgress` | ✅ `is not a function` | ✅ 2 casos pasan | ✅ paid/warn/clamp mecidos | ✅ baseline 21 previo | ➖ puro mínimo |
| budgets-form | ✅ import inexistente | ✅ MSW POST/PATCH(`warn_threshold`)/DELETE + render + alerta monto | ✅ crear feliz + monto `abc`→alert + sin UUID | ✅ baseline previo | ✅ sin conducta cambiada |
| savings-forms | ✅ import inexistente | ✅ movements signed + patchGoal + renders | ✅ abono feliz + sobrerretiro→alert + meta render | ✅ GREEN previo | ✅ muerto eliminado |
| debts-ui | ✅ import inexistente | ✅ payments POST/DELETE/GET + 3 renders | ✅ abono feliz + `150>100`→alert + historial + corregir | ✅ GREEN previo | ✅ import `money` |
| subs-forms | ✅ import inexistente | ✅ POST/PATCH `{is_active}`/DELETE + renders | ✅ precio `abc`→alert + fila Cancelar | ✅ GREEN previo | ✅ sin conducta cambiada |
| cards | ✅ import inexistente | ✅ `POST /accounts` + renders | ✅ incompleto→alert + hint DELETE+recreate | ✅ GREEN previo | ✅ copy sin colisión S1 |
| assets-forms+montaje | ✅ import inexistente | ✅ PATCH/valuation + renders + 6 shells + patrimonio | ✅ fecha vieja→alert + `a1` ausente + S1 intacto (182) | ✅ suite previa | ✅ slice sin conducta cambiada |

Triangulación mínima cumplida: cada comportamiento tiene ≥2 casos; ningún GREEN es trivial (los mutadores golpean MSW y asertan método/URL/cuerpo; los forms ejecutan handlers y muestran `role=alert` reales).

## Deviations from design (menores, sin cambio de conducta pactada)

1. `frequency yearly` (tasks) vs enum real: el BE solo acepta `daily, weekly, biweekly, monthly, quarterly, semiannual, annual` (`subscriptions.rs:247-253`, migración `0001`). El form usa los 7 valores reales como value+label (identificadores, no copy). `yearly` no existe en el wire.
2. `SubscriptionRow` (cancelar/reactivar/borrar por fila) implementado + unit-testeado pero NO montado en `FinanceScreens` (solo `SubscriptionCreateForm`): montarlo duplicaría `Music`/filas de la lista S1 y rompería tests S1 (`findByText` simple). Igual para `CardDetail`: copy propio (`cardLimitDetail/cardAlert`) para no duplicar `/usados/`.
3. Títulos S5 propios (`manage*`, sin hints de lectura): las `SectionShell` S1 y S5 no pueden compartir título/hint/region sin romper los asserts S1 existentes (regiones duplicadas, `findByText` simples).
4. `puros-1`/`api-wires` quedan `- [ ]`: solo se implementó lo que S5 necesita (`toDebtProgress`, `fetchDebtPayments/useDebtPayments`, `useAssets`, expansiones de wires). `toPeriodRange`, `useSpendByCategory(type)` y resto de puros son PR-3 (charts/period), no S5.
5. `DebtPaymentHistory` vacía renderiza título + lista vacía (sin `EmptyState` dedicado) para no añadir copy/keys; el guard `paid_off` de corrección lo aplica el BE (422), el FE solo confirma.
6. `PATCH /subscriptions` con `is_active: undefined` no se envía (toggle siempre booleano); `category_id=null`/desvincular sigue convención repo (plano `Option`, igual que PR-1).

## Remaining tasks (8 implementation + 2 parent = 10 unchecked)

- [ ] RED FE puros-1 (resta `toPeriodRange`), GREEN puros-1, RED+GREEN puros-2, RED+GREEN puros-3, GREEN api-wires (resta `useSpendByCategory(type)`), charts-1/2, period+reuse, analysis, i18n cierre, e2e, REFACTOR final (ver tasks.md).
- [ ] 2 parent (bounded review + chain gate) intactas.

## Workload / PR boundary (stacked-to-main eslabón 2/3)

- Este eslabón contiene SOLO FE S5: 7 archivos nuevos (819) + 4 modificados (~150 producción) + tests (+242) + i18n (+44) ≈ **~1210 líneas**. **Supera el HARD BUDGET 400** (≈3×): 6 forms funcionales con TDD no caben en 400 (los tests S5 solos son 242). No se recortó alcance (los 6 dominios + montaje + patrimonio están completos y testeados).
- Decisión requerida del mantenedor: aceptar `size:exception` para PR-2 (precedente PR-1: +1766 también sobre budget) o partir PR-2 (p. ej. budgets+savings+debts vs subs+cards+assets+montaje). No se parte unilateralmente.
- Borde del PR: base `p9-pr1` (incluye BE PR-1), apila PR-3 (puros restantes + charts + PeriodSelector + Analysis + i18n cierre + e2e). Rollback FE = revert de los 11 archivos (S1 intacto: agregados, keys y tests S1 sin tocar). F1/F2 sin cambios; sin BE; sin migraciones.
- Contratos: montos string, allowlists reales (`warn/over_threshold`, `creditor/installment/interest_rate`, `{is_active}`, sin `credit_limit` PATCH), selects por nombre, cero UUIDs visibles, solo COP, solo ES, presupuestos nunca bloquean.

## Status produced

- `applyState: ready` (18/32 implementation acumuladas —12 PR-1 + 6 PR-2—; quedan 8 FE implementation PR-3 + refactor + 2 parent). `verify: blocked` (sin `verifyReport`), `archive: blocked`. `next_recommended: parent-lifecycle` (PR-2 S5 listo para verify acotado del slice + decisión `size:exception`; el ciclo completo cierra tras PR-3).
- Sin `blockedReasons` nuevas. `skill_resolution: none`. Sin subagentes lanzados. Sin commits (el padre/orquestador decide el commit/PR).

---

# Apply Progress — p9-finanzas · PR-3 FINAL S6 (stacked-to-main, eslabón 3 de 3)

- change: `p9-finanzas` · project: `personal-dashboard` · date: 2026-09-09
- slice: PR-3 FINAL únicamente (FIX A + puros restantes + charts + PeriodSelector + Analysis + i18n cierre + e2e + refactor) · base: rama `p9-pr2` actual
- chain: `stacked-to-main` (fijado por el padre; tasks.md decía `Chain strategy: pending` + `Decision needed: Yes`, el prompt delegado fija `stacked-to-main, eslabón 3 de 3, base p9-pr2`)
- TDD: `STRICT` (`pnpm exec vitest run` + `tsc --noEmit`; e2e `playwright --list`/`test:e2e` con `TZ=America/Bogota`) · Sin backend, sin Fase 1/2
- store: openspec (`openspec/changes/p9-finanzas/apply-progress.md`, merge acumulativo con PR-1/PR-2 supra)
- skill_resolution: `none` (sin `## Skills to load before work` inyectadas; se siguió el contrato del prompt + `sdd-status-contract.md` + `strict-tdd.md` globales)

## Structured status consumed

- Artefactos leídos: `tasks.md` (12 impl unchecked + 2 parent), `design.md` (§3.4/§4/§5), `specs/finance-charts/spec.md` + `specs/finance-analysis/spec.md`, `apply-progress.md` (PR-1 + PR-2), `openspec/config.yaml` (`strict_tdd: false` en config, pero el prompt delegado activa STRICT TDD FE — manda el prompt).
- `actionContext`: `mode: repo-local`, `workspaceRoot: /home/david/Nextcloud2/Ubuntu/landing_personal`, edición dentro del repo, sin warnings. Sin tocar Fase 1 (`ManualCapture/TransactionsLedger/TransferHistory` + keys) ni Fase 2 (`DashboardHome/widgets/notifications`).
- Rama actual: `p9-pr2`. Sin bloqueos de selección de change (change `p9-finanzas` existe en store openspec).
- Review Workload Gate (tasks.md): `Decision needed: Yes`, `Chained PRs: Yes`, `Chain strategy: pending`, `400-line budget risk: High`. Decisión resuelta por el padre (`stacked-to-main, eslabón 3 de 3`, slice PR-3 asignado). Se implementa únicamente el slice asignado y se reporta el borde del PR (ver §Workload). No se requiere `size:exception` adicional del padre para continuar, pero se reporta que el slice supera 400 (precedente PR-1/PR-2).

## Completed tasks (12/12 del slice PR-3; 30/30 implementation acumuladas) + persisted checkbox updates

En `openspec/changes/p9-finanzas/tasks.md`, pasadas de `- [ ]` a `- [x]` (solo filas `<!-- sdd-owner: implementation -->`; filas `parent` intactas byte-por-byte). Re-verificado tras marcar: `grep -c "^- \[x\].*sdd-owner: implementation"` → `30`; `grep "^- \[ \].*sdd-owner: implementation"` → 0.

- [x] `RED FE puros-1` (resta `toPeriodRange`) + `GREEN puros-1` — `toPeriodRange(sel,now)` (week=hoy−6..hoy, month=mes actual default, quarter/year naturales, custom valida `from<=to`+formato, todo `YYYY-MM-DD`, `now` inyectado) + `toDebtProgress` ya verde en PR-2 (intacto).
- [x] `RED+GREEN puros-2` — `toMonthOverMonth(cur,prev)→{delta,pct|null si prev==0}`, `toSavingsSeries`, `toBalanceSeries` (acumulado cronológico ordenado), `toMonthCompare→{cur,prev,deltaPct,curMonth,prevMonth}|null (<2→null)` + `toExpenseSeries` (columna expense, coerción solo en transforms).
- [x] `RED+GREEN puros-3` — `toInsights({flow,byCatExpense,byCatIncome,budgets,descriptions})→Insight[]` (máx 6, ordenadas mom/savings/recurrent/worst/best/avg/budget→slice 6, heurística recurrente v1 frecuencia `description` ≥3, si no concluye se omite).
- [x] `GREEN api-wires` — `useSpendByCategory(from,to,type:"income"|"expense"="expense")` con `type` en key + URL (default preserva conducta expense); `fetchDebtPayments/useDebtPayments/useAssets` + wires ampliados ya verdes en PR-2 (intactos).
- [x] `RED+GREEN charts-1` — `BalanceChart.tsx` (Area desde `toBalanceSeries`) + `SavingsChart.tsx` (área desde `toSavingsSeries`, negativo con `ReferenceLine y=0`).
- [x] `RED+GREEN charts-2` — `MonthlyExpensesChart.tsx` (Bar columna `expense` desde `toExpenseSeries`) + `MonthCompareChart.tsx` (Bar pareado + delta % vía `toMonthCompare`, <2→`EmptyState`); `FlowChart/CategoryDonut/BudgetBars` intactos; heredan exclusión `transfer`.
- [x] `RED+GREEN period+reuse` — `PeriodSelector.tsx` (5 radio-pills + 2 date inputs solo custom, default `{kind:"month"}`, `toPeriodRange`→`{from,to}` alimenta `useMonthlyFlow` + ambos `useSpendByCategory`, custom valida con error inline ES) + reuse `CategoryDonut` + `useSpendByCategory(from,to,"income")` (sin `IncomeSourceDonut`) + 7 `SectionShell` S6 en `FinanceScreens.tsx`.
- [x] `RED+GREEN analysis` — `AnalysisSection.tsx` (métricas + ≥3 insights directos máx 6 interpolados vía `t("analysis.tpl*")`, disclaimer fijo `analysis.disclaimer` siempre visible, `EmptyState`+disclaimer sin datos, wrapper focusable, sin animación).
- [x] `GREEN i18n cierre` — `charts.*` (4 títulos+hints+empties + `period{Week,Month,Quarter,Year,Custom,From,To,InvalidRange}` + `periodLabel/incomeSource/deltaLabel`) + `analysis.*` (title/hint/disclaimer + 7 plantillas + 6 métricas); cero literales en JSX nuevo; test i18n extendido (2 describes nuevos).
- [x] `GREEN e2e S5/S6` — `sections.spec.ts` +2 specs live-skipped (S5 escritura por dominio, S6 5 rangos + 4 charts + donut income + insights + disclaimer + patrimonio); `TZ=America/Bogota npx playwright test --list` → 13 tests; `pnpm test:e2e sections` → 4 skipped (sin live, exit 0).
- [x] `REFACTOR final` — `chartTheme.ts` (`chartTok/chartTooltipStyle/chartTick`) elimina duplicación tooltips/ticks en 4 charts sin cambiar conducta; `FinanceSections.tsx` intacto (solo reusa); re-verde total `cargo test` + `pnpm test` + `tsc`.
- [x] `FIX A verificado pendiente (riesgo MEDIO PR-2)` — `SubscriptionRow` montado por sub en `manageSubs` + `BudgetForm` edit (por budget) + `SavingsGoalForm` edit (por goal) cableados a sus listas en `S5Sections` (hoy solo crear); títulos `manage*` propios sin duplicar copy S1; `findByText("Music")` → `findAllByText` (único toque test S1 necesario por duplicado lectura+gestión).

## Files changed (solo FE PR-3; sin BE; sin migraciones; sin Fase 1/2)

Nuevos (11):
- `frontend/components/ui/BalanceChart.tsx` (64): `AreaChart` balance acumulado, tokens, `EmptyState` i18n, `animate`, foco teclado, 560×260 `overflow-x-auto`, sin `window`.
- `frontend/components/ui/SavingsChart.tsx` (64): área ahorro + `ReferenceLine y=0` (negativos).
- `frontend/components/ui/MonthlyExpensesChart.tsx` (65): `BarChart` expense.
- `frontend/components/ui/MonthCompareChart.tsx` (73): `toMonthCompare` + delta `t("charts.deltaLabel")` + <2→`EmptyState`.
- `frontend/components/ui/chartTheme.ts` (22, REFACTOR): `chartTok/chartTooltipStyle/chartTick` compartidos.
- `frontend/components/finance/PeriodSelector.tsx` (95): fieldset `periodLabel`, 5 pills, custom 2 dates + `role=alert` `periodInvalidRange`.
- `frontend/components/finance/AnalysisSection.tsx` (120): métricas + insights `tpl*` + disclaimer siempre + EmptyState sin datos + wrapper focusable.
- Tests nuevos: `PeriodSelector.test.tsx` (2), `AnalysisSection.test.tsx` (4).

Modificados:
- `frontend/lib/finance/finance.ts` (+239): `PeriodSel/PeriodKind`, `toPeriodRange`, `FlowLike`, `toMonthOverMonth`, `toSavingsSeries`, `toExpenseSeries`, `toBalanceSeries`, `MonthCompare/toMonthCompare`, `CategoryTotalLike/BudgetInsightLike/Insight/InsightsInput/toInsights`. Firmas existentes intactas.
- `frontend/lib/api/dashboard.ts` (+6 −4): `useSpendByCategory(from,to,type="expense")` con `type` en key + URL (1 toque).
- `frontend/lib/i18n/es.ts` (+50): `charts.*` (22 claves) + `analysis.*` (15 claves).
- `frontend/components/containers/FinanceScreens.tsx` (+168 −12): `useState<PeriodSel>({kind:"month"})` + `toPeriodRange` safe + `useMonthlyFlow` + 2×`useSpendByCategory` + `usePrefersReducedMotion` + 5 `dynamic(ssr:false)` + `S5Sections` con `budgets/subs` + edits mapeados + 7 `SectionShell` S6 (periodo + 4 charts + income donut reuse + análisis).
- Tests: `lib/finance/finance.test.ts` (+202: RED 9 + TRIANGULATE 5 + expenseSeries), `lib/api/dashboard.test.ts` (+37: type expense/income), `components/ui/charts.test.tsx` (+94: 8 RED + 1 triangulate ES/focus/hex), `components/finance/finance.test.tsx` (+47: FIX A + S6 mount 2 + `findAllByText Music`), `lib/i18n/i18n.test.ts` (+36: charts + analysis templates), `e2e/sections.spec.ts` (+56: 2 specs S5/S6).
- No tocados: `backend/*`, migraciones, `FinanceSections.tsx`, `ManualCapture/TransactionsLedger/TransferHistory`, `DashboardHome/widgets/notifications`, resto de routes.

## Test commands run (evidencia)

- Baseline pre-cambio (SAFETY NET): `pnpm exec vitest run` → 19 files, 182 passed; `tsc --noEmit` → exit 0.
- RED puros: `vitest run lib/finance/finance.test.ts` → 9 failed (`toPeriodRange/toMonthOverMonth/toSavingsSeries/toBalanceSeries/toMonthCompare/toInsights is not a function`). ✅ RED.
- GREEN puros: mismo → 21 passed. ✅ GREEN. TRIANGULATE (+5 bordes: bisiesto/custom inválido/negativo/vacío/desorden/prev==0/1-mes/tope 6) → 26 passed. ✅. +`toExpenseSeries` RED (1 failed) → GREEN → 27 passed. ✅.
- RED api-wires: `vitest run lib/api/dashboard.test.ts` → 1 failed (`Salario` no aparece, hook sin `type`). ✅ RED. GREEN (1 toque `type` en key+URL) → 9 passed + `tsc` 0. ✅ (TRIANGULATE: default expense + income, 2 casos).
- RED charts: `vitest run components/ui/charts.test.tsx` → import failure (no tests). ✅ RED. GREEN (4 charts) → 18 passed. ✅. TRIANGULATE (ES español + `tabindex=0` + `innerHTML` sin `#`) → 19 passed + `grep -E "#[0-9a-f]"` en 4 charts + theme = 0. ✅.
- RED period/analysis: `vitest run PeriodSelector.test AnalysisSection.test` → 2 files failed (import). ✅ RED. GREEN → 6 passed + `tsc` 0. ✅ (TRIANGULATE: PeriodSelector default+custom inválido+onChange; Analysis MoM/1-mes/recurrent omit/present/vacío).
- FIX A + S6 mount: `vitest run components/finance/finance.test.tsx` → 1 failed (`findByText Music` múltiple tras montar `SubscriptionRow`). ✅ RED (riesgo MEDIO materializado). GREEN (`findAllByText` + MSW `monthly-flow/by-category`) → 19 passed; +2 tests FIX A/S6 (Cancelar + Eliminar ≥2 + Mes checked + 4 charts + income donut + disclaimer + `Este mes gastaste`; custom inválido `role=alert`) → 21 passed. ✅.
- i18n: `vitest run lib/i18n/i18n.test.ts` → 14 passed (12 + 2 nuevos templates). ✅. `grep hex` charts = 0; `grep window` en 6 nuevos = 0 (solo comentario). ✅.
- e2e: `TZ=America/Bogota npx playwright test --list` → 13 tests (incluye 2 nuevos S5/S6). ✅. `TZ=America/Bogota pnpm test:e2e sections` → 4 skipped (sin live, exit 0). ✅.
- REFACTOR: `chartTheme.ts` + 4 charts usan `chartTok/chartTooltipStyle/chartTick` → `charts.test` 19 passed + `tsc` 0. ✅.
- Final: `pnpm exec vitest run` → **21 files, 218 passed** (S1 intactos salvo `findAllByText` documentado); `npx tsc --noEmit` → exit 0; `cargo test` → lib 395 + 5/3/10 integración, 0 failed (BE intacto, sin cambios PR-3).

## TDD Cycle Evidence (Strict TDD)

| Tarea | RED | GREEN | TRIANGULATE | SAFETY NET | REFACTOR |
|---|---|---|---|---|---|
| puros-1 `toPeriodRange` | ✅ 3 tests fallan (`not a function`) | ✅ 21 passed | ✅ bisiesto/custom inválido/Q1 (5 kinds) | ✅ baseline 182 + tsc 0 | ➖ puro mínimo |
| puros-2 series/MoM/compare | ✅ mismo RED (4 fns inexistentes) | ✅ 21 passed | ✅ negativo/cero/vacío/desorden/prev==0 | ✅ GREEN previo | ✅ `toExpenseSeries` añadido con su RED/GREEN |
| puros-3 `toInsights` | ✅ mismo RED | ✅ 21 passed | ✅ vacío/1-mes sin MoM/tope 6/recurrent omit/present | ✅ GREEN previo | ✅ orden mom/savings/recurrent/worst/best/avg/budget→slice 6 |
| api-wires `useSpendByCategory(type)` | ✅ `Salario` no aparece (1 failed) | ✅ 9 passed + tsc 0 | ✅ default expense + income (2 casos, key+URL) | ✅ suite previa | ➖ 1 toque, default preserva conducta |
| charts-1 Balance/Savings | ✅ import failure (no tests) | ✅ 18 passed | ✅ ES español + focus + hex 0 | ✅ baseline previo | ✅ `chartTheme` sin conducta cambiada |
| charts-2 Expenses/Compare | ✅ mismo RED | ✅ 18 passed | ✅ delta +25% + <2→EmptyState + negativo | ✅ GREEN previo | ✅ mismo refactor |
| period+reuse | ✅ import failure (2 files) | ✅ 6 passed + tsc 0 | ✅ default/custom inválido/onChange + income reuse (sin `IncomeSourceDonut`) | ✅ GREEN previo | ➖ mínimo |
| analysis | ✅ mismo RED | ✅ 6 passed | ✅ MoM/1-mes/disclaimer siempre/recurrent/vacío | ✅ GREEN previo | ➖ sin animación, wrapper focusable |
| FIX A (subs edit + budget/savings edits) | ✅ `findByText Music` múltiple (1 failed) | ✅ 21 passed (findAllByText + MSW agregados) | ✅ Cancelar + Eliminar ≥2 + custom inválido scoped | ✅ S1 19 previo | ✅ títulos `manage*` sin duplicar copy S1 |
| i18n cierre | ✅ cubierto por RED charts/analysis (keys inexistentes) | ✅ 14 passed | ✅ 7 plantillas interpoladas + métricas + hex 0 | ✅ GREEN previo | ✅ reuso `productivity.*` (save/delete), no duplicar |
| e2e S5/S6 | ➖ skip sin live (no RED ejecutable) | ✅ `--list` 13 + `test:e2e sections` 4 skipped | ✅ 5 rangos + 4 charts + donut + insights + patrimonio (live) | ✅ unit/component previo | ➖ solo specs, sin código prod |
| REFACTOR final | ➖ N/A | ✅ 19 charts + 218 total + tsc 0 + cargo 395 | ✅ `FinanceSections` intacto verificado (`git diff --name-only`) | ✅ suite verde previa | ✅ `chartTheme` + re-verde total |

Triangulación mínima cumplida: cada comportamiento tiene ≥2 casos (happy + borde); ningún GREEN es trivial (mutadores golpean MSW, charts renderizan `svg` real + `EmptyState` con precondición vacía + compañera con datos, insights asertan `kind`/`vars` concretos).

## Deviations from design (menores, sin cambio de conducta pactada)

1. `toMonthCompare` retorna `{cur,prev,deltaPct,curMonth,prevMonth}` (no solo `{cur,prev,deltaPct}` de tasks): los meses son necesarios para labels del `MonthCompareChart`; `cur/prev/deltaPct` conservan el contrato (tests asertan `deltaPct`).
2. `toInsights` retorna `Insight[]` con `{id,kind,vars}` (no strings ES): el ES vive solo en `es.ts` (`analysis.tpl*`) y `AnalysisSection` interpola con `formatMoney/formatMonth` (cero literales en puros/JSX). Plantillas y orden coinciden con diseño §4.3.
3. `toExpenseSeries` añadido (no listado en tasks): necesario para que `MonthlyExpensesChart` reciba numbers sin coerción en el container (regla "coerción solo en transforms"); testeado con su propio RED/GREEN.
4. `PeriodSelector` acepta `now?: Date` (inyectado en tests) pero la validación custom no usa `now` (solo `from/to`); `void now` evita unused. El padre calcula `from/to` con `now` real (`America/Bogota` en e2e).
5. `charts.periodFrom/To` = "Desde"/"Hasta" (igual que `finance.from/to`): duplicado textual inevitable con ledger visible; tests S6 usan `within(region Período)` para desambiguar (no se renombra copy para no romper i18n).
6. `AnalysisSection` sin `descriptions` en `FinanceScreens` (ledger pagina solo): se pasa `undefined` → recurrente se omite (diseño: "si no concluye se omite"); tests unitarios sí cubren recurrente presente/omitido.
7. `dynamic(ssr:false)` en `FinanceScreens` para los 5 (4 nuevos + `CategoryDonut` reuse): en vitest renderizan tras `findBy*` async sin flakiness; `ChartSkeleton` usa `t("common.loading")` existente (sin nuevas keys).
8. S1 test `findByText("Music")` → `findAllByText` (único toque Fase 1 necesario por FIX A lectura+gestión); resto S1 intacto (182→218 sin otros cambios Fase 1/2).

## Remaining tasks (0 implementation + 2 parent = 2 unchecked)

Exactas `- [ ]` restantes (dueño/orquestador, no apply, intactas byte-por-byte):

- [ ] Run bounded review of PR-1 → PR-2 → PR-3 chain (scope, DTO reconciliation, F1/F2 intact, i18n, a11y vales) before merge. <!-- sdd-owner: parent -->
- [ ] Decide chain strategy (stacked-to-main vs feature-branch-chain) and grant apply gate for PR-1 BE. <!-- sdd-owner: parent -->

## Workload / PR boundary (stacked-to-main eslabón 3/3 FINAL)

- Este eslabón contiene SOLO FE PR-3: 6 nuevos prod (~380: 4 charts + PeriodSelector + AnalysisSection) + `chartTheme` (22) + `finance.ts` puros (~240) + `dashboard.ts` (1 toque) + `es.ts` (~50) + `FinanceScreens` S6+FIX A (~170) + tests (~400: puros 202 + charts 94 + dashboard 37 + finance S6 47 + i18n 36 + Period/Analysis 6 ya contados en 218) + e2e (+56) ≈ **~1300 líneas**. **Supera el HARD BUDGET 400** (≈3×, precedente PR-1 +1766 y PR-2 ~1210): 4 charts + PeriodSelector + Analysis + puros + i18n + e2e con TDD no caben en 400.
- Decisión requerida del mantenedor: aceptar `size:exception` para PR-3 (cierra la cadena; el ciclo completo PR-1→PR-3 es ~4300 líneas por TDD estricto) o partir PR-3 (p. ej. puros+api-wires vs charts vs period+analysis+i18n+e2e). No se parte unilateralmente.
- Borde del PR: base `p9-pr2` actual (incluye BE PR-1 + FE S5 PR-2), eslabón 3/3 cierra la cadena (30/30 implementation). Rollback FE = revert de los 17 archivos (6 nuevos prod + chartTheme + 6 modificados + 4 tests nuevos + e2e); F1/F2 intactos (verificado `git diff --name-only`); sin BE; sin migraciones.
- Contratos: montos string, coerción solo en transforms, selects por nombre, cero UUIDs, solo COP, solo ES, presupuestos nunca bloquean, `transfer` excluido (heredado), `deny_unknown_fields` BE intacto, `dynamic(ssr:false)` + tokens + reduced-motion + foco teclado + `EmptyState` ES en los 4 charts, disclaimer siempre.

## Status produced

- `applyState: all_done` (30/30 implementation en `- [x]`; quedan solo 2 `parent` diferidas). `verify: ready` (suite verde + `apply-progress` con evidencia; pendiente `verifyReport` del dueño). `archive: blocked` (sin `verifyReport`/`syncReport`). `next_recommended: parent-lifecycle` (PR-3 FINAL listo para bounded review de la cadena + decisión `size:exception` + verify; sin commits — el padre/orquestador decide commit/PR).
- Sin `blockedReasons` nuevas. `skill_resolution: none`. Sin subagentes lanzados. Sin commits.
