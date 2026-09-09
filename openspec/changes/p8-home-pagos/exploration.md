# Exploración — p8-home-pagos (Fase 2: S3 Dashboard + S4 Avisos in-app)

## 1. Objetivo del change
- **S3 Dashboard completo:** 8 widgets faltantes del home + personalización mostrar/ocultar vía `PATCH /me/preferences dashboard_layout` (BE ya valida en `backend/src/routes/me.rs`).
- **S4 Avisos in-app:** campanita en AppShell + lista de vencidas + próximos cobros (subs + deudas + events `payment_due`), on/off por ítem. **Sin push/email.**
- **Límite duro:** no tocar Fase 1 (S1/S2 en `main`, commit `8f452df`): `FinanceSections`, `ManualCapture`, `TransactionsLedger`, `TransferHistory`, `ProductivitySections`, `ProductivityForms` y sus tests `s1-capture`, `s2-crud`.

## 2. Estado actual del home (base para S3)
`frontend/components/containers/DashboardHome.tsx` (~230 líneas, `"use client"`):
- 7 lecturas SWR en paralelo: `useNetWorth`, `useMonthlyFlow(11 meses)`, `useSpendByCategory(mes actual)`, `useBudgets`, `useHabitsToday`, `useAccounts`, `usePreferences`. Loading = `some(isLoading)`; error = panel ES + retry con `mutate(key => key.startsWith("dashboard/"))`.
- Render actual: `TelemetryStrip` (6 LEDs) + 3 `MetricCard` + 4 `WidgetShell` (FlowChart, CategoryDonut, BudgetBars, Hoy/hábitos). Todo ES vía `t()`; charts code-split con `next/dynamic(ssr:false)`.
- Coerción dinero-string→number solo en `lib/dashboard/transforms.ts` (+ `lib/api/money.ts`); UI pura recibe numbers. Tests: `DashboardHome.test.tsx` (mockea `@/lib/api/dashboard` + `next/dynamic`), `transforms.test.ts`, `TelemetryStrip.test.tsx`, `charts.test.tsx`, `e2e/dashboard.spec.ts`.

## 3. Mapa de archivos a tocar / crear

### Tocar (existentes)
| Archivo | Cambio S3/S4 |
|---|---|
| `frontend/components/containers/DashboardHome.tsx` | Agregar 8 widgets + grid bento + personalización (leer `dashboard_layout`, toggle → `PATCH`). Es el único container que crece; no duplicar lógica en Finance/Productivity. |
| `frontend/lib/api/dashboard.ts` | Nuevos hooks: `useDebts`, `useSubscriptions`, `useTasks(view)`, `useEvents(from,to)`, `useGoals`, `useSavingsGoals`, `useMonthSummary` (si se crea endpoint) o `useUpcomingPayments`. Nuevas interfaces Wire (montos string). Claves SWR con prefijo `dashboard/` para que el retry existente las cubra. Agregar `apiPatch` para preferencias si no existe (hoy solo `apiGet` + `logout` en `lib/api/client.ts` — verificar). Extender `PreferencesWire`/`MeWire` con `dashboard_layout`. |
| `frontend/lib/dashboard/transforms.ts` (+ `.test.ts`) | Nuevos transforms puros: `toMonthSummary(flow|rows)`, `toUpcomingPayments(subs, debts, events)`, `toOverdueItems(tasks, debts, events)`, `toActiveSubs`, `toPendingDebts`, `toPendingTasks`, `toUpcomingEvents`, `toGoalProgress`. Reutilizar `toNumber`, nunca parsear en UI. |
| `frontend/components/layout/AppShell.tsx` | S4: campanita (botón + badge + popover/panel, accesible teclado, skip-link ya existe). Hoy solo rail izq + tabs bottom + logout; no hay header. Decidir ubicación: header-home vs rail vs flotante. |
| `frontend/lib/i18n/es.ts` (+ `index.ts`, `i18n.test.ts`) | Nuevas claves `dashboard.*` (8 widgets, personalizar, mostrar/ocultar), `notifications.*` (campanita, vencidas, próximos cobros, on/off, vacíos). Single-locale ES; `t(key, vars)` con `{n}`/`{date}`. |
| `frontend/components/ui/*` | Reutilizar `MetricCard`, `EmptyState`, `TelemetryStrip`; probable nuevo `WidgetToggle`, `NotificationBell`, `NotificationList` (o `widgets/` nuevo — ver abajo). Respetar tokens `--color-*`, sin hex, `prefers-reduced-motion`, foco visible. |

