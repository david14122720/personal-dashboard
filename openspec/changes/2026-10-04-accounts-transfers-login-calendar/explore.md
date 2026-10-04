# Explore — 2026-10-04-accounts-transfers-login-calendar

Read-only map gathered before proposal/design across backend, frontend, MCP, canonical specs, change specs and `objetivo.md`. Static inspection only: **no server, no DB, no migration, no test suite ran**. `security-audit.md` in this folder is the agreed W3 scope (A1–A4, A7 + A5) and was not re-audited. Production figures quoted (5 accounts, 0 cards, 37 movements, 2 users) come from the orchestrator's read-only queries.

## 0. Orchestrator resolutions (no longer open)

Owner decisions already taken, plus the interpretation of the 7 open questions raised by exploration:

1. **Owner decision** — "Mover dinero" is **one ledger row**: enum value `transfer` on `movement_direction` + nullable `transfer_account_id`; `account_id` is the origin; atomic effect in the same sqlx transaction; excluded from category charts and from income/expense totals.
2. **Owner decision** — the `accounts.type` column **and the whole credit-card semantic layer go** (confirmed twice; the destructive migration is explicitly authorized). Recorded as an accepted owner loss, not a bug.
3. **Owner decision** — the additive migration (0014) may be applied to the production DB for local verification.
4. **Owner decision** — W3 scope is the core (A1–A4, A7) **plus** A5 session management (list sessions, revoke all but the current one, minimal Settings action).
5. Settings has no type field today (create is name-only and hardcodes `type:"bank"`): the removed surface is the **Finance row chip**, the **Settings `row.type === "bank"` filter**, the hardcoded create payload, and the API/DB field itself. No type control may exist anywhere.
6. The whole card wire surface goes: `credit_limit`, `statement_day`, `payment_due_day`, `used_balance`, `available_balance`, `usage_pct`, `alert_level`, `statement_balance`. The net-worth `debts` field becomes meaningless (always 0) and is **removed** together with the liabilities leg; `finance-assets` and `credit-card-summary` get deltas. Net worth = assets only.
7. W1 **explicitly supersedes** the `2026-10-03-finance-ui-fixes` delta requirement that the account row show its type.
8. Transfers carry **no category**: `category_id` is NULL, `direction='transfer'`, `subscription_id` NULL. They are created through a **new endpoint `POST /api/movements/transfer`** — deliberately not `/api/transfers`, which `finance-core-invariants:17` forbids resurrecting.
9. W5 interpretation of the owner's words: expense rows show `Método de pago: <cuenta>` (reusing the existing `finance.paymentMethod` copy), income rows show a `Cuenta: <cuenta>` label, and transfer rows show `Transferencia: <origen> → <destino>`. No new `payment_method` column on movements.
10. W4 is a **new block inside the Productivity grid** using the Dashboard disclosure pattern (collapsed by default), rendered first so it is discoverable; `productivity-layout` gets a delta for the new block.
11. W3 A1 is fixed properly (walk `XFF` right-to-left, use the right-most element outside the trusted set), which **contradicts the canonical scenario** "the first XFF element is used as the key" (`session-auth:63-67`) and two green tests — the delta and the tests are updated in the same change.

## 1. W1 — account type and the credit-card layer

Table `accounts.type account_type NOT NULL` (`backend/migrations/0002_finance.sql:15`; enum with 7 values incl. `credit_card` at `0001_init_auth_and_categories.sql:16-17`), plus card columns `credit_limit`, `statement_day`, `payment_due_day` (`0002:21-23`).

