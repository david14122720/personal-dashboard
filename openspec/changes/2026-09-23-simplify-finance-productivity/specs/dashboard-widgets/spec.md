# Delta for Dashboard Widgets

**Scope.** Right-size the composable home after the ledger removal: drop the three month-split widgets, keep the six widgets whose sources survive, update the persisted-layout fallback and default order, and rewrite the composition clause that named removed components and tests. Slice S2 (budget references) + S3 (flow references).

**Edge cases.** A `dashboard_layout` persisted before this change may name `month-income`/`month-expense`/`month-savings`; such entries MUST be ignored without error, without rendering, and without a fetch, and MUST NOT invalidate the rest of the layout. Widget toggles MUST keep working for the six surviving widgets, and hiding one MUST still stop its fetch.

**Non-goals.** No new widget, no new KPI, no change to `user_preferences` schema, no backend endpoint, no changes to the surviving widgets' data contracts.

## MODIFIED Requirements

### Requirement: Customization and Persistence

Each of the 6 surviving widgets MUST expose its own visible show/hide toggle in the home (no settings screen). Visibility MUST persist via `PATCH /me/preferences` with the exact envelope `{ dashboard_layout: { widgets: [...] } }` where each entry respects the backend contract (`id` length 1–64, `type ∈ metric|chart|list|ledger|heatmap`, `size ∈ sm|md|lg`, `order ≥ 0`, ≤32 entries, `deny_unknown_fields` → 422 on deviation). A hidden widget MUST NOT trigger any network fetch and MUST NOT render. On first run, empty or invalid layout the system MUST fall back to all 6 visible in default order (20, 21, 22, 23, 24, 30). Stored entries whose `id` is not one of the 6 survivors (`month-income`, `month-expense`, `month-savings`) MUST be ignored silently — they MUST NOT render a block, trigger a fetch, or invalidate the remaining layout. A `GET→PATCH→GET` round-trip MUST preserve toggle state across reload.
(Previously: the layout persisted 9 widgets including the three month-split metrics, and the fallback listed nine ids.)

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

The system MUST compose all 6 widgets FE-only with zero new backend endpoints, zero migrations of `user_preferences`, and zero changes to `backend/src/routes/*`. Every widget MUST read only endpoints that survive the change, and no widget MAY import, wrap or depend on a removed component (`ManualCapture`, `TransactionsLedger`, `TransferHistory`, `BudgetBars`, `BudgetsList`) or a removed transform. It MUST respect wire contracts (decimal-string amounts, `deny_unknown_fields`, 401/404/422; `tasks?view=` 422 on unknown view; `goals.progress` and `debts.pending_amount/status` read-only), inherit `frontend-dashboard` rules (bento rail→tabs, keyboard access with visible focus, `prefers-reduced-motion` suppressing entrance and chart animations, theme tokens `--color-*` with no hex, currency tooltips in Spanish, `output: export` + Axum `STATIC_DIR` + SPA fallback, bearer `localStorage` + single-flight 401 redirect to `/login`, nav without `/wealth`), and `frontend-i18n` rules (single ES dictionary, typed keys `dashboard.*`, `t(key, vars)` with `{n}`/`{date}`, no hardcoded strings, `lang="es"`).
(Previously: the clause listed 9 widgets, forbade touching six named Fase-1 areas and two Fase-1 test files, and predated the removal of three of those areas.)

#### Scenario: No backend change

- GIVEN the backend at its current routes
- WHEN the 6 widgets load with valid auth
- THEN every request targets a pre-existing surviving endpoint and no 404 for a `/dashboard/*` aggregate occurs

#### Scenario: Spanish typed copy

- GIVEN any of the 6 widgets rendered
- WHEN inspected
- THEN all visible strings resolve via the typed ES dictionary with no hardcoded English literals

#### Scenario: No coupling to removed components

- GIVEN the widget sources
- WHEN their imports are inspected
- THEN none imports a removed component, hook or transform

### Requirement: Widget Loading Error and Empty States

Each widget MUST handle `loading`, `error` and `empty` without breaking the home. Loading MUST show a per-widget placeholder; error MUST show a Spanish panel with retry that revalidates only `dashboard/*` keys; empty MUST show `EmptyState` in Spanish (e.g. no upcoming payments, no debts). Charts in widgets MUST reuse Recharts 3 code-split with `next/dynamic(ssr:false)`. A widget whose data source was removed MUST NOT remain in the set as a permanent empty state — the empty state is only legitimate for a surviving source that is currently empty.
(Previously: the empty/error contract did not distinguish a genuinely empty live source from an artefact whose source no longer existed.)

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

## REMOVED Requirements

### Requirement: Month Split Metrics

(Removed behaviour: three separate metric widgets — `month-income`, `month-expense`, `month-savings` — derived from the current month of the monthly-flow aggregate, with savings computed as income minus expense.)
(Reason: the monthly-flow and category aggregates are removed with the ledger, so the three widgets have no source and would be permanently empty.)
(Migration: the three widget ids MUST be deleted from the widget registry, the transforms that fed them (`monthBalance`, `toMonthIncome/Expense/Savings`, flow points) removed with the removed hooks, their `dashboard.*` keys deleted, and stored layout entries ignored per the updated Customization requirement. No replacement metric is required by this change.)
