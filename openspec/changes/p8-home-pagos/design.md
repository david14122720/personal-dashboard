# Design — p8-home-pagos (Fase 2: S3 Dashboard completo + S4 Avisos in-app)

> Change: `p8-home-pagos` · Proyecto: landing_personal / personal-dashboard · Fecha: 2026-09-09
> Fase SDD: design · Insumos: `proposal.md` (vinculante) + `exploration.md` + `preproposal.md` rev 1
> Decisiones producto cerradas 2026-09-09: `widget-split=3 separados` · `upcoming-window=7 días` · `bell-placement=header del home` · `customize-ux=toggles en el home`
> Modo: FE-only, cero BE nuevo · TDD estricto · RDD + Judgment Day previstos

## 1. Overview

El home (`DashboardHome.tsx`) pasa de mostrar telemetría histórica a responder
"¿qué debo pagar / qué está vencido / cómo voy este mes?" en una sola pantalla,
sin tocar Fase 1 (S1/S2 en `main@8f452df`) y sin crear endpoints BE.

- **S3:** 9 widgets componibles con datos reales de endpoints existentes,
  mes desagregado en 3 `MetricCard` independientes, cada uno con toggle
  mostrar/ocultar persistido en `dashboard_layout`.
- **S4:** campanita en el **header del home** (no en `AppShell` rail/tabs,
  no flotante) con secciones Vencidas / Próximos cobros 7d, mute por ítem
  en `localStorage` + mute por categoría vía ocultar widget.
- Todo ES único, solo COP, manual, sin push/email/websocket/polling dedicado.

Este diseño fija estructura de archivos, contratos TS, flujo de datos,
persistencia, grid, a11y y plan TDD. Las specs (`dashboard-widgets`,
`notifications-inapp`) detallan criterios Given/When/Then; las tasks
ordenan el TDD.

## 2. Architecture decisions

| ID | Decisión | Alternativas descartadas | Por qué |
|---|---|---|---|
| AD-1 | **Composición 100% FE, cero endpoints BE nuevos.** No `GET /dashboard/month-summary` ni `GET /dashboard/upcoming-payments`. | (b) agregados BE en `transactions.rs` + `main.rs::api_routes` | Respeta límite "no tocar BE", evita migraciones, reutiliza `monthly-flow`, `debts`, `subscriptions`, `tasks?view=`, `events?from&to`, `goals`, `savings-goals` ya validados. Costo N+1 SWR se mitiga con fetch condicional (AD-6). |
| AD-2 | **Widgets en `frontend/components/dashboard/widgets/*.tsx`, no inline.** `DashboardHome.tsx` queda como composer (header + grid + toggles). | Todo inline en el container (diff chico pero archivo >800 líneas, intestable) | Cada widget <150 líneas, props tipadas, testeable aislado con mocks de hooks; container no duplica lógica de Finanzas/Productividad. |
| AD-3 | **Notificaciones en `frontend/components/notifications/` con tríada `NotificationBell` + `NotificationList` + `useNotifications`.** Tipos en `lib/api/dashboard.ts` (no nuevo `notifications.ts`). | Lógica de bell dentro de `DashboardHome`; tipos en archivo separado | Bell (botón+badge+popover) y List (secciones+filas+switches) separan interacción vs render; `useNotifications` deriva de hooks S3 sin fetch propio; co-ubicar tipos con el resto de wires evita fragmentación. |
| AD-4 | **Transforms puros en `lib/dashboard/transforms.ts`.** Única coerción string→number vía `toNumber`; UI recibe numbers. | Parsear en UI o en `lib/api/dashboard.ts` | Regla vigente del repo (boundary explícito), testeable sin SWR/jsdom pesado, reutilizable por widgets y bell. |
| AD-5 | **`apiPatch` genérico en `lib/api/client.ts`** (espejo de `apiPost`: Bearer + 401 single-flight + `toApiError`), usado solo para `PATCH /me/preferences`. | `fetch` ad-hoc en el hook; reusar `apiPost` con override de método | Un solo punto para auth/401/JSON; `apiGet`+`apiPost`+`apiDelete` ya existen, falta `PATCH` — verificado en código actual. |
| AD-6 | **Fetch condicional por widget visible.** `useSWR(key=null)` cuando el widget está oculto → no fetch + no render. | Fetch-all siempre + `display:none` | Pasa de ~7 a ~13 lecturas paralelas solo cuando todo visible; ocultar reduce carga y badge. Claves con prefijo `dashboard/` heredan retry existente `mutate(k => k.startsWith("dashboard/"))`. |
| AD-7 | **Persistencia dual explícita:** toggles widget → `PATCH /me/preferences { dashboard_layout }` (fuente de verdad compartida); mute por aviso individual → `localStorage key=p8-notif-muted` (solo local). | (c) `notification_prefs` BE + migración en `me.rs`; (b) todo en `localStorage` | `me.rs` ya valida `dashboard_layout` (`deny_unknown_fields`→422); crear prefs BE expande scope. `localStorage` por ítem es suficiente porque el mute individual no necesita multi-dispositivo; el mute por categoría sí (ocultar widget). |
| AD-8 | **Grid bento 12-col existente + campanita en header del home.** `AppShell` **no se toca.** | Bell en rail/tabs de `AppShell`, flotante, o ruta nueva | Decisión `bell-placement=header del home` es vinculante; evita regresión nav (rail→tabs, skip-link, `output:export`). Header del home = fila `h1 + subtítulo + Bell` dentro de `DashboardHome`. |
| AD-9 | **Textos solo en `lib/i18n/es.ts`, claves tipadas `EsKey`.** Cero hardcode. | Strings inline / segundo locale | Spec `frontend-i18n` vinculante: diccionario único, `t(key,vars)` con `{n}`/`{date}`. |
| AD-10 | **Rollback por revert.** Sin flag permanente; flag `p8-home-pagos` solo si la spec lo pide como temporal. | Migración / flag BE | FE-only sin migración: revert de commits + redeploy estático restaura home anterior; `dashboard_layout` aditivo se ignora en versión vieja; `p8-notif-muted` local se ignora. |

