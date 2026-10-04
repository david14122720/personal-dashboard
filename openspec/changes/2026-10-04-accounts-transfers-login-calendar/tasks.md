# Tasks — 2026-10-04-accounts-transfers-login-calendar

- status: `ready_for_apply`
- delivery: none (owner: no commit, no push, no deploy — local review only)
- commands: backend commands run from `backend/`, frontend from `frontend/`, MCP from `mcp-dashboard/`, migration replay from the repo root
- ODD: the five workstreams (W1–W5) are the ODD units; W0 (these artifacts) and W6 (verification) are bookends
- lifecycle owner: every box marked `sdd-owner: parent` is not executed by an implementation agent

## W0 — SDD artifacts (this task)

- [x] W0.1 — `proposal.md`: why, the five workstreams, owner decisions, reversals and accepted losses, review-workload forecast, non-goals, verification outline
- [x] W0.2 — `design.md`: migrations 0014–0016, transfer flow, W1/W3/W4/W5 exact changes, testing strategy, risks, closed decisions (empty open items)
- [x] W0.3 — Ten capability deltas under `specs/` (`finance-accounts`, `finance-assets`, `finance-movements`, `finance-core-invariants`, `credit-card-summary`, `session-auth`, `productivity-layout`, `frontend-i18n`, `mcp-dashboard`, `frontend-dashboard`)
- [x] W0.4 — This task list with per-task routes, files, acceptance criteria and RED/GREEN evidence

## W1 — Account type and the credit-card layer leave the product