| Layer | Evidence | Today |
| --- | --- | --- |
| Routes | `backend/src/main.rs:72-82` | `POST/GET /accounts`, `GET/PATCH/DELETE /accounts/{id}` |
| DTO/handlers | `backend/src/routes/accounts.rs:71-84` (`CreateAccountRequest` with `#[serde(rename="type")] account_type` + 3 card fields), `:101-104` (`PatchAccountRequest` has no type/card field), `:104-125` (`AccountResponse` carries type, 3 card fields, `used_balance`, `available_balance`, `usage_pct`, `alert_level`, `statement_balance`) | type travels on create/list/get/patch |
| Validation | `accounts.rs:26-35` `ACCOUNT_TYPES`; `:231-239` `validate_account_type`; `:262-300` `validate_card_fields`; `:307-328` `compute_card_metrics` | 422 guards + Rust-side metrics |
| SQL | `accounts.rs:42-44` create/list/get, `:515` PATCH `RETURNING`; row `:51-64` | one 14-column row, metrics computed in Rust |
| DB backstop | `0008_credit_cards.sql:18-20,23-25,29-31` (3 CHECKs), `:34` `idx_accounts_user_card … WHERE type='credit_card'`, `:37-39` dead index on the dropped `transactions` | the live object is the partial index |
| FE wire | `frontend/lib/api/dashboard.ts:33-41` `AccountWire{…,type,…}`; `frontend/lib/api/finance.ts:181-183` `createBankAccount` posts `{name, type:"bank"}` | single account read |
| FE transform | `frontend/lib/finance/finance.ts:19-31` `AccountCardView`, `:34-39` `AccountWireLike`, `:43-60` `toAccountCards` (`isCard = row.type === "credit_card"`) | card metrics computed but **read by nothing except tests** |
| FE render | `frontend/components/containers/FinanceScreens.tsx:127-131` raw `{account.type}` chip; `:226` `toAccountCards` | the only visible type field |
| FE settings | `frontend/components/settings/BankAccountsSection.tsx:28` filter `row.type === "bank"`; create form name-only `:24,68-84` | card accounts never appear in Settings |
| i18n | `frontend/lib/i18n/es.ts:119` `accountTypeLabel: "Tipo"` | consumed only by the chip |
| Net worth | `backend/src/routes/assets.rs:98` `NET_WORTH_SQL` (assets `FULL OUTER JOIN` card liabilities `WHERE type='credit_card'`), wire `:616-630`, handler `:632-651` (`net_worth = assets - debts`) | the only live `type=` SQL outside accounts.rs |

**Complete live dependency inventory (W1 breaks each one):**

- Backend: `accounts.rs:26-35,42-44,51-64,71-84,104-125,159-207,231-239,262-300,307-328,404-424,515`; `assets.rs:98` + tests `:1273-1369` (seeds at `:1296,1349`). `movements.rs` has no type dependency (`finance/validation.rs::ensure_owned_account` is ownership-only).
- Backend tests: `accounts.rs:608-621` (validators), `:651-676` (PATCH rejects card fields as structural), `:729` fixture, `:1001-1107` card create/get; `backend/tests/migration_0008_credit_cards.rs:26-29` (file-content guards), `:145-230` (live inserts into card columns); `backend/tests/migration_0012_movements.rs:81-110` (additive-only discipline for a new 0014).
- Frontend code: `lib/api/dashboard.ts:33-41`; `lib/api/finance.ts:181-183`; `lib/finance/finance.ts:19-60`; `containers/FinanceScreens.tsx:127-131,226`; `containers/DashboardHome.tsx:144`; `settings/BankAccountsSection.tsx:28`; `lib/i18n/es.ts:119`.
- Frontend tests pinning it: `components/finance/finance.test.tsx:16-37,130-138,140-146`; `lib/finance/finance.test.ts:26-60`; `lib/finance/movements.test.ts:37-50`; `components/finance/s1-capture.test.tsx:88-100`; `app/dashboard/ajustes/page.test.tsx:23-27,53-54`.
- Canonical specs: `credit-card-summary/spec.md` **in full** (`:9-23,27-36,38-60,62-71,78-99,104-124`); `finance-accounts/spec.md:25-50,89`; `finance-assets/spec.md:40-70`; `frontend-dashboard/spec.md:32-36`; `mcp-dashboard/spec.md` (create-account schema); `frontend-i18n` keys.
- Change specs: `openspec/changes/2026-10-03-finance-ui-fixes/specs/finance-accounts/spec.md` requires showing the account type → superseded by W1 (resolution 7).
- MCP: `mcp-dashboard/src/tools.ts:81-87` (`CreateAccountSchema` enum + card fields), `:312-323` (tool description), `:290-294`, `:337-343`.
- Docs: `objetivo.md:46-53` lists "Tarjeta de crédito" as an account kind → doc edit required.

## 2. W2 — transfer as a movement