## 3. Data flow

```
BE existente ── apiGet/apiPatch (client.ts) ── SWR hooks (dashboard.ts, key dashboard/*)
  │  GET /transactions/stats/monthly-flow?from&to ──┐
  │  GET /transactions/stats/by-category ───────────┼─→ useMonthlyFlow ─→ toMonthIncome/Expense/Savings ─→ 3× MetricCard
  │  GET /subscriptions ────────────────────────────┼─→ useSubscriptions ─┐
  │  GET /debts ────────────────────────────────────┼─→ useDebts ─────────┼─→ toUpcomingPayments ─→ UpcomingPayments + useNotifications ─→ Bell/List
  │  GET /events?from&to (RFC3339, kind=payment_due)┼─→ useEvents ────────┘                                    (próximos 7d)
  │  GET /tasks?view=today|upcoming|overdue ────────┼─→ useTasks(view) ──→ toPendingTasks / toOverdueItems ───┘ + PendingTasks
  │  GET /events?from&to (todos kinds) ─────────────┼─→ useEvents ───────→ toUpcomingEvents ─→ UpcomingEvents
  │  GET /debts ────────────────────────────────────┼─→ toPendingDebts ──→ PendingDebts
  │  GET /subscriptions ────────────────────────────┼─→ toActiveSubs ────→ ActiveSubs
  │  GET /goals + GET /savings-goals ───────────────┼─→ useGoals/useSavingsGoals ─→ toGoalProgress ─→ GoalProgress (2 segmentos)
  │  GET /me ───────────────────────────────────────┴─→ usePreferences ──→ locale/currency + dashboard_layout ─→ visibilidad + toggles ─→ PATCH /me/preferences
localStorage p8-notif-muted ─→ useNotifications (filtro local, no fetch)
```

Ventanas y normalización (vinculante):

