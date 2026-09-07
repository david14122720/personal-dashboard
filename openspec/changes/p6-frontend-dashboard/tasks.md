# Tasks: Frontend Dashboard (p6-frontend-dashboard)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2000 - 3000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Slice 0 $\to$ Slice 1 $\to$ Slice 2 $\to$ Slice 3 $\to$ Slice 4 $\to$ Slice 5 |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Slice 0: Backend Precursor | PR 1 | `cargo test` | `GET /api/transactions` | `backend/src/routes/*.rs` |
| 2 | Slice 1: Frontend Foundation | PR 2 | `npm test` | `npm run build` | `frontend/**` |
| 3 | Slice 2: Dashboard Home | PR 3 | `npm test` | `/dashboard` render | `components/ui/TelemetryStrip`, `components/ui/FlowChart` |
| 4 | Slice 3: Finance Screens | PR 4 | `npm test` | `/dashboard/finance` render | `app/dashboard/finance/page.tsx` |
| 5 | Slice 4: Productivity Screens | PR 5 | `npm test` | `/dashboard/productivity` render | `components/ui/HabitsHeatmap` |
| 6 | Slice 5: Deploy & Smoke | PR 6 | `npx playwright test` | Docker container run | `docker/backend.Dockerfile`, `.github/workflows/ci.yml` |

## Phase 1: Slice 0 — Backend Precursor (Rust)

- [x] 0.1 RED: `GET /api/transactions` returns 404/500 (not implemented)
- [x] 0.2 GREEN: Implement `GET /api/transactions` with keyset cursor and `COUNT(*) OVER()` in `backend/src/routes/transactions.rs`
- [x] 0.3 RED: `GET /api/transactions/stats/by-category` fails for empty range
- [x] 0.4 GREEN: Implement `GET /api/transactions/stats/by-category` in `backend/src/routes/transactions.rs`
- [x] 0.5 RED: `GET /api/transactions/stats/monthly-flow` includes transfers
- [x] 0.6 GREEN: Implement `GET /api/transactions/stats/monthly-flow` (transfers excluded) in `backend/src/routes/transactions.rs`
- [x] 0.7 RED: `GET /api/habits/today` returns wrong streak for missed day
- [x] 0.8 GREEN: Implement `GET /api/habits/today` with LATERAL streak in `backend/src/routes/habits.rs`
- [x] 0.9 RED: `GET /api/budgets` missing `spent` and `status`
- [x] 0.10 GREEN: Implement enhanced `GET /api/budgets` with GROUP BY status in `backend/src/routes/budgets.rs`
- [x] 0.11 RED: `PATCH /api/me/preferences` accepts invalid currency code (e.g. "XYZ")
- [x] 0.12 GREEN: Implement `PATCH /api/me/preferences` with ISO-4217 allowlist and layout schema validation in `backend/src/routes/me.rs`
- [x] 0.13 RED: Request to `/api` returns 404 (not nested)
- [x] 0.14 GREEN: Nest `/api` and configure `ServeDir` SPA fallback to `index.html` in `backend/src/main.rs`
- [x] 0.15 Verify Slice 0: `cargo test` returns green for all new handlers

## Phase 2: Slice 1 — Foundation (Next.js)

- [ ] 1.1 Scaffold Next.js with `output: 'export'` and `trailingSlash: true` in `next.config.ts`
- [ ] 1.2 Define `@theme` tokens (deck, hull, instrument, etc.) in `app/globals.css`
- [ ] 1.3 Configure fonts (Space Grotesk, Inter, IBM Plex Mono) via `next/font/google` in `app/layout.tsx`
- [ ] 1.4 RED: `lib/api/client.ts` does not inject Bearer token
- [ ] 1.5 GREEN: Implement `lib/api/client.ts` with Bearer injection and single-flight 401 redirect
- [ ] 1.6 RED: Money string `"123.45"` not coerced to number
- [ ] 1.7 GREEN: Implement `lib/api/money.ts` with `toNumber` and `Intl.NumberFormat`
- [ ] 1.8 Setup Vitest + RTL + MSW; verify `npm test` runs successfully
- [ ] 1.9 Implement `app/login/page.tsx` and `app/layout.tsx` session guard
- [ ] 1.10 Implement App Shell and Navigation
- [ ] 1.11 Verify Slice 1: `npm test` returns green

## Phase 3: Slice 2 — Dashboard Home

- [ ] 2.1 RED: `TelemetryStrip` doesn't map `alert_level` to `alert` color
- [ ] 2.2 GREEN: Implement `components/ui/TelemetryStrip` with LED mapping
- [ ] 2.3 Implement Dashboard home Bento grid layout
- [ ] 2.4 RED: Recharts wrappers crash on empty data
- [ ] 2.5 GREEN: Implement `components/ui/FlowChart` and `CategoryDonut` with shared `EmptyState`
- [ ] 2.6 Wire aggregates-driven charts to SWR hooks
- [ ] 2.7 Implement mobile bottom tab bar
- [ ] 2.8 Verify Slice 2: `npm test` returns green

## Phase 4: Slice 3 — Finance Screens

- [ ] 3.1 RED: `TransactionsLedger` pagination doesn't use keyset cursor
- [ ] 3.2 GREEN: Implement `app/dashboard/finance/page.tsx` ledger with keyset pagination
- [ ] 3.3 Implement Budgets view using `GET /api/budgets` status data
- [ ] 3.4 Implement Subscriptions, Debts, and Savings views
- [ ] 3.5 Verify Slice 3: `npm test` returns green

## Phase 5: Slice 4 — Productivity Screens

- [ ] 4.1 RED: Habits heatmap CSS grid misaligns dates
- [ ] 4.2 GREEN: Implement `components/ui/HabitsHeatmap` with CSS grid
- [ ] 4.3 Implement Goals, Tasks, and Events views
- [ ] 4.4 Implement Notes search interface
- [ ] 4.5 Verify Slice 4: `npm test` returns green

## Phase 6: Slice 5 — Deploy & Smoke

- [ ] 5.1 Modify `docker/backend.Dockerfile` to include node build stage for `frontend/out`
- [ ] 5.2 Set `ENV STATIC_DIR=/app/static` in `docker/backend.Dockerfile`
- [ ] 5.3 RED: Playwright smoke test fails login
- [ ] 5.4 GREEN: Implement Playwright smoke tests for login, navigation, and dashboard render
- [ ] 5.5 Wire `cargo test` and `npm test` into `.github/workflows/ci.yml`
- [ ] 5.6 Final verification: `cargo test && npm test && npx playwright test`
