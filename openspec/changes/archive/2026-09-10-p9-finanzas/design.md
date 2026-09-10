# Design — p9-finanzas (Fase 3: S5 escritura + S6 gráficos/análisis)

- change: `p9-finanzas`
- project: personal-dashboard
- date: 2026-09-09
- inputs: `proposal.md` + `exploration.md` + `preproposal.md` (decisiones dueño vinculantes)
- store: openspec (`openspec/changes/p9-finanzas/design.md`)
- strategy: ask-on-risk · budget 400 · TDD estricto (`cargo test` + `vitest`)

## 0. Resumen de la decisión de diseño

Completar finanzas sin migraciones, sin tocar Fase 1 (captura/ledger/transferencias/productividad)
ni Fase 2 (home/widgets/notifications). BE mínimo y aditivo: 7 handlers delgados que replican
convenciones existentes (`require_user_id`, ajeno→404, dinero-string, `deny_unknown_fields`,
`updated_at=now()`, mapeo `23505→409` / `23514,23503→422`). FE grueso pero compositivo:
forms por dominio en `components/finance/*` con mutadores SWR + selects por nombre (cero UUIDs
visibles), 4 charts Recharts FE-only + 1 reuse, `PeriodSelector` + `AnalysisSection` FE-only,
view-models puros en `lib/finance/finance.ts`, i18n 100% ES en `lib/i18n/es.ts`.
Rollback = revert de commits (BE aditivo) + ocultar `SectionShell` nuevas (FE compositivo).
Riesgo real = FE (9 formularios + 4 charts); se mitiga con TDD estricto, reuse máximo y
fallback verificador + Juicio ya previstos.

Decisiones dueño ya cerradas (no se reabren): `budget-edit→PATCH`, `payment-edit→corregible
vía DELETE+recreate`, `default-period→mes actual`, `insights-tone→directo`.

## 1. Arquitectura y data-flow

```
BE (axum + sqlx + Postgres, sin migraciones)
  routes/budgets.rs ── PATCH /budgets/{id} · DELETE /budgets/{id}
  routes/savings.rs ── PATCH /savings-goals/{id}
  routes/debts.rs   ── PATCH /debts/{id} · GET /debts/{id}/payments · DELETE /debts/{id}/payments/{pid}
  routes/assets.rs  ── PATCH /assets/{id}
  main.rs::api_routes ── wiring de las 7 rutas (único toque fuera de routes/*.rs)
  triggers existentes intactos: update_savings_goal_saved / update_debt_pending / sync_asset_current_value

FE (/dashboard/finance, `output: export`, solo COP, solo ES)
  FinanceScreens.tsx (container: SWR reads paralelos + coerción en borde + mutate)
    ├─ S5 forms (SectionShell nuevas): BudgetForm · SavingsForms · DebtPayments ·
    │   SubscriptionForms · CardForm/CardDetail · AssetForms
    └─ S6 análisis (SectionShell nuevas): PeriodSelector → from/to ─┐
        ├─ useMonthlyFlow(from,to) → 4 charts nuevos (Area/Line/Bar) │
        ├─ useSpendByCategory(from,to,type) → CategoryDonut reuse   │ (FE-only)
        ├─ useBudgets (status) → BudgetBars existente               │
        ├─ useNetWorth → patrimonio-número                          │
        └─ AnalysisSection(toMonthOverMonth + toInsights plantillas)┘
  lib/finance/finance.ts = ÚNICO lugar de coerción string→number + view-models puros
  lib/api/finance.ts + dashboard.ts = fetchers/mutadores (nunca parsean montos)
  lib/i18n/es.ts = todas las strings (prohibido hardcodear)
```

Flujo de escritura tipo: form valida en ES (monto vía `normalizeManualAmount` → string wire,
fechas `YYYY-MM-DD`, selects por nombre) → mutador `apiPost/apiPatch/apiDelete` → `mutate`
SWR claves `finance/*` + `dashboard/*` afectadas → revalidación optimista solo donde haya
hook dedicado (patrón `useUpdateLayout`: `optimisticData` + `rollbackOnError`), resto
revalidación simple. Error wire → `ApiError.status` → mensaje ES (`finance.saveFailed`,
`finance.deleteFailed`, 409 duplicado, 422 validación).

Flujo de lectura S6: `PeriodSelector` (estado local, default mes actual) computa `{from,to}`
→ keys SWR `dashboard/monthly-flow?from&to` + `dashboard/by-category?from&to&type=` cambian →
fetch agregados existentes → transforms puros agregan en FE (balance acumulado, ahorro
`income−expense`, MoM, insights) → charts + `AnalysisSection`. Sin BE nuevo, sin queries
por bucket.

## 2. BE — 7 endpoints (archivos, allowlists, SQL, errores)

Convenciones replicadas en los 7 (no negociables):
- `require_user_id(&headers, &state.pool).await?` primero; sin sesión → 401 (vía `AppError`).
- Ajena o inexistente-operable → **404** (nunca 403, nunca oráculo). Excepción heredada:
  payment/movement/valuation sobre id que no existe para nadie → **422** (guard FK huérfano,
  contratos `ensure_debt_writable` / `ensure_goal_writable` / `ensure_asset_writable`).
