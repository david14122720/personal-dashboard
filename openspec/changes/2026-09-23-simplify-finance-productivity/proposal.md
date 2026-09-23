# Proposal — 2026-09-23-simplify-finance-productivity

- change: `2026-09-23-simplify-finance-productivity`
- phase: propose
- date: 2026-09-23
- preflight: `execution: auto` · `artifact_store: openspec` · `delivery_strategy: auto-chain` · `review_budget: 400` · `chain_strategy: deferred`
- request original (ES): quitar transferencias, transacciones y presupuestos "por completo" (backend + frontend) y arreglar la mala gestión del espacio en Productividad (móvil y computador).

## status

`ready_for_spec` — las tres decisiones de alcance bloqueantes del explore (D1, D3, D4) fueron
resueltas y autorizadas por el usuario en español, así que Track A ya es ejecutable y Track B
nunca dependió de ellas. Quedan cinco supuestos de producto revisables, registrados en §2 como
ronda de preguntas delegada por `auto`; ninguno impide escribir el spec.

## executive_summary

**Qué se hace.** Dos pistas entregables e independientes. **Track A**: erradicar por completo
transferencias, transacciones y presupuestos del dashboard personal (rutas, modelos, triggers,
tablas, componentes, i18n, tests, tools MCP y specs OpenSpec), y reemplazar el mecanismo de
movimiento de dinero por un **saldo manual**: `PATCH /api/accounts/{id}` pasa a aceptar
`balance` (hoy rechazado con 422 en `accounts.rs:703`). El histórico se pierde a propósito y **sin
dump previo** (D3 aceptada). **Track B**: arreglar Productividad con tres fixes mecánicos
(spans `xl` que suman 17 sobre un grid de 12 → 6/6 + 6/6; los 4 formularios con
`grid-cols-2` sin breakpoint que aplastan campos a ~155px en 390px; skeleton/doble `mt-4`/touch
targets) más **D4**: cada formulario arranca colapsado detrás de un botón "Nuevo" por sección.

**Por qué es coherente ahora.** El explore quedó bloqueado porque `transactions` no era una
función lateral sino el motor contable (`accounts.balance` solo lo movía el trigger de 0002/0005).
La decisión A1-con-saldo-manual desbloquea eso: el saldo deja de ser una proyección del libro
mayor y pasa a ser el dato que el usuario afirma, igual que ya lo son las valuaciones de activos.
El costo es explícito y aceptado: sin historia, sin flow mensual, sin "cuánto entró/salió".

**Contradicción rectora resuelta.** `objetivo.md:125-152` exige transferencias manuales y sistema
de presupuestos. Esta propuesta **revierte** esos requisitos y edita `objetivo.md` dentro del mismo
change registrando el porqué, para que el change no quede en conflicto con el documento fundacional.

## 1. Intent / business problem

- **Dolor actual:** el módulo de finanzas creció maquinaria contable que el usuario no usa. Para
  saber "cuánto tengo" hoy hay que registrar asientos, entender un ledger con keyset pagination
  (`TransferHistory.tsx`), y mantener un formulario de captura de ~500 líneas (`ManualCapture.tsx`).
  Es un costo cognitivo y visual desproporcionado para un control center privado de una persona.
- **Confusión / fricción:** el usuario ve secciones enteras (Presupuestos, Captura, Ledger) compiten
  por pantalla con lo que sí mira: cuentas, tarjetas, deudas, ahorros, suscripciones, patrimonio.
- **Coste operativo:** cada módulo erradicado arrastra 3 artefactos que hay que mantener en sync
  (ruta Axum + hook SWR + spec OpenSpec + tool MCP). `transactions.rs` (~1600 L), `budgets.rs`
  (~1400 L) y `transfers.rs` (~1050 L) son mayormente tests de comportamiento que el usuario no
  necesita.
- **Productividad:** no es una impresión subjetiva. En 1440px hay una columna muerta de ~33% por
  spans que no caben (metas 5 + tareas 4 llenan la fila, eventos 4 salta a la siguiente) y en
  390px los `<input type="date">`/`<select>` nativos se cortan. Además las 4 secciones apilan
  formulario abierto + lista, con botones Editar/Eliminar por debajo del mínimo táctil.

## 2. Proposal question round (delegada por `auto` — supuestos revisables, sin re-preguntar)

Preflight `auto`: no se hace ronda interactiva. Se fijan estos supuestos con explore +
`objetivo.md` + las decisiones ya autorizadas; cada uno es corregible antes del spec.

