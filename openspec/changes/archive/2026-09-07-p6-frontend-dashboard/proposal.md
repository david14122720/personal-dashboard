# Proposal: P6 Frontend Dashboard

## Intent

Deliver the static-export Next.js control center. The empty frontend lacks transaction history and aggregate APIs needed for charts. P6 starts with that precursor, then ships the telemetry-deck home.

## Scope

### In Scope
- **Slice 0:** transaction list/history and aggregates, today’s habits, budgets with status, and `PATCH /me/preferences`.
- **Slice 1:** Next.js 16/TypeScript/Tailwind v4 foundation, static export, tokens/fonts, bearer API client with string-money coercion, login/session guard, shell/navigation, and Vitest + RTL + MSW wired to `npm test`.
- **Slices 2–5:** dashboard home, finance, wealth, and productivity screens; Recharts 3 and Playwright smoke coverage.

### Out of Scope
- Multi-user authorization, httpOnly sessions, real-time updates, native clients, and unrelated domains.

## Capabilities

### New Capabilities
- `frontend-dashboard`: Static shell, telemetry home, charts, navigation, preferences, and client UX.

### Modified Capabilities
- `finance-transactions`: Authenticated list/filter/pagination and aggregate reads.
- `finance-budgets`: Collection responses with status in one request.
- `habits-management`: Authenticated today-status read.
- `session-auth`: Preference persistence and client-side 401 handling.

## Approach

Use Recharts 3 with splitting and Tailwind/CSS styling. Establish named dark-deck tokens (`deck`, `hull`, `instrument`, `signal`, `flow`, `alert`), Space Grotesk/Inter/IBM Plex Mono typography, bento layout, and the Telemetry Strip. Centralize requests in `lib/api`; coerce decimal strings at its boundary. Store the bearer token in `localStorage` (accepted for this single-user tool) and handle 401 with a single-flight login redirect plus SWR deduplication. Test API behavior and transforms with Vitest/RTL/MSW; smoke-test protected navigation with Playwright.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `backend/src/routes/` | Modified | Slice 0 endpoints and preferences |
| `frontend/` | New | App, client, tokens, tests, export config |
| `docker/backend.Dockerfile`, `docker-compose.yml` | Modified | Serve `frontend/out` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Missing data or decimal drift | High | Ship Slice 0 first; enforce one money layer |
| `localStorage` token exposure | Medium | Accept for single-user LAN scope; revisit before multi-user |
| Bundle growth or 401 storms | Medium | Route splitting, bundle check, single-flight redirect |

## Rollback Plan

Revert slices independently: remove frontend/static-serving wiring, then revert Slice 0 routes and migrations if present. Existing backend endpoints remain usable without the dashboard.

## Dependencies

- Recharts 3, Next.js export, Tailwind v4, Vitest, RTL, MSW, and Playwright.
- Auto-chain stacked-to-main delivery; 800-line review budget and accepted `size:exception` precedent.

## Success Criteria

- [ ] `npm test` and backend tests cover the harness and Slice 0.
- [ ] Playwright proves login, protected navigation, and dashboard rendering.
- [ ] Charts render authenticated aggregates without precision or 401 retry failures.
- [ ] Axum serves the static export; UI is keyboard-accessible and reduced-motion aware.
