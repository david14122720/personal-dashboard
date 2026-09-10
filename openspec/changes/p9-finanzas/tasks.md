# Tasks — p9-finanzas (Fase 3: S5 escritura + S6 gráficos/análisis)

- change: `p9-finanzas` · project: `personal-dashboard` · date: 2026-09-09
- strategy: `ask-on-risk` · budget: 400 · TDD: `STRICT` (`cargo test` + `vitest run` + `tsc --noEmit`)
- inputs: `proposal.md` + `design.md` + `specs/*/spec.md` + canónicos `openspec/specs/*` + `openspec/config.yaml`
- store: openspec (`openspec/changes/p9-finanzas/tasks.md`)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1800–2400 (BE ~450 + tests ~350 · FE puros ~200 · forms ~700 · charts ~300 · analysis+i18n+mount ~250 · e2e ~120) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR-1 BE 7 endpoints → PR-2 FE puros + forms S5 → PR-3 charts + PeriodSelector + AnalysisSection + i18n + e2e |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

> Delivery `ask-on-risk`: parar y preguntar antes de tocar allowlists, triggers o CHECKs si cualquier
> riesgo de `proposal.md §Risks` / `design.md §9.1–9.4` se materializa en apply. `Decision needed: Yes`
> refleja que el dueño debe confirmar la cadena (stacked-to-main vs feature-branch-chain) antes del apply.

## Conciliación canónica de DTO (vinculante para apply)

El borrador `p9-finanzas/specs/` usa **alias que NO existen en el wire real**. Apply DEBE usar los
nombres reales verificados en `backend/src/routes/*.rs` y en el canónico `openspec/specs/finance-budgets/spec.md`:

| Dominio | Usar (real / canónico) | NO usar (alias del draft p9, rechazar) |
|---|---|---|
| Budgets PATCH DTO | `amount, period_start, period_end, warn_threshold, over_threshold, notes, category_id` (columnas `budgets.rs:34-35`, DTO `budgets.rs:66-67`, canónico `warn_threshold`/`over_threshold`) | `warning_threshold`, `danger_threshold` |
| Debts PATCH DTO | `name, creditor, due_date, installment, interest_rate, notes` (columnas `debts.rs:38`, `CreateDebtRequest debts.rs:68-81`) — nunca `original_amount/pending_amount/status` | `creditor_name`, `installment_amount` |
| Savings PATCH DTO | `name, description, target_amount, target_date, category_id, color` — nunca `saved_amount/is_completed/completed_at` | — (sin alias, pero respetar exactamente esta allowlist) |
| Assets PATCH DTO | `name, category, account_id, currency, acquired_on, notes` — nunca `current_value/is_archived` | — |
| Subs PATCH | solo `{is_active}` (existente, sin cambio) | cualquier otro campo |
| Cards | sin PATCH de `credit_limit/statement_day/payment_due_day/balance` (cambio de límite = DELETE + recreate) | PATCH de límite |

Si en apply el compilador/tests revelan otro nombre real distinto, parar (ask-on-risk) y corregir la
tarea antes de cambiar el DTO.

## Mapa de archivo de specs (deltas, sin editar `openspec/specs/*`)

Los 8 deltas de `openspec/changes/p9-finanzas/specs/` se archivarán contra estos canónicos al cerrar
el change (el archivador los fusiona, apply no toca `openspec/specs/*`):

- `budgets-write` → delta de `finance-budgets` (con la conciliación `warn/over` de arriba).
- `savings-write` → delta de `finance-savings`.
- `debts-write` → delta de `finance-debts`.
- `subscriptions-write` → delta de `finance-subscriptions` (solo-FE, sin BE nuevo).
- `cards-write` → delta de `credit-card-summary` + `finance-accounts` (solo-FE, sin BE nuevo).
- `assets-write` → delta de `finance-assets`.
- `finance-charts` + `finance-analysis` → deltas de `frontend-dashboard` (+ claves `frontend-i18n`).

## Límites duros (todo apply)

