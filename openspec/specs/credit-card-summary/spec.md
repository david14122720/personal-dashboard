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

- **Current Balance**: The real-time cached balance of the account.
- **Statement Balance**: The sum of all transactions linked to the account that occurred on or before the most recent `statement_day` of the billing cycle.

#### Scenario: Statement vs Current balance
- GIVEN a card where the last statement was on the 15th
- GIVEN transactions:
    - 10th: -100.00
    - 12th: -50.00
    - 20th: -200.00
- WHEN the summary is requested
- THEN `statement_balance` MUST be -150.00
- AND `current_balance` MUST be -350.00

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

The FE MUST render card detail from existing `GET /accounts/{id}` detail (which includes `statement_balance` plus Rust-computed `used/available/usage_pct/alert ok|warn|high`): límite, disponible, día de corte, día de pago, alerta. List views MUST NOT trigger per-card statement queries (anti-N+1 preserved). Amounts MUST be coerced string→number only in the pure transform layer and formatted COP.

#### Scenario: Detail shows limit and alert

- GIVEN a card with limit `"1000.00"` and balance `"-910.00"`
- WHEN the detail renders
- THEN it shows usado `"910.00"`, disponible `"90.00"`, alerta `high`, corte/pago days

### Requirement: No Card Limit Patch

`PATCH` of `credit_limit/statement_day/payment_due_day/balance` SHALL NOT exist. Limit or cycle-day changes MUST be DELETE + recreate so `credit_card_account_id` history is never rewritten. The FE MUST explain this in Spanish copy and confirm destructive recreates.

#### Scenario: Limit change recreates card

- GIVEN a card `"Visa"` needing a higher limit
- WHEN the user confirms the limit change
- THEN the FE guides DELETE + recreate (no limit-PATCH request is ever sent)

### Requirement: Card Contract Preserved

The BE card contract MUST remain unchanged: `chk_card_*` CHECKs validated to 422 with Spanish messages (never 500), `deny_unknown_fields`, string money, 401 unauthenticated, 404 foreign (never 403), 409 on delete-with-movements or duplicate name. The FE MUST surface these in Spanish via `finance.*`/`cards.*` i18n keys.

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