- **Próximos pagos/cobros 7d:** `[hoy 00:00 local, hoy+7 23:59 local]` inclusivo,
  día local `es-CO`. Unión: (a) subs `next_billing_on ∈ ventana`,
  (b) deudas `status=active AND due_date ∈ ventana` (sin `due_date` → excluida
  aquí, visible solo en `pending-debts`; si existe cuota/`installment` con fecha
  se usa esa fecha, nunca se inventa), (c) events `kind=payment_due AND
  starts_at ∈ ventana`. Orden asc por fecha; desempate: deudas > events > subs.
- **Vencidas:** `tasks?view=overdue` + deudas `due_date < hoy AND status=active` +
  events `kind=payment_due AND starts_at < ahora`.
- **Badge:** `count(vencidas visibles) + count(próximos 7d visibles)`,
  descontando muteados locales y widgets ocultos (ocultar widget ⇒ sus avisos
  no cuentan).
- **`upcoming-events` widget:** misma fuente `GET /events?from&to` pero ventana
  visual ampliable a 14d (lo fija la spec); la campanita usa siempre 7d.
- **Mes desagregado:** punto `monthKey` actual de `monthly-flow`;
  `ahorro = ingreso − gasto` derivado FE (`toMonthSavings`), sin endpoint propio.
- **Moneda:** wire string → `toNumber` solo en transforms; formato `formatMoney`
  con `locale/currency` de `GET /me` (default `es-CO`/`COP`); fechas
  `formatMonth`/Intl ES.

## 4. File changes

### 4.1 Tocar (existentes)

| Archivo | Cambio |
|---|---|
| `frontend/components/containers/DashboardHome.tsx` | Único container que crece. Header-row (`h1` + subtítulo + `<NotificationBell/>`), grid bento 12-col con 9 widgets + existentes (`TelemetryStrip`, FlowChart, CategoryDonut, BudgetBars, Hoy/hábitos), `WidgetToggle` por widget, loading `some(isLoading)` extendido a nuevas queries visibles, error panel + retry `dashboard/` existente. No duplicar lógica de sección. |
| `frontend/lib/api/client.ts` | Agregar `apiPatch<T>(path, body, init?)` espejo de `apiPost` (JSON + Bearer + 401 single-flight + `toApiError`). Tests en `client.test.ts`. |
| `frontend/lib/api/dashboard.ts` | Nuevos wires (montos `string\|number`) + hooks: `useDebts`, `useSubscriptions`, `useTasks(view)`, `useEvents(from,to)`, `useGoals`, `useSavingsGoals`; extender `PreferencesWire`/`MeWire` con `dashboard_layout`; hook `useUpdateLayout` (`apiPatch` + `mutate("dashboard/me")` optimista con rollback en error). Claves `dashboard/debts`, `dashboard/subscriptions`, `dashboard/tasks?view=…`, `dashboard/events?from&to`, `dashboard/goals`, `dashboard/savings-goals`. Mismo `config { revalidateOnFocus:false }`. Tipos `NotificationItem { id, kind: "task"\|"debt"\|"event"\|"subscription", title, due: string, amount?: number, source: string }` aquí (no archivo nuevo). |
| `frontend/lib/dashboard/transforms.ts` (+ `transforms.test.ts`) | Nuevos puros: `toMonthIncome(flow, monthKey)`, `toMonthExpense(flow, monthKey)`, `toMonthSavings(income, expense)`, `toUpcomingPayments(subs, debts, events, now)` (ventana 7d, orden+desempate), `toPendingDebts`, `toActiveSubs`, `toPendingTasks`, `toUpcomingEvents`, `toGoalProgress(goals, savingsGoals)`, `toOverdueItems(tasks, debts, events, now)`, `toNotificationItems(overdue, upcoming)`, `toNotificationCount(items, muted, visibleSources)`. Reutilizar `toNumber`; helpers fecha local `startOfDay/addDays` internos testeados en borde (hoy, hoy+7 incluido, hoy+8 excluido). |
| `frontend/lib/i18n/es.ts` (+ `index.ts` sin cambio de forma, `i18n.test.ts`) | Claves aditivas `dashboard.*` (9 widgets, toggles, ver-en-sección, vacíos) y `notifications.*` (bell, vencidas, próximos, mutear, vacíos). Ver §6. |
| `frontend/components/ui/*` | Reutilizar `MetricCard`, `EmptyState`, `WidgetShell` (extender con prop `action` para el toggle sin romper firma), `TelemetryStrip`. Nuevo `WidgetToggle.tsx` (switch accesible) en `ui/` por ser genérico. Charts siguen `next/dynamic(ssr:false)`; `GoalProgress` usa barras/divs (sin Recharts) salvo que la spec exija chart — entonces también `ssr:false`. |

