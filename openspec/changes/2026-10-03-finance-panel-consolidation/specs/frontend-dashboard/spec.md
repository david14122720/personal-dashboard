# Delta for Frontend Dashboard

**Scope.** Three repetitions get removed from the two home surfaces of Finance: the Finance screen stops splitting "load a movement" and "see the movements" into two cards, the Resumen strip stops showing patrimonio next to saldo total, and the app header stops claiming a live feed. No API, DTO, hook or backend change.

**Edge cases.** The merged panel keeps a code-addressable accessible name (`Movimientos`), because the Finance screen's own tests and the sections e2e locate it by that `region`. Cards that lose a sibling keep their `h-full` SectionShell discipline so a row with one card does not collapse. A user with no accounts, no movements or a failing movements fetch MUST still see the add controls, because they live inside the same section as the history and are not gated by its loading/error/empty branches.

**Non-goals.** No change to the movements window (5 + "Ver más" ×10), its filters, the modal fields or validation, the Cuentas/Suscripciones cards, the category chart, the compare sub-route, or the remaining three strip KPIs.

## MODIFIED Requirements

### Requirement: Telemetry Strip

The dashboard home MUST render a full-width Resumen strip whose KPIs all have surviving sources, exactly three: number of non-archived accounts (cuentas), monthly-equivalent cost of active subscriptions (suscripciones) and total balance (saldo total = Σ `accounts.balance` over non-archived accounts whose currency equals the user currency, per D1). The net worth (patrimonio) KPI MUST NOT render: it restated the same question the total balance already answers, so the strip MUST neither draw the item nor issue the net-worth read on its behalf. Net worth keeps its other consumers (Reports and Progress) and MUST NOT be deleted from the API surface. Outstanding debt and total savings MUST remain absent, no KPI whose source endpoint was removed MAY render, and no placeholder MAY stand in for one. Movements stay in the dedicated sections below the strip, not as KPIs. Values MUST be formatted per user `locale`/`currency_code` preferences through the existing string-money coercion at the boundary. A card alert indicator MAY remain only if it keeps the backend enum mapping 1:1 (`alert_level` ∈ {`ok`, `warn`, `high`}); no LED MAY exist for `status` values of the removed budgeting feature.
(Previously: exactly four KPIs — net worth, accounts, monthly subscription cost and total balance — where the first and the last answered the same "how much do I have" question.)

#### Scenario: Three live KPIs render

- GIVEN populated accounts and subscriptions
- WHEN the home renders
- THEN cuentas, suscripciones and saldo total each show a value from a surviving source

#### Scenario: Patrimonio KPI is gone

- GIVEN the rendered strip
- WHEN its items are inspected
- THEN no patrimonio/net-worth item is present

#### Scenario: Money formatting survives the removal

- GIVEN preferences `locale: "es-CO"`, `currency_code: "COP"` and total balance `"1500000.00"`
- WHEN the strip renders
- THEN the surviving value displays as `$ 1.500.000`

#### Scenario: Debt and savings KPIs are gone

- GIVEN the rendered strip
- WHEN its items are inspected
- THEN neither a deudas nor an ahorros item is present, and no `GET /debts` or `/savings-goals` request is issued by the strip

#### Scenario: Total balance uses the user currency only

- GIVEN accounts in COP and one account in USD, user currency COP
- WHEN the strip renders
- THEN saldo total sums only the COP accounts and no conversion is applied

### Requirement: Finance Single-View Composition

The Finance screen MUST remain a single view with no tabs and one `grid-cols-12`. The add controls and the movements history MUST share ONE card spanning `col-span-12`: the two entry controls («Agregar gasto»/«Agregar ingreso») sit at the top of that card and the history list with its account/category/direction filters sits directly below, inside the same card, with no other card between them and no separate "Agregar movimiento" card anywhere. That card MUST keep the accessible name `Movimientos` and the `h-full` `SectionShell` discipline. The remaining cards — Accounts, Subscriptions, Assets and Category chart — MUST keep `col-span-12 md:col-span-6` (the Category chart keeps its existing span) so cards sharing a row keep equal height. The Assets card MUST keep its asset rows and MUST NOT render the read-only net worth figure, which duplicated the patrimonio question removed from the strip. The Savings and Debts sections, their S5 blocks, forms, hooks and empty placeholders MUST be absent. The compare view stays a Finance sub-route (not in the primary nav) reachable from the chart. Add controls, the history filters and the Pay control MUST satisfy the keyboard/focus and 44×44 hit-area rules and use typed `finance.*` keys.
(Previously: the card list enumerated "Add expense/income" and "Movements history" as two sibling `md:col-span-6` cards, and the Assets card carried a read-only net worth line.)

#### Scenario: One card holds the add controls and the history

- GIVEN the Finance screen rendered
- WHEN its sections are enumerated
- THEN exactly one section named "Movimientos" contains both entry controls and the history list with its three filters, and no section named "Agregar movimiento" exists

#### Scenario: Both entry controls still open their modals

- GIVEN the merged panel
- WHEN the user activates «Agregar gasto» (then «Agregar ingreso»)
- THEN the corresponding modal opens and, on close, focus returns to the control that opened it

#### Scenario: Add controls survive an empty or failing history

- GIVEN a user with no movements, or a failed `GET /movements`
- WHEN the merged panel renders
- THEN both entry controls are present and operable and the history shows its Spanish empty or error state

#### Scenario: Assets card keeps rows and drops the figure

- GIVEN the Assets card
- WHEN it renders
- THEN the asset rows appear and no "Patrimonio: …" read-only line is rendered

#### Scenario: Single view without tabs

- GIVEN the Finance screen rendered
- WHEN its layout is inspected
- THEN it is one grid of section cards and no tab control or tab router exists

#### Scenario: Removed sections are absent

- GIVEN the Finance screen
- WHEN its sections are enumerated
- THEN no Savings and no Debts section, control or placeholder appears

#### Scenario: Compare view reachable

- GIVEN the Finance category chart
- WHEN the user follows its compare affordance
- THEN the compare sub-route opens and is not added to the primary navigation

## ADDED Requirements

### Requirement: Decorative Live Indicator Absence

The app shell header MUST NOT render a live/"tiempo real" status pill. There is no live feed to report, so no element MAY assert one: the pulsing green indicator and its label MUST be removed from the header, on every page, together with the `nav.live` key that existed only for it.
(Previously: the header carried a decorative emerald pill labelled "Tiempo real" with an animated dot and no data behind it.)

#### Scenario: No live pill in the header

- GIVEN any authenticated page
- WHEN the header renders
- THEN no element labelled "Tiempo real" and no pulsing status dot are present in it

#### Scenario: Header keeps its surviving controls

- GIVEN the header after the removal
- WHEN it renders
- THEN the breadcrumb, the global search, the date and the notifications bell still render
