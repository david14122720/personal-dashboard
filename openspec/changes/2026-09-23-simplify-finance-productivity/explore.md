# Explore — Simplificar finanzas (erradicar transferencias/transacciones/presupuestos) + arreglar espacio en Productividad

- change: `2026-09-23-simplify-finance-productivity`
- phase: explore (no code)
- date: session 2026-09-23
- request original (ES): "vamos a simplificar eso de finanzas amigo, quita esa funcio tengo en el baken como en el frontend de transferencias y transaccioes y presupuestos, vamos a erradicarlos por completo, y en el apartado de productividad no esta bien gestinado el espacio amigo en celulares ni el computador se ve bien usa tu skill para verlo y corregirlo"

## status

`blocked_on_scope_decision` — el mapeo técnico está completo para ambas pistas, pero Track A **no es ejecutable tal como está pedido**: borrar `transactions` destruye el único mecanismo existente para mover saldos y para alimentar dashboard/reportes/progreso. Necesita una decisión de alcance explícita del usuario antes de `propose`. Track B está completamente mapeado y es ejecutable hoy.

## executive_summary

**Track A (erradicar transfers/transactions/budgets).** Los tres módulos están limpiamente separados en el API (`routes/transactions.rs`, `routes/transfers.rs`, `routes/budgets.rs`, 9 rutas en `main.rs`) y son borrables. El problema no es el código muerto: es que `transactions` no es una función lateral, es el **motor contable** del resto de finanzas. `accounts.balance` solo se mueve por el trigger `apply_transaction_to_balance()` (migración 0002/0005), y `PATCH /accounts` rechaza `balance` (assert en `accounts.rs:703`); es decir, sin transacciones **no hay ninguna forma de que el dinero entre o salga de una cuenta**. Además `statement_balance` de tarjetas de crédito (0008 + `accounts.rs:48`), los agregados `/transactions/stats/monthly-flow` y `/transactions/stats/by-category` (KPIs del dashboard, Reportes, Progreso), los FKs opcionales `debt_payments.transaction_id` y `savings_goal_movements.transaction_id` (0003), y el strip de telemetría completo dependen de la tabla. Borrarla deja un dashboard con patrimonio fijo en 0 y 4 widgets eternamente vacíos.

**Track B (productividad).** Encontré dos defectos concretos y medibles, no una impresión subjetiva:
1. **Desborde del grid en desktop (≥1280px `xl`)**: en `ProductivityScreens.tsx` los spans `xl:col-span-5 + xl:col-span-4 + xl:col-span-4 + xl:col-span-4 = 17` sobre un grid de 12 columnas. Metas(5)+Tareas(4) llenan la fila 1 y sobran 3; Eventos(4) no cabe y salta, dejando hueco muerto de 3 columnas y una fila final de 4. Es literalmente "no está bien gestionado el espacio en el computador".
2. **Formularios a dos columnas fijas en móvil (390px)**: los 4 formularios (`ProductivityForms.tsx:146,279,424,548`) usan `grid grid-cols-2 gap-3` sin breakpoint, dentro de tarjetas con `p-5`. En 390px cada campo queda en ~150px, y los `<input type="date">`/`<select>` nativos no caben ni se pueden leer. El skeleton (`gap-4`) tampoco coincide con el grid real (`gap-6`).

**Contradicción de documento rector.** `objetivo.md` exige explícitamente ambas funciones a erradicar: "Debe existir una forma simple y manual de registrar transferencias entre mis propias cuentas" y "Debe existir un sistema de presupuestos". La propuesta debe registrar la reversión de esos requisitos (editar `objetivo.md` o acotarla), o el change queda en conflicto con el spec fundacional.

**Recomendación**: dividir. Track B va solo y ya (riesgo bajo, ~1 archivo de layout + 4 de form + tests). Track A necesita elegir entre tres alcances (§decisiones), y mi recomendación es **A2**: erradicar `transfers` y `budgets` por completo (son genuinely opcionales y aislados) y conservar `transactions` como libro mayor interno sin UI dedicada, o con UI mínima. A1 (borrar todo) obliga a rediseñar cómo entra el dinero a las cuentas antes de poder entregar nada.