### 4.2 Crear

```
frontend/components/dashboard/widgets/
  MonthIncomeCard.tsx        # thin wrapper MetricCard (o directo en container — spec elige; default: directo, sin archivo)
  MonthExpenseCard.tsx       # idem
  MonthSavingsCard.tsx       # idem
  UpcomingPayments.tsx       # list lg
  PendingDebts.tsx           # list md
  ActiveSubs.tsx             # list md
  PendingTasks.tsx           # list md
  UpcomingEvents.tsx         # list md
  GoalProgress.tsx           # chart md, 2 segmentos: Metas (goals.progress) + Ahorro (saved/goal); sub-bloque savings-progress DENTRO, no widget 10
frontend/components/notifications/
  NotificationBell.tsx       # botón + badge + popover/panel (2 secciones), teclado, aria-expanded, foco visible
  NotificationList.tsx       # secciones Vencidas/Próximos + filas con switch por ítem + EmptyState
  useNotifications.ts        # deriva de hooks S3 + localStorage p8-notif-muted; expone { items, overdue, upcoming, count, muted, toggleMute }
frontend/components/ui/WidgetToggle.tsx
Tests:
  frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx
  frontend/components/notifications/__tests__/notifications.test.tsx
  extends lib/dashboard/transforms.test.ts, lib/api/client.test.ts, lib/i18n/i18n.test.ts
  e2e/dashboard-widgets.spec.ts, e2e/notifications.spec.ts
```

Nota `MonthSplit`: por `widget-split=3 separados` no existe componente `MonthSplit`;
son 3 `MetricCard` directos con `widget.id` propios (`month-income`,
`month-expense`, `month-savings`). Si la spec quiere un wrapper compartido,
será presentacional sin lógica.

### 4.3 No tocar (Fase 1 + BE)

`containers/FinanceScreens.tsx`, `finance/*`, `productivity/*`, `ManualCapture`,
ledgers, forms S1/S2, tests `s1-capture`/`s2-crud`, `backend/src/routes/*`
(incluido `me.rs`). Cualquier diff accidental fuera de §4.1–4.2 = revert.
CI debe correr `s1-capture`/`s2-crud` en verde.

## 5. Contracts

### 5.1 `dashboard_layout` (BE ya valida — no cambiar)

```ts
type WidgetType = "metric" | "chart" | "list" | "ledger" | "heatmap";
type WidgetSize = "sm" | "md" | "lg";
interface DashboardWidgetPref { id: string; type: WidgetType; order: number; size: WidgetSize; }
interface DashboardLayout { widgets: DashboardWidgetPref[]; } // ≤32, id 1–64 chars
// GET /me → { preferences: { currency_code, locale, timezone?, dashboard_layout?: DashboardLayout } }
// PATCH /me/preferences body EXACTO → { dashboard_layout: { widgets: [...] } } (deny_unknown_fields → 422 si se desvía)
```

Catálogo default (primera vez / layout vacío o inválido → los 9 visibles):

| `widget.id` | `type/size/order` | Enlace "ver en sección" |
|---|---|---|
| `month-income` | `metric/sm/10` | Finanzas |
| `month-expense` | `metric/sm/11` | Finanzas |
| `month-savings` | `metric/sm/12` | Finanzas |
| `upcoming-payments` | `list/lg/20` | Finanzas |
| `pending-debts` | `list/md/21` | Finanzas → deudas |
| `active-subs` | `list/md/22` | Finanzas → subs |
| `pending-tasks` | `list/md/23` | Productividad → tareas |
| `upcoming-events` | `list/md/24` | Productividad → eventos |
| `goal-progress` | `chart/md/30` | Productividad → metas |

