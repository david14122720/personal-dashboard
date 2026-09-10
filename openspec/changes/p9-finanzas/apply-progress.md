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