---

## 1. Track A — Mapa de touchpoints

### 1.1 Backend (Rust / Axum) — `backend/`

**Rutas (`src/main.rs`, todas dentro de `api_routes()` montado en `/api`):**
| Líneas main.rs | Ruta | Handler |
|---|---|---|
| 60-63 | `POST/GET /api/transactions` | `transactions::create_transaction_handler`, `list_transactions_handler` |
| 65-68 | `GET /api/transactions/stats/by-category` | `transactions_by_category_handler` |
| 69-72 | `GET /api/transactions/stats/monthly-flow` | `transactions_monthly_flow_handler` |
| 73-77 | `PATCH/DELETE /api/transactions/{id}` | `patch_transaction_handler`, `delete_transaction_handler` |
| 78-82 | `POST/GET /api/transfers` | `transfers::create_transfer_handler`, `list_transfers_handler` |
| 87-90 | `POST/GET /api/budgets` | `budgets::create_budget_handler`, `list_budgets_handler` |
| 91-96 | `GET/PATCH/DELETE /api/budgets/{id}` | `get/patch/delete_budget_handler` |
| 97-100 | `GET /api/budgets/{id}/status` | `budget_status_handler` |

**Archivos a eliminar enteros:** `src/routes/transactions.rs` (~1600 L, mayormente tests), `src/routes/transfers.rs` (~1050 L), `src/routes/budgets.rs` (~1400 L); módulos en `src/routes/mod.rs:3,19,20`.

**Referencias cruzadas que NO son borradories (roturas reales):**
- `src/routes/budgets.rs:28` y `transfers.rs:47` importan `transactions::{validate_occurred_on, ensure_finance_category, TransactionResponse}` → helpers que hoy viven en `transactions.rs` y son usados por **otros** módulos. `validate_occurred_on` / `ensure_finance_category` deben reubicarse (candidato natural: `src/finance/` o `routes/mod.rs`) o `accounts.rs`, `savings.rs`, `debts.rs`, `categories.rs` no compilan.
- `src/routes/categories.rs:8,27` — la validación de `kind='finance'` está documentada como heredada de `transactions.rs`; `CATEGORY_KINDS` incluye `finance`, que hoy solo consumen transactions y budgets. Si desaparecen, `finance` queda como categoría sin consumidor (decisión: mantener enum vs. dejar huérfano).
- `src/routes/accounts.rs:48` `STATEMENT_BALANCE_SQL` = `SUM(amount) FROM transactions WHERE credit_card_account_id=... AND type='expense'` → `statement_balance` (`accounts.rs:524`, spec `credit-card-summary`) queda sin fuente.
- `src/routes/accounts.rs:585` `ACCOUNT_MOVEMENT_COUNT_SQL` — borrado en cascada / protección de cuentas con movimientos.
- `src/routes/debts.rs:51,609,676` `TRANSACTION_OWNERSHIP_SQL` + `ensure_transaction_owned` + `transaction_id` en `CreatePaymentRequest` (534,547).
- `src/routes/savings.rs:53,567,612` — idéntico patrón para `savings_goal_movements.transaction_id`.
- `src/routes/accounts.rs:585` + tests seeds en `debts.rs:1036`, `savings.rs:1088`, `accounts.rs:1191,1253`, `budgets.rs`, `transactions.rs:862` insertan filas `transactions` para probar → **los tests de módulos supervivientes se rompen**.
- `src/main.rs:38-39` doc comment y `main.rs` tests `protected_routes_live_under_api_prefix` (`/api/budgets` → 401), `legacy_root_paths_are_gone` (`/budgets` → 404), `p9_finanzas_write_routes_are_wired` (incluye 2 rutas de budgets) → hay que reescribirlos a rutas supervivientes, no solo borrar.
- `src/finance/mod.rs:3` doc comment menciona transactions/transfers/budgets.
- `src/routes/subscriptions.rs:857` seed test `seed_category(..., "finance", "budgets")` — solo nombre, pero es evidencia de que el kind `finance` se prueba ahí.

