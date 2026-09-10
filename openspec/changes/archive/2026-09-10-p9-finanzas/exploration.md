# Exploración — p9-finanzas (Fase 3: S5 escritura + S6 patrimonio/gráficos/análisis)

## 1. Objetivo del change
- **S5 Escritura finanzas (UI + PATCH/DELETE faltantes):** presupuestos crear/editar/borrar; ahorros abonar/retirar/eliminar;
  deudas abono con barra de progreso; subs CRUD; tarjetas (límite/disponible/corte/pago/alerta) vía `accounts type=credit_card`.
- **S6 Patrimonio simple + gráficos extendidos + análisis:** CRUD activos/valuaciones UI; patrimonio = número simple
  (`activos − deudas`, ya visible vía `GET /net-worth` en dashboard); 5 gráficos nuevos (el 6º, evolución patrimonio, **NO**
  requerido); selector de período semana/mes/trimestre/año/custom; indicadores MoM + insights en texto (spec nuevo, tono
  personal, nunca asesoramiento médico/financiero).
- **Decisiones grill-me heredadas (objetivo.md):** solo COP; todo manual sin UUIDs visibles (selectores por nombre);
  presupuestos solo aviso visual (nunca bloquean); deudas modelo simple debo/aboné/falta; tarjetas como cuenta con
  límite/corte/pago/alerta; patrimonio número simple sin evolución; reportes solo pantalla por período (sin PDF/Excel).
- **Límites duros:** no tocar Fase 1 (S1/S2: `ManualCapture`, `TransactionsLedger`, `TransferHistory`, `Productivity*`,
  tests `s1-capture`/`s2-crud`) ni Fase 2 (widgets/notifications del home: `DashboardHome.tsx`, `dashboard/widgets/*`,
  `notifications/*`). `cargo test` desbloqueado (patrón `AssertSqlSafe` solo en tests EXPLAIN de habits/notes; finanzas
  usa `&str` consts + tests unitarios puros + asserts de fragmentos SQL + tests DB tras `DATABASE_URL`) — el BE nuevo
  (PATCH/DELETE) es testeable con el mismo patrón.

## 2. Mapa BE — archivos a tocar/crear

Eje: `backend/src/routes/{budgets,savings,debts,subscriptions,assets,accounts,transactions}.rs` + rutas en
`backend/src/main.rs::api_routes`. Sin migración nueva prevista (todo es handler + ruta; ver §4).

### 2.1 Endpoints: existen vs faltan (exactos)