1. **¿Qué hace `statement_balance` cuando ya no hay transacciones?** Supuesto fijado: el campo
   **devuelve `null`** (ya es `Option<Decimal>` en `AccountResponse:125`) y **no se inventa**:
   para tarjetas, la cifra de deuda visible sigue siendo `balance` + las métricas derivadas
   `used_balance`/`available_balance`/`usage_pct`/`alert_level`, que **ya se computan de `balance`**
   (`compute_card_metrics`, `accounts.rs:373`), no del aggregate. Es decir: el fallback es el saldo
   manual, y `statement_balance` (deuda del ciclo de factura) desaparece del wire y de la UI.
   Alternativa descartada: devolver `statement_balance = balance` (mentiría: confundiría deuda
   total con deuda de ciclo).
2. **¿Widgets/reports/progress vacíos o retirados?** Supuesto fijado: **retirados, no vacíos**.
   El `TelemetryStrip` se reequilibra a 5 KPIs sin fuentes de transacciones (patrimonio, cuentas,
   suscripciones, deudas, ahorros), se quita el LED `budgets`; en Reportes-finanzas el bloque
   flow/categorías sale y entran patrimonio + costo mensual de suscripciones + deuda en pie
   (todos con fuente real); en Progreso el bloque de ahorro desde `flow` se sustituye por
   progreso de metas/ahorros. Nada se queda renderizando un `EmptyState` perpetuo con datos que
   ya no existirán.
3. **¿Qué pasa con el `kind='finance'` de categorias?** Supuesto fijado: **se mantiene aceptado**
   en la API de categorías y en `CATEGORY_KINDS` (borrarlo requiere tocar un enum y rompe filas
   existentes sin beneficio), pero deja de tener consumidor y de aparecer en copy/UI. Queda
   documentado en la spec como huérfano intencional.
4. **¿Dónde se escribe el saldo manual?** Supuesto fijado: `PATCH /api/accounts/{id}` acepta
   `balance` string decimal y la UI lo expone **en la tarjeta de cuenta** (inline edit con el mismo
   validador `scale ≤ 2`, `< 10^6`, y formato es-CO ya usado en `formatMoney`), con confirmación
   visible antes de guardar. Sin pantalla nueva de "movimientos".
5. **¿Cómo interactúa "Nuevo" colapsado (D4) con Editar?** Supuesto fijado: "Nuevo" abre el
   formulario vacío y lo colapsa al guardar/cancelar; **Editar abre el mismo formulario
   pre-rellenado** (patrón actual de `onEdit` en `GoalsList`/`TasksList`/`EventsList`), y al
   cancelar vuelve a colapsado. La lista nunca queda oculta por un formulario.

## 3. Target users y situaciones

- **Usuario único (privado), en el celular (~390px):** consulta de paso — saldos, qué vence, cuánto
  queda por pagar. Quiere escribir un número y salir. Momento de urgencia alto (en la fila del
  cajero, en el supermercado). Aquí es donde D4 y el fix de `grid-cols-2` valen más.
- **Usuario único, en el computador (~1440px):** revisión semanal/mensual — patrimonio, deudas,
  suscripciones. Es donde hoy se ve la columna muerta y el zigzag.
- **Consumidor secundario:** clientes MCP con token de API (asistente LLM). Su contrato público
  cambia: 7 tools desaparecen (6 de transactions + `list_budgets`). No hay tools de transfers, así
  que transfers no rompe MCP.
- **Nadie más:** no hay multi-tenant, ni soporte, ni otro equipo afectado. El costo de la
  erradicación recae entero en una persona que lo autorizó.

## 4. Business rules (invariantes que el change debe respetar)

**Nuevas / modificadas**
- BR1. `accounts.balance` es **dato del usuario**, no proyección: se escribe por
  `PATCH /api/accounts/{id}` y ningún trigger lo toca.
- BR2. No existe modelo de snapshot/historia de saldos (explícito: sin `balance_history`, sin
  valuaciones de cuenta). La única serie temporal que sobrevive en finanzas son las valuaciones
  de activos (`routes/assets.rs`, INSERT-only, intactas).
- BR3. Transferencias entre cuentas propias se hacen **editando dos saldos a mano**. No hay
  operación "transferencia".
- BR4. No hay presupuestos ni advertencias de gasto. `objetivo.md` se edita para retirar ese
  requisito y su decisión asociada ("presupuesto solo visual").
- BR5. Migration **0011, aditiva-destructora**. Regla de repo innegociable: **nunca reescribir
  0002/0005** (assert explícito en `backend/tests/migration_0005_transfer_trigger.rs:91-95`).