### Crear (propuesta)
- `frontend/components/dashboard/widgets/*.tsx` (o extender `containers/DashboardHome.tsx` con subcomponentes): `MonthSplit` (ingreso/gasto/ahorro), `UpcomingPayments`, `PendingDebts`, `ActiveSubs`, `PendingTasks`, `UpcomingEvents`, `GoalProgress`. Alternativa: todo inline en container si se quiere diff chico — propuesta debe elegir.
- `frontend/components/notifications/*` (S4): `NotificationBell.tsx`, `useNotifications.ts` (deriva vencidas + próximos cobros de los hooks S3, cero endpoints nuevos).
- `frontend/lib/api/notifications.ts` o dentro de `dashboard.ts`: tipos `NotificationItem { id, kind, title, due, amount?, source }`.
- Tests: `DashboardHome.widgets.test.tsx`, `notifications.test.tsx`, extends `transforms.test.ts`, claves en `i18n.test.ts`, e2e `dashboard-widgets.spec.ts` / `notifications.spec.ts`.

### No tocar
- `containers/FinanceScreens.tsx`, `finance/*`, `productivity/*`, `ManualCapture`, ledgers, forms S1/S2.
- `backend/src/routes/me.rs` (ya valida `dashboard_layout`); resto de `backend/src/routes/*` salvo que la propuesta cree un agregado (ver §4).

## 4. Endpoints BE: existen vs faltan

### Ya existen (reutilizar tal cual, componer en FE)
| Necesidad S3/S4 | Endpoint | Notas |
|---|---|---|
| Preferencias + layout | `GET /me`, `PATCH /me/preferences` | Validado: `currency/locale/timezone/dashboard_layout`. Layout = `{ widgets: [{ id 1–64, type: metric\|chart\|list\|ledger\|heatmap, order ≥0, size: sm\|md\|lg }] }`, ≤32, `deny_unknown_fields` → 422. Ver `WIDGET_TYPES/SIZES`, `validate_dashboard_layout`. |
| Patrimonio | `GET /net-worth` | Ya usado. |
| Flujo / categorías | `GET /transactions/stats/monthly-flow?from&to`, `GET /transactions/stats/by-category?from&to&type=expense` | Rango validado en `transactions.rs::validate_stats_range`. Base para mes desagregado. |
| Cuentas/tarjetas | `GET /accounts` (+ `alert_level`) | Ya usado. |
| Presupuestos | `GET /budgets`, `GET /budgets/{id}/status` | Ya usado. |
| Hábitos hoy | `GET /habits/today` | Ya usado. |
| Deudas pendientes | `GET /debts` | `pending_amount`, `status active`, `due_date`, `installment`. Trigger-own `pending_amount/status`; sin PATCH. |
| Subs activas | `GET /subscriptions` | `is_active`, `next_billing_on`, `price`, `frequency`. PATCH solo `is_active`. |
| Tareas pendientes/vencidas | `GET /tasks`, `GET /tasks?view=today\|upcoming\|overdue\|done` | Vistas por `due_date` + `completed_at IS NULL`. Prioridad/status enums. |
| Próximos eventos + `payment_due` | `GET /events`, `GET /events?from&to` (RFC3339, overlap `starts_at < to AND (ends_at IS NULL OR ends_at > from)`) | `kind ∈ event,appointment,reminder,payment_due,goal_milestone,habit_reminder`; links a 6 dominios. |
| Progreso metas | `GET /goals` (campo `progress` trigger-owned 0–100), `GET /savings-goals` (+ `saved/completed` derivados de movements) | `progress` nunca escribible (422). Ahorro vs metas de tareas: dos fuentes distintas. |

