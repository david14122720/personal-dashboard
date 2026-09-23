# Dashboard Widgets Specification

## Purpose

El home responde de un vistazo «¿cómo voy este mes / qué debo pagar?» con 6 widgets componibles desde endpoints existentes, personalizables por usuario, en español y solo COP, sin backend nuevo y sin regresión de Fase 1.

## Requirements

### Requirement: Upcoming Payments 7-Day Union

The system MUST render widget `upcoming-payments` (`list / lg / order 20`) as the union of (a) subscriptions with `next_billing_on ∈ [hoy, hoy+7]`, (b) debts with `status=active` and `due_date ∈ [hoy, hoy+7]`, (c) events with `kind=payment_due` and `starts_at ∈ [hoy, hoy+7]`, ordered ascending by date with tie-break debts > events > subs. The window MUST be 7 natural days inclusive `[hoy 00:00, hoy+7 23:59]` in local `es-CO` time; events range query MUST use RFC3339 `from/to`. Debts without a valid `due_date` (and without a dated next installment) MUST be excluded from this widget and remain visible only in `pending-debts`. The list MUST show top 5–7 plus a «ver en sección» link to existing Finanzas sections.

#### Scenario: Union and ordering

- GIVEN a sub due in 5d, a debt due in 2d and a `payment_due` event in 2d
- WHEN `upcoming-payments` renders
- THEN all three appear ordered debt (2d), event (2d), sub (5d)

#### Scenario: Inclusive window borders

- GIVEN items due today, in exactly 7 days, and in 8 days
- WHEN the widget computes
- THEN today and hoy+7 are included and hoy+8 is excluded

#### Scenario: Dateless debt excluded here

- GIVEN an `active` debt with no `due_date` and no dated installment
- WHEN `upcoming-payments` renders
- THEN the debt does not appear there but still appears in `pending-debts`

### Requirement: Pending Debts List

The system MUST render widget `pending-debts` (`list / md / order 21`) from `GET /debts` filtered to `status=active`, showing `pending_amount` (read-only, trigger-owned) as COP, top 5–7 plus «ver en sección» link.

#### Scenario: Active debts only

- GIVEN debts `[{ status: active, pending_amount: "500.00" }, { status: paid_off }]`
- WHEN the widget renders
- THEN only the active debt appears with its pending amount formatted

### Requirement: Active Subscriptions List

The system MUST render widget `active-subs` (`list / md / order 22`) from `GET /subscriptions` filtered to `is_active`, showing price and `next_billing_on`, top 5–7 plus «ver en sección» link.

#### Scenario: Active subs only

- GIVEN subscriptions `[{ is_active: true }, { is_active: false }]`
- WHEN the widget renders
- THEN only the active subscription appears

### Requirement: Pending Tasks List

The system MUST render widget `pending-tasks` (`list / md / order 23`) from `GET /tasks?view=today` plus `?view=upcoming` (or equivalent FE filter of `GET /tasks` on uncompleted tasks), top 5–7 plus «ver en sección» link to Productividad.

#### Scenario: Pending tasks shown

- GIVEN overdue-excluded views with uncompleted tasks due today and upcoming
- WHEN the widget renders
- THEN those tasks appear ordered by due date ascending

### Requirement: Upcoming Events List

The system MUST render widget `upcoming-events` (`list / md / order 24`) from `GET /events?from&to` with overlap semantics (`starts_at < to AND (ends_at IS NULL OR ends_at > from)`), window `[hoy, hoy+14]` inclusive for display purposes only, ordered ascending, top 5–7 plus «ver en sección» link. This extended window MUST NOT affect the notification bell window.

#### Scenario: Events window independent from bell

- GIVEN an event in 10 days
- WHEN the home renders
- THEN it MAY appear in `upcoming-events` but MUST NOT appear in upcoming payments or the bell «próximos cobros» section

### Requirement: Goal Progress

The system MUST render widget `goal-progress` (`chart / md / order 30`) with two labelled segments inside the same widget: «Metas» from `GET /goals` field `progress` (0–100, read-only) and «Ahorro: saved/goal» from `GET /savings-goals`. The system MUST NOT create a tenth widget for savings. Copy MUST distinguish «Metas» vs «Ahorro» in Spanish.

#### Scenario: Two segments one widget

- GIVEN goals with `progress: 60` and a savings-goal `saved/goal = 50%`
- WHEN the widget renders
- THEN both segments appear labelled «Metas» and «Ahorro» with their percentages

### Requirement: Widget Loading Error and Empty States

