# Delta for Finance Subscriptions

**Scope.** Protect the payment-method catalog while the transfers feature is removed: "Transferencia" stays selectable for subscriptions and debts, and no subscription contract changes. Slices S1–S3 (guard rail around the removal).

**Edge cases.** A subscription stored with the "Transferencia" payment method MUST keep rendering that label and MUST NOT be rewritten or nulled by the cleanup. A bulk rename of transfer-related identifiers MUST NOT touch the payment-method key or value.

**Non-goals.** No new payment method, no payment-method enum or validation change, no subscription form or endpoint change, no migration of stored payment-method values.

## ADDED Requirements

### Requirement: Payment Method Catalog Stability

The payment-method catalog offered by the subscription and debt forms MUST keep the "Transferencia" option available after the transfers feature is removed. That option is a payment method recorded as free text on the subscription or payment row and is semantically unrelated to the removed transfers capability; it MUST NOT be deleted, renamed or migrated by this change.

#### Scenario: Transferencia remains selectable

- GIVEN the subscription create form
- WHEN the payment-method selector is opened
- THEN "Transferencia" is present as an option alongside the other methods

#### Scenario: Stored value still renders

- GIVEN a subscription whose `payment_method` is "Transferencia"
- WHEN the subscriptions list renders
- THEN the row shows "Transferencia" and the stored value is unchanged

#### Scenario: Debt payment form keeps the option

- GIVEN the debt payment form
- WHEN the payment-method selector is opened
- THEN "Transferencia" is present as an option
