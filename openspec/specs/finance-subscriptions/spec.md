# finance-subscriptions Specification

## Purpose

Lifecycle management of recurring financial commitments (subscriptions), including tracking of costs and activation status.

## Requirements

### Requirement: Subscription Management

The system MUST allow users to create, read, edit and delete subscription records. A subscription MUST carry a `name`, a `price` (decimal string, required, ≥ 0) and a monthly due date `next_billing_on` (`YYYY-MM-DD`, required). `frequency` is fixed to `monthly`: the create request MAY omit it and MUST be rejected with 422 when it carries any value other than `monthly`; the persisted `subscription_frequency` column and enum stay in the database as vestigial and MUST NOT be surfaced by any UI. Create returns 201 with the record `active`; edit uses the PATCH allowlist defined in "Subscription Cancel and Reactivate".
(Previously: create accepted any of the seven `subscription_frequency` values and an optional `next_billing_on`; there was no edit beyond the active flag.)

#### Scenario: Create Subscription

- GIVEN an authenticated user
- WHEN the user creates a subscription with a name, an amount, a monthly due date and no frequency
- THEN the system SHALL create the record with `frequency = monthly` and status `active`
- AND return 201 Created

#### Scenario: Create Free Subscription

- GIVEN an authenticated user
- WHEN the user creates a subscription with a cost of 0.00
- THEN the system SHALL accept the record (Free tiers supported)
- AND return 201 Created

#### Scenario: Invalid Cost Format

- GIVEN an authenticated user
- WHEN the user submits a subscription with an invalid cost string or more than 2 decimals
- THEN the system MUST return 422 Unprocessable Entity

#### Scenario: Frequency forced monthly

- GIVEN an authenticated user
- WHEN they create a subscription explicitly sending `frequency: "weekly"`
- THEN the system MUST return 422
- AND a create sending `frequency: "monthly"` or omitting it MUST store `monthly`

#### Scenario: Missing due date rejected

- GIVEN an authenticated user
- WHEN they create a subscription without `next_billing_on`
- THEN the system MUST return 422 with a Spanish message

### Requirement: Lifecycle Management

The system MUST support activation and cancellation of subscriptions, and MUST require an active subscription to be payable: `POST /subscriptions/{id}/pay` on a cancelled subscription MUST return 422 with a Spanish message.
(Previously: lifecycle covered only activation and cancellation; the pay endpoint did not exist.)

#### Scenario: Cancel Subscription

- GIVEN an active subscription
- WHEN the user marks it as cancelled
- THEN the system SHALL update the status to `cancelled`
- AND return 200 OK

#### Scenario: Reactivate Subscription

- GIVEN a cancelled subscription
- WHEN the user marks it as active
- THEN the system SHALL update the status to `active`
- AND return 200 OK

#### Scenario: Cancelled subscription is not payable

- GIVEN a cancelled subscription
- WHEN `POST /subscriptions/{id}/pay` is called with a valid account
- THEN the system returns 422 with a Spanish message and records nothing

### Requirement: Category Scoping

The system MUST verify only that a supplied `category_id` is owned by the caller; the category kind MUST NOT gate the write (D3). A foreign or missing category MUST yield 422 in Spanish, never 404. Categories of any kind MUST be accepted on create and edit, and the previous cross-kind 422 MUST be gone.
(Previously: the category had to be of kind `subscription`, and any other kind — including `finance` — was rejected with 422.)

#### Scenario: Owned category of any kind accepted

- GIVEN an authenticated user owning a `finance`-kind category `Suscripciones`
- WHEN they create or edit a subscription linked to that category
- THEN the system returns 201/200 and stores the link

#### Scenario: Foreign or missing category still rejected

- GIVEN an authenticated user
- WHEN the subscription write references a category owned by another user or a non-existent id
- THEN the system returns 422 with a Spanish message and persists nothing

### Requirement: Ownership & Security

The system MUST restrict access to the user's own subscriptions across read, edit, lifecycle, delete and pay.
(Previously: the requirement listed modification only; pay did not exist.)

#### Scenario: Unauthorized Access

- GIVEN an authenticated user
- WHEN the user attempts to modify a subscription belonging to another user
- THEN the system MUST return 404 Not Found

#### Scenario: Foreign Pay reads as not found

- GIVEN an authenticated user
- WHEN they call `POST /subscriptions/{foreign_id}/pay` with one of their own accounts
- THEN the system returns 404, never 403, and no movement is created

### Requirement: Subscription Create Form