- Dinero siempre string wire (`parse_money_amount` `>0`, `parse_money_amount_nonneg`,
  `parse_signed_amount`); thresholds `f64` ratios; fechas estrictas `YYYY-MM-DD`.
- DTOs con `#[serde(deny_unknown_fields)]`; campo trigger-owned intentado → 422 por
  deserialización (axum lo expone como 422). Cada PATCH hace `UPDATE ... SET updated_at=now()`.
- Mapeo DB: `23505→409` (duplicado), `23514/23503/22P02→422`, resto → 500 interno sin filtrar.
- Tests por handler: validadores puros + asserts fragmentos SQL + DB con `db_state`/
  `cleanup_user` tras `DATABASE_URL` (patrón copiado de cada módulo).

### 2.1 `PATCH /budgets/{id}` — `backend/src/routes/budgets.rs`

- DTO `PatchBudgetRequest` (`deny_unknown_fields`), allowlist exacta:
  `category_id?: Uuid, amount?: String, period_start?: String, period_end?: String,`
  `warn_threshold?: f64, over_threshold?: f64, notes?: Option<String>`.
  Nunca `currency/spent/status` (derivados). Vacío → 422 `no updatable fields provided`.
- Validación: `parse_money_amount` si hay `amount`; `validate_occurred_on` + coppia
  `validate_budget_period(start,end)` (lee fila actual para el extremo no enviado);
  `validate_thresholds(warn,over)` (idem, lee actuales si parcial); `ensure_finance_category`
  si hay `category_id`; `validate_optional_notes`.
- SQL: `UPDATE budgets SET <set dinámico QueryBuilder o COALESCE por campo>,
  updated_at=now() WHERE id=$N AND user_id=$N+1 RETURNING <mismo column-list que GET>`.
  Prohíbo `UPDATE` estático con todos los campos (sobreescribiría con NULL). Patrón a copiar:
  `accounts.rs::patch_account_handler` (QueryBuilder `SET updated_at=now()` + pushes
  condicionales) o `subscriptions.rs::PATCH_SUB_SQL` si se fija un solo campo (no es el caso).
- Respuesta 200 `BudgetResponse` (montos string). Errores: 401 · 404 ajeno/inexistente ·
  422 validación/categoría/trigger-owned (`spent`, `status`, `currency` → 422 por deny).
- Tests: parcial (solo `notes`) preserva resto; `amount:"0.00"`→422; período invertido→422;
  `warn>over`→422; categoría habit-kind→422; categoría ajena→422; `{"spent":"10.00"}`→422;
  ajeno→404; SQL contiene `id=$` + `user_id` + `updated_at = now()`.

### 2.2 `DELETE /budgets/{id}` — `backend/src/routes/budgets.rs`

- `DELETE_BUDGET_SQL = "DELETE FROM budgets WHERE id=$1 AND user_id=$2"`; 204 si
  `rows_affected==1`, 404 si 0. Sin cuerpo. Sin trigger asociado.
- Tests: 204 propio + 404 ajeno + 404 doble-delete; 401 sin sesión.

### 2.3 `PATCH /savings-goals/{id}` — `backend/src/routes/savings.rs`

- DTO `PatchGoalRequest` (`deny_unknown_fields`), allowlist exacta:
  `name?: String, description?: Option<String>, target_amount?: String, target_date?: Option<String>,`
  `category_id?: Option<Uuid>, color?: Option<String>`.
  Nunca `saved_amount/is_completed/completed_at` → 422 por deny (test dedicado por campo).
- Validación: reuse `validate_goal_name`, `parse_money_amount`, `validate_target_date`,
  `validate_optional_text(description,2000)`, `validate_optional_text(color,32)`,
  `ensure_finance_category` si `category_id=Some` (None = desvincular, permitido).
- SQL: QueryBuilder idéntico patrón §2.1 sobre `savings_goals`, `WHERE id AND user_id`,
  `RETURNING <GoalRow columns>`. `updated_at=now()` siempre.
- Errores: 401 · 404 ajeno (`ensure_goal_writable` distingue: ajeno→404, inexistente→422 —
  PATCH primero resuelve ownership con el mismo helper; inexistente puro → 422 para no
  romper el contrato de movimientos) · 409 nombre duplicado (`23505→409` vía `map_goal_db_err`
  reutilizado) · 422 validación/over-withdrawal n/a aquí (solo en movements) / trigger-owned.
- Tests: rename a nombre existente del mismo user→409; `target_amount:"0"`→422;
  `{"saved_amount":"5.00"}`→422; parcial preserva `saved_amount` trigger (releer y comparar).

### 2.4 `PATCH /debts/{id}` — `backend/src/routes/debts.rs`