**Tests de backend:**
- `backend/tests/migration_0005_transfer_trigger.rs` — **7 tests dedicados 100% a transfer**; muere con la función.
- `backend/tests/migration_0008_credit_cards.rs` — verificar si seedea transactions.
- Unit tests PG-dentro de `transactions.rs`, `transfers.rs`, `budgets.rs` (patrón `SKIP ...: no DATABASE_URL`) se van con los archivos.

### 1.2 Base de datos (PostgreSQL) — `backend/migrations/`

Proyecto **sin tabla `_sqlx_migrations`**; las migraciones se aplican out-of-band con autocommit y la regla del repo es *nunca reescribir migraciones aplicadas* (assert explícito en `migration_0005_transfer_trigger.rs:91-95`). Por tanto la erradicación **es una migración nueva, 0011, aditiva-destructora**, no editar 0002/0005.

Objetos DB a retirar (migración nueva):
- Tabla `budgets` + índices `idx_budgets_user_period`, `idx_budgets_user_category` + trigger `trg_budgets_updated_at` (0002:80-98,192).
- Tabla `transactions` + 5 índices `idx_tx_*` (0002:43-73) + triggers `trg_tx_apply_balance`, `trg_tx_link_counterparty`, `trg_tx_updated_at` (0002:160-190) + funciones `apply_transaction_to_balance()`, `apply_transfer_counterparty()` (0002:104-179, reemplazada en 0005:15-46).
- Columnas `transaction_type` enum value `transfer` (0001:21) — **no se puede DROP VALUE de forma segura**; requiere `CREATE TYPE` nuevo + re-conversión de columna, o aceptar el valor huérfano. Precedente de la trampa: 0005/0006 documentan que `ALTER TYPE ... ADD VALUE` no va en bloque de transacción; quitar un valor es aún peor.
- Columnas FK entrantes: `savings_goal_movements.transaction_id` (0003:42), `debt_payments.transaction_id` (0003:110), `transactions.credit_card_account_id` (0008:37 índice parcial) → hay que `DROP COLUMN` de las tablas **supervivientes**. Esto es pérdida de datos de vínculos que hoy la UI muestra (`finance.ts:288` `DebtPaymentWire.transaction_id`).
- `accounts.balance` (0002:19): sobrevive pero queda **sin ningún escriba**. Ver riesgo R1.

### 1.3 Frontend (Next.js static export) — `frontend/`

**Componentes a eliminar (100% dedicados):**
- `components/finance/TransactionsLedger.tsx`
- `components/finance/TransferHistory.tsx` (245+ L, keyset pagination propia)
- `components/finance/BudgetForm.tsx`
- `components/ui/BudgetBars.tsx`
- `components/finance/ManualCapture.tsx` (~500 L — **ojo**: es el formulario de captura de ingresos/gastos; si se conserva `transactions` (A2) esto se queda)