- BR6. Todo lo que hoy referencia `transaction_id` pasa a ser self-contained: `debt_payments`
  y `savings_goal_movements` conservan su propio `amount`/`date` y pierden la columna FK.

**Heredadas (siguen vigentes, no se tocan)**
- Bearer + `require_user_id` (401); SQL siempre `user_id`-scoped (foráneo → 404, sin filtrar
  existencia); `deny_unknown_fields` → 422; decimales como **string** (`NUMERIC`, `scale ≤ 2`,
  `< 10^6`), jamás float en el wire; COP es-CO con `formatMoney`; i18n ES tipado `t(key, vars)`
  sin literales; `output: export` + charts con `next/dynamic(ssr:false)`; tokens `--color-*`,
  `prefers-reduced-motion`, foco visible; targets táctiles ≥44px; sin UUIDs/IDs técnicos en UI.
- Seguridad/privacidad: al ser datos financieros personales en una sola cuenta, la erradicación no
  reduce superficie de protección, pero **sí** debe borrar las claves i18n y fixtures muertas
  (higiene, no compliance).

## 5. Product outcome (qué se puede hacer después)

- Financiar el mes sin libro mayor: abrir Cuentas → escribir el saldo nuevo → listo. Patrimonio y
  tarjetas siguen siendo correctos porque ya derivan de `balance`.
- Finanzas muestra solo lo que se mira: cuentas/tarjetas, suscripciones, deudas, ahorros,
  categorías, activos/patrimonio. Sin Captura, sin Ledger, sin Transferencias, sin Presupuestos.
- Productividad en 1440px: 2×2 balanceado (6/6 + 6/6) sin columna muerta; en 390px: un campo por
  línea, fecha legible, y cada sección mostrando **su lista** con un botón "Nuevo" en vez de
  cuatro formularios abiertos apilados.
- Menos superficie que romper: −3 archivos de ruta, −4 componentes, −7 tools MCP, −3 specs
  OpenSpec.

## 6. Current-state gap (qué está mal hoy, medible)

| Gap | Evidencia |
|---|---|
| El saldo solo se mueve registrando asientos | trigger `apply_transaction_to_balance()` (0002:104-160 / 0005:15-46); `PATCH` rechaza `balance` (`accounts.rs:699-707`) |
| Tres módulos que el usuario no usa dominan la pantalla de Finanzas | `FinanceScreens.tsx:173,176,179,210-214,357-367` (Captura, Ledger, Transferencias, Presupuestos) |
| KPIs del dashboard casados con `/transactions/stats/*` | `DashboardHome.tsx:153-155,198-228`; `dashboard-widgets/spec.md:11` |
| Grid `xl` de Productividad suma 17 sobre 12 | `ProductivityScreens.tsx:256,275,296,312` (5+4+4+4) vs referencia correcta `FinanceScreens.tsx:212-252` (7+5, 4+4+4, 6+6) |
| Campos de fecha/select ilegibles en 390px | `ProductivityForms.tsx:146,279,424,548` `grid grid-cols-2 gap-3` sin breakpoint |
| Skeleton no coincide con el layout real | `ProductivityScreens.tsx:70` (`gap-4`, `md:col-span-6`) vs grid real (`gap-6`, spans distintos) |
| Doble `mt-4` anidado → ritmo vertical incoherente | `ProductivitySections.tsx` `SectionShell` + `ProductivityScreens.tsx:255,269,289,310` |
| El documento rector exige lo que se borra | `objetivo.md:125-152` |

## 7. Scope — In

**Track A (finanzas, cadena stacked-to-main)**
- S1: retirar `transfers` (backend + frontend + spec + `objetivo.md`).
- S2: retirar `budgets` (backend + frontend + LED del strip + specs + `objetivo.md`).
- S3: retirar `transactions` + `/transactions/stats/*` + `ManualCapture`/`TransactionsLedger`,
  agregar `balance` a `PATCH /api/accounts/{id}` (con su UI inline), migración 0011, tools MCP,
  specs, `statement_balance` → `null`, `ACCOUNT_MOVEMENT_COUNT_SQL` → guardas sobre FKs vivas.

**Track B (productividad, PR autónomo)**
- S4: spans `xl` 6/6 + 6/6; `grid-cols-1 sm:grid-cols-2` + `sm:col-span-2` internos; skeleton
  alineado (`gap-6` + spans reales); normalizar `mt-4`; touch targets ≥44px; formularios colapsados
  detrás de "Nuevo" por sección (D4); evidencia Playwright 390/1440 antes/después.