- DTO `PatchDebtRequest` (`deny_unknown_fields`), allowlist exacta:
  `name?: String, creditor?: String, due_date?: Option<String>, installment?: Option<String>,`
  `interest_rate?: Option<String>, notes?: Option<String>`.
  Nunca `original_amount?` — decisión: **original NO editable** (cambiaría la base de
  `aboné = original−pending`; corrección = borrar + recrear deuda). Nunca
  `pending_amount/status` → 422 por deny.
  Nota: proposal lista `name, creditor_name, due_date, installment_amount, interest_rate, notes`;
  el mapeo wire real es `name, creditor, due_date, installment, interest_rate, notes`
  (nombres de columna/DTO existentes — spec debe fijar estos, no los alias).
- Validación: reuse `validate_required_text`, `validate_optional_date(due_date)`,
  `validate_optional_installment`, `validate_optional_interest_rate`,
  `validate_optional_text(notes)`. Guard active-only: si `status != 'active'` → 422
  (no se edita metadata de deuda saldada; copiar mensaje `payments are only allowed on
  active debts` o `debt is not editable when paid_off` — spec fija el string).
- SQL QueryBuilder sobre `debts`, `WHERE id AND user_id`, `RETURNING <DebtRow>`,
  `updated_at=now()`. `map_debt_db_err` reutilizado (`23514→422`).
- Errores: 401 · 404 ajeno · 422 validación/paid_off/trigger-owned.
- Tests: PATCH `creditor` en deuda con payments preserva `pending_amount`;
  PATCH en `paid_off`→422; `{"pending_amount":"1.00"}`→422; `{"original_amount":"9.00"}`→422.

### 2.5 `GET /debts/{id}/payments` — `backend/src/routes/debts.rs`

- Solo lectura para historial UI. `ensure_debt_writable` primero (ajeno→404,
  inexistente→422 — mismo contrato que payments), luego:
  `SELECT id, debt_id, amount, paid_on, payment_method, transaction_id, notes, created_at
   FROM debt_payments WHERE debt_id=$1 AND user_id=$2 ORDER BY paid_on ASC, created_at ASC`.
- Respuesta 200 `Vec<PaymentResponse>` (montos string). Guard active-only NO aplica
  (historial de saldada también se lee). 401 · 404/422 por ownership.
- Tests: tras 2 payments lista 2 ordenados; ajeno→404; inexistente→422; vacía→`[]`.

### 2.6 `DELETE /debts/{id}/payments/{pid}` — `backend/src/routes/debts.rs`

- `DELETE_PAYMENT_SQL = "DELETE FROM debt_payments WHERE id=$1 AND debt_id=$2 AND user_id=$3"`.
  Pre-guards: `ensure_debt_writable` + `ensure_transaction_owned` n/a (delete no lleva body);
  guard active-only: si deuda `paid_off` y el delete la reabriría, **permitido** (es la
  corrección UX "eliminar+recrear": el trigger `update_debt_pending` ya tiene rama DELETE
  que suma de vuelta y recalcula `status`; prohibirlo rompería la corrección pactada).
  Corrección UX = este DELETE + `POST /debts/{id}/payments` nuevo, con confirmación en FE.
- 204 si `rows_affected==1`, 404 si 0 (pid ajeno o de otra deuda). Trigger revierte
  `pending_amount/status` — **test de reversión dedicado obligatorio**:
  `pending 500 → pay 100 (pending 400) → DELETE payment (pending 500, status active)`.
  Más: payoff total → DELETE último payment → `status` vuelve a `active`.
- Sin `PATCH payment` por diseño (montos inmutables como transactions; §Non-goals).
- Tests: reversión numérica exacta + reapertura de status + 404 cruzado (pid de deuda A
  borrado vía deuda B) + 401.

### 2.7 `PATCH /assets/{id}` — `backend/src/routes/assets.rs`

- DTO `PatchAssetRequest` (`deny_unknown_fields`), allowlist exacta:
  `name?: String, category?: String, account_id?: Option<Uuid>, currency?: String,`
  `acquired_on?: Option<String>, notes?: Option<String>`.
  Nunca `current_value/is_archived` → 422 por deny (tests dedicados).
- Validación: reuse `validate_required_text(name)`, `validate_category`,
  `ensure_account_owned` si `account_id=Some` (None = desvincular), `validate_currency`,
  `validate_optional_date(acquired_on)`, `validate_optional_text(notes)`. Guard
  archivado: `ensure_asset_writable` (archivado→404, inexistente→422).
- SQL QueryBuilder sobre `assets` con cast `$::asset_category` para category,
  `WHERE id AND user_id AND NOT is_archived`, `RETURNING <AssetRow>`, `updated_at=now()`.
  `map_asset_db_err` reutilizado (`23503/23514/22P02→422`).
- Valuaciones siguen INSERT-only (`recorded_on > max` + 409 duplicada); corrección =
  archive + recreate (§Non-goals). Sin `GET /assets/{id}/valuations` (innecesario).
- Tests: rename + cambio `account_id` a cuenta propia OK; cuenta ajena→422;
  `{"current_value":"1.00"}`→422; `{"is_archived":true}`→422; archivado→404.

### 2.8 Wiring — `backend/src/main.rs::api_routes`

