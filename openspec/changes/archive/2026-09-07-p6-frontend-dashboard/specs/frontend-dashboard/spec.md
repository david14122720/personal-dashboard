# Frontend Dashboard Specification

## Purpose

Static-export Next.js control center rendering aggregates as Recharts charts, with a telemetry-deck home, preferences persistence, and bearer-token session handling. Served same-origin by Axum via `STATIC_DIR` in production.

## Requirements

### Requirement: Telemetry Strip

The dashboard home MUST render a full-width Telemetry Strip showing net worth, current-month balance, savings rate, longest streak, and budget status LEDs. Each LED MUST map backend enums 1:1: `alert_level` ∈ {`ok`, `warn`, `high`} and budget `status` ∈ {`ok`, `warn`, `over`} to their documented visual states. Values MUST be formatted per user `locale`/`currency_code` preferences using the string-money coercion layer.

#### Scenario: Enum mapping

- GIVEN a card account with `alert_level: "warn"` and a budget with `status: "over"`
- WHEN the dashboard renders
- THEN the corresponding LEDs display the warn and over visual states

#### Scenario: Money formatting

- GIVEN preferences `locale: "es-CO"`, `currency_code: "COP"` and net worth `"1500000.00"`
- WHEN the strip renders
- THEN the value displays as `$ 1.500.000` (tabular, locale-correct)

### Requirement: Recharts Aggregates

The dashboard MUST render monthly income-vs-expense and spend-by-category charts using Recharts 3. Data MUST come from the authenticated aggregate endpoints; the client MUST coerce decimal-string amounts to numbers at the API boundary only. Charts MUST be code-split per route.

#### Scenario: Chart renders from aggregates

- GIVEN authenticated aggregates `[{ month: "2026-09", income: "1000.00", expense: "400.00" }]`
- WHEN the dashboard mounts
- THEN the monthly flow chart plots income and expense series with the coerced numeric values

#### Scenario: Empty aggregates

- GIVEN an empty aggregate response
- WHEN the chart mounts
- THEN the chart renders an empty state without errors

### Requirement: Bento Layout and Responsiveness

The dashboard MUST use a bento "instrument rack" layout that adapts from a desktop left rail to a mobile bottom tab bar. All interactive elements MUST be keyboard-accessible with visible focus. The layout MUST respect `prefers-reduced-motion`: when set, page-load orchestrations and chart draw-in animations are suppressed.

#### Scenario: Mobile navigation

- GIVEN a viewport width ≤ 768px
- WHEN the dashboard loads
- THEN navigation is exposed as a bottom tab bar

#### Scenario: Reduced motion

- GIVEN `prefers-reduced-motion: reduce`
- WHEN the dashboard loads
- THEN count-up and chart draw-in animations are skipped

#### Scenario: Keyboard focus

- GIVEN a keyboard-only user
- WHEN they tab through the dashboard
- THEN every interactive element shows a visible focus indicator

### Requirement: Static Export Served by Axum

The frontend MUST build via Next.js `output: 'export'`. The backend Dockerfile MUST copy `frontend/out` into `STATIC_DIR`; Axum MUST serve those assets same-origin with the API fallback. In development, the frontend MAY run cross-origin; the API client MUST read its base URL from configuration.

#### Scenario: Production serving

- GIVEN a built `frontend/out` directory
- WHEN the backend container starts
- THEN `GET /` returns `index.html` and `GET /api/...` routes to the API

#### Scenario: SPA fallback

- GIVEN a request for `/dashboard/finance`
- WHEN no matching static file exists
- THEN Axum returns `index.html` so the client router handles the route

### Requirement: Session and 401 Contract

The client MUST store the bearer token in `localStorage`, attach it to every `/api/*` request, and on any 401 response perform a single-flight redirect to `/login` clearing the token. Concurrent 401s MUST dedupe so only one redirect occurs.

#### Scenario: Token attached

- GIVEN a stored token
- WHEN any `/api/*` request is made
- THEN the request includes `Authorization: Bearer <token>`

#### Scenario: Single-flight 401 redirect

- GIVEN three concurrent requests that all receive 401
- WHEN responses arrive
- THEN exactly one redirect to `/login` occurs and the token is cleared once
