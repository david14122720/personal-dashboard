# Delta for Credit Card Summary

**Scope.** Rewrite the card money model after the ledger removal: `statement_balance` becomes permanently `null` instead of a computed cycle figure, card metrics keep deriving from the manual `balance`, the detail view stops rendering a statement figure, the "balance is not patchable" prohibition is reversed in favour of the manual balance write, and the delete-with-movements conflict stops being reachable from removed data. Slice S3.

**Edge cases.** A card may keep a `statement_day` while having no statement figure; the UI MUST omit the figure rather than render `$ 0.00`. A negative or zero limit cannot exist (creation constraint), so `usage_pct` never divides by zero. A card whose manual balance is positive (overpayment/credit) MUST still produce coherent used/available/usage values.

**Non-goals.** No billing-cycle close process, no statement generation, no card-linked expense tracking, no new card fields or endpoints, no change to limit/cycle-day editing rules.

## MODIFIED Requirements

### Requirement: Balance Types

The system MUST expose exactly one money figure per card: the manual balance. `statement_balance` MUST be `null` on every account read — list and detail — because its only source (card-linked expenses) no longer exists; it MUST NOT be substituted with the balance, with zero, or with any other derived value. The cycle attributes (`statement_day`, `payment_due_day`) MUST be preserved as metadata for due-date awareness. Every derived card metric MUST be computed from `balance` and `credit_limit` alone.
(Previously: `statement_balance` was the negated sum of card-linked expenses up to the billing cutoff, computed by a second query only in the detail read; the current balance was a trigger-maintained value.)

#### Scenario: Statement balance is always null

- GIVEN any card with any balance
- WHEN `GET /accounts` or `GET /accounts/{id}` returns it
- THEN `statement_balance` is `null`

#### Scenario: Metrics derive from the manual balance

- GIVEN a card with `credit_limit: "1000.00"` and balance `"-350.00"`
- WHEN the summary is requested
- THEN `used_balance` is `"350.00"`, `available_balance` is `"650.00"` and `usage_pct` is `35.00`
- AND no removed aggregate endpoint is queried

#### Scenario: Cycle days preserved without a statement figure

- GIVEN a card with `statement_day: 15` and `payment_due_day: 25`
- WHEN the card renders
- THEN both days remain editable metadata and no statement figure is shown

### Requirement: Card Detail View

The FE MUST render card detail from existing `GET /accounts/{id}` (límite, disponible, día de corte, día de pago, alerta) plus the Rust-computed `used/available/usage_pct/alert ok|warn|high` values, all derived from the manual balance. The detail MUST NOT render a statement-balance figure, and MUST NOT print `$ 0.00` or `"no disponible"` in its place — the element is omitted. List views MUST NOT issue per-card queries. Amounts MUST be coerced string→number only in the pure transform layer and formatted COP.
(Previously: the detail included `statement_balance` as the cycle-to-date debt and the anti-N+1 rule existed to avoid per-card statement queries.)

#### Scenario: Detail shows limit and alert

- GIVEN a card with limit `"1000.00"` and balance `"-910.00"`
- WHEN the detail renders
- THEN it shows usado `"910.00"`, disponible `"90.00"`, alerta `high`, corte/pago days
- AND it shows no statement figure

#### Scenario: Card without a statement figure renders honestly

- GIVEN a card whose `statement_balance` is `null`
- WHEN the detail renders
- THEN the statement element is absent and no placeholder zero is printed

#### Scenario: No per-card query in lists

- GIVEN a card list of N cards
- WHEN the list renders
- THEN the request count does not grow with N and no statement aggregate is requested

### Requirement: No Card Limit Patch

`PATCH` of `credit_limit`, `statement_day` or `payment_due_day` SHALL NOT exist; limit or cycle-day changes MUST be DELETE + recreate, explained in Spanish copy with confirmation of the destructive recreate. The manual `balance` write is the single exception: `PATCH /api/accounts/{id}` accepts `balance` for every account type, cards included (see `finance-accounts`). The previous rationale — never rewriting card-linked history — no longer applies because that history is removed by this change.
(Previously: all four fields including `balance` were non-patchable, and both limit and cycle-day changes required delete + recreate.)

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

The BE card contract MUST remain: `chk_card_*` CHECKs validated to 422 with Spanish messages (never 500), `deny_unknown_fields`, string money, 401 unauthenticated, 404 foreign (never 403) and 409 on duplicate name. The delete guard MUST NOT consult removed tables: after this change no surviving table holds a blocking reference to an account, so deleting an owned card MUST return 204, and the delete path MUST NOT claim "card has movements" from removed data. The FE MUST surface these outcomes in Spanish via `finance.*`/`cards.*` keys.
(Previously: deleting a card with linked movements returned 409 and kept the card.)

#### Scenario: Card deletion succeeds after the removal

- GIVEN an owned card with any balance
- WHEN the user confirms deletion
- THEN the system returns 204 and the card is gone

#### Scenario: Duplicate name conflicts

- GIVEN a user with a card named `"Visa"`
- WHEN they create another card named `"Visa"`
- THEN the system returns 409 with a Spanish message

#### Scenario: Foreign card reads as not found

- GIVEN an authenticated user
- WHEN any card read or write targets a foreign id
- THEN the system returns 404 and never 403