- `.route("/budgets/{id}", get(get_budget_handler).patch(patch_budget_handler).delete(delete_budget_handler))`
- `.route("/savings-goals/{id}", get(...).patch(patch_goal_handler).delete(...))` (nombre final
  `patch_goal_handler`, no `update_*`, por convención `patch_account_handler`).
- `.route("/debts/{id}", get(...).patch(patch_debt_handler).delete(...))`
- `.route("/debts/{id}/payments", post(create_payment_handler).get(list_payments_handler))`
- `.route("/debts/{id}/payments/{pid}", delete(delete_payment_handler))`
  (path param tupla `(Uuid,Uuid)`; reutiliza `DELETE_MOVEMENT_SQL` como plantilla del orden
  `id=$1 AND savings_goal_id=$2 AND user_id=$3` → `id=$1 AND debt_id=$2 AND user_id=$3`).
- `.route("/assets/{id}", get(...).patch(patch_asset_handler).delete(...))`
- No tocar `accounts.rs`, `subscriptions.rs`, `transactions.rs`, `me.rs` ni resto de routes.
- Smoke existente `main.rs` tests de rutas (`/api/budgets`, `/budgets`) debe seguir verde.

## 3. FE — escritura S5 (forms por dominio, mutadores, selects por nombre)

### 3.1 Capas y reglas inviolables

- `lib/api/finance.ts`: solo fetchers/mutadores tipados + SWR hooks. Nunca parsea montos,
  nunca formatea. Claves SWR nuevas con prefijo `finance/` (heredan retry del container).
  Reutiliza `apiGet/apiPost/apiPatch/apiDelete` (Bearer + single-flight 401 ya resueltos).
- `lib/finance/finance.ts`: ÚNICO lugar de coerción (`toNumber`) + view-models puros +
  `normalizeManualAmount`. Componentes reciben numbers, nunca strings wire.
- `components/finance/*`: presentacionales + forms controlados; selects por nombre vía
  `toAccountOptions/toCategoryOptions` (orden `es`, nunca inputs UUID); fechas `<input
  type="date">` (`YYYY-MM-DD`); montos `<input inputMode="decimal">` validados con
  `normalizeManualAmount` → error inline ES si null.
- `FinanceScreens.tsx`: monta las nuevas `SectionShell` DESPUÉS de las tres F1 intactas
  (`ManualCaptureSection`, `TransactionsLedger`, `TransferHistory` — prohibido tocarlas,
  prohibido cambiar sus keys/queries). Cada sección nueva es ocultable por revert
  (ver §8) sin afectar al resto.
- `lib/i18n/es.ts`: toda string nueva bajo `finance.*` (+ `charts.*`, `analysis.*`);
  cero literales en JSX (lint por revisión + test i18n existente extendido).

### 3.2 Mutadores y wires (`lib/api/finance.ts`, + 1 toque en `dashboard.ts`)

```ts
// budgets
createBudget(input: {category_id, amount: string, period_start, period_end, warn_threshold?, over_threshold?, notes?})
patchBudget(id, body: Partial<allowlist §2.1>)   // apiPatch(`/budgets/${id}`)
deleteBudget(id)                                 // apiDelete → 204 void
// savings (wires existentes se amplían: installment? no — goals llevan saved/target/target_date)
patchGoal(id, body: Partial<allowlist §2.3>)
createMovement(goal_id, {amount: string signed, occurred_on, notes?}) // existe → wrapper
deleteMovement(goal_id, mid)                                          // existe → wrapper
// debts (DebtWire se amplía: installment, start_date)
patchDebt(id, body: Partial<allowlist §2.4>)
createPayment(debt_id, {amount: string, paid_on, payment_method?, notes?}) // existe POST
deletePayment(debt_id, pid)                                             // NUEVO apiDelete
fetchDebtPayments(debt_id) + useDebtPayments(debt_id)                   // NUEVO GET §2.5, key finance/debt-payments/{id}
// subs (BE completo: POST+GET+PATCH is_active+DELETE existentes) — solo wrappers:
createSubscription({name, price: string, currency?, frequency, next_billing_on?, category_id?, payment_method?, url?, notes?})
setSubscriptionActive(id, is_active: boolean)  // PATCH existente
deleteSubscription(id)
// assets
patchAsset(id, body: Partial<allowlist §2.7>)
createValuation(asset_id, {value: string, recorded_on, notes?}) // POST existente
// cards (accounts type=credit_card, BE completo salvo PATCH límite — fuera de alcance)
createCard({name, currency?, credit_limit: string, statement_day: number, payment_due_day: number, notes?})
// dashboard.ts — ÚNICO cambio: parametrizar type
useSpendByCategory(from, to, type: "income"|"expense" = "expense")  // key incluye type
```