**Componentes a editar (contienen secciones mezcladas con lo que sobrevive):**
- `components/containers/FinanceScreens.tsx` — imports `:8,9,10,13,20,53`; lecturas `useBudgets():122`, `useMonthlyFlow`/`useSpendByCategory:142-144`; render `<ManualCaptureSection/>:173`, `<TransactionsLedger/>:176`, `<TransferHistory/>:179`, `BudgetsList:210-214`, `S5Sections` "Presupuestos: crear y editar":357-367, charts `BalanceChart/SavingsChart/MonthlyExpensesChart/MonthCompareChart/CategoryDonut` (todos alimentados por `/transactions/stats/*`), `toBudgetViews`, `BudgetWireWithThresholds`/`toBudgetFormValue:297-305`.
- `components/containers/DashboardHome.tsx` — `useBudgets():155`, `useMonthlyFlow():153`, `useSpendByCategory():154`, `budgetRows:198`, `worstBudgetStatus:204`, KPIs del `TelemetryStrip`: `month-balance`, `savings-rate`, `budgets` (`:211-228`), `FlowChart:358-364`, `BudgetBars:373`, `CategoryDonut:387`.
- `components/containers/ReportsScreens.tsx:17-18,89-90` — la pestaña de reportes financieros son `useMonthlyFlow` + `useSpendByCategory`.
- `components/containers/ProgressScreens.tsx:12,80,154-166` — bloque ahorro/patrimonio desde `flow`.
- `components/finance/AnalysisSection.tsx:17,32,50,98` + `lib/finance/finance.ts:452-537` (`toInsights` con `kind:"budget"`), `lib/finance/finance.ts:81` `toBudgetViews`, `:215-232` `toTransferRows`/`transferKey`.
- `components/finance/FinanceSections.tsx:65-90` `BudgetsList`.
- `lib/api/dashboard.ts:37` `BudgetWire`, `:119-141` `useMonthlyFlow`, `useSpendByCategory`, `useBudgets`.
- `lib/api/finance.ts:14-74,143-244,279-282` — toda la capa transactions/transfers/budgets (types, path builders, SWR keys, create/patch/delete).
- `lib/dashboard/transforms.ts:12-26,60-80,120-183` — `MonthlyFlowWire`, `toFlowPoints`, `worstBudgetStatus`, `monthBalance`, `toMonthIncome/Expense/Savings`.
- `components/ui/TelemetryStrip.tsx` — consume los items del strip (solo ids cambian).

**i18n (`lib/i18n/es.ts`) — claves a eliminar** (~40): `finance.transfersTitle/Subtitle/Region/showingTransfers/noTransfers/noTransfersHint/loadingTransfers/transfersLoadFailed/transfersLoadFailedHint/transferDirection/newTransfer/saveTransfer/transferSaved`, `finance.noTransactions/noTransactionsHint/loadingTransactions/budgetRemaining/budgetSpendLabel/budgetsHint/budgets/noBudgets`, `finance.manageBudgets`, `finance.confirmDeleteBudget`, `dashboard.budgets/noBudgets/budgetsHint/loadingBudgets/onTrack`, `charts.*` (los que consumen flow), `analysis.tplBudget:838`. Nota: **conservar** `finance.paymentTransfer:163` — es el valor de método de pago "Transferencia" en `SubscriptionForms.tsx:83` y `DebtPayments.tsx:62`, semánticamente distinto de la feature transfers. `lib/i18n/i18n.test.ts:118` prueba `analysis.tplBudget`.

**Tests frontend a reescribir/eliminar:** `components/finance/finance.test.tsx` (handlers mock `/api/transactions`, `/api/budgets`, `/api/transfers` — `:64,71,189,294-297,339,352,367,409`), `components/finance/jd-round1.test.tsx`, `s1-capture.test.tsx`, `AnalysisSection.test.tsx`, `lib/finance/finance.test.ts:2,150-154,243-334`, `lib/finance/jd-round1.test.ts` (7× `budgets: []`), `lib/api/dashboard.test.ts:112`, `lib/dashboard/transforms.test.ts:66-70`, `components/containers/DashboardHome.test.tsx`, `e2e/sections.spec.ts:33-34`.

**MCP (`mcp-dashboard/src/tools.ts`):** 6 tools de transactions (`:397-497`: `list/create/update/delete_transaction`, `stats_transactions_by_category`, `stats_transactions_monthly_flow`) + tools de budgets (`:988-993` `list_budgets` y vecinos). **No existen tools de transfers** (grep confirmado) → transfers no rompe MCP. `mcp-dashboard/README.md:6,136` catalogan el acceso. Rompe el contrato público para clientes de tokens de API (`backend/src/routes/tokens.rs` — scopes son JSON libre, sin allowlist por ruta, así que no hay que tocar scopes).

