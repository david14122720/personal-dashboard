# Delta for Dashboard Widgets

**Scope.** The widget set drops from 6 to 5: `pending-debts` is retired and `upcoming-payments` loses its debts member; `goal-progress` loses its «Ahorro» segment. Everything else (active-subs, pending-tasks, upcoming-events, loading/error/empty, composition constraints) survives with the surviving-source list updated. Slice S-H, downstream of the movements and subscription slices.

**Edge cases.** Stored layouts that still list `pending-debts` (or the older `month-*` ids) MUST degrade silently: no block, no fetch, no error, remaining widgets unaffected. Hiding a widget still stops its fetch and excludes its notifications; with debts gone there is no debt source left to mute.

**Non-goals.** No new widget (including none for movements or payments), no `user_preferences` migration, no backend route changes, no tenth-widget for savings, no revival of removed widget ids.

## MODIFIED Requirements

### Requirement: Upcoming Payments 7-Day Union

The system MUST render widget `upcoming-payments` (`list / lg / order 20`) as the union of (a) subscriptions with `next_billing_on ∈ [hoy, hoy+7]` and (b) events with `kind=payment_due` and `starts_at ∈ [hoy, hoy+7]`, ordered ascending by date with tie-break events > subs. The window MUST be 7 natural days inclusive `[hoy 00:00, hoy+7 23:59]` in local `es-CO` time; the events range query MUST use RFC3339 `from/to`. The list MUST show top 5–7 plus a «ver en sección» link to existing Finanzas sections. The debts member MUST NOT be fetched, rendered or referenced.
(Previously: the union included a third member — active debts with `due_date` in the window — with tie-break debts > events > subs, and dateless debts were explicitly excluded while remaining visible in `pending-debts`.)

#### Scenario: Union and ordering

- GIVEN a sub due in 5d and a `payment_due` event in 2d
- WHEN `upcoming-payments` renders
- THEN both appear ordered event (2d), sub (5d)

#### Scenario: Inclusive window borders

- GIVEN items due today, in exactly 7 days, and in 8 days
- WHEN the widget computes
- THEN today and hoy+7 are included and hoy+8 is excluded

#### Scenario: No debts member remains

- GIVEN a user whose account previously had debts
- WHEN `upcoming-payments` renders
- THEN no debt item appears and no `GET /debts` request is issued by the widget

### Requirement: Goal Progress

The system MUST render widget `goal-progress` (`chart / md / order 30`) with one labelled segment: «Metas» from `GET /goals` field `progress` (0–100, read-only). The «Ahorro» segment is removed with the savings capability, and the widget MUST NOT call `useSavingsGoals` or render any savings figure. The two-segment copy MUST be replaced by copy that names only metas. No new widget SHALL be created for savings.
(Previously: the widget rendered two segments inside one widget — «Metas» and «Ahorro: saved/goal» from `GET /savings-goals` — with copy distinguishing them.)

#### Scenario: Goals segment renders

- GIVEN goals with `progress: 60`
- WHEN the widget renders
- THEN the «Metas» segment shows 60% and no «Ahorro» label appears

#### Scenario: No savings request

- GIVEN the home rendered
- WHEN the network activity is inspected
- THEN no request targets `/savings-goals`

#### Scenario: Empty state stays legitimate

- GIVEN a user with no goals
- WHEN the widget resolves
- THEN a Spanish empty state shows for the surviving source

### Requirement: Widget Loading Error and Empty States

Each widget MUST handle `loading`, `error` and `empty` without breaking the home. Loading MUST show a per-widget placeholder; error MUST show a Spanish panel with retry that revalidates only `dashboard/*` keys; empty MUST show `EmptyState` in Spanish (e.g. no upcoming payments). Charts in widgets MUST reuse Recharts 3 code-split with `next/dynamic(ssr:false)`. A widget whose data source was removed MUST NOT remain in the set as a permanent empty state — the empty state is only legitimate for a surviving source that is currently empty.
(Previously: the empty-state example listed "no debts", a source this change deletes.)

#### Scenario: Empty upcoming payments

- GIVEN no subs or `payment_due` events in 7 days
- WHEN the widget resolves
- THEN an `EmptyState` in Spanish is shown and no error is thrown

#### Scenario: Error with retry

- GIVEN a failed `GET /subscriptions`
- WHEN `active-subs` (or the subscriptions leg of a widget) is in error
- THEN a Spanish error panel with a retry action appears and the rest of the home keeps rendering

#### Scenario: No permanent empty artefact

