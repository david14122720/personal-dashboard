# Credit Card Summary Specification

## Purpose

Calculation and reporting of credit card usage metrics, billing cycles, and liability impact on net worth.

## Requirements

### Requirement: Usage Metrics Calculation

The system MUST compute derived metrics for credit card accounts to monitor credit health.

- `used_balance`: The absolute value of the current negative balance.
- `available_balance`: `credit_limit` minus `used_balance`.
- `usage_pct`: `(used_balance / credit_limit) * 100`.

#### Scenario: Compute standard metrics
- GIVEN a card with `credit_limit: 1000.00` and balance -300.00
- WHEN the summary is requested
- THEN the system SHALL return:
    - `used_balance`: 300.00
    - `available_balance`: 700.00
    - `usage_pct`: 30.0%

### Requirement: Usage Alert Levels

The system MUST assign an alert level based on the `usage_pct`.

- **OK**: `usage_pct` < 70%
- **Warn**: 70% $\le$ `usage_pct` < 90%
- **High**: `usage_pct` $\ge$ 90%

#### Scenario: Transition to High alert
- GIVEN a card with `credit_limit: 1000.00` and balance -910.00
- WHEN the summary is requested
- THEN the system SHALL return `alert_level: "High"`

### Requirement: Balance Types

The system MUST distinguish between the live current balance and the balance as of the last statement date.

- **Current Balance**: the user-asserted manual balance, written by hand via `PATCH /api/accounts/{id}`.
- **Statement Balance**: always `null` — the cycle-to-date figure was removed with the ledger (migration 0011) and MUST NOT be substituted with the balance, zero, or any derived value.

#### Scenario: Statement balance is always null
- GIVEN any card with any balance
- WHEN the summary is requested
- THEN `statement_balance` MUST be `null`
- AND `current_balance` reflects the manual `balance`

#### Scenario: Metrics derive from the manual balance
- GIVEN a card with `credit_limit: "1000.00"` and balance `"-350.00"`
- WHEN the summary is requested
- THEN `used_balance` is `"350.00"`, `available_balance` is `"650.00"` and `usage_pct` is `35.00`
- AND no removed aggregate endpoint is queried

#### Scenario: Cycle days preserved without a statement figure
- GIVEN a card with `statement_day: 15` and `payment_due_day: 25`
- WHEN the card renders
- THEN both days remain editable metadata and no statement figure is shown

### Requirement: Net Worth Liability Treatment

The system MUST treat credit card balances as liabilities when aggregating total assets.

- Credit card balances (which are typically negative) MUST be summed as-is.
- They MUST NOT be converted to positive values during asset summation; they MUST reduce the total net worth.

#### Scenario: Net worth summation
- GIVEN accounts:
    - Savings: 5000.00
    - Credit Card: -1000.00
- WHEN computing total net worth
- THEN the result MUST be 4000.00

<!-- p9-finanzas ADDED from openspec/changes/p9-finanzas/specs/cards-write/spec.md (alias draft resolved to wire names) -->

### Requirement: Card Create Form

The FE MUST provide a manual Spanish card-create form over existing `POST /accounts` with `type=credit_card`. Creation MUST require `credit_limit` (string, `> 0`) plus both `statement_day` and `payment_due_day` (1–31); the BE MUST keep rejecting missing/invalid card fields with 422 and non-card `credit_limit` with 422. No new BE endpoint SHALL be created.

#### Scenario: User creates card

- GIVEN an authenticated user
- WHEN they submit name `"Visa"`, limit `"5000000"`, corte 15, pago 25
- THEN the FE sends `POST /accounts` with `type: "credit_card"` and limit as string, returning 201

#### Scenario: Missing limit blocked

- GIVEN a user creating a card without limit
- WHEN they submit
- THEN the FE shows a Spanish validation error; any BE fallback returns 422

### Requirement: Card Detail View

The FE MUST render card detail from existing `GET /accounts/{id}` detail (no statement figure; Rust-computed `used/available/usage_pct/alert ok|warn|high`): límite, disponible, día de corte, día de pago, alerta. No statement figure is rendered — the element is omitted, never a `$ 0.00` placeholder. List views MUST NOT issue per-card queries. Amounts MUST be coerced string→number only in the pure transform layer and formatted COP.

#### Scenario: Detail shows limit and alert

- GIVEN a card with limit `"1000.00"` and balance `"-910.00"`
- WHEN the detail renders
- THEN it shows usado `"910.00"`, disponible `"90.00"`, alerta `high`, corte/pago days

### Requirement: No Card Limit Patch

`PATCH` of `credit_limit`, `statement_day` or `payment_due_day` SHALL NOT exist; limit or cycle-day changes MUST be DELETE + recreate, explained in Spanish copy with confirmation of the destructive recreate. The manual `balance` write is the single exception: `PATCH /api/accounts/{id}` accepts `balance` for every account type, cards included (see `finance-accounts`).

#### Scenario: Limit change recreates card

- GIVEN a card `"Visa"` needing a higher limit
- WHEN the user confirms the limit change
- THEN the FE guides DELETE + recreate (no limit-PATCH request is ever sent)

#### Scenario: Card balance edited in place
- GIVEN a card with balance `"-900.00"`
- WHEN the user edits the balance to `"-250.00"` inline and confirms
- THEN the FE sends `PATCH /api/accounts/{id}` with `balance` as a string and the card metrics recompute from the new balance

#### Scenario: Cycle-day change still recreates
- GIVEN a card whose `payment_due_day` must move to 25
- WHEN the user applies the change
- THEN the FE guides DELETE + recreate and never patches the day field

### Requirement: Card Contract Preserved

The BE card contract MUST remain unchanged: `chk_card_*` CHECKs validated to 422 with Spanish messages (never 500), `deny_unknown_fields`, string money, 401 unauthenticated, 404 foreign (never 403), 409 on duplicate name. The delete guard MUST NOT consult removed tables: no surviving table holds a blocking reference to an account, so deleting an owned card MUST return 204. The FE MUST surface these in Spanish via `finance.*`/`cards.*` i18n keys.

#### Scenario: Delete card with movements conflicts

- GIVEN a card with linked transactions
- WHEN the user confirms deletion and the BE returns 409
- THEN the FE shows the Spanish in-use error and keeps the card

### Requirement: Card Manual ES COP Contract

All card UI MUST be manual (no UUID inputs), Spanish-only, COP-only, keyboard-accessible, with `finance/` SWR refresh. Card copy MUST live in i18n keys; hardcoding is forbidden.

#### Scenario: Spanish card list

- GIVEN cards `"Visa"` and `"Master"`
- WHEN the section renders
- THEN names, COP limits, and Spanish alert labels are shown without UUIDs