**Specs OpenSpec:** `openspec/specs/finance-transactions/`, `finance-transfers/`, `finance-budgets/` se retiran; **referencias huérfanas a corregir**: `frontend-dashboard/spec.md:11,15,214,218-220` (Telemetry strip con budget LEDs, "charts MUST remain intact", exclusión de transfers), `dashboard-widgets/spec.md:11` (month-income/expense/savings desde `/transactions/stats/monthly-flow`), `credit-card-summary` (statement balance), `finance-accounts`, `reports-screen`, `progress-score`, `finance-subscriptions`. `objetivo.md:125-152` exige las funciones a borrar (ver riesgo R3).

---

## 2. Track B — Productividad: auditoría de layout

Ruta `/dashboard/productivity/` → `app/dashboard/productivity/page.tsx` (solo guard) → `components/containers/ProductivityScreens.tsx` dentro de `AppShell`. Contiene 4 secciones: Metas, Tareas, Eventos, Notas (los hábitos viven en `/dashboard/habitos/`).

### B1. ARREGLO CRÍTICO — desborde del grid en `xl` (desktop 1440px)
`ProductivityScreens.tsx:217` `<div className="mt-6 grid grid-cols-12 gap-6">` con spans:
| Sección | span (línea) | móvil | md (768) | xl (1280) |
|---|---|---|---|---|
| Metas | `col-span-12 xl:col-span-5` (:245) | 12 | 12 | 5 |
| Tareas | `col-span-12 md:col-span-6 xl:col-span-4` (:262) | 12 | 6 | 4 |
| Eventos | `col-span-12 md:col-span-6 xl:col-span-4` (:285) | 12 | 6 | 4 |
| Notas | `col-span-12 xl:col-span-4` (:306) | 12 | 12 | 4 |
| **suma xl** | | | | **17 ≠ 12** |

Consecuencia real en 1440px: fila 1 = Metas(5)+Tareas(4)=9 y sobran 3 huecos porque Eventos(4) no caben; fila 2 = Eventos(4)+Notas(4). Resultado: columna muerta de ~33% a la derecha y lectura en zigzag. **Fix propuesto**: hacer que la primera fila sume 12 y la segunda también — p. ej. Metas `xl:col-span-6`, Tareas `xl:col-span-6`, Eventos `xl:col-span-6`, Notas `xl:col-span-6` (2×2 balanceado, recomendado para tarjetas de altura muy desigual), o `6/6` + `4/4/4` si se quiere trio de listas. Comparar con `FinanceScreens.tsx:212-252`, que sí suma 12 (`7+5`, `4+4+4`) → el patrón correcto ya existe en el repo y es la referencia a imitar.

### B2. ARREGLO CRÍTICO — formularios a 2 columnas fijas en móvil (390px)
`ProductivityForms.tsx:146,279,424,548`: `className="grid grid-cols-2 gap-3"` sin breakpoint, anidados dentro de `SectionShell` con `p-5` (`ProductivitySections.tsx:~135`) dentro de `col-span-12`, dentro de `main` con `px-4 pb-24 pt-6` (`AppShell.tsx`). En 390px: 390 − 32 (main px-4) − 40 (card p-5) = ~318px de contenido; dos columnas de ~155px con `gap-3`. Los campos `type="date"` y `type="datetime-local"` nativos necesitan ~150-160px solo para el icono del picker → se cortan o desbordan; los `<select>` de área/prioridad truncan. **Fix propuesto**: `grid-cols-1 sm:grid-cols-2 gap-3` en los 4 formularios, y revisar los `col-span-2` internos (pasan a `sm:col-span-2`) para que sigan ocupando fila completa.