**Sobrevive intacto (boundary de la primera entrega)**
`accounts` (CRUD, archive, métricas de tarjeta), `debts` + `debt_payments`, `savings` +
`savings_goal_movements`, `subscriptions`, `assets` + valuaciones + net worth, `categories`,
auth + `api_tokens` (los scopes son JSON libre, sin allowlist por ruta → **sin migración de
tokens**), hábitos, metas, tareas, eventos, notas, campanita/notificaciones, y el transporte MCP.

## 8. Scope — Non-goals / later

- **No** diseño de un reemplazo de ledger "ligero" (registro rápido de ingresos/gastos). Si algún
  día se quiere, es change nuevo.
- **No** snapshot/valuation por cuenta, ni gráfica de evolución de saldo.
- **No** backup, dump ni doble lectura defensiva (D3). No se escribe código de migración de datos.
- **No** tocar `assets`/valuaciones ni su patrón INSERT-only.
- **No** `DROP TYPE`/`ADD VALUE` limpio sobre `transaction_type` ver como objetivo en sí: ver §10
  para el manejo concreto.
- **No** rediseñar otras pantallas (Finanzas, Reportes, Progreso) más allá de retirar los bloques
  sin fuente y reequilibrar el strip.
- **No** cambios de comportamiento en la API de productividad (solo layout + estado colapsado).
- **No** buscar el "por qué" del grid en otras breakpoints: solo `xl` está roto; móvil y `md` se
  dejan.

## 9. Slices y delivery (review_budget 400, auto-chain)

| Slice | Contenido | Depende | Forma de PR |
|---|---|---|---|
| **S0 helpers** | extraer `validate_occurred_on` y `ensure_finance_category` de `transactions.rs` a `src/finance/`; reemplazar los seeds de tabla `transactions` en los tests de `debts.rs:1036`, `savings.rs:1088`, `accounts.rs:1191,1253` por fixtures propias | — | pequeño, ≤400 |
| **S1 transfers** | borrar `routes/transfers.rs` + `mod.rs` + `main.rs:78-82`; `tests/migration_0005_transfer_trigger.rs` (7 tests); `TransferHistory.tsx`; `lib/api/finance.ts` transfers; `finance.ts:215-232` `toTransferRows`/`transferKey`; i18n `finance.transfer*`; spec `finance-transfers`; `objetivo.md` | S0 | **delete-only**, probable >400 líneas |
| **S2 budgets** | borrar `routes/budgets.rs` + `main.rs:87-100`; `BudgetForm.tsx`, `BudgetsList`, `BudgetBars.tsx`; LED `budgets` + `worstBudgetStatus` + `toBudgetViews`; `list_budgets` MCP + README; i18n budgets; specs `finance-budgets`, `frontend-dashboard:214`, `dashboard-widgets` | S0 | **delete-only**, probable >400 |
| **S3 transactions** | borrar `routes/transactions.rs` + 9 rutas + stats; migración **0011**; `PATCH /accounts` + `balance` + UI inline; `statement_balance` → `null`; drop FK columns; 6 tools MCP + README; specs `finance-transactions`, `credit-card-summary`, `reports-screen`, `progress-score`, `frontend-dashboard`, `dashboard-widgets` | S0 (S1,S2 ideally merged) | pesado; puede partirse en S3a (backend+migración) / S3b (frontend+MCP+specs) |
| **S4 productividad** | Track B completo | ninguno | **autónomo**, ~120-200 líneas, puede ir en paralelo y mergear primero |

**Reglas de cadena**
- **Invariant de despliegue:** migración 0011 y `PATCH balance` viven en el **mismo** slice (S3).
  Ningún build desplegable puede tener transacciones fuera y saldo manual no disponible — ese
  intermedio deja todas las cuentas congeladas en 0.
- S4 no espera a Track A y Track A no espera a S4; se mergean por separado.
- Orden de merge recomendado: **S4 → S0 → S1 → S2 → S3** (S3 último: es el punto de no retorno).
- Los slices S1/S2/S3 son **deletions mayoritarias**: el presupuesto de 400 líneas de review se
  excede en líneas cambiadas pero no en carga cognitiva (el review es "¿queda alguna referencia?").
  Si el harness marca `size:exception` al aplicar, se escala al usuario con esa lectura explícita;
  `size:exception` **no** se infiere ni se auto-acepta aquí.

## 10. Decisiones técnicas obligatorias del proposal (no dejan ambigüedad para el spec)