Invalidación SWR por mutación (llamar `mutate` del `useSWRConfig` en cada form tras éxito):
budget→`finance/` no — preciso: `dashboard/budgets`; goal→`finance/savings-goals` +
`dashboard/savings-goals`; payment→`finance/debts` + `finance/debt-payments/{id}`;
sub→`finance/subscriptions` + `dashboard/subscriptions`; asset→`dashboard/accounts`? no —
assets no tienen key dashboard; `finance/` n/a: assets se leen vía `apiGet("/assets")`
nuevo fetcher `useAssets()` key `finance/assets` + `dashboard/net-worth`; card→
`dashboard/accounts` + `dashboard/net-worth`; valuation→`finance/assets` + `dashboard/net-worth`.
Presupuestos nunca bloquean: tras create/PATCH el status se relee (sigue `ok|warn|over` solo aviso).

### 3.3 Forms por dominio (`components/finance/*`, nombres finales)

Todos: estado controlado, `disabled` mientras `isMutating`, error inline ES, confirmación
nativa (`confirm()` con string i18n) solo en destructivos, foco al primer campo inválido,
`aria-label`/`role=alert` en errores, montos COP a mano.

- `BudgetForm.tsx` — crear + editar (mismo componente, `budget?` opcional). Campos: categoría
  (select por nombre, requerido), monto (string manual), `period_start/end` (date),
  thresholds (number 0–2, defaults 0.8/1.0), notes. Editar = `patchBudget` (§2.1, decisión
  dueño). Borrar = botón separado con confirmación → `deleteBudget`. Props:
  `{categories: NamedOption[], budget?: BudgetWireLike, onDone: () => void}`.
- `SavingsForms.tsx` — `SavingsDepositForm` (abonar/retirar: un monto firmado; positivo =
  POST `amount`, negativo = POST `-amount`; valida over-withdrawal en cliente comparando
  contra `saved` para mensaje rápido, el 422 BE manda), `SavingsGoalForm` (crear + editar
  meta vía `patchGoal`: name/desc/target/date/category/color), eliminar meta con
  confirmación. Props reciben `SavingsView` (numbers ya coercionados).
- `DebtPayments.tsx` — `DebtPayForm` (abono: monto + `paid_on` + método + notes →
  `createPayment`; valida `amount<=pending` en cliente) + `DebtPaymentHistory` (lista de
  `useDebtPayments`: monto/fecha/método + botón corregir por fila = `deletePayment` +
  prefill del form con confirmación "eliminar y recrear") + barra debo/aboné/falta
  (`toDebtProgress`, `ProgressBar` reuse) + `DebtEditForm` (metadata §2.4, nunca montos).
- `SubscriptionForms.tsx` — `SubscriptionCreateForm` (name, price manual, currency default
  COP, frequency select `weekly|monthly|quarterly|yearly` — valores enum reales del BE,
  `next_billing_on` date, category select, payment_method select reuse de capture,
  url/notes) + por fila: cancelar/reactivar (`setSubscriptionActive`, PATCH `is_active`
  existente) + borrar con confirmación. `PATCH` jamás envía otro campo (`deny_unknown_fields`).
- `CardForm.tsx` + `CardDetail.tsx` — crear exige `credit_limit` + ambos cycle days
  (validación cliente espejo de `validate_card_fields`; sin ellos el BE 422). Detalle reuse
  `AccountsList` + bloque extra: límite/disponible/corte/pago/alerta (`used/available/
  usage_pct/alert ok|warn|high` ya vienen del BE; FE solo formatea). Cambio de límite =
  DELETE + recreate (§Non-goals, mensaje ES que lo explica).
- `AssetForms.tsx` — `AssetEditForm` (`patchAsset` §2.7: name/category/account/currency/
  acquired_on/notes) + `AssetValuationForm` (POST valuation existente: value + recorded_on;
  valida `recorded_on > última conocida` en cliente, 422/409 BE mandan). Sin historial
  global (evolución patrimonio excluida); archive = DELETE existente con confirmación.

Ampliar wires: `useDebts` añade `installment?, start_date?`; `useSavingsGoals` añade
`saved/target` ya parcial — completar `target_date?, category_id?, color?`;
`useSubscriptions` añade `frequency, payment_method, next_billing_on, category_id?`.
Tipos wire mantienen `string|number` en montos (compat), coerción solo en transforms.

### 3.4 View-models puros (`lib/finance/finance.ts` + tests)

Existentes intactos: `toLedgerRows, ledgerKey, toBudgetViews, toAccountCards,
toSubscriptionRows, toDebtRows, toSavingsViews, toTransferRows, transferKey,
toAccountOptions, toCategoryOptions, normalizeManualAmount, toNumber` (no cambiar firmas).

Nuevos (puros, sin fetch, sin JSX, testeados en `finance.test.ts`):

```ts
toDebtProgress(d: {original: number; pending: number}): {paid, remaining, pct /*[0,1]*/, status: "ok"|"warn"|"paid"}
  // paid = original−pending; pct = paid/original; status paid si pending<=0, warn si pct>=0.7? — spec fija umbrales
toPeriodRange(sel: PeriodSel, now: Date): {from: string; to: string}  // YYYY-MM-DD
  // week = últimos 7 días; month = mes actual (default); quarter = trimestre natural; year = año natural; custom = validar from<=to
toMonthOverMonth(cur: number, prev: number): {delta: number; pct: number|null}  // pct null si prev==0
toSavingsSeries(flow: {month,income,expense}[]): {month, savings}[]
toBalanceSeries(flow: ...): {month, balance}[]   // balance acumulado en orden cronológico
toMonthCompare(flow: ...): {cur, prev, deltaPct} | null  // últimos 2 meses con datos
toInsights(input: {flow, byCatExpense, byCatIncome, budgets}): Insight[]  // plantillas ES §5, máx 6, ordenadas
```