The FE MUST provide the subscription create and edit form in **Settings** (not Finance): name, price as a decimal string, monthly due date `YYYY-MM-DD`, category by name and payment method. No frequency selector MAY be rendered (the write is monthly). Create sends `POST /subscriptions`; edit sends the widened `PATCH /subscriptions/{id}`. Selectors MUST be by name, never UUID input; mutations MUST refresh the `finance/` SWR scope; all copy MUST come from typed `finance.*` i18n keys; currency is always COP.
(Previously: the form lived in Finance and included a seven-value frequency selector plus an optional next-billing date.)

#### Scenario: User creates subscription

- GIVEN an authenticated user in Settings
- WHEN they submit name `"Streaming"`, price `"19900"`, next billing `2026-10-15` and a category
- THEN the FE sends `POST /subscriptions` with price as a string, no frequency field, and refreshes the `finance/` SWR scope

#### Scenario: User edits subscription

- GIVEN an existing subscription in Settings
- WHEN the user changes the price and the monthly due date and saves
- THEN the FE sends `PATCH /subscriptions/{id}` with only allowlisted fields and shows the updated values

#### Scenario: Invalid price blocked with Spanish error

- GIVEN a user typing price `"abc"` in the subscription form
- WHEN they submit
- THEN the FE shows a Spanish validation error and sends no request

#### Scenario: No frequency control

- GIVEN the Settings subscription form rendered
- WHEN its inputs are inspected
- THEN no frequency selector is present and the monthly cadence is copy, not a choice

### Requirement: Subscription Cancel and Reactivate

The FE MUST expose cancelar/reactivar actions using `PATCH /subscriptions/{id}`. The PATCH allowlist MUST be exactly `name`, `price`, `next_billing_on` and `is_active`; any other field — including `frequency`, `currency`, `category_id`, `payment_method`, `url` and `notes` — MUST remain rejected with 422 by `deny_unknown_fields`. `price` MUST follow the string-money rules (decimal string, ≥ 0, at most 2 decimals) and `next_billing_on` MUST be `YYYY-MM-DD`. The system MUST own the cancel lifecycle: `is_active=false` stamps `cancelled_at = now()` and `is_active=true` clears it.
(Previously: the PATCH accepted only `is_active`; name, price and due date were not writable.)

#### Scenario: User cancels subscription

- GIVEN an active subscription `{id}`
- WHEN the user confirms cancellation
- THEN the FE sends `PATCH /subscriptions/{id}` with `{"is_active": false}` and shows state cancelled

#### Scenario: User reactivates subscription

- GIVEN a cancelled subscription `{id}`
- WHEN the user reactivates it
- THEN the FE sends `PATCH /subscriptions/{id}` with `{"is_active": true}` and shows state active

#### Scenario: Edit accepts the widened allowlist

- GIVEN an owned subscription
- WHEN `PATCH /subscriptions/{id}` sends `{"name":"Nuevo","price":"29900.00","next_billing_on":"2026-11-15"}`
- THEN the system returns 200 with the new values

#### Scenario: Non-allowlisted fields stay rejected

- GIVEN an owned subscription
- WHEN `PATCH /subscriptions/{id}` sends `{"frequency":"annual"}`, `{"currency":"USD"}` or `{"category_id":"<uuid>"}`
- THEN the system returns 422 with a Spanish message and the row is unchanged

### Requirement: Subscription Delete

The FE MUST expose borrar with explicit confirmation using `DELETE /subscriptions/{id}` (204). Deleting a subscription MUST preserve its recorded movements: the `movements.subscription_id` reference is `ON DELETE SET NULL`, so the movement rows (amount, date, category, description) survive as audit with the link cleared.
(Previously: delete was a plain 204 with no linked rows to preserve.)

#### Scenario: User deletes subscription

- GIVEN a subscription `{id}`
- WHEN the user confirms deletion
- THEN the FE sends `DELETE /subscriptions/{id}` and removes it from the list

#### Scenario: Movements survive the delete

- GIVEN a subscription with two paid-cycle movements
- WHEN `DELETE /subscriptions/{id}`
- THEN the system returns 204 and both movements still exist with `subscription_id = NULL` and their amounts and dates intact

### Requirement: Subscription Contract Preserved

The BE contract is updated by this change: authentication required (401), foreign access → 404 never 403, `price` as a decimal string, category ownership required with no kind gate, `deny_unknown_fields`, Spanish errors, and 401/404/409/422 for the statuses each endpoint defines. The new `POST /subscriptions/{id}/pay` is part of the contract; the FE MUST surface those errors in Spanish via typed i18n keys and MUST NOT invent any other endpoint or field.
(Previously: the contract named the kind gate and had no pay endpoint or 409.)