1. **Migración 0011 (destructiva-aditiva, nueva, nunca editar 0002/0005).** Orden dentro de la
   migración:
   a) `DROP COLUMN transaction_id` de `debt_payments` (0003:110) y `savings_goal_movements`
   (0003:42) — FKs entrantes, hay que quitarlas antes de tocar la tabla.
   b) `DROP TABLE transactions CASCADE` (lleva `credit_card_account_id` de 0008:37, los 5 índices
   `idx_tx_*`, y `trg_tx_apply_balance` / `trg_tx_link_counterparty` / `trg_tx_updated_at`) y
   `DROP TABLE budgets` (lleva `idx_budgets_*` + `trg_budgets_updated_at`).
   c) `DROP FUNCTION apply_transaction_to_balance()` y `apply_transfer_counterparty()`.
   d) `transaction_type`: tras (b) la columna desaparece, así que **el enum queda sin
   dependientes** → `DROP TYPE transaction_type` es posible y **resuelve el problema del valor
   `transfer` sin `DROP VALUE`** (Postgres no lo soporta). Requiere verificación previa de
   dependientes en el mismo test de migración; si `DROP TYPE` falla por un dependiente no previsto,
   el fallback aceptado es **dejar el tipo huérfano** (inofensivo, sin columna que lo use) — nunca
   `CREATE TYPE` + re-conversión.
   e) `account_type`, `category kinds` y todo lo de hábitos/productividad: intactos.
2. **`statement_balance`: fallback = `null`.** El campo ya es `Option<Decimal>`; `get_account_handler`
   deja de correr la segunda consulta y `STATEMENT_BALANCE_SQL` se borra. La UI de tarjetas usa
   `balance`/`used_balance`/`available_balance`/`usage_pct`/`alert_level` (ya derivados de
   `balance`). Spec `credit-card-summary` actualizada: el ciclo de factura (`statement_day`,
   `payment_due_day`) **se conserva** como dato útil para alertas de vencimiento; solo muere la
   cifra derivada.
3. **Protección de cuentas con movimientos.** `ACCOUNT_MOVEMENT_COUNT_SQL` (`accounts.rs:585`)
   queda muerta al desaparecer `transactions`. Se reemplaza por guardas sobre FKs **vivas**
   (pagos de deuda / movimientos de ahorro / suscripciones que referencien la cuenta) o se retira
   el bloqueo si ninguna tabla sobreviviente referencia `accounts(id)`; decisión tomada en el spec
   tras enumerar referencias reales con `\d`/catálogo. No se deja un guard que consulte una tabla
   borrada.
4. **MCP.** Borrar 6 tools de transactions (`tools.ts:397-497`) + `list_budgets` (`:988-993`);
   actualizar `mcp-dashboard/README.md:6,136`. Transfer no tenía tools. `api_tokens` scopes siguen
   siendo JSON libre → sin cambio.
5. **`frontend-dashboard` MUST-remain-intact.** `spec.md:11,15,214,218-220` dice que los charts y
   el strip con LEDs de presupuesto "MUST remain intact". Esa cláusula se **revisa y reescribe**
   en S2/S3 (no se rompe en silencio): se reafirma la estructura del strip y el patrón de charts,
   y se retiran explícitamente los artefactos sin fuente (flow/categoría/patrimonio-por-transacciones/
   LED budgets), listándolos por nombre en la spec para que "intact" no vuelva a significar
   "no borrar X".