### B3. Arreglos secundarios (mismo change, bajo riesgo)
- **Skeleton inconsistente**: `SectionsSkeleton` (:67) usa `gap-4` y `md:col-span-6` mientras el grid real es `gap-6` con spans distintos → cambio de layout visible al cargar. Alinear a `gap-6` + spans reales.
- **Doble padding vertical anidado**: `SectionShell` pone `<div className="mt-4">` para children y el contenedor repite `<div className="mt-4">` alrededor de listas/tabs (:255, :269, :289, :310) → 32px entre form y lista vs 16px dentro. Normalizar.
- **Fricción en móvil por acciones en línea**: cada fila de `TasksList`/`EventsList`/`NotesResults` apila botones Editar/Eliminar (`text-[11px]`, `px-2 py-1`) debajo del título en flex-wrap — a 390px el touch target queda por debajo del mínimo de 44px recomendado y la lista se vuelve muy larga (4 secciones × formulario abierto + lista). Decisión de diseño: colapsar el formulario en un botón "Nuevo" (acorde a `objetivo.md`: alta fricción visual) o dejarlo abierto. **Marcar como decisión de producto, no asumirla.**
- **`gap-6` en móvil**: 24px entre secciones apiladas a 390px es generoso pero no es un bug; no lo cambio sin razón. Lo que sí duele es B1/B2.
- **Altura de fila en Metas**: `GoalsList` (`ProductivitySections.tsx:~215`) usa `flex flex-wrap items-baseline justify-between gap-2` con nombre truncado + status + %+área; a 390px el `truncate` sobre un nombre largo come el badge de status. Revisar con screenshot, no a ciegas.

### B4. Cómo verificar (webapp-testing)
Playwright con viewport 390×844 y 1440×900 sobre `/dashboard/productivity/`, screenshot full-page + medir `document.documentElement.scrollWidth > clientWidth` (overflow horizontal), y `getBoundingClientRect()` de los inputs de fecha para detectar recorte. Requiere backend vivo o mocks; `e2e/helpers.ts` ya tiene `loginViaApi`. Nota: no pude ejecutar navegador ni servidor en esta sesión (sin tool de shell) → la verificación visual queda como tarea de la fase apply/verify.

---

## 3. Decisiones de alcance requeridas antes de `propose`

**D1 — Qué pasa con `transactions` (bloqueante).**
- **A1 "Erradicar todo" (interpretación literal).** Fin de la contabilidad: `accounts.balance` queda en 0 para siempre y sin API para escribirlo; `statement_balance` de tarjetas muere; net worth y los KPIs `month-balance`/`savings-rate`/`month-income/expense/savings` quedan vacíos; Reportes-finanzas y el bloque de ahorro en Progreso quedan vacíos. **Requiere** un reemplazo de "cómo entra el dinero": (a) `PATCH /accounts` acepte `balance` manual (permite el número, pierde historia), o (b) un modelo "snapshot de valores" como `assets`/valuations (append-only, ya existe el patrón en `routes/assets.rs`). Sin elegir (a) o (b), A1 no es una propuesta coherente.
- **A2 (RECOMENDADO).** Erradicar **`transfers` y `budgets` por completo** (son módulos periféricos y limpios: transfers = 2 rutas + `transfers.rs` + spec + `TransferHistory.tsx` + tests; budgets = 4 rutas + `budgets.rs` + spec + `BudgetForm/BudgetsList/BudgetBars` + LED del strip) y **conservar `transactions`** como libro mayor, con la UI de captura simplificada. Cumple la intención ("simplificar, menos funciones que no uso") sin romper saldos, patrimonio, tarjetas ni reportes.
- **A3.** Erradicar transacciones + transferencias y **conservar presupuestos** como plantillas de gasto manual. Probablemente no es lo pedido; listar solo para descartar explícitamente.

**D2 — UI de captura.** Si sobrevive `transactions`: ¿se queda `ManualCapture.tsx` + `TransactionsLedger.tsx`, o se reduce a "registro rápido" sin filtros/paginación? El ledger con keyset pagination y filtros es la mayor fuente de complejidad visual en Finanzas.

**D3 — Datos existentes en producción.** La migración destructiva borra filas reales (Postgres en Dokploy, `192.168.50.120:5434` en dev). Decisión explícita del usuario: ¿backup + dump antes de aplicar? ¿o se acepta pérdida total del histórico? Requiere gate de autorización humano; no lo asumo.

