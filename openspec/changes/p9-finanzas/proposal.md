# Proposal — p9-finanzas (Fase 3: S5 escritura + S6 gráficos/análisis)

- change: `p9-finanzas`
- project: personal-dashboard
- date: 2026-09-09
- mode: auto · strategy: ask-on-risk · budget: 400 · TDD estricto
- inputs: `exploration.md` + `preproposal.md` (4 decisiones del dueño ya resueltas — NO se entrevista)
- store: openspec (`openspec/changes/p9-finanzas/proposal.md`)

## Intent

Completar el módulo de finanzas con escritura total (S5) y análisis visual simple (S6),
sin tocar Fase 1 (captura/ledger/transferencias/productividad) ni Fase 2 (home/widgets/notifications),
sin migraciones, solo COP, todo manual sin UUIDs visibles, y solo ES.

- **S5 — escritura:** presupuestos crear/editar/borrar; ahorros abonar/retirar + editar meta + eliminar;
  deudas abono corregible (agregar + corregir vía eliminar+recrear + historial visible + barra debo/aboné/falta);
  subs CRUD (crear, cancelar/reactivar, borrar); tarjetas como `accounts type=credit_card`
  (crear + ver límite/disponible/corte/pago/alerta).
- **S6 — patrimonio/gráficos/análisis:** patrimonio = número simple (`GET /net-worth`, reuse `useNetWorth`);
  4 charts nuevos FE-only + 1 reuse; `PeriodSelector` (semana/mes/trimestre/año/custom, default mes actual);
  `AnalysisSection` con MoM + insights de plantillas ES directas, nunca asesoramiento.
- **BE mínimo:** 7 handlers/rutas nuevos sobre tablas existentes (§Scope BE). Todo lo demás es FE-only
  sobre agregados existentes (`by-category`, `monthly-flow`, `net-worth`, `budgets` status).

## Decisiones del dueño (preproposal.md 2026-09-09 — vinculantes)

1. `budget-edit: editar` → `PATCH /budgets/{id}` (no borrar+crear).
2. `payment-edit: corregible` → abono editable/eliminable **en UX**; en BE se implementa como
   `DELETE /debts/{id}/payments/{pid}` + `POST` recreate (montos inmutables, igual que `transactions`;
   sin `PATCH` de payment — ver §Non-goals).
3. `default-period: mes actual` → `PeriodSelector` arranca en mes corriente.
4. `insights-tone: directo` → plantillas tipo "gastaste 18% más en X que el mes anterior".

## Scope

### BE — 7 endpoints nuevos, sin migraciones

| # | Endpoint | Allowlist (deny_unknown_fields) | Reutiliza | Errores |
|---|---|---|---|---|
| 1 | `PATCH /budgets/{id}` | `amount, period_start, period_end, warning_threshold, danger_threshold, notes, category_id` | `parse_money_amount`, `validate_budget_period`, `validate_thresholds`, `ensure_finance_category` | 401 no-auth · 404 ajeno/inexistente · 422 validación/categoría · trigger-owned intentado → 422 |
| 2 | `DELETE /budgets/{id}` | — (204) | patrón delete existente | 401 · 404 ajeno/inexistente |
| 3 | `PATCH /savings-goals/{id}` | `name, description, target_amount, target_date, category_id, color` — nunca `saved_amount/is_completed/completed_at` | `ensure_goal_writable` (ajeno 404 / inexistente 422), 409 nombre duplicado, 422 over-withdrawal | 401/404/422/409 |
| 4 | `PATCH /debts/{id}` | `name, creditor_name, due_date, installment_amount, interest_rate, notes` — nunca `pending_amount/status` | `ensure_debt_writable`, guard active-only, `ensure_transaction_owned` | 401/404/422 |
| 5 | `GET /debts/{id}/payments` | lectura historial para UI abonos | `ensure_debt_writable` (ownership) | 401/404 |
| 6 | `DELETE /debts/{id}/payments/{pid}` | 204; trigger `update_debt_pending` ya revierte en DELETE | `ensure_transaction_owned` + guard active-only + `amount <= pending` | 401/404/422 + test reversión dedicado |
| 7 | `PATCH /assets/{id}` | `name, category, account_id, currency, acquired_on, notes` — nunca `current_value/is_archived` | patrón `UPDATE ... SET updated_at = now()` | 401/404/422 |

