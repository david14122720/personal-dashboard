# Delta for Productivity Layout

**Scope.** The Productivity screen gains a full-width, collapsed-by-default calendar block rendered above the four existing sections, and the events read widens to both bounds so past months render. The four sections (Metas, Tareas, Eventos, Notas) keep their order, spans, collapsed forms and interaction invariants exactly. The canonical scope line that put "new components" out of bounds is superseded by exactly one new block component; no other new component, dependency or layout token is introduced.

**Edge cases.** The block is the first grid child at every breakpoint (one column on mobile, full 12 columns from `md`), so the four-section arithmetic is evaluated only among those four. The calendar fetches the 42-cell grid range, not the calendar month, so the leading/trailing days of adjacent months are populated. A month with no tasks or events renders the grid with zero counts, never a bare skeleton. The events request always sends RFC 3339 bounds (a bare `YYYY-MM-DD` is 422) and both bounds, so a past month is actually covered. The grid's day cells are ≥44×44 and the detail panel is keyboard operable; reduced motion suppresses transitions.

**Non-goals.** No change to the four sections' data contracts, forms, ordering or spans; no calendar on the Dashboard; no week/day views; no event creation from the calendar; no drag-and-drop or rescheduling; no date navigation beyond prev/next month and «Hoy»; no new dependency.

## MODIFIED Requirements

### Requirement: Productivity Desktop Grid Balance

The productivity screen MUST render a full-width calendar block as the first child of its 12-column grid, followed by its four sections (Metas, Tareas, Eventos, Notas) on a 12-column grid whose `xl`-breakpoint (≥1280px) spans sum to exactly 12 columns per row as two balanced rows of two sections of six columns each. The calendar block MUST span all 12 columns at every breakpoint. No row MAY leave a dead column region, and the four sections' order MUST stay Metas, Tareas, Eventos, Notas. Below `xl` the existing stacking MUST be preserved: one column on mobile, and on `md` Tareas/Eventos share a row while Metas/Notas stay full width.
(Previously: the screen rendered exactly four sections with no block above them.)

#### Scenario: Calendar is the first full-width block
- GIVEN `/dashboard/productividad/` at 390px, 768px and 1440px
- WHEN the screen renders
- THEN the calendar block is the first grid child and spans the full width at each breakpoint

#### Scenario: Balanced 2×2 at 1440px
- GIVEN a 1440×900 viewport
- WHEN the four sections render below the calendar
- THEN they appear as two rows of two equal-width columns and each row's spans equal 12

#### Scenario: Mobile and md stacking preserved
- GIVEN viewports of 390px and 768px
- WHEN the screen renders
- THEN mobile shows one section per row and `md` keeps Tareas/Eventos paired

#### Scenario: No horizontal overflow
- GIVEN each measured breakpoint (390, 768, 1440)
- WHEN `document.documentElement.scrollWidth` is compared with `clientWidth`
- THEN `scrollWidth` is not greater than `clientWidth`

### Requirement: Loading Skeleton Fidelity

The productivity loading skeleton MUST mirror the resolved layout: a full-width calendar placeholder above the four section placeholders, the same vertical rhythm between blocks and the same column spans per breakpoint as the real sections, so resolving the data MUST NOT produce a layout shift.
(Previously: the skeleton mirrored only the four sections.)

#### Scenario: Skeleton matches grid
- GIVEN the productivity route in its loading state
- WHEN the skeleton renders at 390px, 768px and 1440px
- THEN it includes the calendar placeholder and its block gaps and column spans equal those of the resolved screen

#### Scenario: No shift on resolve
- GIVEN the loading state transitioning to loaded data
- WHEN both are measured at the same viewport
- THEN the four section positions and the calendar position do not move

## ADDED Requirements

### Requirement: Productivity Calendar Block

The productivity screen MUST render a calendar block that:

- is collapsed by default and reuses the Dashboard disclosure pattern: an `h2` with a keyboard-operable `button[aria-expanded][aria-controls]` (visible focus, hit area ≥44×44 CSS pixels) and a panel target that stays in the DOM while its contents mount only when open;
- shows one month at a time with a Spanish title from the existing `formatMonth` helper (for example «oct 2026»), prev/next month controls and a «Hoy» reset, all keyboard reachable and ≥44×44;
- renders a Monday-first 42-cell grid (6 weeks) with `role="grid"`, Lun–Dom column headers and one `role="gridcell"` button per day, each ≥44×44; cells outside the month are visually muted, and today is visibly marked;
- shows, per day, how many tasks (by `due_date`) and how many events (overlap with `starts_at`/`ends_at`) fall on that day, using markers that are distinguishable **without colour alone** (a distinct glyph/shape per kind plus the count) and exposing the same information in the cell's accessible label in Spanish;
- expands a day detail when a cell is activated: a Spanish list of that day's tasks (title and state) and events (title and kind/time), with an empty state when the day has none; activating the same cell again collapses it, at most one day is expanded at a time, and the panel is keyboard operable (Esc collapses) and reduced-motion safe;
- fetches tasks from the existing tasks read and events with both bounds (`useEvents(from, to)`), converting the local `YYYY-MM-DD` grid range to RFC 3339 before the request, so the visible month and its adjacent day cells are always covered;
- uses only existing dependencies, existing colour tokens (no hardcoded hex) and typed `productivity.calendar*` i18n keys.

#### Scenario: Collapsed by default
- GIVEN `/dashboard/productividad/` freshly loaded
- WHEN the screen renders
- THEN the calendar panel is closed (`aria-expanded="false"`), no grid is mounted, and the trigger is visible first above Metas

#### Scenario: Monday-first month grid
- GIVEN a month beginning on a Thursday
- WHEN the grid renders
- THEN the first column is Lun, the first row starts with the Monday before the 1st, and the grid holds exactly 42 cells

#### Scenario: Task and event distinction without colour alone
- GIVEN a day with 2 tasks and 1 event
- WHEN its cell renders
- THEN the cell shows a task marker with count 2 and an event marker with count 1 whose shapes differ, and its accessible label reads a Spanish summary such as «15 de octubre: 2 tareas, 1 evento»

#### Scenario: Day detail expands and collapses
- GIVEN a day with one task and one event
- WHEN the user activates the cell
- THEN a Spanish panel lists that task and event, and activating the cell again collapses it

#### Scenario: Past months are actually fetched
- GIVEN the user navigates to a previous month
- WHEN the events request is issued
- THEN it contains both `from` and `to` as RFC 3339 datetimes covering the 42-cell grid range, and the month's tasks and events render

#### Scenario: Empty month still shows the grid
- GIVEN a month with no tasks and no events
- WHEN the calendar is open
- THEN the 42 cells render with zero counts and the day detail shows a Spanish empty state

#### Scenario: Accessible and reduced-motion safe
- GIVEN a keyboard-only user or `prefers-reduced-motion: reduce`
- WHEN they navigate months and open a day
- THEN focus is visible in reading order, controls are ≥44×44, and no animation is required for the state change

### Requirement: Calendar Visual Evidence

The change MUST ship Playwright evidence for the calendar block at 390×844 and 1440×900: full-page screenshots with the block collapsed and expanded, the measured grid (7 columns × 6 rows, Monday first), the task/event marker distinction and the day-detail panel. The W4 slice MUST NOT be accepted without this evidence.

#### Scenario: Evidence present and comparable
- GIVEN the change artifacts
- WHEN the evidence directory is inspected
- THEN it contains before/after captures for both viewports plus the grid and marker measurements