No transfer concept exists: `movement_direction` = `('expense','income')` (`0012_movements.sql:23`), module doc `movements.rs:3-8` says so, `main.rs:53-57` records that `/transfers` was removed, `objetivo.md:125-129` carries the 2026-09-23 reversion note.

| Layer | Evidence |
| --- | --- |
| Contract | `movements.rs:87-103` `CreateMovementRequest` (`deny_unknown_fields`, `category_id` required), `:105-116` `PatchMovementRequest` |
| Direction guard | `movements.rs:176-184` `validate_direction` (exactly expense/income, Spanish 422); `:231-239` `signed_delta` (`expense ? -amount : +amount` → an unknown direction would **add**) |
| SQL | `:53` `LOCK_ACCOUNT_SQL FOR UPDATE`; `:54` insert; `:55` `APPLY_BALANCE_SQL`; `:56` update; `:57-58` delete `RETURNING account_id, direction::text, amount`; `:59-60` list/get; `:64` lock movement; row tuple `:70-81` (10 columns, sqlx cap 16) |
| Handlers | `:241-294` create; `:328-480` patch (bounded retry, ascending-UUID lock order, reverse-then-apply); `:482-511` delete (reverses delta) |
| Subscription pay | `subscriptions.rs:84` inserts an expense movement + debit in one transaction — unaffected, shares the lock discipline |
| FE wire | `lib/api/finance.ts:110-126`, `:127-141`, `:142-158` (`useMovements` on `finance/movements`) |
| FE transform | `lib/finance/finance.ts:248-260`, `:282-301` `toMovementRows` |
| FE modal | `components/finance/MovementForms.tsx:29-32,203-214,127-131,90-93` |
| FE history | `components/finance/MovementHistory.tsx:53,64-68,164-186,217-223`; entry buttons in `FinanceScreens.tsx:311-345`; modal mounted `:348-356` |
| Tests pinning it | `movements.rs:524-528,629-682,693-708` unit; `:913-1450`, `:1564+` live; `backend/tests/migration_0012_movements.rs:258-277` asserts the enum holds **exactly** `["expense","income"]` |
| Canonical pins | `finance-movements/spec.md:13-14` (exactly two values), `:17-33` (REST allowlists), `:229` ("No transfers" non-goal), `:230` (no MCP movement tools); `finance-core-invariants/spec.md:17` (forbids live references to `/transfers` and `apply_transfer_counterparty`); `frontend-i18n/spec.md:63` (forbids re-adding the deleted transfer key family; the *payment-method* "Transferencia" at `:74-76` survives) |

**The ten aggregation points that mis-bucket a `transfer` row (W2 must exclude all):**

| # | Aggregate | Evidence | Behaviour today |
| --- | --- | --- | --- |
| 1 | `toCategoryMovementTotals` | `finance.ts:326-343` (branch `:338-339`) | non-expense → counted as income |
| 2 | `toCategoryTrend` | `finance.ts:516-551` (`:537-539`) | transfer lands in the `ingreso` series |
| 3 | `toTotalTrend` | `finance.ts:553-579` (`:573-574`) | same, in `TotalTrendSection` |
| 4 | `toExpenseByCategory` (pie) | `finance.ts:629-657` (gate `:641`) | excluded by direction, but only incidentally |
| 5 | Movement rows type + history filter | `finance.ts:248-260,282-301`; `MovementHistory.tsx:53,64-68,164-186,217-223` | type error / renders as "Ingreso" |
| 6 | Dashboard last-movements widget | `components/dashboard/widgets/MovementsSnapshot.tsx:49-53,82-85` | labelled "Ingreso" |
| 7 | Pie section, trend section, category charts, compare page | `ExpensePieSection.tsx:32-36`; `TotalTrendSection.tsx:26-28`; `CategoryCharts.tsx:38-44`; `app/dashboard/finance/compare/page.tsx:46-50` | read the shared key + transforms |
| 8 | Currency guard | `finance.ts:313-321` `isUserCurrencyMovement` | transfers keep the single-currency rule |
| 9 | Backend balance effect | `movements.rs:55,233-239` | unknown direction would **add**; the destination leg needs its own effect in the same transaction |
| 10 | MCP surface | no movement tool exists; `mcp-dashboard/spec.md:17-18,71-75,173` forbids adding one | registry must stay unchanged |