- Sin migraciones. Sin tocar Fase 1 (`ManualCapture`, `TransactionsLedger`, `TransferHistory`,
  `Productivity*`, tests `s1-capture`/`s2-crud`) ni Fase 2 (`DashboardHome.tsx`, `dashboard/widgets/*`,
  `notifications/*`, `useNotifications`, `WidgetToggle`).
- Sin `PATCH` de payment/movement/valuation; sin `PATCH` de límite de tarjeta;
  sin `GET /assets/{id}/valuations`; sin evolución del patrimonio; sin PDF/Excel; solo COP; solo ES;
  selects por nombre (cero UUIDs visibles); presupuestos nunca bloquean (solo `ok|warn|over`).
- TDD estricto por unidad: RED (test falla) → GREEN (mínimo que pasa) → TRIANGULATE (casos borde) →
  REFACTOR. Comandos de verificación por unidad: `cargo test` (BE), `pnpm test` (= `vitest run`) +
  `npx tsc --noEmit` (FE), `pnpm test:e2e` (solo fase e2e).

---

## 0. Preflight (≤30 líneas, solo lectura/verificación)

- [x] Verificar punto de partida: `cargo test` en verde y `pnpm test` en verde antes de tocar código; registrar baseline en el PR. Archivos: `backend/src/main.rs`, `frontend/package.json`. <!-- sdd-owner: implementation -->
- [x] Verificar nombres reales de columnas/DTO en `backend/src/routes/budgets.rs`, `debts.rs`, `savings.rs`, `assets.rs` y anotar en PR-1 cualquier desvío de la tabla de conciliación. Archivos: `backend/src/routes/*.rs`. <!-- sdd-owner: implementation -->

## BE — 7 endpoints, sin migraciones (orden: budgets → savings → debts → assets → wiring)

### BE-1 `PATCH + DELETE /budgets/{id}` — `backend/src/routes/budgets.rs`

- [x] RED BE budgets: agregar tests unitarios de validadores + DTO `PatchBudgetRequest` con `deny_unknown_fields` (allowlist real `amount, period_start, period_end, warn_threshold, over_threshold, notes, category_id`); casos `{"spent":"10.00"}`→422, `{"status":"x"}`→422, `{"currency":"COP"}`→422, vacío→422. Verificar que fallan. Archivo: `backend/src/routes/budgets.rs`. <!-- sdd-owner: implementation -->
- [x] GREEN BE budgets: implementar `PatchBudgetRequest` + `patch_budget_handler` (QueryBuilder dinámico, `updated_at=now()`, `RETURNING` igual que GET, `parse_money_amount` / `validate_budget_period` / `validate_thresholds` / `ensure_finance_category`) + `delete_budget_handler` (`DELETE FROM budgets WHERE id=$1 AND user_id=$2`, 204/404). Verificar: `cargo test budgets`. Archivo: `backend/src/routes/budgets.rs`. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE BE budgets: agregar tests DB tras `DATABASE_URL` (patrón `db_state`/`cleanup_user`): patch parcial solo `notes` preserva resto; `amount:"0.00"`→422; período invertido→422; `warn>over`→422; categoría kind≠finance→422; categoría ajena→422; ajeno→404; doble-delete→404; asserts SQL contienen `user_id` + `updated_at = now()`. Verificar: `cargo test budgets`. Archivo: `backend/src/routes/budgets.rs`. <!-- sdd-owner: implementation -->

### BE-2 `PATCH /savings-goals/{id}` — `backend/src/routes/savings.rs`

- [x] RED+GREEN BE savings: DTO `PatchGoalRequest` con `deny_unknown_fields` (allowlist exacta `name, description, target_amount, target_date, category_id, color`) + `patch_goal_handler` (QueryBuilder, `updated_at=now()`, reuse `validate_goal_name`, `parse_money_amount`, `validate_target_date`, `ensure_finance_category`, `map_goal_db_err` 23505→409). Tests: `saved_amount`/`is_completed`/`completed_at`→422 cada uno; `target_amount:"0"`→422. Verificar: `cargo test savings`. Archivo: `backend/src/routes/savings.rs`. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE BE savings: tests DB tras `DATABASE_URL`: rename a nombre existente mismo user→409; patch parcial preserva `saved_amount` del trigger; ajeno→404; inexistente puro→422 (contrato `ensure_goal_writable`); asserts SQL `id AND user_id`. Verificar: `cargo test savings`. Archivo: `backend/src/routes/savings.rs`. <!-- sdd-owner: implementation -->