Convenciones replicadas en los 7: `require_user_id`; ajeno → 404 (nunca 403); dinero como string;
`updated_at = now()` en cada PATCH; mapeo `23505→409`, `23514/23503→422`; tests por handler
(validadores puros + asserts fragmentos SQL `user_id` / `id=$1 AND user_id=$2` + tests DB con
`db_state`/`cleanup_user` tras `DATABASE_URL`).

### FE S5 — escritura manual, ES, solo COP, selectores por nombre

- `FinanceScreens.tsx`: nuevas `SectionShell` + formularios por dominio; claves SWR prefijo `finance/`;
  prohibido tocar `ManualCaptureSection`, `TransactionsLedger`, `TransferHistory`.
- `lib/api/finance.ts`: mutadores budget create/PATCH/delete; goal PATCH (+ wrappers movement POST/DELETE
  existentes); debt PATCH + payment POST/DELETE/GET-list; sub CRUD wrappers (sobre `PATCH is_active` existente);
  asset PATCH + valuation POST; card create. Ampliar wires `useDebts`/`useSavingsGoals`/`useSubscriptions`
  (`installment`, `start_date`, `saved/target`, `frequency`, `payment_method`).
- `lib/finance/finance.ts` (+ tests): view-models puros, coerción string→number solo aquí;
  `normalizeManualAmount`, `toNumber`; debt progress (aboné/falta/pct), card detail
  (`used/available/usage_pct/alert ok|warn|high` ya calculado en BE), asset rows.
- `components/finance/*`: `BudgetForm` (editar + borrar con confirmación), `SavingsForms`
  (abonar/retirar = POST signed amount; editar meta = PATCH; eliminar), `DebtPayments`
  (abono + historial + barra; corregir = eliminar + recrear con confirmación),
  `SubscriptionForms` (crear price/frequency/next_billing; cancelar/reactivar; borrar),
  `CardForm/CardDetail` (crear exige `credit_limit` + ambos cycle days; detalle muestra
  límite/disponible/corte/pago/alerta), `AssetForms` (editar meta + valuar via POST valuation).
- `lib/i18n/es.ts`: claves `finance.*` para todos los forms/confirmaciones/errores. Prohibido hardcodear.

### FE S6 — 4 nuevos + 1 reuse + período + análisis (todo FE-only, sin BE nuevo)

- **Reuse:** ingresos-por-fuente = `CategoryDonut` existente + `by-category?type=income`
  (solo parametrizar `type` en `useSpendByCategory`, hoy hardcodea `expense`).
- **Nuevos (Recharts 3, `next/dynamic(ssr:false)`, tokens `--color-*`, labels ES,
  `prefers-reduced-motion`, foco teclado, `EmptyState`):**
  1. `BalanceChart` — evolución del saldo: balance acumulado desde `monthly-flow` (`toFlowPoints().balance`), `AreaChart`.
  2. `SavingsChart` — evolución del ahorro: `income − expense` por mes desde `monthly-flow`, línea/área.
  3. `MonthlyExpensesChart` — gastos mensuales: columna `expense` de `monthly-flow`, `BarChart`.
  4. `MonthCompareChart` — comparativa mes actual vs anterior desde `monthly-flow` (barras pareadas + delta %).
- **Existentes intactos:** `FlowChart` (ingresos vs gastos), `CategoryDonut` (gastos por categoría),
  `BudgetBars`/`BudgetsList` (presupuestos).
- **`PeriodSelector`:** semana (últimos 7 días) / mes / trimestre / año / custom (dos date inputs `YYYY-MM-DD`);
  default = mes actual (decisión dueño); computa `from/to` para `by-category` + `monthly-flow`
  (validadores `validate_stats_range` ya soportan el rango); los charts agregan en FE lo devuelto.