6. **`objetivo.md` editado en el mismo change.** Se reemplazan las secciones "Transferencias" y
   "Presupuestos" (líneas ~125-152) por: (i) regla de saldo manual por cuenta, (ii) nota de
   reversión con fecha y motivo ("el ledger y los presupuestos no se usaban; el costo de
   mantenimiento superaba el valor; el saldo manual cubre el caso de uso"), (iii) actualización de
   la sección de gráficos financieros para quitar los que dependían de flow mensual. El resto del
   documento no se toca.
7. **Tests de módulos supervivientes.** Ningún test de S3 puede insertar en `transactions`
   (tabla inexistente): los seeds de `debts.rs:1036`, `savings.rs:1088`, `accounts.rs:1191,1253`,
   `migration_0008_credit_cards.rs` se convierten a saldos directos `UPDATE accounts SET
   balance=...` (patrón ya usado en `accounts.rs:1097`). Esto es lo que S0 adelanta.

## 11. Affected areas (índice, del explore §1)

- **Backend:** `src/main.rs:60-100` (+ tests de wiring `protected_routes_live_under_api_prefix`,
  `legacy_root_paths_are_gone`, `p9_finanzas_write_routes_are_wired` — se **reescriben** a rutas
  supervivientes); `src/routes/{transactions,transfers,budgets}.rs`; `src/routes/mod.rs:3,19,20`;
  `src/routes/categories.rs:8,27`; `src/routes/accounts.rs:42-585` (`STATEMENT_BALANCE_SQL`,
  `ACCOUNT_MOVEMENT_COUNT_SQL`, `PatchAccountRequest`, assert `:703`); `src/routes/debts.rs:51,534,547,609,676`;
  `src/routes/savings.rs:53,567,612`; `src/finance/{mod.rs:3,nuevo helpers}`;
  `backend/migrations/0011_*.sql`; `backend/tests/migration_0005_transfer_trigger.rs`,
  `migration_0008_credit_cards.rs`.
- **Frontend:** `components/finance/{TransactionsLedger,TransferHistory,BudgetForm,ManualCapture}.tsx`
  (fuera); `components/ui/BudgetBars.tsx` (fuera); `components/containers/{FinanceScreens,
  DashboardHome,ReportsScreens,ProgressScreens}.tsx` (editar); `components/finance/{FinanceSections,
  AnalysisSection}.tsx`; `components/ui/TelemetryStrip.tsx`; `lib/api/{finance,dashboard}.ts`;
  `lib/finance/finance.ts:81,143-244,279-282,452-537`; `lib/dashboard/transforms.ts:12-26,60-80,
  120-183`; `lib/i18n/es.ts` (~40 claves fuera; **conservar** `finance.paymentTransfer:163` — es el
  método de pago "Transferencia" de suscripciones/deudas, semánticamente distinto);
  `components/productivity/{ProductivityForms,ProductivitySections}.tsx`,
  `components/containers/ProductivityScreens.tsx` (Track B); tests: `finance.test.tsx`,
  `jd-round1.test.tsx`, `s1-capture.test.tsx`, `AnalysisSection.test.tsx`, `finance/finance.test.ts`,
  `dashboard.test.ts`, `transforms.test.ts`, `DashboardHome.test.tsx`, `i18n.test.ts:118`
  (`analysis.tplBudget`), `e2e/sections.spec.ts:33-34`.
- **MCP:** `mcp-dashboard/src/tools.ts`, `mcp-dashboard/README.md:6,136`.
- **Specs:** fuera `finance-transactions`, `finance-transfers`, `finance-budgets`; editar
  `frontend-dashboard`, `dashboard-widgets`, `credit-card-summary`, `finance-accounts`,
  `reports-screen`, `progress-score`, `finance-subscriptions`; `objetivo.md`.

## 12. Edge cases

- **Saldo manual mal escrito:** sin historia no hay cómo detectar el error. Mitigación: el input
  muestra el saldo actual y pide confirmación explícita; rango `|balance| < 10^6` y `scale ≤ 2`
  como 422; el valor es string decimal en el wire (nunca float).
- **Tarjeta con `statement_day` pero sin `statement_balance`:** la UI no debe romperse ni mostrar
  `$0.00` como deuda de ciclo; renderiza "no disponible" (o el bloque simplemente no aparece).
- **Cuenta con FKs vivas:** borrar/archivar una cuenta referenciada por pagos de deuda o movimientos
  de ahorro después de 0011 depende de la guarda reescrita (§10.3).
- **`savings_goal_movements` / `debt_payments` huérfanas de vínculo:** siguen teniendo `amount` y
  fecha propios; el wire `DebtPaymentWire.transaction_id` (`frontend/lib/finance/finance.ts:288`)
  desaparece y los tests de forma se actualizan.
- **Categorías `kind='finance'` existentes en producción:** siguen devolviéndose y editándose;
  ningún picker de finanzas las ofrece. No se borran filas.
- **Cliente MCP con tool cacheada:** recibirá "unknown tool". Aceptado (un solo usuario); se
  documenta en el README.
- **Empty states de Track B:** sección con lista vacía + formulario colapsado debe seguir mostrando
  el botón "Nuevo" (no solo un `EmptyState` sin salida).
- **Editar + colapsado simultáneos:** si se pulsa "Nuevo" y luego "Editar" en otra fila, un solo
  formulario abierto a la vez; el estado cancela el draft anterior.
- **`prefers-reduced-motion`** y foco teclado visibles en el toggle "Nuevo" (no perder el foco al
  colapsar).
- **390px con formulario abierto:** una columna; `sm:` (640px) recupera dos columnas; `col-span-2`
  internos pasan a `sm:col-span-2`.

## 13. Implications / impact

- **Pérdida irreversible** del histórico de `transactions`, `budgets`, `transfers` y de los vínculos
  `transaction_id` de pagos/movimientos, **sin dump** (D3). Es el costo mayor del change y está
  aceptado por el dueño de los datos.
- **Pérdida de funciones de análisis** que el usuario probablemente redescubrirá y echará de menos
  (flow mensual, ahorro mensual, top categorías). Queda explícito en non-goals: si se quiere de
  vuelta, es otro change con diseño de "cómo entra el dinero" resuelto.
- **Reducción de superficie de mantenimiento:** −~4000 líneas de Rust, −4 componentes grandes,
  −7 tools MCP, −3 specs. Menos tests que mantener, menos deriva.
- **Soporte:** no hay (personal). **Otros equipos:** no hay. **Carga de review:** se concentra en
  deletions, no en lógica nueva.
- **Riesgo de contrato:** las specs `frontend-dashboard`/`dashboard-widgets` son la memoria de por
  qué existía el strip; deben reescribirse en el mismo slice que borra el código, o el próximo
  change "restaura" lo borrado.

## 14. Constraints

- `strict_tdd: false` → no se exige RED/GREEN ritual, pero sí: `cargo test` en `backend/` y
  `pnpm test` en `frontend/` verdes por slice, sin bajar cobertura de módulos supervivientes.
- Nunca reescribir migraciones aplicadas (repo rule, assertada).
- `output: export` (Next.js static export): todo client-side, charts con `next/dynamic({ssr:false})`.
- Cap 16 columnas sqlx `FromRow`: no ensanchar `AccountRow` (14 cols) para "recuperar" statement
  balance; por eso §10.2 es `null` y no un sixth derived column.
- No `unwrap()`/`expect()` fuera de tests; `Result`/`AppError` en handlers (rust-best-practices).
- Migración fuera de banda con autocommit → `DROP TYPE`/`CREATE TYPE` no van en bloque transaccional
  (precedente documentado en 0005/0006).
- No tocar `assets`/valuaciones, `habit_logs`, triggers de goals (0007), ni el transporte de tokens.

## 15. Tradeoffs

| Se gana | Se pierde |
|---|---|
| Escribir un número y salir | Auditoría de "cómo llegó este saldo aquí" |
| Finanzas sin secciones muertas | Flow mensual, ahorro, top categorías, presupuestos |
| ~4000 líneas menos de backend | Tests que probaban comportamiento contable fino |
| Productividad usable en el celular | (nada — fix puro) |
| Un solo mecanismo de saldo (simple) | Dos fuentes de verdad ya imposibles (buena fricción) |

La apuesta explícita: **un dashboard personal privado sirve más como espejo del presente que como
libro contable del pasado.** Si eso resulta equivocado, el costo de revertir es re-implementar, no
recuperar datos — y el usuario lo aceptó.

## risks

- **R1 (CRÍTICO, aceptado explícitamente) — pérdida total sin respaldo.** Postgres en Dokploy
  (`192.168.50.120:5434` en dev) pierde filas de `transactions`, `budgets`, `transfers` y dos
  columnas FK, **sin dump previo**. El usuario autorizó la pérdida (D3). Este documento es el
  registro de esa autorización; **antes de correr 0011 contra producción se re-confirma en el
  gate de despliegue** (destructive/publishing: sigue siendo gate humano pese a `auto`).
- **R2 — intermedio congelado.** Cualquier build donde `transactions` ya no exista y `PATCH
  balance` todavía no esté deja todos los saldos en 0 sin forma de corregirlos. Mitigación: ambos
  cambios atómicos en el mismo slice (S3), regla de cadena §9.
- **R3 — huérfanos silenciosos.** Helpers `validate_occurred_on`/`ensure_finance_category` usados
  por módulos supervivientes, seeds de `transactions` dentro de tests de `debts`/`savings`/
  `accounts`, y asserts de wiring en `main.rs` rompen el compile/test antes que cualquier bug.
  Mitigación: S0 existe exactamente para eso, y va primero en Track A.
- **R4 — specs que contradicen el código.** Si S2/S3 borran el strip/reports sin reescribir
  `frontend-dashboard`/`dashboard-widgets`/`credit-card-summary`, el repo queda con MUSTs falsos.
  Mitigación: la edición de specs es criterio de aceptación de cada slice, no tarea final.
- **R5 — contrato MCP roto sin aviso.** 7 tools desaparecen para clientes con token. Mitigación:
  mismo slice, README actualizado; scopes no requieren migración.
- **R6 — `DROP TYPE transaction_type` con dependientes imprevistos.** Mitigación: verificar
  dependientes en el test de 0011 y aceptar el fallback "tipo huérfano" en vez de reinventar el
  enum con `CREATE TYPE` (evita el `DROP VALUE` imposible).
- **R7 — vacío silencioso en dashboard/reportes/progreso.** Un widget sin fuente no es "limpio", es
  un bug percibido. Mitigación §10.5 y criterio de éxito §17: ningún bloque renderiza vacío
  permanente; strip reequilibrado a 5 KPIs con fuente real.
- **R8 — Track B arreglado a ciegas.** El explore no pudo renderizar (sin shell/navegador). Los
  fixes B1/B2 salen de aritmética de clases (segura); el resto no. Mitigación: **primer paso de S4
  = screenshots Playwright 390×844 y 1440×900 antes/después** como evidencia (webapp-testing; medir
  `scrollWidth > clientWidth` y `getBoundingClientRect()` de los inputs de fecha), y no mergear sin
  ellos.
- **R9 — deletion-heavy vs review_budget.** S1/S2/S3 superan 400 líneas cambiadas por naturaleza.
  Mitigación: deletions puras y separadas de lógica nueva, cadenas stacked, y escalamiento explícito
  a `size:exception` (nunca inferido).
- **R10 — reversión de `objetivo.md` mal registrada.** Sin nota de por qué, el próximo agente
  "restaura" transferencias y presupuestos. Mitigación: §10.6 con fecha + motivo + qué se conserva.

## artifacts

- `openspec/changes/2026-09-23-simplify-finance-productivity/proposal.md` — este documento.
- `openspec/changes/2026-09-23-simplify-finance-productivity/explore.md` — mapeo técnico de
  referencia (leído directamente, no duplicado aquí).
- Persistencia de memoria: Engram con `topic_key: sdd/2026-09-23-simplify-finance-productivity/proposal`
  (además del archivo OpenSpec, que es la fuente autoritativa en este store).

## next_recommended

1. **`spec` por slice, en orden S4 → S0 → S1 → S2 → S3.** Empezar por **S4 (Productividad)**: es
   el único sin riesgo de datos, sin dependencias, y entrega valor visible en el celular de
   inmediato. S0 sigue (helpers + fixtures), y S1/S2/S3 en cadena.
2. **Antes de S3, confirmar dos puntos con el usuario** (no bloquean el spec): el gate de
   despliegue de la migración destructiva sin backup (R1) y si prefiere partir S3 en S3a/S3b para
   no inflar el PR.
3. **Si el usuario corrige cualquier supuesto de §2**, reabrir el proposal antes de spec —
   especialmente §2.2 (retirar vs dejar vacíos los widgets de Reportes/Progreso), que cambia el
   trabajo de frontend más que ninguna otra.
4. **Design phase: no requerido.** Con D1/D3/D4 resueltos, el diseño cabe en §10; solo se abriría
   un design si se quisiera rediseñar el strip/reports más allá de retirar bloques sin fuente.

## skill_resolution

`paths-injected` — leídos antes de trabajar los 6 paths exactos indicados por el padre:
`.claude/skills/{rust-best-practices,supabase-postgres-best-practices,next-best-practices,
tailwind-design-system,web-design-guidelines,webapp-testing}/SKILL.md`. Tres salvedades honestas:
(1) `web-design-guidelines` manda hacer fetch de `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`
y esta sesión no tiene tool de red, así que los fixes de Track B se justifican con aritmética de
clases Tailwind + `tailwind-design-system` (breakpoints, targets táctiles) y no con la lista remota;
(2) `supabase-postgres-best-practices` es un índice — sus `references/*.md` no eran necesarios: el
hallazgo DB es de integridad destructiva (drop de tablas/FK/enum), no de rendimiento; (3) **CodeGraph
no ejecutable**: no hay tool de shell en esta sesión para `gentle-ai codegraph init`, y
`.codegraph/` solo contiene `.gitignore`. El mapeo y la verificación de hechos (`accounts.rs`
`statement_balance` + assert de `balance`, migraciones hasta 0010, tools MCP, spans de
`ProductivityScreens.tsx`, patrón 6/6 de `FinanceScreens.tsx`) se hicieron con `grep`/`find`/`read`
sobre rutas concretas. El phase `spec`/`apply` debe correr `codegraph init` si necesita impact
analysis.
