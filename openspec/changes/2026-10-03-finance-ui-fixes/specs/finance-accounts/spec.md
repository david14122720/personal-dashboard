# Delta for Finance Accounts

**Scope.** The account list in Finance renders each account **once**. The redundant account-card block is removed; the surviving row (name + type + balance + inline "Editar saldo") is the single representation. No API, DTO, validation or balance-write change.

**Edge cases.** The account type MUST be shown from the same raw value the cards showed today (`bank`, `savings`, `cash`, `digital_wallet`, `credit_card`, `investment`, `other`); no translation map is introduced. An account with no type-derived decoration (no LED, no credit-usage bar) MUST still render its row.

**Non-goals.** No new type-label i18n map, no credit-card usage widget replacement, no change to the manual-balance write, the archiving flow, or the movements account filter.

## MODIFIED Requirements

### Requirement: Account Balance Inline Edit

The finance UI MUST expose the manual balance write on the **single account row** as an inline edit: the account MUST be rendered exactly once per account with its name, its account type and its current balance, and the row MUST offer the inline edit with an explicit confirmation before saving, sending the new value as a string and refreshing the `finance/` SWR scope on success. The control MUST be keyboard reachable with visible focus, MUST have a hit area of at least 44×44 CSS pixels, MUST format values with es-CO/COP through the existing money formatter, and MUST use typed `finance.*` i18n keys with no UUID input and no hardcoded copy. A second, redundant representation of the same account (duplicate card with the same name and balance) MUST NOT render anywhere in Finance.
(Previously: the requirement described the inline edit "on the account card" and said nothing about the list being the only representation, which allowed the duplicate card + row render.)

#### Scenario: Account renders once with its type

- GIVEN a user with account `"Ahorros"` of type `savings` and balance `$ 1.500.000`
- WHEN the Finance screen renders
- THEN exactly one row named `"Ahorros"` exists, showing its type and its formatted balance

#### Scenario: User edits balance from the row

- GIVEN a user viewing account `"Ahorros"` with balance `$ 1.500.000`
- WHEN they replace the value with `980000.00` and confirm
- THEN the FE sends `PATCH /api/accounts/{id}` with the balance as a decimal string and the row shows the new formatted value

#### Scenario: Cancelling leaves the value untouched

- GIVEN an inline edit in progress
- WHEN the user cancels
- THEN no request is sent and the previous balance is still displayed

#### Scenario: Invalid input blocked before the request

- GIVEN an inline edit with more than 2 decimals or an out-of-range value
- WHEN the user tries to confirm
- THEN the FE shows a Spanish validation error and sends no request

## ADDED Requirements

### Requirement: Single Account Row Composition

The Cuentas section MUST render one row per account and nothing else: the previous top block of account cards MUST be absent, along with the component that produced it and its private helpers once they have no other consumer. The row MUST keep the information the cards carried and that is not covered elsewhere — the account type — and MAY drop card-only decoration (alert LED, credit-card usage bar). The account filter of the movements history MUST keep working through its own select control.
(Previously: Finance rendered account cards above the editable rows, duplicating name, type and balance.)

#### Scenario: No duplicate representation

- GIVEN the Finance screen with three accounts
- WHEN the Cuentas section is inspected
- THEN three rows render and no account card, LED or credit-usage bar renders

#### Scenario: Account filter survives without cards

- GIVEN the Finance screen with accounts `A` and `B`
- WHEN the user selects account `A` in the movements history filter
- THEN the history lists only movements of `A` and the active filter is visible and clearable