- **`AnalysisSection` + `lib/finance` puros:** tasa de ahorro, promedios, top categoría, variación MoM
  (`toMonthOverMonth`), mes mayor gasto/ahorro; **plantillas ES fijas, tono directo**
  ("Este mes gastaste N% más en X que el mes anterior"); lista cerrada, sin LLM/generación libre;
  disclaimer no-asesor ("análisis personal, no asesoramiento financiero").
  Heurística "recurrente/extraordinario" v1: frecuencia de `description` en el período; si no concluye,
  se omite esa línea (no se inventa).
- **Patrimonio:** número simple vía `useNetWorth` en pantalla finanzas (moneda de `GET /me`,
  fallback primera currency); sin widget nuevo en home.

## Affected areas

- BE tocar: `backend/src/routes/budgets.rs`, `savings.rs`, `debts.rs`, `assets.rs`;
  rutas en `backend/src/main.rs::api_routes`. No tocar `accounts.rs`, `subscriptions.rs`,
  `transactions.rs`, `me.rs` ni resto de routes.
- FE tocar: `frontend/components/containers/FinanceScreens.tsx`, `frontend/lib/api/finance.ts`,
  `frontend/lib/api/dashboard.ts` (solo parametrizar `type`), `frontend/lib/finance/finance.ts`,
  `frontend/components/finance/FinanceSections.tsx` (o nuevos `finance/*.tsx`),
  `frontend/components/ui/*` (reuse), `frontend/lib/i18n/es.ts`.
- FE crear (nombres finales en design): `finance/BudgetForm`, `DebtPayments`, `SavingsForms`,
  `SubscriptionForms`, `CardDetail/CardForm`, `AssetForms`, `PeriodSelector.tsx`, `AnalysisSection.tsx`;
  `ui/BalanceChart`, `MonthlyExpensesChart`, `MonthCompareChart`, `SavingsChart`
  (`IncomeSourceDonut` solo si `CategoryDonut` no calza con otros datos).
- Tests: extends `finance.test.tsx`/`finance.test.ts`, `charts.test.tsx`, e2e `sections.spec.ts`;
  BE tests por módulo con patrón existente.
- Specs delta a crear en fase spec (`p9-finanzas/specs/`, sin editar `openspec/specs/*`):
  `finance-budgets-write`, `finance-savings-write`, `finance-debts-write`, `finance-subscriptions-ui`,
  `credit-cards-ui`, `finance-assets-ui`, `finance-charts`, `finance-analysis`
  (+ `reports-screen` solo si "reportes solo pantalla" excede a `AnalysisSection`).

## Non-goals / No tocar (límites duros)

- Fase 1: `ManualCapture`, `TransactionsLedger`, `TransferHistory`, `Productivity*`,
  tests `s1-capture`/`s2-crud`. Fase 2: `DashboardHome.tsx`, `dashboard/widgets/*`,
  `notifications/*`, `useNotifications`, `WidgetToggle`.
- Evolución del patrimonio (gráfico 6/9 de objetivo.md) — excluido; valuaciones INSERT-only
  (guard `recorded_on > max` + 409 duplicada); corrección = archive + recreate.
- `PATCH` de payment/movement — no existe por diseño (inmutabilidad como transactions);
  corrección UX "editable" = DELETE + recreate con confirmación.
- `PATCH` de `credit_limit`/días de tarjeta — no se crea (fuera del BE pactado);
  cambio de límite = DELETE + recreate para no romper historial `credit_card_account_id`.
  (Si el dueño lo pide después, es change aparte con `validate_card_fields`.)
- `GET /assets/{id}/valuations` — no se crea (innecesario sin evolución global).
- Sin PDF/Excel (reportes = solo pantalla por período); sin multi-moneda (solo COP);
  sin UUIDs visibles (selectores por nombre); sin LLM; sin migraciones;
  presupuestos nunca bloquean (solo aviso `ok|warn|over`).

## Risks

1. `deny_unknown_fields` — cada PATCH DTO debe listar exactamente su allowlist o FE recibe 422
   inesperados. Mitiga: tabla §BE + test "campo trigger-owned → 422" por endpoint.
