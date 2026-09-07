# Design: P6 Frontend Dashboard

## Technical Approach

Slice 0 (five read endpoints + `PATCH /me/preferences`) ships first as Rust TDD; then the Next.js 16 static-export foundation; then dashboard/finance/wealth/productivity slices. Money stays a decimal string on the wire, coerced once in `lib/api`. Recharts 3 renders aggregates; Tailwind v4 `@theme` tokens implement the mission-control deck. Production serves `frontend/out` same-origin via Axum `STATIC_DIR`, API nested under `/api`.

## Architecture Decisions

| Decision | Tradeoff | Choice |
|---|---|---|
| Charting: Recharts 3 vs ECharts vs visx | Bundle vs styling vs effort | **Recharts 3**: SVG + Tailwind/CSS vars, `accessibilityLayer`, best export fit; `next/dynamic` per route |
| Token: localStorage vs httpOnly cookie | XSS vs backend change | **localStorage**: accepted single-user LAN scope |
| Pagination: keyset vs OFFSET | Stability + index vs simplicity | **Keyset** `(occurred_on, id)` base64 cursor; uses `idx_tx_user_date` |
| Budgets status: one join vs per-id loop | Round-trip vs N+1 | **Single GROUP BY** per period; `map_budget_status` reused |
| Habits today: lateral vs loop | One query vs simpler SQL | **CROSS JOIN LATERAL** of existing streak scalar |
| API placement: nest `/api` vs root | Clean split vs churn | **Nest `/api`** (spec-sanctioned); `/health`+`/ready` stay at root |
| Theming: `@theme` vs config.ts | CSS-first tokens | **Tailwind v4 `@theme`**, dark-first + `.light` via `@custom-variant` |
| 401: single-flight vs per-hook | One redirect vs storms | **Module-level single-flight** in `lib/api/client.ts` |
| Currency: regex-only vs ISO-4217 allowlist | Simple vs spec-required 422 on unknown codes | **Allowlist**: static ISO-4217 common-codes set (`&[&str]`) in backend; `^[A-Z]{3}$` + membership, else 422 |
| Chart empty state: per-chart vs shared component | Duplication vs one component | **Shared `EmptyState`**: Recharts wrappers render it (localized message, no error) when an aggregate response has no data points |

## Slice 0 Backend

Handlers in existing modules; `require_user_id` → 401 `UNAUTHORIZED` (never 403); SQL `user_id`-scoped; money out as `Decimal` strings.

| Endpoint | Shape |
|---|---|
| `GET /api/transactions` | Params `account_id`, `category_id`, `type`∈{income,expense}, `from`/`to`, `cursor`, `limit` (50/200). → `{ items, next_cursor, total_count }`; `COUNT(*) OVER()` — one round-trip. Unknown filter ids → empty page |
| `GET /api/transactions/stats/by-category` | `from`,`to` required (else 422), `type` default `expense`. → `[{ category_id, name, total }]`; `SUM GROUP BY category` JOIN categories; empty range → `[]` |
| `GET /api/transactions/stats/monthly-flow` | `from`,`to`. → `[{ month, income, expense }]`; `to_char(occurred_on,'YYYY-MM')` + `SUM(CASE WHEN type=...)` (P5 precedent); transfers excluded |
| `GET /api/habits/today` | → `[{ habit_id, name, habit_frequency, days_of_week, current_streak, today_status }]`; status ∈{done,missed,skipped,pending} via LEFT JOIN `habit_logs ON log_date = CURRENT_DATE`; streak via LATERAL of `STREAK_SQL` |
| `GET /api/budgets` (extend) | Entries gain `spent, remaining, pct, status` from one `LEFT JOIN transactions ... BETWEEN period_start AND period_end GROUP BY b.id`; status ∈{ok,warn,over} |
| `PATCH /api/me/preferences` | Partial `{ currency_code?, locale?, timezone?, dashboard_layout? }`; COALESCE update; 200 merged preferences; invalid → 422, nothing written |

