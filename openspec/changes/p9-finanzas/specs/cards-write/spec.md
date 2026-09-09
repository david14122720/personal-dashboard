# Cards Write Specification

## Purpose

Completar tarjetas como trabajo solo-FE sobre cuentas `type=credit_card` ya existentes: crear y ver límite/disponible/corte/pago/alerta, en español y solo COP.

## Requirements

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