### BE-3 `PATCH + GET payments + DELETE payment /debts/` — `backend/src/routes/debts.rs`

- [x] RED+GREEN BE debts PATCH: DTO `PatchDebtRequest` con `deny_unknown_fields` y NOMBRES REALES (`name, creditor, due_date, installment, interest_rate, notes`, nunca `pending_amount/status/original_amount`) + `patch_debt_handler` (QueryBuilder, `updated_at=now()`, guard active-only→422, reuse `validate_required_text`, `validate_optional_date`, `validate_optional_installment`, `validate_optional_interest_rate`). Tests: `pending_amount`→422, `original_amount`→422, `paid_off`+PATCH→422. Verificar: `cargo test debts`. Archivo: `backend/src/routes/debts.rs`. <!-- sdd-owner: implementation -->
- [x] GREEN BE debts payments-read+delete: `list_payments_handler` (`GET /debts/{id}/payments`: `ensure_debt_writable` + `SELECT … FROM debt_payments WHERE debt_id=$1 AND user_id=$2 ORDER BY paid_on ASC, created_at ASC`, vacía→`[]`) + `delete_payment_handler` (`DELETE FROM debt_payments WHERE id=$1 AND debt_id=$2 AND user_id=$3`, 204/404). Verificar: `cargo test debts`. Archivo: `backend/src/routes/debts.rs`. <!-- sdd-owner: implementation -->
- [x] TRIANGULATE BE debts payments: tests DB tras `DATABASE_URL` de reversión del trigger OBLIGATORIOS: pending 500→pay 100 (pending 400)→DELETE (pending 500, `active`); payoff total→DELETE último payment→`status` vuelve a `active`; 404 cruzado (pid de deuda A vía deuda B); ajeno→404; inexistente→422; PATCH con payments preserva `pending_amount`. Verificar: `cargo test debts`. Archivo: `backend/src/routes/debts.rs`. <!-- sdd-owner: implementation -->

### BE-4 `PATCH /assets/{id}` + wiring — `backend/src/routes/assets.rs`, `backend/src/main.rs`

- [x] RED+GREEN BE assets: DTO `PatchAssetRequest` con `deny_unknown_fields` (allowlist `name, category, account_id, currency, acquired_on, notes`, nunca `current_value/is_archived`) + `patch_asset_handler` (QueryBuilder con cast `$::asset_category`, `WHERE id AND user_id AND NOT is_archived`, `updated_at=now()`, reuse `validate_required_text`, `validate_category`, `ensure_account_owned`, `validate_currency`, `validate_optional_date`, `map_asset_db_err`). Tests: `current_value`→422, `is_archived`→422, cuenta ajena→422, archivado→404. Verificar: `cargo test assets`. Archivo: `backend/src/routes/assets.rs`. <!-- sdd-owner: implementation -->
- [x] GREEN BE wiring + REFACTOR BE: registrar las 7 rutas en `backend/src/main.rs::api_routes` (budgets PATCH+DELETE, savings PATCH, debts PATCH + GET/DELETE payments, assets PATCH; nombres `patch_*_handler`/`delete_*_handler`/`list_payments_handler`; sin tocar `accounts.rs`, `subscriptions.rs`, `transactions.rs`, `me.rs`); smoke de rutas existente en verde; refactor común sin cambiar conducta. Verificar: `cargo test`. Archivos: `backend/src/main.rs`, `backend/src/routes/*.rs`. <!-- sdd-owner: implementation -->

