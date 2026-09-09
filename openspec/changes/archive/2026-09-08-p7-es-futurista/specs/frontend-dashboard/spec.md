# Delta for frontend-dashboard

## MODIFIED Requirements

### Requirement: Bento Layout and Responsiveness

The dashboard MUST use a bento "instrument rack" layout that adapts from a desktop left rail to a mobile bottom tab bar. All interactive elements MUST be keyboard-accessible with visible focus. The layout MUST respect `prefers-reduced-motion`: when set, page-load orchestrations, `--animate-*` token-driven keyframes, and chart draw-in animations are suppressed.
(Previously: reduced-motion suppression covered only page-load orchestrations and chart draw-in; token-driven CSS animation did not exist yet.)

#### Scenario: Mobile navigation

- GIVEN a viewport width ≤ 768px
- WHEN the dashboard loads
- THEN navigation is exposed as a bottom tab bar

#### Scenario: Reduced motion

- GIVEN `prefers-reduced-motion: reduce`
- WHEN the dashboard loads
- THEN count-up, chart draw-in, and all `--animate-*` entrance keyframes are skipped

#### Scenario: Keyboard focus

- GIVEN a keyboard-only user
- WHEN they tab through the dashboard
- THEN every interactive element shows a visible focus indicator

### Requirement: Recharts Aggregates

The dashboard MUST render monthly income-vs-expense and spend-by-category charts using Recharts 3. Data MUST come from the authenticated aggregate endpoints; the client MUST coerce decimal-string amounts to numbers at the API boundary only. Charts MUST be code-split per route. Month axis labels MUST render in Spanish, series colors MUST reference theme tokens (never hardcoded hex), and charts MUST carry direct value labels and currency-formatted Spanish tooltips.
(Previously: raw `YYYY-MM` axis labels, hardcoded hex series colors, no direct value labels or currency tooltips.)

#### Scenario: Chart renders from aggregates

- GIVEN authenticated aggregates `[{ month: "2026-09", income: "1000.00", expense: "400.00" }]`
- WHEN the dashboard mounts
- THEN the chart plots coerced values with a Spanish month label

#### Scenario: Empty aggregates

- GIVEN an empty aggregate response
- WHEN the chart mounts
- THEN the chart renders an empty state without errors

#### Scenario: Token-driven colors

- GIVEN a theme color token is changed
- WHEN charts re-render
- THEN series colors follow the token with no code change

## ADDED Requirements

### Requirement: Futuristic Blue Token Theme

The palette MUST be defined as semantic blue/cyan OKLCH tokens plus `--animate-*` keyframes in Tailwind v4 `@theme`; components and charts MUST consume tokens, not raw hex.

#### Scenario: No hex leaks in charts

- GIVEN the chart component sources
- WHEN grepped for literal hex colors
- THEN zero matches remain outside token definitions

### Requirement: Navigation Route Integrity

Primary navigation MUST link only to existing sections; the dead `/dashboard/wealth/` item MUST be removed.

#### Scenario: Wealth item gone

- GIVEN an authenticated user on any dashboard page
- WHEN the navigation renders
- THEN no wealth entry appears