Each widget MUST handle `loading`, `error` and `empty` without breaking the home. Loading MUST show a per-widget placeholder; error MUST show a Spanish panel with retry that revalidates only `dashboard/*` keys; empty MUST show `EmptyState` in Spanish (e.g. no upcoming payments, no debts). Charts in widgets MUST reuse Recharts 3 code-split with `next/dynamic(ssr:false)`. A widget whose data source was removed MUST NOT remain in the set as a permanent empty state — the empty state is only legitimate for a surviving source that is currently empty.

#### Scenario: Empty upcoming payments

- GIVEN no subs, debts or `payment_due` events in 7 days
- WHEN the widget resolves
- THEN an `EmptyState` in Spanish is shown and no error is thrown

#### Scenario: Error with retry

- GIVEN a failed `GET /debts`
- WHEN `pending-debts` is in error
- THEN a Spanish error panel with a retry action appears and the rest of the home keeps rendering

#### Scenario: No permanent empty artefact

- GIVEN the rendered home with real data
- WHEN the widgets are inspected
- THEN no block is empty because its source was deleted

### Requirement: Customization and Persistence

Each of the 6 surviving widgets MUST expose its own visible show/hide toggle in the home (no settings screen). Visibility MUST persist via `PATCH /me/preferences` with the exact envelope `{ dashboard_layout: { widgets: [...] } }` where each entry respects the backend contract (`id` length 1–64, `type ∈ metric|chart|list|ledger|heatmap`, `size ∈ sm|md|lg`, `order ≥ 0`, ≤32 entries, `deny_unknown_fields` → 422 on deviation). A hidden widget MUST NOT trigger any network fetch and MUST NOT render. On first run, empty or invalid layout the system MUST fall back to all 6 visible in default order (20, 21, 22, 23, 24, 30). Stored entries whose `id` is not one of the 6 survivors (`month-income`, `month-expense`, `month-savings`) MUST be ignored silently — they MUST NOT render a block, trigger a fetch, or invalidate the remaining layout. A `GET→PATCH→GET` round-trip MUST preserve toggle state across reload.

#### Scenario: Hide stops fetch and render

- GIVEN widget `active-subs` toggled off
- WHEN the home renders
- THEN no request for subscriptions from that widget is issued and its block is absent from the DOM

#### Scenario: Round-trip persistence

- GIVEN a user hides `pending-debts`
- WHEN `PATCH /me/preferences` succeeds and the page reloads via `GET /me`
- THEN `pending-debts` remains hidden

#### Scenario: Invalid layout fallback

- GIVEN `dashboard_layout` missing, empty or rejected as invalid
- WHEN the home loads
- THEN all 6 widgets render visible in default order

#### Scenario: Stale removed-widget entries are ignored

- GIVEN a persisted layout containing `month-savings` together with two surviving widgets
- WHEN the home loads
- THEN the surviving widgets render per their stored visibility and the removed entry produces no block, no request and no error

### Requirement: Composition Constraints

The system MUST compose all 6 widgets FE-only with zero new backend endpoints, zero migrations of `user_preferences`, and zero changes to `backend/src/routes/*`. It MUST respect wire contracts (decimal-string amounts, `deny_unknown_fields`, 401/404/422; `tasks?view=` 422 on unknown view; `goals.progress` and `debts.pending_amount/status` read-only), inherit `frontend-dashboard` rules (bento rail→tabs, keyboard access with visible focus, `prefers-reduced-motion` suppressing entrance and chart animations, theme tokens `--color-*` with no hex, Spanish tooltips with currency, `output: export` + Axum `STATIC_DIR` + SPA fallback, bearer `localStorage` + single-flight 401 redirect to `/login`, nav without `/wealth`), and `frontend-i18n` rules (single ES dictionary, typed keys `dashboard.*`, `t(key, vars)` with `{n}`/`{date}`, no hardcoded strings, `lang="es"`). No widget MAY import, wrap or depend on a removed component (`ManualCapture`, `TransactionsLedger`, `TransferHistory`, `BudgetBars`, `BudgetsList`), hook or transform.

#### Scenario: No backend change

- GIVEN the backend at its current routes
- WHEN the 6 widgets load with valid auth
- THEN every request targets a pre-existing endpoint and no 404 for a `/dashboard/*` aggregate occurs

#### Scenario: Spanish typed copy

- GIVEN any of the 6 widgets rendered
- WHEN inspected
- THEN all visible strings resolve via the typed ES dictionary with no hardcoded English literals
