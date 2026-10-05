# Delta for Productivity Layout

**Scope.** Adds one requirement to the existing capability: the monthly calendar must be legible and overflow-free on a phone. The existing requirements — desktop grid balance, mobile form field legibility, collapsed creation forms, no horizontal overflow — keep their full force; this addition covers the calendar surface they never exercised, because the calendar is collapsed by default and the current no-overflow check never opens it.

**Edge cases.** Seven day cells plus six gaps must fit the width a 375px phone leaves inside the shell and the card padding, so cells flex horizontally while keeping a 44px minimum height for the thumb. Month navigation buttons keep a full 44×44 target. A day with more markers than fit stays readable because the counts use the legibility floor. The day-detail panel keeps its asserted reduced-motion class.

**Non-goals.** No change to the calendar's behaviour: the collapsed-by-default disclosure, month navigation, the event/task fetch windows, the marker semantics, the day-detail content, the accessible grid roles and the weekday order all stay exactly as they are.

## ADDED Requirements

### Requirement: Calendar Mobile Legibility

The monthly calendar MUST fit a 375px viewport with the panel expanded, without horizontal overflow, MUST keep every day cell at least 44px tall, and MUST keep its day numbers, counts and month navigation legible and touchable. The grid's weekday order, marker semantics, accessible roles, panel identifiers and reduced-motion class MUST be preserved.

#### Scenario: Expanded calendar fits a phone

- GIVEN a 375px viewport with the calendar expanded
- WHEN the grid renders
- THEN the calendar panel's scroll width does not exceed its client width and no cell is clipped

#### Scenario: Cells stay touchable

- GIVEN a 390px viewport with the calendar expanded
- WHEN every day cell and month navigation button is measured
- THEN each is at least 44px tall

#### Scenario: Counts stay legible

- GIVEN a day with tasks and events
- WHEN its counts render on a phone
- THEN each count is at least 10px and the day number is at least 12px

#### Scenario: Empty month still explains itself

- GIVEN a month with no tasks and no events
- WHEN the calendar renders
- THEN it shows the shared empty state with the existing copy instead of a bare paragraph

#### Scenario: Grid contract preserved

- GIVEN the calendar rendered at any viewport
- WHEN its structure is inspected
- THEN the weekday order is Monday-first, task and event markers keep their distinct `data-marker` semantics, the day panel keeps its identifier and its `motion-reduce:transition-none` class, and the day detail still opens on selection
