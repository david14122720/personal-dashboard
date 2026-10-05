# Delta for Frontend Dashboard

**Scope.** Adds one requirement to the existing capability: the mobile bottom tab bar must fit a 375px viewport while keeping every destination it exposes today. The bar's destinations, order, active-state contract, aria wiring and route set are unchanged; only its layout, item sizing and the `main` padding that clears it are specified here.

**Edge cases.** The bar carries seven destinations (four primary plus three settings) whose labels include the long `Productividad` and `Tokens de API`. At 375px a single row cannot hold them without truncation, so the bar lays out as two rows; the second row is not hidden behind a menu, and no destination becomes unreachable. The taller bar requires the content area to reserve more bottom padding, otherwise the last card of a page sits under the bar.

**Non-goals.** No change to which destinations the bar exposes, no reordering, no new navigation entry, no hamburger, no sheet, no scrollable tab strip, no change to the desktop rail or the top bar.

## ADDED Requirements

### Requirement: Mobile Bottom Bar Fit

Below the `md` breakpoint the bottom tab bar MUST present every destination it exposes today, MUST fit a 375px viewport without horizontal overflow, MUST give each item a touch target of at least 44px, and MUST reserve space for the device safe area. The content area MUST reserve enough bottom padding that no page content is hidden behind the bar. Active-state semantics (`aria-current="page"`), the `aria-label` of the navigation landmark and the skip link MUST be preserved.

#### Scenario: Every destination stays reachable

- GIVEN a 390px viewport
- WHEN the bottom bar renders
- THEN all seven destinations are visible without truncation, and `Tokens de API` and `Sesiones` are still reachable in one tap

#### Scenario: No overflow at the narrowest phone

- GIVEN a 375px viewport
- WHEN the bottom bar renders
- THEN the bar's scroll width does not exceed its client width and no label is clipped

#### Scenario: Touch targets

- GIVEN a 390px viewport
- WHEN every item of the bottom bar is measured
- THEN each item is at least 44px tall and at least 44px wide

#### Scenario: Safe area and content clearance

- GIVEN a device with a bottom safe-area inset
- WHEN a page renders on mobile
- THEN the bar respects the inset and the page's last element is fully visible above the bar

#### Scenario: Active state preserved

- GIVEN a mobile user on `/dashboard/productivity/`
- WHEN the bar renders
- THEN the Productivity item carries `aria-current="page"` and the navigation landmark keeps its `aria-label`
