# Proposal — p8-home-pagos (Fase 2: S3 Dashboard completo + S4 Avisos in-app)

> Change: `p8-home-pagos` · Proyecto: landing_personal / personal-dashboard · Fecha: 2026-09-09
> Fase SDD: proposal · Insumos: `exploration.md` + `preproposal.md` (rev 1, 4 decisiones resueltas 2026-09-09)
> Modo: auto · Delivery: ask-on-risk · Budget: 400 · TDD estricto · RDD + Judgment Day previstos
> Handoff: confirmado — **no entrevistar al usuario**; las 4 decisiones de producto ya están cerradas.

## 1. Intent (por qué)

El home actual (`DashboardHome.tsx`) muestra patrimonio, flujo 11 meses, categorías, presupuestos y hábitos, pero **no responde "¿qué debo pagar / qué está vencido / cómo voy este mes?"** de un vistazo. El usuario debe saltar entre Finanzas y Productividad para armar ese cuadro, lo que genera fricción diaria y riesgo de mora (subs, deudas, eventos `payment_due`, tareas vencidas).

**Producto esperado tras el cambio:** abrir el home y en una sola pantalla ver (a) mes desagregado en 3 métricas separadas (ingreso / gasto / ahorro), (b) próximos pagos a 7 días, (c) deudas, subs, tareas, eventos y progreso de metas, (d) campanita con vencidas + próximos cobros accionables, y (e) poder mostrar/ocultar cada bloque desde el propio home, persistido por usuario. Todo en español, solo COP, 100% manual, sin push/email, sin tocar lo ya entregado en Fase 1 (S1/S2).

## 2. Decisiones de producto resueltas (2026-09-09, vinculantes)

| # | Decisión | Resolución del dueño | Efecto en propuesta |
|---|---|---|---|
| 1 | `widget-split` | **3 separados** (ingreso / gasto / ahorro del mes) | El "mes desagregado" son 3 `MetricCard` independientes, cada uno con toggle propio |
| 2 | `upcoming-window` | **7 días** | `UpcomingPayments` y sección "próximos cobros" de la campanita usan ventana fija 7 días naturales (hoy → hoy+7, inclusivo), orden ascendente por fecha |
| 3 | `bell-placement` | **header del home** | La campanita vive en el header de `DashboardHome`, no en `AppShell` rail/tabs ni flotante. `AppShell` no se toca salvo que el header necesite slot/props |
| 4 | `customize-ux` | **toggles en el home** | Cada widget lleva su toggle mostrar/ocultar visible en el home (no pantalla de ajustes). Persiste vía `PATCH /me/preferences { dashboard_layout }` |

## 3. Scope

### In — S3 Dashboard completo (FE-only)

9 widgets en el home (la estimación original de "8" pasa a **9** justamente por la decisión `widget-split = 3 separados**`):

| # | `widget.id` (estable) | UI | `type/size/order` default en `dashboard_layout` | Fuente BE existente | Transform puro nuevo |
|---|---|---|---|---|---|
| 1 | `month-income` | `MetricCard` ingreso del mes | `metric / sm / 10` | `GET /transactions/stats/monthly-flow?from&to` (punto del `monthKey` actual, `type=income`) | `toMonthIncome(flow)` |
| 2 | `month-expense` | `MetricCard` gasto del mes | `metric / sm / 11` | mismo `monthly-flow` + `GET /transactions/stats/by-category?from&to&type=expense` (contexto) | `toMonthExpense(flow)` |
| 3 | `month-savings` | `MetricCard` ahorro del mes (= ingreso − gasto) | `metric / sm / 12` | derivado FE de 1+2, sin endpoint propio | `toMonthSavings(income, expense)` |
| 4 | `upcoming-payments` | lista próximos pagos 7 días | `list / lg / 20` | `GET /subscriptions` + `GET /debts` + `GET /events?from&to` (`kind=payment_due`) | `toUpcomingPayments(subs, debts, events, 7d)` |
| 5 | `pending-debts` | lista deudas pendientes (top 5–7) | `list / md / 21` | `GET /debts` (`status=active`, `pending_amount`) | `toPendingDebts(debts)` |
| 6 | `active-subs` | lista subs activas (top 5–7) | `list / md / 22` | `GET /subscriptions` (`is_active`, `next_billing_on`) | `toActiveSubs(subs)` |
| 7 | `pending-tasks` | lista tareas pendientes (top 5–7) | `list / md / 23` | `GET /tasks?view=today` + `?view=upcoming` (o `GET /tasks` y filtrar FE) | `toPendingTasks(tasks)` |
| 8 | `upcoming-events` | lista próximos eventos 7–14 días (top 5–7) | `list / md / 24` | `GET /events?from&to` (overlap, RFC3339) | `toUpcomingEvents(events)` |
| 9 | `goal-progress` | progreso metas (tareas vinculadas; si hay hueco visual, segunda fila para `savings-goals`) | `chart / md / 30` | `GET /goals` (`progress` trigger-owned) + `GET /savings-goals` | `toGoalProgress(goals, savingsGoals)` |

