# Delta for Notifications

**Scope.** The notification derivation loses the debt source: `kind=debt` disappears from the union, «Vencidas» and «Próximos cobros» are recomputed from surviving sources only, and the widget-based category muting drops `pending-debts`. Bell placement, item shape, panel sections, local mute persistence and delivery constraints are otherwise unchanged.

**Edge cases.** A stored individual mute for a debt item (e.g. `{ "debt:abc": true }`) becomes inert with no error: the id simply never matches a derived item. With the debts widget retired there is no debt category left to mute.

**Non-goals.** No push/email/SMS/sound/websocket, no backend notification endpoint, no new preference field, no notification for movements or payments (out of scope).

## MODIFIED Requirements

### Requirement: Notification Item Contract

The system MUST derive notifications FE-only with zero new endpoints via `NotificationItem { id, kind, title, due, amount?, source }` where `kind ∈ task|subscription|event` and `source` identifies the origin query. «Vencidas» MUST be `GET /tasks?view=overdue` plus events with `kind=payment_due AND starts_at < ahora`. «Próximos cobros» MUST reuse exactly the updated `upcoming-payments` union (subscriptions + `payment_due` events) and 7-day inclusive window (`[hoy 00:00, hoy+7 23:59]` local `es-CO`, ascending by date, tie-break events > subs). The debt source MUST NOT be queried, derived or displayed. Amounts are decimal strings on the wire and MUST be coerced to numbers only at the API boundary; display MUST use `formatMoney` `es-CO`/`COP` from `GET /me` and dates via Spanish Intl.
(Previously: `kind` included `debt`, «Vencidas» added active debts with `due_date < hoy`, and «Próximos cobros» reused a union whose tie-break was debts > events > subs.)

#### Scenario: Overdue derivation

- GIVEN an overdue task and a `payment_due` event one hour ago
- WHEN notifications compute
- THEN both appear under «Vencidas» as `NotificationItem` entries and no debt item is derived

#### Scenario: Upcoming equals widget union

- GIVEN the same fixtures as `upcoming-payments` (a sub and a `payment_due` event in 7d)
- WHEN «Próximos cobros» computes
- THEN it lists exactly the same items in the same order (events before subs on a tie)

#### Scenario: Window borders match widgets

- GIVEN items due today, in 7 days and in 8 days
- WHEN «Próximos cobros» computes
- THEN today and hoy+7 are included and hoy+8 is excluded

#### Scenario: No debt request

- GIVEN the bell rendered with valid auth
- WHEN the network activity is inspected
- THEN no request targets `/debts`

### Requirement: Mute Semantics

Each notification row MUST expose its own on/off switch, and each source category MUST be mutable via its dashboard widget toggle. Mute by individual item MUST persist only in `localStorage` under key `p8-notif-muted` as `{ [itemId]: true }` (local read, never a shared source of truth, never sent to the backend). Mute by category MUST reuse `dashboard_layout` visibility: hiding a widget (e.g. `active-subs`, `upcoming-payments`, `pending-tasks`, `upcoming-events`) MUST exclude its source items from the badge count and MUST stop their widget fetch. A muted individual item MUST remain listed with a muted visual state but MUST NOT count toward the badge; unmuting MUST restore its count. The system MUST NOT create any backend table, `notification_prefs` field, migration in preferences, or change to `backend/src/routes/*` including `me.rs`.
(Previously: `pending-debts` was one of the muting widgets, and the example muted id was a debt item.)

#### Scenario: Individual mute survives reload locally

- GIVEN item `subscription:xyz` muted via its row switch
- WHEN the page reloads on the same browser
- THEN `p8-notif-muted` still contains `{ "subscription:xyz": true }`, the row shows muted and the badge excludes it

#### Scenario: Category mute via widget

- GIVEN widget `active-subs` hidden via its home toggle
- WHEN the badge computes
- THEN subscription-sourced notifications are excluded from the count

#### Scenario: Retired debt mute is inert

- GIVEN a stale `p8-notif-muted` entry for a debt id
- WHEN notifications compute
- THEN the entry matches no item, produces no error and does not affect the badge

### Requirement: Delivery Constraints

The system MUST NOT send push, email, SMS, sounds, websocket updates or any dedicated polling; revalidation MUST reuse the existing SWR behavior (`revalidateOnFocus: false`, `dashboard/*` keys). The system MUST compose only from surviving hook data, inherit `frontend-dashboard` constraints (bento, keyboard, `prefers-reduced-motion`, tokens without hex, `output: export` + Axum static + SPA fallback, bearer `localStorage` + single-flight 401 redirect, no `/wealth`), inherit `frontend-i18n` constraints (single ES dictionary, typed keys, `lang="es"`), stay COP-only and ES-only, and MUST NOT touch Fase 1 areas, backend routes, UUID/importer/OCR/bank-sync scope, or add nav routes.
(Previously: the composition clause referred to "the S3 hook data", a stale slice reference.)

#### Scenario: No push channel

- GIVEN overdue items exist
- WHEN the app runs in background
- THEN no push/email/SMS is emitted and counts update only on SWR revalidation or panel open

#### Scenario: No backend addition

- GIVEN notifications loading with valid auth
- WHEN network requests are inspected
- THEN every request targets a pre-existing `GET` endpoint and no new notification endpoint is called