Ocultar = quitar de `widgets[]` (o `visible:false` solo si BE lo acepta —
verificar en spec contra `validate_dashboard_layout`; default: quitar).
Toggle hace `PATCH` optimista con rollback en 422 + fallback a default si
`GET` devuelve layout inválido/vacío. Round-trip `GET→PATCH→GET` testeado.

### 5.2 Wires nuevos (montos string, `deny_unknown_fields` heredado)

```ts
interface DebtWire { id: string; pending_amount: string|number; status: string; due_date?: string|null; installment?: string|number|null; name?: string; }
interface SubscriptionWire { id: string; name: string; price: string|number; is_active: boolean; next_billing_on?: string|null; frequency?: string; }
interface TaskWire { id: string; title: string; status: string; priority?: string; due_date?: string|null; goal_id?: string|null; }
interface EventWire { id: string; title: string; kind: string; starts_at: string; ends_at?: string|null; }
interface GoalWire { id: string; name: string; progress: number; status: string; } // progress solo-lectura
interface SavingsGoalWire { id: string; name: string; goal: string|number; saved: string|number; completed?: boolean; }
```

### 5.3 `useNotifications` + `localStorage`

```ts
const MUTED_KEY = "p8-notif-muted"; // localStorage: Record<itemId, true>
interface NotificationItem { id: string; kind: "task"|"debt"|"event"|"subscription"; title: string; due: string; amount?: number; source: string; }
// useNotifications(): { overdue: NotificationItem[]; upcoming: NotificationItem[]; count: number; muted: Record<string,true>; toggleMute(id): void; }
// - une toOverdueItems + toUpcomingPayments (misma ventana 7d que S3)
// - filtra muted locales y fuentes de widgets ocultos (visibleSources)
// - SSR-safe: lee localStorage solo en efecto/evento, default {} en SSR (output:export)
```

### 5.4 `apiPatch`

```ts
export async function apiPatch<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
// JSON + Bearer + 401 single-flight + toApiError, idéntico a apiPost pero method PATCH.
```

## 6. i18n (ES único, aditivo)

```ts
dashboard: {
  monthIncome, monthExpense, monthSavings, monthSavingsHint,
  upcomingPayments, upcomingPaymentsHint, upcomingPaymentsEmpty,
  pendingDebts, pendingDebtsHint, activeSubs, activeSubsHint,
  pendingTasks, pendingTasksHint, upcomingEvents, upcomingEventsHint,
  goalProgress, goalProgressHint, goalVsSavings, savingsSegment,
  widgetHide, widgetShow, widgetHidden, viewInFinance, viewInProductivity,
  showMore, // "ver en sección"
}
notifications: {
  bell, bellLabel, overdue, upcomingCharges, mute, unmute,
  noOverdue: "Sin vencidas 🎉", noUpcoming: "Nada por vencer en 7 días",
  dueOn: "vence {date}", amountDue: "{amount} · vence {date}",
}
```

`i18n.test.ts` se extiende en el mismo PR (snapshot aditivo, no reescritura).

## 7. UI composition

- **Header del home:** fila `flex justify-between`: izquierda `h1 Resumen +
  subtítulo`; derecha `<NotificationBell/>`. Badge = `count`, `aria-label`
  con `t("notifications.bellLabel", { n })`, `aria-expanded` en popover,
  cierre con `Esc`, foco visible, navegación teclado completa.
- **Grid bento:** `grid grid-cols-12 gap-4` existente. Métricas mes:
  `col-span-12 md:col-span-4` c/u (3 en fila en desktop). Listas:
  `upcoming-payments col-span-12 xl:col-span-7` (lg) + resto `md`
  (`col-span-12 md:col-span-6 xl:col-span-5/4` según spec visual).
  `goal-progress` `col-span-12 xl:col-span-5`. Cada `WidgetShell` con
  `title + hint + WidgetToggle + EmptyState + "ver en sección"`.
- **Tokens/a11y:** colores solo `--color-*` (sin hex, OKLCH azules),
  tooltips ES con moneda, `prefers-reduced-motion` (vía
  `usePrefersReducedMotion`), `WidgetToggle` y switches de mute con
  `<button role="switch" aria-checked>`, popover sin dependencias SSR
  (guardas `typeof window`), charts (si los hay) con `next/dynamic(ssr:false)`.