Reglas S3:

- **Composición 100% FE, cero endpoints BE nuevos.** Se reutilizan tal cual los endpoints listados en `exploration.md §4`. No se crea `GET /dashboard/month-summary` ni `GET /dashboard/upcoming-payments`.
- Definición `upcoming-payments` = unión de (a) subs con `next_billing_on ∈ [hoy, hoy+7]`, (b) deudas `status=active` con `due_date ∈ [hoy, hoy+7]` (si no hay `due_date`, se usa `installment`/próxima cuota cuando exista; si tampoco hay fecha, **no entra** en próximos pagos — sigue visible en `pending-debts`), (c) events `kind=payment_due` con `starts_at ∈ [hoy, hoy+7]`. Orden ascendente por fecha; desempate: deudas > events > subs. Sin fecha válida = excluido de este widget (no inventar fechas).
- `goal-progress`: widget principal = `GET /goals` (metas de tareas, campo `progress` 0–100 solo-lectura). `GET /savings-goals` se muestra como segunda barra/segmento dentro del mismo widget (`Ahorro: saved/goal`) para no consumir un slot extra; si el diseño lo exige, se documenta como sub-bloque `savings-progress` **dentro** de `goal-progress`, no como widget 10.
- Sin paginación en widgets: top 5–7 + enlace "ver en sección" hacia Finanzas/Productividad existentes.
- Personalización: cada widget lee `GET /me → preferences.dashboard_layout.widgets[]`; su toggle hace `PATCH /me/preferences { dashboard_layout: { widgets: [...] } }` con el envelope exacto (`deny_unknown_fields` → 422 si se desvía). Ocultar = no fetch condicional (`useSWR` con `null` key) + no render. Round-trip `GET→PATCH→GET` testeado. Layout por defecto (primera vez / layout vacío): los 9 visibles en el `order` de la tabla.
- Moneda/locale: solo COP, `es-CO` por defecto desde `GET /me`; formato con `formatMoney`, fechas con `formatMonth`/Intl ES. Montos wire son string → coerción solo en `transforms.ts` (`toNumber`), nunca en UI.

### In — S4 Avisos in-app (FE-only, sin push/email)

- **Campanita en el header del home** (`DashboardHome`, no rail/tabs): botón accesible (teclado, foco visible, `aria-label`, `aria-expanded`), badge = count(vencidas) + count(próximos cobros 7d). Dos secciones en el popover/panel: **Vencidas** y **Próximos cobros**. Vacíos con `EmptyState` ES ("Sin vencidas 🎉", "Nada por vencer en 7 días").
- **Vencidas** = `GET /tasks?view=overdue` + deudas `due_date < hoy AND status=active` + events `kind=payment_due` con `starts_at < ahora`. **Próximos cobros** = exactamente la misma unión y ventana que `upcoming-payments` (7 días). Cero endpoints nuevos; deriva de los hooks S3 vía `useNotifications.ts` (`NotificationItem { id, kind, title, due, amount?, source }`).
- **On/off por ítem:** cada fila de aviso tiene su switch. Semántica fijada: el switch por **aviso individual** persiste en `localStorage` (key `p8-notif-muted: { [itemId]: true }`, solo lectura local, no es fuente de verdad compartida); el switch por **categoría/widget** (p.ej. silenciar todas las subs) es el toggle del widget en `dashboard_layout` (ocultar widget ⇒ sus avisos no cuentan para el badge). Sin tabla BE nueva, sin campo `notification_prefs`, sin migración en `me.rs`. Esto respeta "BE ya valida `dashboard_layout`" y evita scope BE.
- Sin push, sin email, sin websocket/polling dedicado; revalidación = SWR existente (`revalidateOnFocus: false`). Sin badge en nav.

### Out / Non-goals (no hacer)

