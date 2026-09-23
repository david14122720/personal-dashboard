# Productivity Layout Specification

## Purpose

Layout integrity of the `/dashboard/productividad/` screen: a balanced desktop grid at `xl`, legible single-column forms on mobile, collapsed creation forms behind a per-section «Nuevo» control, a loading skeleton that mirrors the real grid, normalized vertical rhythm, ≥44px touch targets, and visual evidence at 390px and 1440px.

## Scope

- In: layout classes and interaction state of `components/containers/ProductivityScreens.tsx`, `components/productivity/ProductivitySections.tsx` and `components/productivity/ProductivityForms.tsx` (grid spans, form column behaviour, skeleton, vertical rhythm, touch-target hit areas, collapsed/expanded form state). New user-visible copy for the «Nuevo» control.
- Out: productivity data contracts and API behaviour, copy semantics of existing fields, other screens (`FinanceScreens`, reports, progress), new components, new dependencies, tracing/metrics.
- Slice: S4 (Track B) — independent of Track A, zero data risk, merges first.

## Requirements

### Requirement: Productivity Desktop Grid Balance

The productivity screen MUST place its four sections (Metas, Tareas, Eventos, Notas) on a 12-column grid whose `xl`-breakpoint (≥1280px) spans sum to exactly 12 columns per row, arranged as two balanced rows of two sections of six columns each. No row MAY leave a dead column region, and section order MUST stay Metas, Tareas, Eventos, Notas. Below `xl` the current stacking MUST be preserved: one column on mobile, and on `md` Tareas/Eventos share a row while Metas/Notas stay full width.

#### Scenario: Balanced 2×2 at 1440px

- GIVEN a 1440×900 viewport on `/dashboard/productividad/`
- WHEN the four sections render
- THEN they appear as two rows of two equal-width columns
- AND no dead column remains to the right of either row

#### Scenario: Span arithmetic sums to 12

- GIVEN the rendered section containers
- WHEN their `xl` column spans are added per row
- THEN the first row equals 12 and the second row equals 12

#### Scenario: Mobile and md stacking preserved

- GIVEN viewports of 390px and 768px
- WHEN the screen renders
- THEN mobile shows one section per row and `md` keeps Tareas/Eventos paired

#### Scenario: No horizontal overflow

- GIVEN each measured breakpoint (390, 768, 1440)
- WHEN `document.documentElement.scrollWidth` is compared with `clientWidth`
- THEN `scrollWidth` is not greater than `clientWidth`

### Requirement: Mobile Form Field Legibility

Every productivity form field grid MUST use one column below the `sm` breakpoint and two columns from `sm` upward. Fields that occupy a full row MUST use a `sm`-prefixed span so they keep spanning both columns when the two-column layout applies. At 390px every `date`, `datetime-local`, `select` and text input MUST render at the full available form width, without clipping its native picker affordance and without truncating its label or value.

#### Scenario: One field per line at 390px

- GIVEN a 390×844 viewport with a form expanded
- WHEN the form renders
- THEN each field occupies its own row at full width

#### Scenario: Date input not clipped

- GIVEN the same viewport
- WHEN a date field's bounding box is measured
- THEN its width equals the form content width and the full value is readable

#### Scenario: Two columns from sm upward

- GIVEN a viewport 640px or wider
- WHEN the form renders
- THEN fields pair into two columns and full-row fields still span both columns

### Requirement: Collapsed Creation Forms Behind «Nuevo»

Each productivity section MUST render its list by default and MUST keep its creation form collapsed on mount, revealed by a per-section «Nuevo» control. Submitting or cancelling MUST collapse the form again. «Editar» on a row MUST open the same form pre-filled with that row's values, and cancelling the edit MUST return to the collapsed state. At most one form MAY be open at a time across the four sections; opening another MUST discard the previous draft. A section with an empty list MUST still expose its «Nuevo» control (no dead-end empty state).

#### Scenario: Forms start collapsed

- GIVEN `/dashboard/productividad/` freshly loaded
- WHEN the four sections render
- THEN no creation form is present and each section shows its list plus a «Nuevo» control

