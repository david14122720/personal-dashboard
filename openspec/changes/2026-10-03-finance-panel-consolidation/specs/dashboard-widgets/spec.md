# Delta for Dashboard Widgets

**Scope.** The Resumen General loses one widget: the "Suscripciones activas" list, which restated the "Próximas suscripciones" section above it. Its component, its transform, its toggle row and its keys go with it.

**Edge cases.** A persisted `dashboard_layout` that still stores the removed `active-subs` id MUST be treated exactly like the previously retired ids: ignored silently, no block, no fetch, no error, while the remaining widgets honour their stored visibility. A stored layout listing only four surviving ids MUST NOT fall back to defaults.

**Notifications coupling.** The removed widget doubled as the visibility gate for subscription notifications (`useNotifications.ts` consulted `isWidgetVisible(layout, "active-subs")` both to fetch subscriptions and to admit subscription items). With the widget gone, the surviving `upcoming-payments` widget MUST be the only layout signal that gates those items: otherwise the default four-widget layout would silently drop every subscription notification from the badge.

**Non-goals.** The other four widgets, their order, the toggle mechanism, the `PATCH /me/preferences` envelope and the weekly "Próximos pagos" widget are untouched. The subscriptions data layer stays: the same read feeds "Próximas suscripciones", "Próximos pagos" and notifications.

## MODIFIED Requirements

### Requirement: Customization and Persistence

Each of the 4 surviving widgets MUST expose its own visible show/hide toggle in the home (no settings screen). Visibility MUST persist via `PATCH /me/preferences` with the exact envelope `{ dashboard_layout: { widgets: [...] } }` where each entry respects the backend contract (`id` length 1–64, `type ∈ metric|chart|list|ledger|heatmap`, `size ∈ sm|md|lg`, `order ≥ 0`, ≤32 entries, `deny_unknown_fields` → 422 on deviation). A hidden widget MUST NOT trigger any network fetch and MUST NOT render. On first run, empty or invalid layout the system MUST fall back to all 4 visible in default order (20, 22, 23, 30). Stored entries whose `id` is not one of the 4 survivors — including the ids retired by this change (`active-subs`) and earlier ones (`pending-debts`, `month-income`, `month-expense`, `month-savings`) — MUST be ignored silently: they MUST NOT render a block, trigger a fetch, or invalidate the remaining layout. A `GET→PATCH→GET` round-trip MUST preserve toggle state across reload.
(Previously: 5 widget survivors with default order (20, 22, 23, 24, 30), the `active-subs` widget among them and used as the hide/fetch example.)

#### Scenario: Hide stops fetch and render

- GIVEN widget `goal-progress` toggled off
- WHEN the home renders
- THEN no request for goals from that widget is issued and its block is absent from the DOM

#### Scenario: Round-trip persistence

- GIVEN a user hides `upcoming-payments`
- WHEN `PATCH /me/preferences` succeeds and the page reloads via `GET /me`
- THEN `upcoming-payments` remains hidden

#### Scenario: Invalid layout fallback

- GIVEN `dashboard_layout` missing, empty or rejected as invalid
- WHEN the home loads
- THEN all 4 widgets render visible in default order (20, 22, 23, 30)

#### Scenario: Stale removed-widget entries are ignored

- GIVEN a persisted layout containing `active-subs` together with two surviving widgets
- WHEN the home loads
- THEN the surviving widgets render per their stored visibility and the removed entry produces no block, no request and no error

#### Scenario: The removed widget has no toggle row

- GIVEN the customize list on the home
- WHEN it renders
- THEN it offers exactly one row per surviving widget and no row for "Suscripciones activas"

### Requirement: Composition Constraints

The system MUST compose all 4 widgets FE-only with zero new backend endpoints, zero migrations of `user_preferences`, and zero changes to `backend/src/routes/*`. The widget set MUST NOT contain an active-subscriptions list: the upcoming-subscriptions section already reports the same subscriptions with the information that matters (what is due next). It MUST respect wire contracts (decimal-string amounts, `deny_unknown_fields`, 401/404/422; `tasks?view=` 422 on unknown view; `goals.progress` read-only), inherit `frontend-dashboard` rules (bento rail→tabs, keyboard access with visible focus, `prefers-reduced-motion` suppressing entrance and chart animations, theme tokens `--color-*` with no hex, Spanish tooltips with currency, `output: export` + Axum `STATIC_DIR` + SPA fallback, bearer `localStorage` + single-flight 401 redirect to `/login`, nav without `/wealth`), and `frontend-i18n` rules (single ES dictionary, typed keys `dashboard.*`, `t(key, vars)` with `{n}`/`{date}`, no hardcoded strings, `lang="es"`). No widget MAY import, wrap or depend on a removed component (`ManualCapture`, `TransactionsLedger`, `TransferHistory`, `BudgetBars`, `BudgetsList`, `PendingDebts`, `SavingsForms`, `DebtPayments`, `ActiveSubs`) or transform (`toDebtRows`, `toSavingsViews`, `toActiveSubs`).
(Previously: 5 widgets, and the removed-dependency list did not name the savings/debts modules or the active-subscriptions widget.)

#### Scenario: No backend change

- GIVEN the backend at its current routes
- WHEN the 4 widgets load with valid auth
- THEN every request targets a pre-existing endpoint and no 404 for a `/dashboard/*` aggregate occurs

#### Scenario: Spanish typed copy

- GIVEN any of the 4 widgets rendered
- WHEN inspected
- THEN all visible strings resolve via the typed ES dictionary with no hardcoded English literals

#### Scenario: No removed dependency

- GIVEN the widget sources
- WHEN their imports are resolved
- THEN none imports a removed savings/debts component, hook or transform, and none imports an active-subscriptions widget

## REMOVED Requirements

### Requirement: Active Subscriptions Widget

The Resumen MUST NOT render an active-subscriptions list. The component that produced it, the transform that fed it and the copy it owned MUST be deleted, the default layout MUST stop listing its id, and the subscriptions data layer it used MUST stay for the sections that remain. Subscription notifications MUST keep working without it: the surviving `upcoming-payments` widget is the layout signal that gates them, so a user with the default four-widget layout still sees subscription items in the badge.
(Previously: the Resumen General rendered "Suscripciones activas" next to "Próximas suscripciones", both derived from the same subscription records, and that widget's visibility also decided whether subscription notifications were fetched and counted.)

#### Scenario: Default layout still reports subscription notifications

- GIVEN a user whose layout is the default four widgets (no `active-subs` entry)
- WHEN subscription charges are due within the window
- THEN they appear in the notifications badge, gated only by `upcoming-payments`

#### Scenario: Hiding the surviving widget still silences the category

- GIVEN a user with the default four widgets
- WHEN they hide `upcoming-payments`
- THEN subscription and payment items leave the badge and no subscriptions request is issued