Reglas: `toNumber` acepta `string|number|null` (coma decimal `,` → `.`? NO — montos manuales
usan `normalizeManualAmount`; `toNumber` solo wire con `.`); `pct` siempre clamp `[0,1]`;
fechas solo `YYYY-MM-DD`; nunca `window/localStorage` aquí (testeable en node).

## 4. FE — S6 (4 charts nuevos + 1 reuse + período + análisis + patrimonio)

### 4.1 Charts (`components/ui/*`, Recharts 3, `next/dynamic(ssr:false)`)

Patrón copiado de `FlowChart.tsx`: `accessibilityLayer`, tokens vía `chartToken(prop) ||
var(prop)` (cero hex), `CartesianGrid --color-hull`, ticks `--color-instrument` 12px,
`Tooltip` con `formatMoney`, `isAnimationActive={animate}` + `prefers-reduced-motion`
(apagar animación), foco teclado (wrappers focusables donde Recharts lo permita),
`EmptyState` con strings i18n cuando `data.length===0`, `margin {8,8,0,0}`, ancho 560/alto
260 con `overflow-x-auto` (igual que FlowChart; responsive-container solo si el test
e2e lo pide — no introducir dependencias nuevas).

- `BalanceChart.tsx` — `AreaChart` evolución del saldo: `data = toBalanceSeries(monthly-flow)`.
  Props `{data: {month,balance}[], animate?}`. Labels ES.
- `SavingsChart.tsx` — `AreaChart` (o Line) evolución del ahorro: `toSavingsSeries`.
  `income−expense` por mes. Puede renderizar negativo (eje incluye 0).
- `MonthlyExpensesChart.tsx` — `BarChart` gastos mensuales: columna `expense` de monthly-flow.
- `MonthCompareChart.tsx` — `BarChart` pareado mes actual vs anterior + delta % en subtítulo
  (`toMonthCompare`; si `<2` meses → `EmptyState`).
- Reuse: ingresos-por-fuente = `CategoryDonut` existente + `useSpendByCategory(from,to,"income")`
  (cero componentes nuevos; si `CategoryDonut` no calza con otros datos, crear
  `IncomeSourceDonut` como thin-wrapper — decisión en spec, default reuse).
- Intactos: `FlowChart`, `CategoryDonut` (expense), `BudgetBars/BudgetsList`.
- Nota `transfers`: agregados excluyen `type='transfer'` en BE — los charts lo heredan gratis,
  prohibido "corregirlo" en FE.

Carga: cada chart `next/dynamic(() => import(...), {ssr:false})` en `FinanceScreens`
(hereda `frontend-dashboard/spec.md`: code-split obligatorio por `output: export`; sin
`window` en imports).

### 4.2 `PeriodSelector.tsx` (`components/finance/`)

```ts
type PeriodSel = {kind: "week"|"month"|"quarter"|"year"|"custom"; from?: string; to?: string}
```
UI: 5 radio-pills + 2 date inputs (solo visibles en custom). Default `{kind:"month"}`
(decisión dueño). `toPeriodRange(sel, new Date())` → `{from,to}` → alimenta
`useMonthlyFlow(from,to)` + ambos `useSpendByCategory`. Semana = últimos 7 días
(`to=hoy, from=hoy−6`); trimestre/año = naturales; custom valida `from<=to` + formato,
error inline ES. Los charts agregan en FE lo devuelto (sin nuevas queries por bucket;
`validate_stats_range` ya soporta el rango). Test: rangos deterministas con `now` inyectado.

### 4.3 `AnalysisSection.tsx` + insights (`components/finance/`)

Computa en FE desde `monthly-flow` + `by-category` (ambos tipos) + `budgets`:
tasa de ahorro (`savings/income` mes actual), promedios (gasto/ingreso medio del período),
top categoría (mayor `total`), variación MoM por categoría top (`toMonthOverMonth`),
mes mayor gasto/ahorro. Render: lista de `MetricCard`-like + frases.

Plantillas ES fijas, tono directo (decisión dueño), lista cerrada (sin LLM, sin generación
libre), máx 6, con valores interpolados:

- `"Este mes gastaste {pct}% más en {cat} que el mes anterior ({cur} frente a {prev})."`
- `"Tu tasa de ahorro del mes es {n}% ({saved} de {income})."`
- `"Tu mayor gasto fue en {mes}: {amount}."`
- `"Tu mayor ahorro fue en {mes}: {amount}."`
- `"Promedias {amount} de gasto al mes en este período."`
- `"Llevas {n}% de {label} gastado ({spent} de {amount})."` (por presupuesto, solo top-1 over/warn)
- Heurística recurrente/extraordinario v1: frecuencia de `description` en ledger del período
  (≥3 apariciones = "recurrente"); si no concluye, la línea se omite (nunca se inventa).
