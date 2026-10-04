# Delta for Finance Accounts

> **Superseded in one clause (W1, change 2026-10-04-accounts-transfers-login-calendar, 2026-10-04).**
> The requirement that the surviving row keep the **account type** — the
> `Account Balance Inline Edit` clause "its name, its account type and its
> current balance" and the `Single Account Row Composition` clause "The row
> MUST keep the information the cards carried and that is not covered
> elsewhere — the account type" (and its `savings`-type scenario wording) —
> is **withdrawn**. The owner removed the `accounts.type` column, the
> `account_type` enum and every card field end to end (destructive migration
> 0016) because the layer was never used; the account row now renders name and
> formatted balance only, with no type text, chip, label, filter or enum value
> anywhere. Everything else in this delta stays binding: the single-row
> composition, the no-duplicate-card rule, the surviving balance/inline-edit
> contract and the movements account filter contract are unchanged. See
> `2026-10-04-accounts-transfers-login-calendar/specs/finance-accounts/spec.md`
> (requirement `Account Type Surface Retired`) for the withdrawing delta.

**Scope.** The account list in Finance renders each account **once**. The redundant account-card block is removed; the surviving row (name + balance + inline "Editar saldo") is the single representation. No API, DTO, validation or balance-write change.

**Edge cases.** An account with no type-derived decoration (no LED, no credit-usage bar) MUST still render its row. The account type is **not** shown: that clause is superseded by W1 (see the note above).

**Non-goals.** No new type-label i18n map, no credit-card usage widget replacement, no change to the manual-balance write, the archiving flow, or the movements account filter.

## MODIFIED Requirements

### Requirement: Account Balance Inline Edit

The finance UI MUST expose the manual balance write on the **single account row** as an inline edit: the account MUST be rendered exactly once per account with its name and its current balance (the account type clause is superseded by W1 — see the note above), and the row MUST offer the inline edit with an explicit confirmation before saving, sending the new value as a string and refreshing the `finance/` SWR scope on success. The control MUST be keyboard reachable with visible focus, MUST have a hit area of at least 44×44 CSS pixels, MUST format values with es-CO/COP through the existing money formatter, and MUST use typed `finance.*` i18n keys with no UUID input and no hardcoded copy. A second, redundant representation of the same account (duplicate card with the same name and balance) MUST NOT render anywhere in Finance.
(Previously: the requirement described the inline edit "on the account card" and said nothing about the list being the only representation, which allowed the duplicate card + row render.)

#### Scenario: Account renders once with its type

- GIVEN a user with account `"Ahorros"` and balance `$ 1.500.000`
- WHEN the Finance screen renders
- THEN exactly one row named `"Ahorros"` exists, showing its formatted balance and no type text (the type clause is superseded by W1)

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

The Cuentas section MUST render one row per account and nothing else: the previous top block of account cards MUST be absent, along with the component that produced it and its private helpers once they have no other consumer. The row MUST keep the information the cards carried and that is not covered elsewhere, except the account type — that single clause is superseded by W1 (see the note above) — and MAY drop card-only decoration (alert LED, credit-card usage bar). The account filter of the movements history MUST keep working through its own select control.
(Previously: Finance rendered account cards above the editable rows, duplicating name, type and balance.)

#### Scenario: No duplicate representation

- GIVEN the Finance screen with three accounts
- WHEN the Cuentas section is inspected
- THEN three rows render and no account card, LED or credit-usage bar renders

#### Scenario: Account filter survives without cards

- GIVEN the Finance screen with accounts `A` and `B`
- WHEN the user selects account `A` in the movements history filter
- THEN the history lists only movements of `A` and the active filter is visible and clearable
