# Delta for Finance Movements

**Scope.** Presentation-only pagination of the movements history list in the Finance screen: 5 rows initially, "Ver más" appends 10 more per activation until the list is exhausted, and any filter change resets the window to 5. The REST contract is untouched: `GET /api/movements` keeps returning all of the caller's rows ordered `occurred_on DESC` (`no pagination in v1`).

**Edge cases.** Fewer than 5 rows MUST render without a "Ver más" button. A filter whose result count equals the visible window MUST hide the button. Changing a filter back MUST NOT restore a previous window. Editing or deleting a movement MUST keep refreshing the `finance/movements` scope, and the visible window MUST stay valid when a row disappears.

**Non-goals.** No backend query parameters, no infinite scroll, no virtualization, no change to the filters themselves, no change to the add/edit/delete flows or to `content-visibility` row hints.

## MODIFIED Requirements

### Requirement: Movement History List

The Finance screen MUST render a movements history section listing the caller's movements in the API order (`occurred_on DESC`), paginated for presentation: the first **5** rows MUST render initially, a "Ver más" control MUST append the next **10** rows to the ones already visible (accumulative — never replacing), and the control MUST be absent once no further rows exist. Each row MUST show direction, amount formatted `es-CO`/`COP` through the existing money formatter, date in Spanish, category name, account name and the description when present. The section MUST offer filters by account, by category and by direction; changing any of them MUST reset the visible window to the first 5 **filtered** results without altering the filter itself, and clearing filters MUST restore the unfiltered first window. The account filter MUST be driven by the section's own account select (the removed account cards no longer set it). The section MUST handle `loading`, `error` and `empty` independently in Spanish, MUST refresh the `finance/movements` SWR scope after every mutation, and MUST apply `content-visibility: auto` to list rows. Server-side pagination MUST NOT be introduced.
(Previously: the section listed the most recent 50 movements with no pagination at all, and an account-card click set the account filter.)

#### Scenario: Initial window

- GIVEN 34 movements for the user
- WHEN the history renders
- THEN exactly the 5 most recent appear in `occurred_on` descending order and a "Ver más" control is present

#### Scenario: Ver más appends ten more

- GIVEN the initial 5-row window
- WHEN the user activates "Ver más"
- THEN 15 rows are visible in the same order and the rows already visible are not replaced

#### Scenario: Last window hides the control

- GIVEN 23 filtered results with 15 rows visible
- WHEN the user activates "Ver más"
- THEN all 23 rows are visible and the "Ver más" control is absent

#### Scenario: Filter change resets the window

- GIVEN a user who expanded the list to 25 visible rows
- WHEN they change the direction, category or account filter
- THEN the list shows the first 5 results of the new filter and the filter value itself is unchanged

#### Scenario: Few results render without the control

- GIVEN 3 movements for the user
- WHEN the history renders
- THEN 3 rows appear and no "Ver más" control exists

#### Scenario: Direction and category filters compose

- GIVEN movements of both directions in two categories
- WHEN the user filters direction `expense` and category `C`
- THEN only expense movements of `C` are listed, starting at the first 5

#### Scenario: Empty and error states

- GIVEN no movements, or a failed `GET /movements`
- WHEN the section renders
- THEN a Spanish `EmptyState` or a Spanish error panel with retry appears and the rest of Finance keeps rendering