- Tocar Fase 1 (S1/S2 en `main@8f452df`): `FinanceSections`, `ManualCapture`, `TransactionsLedger`, `TransferHistory`, `ProductivitySections`, `ProductivityForms`, tests `s1-capture`/`s2-crud`, y cualquier DTO/trigger BE de Fase 1.
- Cambios BE: no crear agregados, no migrar `user_preferences`, no tocar `backend/src/routes/*` (incluido `me.rs` que ya valida).
- UUIDs, importadores, OCR, sincronización bancaria: todo manual como hoy.
- Multi-moneda (solo COP), multi-idioma (solo ES), presupuestos más allá de aviso, deudas complejas (simple: `pending_amount`/`status` trigger-owned).
- Push/email/SMS, notificaciones push web, sonidos, polling dedicado.
- Nuevas rutas nav (sin `/wealth`); no duplicar lógica de Finanzas/Productividad en el home.

## 4. Affected areas (archivos)

**Tocar (existentes):**

- `frontend/components/containers/DashboardHome.tsx` — único container que crece: grid bento + 9 widgets + header con campanita + toggles. Mantiene `TelemetryStrip`, 3 `MetricCard` base, 4 `WidgetShell` actuales; agrega las nuevas secciones.
- `frontend/lib/api/dashboard.ts` — nuevos hooks `useDebts`, `useSubscriptions`, `useTasks(view)`, `useEvents(from,to)`, `useGoals`, `useSavingsGoals`; nuevas interfaces Wire (montos string); claves SWR con prefijo `dashboard/` para heredar retry; extender `PreferencesWire`/`MeWire` con `dashboard_layout`. Agregar `apiPatch` si no existe (hoy solo `apiGet`+`logout` en `lib/api/client.ts` — verificar en spec).
- `frontend/lib/dashboard/transforms.ts` (+ tests) — transforms puros listados en la tabla S3 + `toOverdueItems`, `toNotificationItems`, `toNotificationCount`. Reutilizar `toNumber`.
- `frontend/lib/i18n/es.ts` (+ `index.ts`, `i18n.test.ts`) — claves `dashboard.*` (9 widgets, toggles, ver-en-sección, vacíos) y `notifications.*` (campanita, vencidas, próximos cobros, mutear, vacíos). ES único, `t(key, vars)` con `{n}`/`{date}`, prohibido hardcodear.
- `frontend/components/ui/*` — reutilizar `MetricCard`, `EmptyState`, `WidgetShell`, `TelemetryStrip`; nuevos `WidgetToggle`, `NotificationBell`, `NotificationList` (o `components/dashboard/widgets/*` + `components/notifications/*` — elige spec, no duplicar en ambos).

**Crear (propuesta):**

- `frontend/components/dashboard/widgets/*.tsx`: `MonthSplit` (o 3 `MetricCard` directos), `UpcomingPayments`, `PendingDebts`, `ActiveSubs`, `PendingTasks`, `UpcomingEvents`, `GoalProgress`.
- `frontend/components/notifications/NotificationBell.tsx` + `useNotifications.ts` (+ tipos en `lib/api/dashboard.ts` o `lib/api/notifications.ts`).
- Tests: `DashboardHome.widgets.test.tsx`, `notifications.test.tsx`, extensión de `transforms.test.ts`, claves en `i18n.test.ts`, e2e `dashboard-widgets.spec.ts` + `notifications.spec.ts`.

**No tocar:** `containers/FinanceScreens.tsx`, `finance/*`, `productivity/*`, `ManualCapture`, ledgers, forms S1/S2, `backend/src/routes/*`.

## 5. Contratos y estándares heredados (vinculantes)

- `frontend-dashboard/spec.md`: TelemetryStrip enums 1:1, Recharts 3 con coerción en borde + code-split `next/dynamic(ssr:false)` por widget de chart, labels mes ES, colores solo por tokens `--color-*` (sin hex, OKLCH azules), tooltips ES con moneda, bento rail→tabs, foco teclado, `prefers-reduced-motion`, `output: export` + Axum `STATIC_DIR` + SPA fallback, bearer `localStorage` + redirect 401 single-flight, nav sin `/wealth`. Los 9 widgets y la campanita heredan todo.
- `frontend-i18n`: diccionario único ES, claves tipadas.
- Specs financieros/productividad/calendar/goals: respetar wire (montos string, `deny_unknown_fields`, 401/404/422), vistas `tasks?view=`, overlap `events?from&to`, `progress`/`pending_amount` solo-lectura.
- Tokens futuristas + `EmptyState` + `WidgetShell` existentes; popover de la campanita debe funcionar con `output: export` (sin SSR, cuidado con `window`).

## 6. Risks (riesgo → mitigación)