Owns migrations 0014–0016 (0014/0015 carry W2's additive objects, 0016 the authorized destructive block), `accounts.rs`, net worth, the frontend account wire/UI, the MCP create-account schema and the account-type i18n key.

- [x] W1.1 — Ship migrations 0014–0016 in order (evidence: 0014/0015 applied; 0016 applied to production — `accounts` 12 columns, `account_type` absent, 5 accounts intact with unchanged balances)
  - route: implementer (backend/DB)
  - files: `backend/migrations/0014_movement_transfer_enum.sql`, `backend/migrations/0015_movement_transfer_account.sql`, `backend/migrations/0016_remove_account_type_and_card_fields.sql`, `backend/tests/migration_0014_0016_transfers_account_type.rs`
  - acceptance: 0014 = `ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer'` with no `BEGIN;`/`COMMIT;` and a comment naming the 55P04 hazard; 0015 = its own transaction with `transfer_account_id`, the FK, the three CHECKs (`chk_transfer_account_presence`, `chk_transfer_not_self`, `chk_transfer_no_category`) and `idx_movements_transfer_account`, safe only because 0014 committed earlier; 0016 = the ordered destructive block (three CHECK drops, `DROP INDEX idx_accounts_user_card`, the four column drops, `DROP TYPE account_type`) with no CASCADE; `0001`–`0013` untouched (`0008` still contains `chk_card_limit_presence`); guard proves per-file content, the 0014 → 0015 order and the destructive block after the transfer objects; live post-conditions per migration pass on the dev DB only; the files apply one at a time in numeric order
  - evidence — RED: guard test fails while the three files are absent; GREEN: `cd backend && cargo test --locked migration_0014_0016`
- [x] W1.2 — Rewrite the backend accounts contract without type/card fields (evidence: `cargo test --locked --no-fail-fast` with `DATABASE_URL` → 409 passed / 0 failed after the seed fixes)
  - route: implementer (backend)
  - files: `backend/src/routes/accounts.rs` (+ inline tests)
  - acceptance: `CreateAccountRequest` = name + optional currency/notes/color/icon with `deny_unknown_fields` (`type`/card fields → 422); `AccountResponse` has no `type`, `credit_limit`, `statement_day`, `payment_due_day`, `used_balance`, `available_balance`, `usage_pct`, `alert_level`, `statement_balance`; `AccountRow` is 10 columns (`id`, `name`, `currency`, `balance`, `notes`, `color`, `icon`, `is_archived`, `created_at`, `updated_at`); `ACCOUNT_TYPES`/`validate_account_type`/`validate_card_fields`/`compute_card_metrics` deleted; PATCH allowlist unchanged; duplicate name still 409, foreign id still 404; the delete guard counts movements on `account_id` OR `transfer_account_id`, so an account that is only a transfer destination still gets the Spanish 409
  - evidence — RED: a test posting `{"name":"X","type":"bank"}` expects 422 and a response-shape test expects no `type` key, both failing before the rewrite; GREEN: focused `cargo test --locked accounts`
- [x] W1.3 — Net worth becomes assets-only (evidence: same backend run — 409 passed / 0 failed, assets-only net-worth tests green)
  - route: implementer (backend)
  - files: `backend/src/routes/assets.rs` (+ inline tests)
  - acceptance: `NET_WORTH_SQL` selects non-archived assets only (no `accounts` join, no `type=` predicate); per-currency wire is `{currency, assets, net_worth}` with `net_worth = assets` and no `debts`; no other module query reads `accounts.type`
  - evidence — RED: the net-worth test expecting the assets-only shape fails against the current join; GREEN: focused `cargo test --locked assets`
- [x] W1.4 — Strip the frontend account wire and transforms (evidence: `pnpm test` → 523 passed)
  - route: implementer (frontend)
  - files: `frontend/lib/api/dashboard.ts`, `frontend/lib/api/finance.ts`, `frontend/lib/finance/finance.ts`
  - acceptance: `AccountWire` keeps only `id`/`name`/`currency`/`balance`; `createBankAccount` posts `{name}`; `AccountCardView` keeps only `id`/`name`/`currency`/`balance`; `AccountWireLike` deleted; `toAccountCards` has no card branch and no card coercion
  - evidence — RED: transform test expecting no `isCard`/`used`/`alertLevel` fields fails before the change; GREEN: `cd frontend && pnpm exec vitest run lib/finance/finance.test.ts lib/finance/movements.test.ts`
- [x] W1.5 — Finance row, Settings list and account i18n (evidence: frontend 523 passed; `tsc --noEmit` exit 0; `pnpm run build` exit 0 — 12 routes)
  - route: implementer (frontend)
  - files: `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/settings/BankAccountsSection.tsx`, `frontend/lib/i18n/es.ts`
  - acceptance: the account row renders no type chip and no `finance.accountTypeLabel`; Settings lists every non-archived account (no `row.type === "bank"` filter) and creates with `{name}`; `finance.accountTypeLabel` deleted; `settings.accountsTitle` value «Cuentas», hint adjusted; no type control anywhere
  - evidence — RED: `finance.test.tsx`/`ajustes/page.test.tsx` assertions updated first and failing; GREEN: `cd frontend && pnpm exec vitest run components/finance components/settings app/dashboard/ajustes`
- [x] W1.6 — Update every frontend test that pinned the type/card surface (evidence: frontend 523 passed — the five rewritten files are green in that run)
  - route: implementer (frontend)
  - files: `frontend/components/finance/finance.test.tsx`, `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/movements.test.ts`, `frontend/components/finance/s1-capture.test.tsx`, `frontend/app/dashboard/ajustes/page.test.tsx`
  - acceptance: no test imports or asserts `type`, `isCard`, `credit_limit`, `used_balance`, `available_balance`, `usage_pct`, `alert_level` or `statement_balance`; assertions cover the new create payload and the unfiltered Settings list
  - evidence — RED: the updated assertions fail against the current code; GREEN: the five focused files pass; record the counts in the ODD task file
- [x] W1.7 — Remove the type/card surface from the MCP create-account tool (evidence: `mcp-dashboard` typecheck + build exit 0)
  - route: implementer (MCP)
  - files: `mcp-dashboard/src/tools.ts`, `mcp-dashboard/README.md`
  - acceptance: `CreateAccountSchema` = name + optional currency/notes/color/icon, `required: ["name"]`; tool description and README no longer advertise type or card fields; no other tool changed; no movement/transfer tool added
  - evidence — RED: `npm run typecheck` catches the stale enum/field references after the schema change; GREEN: `cd mcp-dashboard && npm run typecheck && npm run build`
- [x] W1.8 — W1 slice validation (evidence: `tsc --noEmit` exit 0; backend 409/0 and frontend 523 green)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: focused backend account/asset suites and focused frontend finance/settings suites are green; `node node_modules/typescript/bin/tsc --noEmit` exits 0; nothing in `frontend/` or `backend/` reads `accounts.type` or a card wire field
  - evidence — GREEN: exact commands and counts recorded; no broad suite yet (W6)
- [x] W1.9 — Supersession note for the `2026-10-03-finance-ui-fixes` type clause (evidence: the note is in place in the older delta — `openspec/changes/2026-10-03-finance-ui-fixes/specs/finance-accounts/spec.md:3,21,29,36,60` — and this change's delta repeats the withdrawal at `specs/finance-accounts/spec.md:51,63-66`; the delta text is binding)
  - route: implementer (docs)
  - files: `openspec/changes/2026-10-04-accounts-transfers-login-calendar/specs/finance-accounts/spec.md` (already required by W0.3; this box verifies the wording)
  - acceptance: the delta states exactly which clause is superseded (type display only) and that single-row composition + inline balance edit remain binding
  - evidence — documentation-only wording check: read-back confirms the type clause is named as withdrawn while the single-row composition, the no-duplicate-card rule and the inline balance edit stay in force; RED/GREEN not applicable.

## W2 — Transfers as one ledger row

Depends on W1.1 (0014–0016) and the W1 `movements.rs` baseline. Backend first, then transforms, then UI.

- [x] W2.1 — Direction-aware `signed_delta` and the movement row field (evidence: fail-closed `signed_delta` for `transfer`; RED/GREEN recorded per unit)
  - route: implementer (backend)
  - files: `backend/src/routes/movements.rs` (+ inline tests)
  - acceptance: `signed_delta` returns `Result` and maps `expense`/`transfer` negative, `income` positive, anything else `Err`; `MovementRow` and `MovementResponse` carry `transfer_account_id` (11 columns, `Option<Uuid>`); all five movement SQL statements select the same 11 columns
  - evidence — RED: unit test `signed_delta("transfer", 10) == -10` and unknown-direction-fails fail first; GREEN: focused `cargo test --locked movements`
- [x] W2.2 — Transfer endpoint with atomic two-leg effect (evidence: `POST /api/movements/transfer` two-leg atomic effect; 409 destination guard and 422 validation; 0014/0015 applied)
  - route: implementer (backend)
  - files: `backend/src/routes/movements.rs`, `backend/src/main.rs`
  - acceptance: `POST /api/movements/transfer` with `deny_unknown_fields` request per design D2.1; all six validation rows return Spanish 422; both accounts locked in ascending UUID order; insert + origin debit + destination credit in one transaction; response is the transfer movement (origin in `account_id`, destination in `transfer_account_id`, `category_id: null`); route registered beside `/movements/{id}`
  - evidence — RED: live/GREEN tests (skip without `DATABASE_URL`) — create 100 from A to B leaves A−100/B+100, self-transfer 422, cross-currency 422, foreign account 422; a forced failure rolls back both balances
- [x] W2.3 — Delete reverses two legs; PATCH rejects transfers (evidence: two-leg delete reversal recorded; transfers are created-and-deleted only, never edited)
  - route: implementer (backend)
  - files: `backend/src/routes/movements.rs`
  - acceptance: delete returns the 4-column tuple, locks both accounts ascending and undoes origin/destination exactly; deleting a transfer restores both balances to their pre-create values; `PATCH` on a transfer row is 422 before any balance math (create/delete only: a two-leg reversal plus lock ordering is out of scope); `PATCH` never accepts `transfer_account_id` and never accepts `direction: "transfer"`
  - evidence — RED: round-trip test (create then delete restores both balances) and the PATCH-rejects-transfer test fail before implementation; GREEN: focused movement suite
- [x] W2.4 — Update the 0012 enum pin (evidence: 0014/0015 applied; enum pin green in the recorded backend suite)
  - route: implementer (backend)
  - files: `backend/tests/migration_0012_movements.rs`
  - acceptance: the live enum assertion now expects exactly `["expense","income","transfer"]` after 0014; the additive-only file-content guards for 0012 remain untouched and pass
  - evidence — RED/GREEN: `cd backend && cargo test --locked migration_0012`
- [x] W2.5 — Frontend transfer API and transforms (evidence: the four frontend aggregates exclude transfers through explicit gates; RED/GREEN recorded per unit; focused frontend suite 107 → full suite 524 at that point)
  - route: implementer (frontend)
  - files: `frontend/lib/api/finance.ts`, `frontend/lib/finance/finance.ts`, `frontend/lib/finance/finance.test.ts`
  - acceptance: `MovementWire.direction` widens to `"expense" \| "income" \| "transfer"` and gains `transfer_account_id`; `createTransfer(input)` posts the exact contract; `MovementRowView` gains `transferAccountName`, direction widens, editability flag false for transfers; every one of the ten aggregation points in design D2.6 excludes transfers with a named test
  - evidence — RED: each exclusion test fails before the skip; GREEN: `cd frontend && pnpm exec vitest run lib/finance`
- [x] W2.6 — Transfer entry control and modal (evidence: transfer UI covered by the focused frontend suite — 107 → 524 at that point)
  - route: implementer (frontend)
  - files: `frontend/components/finance/MovementForms.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/lib/i18n/es.ts`
  - acceptance: «Transferir» button beside Agregar gasto/Agregar ingreso (44×44, keyboard, focus return); transfer modal with origin/destination selects (owned accounts by name), amount, date (default today), optional description; client validation blocks same account, missing fields and invalid amount with Spanish messages; success confirmation is CSS-only, revalidates `finance/movements` + `dashboard/accounts`; Esc/cancel send nothing; the expense/income modal keeps exactly two directions and the edit modal never offers `transfer`
  - evidence — RED: `MovementForms.test.tsx` transfer cases fail before the modal exists; GREEN: focused component suite
- [x] W2.7 — History filter, rows and dashboard snapshot understand three directions (evidence: a transfer is never labelled an income; direction filter widened; focused frontend run 107 → 524)
  - route: implementer (frontend)
  - files: `frontend/components/finance/MovementHistory.tsx`, `frontend/components/dashboard/widgets/MovementsSnapshot.tsx`
  - acceptance: history filter gains `Transferencia`; transfer rows render their route copy (W5) and offer no edit control (delete after confirmation only); the dashboard snapshot never labels a transfer «Ingreso»; no renderer uses a binary ternary anymore
  - evidence — RED: `MovementHistory.test.tsx`/`DashboardHome.widgets.test.tsx` transfer fixtures fail; GREEN: the two focused files
- [x] W2.8 — W2 slice validation (evidence: focused backend + frontend movement suites green — focused frontend 107 → 524 at that point; `tsc` exit 0)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: focused backend movement suite and focused frontend movement suites green; `tsc --noEmit` exits 0; grep shows no transfer path through any of the ten aggregation points
  - evidence — GREEN: commands + counts recorded
- [x] W2.9 — `objetivo.md` dated reversal notes (cards + transfers) (evidence: 2026-10-04 notes added to Transferencias and Cuentas; the 2026-09-23 notes remain readable; diff touches only those two sections)
  - route: implementer (docs)
  - files: `objetivo.md`
  - acceptance: Transferencias section gains a dated 2026-10-04 note reversing the 2026-09-23 reversal and describing the one-ledger-row shape (no `/transfers`, no trigger); Cuentas section drops the «Tarjeta de crédito» kind with a dated 2026-10-04 note; both older notes remain readable; the diff touches only those sections
  - evidence — RED/GREEN: not applicable (documentation-only); document diff read-back against design D1/Reversals

## W3 — Login and session hardening

A1–A4 and A7 first (login surface), then A5 (sessions). Each finding is one unit with its tests.

- [x] W3.1 — A1: right-most untrusted `X-Forwarded-For` element (evidence: A1 right-most untrusted `X-Forwarded-For` as built)
  - route: implementer (backend)
  - files: `backend/src/routes/login.rs`
  - acceptance: key derivation per design D4.1 (right-to-left, skip trusted, malformed right-most → peer, all-trusted/absent → peer, untrusted peer → peer, no ConnectInfo → `LOCAL_PEER_FALLBACK`); the two green tests that pinned the first element are rewritten; `X-Real-Ip` still ignored
  - evidence — RED: spoofed-left-element test fails against the current implementation; GREEN: focused `cargo test --locked login`
- [x] W3.2 — A2: failure-only limiter keyed per IP and per account (evidence: A2 failure-only dual limiter as built)
  - route: implementer (backend)
  - files: `backend/src/auth/rate_limit.rs`, `backend/src/routes/login.rs`
  - acceptance: two bounded maps per design D4.2; `check_login` before DB/Argon2; failures recorded only; success clears the account bucket; 10 failures/15 min per IP and 5 per normalized email; blocked key survives eviction; poisoned mutex recovered; generic 429 + `Retry-After`; an authenticated session is never throttled; the bounded self-lockout is accepted and measured; tests that relied on successes consuming quota rewritten
  - evidence — RED: (a) success-does-not-consume, (b) per-account lockout and (c) blocked-key-survives-eviction tests fail against the current single-map/every-call-counting limiter; GREEN: focused limiter suite
- [x] W3.3 — A3: exactly one Argon2 verification on every login path (evidence: A3 exactly one Argon2 verify on every path)
  - route: implementer (backend)
  - files: `backend/src/routes/login.rs`, `backend/src/auth/password.rs`
  - acceptance: `verify_credentials` always calls `verify_password` against the stored hash or the fixed `DUMMY_PASSWORD_HASH` (same params), then evaluates `is_active`; unknown email, inactive user and wrong password all return the same generic 401; missing/oversized input stays a 422 before Argon2; `#[cfg(test)]` counter proves one verify on all three 401 paths and zero on the 422 path
  - evidence — RED: the counter test fails on the current early-return; GREEN: focused login/password suite
- [x] W3.4 — A7: `Cache-Control: no-store` on the two secret responses (evidence: A7 `no-store` on exactly the two secret responses)
  - route: implementer (backend)
  - files: `backend/src/routes/login.rs`, `backend/src/routes/tokens.rs`
  - acceptance: header set on `POST /api/login` and `POST /api/tokens` handler responses, not in the global layer; present in those two responses and absent on a GET route (e.g. `GET /api/movements`)
  - evidence — RED: header assertion fails before the change; GREEN: focused login/tokens tests
- [x] W3.5 — A4: `is_active` enforced on every token resolution (evidence: A4 with the extra `me.rs` predicate and its two new green tests; backend 446 → 448 passed / 0 failed)
  - route: implementer (backend)
  - files: `backend/src/auth/middleware.rs`, `backend/src/auth/helper.rs`, `backend/src/routes/me.rs`, `backend/src/routes/logout.rs`
  - acceptance: session and API-token lookups join `users` and require active; `GET /api/me` and logout also 401 for a deactivated user; no schema write on deactivation
  - evidence — RED: a deactivated user's live session and live API token currently resolve; the new tests fail first; GREEN: focused middleware/helper/me/logout suite
- [x] W3.6 — A5 backend: `GET/DELETE /api/sessions` (evidence: A5 `GET`/`DELETE /api/sessions` green in the 448/0 backend run)
  - route: implementer (backend)
  - files: `backend/src/routes/sessions.rs`, `backend/src/routes/mod.rs`, `backend/src/main.rs`
  - acceptance: contract and SQL per design D4.5; session-only (API token → 401); `GET` returns caller rows ordered `created_at DESC` with the SQL-computed `current` flag and no `token_hash`; `DELETE` revokes all but the presenting session, never the caller's, 204 and idempotent
  - evidence — RED: route 404 while absent; contract tests fail; GREEN: focused `cargo test --locked sessions`
- [x] W3.7 — A5 frontend: Settings sessions section (evidence: A5 page, API client, nav entry and keys; frontend 532; `tsc` exit 0; build prerendered `/dashboard/ajustes/sesiones`)
  - route: implementer (frontend)
  - files: `frontend/lib/api/sessions.ts`, `frontend/components/settings/SessionsSection.tsx`, `frontend/app/dashboard/ajustes/page.tsx`, `frontend/lib/i18n/es.ts`
  - acceptance: list with «Actual» badge, expiry formatted es-CO, one «Cerrar otras sesiones» action with confirmation, Spanish loading/error/empty states, 44×44 controls; no new route or nav entry; typed `settings.sessions*` keys
  - evidence — RED: section tests fail before the component; GREEN: focused component + ajustes page suite
- [x] W3.8 — W3 slice validation (evidence: backend 446 → 448 passed / 0 failed; frontend 532; `tsc` exit 0)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: focused auth/session suites green; `session-auth` delta's superseded scenario has no remaining green test pinning the old behaviour; `tsc --noEmit` exits 0
  - evidence — GREEN: commands + counts recorded

## W4 — Productivity calendar

- [x] W4.1 — Calendar helpers (evidence: helpers green with RED/GREEN recorded)
  - route: implementer (frontend)
  - files: `frontend/lib/productivity/calendar.ts`, `frontend/lib/productivity/calendar.test.ts`
  - acceptance: `monthGridCells` (42 Monday-first cells, `inMonth`/`isToday`), `monthGridRange` (grid bounds, not calendar-month bounds), `shiftMonth`, `dayEntries` (tasks by `due_date`, events by overlap) per design D5.1; UTC-midnight arithmetic mirroring `logsToCalendarCells`
  - evidence — RED: helper tests fail before the module exists; GREEN: `cd frontend && pnpm exec vitest run lib/productivity/calendar.test.ts`
- [x] W4.2 — Widen the events read to both bounds (evidence: both-bounds events read green in the focused tests)
  - route: implementer (frontend)
  - files: `frontend/lib/api/productivity.ts`
  - acceptance: `useEvents(from, to)` with a two-bound SWR key; both bounds sent URL-encoded when present; callers convert local dates with `toEventRange` before calling (RFC 3339, never a bare date); the one-sided `eventsFrom` pin in `ProductivityScreens.tsx` is replaced
  - evidence — RED: hook test expecting `?from&to` fails against the one-bound signature; GREEN: focused productivity API tests
- [x] W4.3 — `ProductivityCalendar` component (evidence: disclosure-mounted month grid with distinct task/event markers and day detail)
  - route: implementer (frontend)
  - files: `frontend/components/productivity/ProductivityCalendar.tsx`, `frontend/components/productivity/ProductivityCalendar.test.tsx`
  - acceptance: reuses `DashboardDisclosure` collapsed by default; month grid `role="grid"` with Lun–Dom headers and 42 cells ≥44×44; prev/next/«Hoy»; task-vs-event distinction not by colour alone and present in each cell's accessible label; day-detail expansion with Spanish tasks/events and `EmptyState`; one day open at a time; Esc collapses; loading `role="status"`, error `role="alert"` + retry; reduced-motion respected
  - evidence — RED: component tests fail before the component exists; GREEN: focused component suite
- [x] W4.4 — Mount, skeleton and calendar copy (evidence: 16 typed keys; frontend suite 556 passed; build 14/14 static routes)
  - route: implementer (frontend)
  - files: `frontend/components/containers/ProductivityScreens.tsx`, `frontend/lib/i18n/es.ts`, `frontend/components/productivity/productivity.test.tsx`
  - acceptance: calendar renders first as `col-span-12` above Metas; the four sections keep their order, spans and forms; loading skeleton gains a matching full-width placeholder (no layout shift); typed `productivity.calendar*` keys; no new dependency
  - evidence — RED: integration test expecting the calendar block and skeleton fails before wiring; GREEN: focused productivity suites
- [x] W4.5 — W4 slice validation (evidence: frontend suite 556 passed; `tsc` exit 0; build 14/14 static routes)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: focused productivity suites green; `tsc --noEmit` exits 0; grep shows no bare-date `/events` call
  - evidence — GREEN: commands + counts recorded

## W5 — Movement row copy: payment method and transfer distinction

Depends on W2.7's three-direction renderers.

- [x] W5.1 — Exact row copy and keys (evidence: the three exact row copies pinned by tests; transfer row visually distinct and without an edit affordance; `finance.paymentTransfer` preserved)
  - route: implementer (frontend)
  - files: `frontend/components/finance/MovementHistory.tsx`, `frontend/components/dashboard/widgets/MovementsSnapshot.tsx`, `frontend/lib/i18n/es.ts`
  - acceptance: expense meta line `Método de pago: <cuenta>` (reuses `finance.paymentMethod`); income `Cuenta: <cuenta>` (`finance.movementAccountLabel`); transfer `Transferencia: <origen> → <destino>` (`finance.movementTransferRoute`); `finance.paymentTransfer` untouched and still used only as a subscription payment method; no hardcoded literal
  - evidence — RED: copy assertions fail against the current `{date} · {account}` line; GREEN: focused `MovementHistory` + `MovementsSnapshot` tests
- [x] W5.2 — W5 slice validation (evidence: row-copy suites green; `finance.accountTypeLabel` retired in W1 with no consumer)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: focused suites green; `pnpm run build` type gate accepts every new key and rejects none of the retired ones; `finance.accountTypeLabel` has no consumer
  - evidence — GREEN: commands + counts recorded

## W6 — Verification

- [x] W6.1 — Backend full suite (evidence: `cargo test --locked --no-fail-fast` with `DATABASE_URL` → 409 passed / 0 failed at W1 and 448 passed / 0 failed at W3, after the seed fixes)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: `cargo test --locked` compiles and passes with `DATABASE_URL` set to the dev DB; DB-gated tests that need the live schema run after replaying migrations
  - evidence — command, test counts, skip list recorded
- [x] W6.2 — Frontend full suite, type gate and static build (evidence: frontend `pnpm test` → 523 passed at W1 and 556 at W4; `tsc --noEmit` exit 0; `pnpm run build` exit 0 — 12 routes at W1, 14/14 static routes at W4)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: `pnpm test` green; `node node_modules/typescript/bin/tsc --noEmit` exits 0; `pnpm run build` succeeds and the static export still contains `/dashboard/` and the settings/productivity routes
  - evidence — commands, file/test counts, `TS_EXIT=0`, build summary recorded
- [x] W6.3 — Live Playwright verification of the UI checks (`sdd-owner: parent`) (evidence: two live rounds — accounts without type, the full «Mover dinero» flow with exact balance deltas, the calendar toggles with distinct markers and day detail, the «Método de pago» label, zero console errors; plus the post-fix re-verification of the filter, the calendar edges, the row copy and logout)
  - route: parent (live harness per `webapp-testing` skill; local stack pointed at the production DB with a throwaway `--create-user`)
  - files: none (runs); screenshots and notes land in this change folder
  - acceptance — one live check per workstream plus a console-error check:
    - (a) **W1** — accounts show no type anywhere, and creating/editing an account never asks for one;
    - (b) **W2** — the full "Mover dinero" flow subtracts from the origin account, adds to the destination account and appears in Movimientos as a transfer;
    - (c) **W4** — the monthly calendar toggles, distinguishes task vs event, and reveals a day's detail on click;
    - (d) **W5** — an expense row shows the "Método de pago" label with the account name;
    - (e) zero console errors and zero page errors across those runs, with the throwaway-user cleanup proven.
  - constraints: do **not** run the ungated `frontend/e2e/productivity-layout.spec.ts` evidence spec (it rewrites committed evidence under the 2026-09-23 change folder); capture screenshots at 1440/768/390 and a clean console; every live write stays inside the throwaway user
  - evidence — round 1 and round 2 both passed (a)–(e); post-fix re-verification: account filter PASS on origin/destination and absent for an unrelated account; boundary events PASS on the first (28 Sept) and last (8 Nov) visible cells with the true margin regression case; row copy PASS with «Cuenta no disponible» only for the archived destination and no raw UUID anywhere; logout PASS (the logged-out token is 401, the other session keeps working); zero console and page errors.
- [x] W6.4 — MCP verification (evidence: `mcp-dashboard` typecheck + build exit 0)
  - route: verifier (local)
  - files: none (runs)
  - acceptance: `cd mcp-dashboard && npm run typecheck && npm run build` exit 0; registry exposes no movement/transfer tool; create-account schema matches the new backend contract
  - evidence — commands + output recorded
- [x] W6.5 — Throwaway-user cleanup (`sdd-owner: parent`) (evidence: throwaway user deleted and every row cascaded; production back to `users 2 / accounts 5 / movements 37 / sessions 10`; backend stopped, port free, `git status` unchanged)
  - route: parent (live DB)
  - files: none (runs)
  - acceptance: the `--create-user` user created for W6.3 is deleted and every row cascades; no test data (account, movement, transfer, session, token) remains; no destructive schema operation outside the owner-authorized 0016
  - evidence — deletion command + verification query recorded; post-cleanup counts match the production baseline (`users 2 / accounts 5 / movements 37 / sessions 10`); backend stopped and the port released; `git status` identical before and after.
- [x] W6.6 — Bounded review (`sdd-owner: parent`) (evidence: bounded review by two blind adversarial judges, independent sweeps over the frozen working-tree diff; both ledgers recorded in `judgment-day.md`)
  - route: parent (review session)
  - files: none (review)
  - acceptance: the diff is reviewed per work unit (W1a–W1d, W2a–W2d, W3a–W3c, W4a–W4c, W5) with each unit's RED/GREEN evidence checked against its task line; no unit exceeds ~500 changed lines; any deviation is corrected in the same unit and re-verified
  - evidence — two blind adversarial judges, independent; every row and severity recorded in `judgment-day.md` (Judge A JD-A-001…JD-A-008, Judge B JD-B-001…JD-B-007, the two agreed duplicates marked as such); no BLOCKER/CRITICAL; one discovery round; the fixes were applied under the owner's explicit authorization through the ordinary bounded-writer route because the native correction path accepts only BLOCKER/CRITICAL rows, and no severity was inflated to force a batch; no scoped re-judgment was needed because no severe row survived.
- [x] W6.7 — Judgment Day checklist (`sdd-owner: parent`) (evidence: checklist over the five points with the per-point verdicts — 1 satisfied, 2 satisfied, 3 satisfied, 4 partially satisfied (calendar boundary bug, fixed and re-verified), 5 satisfied; both final verdicts `JUDGMENT: APPROVED` with no BLOCKER/CRITICAL)
  - route: parent (dual review)
  - files: none (review)
  - acceptance — checklist:
    - [ ] both reviewers see the same artifact set (this folder + the diff) and no reviewer reads the other's notes first
    - [ ] W1: `0001`–`0013` byte-identical; no `accounts.type`/card wire field survives anywhere; net worth is assets-only
    - [ ] W2: `signed_delta` fails closed; both legs atomic; all ten aggregation points excluded; `/transfers` and `apply_transfer_counterparty` still absent
    - [ ] W3: A1–A5 and A7 each have a test; `token_hash` never serialized; no-store only on the two secret responses; limiter is failure-only and bounded
    - [ ] W4: calendar is collapsed by default, Monday-first, accessible, and past months fetch with both bounds
    - [ ] W5: the three exact copy lines render from typed keys and `paymentTransfer` survives
    - [ ] deltas supersede every contradicted canonical requirement, and `objetivo.md` carries both dated notes
    - [ ] no new dependency or lockfile change; no commit/push/deploy produced
    - [ ] every decision recorded in `design.md`'s closed list is reflected in the diff and the Open items list stays empty
  - evidence — JD report in `judgment-day.md`: both reviewers saw the same frozen artifact set and worked blind; per-point verdicts recorded above; the calendar boundary defect was the single partially-satisfied requirement and it was fixed and re-verified; the surviving residuals are `AppShell` not surfacing a failed logout, the chart-number visual-verification gap, the `TRUSTED_PROXIES` owner action and the JD-A-008 artifact-wording observation.
- [x] W6.8 — Evidence and ODD close-out (evidence: the reviewable delta exported to `odd/tasks/accounts-transfers-login-calendar-delta.patch` — 12890 lines, 51 modified + 27 new files; the security report at `security-audit.md`; the local run instructions in `odd/tasks/accounts-transfers-login-calendar.md`)
  - route: verifier (local)
  - files: this change folder (evidence only); no source files
  - acceptance: RED/GREEN evidence, command outputs, live screenshots and the JD report are recorded in the change folder; the ODD task file is updated; no test artifact is left behind
  - evidence — final suites: backend `cargo test --locked --no-fail-fast` with `DATABASE_URL` → 450 passed / 0 failed; frontend `pnpm test` → 568 passed (50 files); `pnpm exec tsc --noEmit` → exit 0; `pnpm run build` → 14 static routes; `mcp-dashboard` typecheck + build → exit 0; nothing staged (`git diff --cached` empty) and `HEAD` unchanged at `cf50ddc` on `main`; `judgment-day.md` and the ODD task file updated; no test artifact left behind.

## Explicitly absent

- No commit, push, deploy or release task: delivery for this change is local review only.
- No dependency task (no `Cargo.toml`/`Cargo.lock`, `package.json`/lockfile or `mcp-dashboard` manifest change).
- No HttpOnly-cookie rework (A10), no token-scope/default-expiry enforcement (A6), no `--create-user` argv change (A9), no TLS/HSTS change (A8).
- No transfer edit path, no single-session revoke-by-id, no transfer MCP tool, no transfer chart or page.
- No card data migration, backup, compatibility view or dual read.
- No change to the Dashboard chart disclosures, subscriptions, assets, habits, goals, tasks, notes or notifications.
