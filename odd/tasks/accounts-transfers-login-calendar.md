# Feature: accounts-transfers-login-calendar (ODD work units)

- change: `openspec/changes/2026-10-04-accounts-transfers-login-calendar/`
- branch: `main` (working tree only — owner forbids commit, push and deploy)
- database: production (`postgres://pdbuser:***@192.168.50.120:5434/pdbname`), throwaway user for checks, deleted at the end
- owner request: 5 workstreams (below), SDD artifacts in `openspec/`, final "Judgment Day" checklist, security report, local run instructions

## Owner constraints (verbatim, binding)

- Do NOT break existing functionality not mentioned in the request.
- Do NOT install new dependencies without asking first.
- NO commit, NO push (any branch), NO deploy. Everything is reviewed locally.
- Use the production database (established project rule); destructive schema migrations still need explicit approval.
- Verification with Playwright (the `webapp-testing` skill) locally, plus zero console errors.
- Deliverable: summary of changes, security report for workstream 3, and how to run the page locally.

## Workstreams

| # | Workstream | Surface |
| --- | --- | --- |
| W1 | Remove "account type" everywhere in the UI (Finance accounts list + Settings create/edit form) | `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/settings/BankAccountsSection.tsx`, `frontend/lib/api/*` |
| W2 | "Mover dinero" between accounts, recorded as a Transferencia in Movimientos | `backend/migrations/*`, `backend/src/routes/movements.rs`, `backend/src/routes/accounts.rs`, `frontend/components/finance/MovementForms.tsx`, movement list |
| W3 | Login/session security audit + fixes | `backend/src/routes/login.rs`, `logout.rs`, `me.rs`, `tokens.rs`, `backend/src/auth/**`, `backend/src/config.rs` |
| W4 | Monthly calendar view in Productividad (tasks + events, hidden by default, day detail on click) | `frontend/components/productivity/ProductivitySections.tsx`, `frontend/lib/api/*` |
| W5 | Movements: explicit "Método de pago" label + transfers visually distinct | `frontend/components/finance/*` |

## Findings that constrain the design (recon, 2026-10-04)

- `accounts.type` is `account_type NOT NULL` (migration `0002_finance.sql:15`) and it **drives credit-card semantics**: `credit_limit`, `statement_day`, `payment_due_day` are required iff `type='credit_card'` (`backend/src/routes/accounts.rs:262-300`), enforced again by DB CHECK constraints (`backend/migrations/0008_credit_cards.sql:17-28`). Removing the field from the UI must not delete credit-card accounts' ability to exist.
- `BankAccountsSection.tsx:28` filters `row.type === "bank"` — a hidden dependency on the enum.
- The ledger has no transfer concept: `movement_direction` is `('expense','income')` (`backend/migrations/0012_movements.sql:23`), the balance effect is application-level inside a sqlx transaction (no trigger), and the old `transfers` module/table were removed (`backend/src/main.rs:56-57`).
- `openspec/specs/finance-core-invariants/spec.md:15` pins the enum to **exactly** `expense` and `income` → adding `transfer` requires a delta on that canonical spec.
- Category aggregates are client-side over `(category_id, direction)` (`finance-core-invariants/spec.md:198`): a transfer row MUST be excluded from category charts and income/expense totals.
- `objetivo.md` carries an explicit reversion note that transfers are gone; workstream 2 reverses that note, so the doc must be updated in the same change.

## Plan — completed (14/14)

1. [x] Security audit of the auth flow (read-only) → findings with `file:line` — evidence: `security-audit.md` A1–A10, each with `file:line`; owner scope decided 2026-10-04 (core A1–A4 + A7, plus sessions A5; A6/A8/A9/A10 documented as accepted or infra-level).
2. [x] `explore.md` for the five workstreams — evidence: source map, constraints and verification assumptions recorded; no server, DB or migration run.
3. [x] Owner decisions: transfer ledger model, account-type/card handling, dependency permission — evidence: one-ledger-row transfers (no `/transfers`, no trigger), type+credit-card layer removed (destructive 0016 explicitly authorized and applied to production, 5 accounts intact), no new dependency, production DB with a throwaway user.
4. [x] `proposal.md` + delta specs — evidence: `proposal.md` plus ten capability deltas under `specs/`.
5. [x] `design.md` + `tasks.md` with review-workload forecast — evidence: design D1–D8 (migrations, transfer flow, auth fixes, calendar, row copy, risks, closed decisions) and the W0–W6 task list.
6. [x] W1 implementation — evidence: migrations 0014–0016 shipped; backend 409 passed / 0 failed at W1; Settings lists every account; MCP schema without type/card; frontend 523 passed.
7. [x] W2 implementation (migration + backend + UI) — evidence: atomic two-leg transfer create, two-leg delete, PATCH rejects transfers; the ten aggregation points exclude transfers; frontend 524 passed at that point.
8. [x] W3 implementation (audit fixes) — evidence: A1 right-most untrusted `X-Forwarded-For`, A2 failure-only dual limiter, A3 one Argon2 verify per path, A4 `is_active` on every token resolution, A5 `GET`/`DELETE /api/sessions` + Settings page, A7 `no-store`; backend 446 → 448 passed / 0 failed; frontend 532 passed.
9. [x] W4 implementation — evidence: `monthGridCells`/`monthGridRange`/`shiftMonth`/`dayEntries`, both-bounds events read, `ProductivityCalendar` mounted with 16 typed keys; frontend 556 passed; build 14/14 static routes.
10. [x] W5 implementation — evidence: exact row copy («Método de pago:», «Cuenta:», «Transferencia: origen → destino»), transfer row visually distinct with no edit affordance, `finance.paymentTransfer` preserved.
11. [x] Focused tests + `tsc --noEmit` + `pnpm build` — evidence: see the Evidence log (final: backend 450/0, frontend 568, `tsc` exit 0, build 14 routes).
12. [x] Playwright live verification of all five points + console errors — evidence: two live rounds (a)–(e) PASS, zero console/page errors, throwaway-user cleanup proven; post-fix re-verification of the filter, calendar edges, row copy and logout.
13. [x] Judgment Day checklist over the five points — evidence: `judgment-day.md`; two blind judges, 13 unique rows, requirement verdicts 1/2/3/5 satisfied and 4 partially satisfied (calendar boundary bug, fixed and re-verified), both final verdicts `JUDGMENT: APPROVED`.
14. [x] Closeout: summary, security report, local run instructions, per-slice `.patch` deltas — evidence: `odd/tasks/accounts-transfers-login-calendar-delta.patch` (12890 lines, 51 modified + 27 new files), `security-audit.md`, the Local run section below.