1. **N+1 SWR (7 → ~12 lecturas paralelas)** → hooks condicionales (no fetch si widget oculto), reuso de queries de sección, claves `dashboard/*` para retry único; medir en e2e.
2. **`dashboard_layout` 422 por `deny_unknown_fields`** → enviar envelope exacto, test round-trip `GET→PATCH→GET`, fallback a layout default si el BE devuelve layout inválido/vacío.
3. **Ventana 7 días con zonas horarias** → normalizar a día local `es-CO`, inclusiva `[hoy00:00, hoy+7 23:59]`; events con `from/to` en RFC3339; test con borde (hoy, hoy+7, hoy+8 excluido).
4. **Deudas sin `due_date`** → excluidas de próximos pagos/cobros, visibles solo en `pending-debts`; documentado en `EmptyState` y specs.
5. **Confusión metas vs ahorro** → un solo widget `goal-progress` con dos segmentos etiquetados ("Metas" vs "Ahorro"); copy ES explícito.
6. **Regresión Fase 1** → diff confinado a `DashboardHome`+dashboard-lib+i18n; CI debe correr `s1-capture`/`s2-crud` en verde; cualquier toque accidental a Fase 1 = revert.
7. **i18n snapshot** → agregar claves de forma aditiva, actualizar `i18n.test.ts` en el mismo PR.
8. **E2E estático** → campanita/popover sin dependencias SSR; charts con `ssr:false`.

## 7. Rollback

- **FE-only, sin migración:** rollback = revert del/de los commits del change (o feature-flag `p8-home-pagos` si la spec lo introduce) + redeploy estático. No hay datos que migrar hacia atrás: `dashboard_layout` es aditivo y validado por BE preexistente; `localStorage p8-notif-muted` es local y se ignora si la versión anterior no lo lee.
- Criterio de rollback: rompe home actual (Telemetría/métricas/charts), `s1-capture`/`s2-crud` en rojo, o 422 masivo en `PATCH /me/preferences`.

## 8. Success criteria (aceptación verificable)

- [ ] S3: home muestra los 9 widgets con datos reales compuestos de endpoints existentes; mes desagregado en 3 `MetricCard` separados (ingreso/gasto/ahorro = ingreso−gasto).
- [ ] S3: `upcoming-payments` lista unión subs+deudas+`payment_due` en ventana 7 días inclusiva, orden ascendente; deudas sin fecha no aparecen aquí pero sí en `pending-debts`.
- [ ] S3: cada widget tiene toggle en el home; ocultar ⇒ no fetch + no render; persiste en `dashboard_layout` (round-trip `GET→PATCH→GET` verde); recarga mantiene estado.
- [ ] S4: campanita en el header del home con badge = vencidas + próximos 7d (descontando muteados locales y widgets ocultos); panel con secciones Vencidas / Próximos cobros; vacíos ES correctos.
- [ ] S4: on/off por aviso individual (localStorage) + por widget (layout); cero push/email; cero endpoints BE nuevos.
- [ ] Restricciones: solo COP, ES único, montos string→number solo en transforms, tokens sin hex, `prefers-reduced-motion`, teclado/foco, `output: export` funcional.
- [ ] No-regresión: Fase 1 intacta (`8f452df` + `s1-capture`/`s2-crud` verdes), specs vinculantes respetadas, TDD (tests nuevos en rojo→verde), e2e widgets+notificaciones verdes.

## 9. Plan de specs/diseño siguiente (no implementar aquí)

- Deltas en `openspec/changes/p8-home-pagos/specs/`: `dashboard-widgets/spec.md` (9 widgets + layout + toggles) y `notifications-inapp/spec.md` (campanita + vencidas + cobros + mute). Sin editar `openspec/specs/*`.
- Diseño fijará: catálogo final id→`type/size/order`, copy ES exacto, grid bento, UX del popover, key `localStorage`, y enlace "ver en sección" por widget.
- Tasks (TDD): transforms → hooks → widgets → bell → toggles/persistencia → i18n → e2e.

## 10. Supuestos explícitos que la propuesta cierra

1. "8 widgets" → **9** por `widget-split: 3 separados`; no se elimina ningún bloque del encargo.
2. Ventana fija **7 días naturales inclusiva** para pagos y cobros; `upcoming-events` puede ampliar a 14 días solo visualmente (lo fija diseño) sin afectar la campanita.
3. Campanita **solo header del home**; fuera del home no hay badge.
4. Toggles **solo en el home**; sin pantalla de ajustes.
5. Mute por ítem = `localStorage` local; mute por categoría = ocultar widget en `dashboard_layout`. Sin BE nuevo.