| Dominio | Existe hoy (reutilizar) | Falta para S5/S6 |
|---|---|---|
| Presupuestos (`routes/budgets.rs`) | `POST /budgets`, `GET /budgets` (colección con status), `GET /budgets/{id}`, `GET /budgets/{id}/status` | **`PATCH /budgets/{id}`** (amount/period/thresholds/notes/category) + **`DELETE /budgets/{id}`** (204; ajeno 404). Reutilizar `parse_money_amount`, `validate_budget_period`, `validate_thresholds`, `ensure_finance_category`. |
| Ahorros (`routes/savings.rs`) | `POST+GET /savings-goals`, `GET+DELETE /savings-goals/{id}`, `POST /savings-goals/{id}/movements`, `DELETE /savings-goals/{id}/movements/{mid}` | **`PATCH /savings-goals/{id}`** (name/description/target_amount/target_date/category/color; nunca `saved_amount/is_completed/completed_at`: trigger-owned + `deny_unknown_fields`). Movements **sin PATCH por diseño** (abono/retiro = `POST` con signed amount; corrección = DELETE + recreate; el trigger revierte). Seguir `ensure_goal_writable` (ajeno 404 / inexistente 422), 409 nombre duplicado, 422 over-withdrawal. |
| Deudas (`routes/debts.rs`) | `POST+GET /debts`, `GET+DELETE /debts/{id}`, `POST /debts/{id}/payments` | **`PATCH /debts/{id}`** (name/creditor/due_date/installment/interest_rate/notes; nunca `pending_amount/status`) + **`DELETE /debts/{id}/payments/{pid}`** (el trigger `update_debt_pending` ya tiene rama DELETE que revierte — solo falta handler + ruta) + **`GET /debts/{id}/payments`** (historial para la UI de abonos; no existe handler de lectura). `PATCH` de payment **no recomendado** (montos inmutables como en transactions; corrección = DELETE + recreate). Reutilizar `ensure_debt_writable`, guard active-only, `amount <= pending`, `ensure_transaction_owned`. |
| Subs (`routes/subscriptions.rs`) | **Completo:** `POST+GET /subscriptions`, `GET+PATCH(is_active)+DELETE /subscriptions/{id}` | Nada en BE. Solo UI CRUD (crear con price/frequency/next_billing; cancelar/reactivar vía PATCH existente; borrar). `PATCH` solo acepta `is_active` (`deny_unknown_fields` rechaza resto). |
| Tarjetas (`routes/accounts.rs`, type=`credit_card`) | **Completo:** `POST` (exige `credit_limit` + ambos cycle days), `GET` list/detail (detail suma `statement_balance` vía 2ª query indexada; list la omite anti-N+1), métricas derivadas en Rust (`used/available/usage_pct/alert ok|warn|high`), `PATCH` metadata, `DELETE` física solo sin movimientos (409 con movimientos) | Nada en BE salvo decisión propuesta: `PATCH` hoy **no edita** `credit_limit/statement_day/payment_due_day/balance` (`deny_unknown_fields`) — ¿cambio de límite = nuevo PATCH card o DELETE + recreate? Definir en propuesta. |
| Patrimonio (`routes/assets.rs`) | `POST+GET /assets`, `GET + archive-`DELETE` /assets/{id}` (flag `is_archived`, historial sobrevive), `POST /assets/{id}/valuations`, `GET /net-worth` (agregado on-demand: `Σ current_value` no-archivados − `Σ pending` activas − deuda cards `GREATEST(-balance,0)`, por currency) | **`PATCH /assets/{id}`** (name/category/account/currency/acquired_on/notes; nunca `current_value/is_archived`). Valuations **INSERT-only por diseño** (guard `recorded_on > max` + 409 fecha duplicada; el trigger no tiene rama DELETE) — corrección = archive + recreate. `GET /assets/{id}/valuations` (list) no existe: solo crearlo si la UI S6 quiere historial por activo (evolución global NO requerida, así que probablemente innecesario — decidir en propuesta). |
| Base gráficos/análisis (`routes/transactions.rs`) | `GET /transactions` (keyset + filtros), `GET /transactions/stats/by-category?from&to&type=` (acepta `income` y `expense` vía `validate_transaction_type`), `GET /transactions/stats/monthly-flow?from&to` (income+expense por mes `YYYY-MM`, excluye transfers) | Nada en BE para S6: los 5 gráficos + MoM + insights se componen 100% en FE desde estos agregados + `GET /net-worth` + `GET /budgets` (status). |

### 2.2 Convenciones BE a replicar en handlers nuevos
- Auth: `require_user_id` en todo; ajeno → 404 (nunca 403/oráculo); categorías ajenas o de kind erróneo → 422.
- Dinero como string en request/response (`parse_money_amount` `>0` / `parse_money_amount_nonneg`); thresholds como `f64` ratios.
- DTOs con `deny_unknown_fields`; campos trigger-owned jamás escribibles.
- `UPDATE ... SET updated_at = now()` en cada PATCH (patrón `subscriptions.rs::PATCH_SUB_SQL` / QueryBuilder de `accounts.rs`).
- Tests por handler: validadores puros + asserts de fragmentos SQL (`user_id`, `id=$1 AND user_id=$2`) + tests DB con `db_state`/`cleanup_user` tras `DATABASE_URL` (patrón existente en cada módulo).

## 3. Mapa FE — archivos a tocar/crear