#### Scenario: Foreign subscription reads as not found

- GIVEN an authenticated user
- WHEN the FE requests `PATCH /subscriptions/{foreign_id}` (e.g. stale id)
- THEN the BE returns 404 and the FE shows the Spanish not-found message

#### Scenario: Double-pay conflict is surfaced in Spanish

- GIVEN a subscription already paid this cycle
- WHEN the pay action is attempted
- THEN the BE returns 409 and the FE shows the Spanish message resolved from a typed key

### Requirement: Subscription Manual ES COP Contract

All subscription UI MUST be manual (selectors by name, never UUID input), Spanish-only, COP-only, with shared manual-amount normalization and monthly billing fixed in the UI. The wire keeps `frequency` and `payment_method` fields for compatibility, but the UI MUST NOT render a frequency selector or present any cadence other than monthly; the Finance amount shows the monthly price. Money stays a string on the wire.
(Previously: the hook exposed `frequency` because the UI offered the seven-frequency choice and displayed a frequency label per row.)

#### Scenario: List shows amount and paid state

- GIVEN subscriptions `"Streaming"` `"19900.00"` due 2026-10-15 and `"Gym"` paid this cycle
- WHEN the Finance section renders
- THEN each row shows its COP-formatted price, its due date, and a "Pagado este ciclo" state for the paid one

#### Scenario: No frequency control in the manual flow

- GIVEN the subscription UI (Finance rows and Settings form)
- WHEN it is inspected
- THEN no frequency selector, badge or label other than monthly is rendered

### Requirement: Payment Method Catalog Stability