#### Scenario: Save or cancel collapses

- GIVEN an open creation form
- WHEN the user submits a valid entry or cancels
- THEN the form collapses and the list reflects the resulting state

#### Scenario: Edit pre-fills and collapses on cancel

- GIVEN a list row
- WHEN the user chooses «Editar» and then cancels
- THEN the form opened pre-filled with that row's values and returned to collapsed

#### Scenario: Single open form invariant

- GIVEN a form open in one section
- WHEN the user opens «Nuevo» or «Editar» in another section
- THEN only the newly opened form remains open

#### Scenario: Empty list still offers entry

- GIVEN a section with zero rows
- WHEN the section renders
- THEN the «Nuevo» control is visible and reachable

#### Scenario: Toggle accessible with focus preserved

- GIVEN a keyboard-only user, or `prefers-reduced-motion: reduce`
- WHEN the «Nuevo» control is toggled
- THEN it shows visible focus, exposes its expanded/collapsed state, and revealing the form requires no animation

### Requirement: Loading Skeleton Fidelity

The productivity loading skeleton MUST mirror the resolved layout: the same vertical rhythm between blocks and the same column spans per breakpoint as the real sections, so resolving the data MUST NOT produce a layout shift.

#### Scenario: Skeleton matches grid

- GIVEN the productivity route in its loading state
- WHEN the skeleton renders at 390px, 768px and 1440px
- THEN its block gaps and column spans equal those of the resolved sections

#### Scenario: No shift on resolve

- GIVEN the loading state transitioning to loaded data
- WHEN both are measured at the same viewport
- THEN section positions do not move

### Requirement: Normalized Vertical Rhythm

The productivity screen MUST apply a single, uniform vertical gap between a section's header, its form region and its list. Nested wrappers MUST NOT double the between-block spacing, and the rhythm MUST be identical across the four sections.

#### Scenario: Uniform spacing across sections

- GIVEN the four sections rendered with a form collapsed and expanded
- WHEN the vertical gaps between header, form and list are measured
- THEN all four sections report the same gap value

### Requirement: Touch Target Minimum

Every interactive control in a productivity list row or section header (including «Editar», «Eliminar», «Nuevo» and any status toggle) MUST expose a hit area of at least 44×44 CSS pixels, be reachable by keyboard, and show visible focus. Any state transition MUST be suppressed under `prefers-reduced-motion: reduce`.

#### Scenario: Measured hit area at 390px

- GIVEN a 390×844 viewport with populated lists
- WHEN each row control's bounding box is measured
- THEN width and height are each at least 44 CSS pixels

#### Scenario: Keyboard reachable

- GIVEN a keyboard-only user
- WHEN they tab through a section
- THEN every row control receives visible focus in reading order

### Requirement: Visual Evidence Gate

The change MUST ship Playwright evidence for `/dashboard/productividad/` at 390×844 and 1440×900: full-page screenshots captured before and after the fix, the horizontal-overflow measurement, and the bounding boxes of the date/select inputs. The S4 slice MUST NOT be accepted without this evidence.

#### Scenario: Evidence present and comparable

- GIVEN the change artifacts
- WHEN the evidence directory is inspected
- THEN it contains before/after captures for both viewports plus the overflow and input-box measurements

## Edge cases

- Widths between 1280px and 1439px MUST use the same balanced `xl` arrangement (no intermediate overflow).
- A form opened at 390px and then resized to ≥640px MUST re-flow to two columns without losing field values.
- Rapid toggling of «Nuevo» MUST leave at most one form open and MUST NOT leave an orphaned empty form.
- A section whose list is long MUST keep its «Nuevo» control reachable without hiding the list.
- Long note/task text MUST NOT force horizontal overflow or shrink a row control below the touch target minimum.

## Non-goals

- No change to productivity API contracts, validation, payloads or persistence.
- No redesign of `md`/mobile grids beyond the stated form column behaviour.
- No change to Finance screens, reports or progress layouts.
- No new component library, dependency or global spacing token refactor.
- No copy rewrite beyond the new «Nuevo» control label (which MUST come from the typed ES dictionary).
