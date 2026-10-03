# Delta for Finance Movements

**Scope.** The two add controls and the movements history become one panel in the Finance screen. Nothing about what the controls do, what the modal asks, or how the history renders and filters changes.

**Edge cases.** The controls are not gated by the history's `loading`/`error`/`empty` branches: a user whose history failed or is empty MUST still be able to add a movement. Focus return after closing the modal MUST still target the exact control that opened it, now that both controls live inside the history's card. The account filter set from a Cuentas row MUST keep highlighting the account inside the merged card.

**Non-goals.** No backend change, no new endpoint, no pagination change (the client-side window of 5 + "Ver más" ×10 and its filter reset belong to the previous in-flight change), no change to the history row contract, filters, or the `content-visibility` rule. The modal keeps its fields, validation and confirmation.

## MODIFIED Requirements

### Requirement: Add Expense And Income UI

The Finance screen MUST expose exactly two entry controls — add expense and add income — inside the **movements panel**: the same `SectionShell` that holds the history list and its filters, positioned above them, with no separate panel of their own and no card between the controls and the list. Each control opens a modal with: Amount (required), Account (required, owned accounts by name, never UUID input), Category (required, all owned categories without kind restriction), Date (required, `YYYY-MM-DD`, defaulting to today) and Description (optional). Client-side validation MUST block the request with Spanish messages when a required field is missing, the amount is not a valid decimal string, or it has more than 2 decimals. On success the modal MUST show a CSS-only confirmation (no toast library), refresh the `finance/movements` scope and close returning focus to the control that opened it. Cancel and Esc MUST close without sending a request. Every control MUST be keyboard reachable with visible focus and a hit area of at least 44×44 CSS pixels, and all copy MUST come from typed `finance.*` i18n keys. Neither control MAY be rendered inside the history's loading, error or empty branch.
(Previously: the requirement described the two controls without saying where they live, which allowed them to sit in a panel of their own next to the history.)

#### Scenario: Controls share the history panel

- GIVEN the Finance screen
- WHEN its movements panel is inspected
- THEN both entry controls appear inside the section that also holds the history list and its three filters, above the list

#### Scenario: Controls are operable while the history is empty

- GIVEN a user with no movements
- WHEN the movements panel renders
- THEN both entry controls are present and the history shows its Spanish empty state below them

#### Scenario: Saving an expense reflects in balance

- GIVEN a user on Finance
- WHEN they submit an expense of `25000` on account `A`, category `C`, dated today
- THEN `POST /movements` is sent with the amount as a decimal string
- AND on success the confirmation shows, the history revalidates in the same panel and the accounts section reflects the new balance

#### Scenario: Required validation blocks the request

- GIVEN the expense modal with no category selected
- WHEN the user submits
- THEN a Spanish validation message appears and no request is sent

#### Scenario: Esc closes and restores focus

- GIVEN an open modal
- WHEN the user presses Esc
- THEN the modal closes, no request is sent and focus returns to the opening control

#### Scenario: Editing and deleting from the history

- GIVEN a movement in the history list
- WHEN the user edits it (or deletes it after confirmation)
- THEN the FE sends the corresponding `PATCH` (or `DELETE`) and the balance shown on the account row updates