**D4 — Colapsar formularios en Productividad (B3, punto 3).** Decision de producto; no la tomo en silencio.

---

## risks

- **R1 (CRÍTICO, bloqueante) — Quedar sin mecanismo para mover dinero.** `accounts.balance` solo lo escribe el trigger sobre `transactions` (0002:104-160 / 0005:15-46) y `PATCH /accounts` rechaza `balance` (`accounts.rs:703`). Erradicar transacciones sin A1(a)/A1(b) deja el 100% de las cuentas en 0, patrimonio 0 y sin forma de corregirlo. **Mitigación**: D1 explícito; cualquier opción que se elija debe nombrar el reemplazo en el proposal.
- **R2 (CRÍTICO) — Pérdida de datos irreversible + FKs entrantes.** `DROP TABLE transactions` exige antes `DROP COLUMN` de `debt_payments.transaction_id` (0003:110) y `savings_goal_movements.transaction_id` (0003:42), que hoy son datos que la UI muestra. Y `transaction_type` no puede perder el valor `transfer` limpiamente (`ALTER TYPE DROP VALUE` no existe; requiere tipo nuevo + reconversión). **Mitigación**: migración 0011 nueva (nunca reescribir 0002/0005 — regla assertada en `migration_0005_transfer_trigger.rs:91-95`), dump previo, y aceptar explícitamente el enum huérfano o planear el `CREATE TYPE` nuevo.
- **R3 — Conflicto con `objetivo.md`.** Las líneas 125-152 exigen transferencias manuales y sistema de presupuestos, con decisiones de diseño documentadas (presupuesto solo visual, transferencias no cuentan como ingreso/gasto). Borrarlas contradice el documento rector. **Mitigación**: editar `objetivo.md` en el mismo change registrando la reversión y por qué, o acotar el change a A2 y documentar la excepción.
- **R4 — Contratos MCP rotos sin versión.** `mcp-dashboard/src/tools.ts` expone 6 tools de transactions y al menos `list_budgets`; `README.md:6,136` los anuncia. Borrar backend sin actualizar MCP deja tools que devuelven 404 a los clientes de tokens. **Mitigación**: incluir `mcp-dashboard/` en el slice; los scopes de `api_tokens` no filtran por ruta, así que no hay migración de tokens.
- **R5 — Referencias cruzadas que rompen compilar.** `validate_occurred_on` y `ensure_finance_category` viven en `transactions.rs` y los consumen `budgets.rs`, `transfers.rs` y otros; los tests de `debts.rs`, `savings.rs`, `accounts.rs` seedean filas en `transactions` directamente. **Mitigación**: slice 0 = extraer helpers a `src/finance/` + reemplazar seeds de tests por fixtures propias, antes de borrar nada.
- **R6 — Vacíos silenciosos en dashboard/reportes.** Aunque se elija A2, quitar `budgets` elimina el LED `budgets` del `TelemetryStrip` (`DashboardHome.tsx:204-228`) y `BudgetBars` (:373), y `frontend-dashboard/spec.md:214` dice literalmente que esos charts "MUST remain intact". **Mitigación**: actualizar spec + `specs/dashboard-widgets` y reequilibrar el strip a 5 KPIs; no dejar el widget invisiblemente vacío.
- **R7 — Riesgo de Track B: arreglar a ciegas.** Sin shell/navegador en esta sesión no pude renderizar 390px/1440px; B1 y B2 se deducen de aritmética de clases (segura) pero B3/B4 necesitan screenshot. **Mitigación**: primer paso del slice B = screenshots Playwright antes/después como evidencia; no fusionar cambios de layout sin ellos.
- **R8 — Tamaño vs review_budget 400.** Track A en la lectura literal toca ~14 archivos de backend, ~18 de frontend, 1-2 migraciones, 8+ specs y el MCP → muy por encima de 400 líneas por PR; obliga a cadena (helpers → transfers → budgets → transactions/MCP → specs/docs). Track B es un PR pequeño y autónomo. **Mitigación**: `delivery_strategy: auto-chain` ya decidido en preflight, pero **separar B en su propia unidad entregable** para que no espere a las decisiones de A.

