# Delta for Frontend Dashboard

**Scope.** The `Telemetry Strip` requirement retires its card-alert clause and its "Card alert mapping preserved" scenario: W1 removes `alert_level` and the whole credit-card layer (0016), so no card alert surface is producible and nothing replaces it. The four surviving KPIs, the user-currency total-balance rule and the money-formatting rule stay binding, and every other `frontend-dashboard` requirement is untouched.

**Edge cases.** After 0016 the retired scenario is not merely unsatisfied but impossible to construct: a card account with `alert_level: "warn"` cannot exist, `AccountWire` no longer carries the field and no component reads it. A reader looking for the card alert finds this retirement here and in `credit-card-summary` (capability removed) and `finance-accounts` (type/card surface forbidden), never a renamed substitute. No LED, badge, threshold or placeholder MAY stand in for the removed alert.

**Non-goals.** No replacement alert capability, no low-balance or account indicator, no new telemetry KPI, no change to the four-KPI arithmetic or to any other dashboard requirement.

## MODIFIED Requirements

### Requirement: Telemetry Strip

The dashboard home MUST render a full-width Resumen strip whose KPIs all have surviving sources, exactly four: net worth (patrimonio), number of non-archived accounts (cuentas), monthly-equivalent cost of active subscriptions (suscripciones) and total balance (saldo total = Σ `accounts.balance` over non-archived accounts whose currency equals the user currency, per D1). Outstanding debt and total savings MUST be absent, no KPI whose source endpoint was removed MAY render, and no placeholder MAY stand in for one. Movements are shown in the dedicated sections below the strip, not as KPIs. Values MUST be formatted per user `locale`/`currency_code` preferences through the existing string-money coercion at the boundary. No card alert surface MAY exist: no `alert_level` LED, badge, threshold, mapping or indicator MAY render or be reintroduced, and no component, wire type or test MAY read `alert_level` (removed with the card layer by 0016). No LED MAY exist for `status` values of the removed budgeting feature.
(Previously: a card alert indicator MAY remain only if it kept the backend enum mapping 1:1 (`alert_level` ∈ {`ok`, `warn`, `high`}); no LED may exist for `status` values of the removed budgeting feature.)

#### Scenario: Four live KPIs render

- GIVEN populated accounts and subscriptions
- WHEN the home renders
- THEN patrimonio, cuentas, suscripciones and saldo total each show a value from a surviving source

#### Scenario: Debt and savings KPIs are gone

- GIVEN the rendered strip
- WHEN its items are inspected
- THEN neither a deudas nor a ahorros item is present, and no `GET /debts` or `/savings-goals` request is issued by the strip

#### Scenario: Total balance uses the user currency only

- GIVEN accounts in COP and one account in USD, user currency COP
- WHEN the strip renders
- THEN saldo total sums only the COP accounts and no conversion is applied

#### Scenario: No card alert surface

- GIVEN the dashboard home and the Finance account surfaces after the change
- WHEN their rendered elements and the account wire are inspected
- THEN no alert LED, badge, threshold or card alert mapping exists and no code reads `alert_level`

#### Scenario: Money formatting

- GIVEN preferences `locale: "es-CO"`, `currency_code: "COP"` and net worth `"1500000.00"`
- WHEN the strip renders
- THEN the value displays as `$ 1.500.000`