## FE puros — `frontend/lib/finance/finance.ts`, `frontend/lib/api/*` (sin JSX)

- [ ] RED FE puros-1: extender `frontend/lib/finance/finance.test.ts` con `toDebtProgress({original,pending})→{paid,remaining,pct,status}` (paid=original−pending, pct clamp [0,1], `paid` si pending≤0) y `toPeriodRange(sel,now)→{from,to}` (week=hoy−6..hoy, month=mes actual default, quarter/year naturales, custom valida `from<=to`, todo `YYYY-MM-DD`, `now` inyectado). Verificar que fallan: `pnpm test finance.test`. Archivo: `frontend/lib/finance/finance.test.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE puros-1: implementar `toDebtProgress` + `toPeriodRange` en `frontend/lib/finance/finance.ts` sin tocar firmas existentes (`toLedgerRows, toBudgetViews, toAccountCards, toSubscriptionRows, toDebtRows, toSavingsViews, normalizeManualAmount, toNumber`, etc.). Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivo: `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE puros-2: tests + implementación de `toMonthOverMonth(cur,prev)→{delta,pct|null si prev==0}`, `toSavingsSeries(flow)→{month,savings:income−expense}[]`, `toBalanceSeries(flow)→{month,balance acumulado cronológico}[]`, `toMonthCompare(flow)→{cur,prev,deltaPct}|null (<2 meses→null)`; coerción string→number solo en transforms. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE puros-3: tests + implementación de `toInsights({flow,byCatExpense,byCatIncome,budgets})→Insight[]` (máx 6, ordenadas, plantillas §AnalysisSection; heurística recurrente v1 por frecuencia de `description` ≥3, si no concluye se omite). Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE api-wires: parametrizar `useSpendByCategory(from,to,type:"income"|"expense"="expense")` con `type` en la key en `frontend/lib/api/dashboard.ts` (1 toque, default preserva conducta) + agregar `fetchDebtPayments`/`useDebtPayments(debt_id)` (key `finance/debt-payments/{id}`) y `useAssets()` (key `finance/assets`) en `frontend/lib/api/finance.ts`; ampliar wires `useDebts` (`installment?, start_date?`), `useSavingsGoals` (`target_date?, category_id?, color?`), `useSubscriptions` (`frequency, payment_method, next_billing_on, category_id?`) sin cambiar formato string-money. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/dashboard.ts`, `frontend/lib/api/finance.ts`. <!-- sdd-owner: implementation -->

## FE forms S5 — `frontend/components/finance/*` + `frontend/lib/api/finance.ts` (orden por dominio)

- [ ] RED+GREEN FE budgets-form: mutadores `createBudget/patchBudget/deleteBudget` (montos string, `apiPost/apiPatch/apiDelete`, claves reales `warn_threshold/over_threshold`) + `BudgetForm.tsx` crear+editar (`budget?` opcional: categoría select por nombre, monto `normalizeManualAmount`, dates `YYYY-MM-DD`, thresholds 0–2 default 0.8/1.0, notes; borrar con `confirm()` i18n) + invalidación `dashboard/budgets`. Tests con SWR mockeado en `finance.test.tsx`. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/BudgetForm.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE savings-forms: `patchGoal` + wrappers `createMovement/deleteMovement` (signed amount) + `SavingsForms.tsx` (`SavingsDepositForm` abonar/retirar con guard cliente over-withdrawal, `SavingsGoalForm` crear+editar meta allowlist, eliminar con confirmación) + invalidación `finance/savings-goals` + `dashboard/savings-goals`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/SavingsForms.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE debts-ui: `patchDebt` (nombres reales `creditor/installment/interest_rate`, nunca montos) + `createPayment/deletePayment` + `DebtPayments.tsx` (`DebtPayForm` con guard `amount<=pending`, `DebtPaymentHistory` vía `useDebtPayments` + corregir = DELETE+prefill con confirmación, barra debo/aboné/falta con `toDebtProgress` + `ProgressBar` reuse, `DebtEditForm` solo metadata) + invalidación `finance/debts` + `finance/debt-payments/{id}`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/DebtPayments.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE subs-forms: wrappers `createSubscription/setSubscriptionActive(id,is_active)/deleteSubscription` (PATCH solo `{is_active}`, resto→422 BE) + `SubscriptionForms.tsx` (crear: name/price manual/currency default COP/frequency `weekly|monthly|quarterly|yearly`/next_billing/category/payment_method/url/notes; por fila cancelar/reactivar + borrar con confirmación) + invalidación `finance/subscriptions` + `dashboard/subscriptions`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/SubscriptionForms.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE cards: `createCard` (`POST /accounts type=credit_card`, exige `credit_limit` string + ambos cycle days, espejo `validate_card_fields`) + `CardForm.tsx`/`CardDetail.tsx` (detalle: límite/disponible/corte/pago/alerta `ok|warn|high` del BE solo formateado, reuse `AccountsList`; cambio de límite = guía DELETE+recreate con copy ES, jamás PATCH de límite; anti-N+1: statement solo en detail) + invalidación `dashboard/accounts` + `dashboard/net-worth`. Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/CardForm.tsx`, `frontend/components/finance/CardDetail.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE assets-forms + montaje S5: `patchAsset` + `createValuation` (POST existente, guard cliente `recorded_on>máx`) + `AssetForms.tsx` (`AssetEditForm` allowlist real + `AssetValuationForm` + archivar con confirmación vía DELETE existente) + montar las 6 `SectionShell` S5 en `frontend/components/containers/FinanceScreens.tsx` DESPUÉS de las tres F1 intactas (prohibido tocar `ManualCaptureSection`/`TransactionsLedger`/`TransferHistory` y sus keys) + sección patrimonio-número con `useNetWorth` existente (moneda de `GET /me`, fallback primera currency; sin widget home, sin gráfico evolución). Tests SWR mockeado. Verificar: `pnpm test finance.test` + `npx tsc --noEmit`. Archivos: `frontend/lib/api/finance.ts`, `frontend/components/finance/AssetForms.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/finance/finance.test.tsx`. <!-- sdd-owner: implementation -->

## FE charts S6 — `frontend/components/ui/*` + `frontend/components/finance/PeriodSelector.tsx`

- [ ] RED+GREEN FE charts-1: `BalanceChart.tsx` (`AreaChart` desde `toBalanceSeries(monthly-flow)`) + `SavingsChart.tsx` (área/línea desde `toSavingsSeries`, admite negativo con eje en 0); patrón `FlowChart.tsx` (`accessibilityLayer`, `chartToken()`/tokens `--color-*` cero hex, `CartesianGrid --color-hull`, ticks 12px, `Tooltip formatMoney`, `isAnimationActive={animate}` + `prefers-reduced-motion`, foco teclado, `EmptyState` i18n, 560×260 `overflow-x-auto`, `next/dynamic(ssr:false)`, sin `window` en import). Tests en `charts.test.tsx` (con datos + `EmptyState` + reduced-motion). Verificar: `pnpm test charts.test` + `npx tsc --noEmit`. Archivos: `frontend/components/ui/BalanceChart.tsx`, `frontend/components/ui/SavingsChart.tsx`, `frontend/components/ui/charts.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE charts-2: `MonthlyExpensesChart.tsx` (`BarChart` columna `expense`) + `MonthCompareChart.tsx` (`BarChart` pareado actual vs anterior + delta % vía `toMonthCompare`, <2 meses→`EmptyState`); mismo patrón/vales que charts-1; `FlowChart`/`CategoryDonut`/`BudgetBars` intactos; heredan exclusión de `transfer` sin "corregirla". Tests en `charts.test.tsx`. Verificar: `pnpm test charts.test` + `npx tsc --noEmit`. Archivos: `frontend/components/ui/MonthlyExpensesChart.tsx`, `frontend/components/ui/MonthCompareChart.tsx`, `frontend/components/ui/charts.test.tsx`. <!-- sdd-owner: implementation -->
- [ ] RED+GREEN FE period+reuse: `PeriodSelector.tsx` (`{kind:week|month|quarter|year|custom}`, 5 radio-pills + 2 date inputs solo en custom, default `{kind:"month"}`, `toPeriodRange`→`{from,to}` alimenta `useMonthlyFlow` + ambos `useSpendByCategory`; custom valida `from<=to` + formato, error inline ES) + reuse ingresos-por-fuente (`CategoryDonut` existente + `useSpendByCategory(from,to,"income")`; `IncomeSourceDonut` solo si reuse no calza) + montar secciones S6 en `FinanceScreens.tsx`. Tests con `now` inyectado. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/PeriodSelector.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/lib/finance/finance.test.ts`. <!-- sdd-owner: implementation -->

## FE analysis + i18n — `frontend/components/finance/AnalysisSection.tsx`, `frontend/lib/i18n/es.ts`

- [ ] RED+GREEN FE analysis: `AnalysisSection.tsx` (tasa de ahorro, promedios, top categoría, MoM, mes mayor gasto/ahorro desde `monthly-flow` + `by-category` ambos tipos + `budgets`; ≥3 insights tono directo, máx 6, valores interpolados; heurística recurrente v1 omitida si no concluye; disclaimer fijo `analysis.disclaimer` "Análisis personal, no asesoramiento financiero." siempre visible; `EmptyState`+disclaimer sin datos; respeta reduced-motion y foco teclado). Tests: MoM correcto, delta nulo con 1 mes, disclaimer siempre, heurística omitida/presente. Verificar: `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/AnalysisSection.tsx`, `frontend/lib/i18n/es.ts`. <!-- sdd-owner: implementation -->
- [ ] GREEN FE i18n cierre: completar claves `finance.*` (todos los forms/confirmaciones/errores S5), `charts.*` (4 nuevos + `period{Week,Month,Quarter,Year,Custom,From,To,InvalidRange}` + empties), `analysis.*` (title/hint/disclaimer + 7 plantillas + métricas); cero literales en JSX nuevo (reusar `productivity.*` donde exista, no duplicar); extender test i18n (render cada form/chart con `es`, assert ausencia de strings fuera de `t`). Verificar: `pnpm test i18n` + `npx tsc --noEmit` + grep hex en charts = 0 fuera de tokens. Archivos: `frontend/lib/i18n/es.ts`, `frontend/lib/i18n/i18n.test.ts`. <!-- sdd-owner: implementation -->

## E2E + refactor final

- [ ] GREEN FE e2e S5/S6: extender `sections.spec.ts` (S5: montos manuales string, date-inputs `YYYY-MM-DD`, selects por nombre, confirmaciones crear/editar/borrar por dominio, corregir abono delete+recreate, cancelar/reactivar sub, crear tarjeta, valuar activo; S6: 5 rangos del `PeriodSelector` filtran ambos agregados, 4 charts + donut income renderizan, insights ≥3 + disclaimer, patrimonio-número visible). Verificar: `pnpm test:e2e sections`. Archivo: `frontend/e2e/sections.spec.ts` (o ruta `*.spec.ts` vigente del repo si difiere). <!-- sdd-owner: implementation -->
- [ ] REFACTOR final: eliminar duplicación entre forms/charts/transforms sin cambiar conducta, confirmar `FinanceSections.tsx` solo reusa (`SectionShell/ProgressBar/LedDot/EmptyState`) sin cambios, y re-verde total: `cargo test` + `pnpm test` + `npx tsc --noEmit`. Archivos: `frontend/components/finance/*`, `frontend/components/ui/*`, `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->

## Post-apply (dueño/orquestador, no apply)

- [ ] Run bounded review of PR-1 → PR-2 → PR-3 chain (scope, DTO reconciliation, F1/F2 intact, i18n, a11y vales) before merge. <!-- sdd-owner: parent -->
- [ ] Decide chain strategy (stacked-to-main vs feature-branch-chain) and grant apply gate for PR-1 BE. <!-- sdd-owner: parent -->
