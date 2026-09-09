# Notifications Specification

## Purpose

Avisos accionables solo in-app desde el home: campanita con vencidas y próximos cobros a 7 días, con silenciamiento por aviso y por categoría, sin push/email, sin backend nuevo y sin tocar Fase 1.

## Requirements

### Requirement: Bell Placement and Badge

The system MUST render the notification bell only in the header of `DashboardHome` (not in `AppShell` rail/tabs, not floating, no nav badge). The bell MUST be an accessible button (keyboard operable, visible focus, `aria-label` in Spanish, `aria-expanded` reflecting the panel). The badge MUST equal count(overdue) + count(upcoming 7d) minus items muted individually minus items whose source widget is hidden. The bell and its popover MUST work under `output: export` without SSR-only dependencies.

#### Scenario: Header bell with correct badge

- GIVEN 2 overdue and 3 upcoming in 7d, with 1 item muted and no widget hidden
- WHEN the header renders
- THEN the badge shows 4

#### Scenario: Keyboard and ARIA

- GIVEN a keyboard-only user
- WHEN they tab to the bell and activate it
- THEN the panel opens, focus is visible and `aria-expanded` flips to true

### Requirement: Notification Item Contract

The system MUST derive notifications FE-only with zero new endpoints via `NotificationItem { id, kind, title, due, amount?, source }` where `kind ∈ task|debt|subscription|event` and `source` identifies the origin query. «Vencidas» MUST be `GET /tasks?view=overdue` plus debts with `due_date < hoy AND status=active` plus events with `kind=payment_due AND starts_at < ahora`. «Próximos cobros» MUST reuse exactly the `upcoming-payments` union and 7-day inclusive window (`[hoy 00:00, hoy+7 23:59]` local `es-CO`, ascending by date, tie-break debts > events > subs). Amounts are decimal strings on the wire and MUST be coerced to numbers only at the API boundary; display MUST use `formatMoney` `es-CO`/`COP` from `GET /me` and dates via Spanish Intl.

#### Scenario: Overdue derivation

- GIVEN an overdue task, an active debt with `due_date` yesterday and a `payment_due` event one hour ago
- WHEN notifications compute
- THEN all three appear under «Vencidas» as `NotificationItem` entries

#### Scenario: Upcoming equals widget union

- GIVEN the same fixtures as `upcoming-payments` (sub + debt + `payment_due` in 7d, plus a dateless debt)
- WHEN «Próximos cobros» computes
- THEN it lists exactly the same dated items in the same order and excludes the dateless debt

#### Scenario: Window borders match widgets

- GIVEN items due today, in 7 days and in 8 days
- WHEN «Próximos cobros» computes
- THEN today and hoy+7 are included and hoy+8 is excluded

### Requirement: Panel Sections and Empty States

The system MUST render the bell panel with two labelled sections — «Vencidas» and «Próximos cobros» — each ordered ascending by `due`, reusing `EmptyState` in Spanish when empty («Sin vencidas 🎉», «Nada por vencer en 7 días»). All copy MUST come from typed `notifications.*` keys via `t(key, vars)` with no hardcoded strings. The panel MUST respect theme tokens (`--color-*`, no hex), visible focus and `prefers-reduced-motion`.

#### Scenario: Empty sections

- GIVEN zero overdue and zero upcoming in 7d
- WHEN the panel opens
- THEN «Sin vencidas 🎉» and «Nada por vencer en 7 días» are shown

#### Scenario: Sections ordered

- GIVEN two overdue items due 5d ago and 1d ago
- WHEN «Vencidas» renders
- THEN the 5d-ago item appears first

### Requirement: Mute Semantics

Each notification row MUST expose its own on/off switch, and each source category MUST be mutable via its dashboard widget toggle. Mute by individual item MUST persist only in `localStorage` under key `p8-notif-muted` as `{ [itemId]: true }` (local read, never a shared source of truth, never sent to the backend). Mute by category MUST reuse `dashboard_layout` visibility: hiding a widget (e.g. `active-subs`, `pending-debts`, `upcoming-payments`, `pending-tasks`, `upcoming-events`) MUST exclude its source items from the badge count and MUST stop their widget fetch. A muted individual item MUST remain listed with a muted visual state but MUST NOT count toward the badge; unmuting MUST restore its count. The system MUST NOT create any backend table, `notification_prefs` field, migration in preferences, or change to `backend/src/routes/*` including `me.rs`.

#### Scenario: Individual mute survives reload locally

- GIVEN item `debt:abc` muted via its row switch
- WHEN the page reloads on the same browser
- THEN `p8-notif-muted` still contains `{ "debt:abc": true }`, the row shows muted and the badge excludes it

#### Scenario: Category mute via widget

- GIVEN widget `active-subs` hidden via its home toggle
- WHEN the badge computes
- THEN subscription-sourced notifications are excluded from the count

### Requirement: Delivery Constraints

The system MUST NOT send push, email, SMS, sounds, websocket updates or any dedicated polling; revalidation MUST reuse the existing SWR behavior (`revalidateOnFocus: false`, `dashboard/*` keys). The system MUST compose only from the S3 hook data, inherit `frontend-dashboard` constraints (bento, keyboard, `prefers-reduced-motion`, tokens without hex, `output: export` + Axum static + SPA fallback, bearer `localStorage` + single-flight 401 redirect, no `/wealth`), inherit `frontend-i18n` constraints (single ES dictionary, typed keys, `lang="es"`), stay COP-only and ES-only, and MUST NOT touch Fase 1 areas, backend routes, UUID/importer/OCR/bank-sync scope, or add nav routes.

#### Scenario: No push channel

- GIVEN overdue items exist
- WHEN the app runs in background
- THEN no push/email/SMS is emitted and counts update only on SWR revalidation or panel open

#### Scenario: No backend addition

- GIVEN notifications loading with valid auth
- WHEN network requests are inspected
- THEN every request targets a pre-existing `GET` endpoint and no new notification endpoint is called