- GIVEN the rendered home with real data
- WHEN the widgets are inspected
- THEN no block is empty because its source was deleted

### Requirement: Customization and Persistence

Each of the 5 surviving widgets MUST expose its own visible show/hide toggle in the home (no settings screen). Visibility MUST persist via `PATCH /me/preferences` with the exact envelope `{ dashboard_layout: { widgets: [...] } }` where each entry respects the backend contract (`id` length 1–64, `type ∈ metric|chart|list|ledger|heatmap`, `size ∈ sm|md|lg`, `order ≥ 0`, ≤32 entries, `deny_unknown_fields` → 422 on deviation). A hidden widget MUST NOT trigger any network fetch and MUST NOT render. On first run, empty or invalid layout the system MUST fall back to all 5 visible in default order (20, 22, 23, 24, 30). Stored entries whose `id` is not one of the 5 survivors — including the retired `pending-debts` and the older `month-income`, `month-expense`, `month-savings` — MUST be ignored silently: they MUST NOT render a block, trigger a fetch, or invalidate the remaining layout. A `GET→PATCH→GET` round-trip MUST preserve toggle state across reload.
(Previously: 6 widgets with default order (20, 21, 22, 23, 24, 30), and `pending-debts` was a survivor while only the `month-*` ids were treated as stale.)

#### Scenario: Hide stops fetch and render

- GIVEN widget `active-subs` toggled off
- WHEN the home renders
- THEN no request for subscriptions from that widget is issued and its block is absent from the DOM

#### Scenario: Round-trip persistence

- GIVEN a user hides `upcoming-payments`
- WHEN `PATCH /me/preferences` succeeds and the page reloads via `GET /me`
- THEN `upcoming-payments` remains hidden

#### Scenario: Invalid layout fallback

- GIVEN `dashboard_layout` missing, empty or rejected as invalid
- WHEN the home loads
- THEN all 5 widgets render visible in default order (20, 22, 23, 24, 30)

#### Scenario: Stale removed-widget entries are ignored

- GIVEN a persisted layout containing `pending-debts` together with two surviving widgets
- WHEN the home loads
- THEN the surviving widgets render per their stored visibility and the removed entry produces no block, no request and no error

### Requirement: Composition Constraints

The system MUST compose all 5 widgets FE-only with zero new backend endpoints, zero migrations of `user_preferences`, and zero changes to `backend/src/routes/*`. It MUST respect wire contracts (decimal-string amounts, `deny_unknown_fields`, 401/404/422; `tasks?view=` 422 on unknown view; `goals.progress` read-only), inherit `frontend-dashboard` rules (bento rail→tabs, keyboard access with visible focus, `prefers-reduced-motion` suppressing entrance and chart animations, theme tokens `--color-*` with no hex, Spanish tooltips with currency, `output: export` + Axum `STATIC_DIR` + SPA fallback, bearer `localStorage` + single-flight 401 redirect to `/login`, nav without `/wealth`), and `frontend-i18n` rules (single ES dictionary, typed keys `dashboard.*`, `t(key, vars)` with `{n}`/`{date}`, no hardcoded strings, `lang="es"`). No widget MAY import, wrap or depend on a removed component (`ManualCapture`, `TransactionsLedger`, `TransferHistory`, `BudgetBars`, `BudgetsList`, `PendingDebts`, `SavingsForms`, `DebtPayments`), hook (`useDebts`, `useSavingsGoals`) or transform (`toDebtRows`, `toSavingsViews`).
(Previously: 6 widgets; the debts read-only contract was part of the respected wire contracts; the removed-dependency list did not name the savings/debts modules.)

#### Scenario: No backend change

- GIVEN the backend at its current routes
- WHEN the 5 widgets load with valid auth
- THEN every request targets a pre-existing endpoint and no 404 for a `/dashboard/*` aggregate occurs

#### Scenario: Spanish typed copy

- GIVEN any of the 5 widgets rendered
- WHEN inspected
- THEN all visible strings resolve via the typed ES dictionary with no hardcoded English literals

#### Scenario: No removed dependency

- GIVEN the widget sources
- WHEN their imports are resolved
- THEN none imports a removed savings/debts component, hook or transform

## REMOVED Requirements

### Requirement: Pending Debts List

(Reason: the `debts` table and its route are removed by this change; a widget whose data source is gone MUST NOT remain as a permanent empty state, and the home no longer tracks debts.)
(Migration: None. Stored `dashboard_layout` entries naming `pending-debts` are ignored silently per "Customization and Persistence"; no preference migration is performed.)