## Evidence log

### Final suites (2026-10-04, after the Judgment Day fixes)

- Backend: `cd backend && cargo test --locked --no-fail-fast` with `DATABASE_URL` set → **450 passed / 0 failed**.
- Frontend: `cd frontend && pnpm test` → **568 passed (50 files)**.
- Types: `pnpm exec tsc --noEmit` → **exit 0**.
- Build: `pnpm run build` → **14 static routes**.
- MCP: `cd mcp-dashboard && npm run typecheck && npm run build` → **exit 0**.
- Working tree: `git diff --cached` empty; `HEAD` unchanged at **`cf50ddc`** on `main`.

### Live verification (W6.3)

- Two live Playwright rounds against the local stack pointed at the production DB with a throwaway `--create-user`: accounts without type, the full «Mover dinero» flow with exact balance deltas, the calendar toggles with distinct task/event markers and day detail, the «Método de pago» label, zero console errors.
- Post-fix re-verification: account filter PASS on origin/destination and absent for an unrelated account; boundary events PASS on the first (28 Sept) and last (8 Nov) visible cells, including the true margin regression case; row copy PASS with «Cuenta no disponible» only for the archived destination and no raw UUID anywhere; logout PASS (the logged-out token is 401, the other session keeps working); zero console and page errors.

### Judgment Day (W6.6/W6.7)

- Two blind adversarial judges, independent, over the frozen working-tree diff; ledgers in `judgment-day.md` (Judge A JD-A-001…JD-A-008, Judge B JD-B-001…JD-B-007; JD-B-001 = JD-A-006 and JD-B-002 = JD-A-005 marked as duplicates; 13 unique rows; BLOCKER 0, CRITICAL 0).
- Requirement verdicts: 1 satisfied, 2 satisfied, 3 satisfied, 4 partially satisfied (calendar boundary bug), 5 satisfied. Both final verdicts `JUDGMENT: APPROVED`.
- 11 fixes applied under the owner's explicit authorization through the ordinary bounded-writer route (no BLOCKER/CRITICAL existed, so no correction batch and no severity inflation); surviving residuals recorded in `judgment-day.md`.

### Delta and cleanup

- Reviewable delta: `odd/tasks/accounts-transfers-login-calendar-delta.patch` — **12890 lines, 51 modified + 27 new files** (4689 insertions / 1218 deletions on the tracked set).
- Cleanup proven: production back to `users 2 / accounts 5 / movements 37 / sessions 10`; backend stopped; port free; `git status` unchanged.

## Deferred by owner

- `git` delivery: commits/push/deploy are explicitly withheld; the delta stays in the working tree and is exported as `.patch` files under `odd/tasks/` at closeout.

## Local run

Prereqs: Rust toolchain, Node + pnpm, PostgreSQL reachable. The frontend is a static export, so the backend serves it same-origin with the API under `/api` (this is the stack the live checks used).

1. Build the static frontend export (from `frontend/`): `pnpm run build` → writes `frontend/out/`. The default `NEXT_PUBLIC_API_URL` is `/api`, so the API must be same-origin.
2. Create a throwaway user (from `backend/`, with `DATABASE_URL` set): `cargo run -- --create-user <email> <password> <display_name>` — one-shot CLI; deleting the user cascades every row.
3. Start the backend serving the export (from `backend/`): `DATABASE_URL=postgres://… PORT=3000 SESSION_TTL_HOURS=24 STATIC_DIR=$PWD/../frontend/out cargo run` → app on `http://localhost:3000` (login, `/dashboard/`, `/dashboard/finance`, `/dashboard/productividad`, `/dashboard/ajustes`).
4. Optional MCP: `cd mcp-dashboard && npm ci && npm run build`, create `mcp-dashboard/.env` with `MCP_PORT=3101`, `PERSONAL_DASHBOARD_API_URL=http://localhost:3000/api` and `PERSONAL_DASHBOARD_TOKEN=`, then `npm start` → `http://localhost:3101/mcp`.
5. Optional live smoke (from `frontend/`): `E2E_SMOKE_LIVE=1 E2E_USER=… E2E_PASSWORD=… npm run test:e2e` against the stack above (see `frontend/playwright.config.ts`).

## Open items handed to the owner

1. Set `TRUSTED_PROXIES` at the edge so the per-IP login limiter keys on the real client instead of collapsing every request into one bucket (otherwise a 10-failure burst locks the owner out for 15 minutes).
2. `AppShell` does not yet surface a failed logout revocation (the sessions page is the mitigation).
3. An all-day event stored at midnight UTC renders on the previous local day — a semantic decision for the owner.
4. Rendered chart numbers were not visually verified (transfers are proven excluded at code, SQL and list level).
5. No commit, push or deploy was performed — the deliverable is the working tree plus the exported patch.