### 3.1 Tocar (existentes)
| Archivo | Cambio S5/S6 |
|---|---|
| `frontend/components/containers/FinanceScreens.tsx` | Nuevas `SectionShell` + formularios S5/S6; agregar hooks. No tocar `ManualCaptureSection`, `TransactionsLedger`, `TransferHistory`. Claves SWR con prefijo `finance/` para heredar el retry existente. |
| `frontend/lib/api/finance.ts` | Mutadores nuevos: budget create/PATCH/delete; goal PATCH (+ wrappers movement POST/DELETE existentes); debt PATCH + payment POST/DELETE (+ GET payments si se crea); sub CRUD wrappers; asset PATCH + valuation POST; card create. Hooks `useDebts`/`useSavingsGoals`/`useSubscriptions` existen (ampliar wires con campos que la UI necesita: `installment`, `start_date`, `saved/target`, `frequency`, `payment_method`). |
| `frontend/lib/api/dashboard.ts` | Reutilizar `useBudgets`, `useAccounts`, `useNetWorth`, `useMonthlyFlow`, `useSpendByCategory`. **Parametrizar `type`** en `useSpendByCategory` (hoy hardcodea `type=expense`) para "ingresos por fuente" (`type=income`). |
| `frontend/lib/finance/finance.ts` (+ tests) | Nuevos view-models puros (coerción string→number solo aquí): debt progress (`aboné/falta/pct`), card detail, asset rows, period ranges, MoM (`toMonthOverMonth`), insights (`toInsights`). Reutilizar `normalizeManualAmount`, `toNumber`, `ledDotClass`. |
| `frontend/components/finance/FinanceSections.tsx` (o nuevos `finance/*.tsx`) | Presentacionales nuevos: `BudgetForm`, `DebtPayments` (abono + historial + barra), `SavingsForms`, `SubscriptionForms`, `CardDetail/CardForm`, `AssetForms`, `PeriodSelector`, `AnalysisSection`. Reutilizar `SectionShell`, `ProgressBar`, `LedDot`, `EmptyState`, `formatMoney`. |
| `frontend/components/ui/*` | Reutilizar `FlowChart`, `CategoryDonut`, `BudgetBars`, `MetricCard`; nuevos charts solo donde no calcen (ver §3.3). Heredar reglas `frontend-dashboard/spec.md`: Recharts 3, code-split `next/dynamic(ssr:false)`, tokens `--color-*` sin hex, labels ES, `prefers-reduced-motion`, foco teclado, `EmptyState` sin datos. |
| `frontend/lib/i18n/es.ts` (+ test) | Claves `finance.*` (forms S5, tarjetas, activos), `charts.*` (5 gráficos + período), `analysis.*` (indicadores + plantillas insights). Single-locale ES, `t(key, vars)`, prohibido hardcodear. |

### 3.2 Crear (propuesta decide nombres finales)
- `frontend/components/finance/` nuevos: formularios S5 por dominio + `PeriodSelector.tsx` + `AnalysisSection.tsx`.
- `frontend/components/ui/` nuevos (solo si no calza reuse): `BalanceChart` (evolución saldo), `MonthlyExpensesChart` (barras gasto/mes),
  `MonthCompareChart` (MoM), `IncomeSourceDonut` (idealmente reuse de `CategoryDonut` con otros datos), `SavingsChart` (evolución ahorro).
- Tests: extends `finance.test.tsx`/`finance.test.ts`, `charts.test.tsx`, e2e `sections.spec.ts` (nuevos casos S5/S6).

### 3.3 Gráficos objetivo.md (9) → estado → plan
- ✅ Ya existen: ingresos vs gastos (`FlowChart` + monthly-flow), gastos por categoría (`CategoryDonut` + by-category expense),
  distribución de gastos (≈ mismo donut — propuesta aclara si cuenta separado), presupuestos (`BudgetBars`/`BudgetsList`).
- 🆕 S6 (todos FE-only, sin BE nuevo):
  1. **Evolución del saldo** — balance acumulado desde `monthly-flow` (`toFlowPoints().balance`), nuevo `AreaChart`.
  2. **Ingresos por fuente** — `by-category?type=income` + `CategoryDonut` existente (solo parametrizar hook).
  3. **Evolución del ahorro** — `income − expense` por mes desde `monthly-flow`, chart de línea/área.
  4. **Gastos mensuales** — columna `expense` de `monthly-flow`, `BarChart`.
  5. **Comparación entre meses** — mes actual vs anterior desde `monthly-flow` (barras pareadas + delta %).
  6. **Evolución del patrimonio** — ⛔ NO requerido (solo número `GET /net-worth`; hoy visible en dashboard home, S6 lo muestra también en finanzas si se desea).