- **`output: export` + Axum `STATIC_DIR` + SPA fallback**, bearer
  `localStorage` + redirect 401 single-flight: heredado, sin cambios.

## 8. Tests (TDD estricto + RDD + Judgment Day)

Orden TDD rojo→verde (previsto en proposal §9, vinculante):

1. `transforms.test.ts`: `toMonth*` (incl. ahorro negativo), `toUpcomingPayments`
   (bordes hoy/hoy+7 incluido/hoy+8 excluido, deudas sin fecha excluidas,
   desempate deudas>events>subs), `toOverdueItems`, `toNotificationItems/Count`
   (mute + widgets ocultos), `toGoalProgress` (2 segmentos, `progress` 0–100).
2. `client.test.ts`: `apiPatch` (JSON, Bearer, 401 single-flight, error 422).
3. Hooks `dashboard.ts` (mocks `apiGet/apiPatch`): keys `dashboard/*`,
   `null` key cuando oculto, `useUpdateLayout` optimista + rollback,
   envelope exacto `PATCH`.
4. `DashboardHome.widgets.test.tsx` (mock hooks + `next/dynamic` como el
   test actual): 9 widgets con datos reales, toggle oculta ⇒ no fetch +
   no render, round-trip `GET→PATCH→GET`, layout vacío ⇒ 9 visibles,
   `EmptyState` ES, enlaces "ver en sección".
5. `notifications.test.tsx`: badge = vencidas+7d − muteados − ocultos,
   secciones, `EmptyState` ("Sin vencidas 🎉" / "Nada por vencer en 7 días"),
   `toggleMute` persiste `p8-notif-muted`, SSR-safe.
6. `i18n.test.ts`: claves nuevas tipadas, interpolación `{n}`/`{date}`.
7. E2E `dashboard-widgets.spec.ts` + `notifications.spec.ts`: home real,
   persistencia tras recarga, sin regresión Telemetría/charts actuales.
8. No-regresión: `s1-capture`/`s2-crud` verdes + specs vinculantes.

RDD + Judgment Day previstos (el plan de rollout los agenda; este diseño
no los sustituye: cada incremento TDD deja suite verde antes del juicio).

## 9. Rollout & rollback

- **Rollout:** PR único FE (o apilados por el orden TDD §8) → CI
  (unit + i18n + e2e + `s1-capture`/`s2-crud`) → preview estática →
  Judgment Day → merge a `main` → redeploy estático (Axum sirve `STATIC_DIR`).
  Sin migración BE, sin variables nuevas (salvo `NEXT_PUBLIC_API_URL` ya usada).
- **Rollback:** revert del/de los commits + redeploy estático.
  Sin datos que migrar atrás: `dashboard_layout` aditivo e ignorado por la
  versión anterior; `p8-notif-muted` local e ignorado.
  Criterio: rompe home actual, `s1-capture`/`s2-crud` rojos, o 422 masivo
  en `PATCH /me/preferences`.

## 10. Risks (diseño → mitigación fijada)

N+1 SWR → AD-6 (fetch condicional + reuso queries sección); 422 layout →
envelope exacto + test round-trip + fallback default; TZ 7d → día local
`es-CO` inclusivo + tests borde; deudas sin fecha → excluidas de próximos,
visibles en `pending-debts` + `EmptyState` explícito; metas vs ahorro →
un widget dos segmentos etiquetados; regresión F1 → §4.3 + CI; i18n
snapshot → aditivo mismo PR; E2E estático → SSR-safe + `ssr:false`.

## 11. Open points para specs/tasks (no para este diseño)

- Copy ES final por widget y por fila de aviso; orden exacto `order`
  dentro de cada banda (10/11/12/20/21/22/23/24/30 ya fijado arriba).
- Ventana visual `upcoming-events` (7 vs 14d) sin afectar campanita (7d fijos).
- Detalle visual `GoalProgress` (barras vs donut) y etiqueta de segmentos.
- Destino exacto de cada "ver en sección" (hash/ruta Finanzas/Productividad).