## 3. W3 — login/session surface

Entry points: `POST /api/login` (`main.rs:65`), `POST /api/logout` (`:66`), `GET /api/me` (`:67`), `GET/POST/DELETE /api/tokens` (`:206-211`). There is **no `/sessions` route**.

| Finding | Exact surface | Pinning tests |
| --- | --- | --- |
| A1 XFF trust | `login.rs:70-90` (trusted peer ⇒ `split(',').find_map(parse)` = **first** parseable element, fallback peer `:81-89`), call site `:112`; trusted set from `config.rs:85-104`; carried on the limiter `auth/rate_limit.rs:41-50` | `login.rs:233-243`, `:244-260`, `:351-388`; canonical `session-auth/spec.md:63-67` pins "the first XFF element is used as the key" |
| A2 global lockout | `login.rs:112-116`; `rate_limit.rs:12-13` (10 / 15 min), `:96-142` (`check()` records **every** call, so successes consume quota); `docker-compose.yml:1-14` sets no `TRUSTED_PROXIES` | `login.rs:287-328`, `:329-349`, `:411-434`; `session-auth:69,71` |
| A3 timing enumeration | `login.rs:119-130` (unknown email returns at `:124-126` **before** Argon2; inactive short-circuits at `:128-130`); `auth/password.rs:31-40` | no timing test; `session-auth:36-40` only requires the generic 401 |
| A4 inactive users keep access | `auth/middleware.rs:23-24` (`SESSION_LOOKUP_SQL`, no `users` join) and `:25-26` (`API_TOKEN_LOOKUP_SQL`); `auth/helper.rs:30-40`; `logout.rs:13`; `login.rs:128` is the only `is_active` read | `helper.rs`/`middleware.rs` unit tests; no deactivation scenario in the spec |
| A5 rotation / revoke-all | `logout.rs:12-38` revokes only the presented hash; `login.rs:132-142` inserts a new session (**never binds `user_agent`**); sessions table `0001:72-82` + index `:84-86`; no session-list endpoint in `main.rs:63-211` | `session-auth:100-112` (logout only); `tokens.rs:464-526` is the closest UX precedent |
| A7 no-store | `main.rs:271-286` is the only header layer; `login.rs:145` returns the raw token; `tokens.rs:190` returns the one-shot raw API token | no test asserts `Cache-Control` |

Where A5 attaches: backend route block `main.rs:206-211` (sibling of `/tokens`); `me.rs:19-63` already joins `sessions→users→user_preferences`; frontend settings hub `frontend/app/dashboard/ajustes/page.tsx:30-38`, page pattern `app/dashboard/ajustes/tokens/page.tsx:25-79` with `frontend/lib/api/tokens.ts:12-48`; nav `components/layout/AppShell.tsx:131-134`; i18n families `settings.*` (`es.ts:740-750`) and `tokens.*`.

## 4. W4 — Productivity structure, hooks, reusable grid

Screen: `frontend/app/dashboard/productivity/page.tsx` → `frontend/components/containers/ProductivityScreens.tsx`. It is **not tabbed**: one `grid-cols-12` (`:316-321`) renders Metas (`:322-368`), Tareas (`:369-403`, `TaskViewTabs` `:396`), Eventos (`:404-437`, `EventViewTabs` `:430`), Notas (`:438-472`); each section has a per-section «Nuevo» collapsible form (`openSection` machine `:97-100`, `openForm`/`toggleForm` `:242-263`, focus handling `:267-279`). No calendar view, no disclosure component here.

Hooks: `useTasks()` (`lib/api/productivity.ts:113-115`, key `productivity/tasks`, no date filter); `useEvents(from)` (`:117-127`) with `eventsFrom` pinned **once** to `new Date().toISOString()` (`ProductivityScreens.tsx:110`) → only events ending after "now" are fetched (`backend/src/routes/events.rs:61`). Two-bound reads exist (`lib/api/dashboard.ts:115-118`; `toEventRange` in `lib/finance/finance.ts:239-241` converts `YYYY-MM-DD`→RFC3339 because `GET /events` rejects bare dates, `events.rs:748-757`). Task wire `TaskWire.due_date` (`productivity.ts:39-49`); event wire `EventWire.starts_at/ends_at/all_day/kind` (`:51-59`).