Validation: `currency_code` `^[A-Z]{3}$` **and** membership in the static ISO-4217 allowlist (unknown codes → 422); `locale` `^[a-z]{2}(-[A-Z]{2})?$`; `timezone` via `pg_timezone_names`; `dashboard_layout` per schema (unknown keys → 422, `deny_unknown_fields` convention). DECIDED layout schema:

```json
{ "widgets": [ { "id": "monthly-flow", "type": "chart", "order": 0, "size": "lg" } ] }
```

`widgets` ≤ 32; `id` 1–64 chars; `type` ∈ {metric, chart, list, ledger, heatmap}; `order` int ≥ 0; `size` ∈ {sm, md, lg}.

## Data Flow

    Browser ──SWR──▶ lib/api (Bearer, 401 single-flight, string→number coerce) ──▶ /api/*
    Axum nest(/api) ──▶ handlers ──▶ sqlx ──▶ Postgres (server-side aggregates)
    ServeDir(STATIC_DIR) ──▶ frontend/out; non-/api miss ──▶ index.html

## Frontend Foundation

- `next.config.ts`: `output: 'export'`, `trailingSlash: true` (directory indexes for ServeDir), gated bundle analyzer.
- App router: `app/layout.tsx` (fonts, FOUC-guard script, shell), `login/page.tsx`, `dashboard/{page,finance,wealth,productivity}/page.tsx`. Session guard is `'use client'` (no server runtime in export).
- Tokens in `app/globals.css` `@theme`: `deck #0C1622, hull #142433, instrument #EAF1F7, signal #F5A623, flow #2DD4A7, alert #F2555A, violet #8B7CF6, sky #56A8F5` + `--font-display/body/mono`.
- Fonts via `next/font/google` (build-time self-host, export-safe): Space Grotesk, Inter, IBM Plex Mono (tabular money).
- `lib/api/client.ts`: base `NEXT_PUBLIC_API_URL ?? '/api'`; Bearer injection; `ApiError { status, code }`; 401 clears token once + single-flight `/login` redirect. `lib/api/money.ts`: sole `toNumber` + `Intl.NumberFormat` formatting. SWR for reads.

## Component Architecture

Containers (`components/containers/*`) own SWR + transforms; `components/ui/*` pure. Recharts wrappers (`FlowChart`, `CategoryDonut`) are `'use client'` + `next/dynamic`, styled via token CSS vars. `TelemetryStrip` maps `alert_level`/`status` 1:1 to LEDs (ok→flow, warn→signal, over/high→alert). Bento: `grid-cols-12` + left rail desktop; ≤768px bottom tab bar; visible focus; reduced-motion kills count-up/draw-in.

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/src/routes/transactions.rs` | Modify | list + stats handlers, cursor codec |
| `backend/src/routes/budgets.rs` | Modify | collection-with-status query |
| `backend/src/routes/habits.rs` | Modify | `today` handler (lateral streak) |
| `backend/src/routes/me.rs` | Modify | `PATCH /me/preferences` + layout validation |
| `backend/src/main.rs` | Modify | nest `/api`; ServeDir SPA fallback to `index.html` |
| `frontend/**` | Create | app, components, lib/api, tokens, tests |
| `docker/backend.Dockerfile` | Modify | node stage builds `frontend/out` → `/app/static`; `ENV STATIC_DIR=/app/static` |
| `.github/workflows/ci.yml` | Create | cargo test, npm test, export build, Playwright smoke |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Backend | Slice 0 handlers, cursor, aggregates, 401/422, layout schema | `cargo test`, `DATABASE_URL` skip-honest convention |
| Frontend | api client (Bearer, coercion, single-flight 401), transforms, TelemetryStrip mapping, guard | Vitest + RTL + MSW; `npm test` = `vitest run` (satisfies `openspec/config.yaml`) |
| E2E smoke | login, protected nav, dashboard render | Playwright, 3–5 specs vs exported `out` + backend |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary (HTTP route additions are not the matrix's routing boundary).

## Migration / Rollout

No data migration. Slice 0 deploys alone (additive endpoints); the `/api` nest ships with the frontend that consumes it. Health probes unchanged.

## Open Questions

- [ ] None blocking. Recharts bundle budget measured at Slice 2 via analyzer.