### Faltan (decisión de propuesta)
1. **Agregación mes desagregada (ingresos/gastos/ahorro):** hoy se deriva en FE de `monthly-flow` (punto del `monthKey` actual). No hay `GET /dashboard/month-summary`. Opciones: (a) reutilizar `monthly-flow` + `by-category` sin BE nuevo (recomendado, cero backend); (b) nuevo endpoint agregado. Si (b), nuevo handler + ruta en `main.rs::api_routes` + tests `transactions.rs`.
2. **Próximos pagos unificado:** no existe. Fuentes: `subscriptions.next_billing_on` + `debts.due_date/pending_amount` + `events kind=payment_due`. Opciones: (a) composición 100% FE con los 3 hooks (recomendado para Fase 2, respeta "no tocar Fase 1" y evita migración); (b) `GET /dashboard/upcoming-payments` BE. Ventana (7/14/30 días) y orden han de definirse en propuesta.
3. **Persistencia avisos on/off por ítem + leídos:** no existe tabla/campo `notifications`. Opciones: (a) reusar `dashboard_layout.widgets` (toggle = mostrar/ocultar widget+aviso, cero BE); (b) `localStorage` solo-lectura local (pierde multi-dispositivo); (c) nuevo campo `notification_prefs` en `user_preferences` + migración + validación en `me.rs` (más BE, fuera del "BE ya valida"). S4 dice "on/off por ítem" — la propuesta debe mapear ítem→fuente (¿por aviso individual o por categoría subs/deudas/events/vencidas?).
4. **Badge campanita:** derivado FE (count vencidas + próximos N días). Sin websocket/polling dedicado; revalidación SWR existente (`revalidateOnFocus: false`).

## 5. Límites con specs existentes (`openspec/specs/`)
- `frontend-dashboard/spec.md` (vinculante): TelemetryStrip con enums 1:1 (`alert_level ok/warn/high`, `status ok/warn/over`); Recharts 3 con coerción en borde, code-split por ruta, labels mes en español, colores por tokens, tooltips ES con moneda; bento rail→tabs, foco teclado, `prefers-reduced-motion`; `output: export` + Axum `STATIC_DIR` + SPA fallback; bearer `localStorage` + redirect 401 single-flight; tokens OKLCH azules sin hex; nav sin `/wealth`. **Los 8 widgets y la campanita deben heredar todo esto.**
- `frontend-i18n`: diccionario único ES, claves tipadas `EsKey`; prohibido hardcodear strings.
- `finance-transactions / finance-budgets / finance-accounts / finance-subscriptions / finance-debts / finance-savings / finance-transfers / finance-assets / credit-card-summary`: contratos wire (montos string, `deny_unknown_fields`, 401/404/422) — los hooks nuevos deben tipar igual, sin cambiar DTOs.
- `task-management`: vistas `today/upcoming/overdue/done`; `completed_at` trigger-owned.
- `calendar-events`: query range overlap + `payment_due`; ownership 6 dominios.
- `goal-tracking` (+ `finance-savings`): `progress` trigger-owned; distinguir "progreso metas" (tareas vinculadas) de "metas de ahorro" (movements) — la propuesta debe fijar cuál widget muestra qué (o ambos).
- `session-auth / edge-security-headers / health-checks / backend-base`: 401, CORS, probes intactos.
- `openspec/changes/p8-home-pagos/specs/` está vacío: la propuesta creará deltas (`dashboard-widgets`, `notifications-inapp`) sin editar `openspec/specs/*` directamente.

## 6. Decisiones de producto confirmadas vs supuestos