Reusable pure helpers: `filterTasksByDateView`/`countTasksByDateView` (`lib/productivity/productivity.ts:134-166`), `filterEventsByTimeView`/`countEventsByTimeView` (`:183-207`), `todayYmdLocal` (`:117-121`), `toISODate` (`lib/dashboard/transforms.ts:48-51`).

Existing month grid (habits): `components/productivity/HabitHistorySection.tsx:34,48-56,145-175` (real `role="grid"`, 42 Monday-first cells from `logsToCalendarCells` in `lib/productivity/habitStats.ts:77-100`), `ui/HabitsHeatmap.tsx:25-31`, `formatMonth` (`lib/i18n/index.ts:45-57`). Dashboard disclosure pattern: `components/dashboard/DashboardDisclosure.tsx` (+ its test).

Specs: `productivity-layout/spec.md:11-16,36+` pins the four-section 12-column arithmetic and order; `calendar-events` and `task-management` hold the data contracts.

## 5. W5 — payment-method label and transfer distinction

- History meta line today: `{displayDate} · {accountName}`, no label (`MovementHistory.tsx:222-225`); the category sits on the header line `:217-221`.
- `finance.paymentMethod` = "Método de pago" already exists (`es.ts:123`), consumed by the subscriptions form (`settings/SubscriptionsSection.tsx:220-223`, asserted at `SubscriptionsSection.test.tsx:77`); `finance.paymentTransfer` = "Transferencia" survives (`es.ts:127`).
- Name collision to resolve: `finance.movementPaymentLabel` = "Tipo de movimiento" is the **direction** select in the movement modal (`MovementForms.tsx:203-214`, `es.ts:193`); the direction filter label is `finance.movementFilterDirection` = "Tipo" (`MovementHistory.tsx:163-171`, `es.ts:205`).
- Nothing distinguishes a third direction: `MovementHistory.tsx:217-223` and `MovementsSnapshot.tsx:82-85` are binary ternaries. Row assertions: `MovementHistory.test.tsx:159-183,224-236,241-248`, `finance.test.tsx:168-172`.

## 6. Test surfaces and exact commands

| Suite | Command | Evidence |
| --- | --- | --- |
| Backend unit + DB-gated integration | `cd backend && cargo test --locked` | `.github/workflows/ci.yml:11-37`; DB-gated tests self-skip without `DATABASE_URL` |
| Apply migrations for backend tests | `for m in backend/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$m"; done` | `ci.yml:30-36` (autocommit, no `_sqlx_migrations` table) |
| Frontend unit/component | `cd frontend && pnpm test` (vitest run) | `frontend/package.json:11` |
| Frontend build (type gate incl. i18n keys) | `cd frontend && pnpm run build` | `package.json:8`; `ci.yml:52-53` |
| E2E discovery | `cd frontend && pnpm exec playwright test --list` | `ci.yml:56` |
| E2E live smoke | `E2E_SMOKE_LIVE=1 E2E_USER=… E2E_PASSWORD=… pnpm test:e2e` | `package.json:13`; `playwright.config.ts:7-19,32`; `e2e/helpers.ts:4,14-31` |
| MCP | `cd mcp-dashboard && npm run typecheck && npm run build` (no tests) | `mcp-dashboard/package.json:6-10` |

Inventory that W1–W5 will touch: backend inline test modules in `routes/{accounts,movements,login,logout,me,tokens,assets,subscriptions}.rs` and `auth/**`; `backend/tests/{migration_0007,migration_0008,migration_0011,migration_0012,migration_0013}*`; frontend `components/**/*.test.tsx` (finance, dashboard + widgets + charts, containers, productivity, settings, ui, notifications) and `lib/**/*.test.ts` (api, finance, dashboard, i18n, productivity, settings); app-route tests under `app/**`; e2e specs `auth`, `dashboard`, `dashboard-widgets`, `guards`, `notifications`, `sections` (live-gated) and `productivity-layout` (ungated; **rewrites committed evidence artifacts** under `openspec/.../evidence/`, revert with `git checkout --`).

## 7. Risks