## artifacts

- `openspec/changes/2026-09-23-simplify-finance-productivity/explore.md` — este documento (backend + frontend + DB + MCP + specs + auditoría de layout).
- Persistencia de memoria: guardada vía Engram con `topic_key: sdd/2026-09-23-simplify-finance-productivity/explore` (ver Memory Contract).

## next_recommended

1. **`ask` (gate humano, mínimo) — resolver D1 y D3 con el usuario.** Pregunta concreta en español: "¿Quieres borrar también el registro de ingresos/gastos (transacciones)? Si sí, ¿cómo quieres entonces que cambie el saldo de tus cuentas: escribir el saldo a mano, o tomar fotos de valor como en activos?" y "¿hay respaldo del Postgres de producción?". No lanzar `propose` con D1 abierto.
2. **Track B → `propose` ya (independiente de D1).** Los arreglos B1 (spans `xl` que sumen 12, imitando `FinanceScreens.tsx:212-252`) y B2 (`grid-cols-1 sm:grid-cols-2`) no dependen de finanzas. Proponer como change/slice propio, `single-pr` estimado (~60-120 líneas), con evidencia Playwright 390/1440 antes/después. D4 se resuelve con el usuario en el mismo hilo.
3. **`design` solo si se elige A1** (necesita diseñar el sustituto de saldos). Con A2 el design cabe en el proposal.
4. **Al `propose`, planificar slices en este orden** (cada uno ≤400 líneas, verde antes del siguiente):
   - S0 helpers: extraer `validate_occurred_on` / `ensure_finance_category` a `src/finance/`, reemplazar seeds de `transactions` en tests de debts/savings/accounts.
   - S1 transfers fuera: backend (`main.rs`, `transfers.rs`, `mod.rs`, `tests/migration_0005_transfer_trigger.rs`) + frontend (`TransferHistory.tsx`, `lib/api/finance.ts`, `finance.ts:215-232`, i18n `finance.transfer*`) + spec `finance-transfers` + `objetivo.md`.
   - S2 budgets fuera: backend + frontend (`BudgetForm`, `BudgetsList`, `BudgetBars`, LED del strip, `toInsights` budget) + specs `finance-budgets`, `frontend-dashboard`, `dashboard-widgets` + i18n.
   - S3 (solo si A1) transactions + stats + MCP + migración 0011.
   - S4 Productividad layout (Track B) — en paralelo, sin dependencias.
5. **Actualizar `mcp-dashboard/README.md` y `tools.ts`** en el slice que retire cada endpoint; no dejar tools 404.

## skill_resolution

`paths-injected` — leídos antes de trabajar, los 6 exactos:
`/home/david/Nextcloud2/Ubuntu/landing_personal/.claude/skills/{rust-best-practices,supabase-postgres-best-practices,next-best-practices,tailwind-design-system,web-design-guidelines,webapp-testing}/SKILL.md`.
Dos salvedades honestas: (1) `web-design-guidelines` manda a hacer fetch de las reglas remotas y no había tool de red en esta sesión, así que la auditoría B se hizo con aritmética de clases Tailwind + `tailwind-design-system`/`next-best-practices`, no con la lista remota; (2) `supabase-postgres-best-practices` es un SKILL.md índice (los `references/*.md` no fueron necesarios para esta decisión: el hallazgo DB es de integridad destructiva, no de rendimiento).
Además: **CodeGraph no ejecutable** — `.codegraph/` solo contiene `.gitignore` y no dispongo de tool de shell en esta sesión para `gentle-ai codegraph init`; el mapeo se hizo con `find`/`grep`/`read` indexados por ruta. El próximo phase debe pasar índices de archivos concretos (ya incluidos arriba) o correr init fuera.