- Disclaimer fijo siempre visible: `"Análisis personal, no asesoramiento financiero."`
  (clave `analysis.disclaimer`).

### 4.4 Patrimonio

Número simple vía `useNetWorth` existente en pantalla finanzas (sección `SectionShell`
"Patrimonio", moneda de `GET /me` con fallback primera currency). Sin widget nuevo en
home (Fase 2 congelada), sin gráfico de evolución (excluido).

## 5. i18n ES (`frontend/lib/i18n/es.ts`)

Nuevas claves (todas bajo diccionario único, `t(key, vars)`):

- `finance.*`: `editBudget/saveBudget/deleteBudget/confirmDeleteBudget`,
  `deposit/withdraw/editGoal/deleteGoal/confirmDeleteGoal`,
  `payDebt/correctPayment/confirmDeletePayment/paymentHistory/paidOf/remaining/debtProgress`,
  `createSub/cancelSub/reactivateSub/confirmDeleteSub`,
  `createCard/cardLimit/statementDay/paymentDueDay/limitChangeHint`,
  `editAsset/newValuation/confirmArchiveAsset`,
  `save/saving/create/update/cancel/edit/delete/requiredError/amountPositiveError/saveFailed/deleteFailed`
  (reusar las de `productivity.*` donde existan — no duplicar: importar vía mismo `t`).
- `charts.*`: títulos+hints+empty de los 4 nuevos + `period{Week,Month,Quarter,Year,Custom,From,To,InvalidRange}`.
- `analysis.*`: `title/hint/disclaimer` + 7 plantillas + `savingsRate/avgExpense/topCategory/momDelta/bestMonth/worstMonth`.
- Prohibido hardcodear: ningún literal ES/EN en JSX nuevo (cubierto por test i18n extendido:
  render de cada form/chart con `es` y assert de ausencia de strings fuera de `t`).

## 6. Contratos wire (congelados + nuevos)

Congelados (no cambiar): montos string, `deny_unknown_fields`, 401/404/422/409 mapping,
`GET /net-worth`, `by-category?from&to&type=`, `monthly-flow?from&to`, `GET /budgets`
(collection-with-status), `PATCH /subscriptions/{id} {is_active}`, card detail con
`used/available/usage_pct/alert`.

Nuevos (7, §2): request/response JSON con montos string, `updated_at` refrescado en cada
PATCH, `GET payments` ordenado ascendente, DELETEs 204 sin cuerpo. Errores con
`{code,message}` vía `toApiError` (test FE assert por `status`, no por mensaje BE).

## 7. Cambios de archivos (lista cerrada)

BE (7 handlers + wiring, 0 migraciones):
`backend/src/routes/budgets.rs` (+PATCH+DELETE), `savings.rs` (+PATCH),
`debts.rs` (+PATCH+GET payments+DELETE payment), `assets.rs` (+PATCH),
`backend/src/main.rs` (wiring §2.8).

FE tocar: `components/containers/FinanceScreens.tsx` (montar 9–10 SectionShell nuevas +
hooks `useMonthlyFlow/useSpendByCategory(type)/useNetWorth/useAssets/useDebtPayments`),
`lib/api/finance.ts` (mutadores §3.2 + wires ampliados), `lib/api/dashboard.ts` (1 línea:
param `type`), `lib/finance/finance.ts` (6 puros §3.4), `components/finance/FinanceSections.tsx`
(solo reuse `SectionShell/ProgressBar/LedDot/EmptyState` — no cambiarlos),
`components/ui/*` (reuse charts), `lib/i18n/es.ts` (+~60 claves).

FE crear: `components/finance/{BudgetForm,SavingsForms,DebtPayments,SubscriptionForms,
CardForm,CardDetail,AssetForms,PeriodSelector,AnalysisSection}.tsx`,
`components/ui/{BalanceChart,SavingsChart,MonthlyExpensesChart,MonthCompareChart}.tsx`
(`IncomeSourceDonut` solo si reuse falla).

Tests: `backend` unitarios+DB por módulo; `frontend/lib/finance/finance.test.ts` (puros),
`components/finance/finance.test.tsx` (forms con SWR mockeado), `components/ui/charts.test.tsx`
(4 charts + EmptyState + reduced-motion), `e2e sections.spec.ts` (S5/S6), test i18n extendido.

Specs delta (fase spec, sin editar `openspec/specs/*`): `finance-budgets-write`,
`finance-savings-write`, `finance-debts-write`, `finance-subscriptions-ui`, `credit-cards-ui`,
`finance-assets-ui`, `finance-charts`, `finance-analysis` (+ `reports-screen` solo si excede).

## 8. Rollback y rollout