1. **Spec contradictions to resolve explicitly.** W2 reverses `finance-movements:13-14,229`, `finance-core-invariants:17` and the `objetivo.md:125-129` reversion note. W1 reverses `credit-card-summary` (whole file), `finance-accounts:25-50,89`, `finance-assets:40-70`, `frontend-dashboard:32-36`, the MCP create-account schema and the newest `finance-ui-fixes` delta. `finance-assets` pins the net-worth wire as "unchanged for consumers" while `debts` loses its only producer. `finance-core-invariants:188-215` mandates dated reversal notes in `objetivo.md` — the transfer reversal is a third history item and the doc diff is constrained.
2. **Migration discipline.** Migrations are applied out-of-band with autocommit and there is no `_sqlx_migrations` table. Applied files are never edited (guards in `migration_0011_removal.rs:25-60`, `migration_0012_movements.rs:79-110`), so W1's drops (3 CHECKs, `idx_accounts_user_card`, `type`, card columns, then `DROP TYPE account_type`) must land in a new file 0014 while `0008` stays byte-identical.
3. **`NOT NULL` drop with live rows.** `accounts.type` is `NOT NULL` with 5 rows and no default; dropping it touches every insert/select in `accounts.rs`, the `AccountWire` consumed by Dashboard telemetry, Finance, Settings and the MCP `list_accounts` tool. The movement modal's account selector uses `id`/`name` only (`FinanceScreens.tsx:240-245`) and is safe.
4. **W2 atomicity and locking.** Create locks the account row first and re-reads under the lock; patch uses a bounded retry with ascending-UUID lock order (`movements.rs:328-480`, `:367-380`). A one-row transfer touches two accounts, so it must follow that order; `DELETE` returns only `(account_id, direction, amount)` (`:57-58`) so a transfer reversal needs the destination too — the delete SQL and the 10-column row tuple (sqlx cap 16) are in the blast radius.
5. **Aggregation silent regressions.** `signed_delta` defaults unknown directions to `+amount` (`movements.rs:233-239`) and three frontend transforms default non-expense to income (`finance.ts:338-339,537-539,573-574`); the two list renderers ternary on expense. §2's ten-point table is the checklist.
6. **W3 sequencing.** A1 contradicts a canonical scenario and two green tests; A2 changes the limiter key type (`HashMap<IpAddr, Vec<Instant>>`, `rate_limit.rs:16`) and its bounded-key tests (`:150-190`); A3's dummy-hash verify adds ~19 MiB per failed login (do not widen the DoS surface); A4's `is_active` join touches every authed request; A5's revoke-all must not revoke the caller's own session and must never expose `token_hash` (`session-auth:104-112,145-152`); A7 must not blanket every response if it joins the global `SetResponseHeaderLayer::overriding` stack (`main.rs:271-286`).
7. **W4 range semantics.** The events read is one-sided (`from = now`), the backend predicate is an overlap (`events.rs:23-27`) and rejects bare dates (`:748-757`, hence `toEventRange`). A past-month grid has no fetched events today, and `productivity-layout` pins the current arithmetic.
8. **i18n hygiene.** `frontend-i18n:63` forbids re-adding the deleted transfer key family while `finance.paymentTransfer` must survive; new copy needs new keys, and `tsc`/`next build` fails on unknown `EsKey`s.
9. **MCP drift.** Separate npm package, no tests; `mcp-dashboard/spec.md:17-18,71-75,173` forbids movement/transfer tools and requires the README catalog to stay in step. W1 breaks its create-account schema.
10. **DB safety.** Production is the sanctioned verification DB (throwaway user, cascade cleanup), but the W2 migration is applied there (authorized) and W1 is destructive (authorized). `migration_0011_removal.rs:47-50` and `migration_0012_movements.rs:120-124` warn their live tests must never point at production — the same caution applies to any new migration test.

## 8. Non-binding

- `openspec/changes/archive/**` still contains ~40 historical references to card fields; they are superseded records, excluded from the live inventory.
- `frontend/e2e/dashboard.spec.ts:14`'s stale "Flujo mensual" assertion was already repaired by commit `9516e0a`; treat any reproduction as a stale-checkout artefact, not a finding.
- Nothing was executed, so every "no other consumer" statement is a grep over tracked files, not a runtime trace. Line numbers are from the current working tree on `main`.
