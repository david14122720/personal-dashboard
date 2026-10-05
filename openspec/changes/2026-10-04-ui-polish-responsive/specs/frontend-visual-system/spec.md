# Delta for Frontend Visual System

**Scope.** A new cross-cutting capability: the presentation rules that make the five areas (Dashboard, Finanzas, Productividad, Configuración, Login) read as one product and survive a 375px viewport. It governs surfaces, type ranks, control states, touch floors, responsive form and detail layouts, empty-state coverage and reveal motion. It changes no behaviour: every requirement below is satisfied by class strings, tokens and layout only.

**Edge cases.** Compact chips inside card headers are the single sanctioned exception to the 44px touch floor (≥36px), because a 44px chip would dominate a dense header. The login hero keeps its `rounded-2xl` radius as a deliberate one-off against the in-app `rounded-xl` card. Charts keep a fixed fallback width when their container cannot be measured (server render, jsdom), so an unmeasurable environment degrades to today's rendering rather than an empty chart. Reduced motion is already forced globally, so reveal animations need no per-component guard beyond keeping the `motion-reduce:*` classes that tests assert.

**Non-goals.** No component library, no dependency, no new aesthetic direction, no dark/light rework, no behaviour, route, logic, data or API change, no reachability change, no accessibility rework beyond preserving what exists, no cleanup of dead code, and no polish of areas outside the five (Habits, Progreso, Reportes) beyond shared primitives.

## ADDED Requirements

### Requirement: Canonical Surface And Typography

Every card, panel, row, title and subtitle in the five areas MUST use one canonical class string per visual role, defined in `openspec/changes/2026-10-04-ui-polish-responsive/design.md`. Colours MUST come from `@theme` tokens; a surface colour that exists only as a raw hex literal MUST be promoted to a token instead of repeated. Section titles MUST share one rank across areas, and page titles MUST keep their existing rank.

#### Scenario: One card shell per role

- GIVEN the five areas rendered at any viewport
- WHEN their section cards are compared
- THEN each card uses the canonical shell `rounded-xl border border-hull bg-panel/90 p-4 sm:p-5` (the tight telemetry variant and the login hero excepted)

#### Scenario: No raw hex surface

- GIVEN the component sources of the five areas
- WHEN they are grepped for `bg-[#` surface literals
- THEN zero matches remain, because the colours are `@theme` tokens

#### Scenario: One section title rank

- GIVEN a Dashboard section, a Finance section, a Productivity section and a Configuración card
- WHEN their `h2` elements are compared
- THEN all four use `font-display text-base font-medium tracking-wide`

#### Scenario: Readable data floor

- GIVEN any rendered value a person must read (amount, date, count, badge)
- WHEN its computed font size is measured
- THEN it is at least 11px, and secondary prose is at least 12px

### Requirement: Interactive Control States And Touch Targets

Buttons, fields, pills and icon controls MUST define a hover state, MUST keep the global visible focus indicator, and MUST meet the touch floor: 44px for real controls, 36px for compact chips inside card headers. Disabled controls MUST look disabled. No control may be shrunk below the floor to make a layout fit.

#### Scenario: Hover is never dead

- GIVEN any button, pill, toggle or icon control in the five areas
- WHEN the pointer hovers it
- THEN a visible style change occurs (border, background, text colour or shadow)

#### Scenario: Touch floor

- GIVEN a 390px viewport
- WHEN every button, input, select and toggle in the five areas is measured
- THEN each is at least 44px tall, except compact card-header chips, which are at least 36px

#### Scenario: Fields share one look

- GIVEN the login fields, the settings fields and the finance/productivity form fields
- WHEN their classes are compared
- THEN each uses the canonical field string, including a focus ring, and no field is left without a focus style

#### Scenario: Focus stays visible

- GIVEN a keyboard-only user
- WHEN they tab through any of the five areas
- THEN every interactive element shows the global focus outline and no component removes it

### Requirement: Responsive Form And Detail Layouts

Multi-column layouts MUST collapse to a single column below the `sm` breakpoint. Forms MUST NOT place two fields side by side on a phone, and definition lists MUST NOT squeeze long localized values into half a phone.

#### Scenario: One field per line at 375px

- GIVEN a 375px viewport
- WHEN a subscription, asset, movement, transfer, account or balance form renders
- THEN its fields stack one per line and each field spans the full form width

#### Scenario: Two columns from sm upward

- GIVEN a viewport of 640px or more
- WHEN the same forms render
- THEN paired fields sit two per line as before

#### Scenario: Definition lists stack

- GIVEN a 375px viewport
- WHEN the sessions or tokens page renders its `dl`
- THEN each term and value occupies its own line

### Requirement: Empty State Coverage

Every list, aggregate and collection surface in the five areas MUST render the shared `EmptyState` when it has no data, with a title and an optional hint. A bare paragraph is not an empty state. Existing copy MUST be preserved; new titles are additive.

#### Scenario: No blank surfaces

- GIVEN a user with no bank accounts, no custom categories, no subscriptions, no sessions and no tokens
- WHEN the Configuración surfaces render
- THEN each shows the shared `EmptyState` with `role="status"`, a title and its hint

#### Scenario: Existing copy survives

- GIVEN the empty copy that existed before this change
- WHEN the empty states render
- THEN that copy is still present, unchanged

### Requirement: Reveal Motion

Content that appears on demand (disclosure panels, the calendar day detail, dialog cards) MUST use a declared `--animate-*` entrance and MUST keep reduced-motion safety. Layout-affecting animation and scroll-triggered motion MUST NOT be introduced.

#### Scenario: Disclosure reveals

- GIVEN a collapsed disclosure in Dashboard or Productividad
- WHEN it is expanded
- THEN its panel appears with the token-driven entrance animation

#### Scenario: Reduced motion respected

- GIVEN `prefers-reduced-motion: reduce`
- WHEN any reveal happens
- THEN the entrance is suppressed