- Sin migraciones → rollback BE = revert de commits por archivo
  (`budgets/savings/debts/assets.rs` + `main.rs`); triggers intactos (DELETE payment sin
  handler simplemente no se expone; ningún dato queda huérfano porque DELETEs S5 son
  físicos salvo assets que archivan por diseño previo).
- Rollback FE = ocultar secciones: cada `SectionShell` S5/S6 vive tras un flag local
  (`const SHOW_S5 = true` por sección o revert de `finance/*` + `PeriodSelector`/
  `AnalysisSection`); F1/F2 nunca se ven afectadas porque sus componentes/keys no se tocan.
- Rollout: BE primero (7 endpoints + `cargo test`), luego FE forms (S5), luego charts+análisis
  (S6); cada capa mergeable y revertible por separado. Criterio ask-on-risk: si cualquier
  riesgo §9.1–9.4 se materializa, parar y preguntar antes de tocar allowlists/triggers/CHECKs.
- Fallback previsto: si FE desborda el budget, verificador recorta a (forms mínimos sin
  CardDetail extra + 2 charts + AnalysisSection sin heurística recurrente) y Juicio decide
  el recorte — nunca se recorta BE ni tests.

## 9. Riesgos (de proposal §Risks, con mitigación de diseño)

1. `deny_unknown_fields` → cada DTO lista exactamente su allowlist (§2.1/2.3/2.4/2.7) +
   test "trigger-owned → 422" por endpoint.
2. Trigger-owned (`saved_amount`, `pending_amount/status`, `current_value`, `balance`) jamás
   escribibles; DELETE payment/movement con test de reversión dedicado (§2.6).
3. Cap sqlx 16 columnas en `AccountRow` → no agregar columnas; métricas card en Rust
   (ya existente); statement solo en detail.
4. CHECKs (`chk_card_*`, `budget_period_valid`, thresholds) validados en API → 422 con
   mensaje, nunca 500; mapeo `23505/23514/23503(/22P02)` centralizado por módulo.
5. `transactions` excluye `transfer` → charts lo heredan; prohibido "arreglarlo".
6. `output: export` + Recharts → `dynamic(ssr:false)`, sin `window` en imports; e2e cubre
   montos string + `YYYY-MM-DD`; accesibilidad `frontend-dashboard/spec.md` obligatoria.
7. Sobrecoste (budget 400, riesgo en FE) → TDD estricto, reuse máximo, fallback verificador+Juicio.

## 10. Non-goals (límites duros, no se diseñan)

Fase 1 (`ManualCapture`, `TransactionsLedger`, `TransferHistory`, `Productivity*`,
tests `s1-capture/s2-crud`); Fase 2 (`DashboardHome`, `dashboard/widgets/*`,
`notifications/*`, `useNotifications`, `WidgetToggle`); evolución del patrimonio;
valuaciones INSERT-only (corrección = archive+recreate); `PATCH` payment/movement (=
DELETE+recreate); `PATCH` `credit_limit`/días (= DELETE+recreate; change aparte si se pide);
`GET /assets/{id}/valuations`; PDF/Excel (reportes = solo pantalla); multi-moneda (solo COP);
UUIDs visibles; LLM; migraciones; presupuestos que bloqueen (solo `ok|warn|over`).

## 11. Criterios de aceptación del diseño (para spec/tasks)

- Cada endpoint §2 tiene DTO+allowlist+SQL+errores+tests trazables 1:1.
- Cada form §3.3 tiene mutador+wire+view-model+clave i18n trazables; cero UUIDs visibles.
- Cada chart §4.1 tiene fuente de agregado + transform puro + EmptyState + a11y trazables.
- `PeriodSelector` default mes actual; 5 rangos filtran los mismos agregados.
- `AnalysisSection` ≥3 insights directos + disclaimer, sin asesoramiento.
- `cargo test` + `vitest` + e2e en verde; F1/F2 intactos; sin migraciones.

## 12. Test plan TDD (orden estricto, rojo→verde)

1. BE puro: `validate_*` nuevos + asserts SQL (`user_id`, `id AND user_id`, `updated_at=now()`,
   `deny_unknown_fields` por DTO) — `cargo test <módulo>`.
2. BE DB (tras `DATABASE_URL`): feliz 200/201/204 + 401 + 404 ajeno + 422 validación +
   trigger-owned→422 + reversión DELETE payment + 409 donde aplique — `cargo test`.
3. FE puro: `finance.test.ts` para los 6 nuevos (§3.4) + rangos deterministas — `vitest`.
4. FE componentes: `finance.test.tsx` forms con SWR mockeado (crear/editar/borrar por dominio,
   corregir abono, cancelar/reactivar sub, crear tarjeta, valuar activo) + `charts.test.tsx`
   (render con datos, EmptyState sin datos, reduced-motion, teclado) — `vitest`.
5. E2E `sections.spec.ts`: S5 (montos string a mano, fechas date-input, selects por nombre,
   confirmaciones) + S6 (5 rangos + 4 charts + insights + disclaimer + patrimonio) — playwright.
6. I18n: sin literales fuera de `t`; `frontend-dashboard` vales (tokens, code-split,
   reduced-motion, teclado) cumplidos.