- 🆕 **Selector de período** (semana/mes/trimestre/año/custom): FE-only, computa `from/to` para los agregados existentes
  (validadores `validate_stats_range` ya soportan rango opcional/obligatorio según endpoint).
- 🆕 **Indicadores + insights** (spec nuevo, FE-only sobre `monthly-flow` + `by-category`): tasa de ahorro, promedios,
  top categoría, variación MoM, mes mayor gasto/ahorro; plantillas de texto ES fijas estilo
  "Este mes gastaste N% más en X que el mes anterior" (análisis personal, nunca asesoramiento).

### 3.4 No tocar
- `containers/DashboardHome.tsx`, `dashboard/widgets/*`, `notifications/*`, `useNotifications`, `WidgetToggle` (Fase 2).
- `finance/ManualCapture.tsx`, `finance/TransactionsLedger.tsx`, `finance/TransferHistory.tsx`, `productivity/*` (Fase 1).
- `backend/src/routes/me.rs` (dashboard_layout), resto de `backend/src/routes/*` salvo los 4 handlers nuevos de §2.1.

## 4. Tablas / migraciones involucradas
- **0001** (`0001_init_auth_and_categories.sql`): enums `account_type`, `transaction_type`, `debt_status`, `asset_category`,
  `subscription_frequency`, `category_kind` (+ `categories` polimórfica por `kind`: finance/subscription/habit/goal/task).
- **0002** (`0002_finance.sql`): `accounts` (balance cacheado por trigger `apply_transaction_to_balance`; columnas card +
  `asset_id` FK), `transactions` (con `credit_card_account_id`, `transfer_group_id`; índices `idx_tx_user_*`), `budgets`
  (CHECK `period_end >= period_start`, thresholds con CHECK) + triggers `updated_at`.
- **0003** (`0003_savings_debts_subs_assets.sql`): `savings_goals` (UNIQUE user+name) + `savings_goal_movements` + trigger
  `update_savings_goal_saved`; `debts` + `debt_payments` + trigger `update_debt_pending` (INSERT y DELETE);
  `subscriptions`; `assets` (+ FK `accounts.asset_id`) + `asset_valuations` (UNIQUE asset+fecha) + trigger
  `sync_asset_current_value` (solo INSERT); triggers `updated_at` en las 4 tablas.
- **0008** (`0008_credit_cards.sql`): CHECKs `chk_card_*` (límite/días obligatorios solo en cards) + índices
  `idx_accounts_user_card`, `idx_tx_card_user_date` (statement aggregate).
- **Sin migraciones nuevas previstas** en S5/S6 (ni siquiera los listados opcionales de payments/valuations las requieren).

## 5. Límites con specs existentes
- `openspec/specs/frontend-dashboard`: vales visuales/accesibilidad/performance obligatorios para todo chart/widget nuevo
  (tokens, code-split, ES, reduced-motion, `output: export` + SPA fallback, bearer + 401 single-flight).
- `frontend-i18n`: diccionario único ES; cada form/chart/insight necesita claves nuevas.
- `finance-*` + `credit-card-summary`: contratos wire intactos (montos string, `deny_unknown_fields`, 401/404/422) —
  los mutadores nuevos tipan igual sin cambiar DTOs existentes.
- `task-management` / `calendar-events` / `goal-tracking`: solo lectura para insights (vistas tasks, `payment_due`,
  `progress` trigger-owned); sin cambios.
- `openspec/changes/p9-finanzas/specs/` está **vacío**: la propuesta crea los deltas sin editar `openspec/specs/*`.

## 6. Confirmadas vs supuestos (entradas para la propuesta)

### Confirmadas (encargo + objetivo.md afilado)
1. Alcance Fase 3 = S5 + S6 descritos en §1; F1/F2 congelados.
2. Solo COP, carga manual, selectores por nombre (montos vía `normalizeManualAmount`; nunca inputs UUID).
3. Presupuestos = aviso visual (barras/colores `ok|warn|over`); deudas = debo/aboné/falta con barra; tarjetas = cuenta con
   límite/disponible/corte/pago/alerta (`ok|warn|high`); patrimonio = número; reportes = solo pantalla por período.