### Confirmadas (del encargo)
1. Alcance Fase 2 = S3 + S4; S1/S2 congelados en `main@8f452df`.
2. S3 = 8 widgets + mostrar/ocultar persistido en `dashboard_layout` (BE listo, FE lo consume).
3. S4 = campanita + vencidas + próximos cobros (subs + deudas + events `payment_due`), toggle on/off por ítem.
4. Sin push/email en S4.
5. Archivos eje: `DashboardHome.tsx`, `transforms`, `dashboard.ts` hooks, `AppShell` campanita, `es.ts`.

### Supuestos explícitos (a confirmar en propuesta)
1. Los "8 widgets" son: (1) mes desagregado ingreso/gasto/ahorro como **un** widget, (2) próximos pagos, (3) deudas pendientes, (4) subs activas, (5) tareas pendientes, (6) próximos eventos, (7) progreso metas, (8) hueco a definir — **alternativa:** desagregado cuenta como 3 y sobra uno. El encargo lista 9 ítems nominales para 8 slots; propuesta fija el mapa id→slot.
2. "Próximos pagos" = unión subs (`next_billing_on`) + deudas (`due_date` o `installment` cuando no hay fecha) + events `payment_due` futuros; ventana default 30 días ordenada por fecha ascendente.
3. "Vencidas" = `tasks?view=overdue` + deudas `due_date < hoy AND status=active` + events `payment_due` con `starts_at < ahora`. Sin badge en nav, solo campanita.
4. Toggle personalización y on/off avisos comparten `dashboard_layout.widgets` (un switch por widget; ocultar widget silencia sus avisos). Sin tabla nueva ni `localStorage` como fuente de verdad.
5. IDs de widget estables en ES: `month-split`, `upcoming-payments`, `pending-debts`, `active-subs`, `pending-tasks`, `upcoming-events`, `goal-progress`, +1 a definir (p.ej. `savings-progress` separado de `goal-progress`).
6. Tipos `dashboard_layout` mapeados: mes/resumen→`metric`/`ledger`, próximos pagos/deudas/subs/tareas/eventos→`list`, progreso metas→`heatmap` o `chart`. `size` default `md`, listas largas `lg`.
7. Campanita vive en `AppShell` visible en rail + tabs móvil (o header del home si se prefiere no tocar nav); panel con dos secciones (Vencidas / Próximos cobros), cada fila con on/off; vacíos con `EmptyState` ES.
8. Moneda/locale de montos en widgets/avisos = `GET /me` (`es-CO`/`COP` default), formato vía `formatMoney`; fechas vía `formatMonth`/Intl ES.
9. Sin paginación en widgets (top 5–7 + "ver en sección" linkeando a Finanzas/Productividad existentes); queries nuevas con mismas claves `dashboard/*` para heredar retry.

## 7. Riesgos / bordes
- N+1 SWR: pasar de 7 a ~12 lecturas paralelas; mitigar con `useSWR` condicional + reuso de `GET /tasks`, `/events?from&to`, `/debts`, `/subscriptions`, `/goals` ya paginados en sus secciones.
- `dashboard_layout` con `deny_unknown_fields`: el FE debe enviar el envelope exacto `{ widgets: [...] }` o recibe 422; testear round-trip `GET→PATCH→GET`.
- `events?from&to` exige RFC3339 y predicado overlap; `tasks?view=` 422 ante vista desconocida; `goals.progress` y `debts.pending_amount/status` son solo-lectura.
- i18n: cada widget/aviso necesita claves nuevas; `i18n.test.ts` puede exigir snapshot del diccionario.
- E2E estático (`output: export`): la campanita/popover debe funcionar sin SSR (cuidado con `window` en `chartToken`-like helpers).

## 8. Entradas para la propuesta (siguiente fase)
- Fijar lista cerrada de 8 `widget.id` + `type/size/order` default + copy ES.
- Elegir composición FE vs endpoints BE nuevos para month-summary y upcoming-payments (recomendación explore: FE-only).
- Definir semántica on/off por ítem (por widget vs por aviso) y dónde persiste.
- Deltas de spec a crear en `openspec/changes/p8-home-pagos/specs/`.