2. Trigger-owned (`saved_amount`, `pending_amount/status`, `current_value`, `balance`) —
   jamás escribibles; `DELETE payment` debe probar reversión del trigger.
3. Cap sqlx 16 columnas en `AccountRow` — no agregar columnas; métricas card en Rust,
   statement solo en detail (anti-N+1 ya existente).
4. CHECKs (`chk_card_*`, `budget_period_valid`, thresholds) — validar en API para 422 con mensaje,
   nunca 500; mapear `23505/23514/23503`.
5. `transactions` excluye `transfer` de agregados — charts lo heredan; no "corregirlo".
6. `output: export` + Recharts — `dynamic(ssr:false)`, sin `window` en import; E2E cubre
   montos string y fechas `YYYY-MM-DD`; accesibilidad `frontend-dashboard/spec.md` obligatoria.
7. Sobrecoste budget 400 — BE son 7 handlers delgados sobre patrones copiados; riesgo real está
   en FE (9 formularios + 4 charts). Mitiga: TDD estricto, reuse máximo (`CategoryDonut`,
   `SectionShell`, `ProgressBar`, `EmptyState`), y fallback verificador + Juicio previstos.

## Rollback

- Sin migraciones → rollback = revert de commits, sin data-migration de vuelta.
- BE: cada handler + ruta es aditivo; revert por archivo (`budgets/savings/debts/assets.rs` + `main.rs`)
  deja el API en el estado anterior; triggers existentes intactos (DELETE payment sin handler
  simplemente no se expone).
- FE: secciones S5/S6 viven en `SectionShell` nuevas dentro de `FinanceScreens`; rollback = ocultar
  las secciones (feature-flag local o revert de `finance/*` + `PeriodSelector`/`AnalysisSection`)
  sin afectar captura/ledger/transferencias ni home.
- Criterio ask-on-risk: si cualquier riesgo §1–§4 se materializa en implementación,
  parar y preguntar antes de cambiar allowlists, triggers o CHECKs.

## Success criteria

- S5: usuario crea/edita/borra presupuesto (PATCH verificado); abona/retira en ahorro, edita meta,
  elimina; abona deuda, ve historial + barra debo/aboné/falta, corrige (delete+recreate) y elimina abono;
  CRUD subs completo; crea tarjeta y ve límite/disponible/corte/pago/alerta. Todo manual, ES, COP,
  sin UUIDs; presupuestos solo avisan, nunca bloquean.
- S6: 4 charts nuevos renderizan con datos y `EmptyState` sin datos; ingresos-por-fuente reuse donut
  con `type=income`; `PeriodSelector` default mes actual y los 5 rangos filtran los mismos agregados;
  `AnalysisSection` muestra MoM + ≥3 insights directos con valores correctos y disclaimer no-asesor;
  patrimonio-número visible en finanzas.
- Calidad: `cargo test` en verde (patrón `AssertSqlSafe` donde aplique + unitarios puros +
  asserts SQL + DB tras `DATABASE_URL`); FE transforms puros testeados (progress, MoM, insights, rangos);
  componentes con SWR mockeado; e2e `sections.spec.ts` cubre S5/S6; i18n sin strings hardcodeados;
  vales `frontend-dashboard` (tokens, code-split, reduced-motion, teclado) cumplidos.
- Límites: Fase 1/2 intacta (sus tests/secciones sin cambios); sin migraciones nuevas;
  wire intacto (montos string, `deny_unknown_fields`, 401/404/422).

## Proposal question round (omitida — handoff confirmado)

Delegación con `NO entrevistes`: las 4 decisiones de producto ya las resolvió el dueño
(budget-edit→editar, payment-edit→corregible-vía-recreate, default-period→mes actual,
insights-tone→directo). Supuestos restantes de `exploration.md §6` quedan fijados en esta
propuesta (§Scope + §Non-goals: sin PATCH payment/movement, sin PATCH card, sin GET valuations,
heurística recurrente mínima). Si el dueño discrepa de alguna fijación, se ajusta en fase spec.