4. S5 escribe sobre BE existente + 4 endpoints faltantes (§2.1); subs y tarjetas solo necesitan UI.
5. S6 = 5 gráficos FE-only + período + MoM/insights (spec nuevo, tono personal no-asesor); evolución patrimonio excluida.

### Supuestos a confirmar en propuesta
1. Allowlist de cada PATCH (nunca trigger-owned): budgets (amount/period/thresholds/notes/category), goals
   (name/desc/target/date/category/color), debts (name/creditor/dates/installment/rate/notes), assets
   (name/category/account/currency/acquired_on/notes); errores espejo (ajeno 404, validación 422, duplicado 409).
2. `DELETE payment/movement` = 204 con reversión por trigger ya existente (test dedicado); `PATCH` payment/movement no existe
   (corrección = DELETE + recreate, como transactions).
3. Se crean `GET /debts/{id}/payments` (historial abonos) y, solo si la UI lo pide, `GET /assets/{id}/valuations`;
   alternativa: historial payments vía join en FE desde `GET /debts` (no — hoy no expone payments; BE list es lo limpio).
4. Cambio de `credit_limit`/días de tarjeta: ¿PATCH card nuevo o DELETE + recreate? (recomendación explore: PATCH card
   acotado a `credit_limit/statement_day/payment_due_day` con revalidación `validate_card_fields`, pues recrear rompería
   historial `credit_card_account_id`).
5. Período default = mes actual; semana = últimos 7 días; custom = dos date inputs (`YYYY-MM-DD`); gráficos agregan en FE
   lo que el rango devuelva (sin nuevas queries por bucket).
6. Insights = lista cerrada de plantillas ES con valores computados (tasa, promedios, top categoría, deltas MoM, extremos);
   sin LLM/generación libre; "gastos recurrentes/extraordinarios" se define en propuesta (p.ej. heurística simple sobre
   `description`/frecuencia o se recorta del v1).
7. Patrimonio-número en finanzas reuse `useNetWorth` (moneda de `GET /me`, fallback primera currency); sin widget nuevo
   en home (Fase 2 congelada).
8. Deltas de spec a crear en `p9-finanzas/specs/`: `finance-budgets-write`, `finance-savings-write`, `finance-debts-write`,
   `finance-subscriptions-ui`, `credit-cards-ui`, `finance-assets-ui`, `finance-charts`, `finance-analysis` (+ `reports-screen`
   solo si "reportes solo pantalla" excede a AnalysisSection).

## 7. Riesgos / bordes
- Cap sqlx 16 columnas en `AccountRow`: métricas card se computan en Rust — no agregar columnas al row (el statement va en
  2ª query solo en detail, como hoy).
- `deny_unknown_fields`: cada PATCH DTO nuevo debe listar exactamente su allowlist o el FE recibe 422 inesperados.
- `chk_card_*` CHECKs + `budget_period_valid` + thresholds: validar en API antes de INSERT/UPDATE para devolver 422 con
  mensaje (nunca 500); mapear `23505→409`, `23514/23503→422` como los módulos vecinos.
- `transactions` excluye `transfer` de todos los agregados (predicados existentes) — los charts S6 lo heredan gratis.
- `output: export`: charts/popovers S6 sin SSR (`dynamic`, sin `window` en import); E2E debe cubrir formularios S5 con
  montos string y fechas `YYYY-MM-DD`.

## 8. Testabilidad
- BE: `cargo test` con el patrón de cada módulo (validadores puros, asserts de SQL, tests DB con `DATABASE_URL`).
  Casos mínimos por endpoint nuevo: 201/200/204 feliz, 401 sin sesión, 404 ajeno, 422 validación, trigger-owns intacto
  (p.ej. PATCH que intente `pending_amount` → 422 por `deny_unknown_fields`), reversión en DELETE payment.
- FE: tests puros de transforms (progress, MoM, insights, rangos de período) + tests de componentes con SWR mockeado
  (patrón `finance.test.tsx`/`s1-capture.test.tsx`) + e2e de secciones.