The payment-method catalog offered by the subscription form MUST keep the "Transferencia" option available after the transfers feature is removed. That option is a payment method recorded as free text on the subscription row and is semantically unrelated to the removed transfers capability; it MUST NOT be deleted, renamed or migrated by this change. The debt payment form no longer exists (see `finance-debts`), and no other catalog consumer has been added.
(Previously: the requirement also covered the debt payment form's selector, which this change removes.)

#### Scenario: Transferencia remains selectable

- GIVEN the subscription create form
- WHEN the payment-method selector is opened
- THEN "Transferencia" is present as an option alongside the other methods

#### Scenario: Stored value still renders

- GIVEN a subscription whose `payment_method` is "Transferencia"
- WHEN the subscriptions list renders
- THEN the row shows "Transferencia" and the stored value is unchanged

### Requirement: Subscription Pay Action

The system MUST expose `POST /api/subscriptions/{id}/pay` with `deny_unknown_fields` accepting exactly `account_id` (an owned account). In one database transaction it MUST: insert a movement (`direction=expense`, `amount` equal to the subscription price, `occurred_on` = today in `America/Bogota`, the given `account_id`, the fixed `Suscripciones` category and `subscription_id` = the paid subscription); apply the negative signed delta to the account balance; set `last_paid_on` to that same date; and advance `next_billing_on` (see "Subscription Cycle State"). It MUST return 200 OK with the updated subscription. Guards: 401 unauthenticated; 404 for a foreign or missing subscription or account (never 403); 422 for an inactive subscription; 422 for a `price = 0.00` subscription (a zero movement cannot satisfy `amount > 0`) with the UI hiding Pay for that row; 409 with a Spanish message for a subscription already paid this cycle (typed i18n key, e.g. `finance.subscriptionPaidThisCycle`). Pay MUST NOT be implemented as a client-side orchestration of PATCH + POST.

#### Scenario: Pay debits and records atomically

- GIVEN an active subscription priced `"19900.00"`, account `A` with balance `"100000.00"` and no payment this cycle
- WHEN `POST /subscriptions/{id}/pay` with account `A`
- THEN the response is 200, `A.balance` is `"80099.00"`, exactly one expense movement of `"19900.00"` exists with the `Suscripciones` category and the subscription link, and `last_paid_on` is today

#### Scenario: Double-pay in the same cycle is blocked

- GIVEN a subscription already paid this cycle
- WHEN the pay action runs again
- THEN the system returns 409 with a Spanish message, creates no movement and leaves the balance unchanged

#### Scenario: Free subscription cannot be paid

- GIVEN a subscription priced `"0.00"`
- WHEN the pay action runs
- THEN the system returns 422 with a Spanish message and the UI offers no Pay control for that row

#### Scenario: Foreign or missing account reads as not found

- GIVEN an authenticated user
- WHEN `POST /subscriptions/{id}/pay` references a foreign or missing account id
- THEN the system returns 404 and records nothing

#### Scenario: Pay error leaves no partial effect

- GIVEN a pay request whose account is concurrently deleted
- WHEN the transaction fails on the foreign key
- THEN the API returns a Spanish 4xx, no movement exists and no balance was adjusted

#### Scenario: Pay modal picks an account and confirms

- GIVEN a subscription row with an enabled Pay control
- WHEN the user activates Pay, picks account `A` in the modal and confirms
- THEN the FE sends only `{account_id}` to the pay endpoint, shows a CSS-only confirmation and revalidates the subscription row and the account card

### Requirement: Subscription Cycle State

The paid state MUST be derived lazily from stored fields with no scheduler: a subscription is "paid this cycle" when `last_paid_on IS NOT NULL AND next_billing_on > today`, where today is the current date in `America/Bogota`. The Pay action MUST advance `next_billing_on` to the first monthly occurrence strictly after `max(pay_date, stored_due)` (the pay date and the stored due date, whichever is later), stepping calendar months from the stored value and clamping each step to the last valid day of the target month (31 Jan → 28/29 Feb); when `next_billing_on` is NULL at pay time it MUST be set to the pay date plus one calendar month, clamped. The FE MUST derive and render "Pagado este ciclo" during render (no effect-stored state, no timer) and MUST offer Pay again once `next_billing_on <= today`. No cron, worker or background job SHALL exist.

#### Scenario: Paid flag flips when the due date arrives

- GIVEN a subscription paid on 2026-09-24 with `next_billing_on = 2026-10-15`
- WHEN today becomes 2026-10-15
- THEN the paid state is false without any background job and Pay is enabled; paying advances `next_billing_on` to 2026-11-15

#### Scenario: Early payment counts for the cycle

- GIVEN a subscription due 2026-09-15 and paid on 2026-09-10
- WHEN today is 2026-09-24
- THEN it reads paid this cycle and a second pay is blocked

#### Scenario: Month-end clamping

- GIVEN a subscription with `next_billing_on = 2026-01-31`
- WHEN it is paid
- THEN `next_billing_on` becomes 2026-02-28 (2026-02-29 in a leap year) and never an invalid date

#### Scenario: Long-dormant subscription jumps to the next future occurrence

- GIVEN `next_billing_on = 2026-04-15` and today 2026-09-24
- WHEN it is paid
- THEN `next_billing_on` becomes 2026-10-15 (the first occurrence after today), not 2026-05-15

#### Scenario: Null due date is set on first pay

- GIVEN a subscription with `next_billing_on = NULL`
- WHEN it is paid
- THEN `next_billing_on` is set to the pay date plus one calendar month, clamped

#### Scenario: No scheduler exists

- GIVEN the deployed backend
- WHEN its processes and configuration are inspected
- THEN no cron, worker, queue or timer resets subscription state

### Requirement: Fixed Suscripciones Category Seed

The fixed movement category for subscription payments MUST be the category named `Suscripciones` with kind `finance`, resolved by an idempotent upsert keyed on `(user_id, 'finance', 'Suscripciones')` inside the Pay transaction (or an equivalent idempotent seed on first need). Re-running the seed MUST return the same row and MUST NOT duplicate it. A same-named row under a different kind (e.g. a `subscription`-kind `Suscripciones`) MUST be left untouched: the `UNIQUE(user_id, kind, name)` key allows both to coexist, and the seed MUST NOT rename, delete or mutate user-owned rows; no suffix or auto-rename convention SHALL be introduced. The Pay action MUST reference the seeded row's `id` directly (never resolve by name at pay time), and because kinds are no longer surfaced in the UI (D3) the row appears as an ordinary category in pickers and charts.

#### Scenario: Seed is idempotent

- GIVEN a user with no `Suscripciones` category
- WHEN the seed runs twice
- THEN exactly one `(finance, 'Suscripciones')` row exists and both resolutions return the same id

#### Scenario: Same-name other-kind row is untouched

- GIVEN a user-owned category `Suscripciones` with kind `subscription`
- WHEN the seed runs
- THEN a `finance`-kind `Suscripciones` row is created or reused and the `subscription`-kind row is byte-identical

#### Scenario: Pay uses the seeded id

- GIVEN a completed pay action
- WHEN the created movement is inspected
- THEN its `category_id` equals the seeded `(finance, 'Suscripciones')` row id

#### Scenario: Seed row is a normal category

- GIVEN the seeded row
- WHEN the movement category picker renders
- THEN `Suscripciones` appears as an ordinary row with no kind badge
