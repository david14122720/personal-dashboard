# Proposal — 2026-10-04-accounts-transfers-login-calendar

## Why

`explore.md` (2026-10-04) and `security-audit.md` (2026-10-04) found five independent problems whose cost is roughly constant regardless of when they are fixed:

1. **The account type and the whole credit-card semantic layer are dead weight.** `accounts.type` is `NOT NULL` and travels through every account create/list/get/patch, the frontend wire, the Finance row and the MCP tool, yet it drives only one visible chip and a card-metrics computation that no component reads. Production holds 5 accounts and 0 cards, so no card surface has ever been exercised. The owner confirmed twice that the layer must be removed, destructive migration included.
2. **Transfers do not exist, and the 2026-09-23 reversal did not survive contact with real use.** `finance-movements` pins exactly two directions and lists «No transfers» as a non-goal, `finance-core-invariants` forbids live references to the removed `/transfers` module, and `objetivo.md` records the reversal — but the owner now wants money movement between own accounts recorded as one ledger row with one atomic effect, not as two manual balance edits.
3. **The login/session surface carries four exploitable or fragile behaviours plus a missing capability** (`security-audit.md` A1–A4, A7, A5): a spoofable `X-Forwarded-For` key that can bypass the limiter entirely, a shared-IP lockout that burns quota on successful logins, an Argon2-skipping timing oracle on unknown/inactive accounts, `is_active=false` sessions and API tokens that keep working, secret-bearing responses without `Cache-Control: no-store`, and no way to list or revoke sessions.
4. **The Productivity screen has no calendar.** Tasks and events already carry the dates and the time helpers, the habit history renders a real Monday-first 42-cell grid, and the Dashboard already owns a disclosure pattern — but a user cannot see their month in one place.
5. **Movement history rows do not say how money moved.** An expense row is indistinguishable from an income row in the metadata line, and the dashboard snapshot labels every non-expense row «Ingreso», so a future transfer row would render as income.

## What changes

### W1 — Account type and the credit-card semantic layer leave the product

- **Backend/DB**: migration **0016** carries the destructive block (`DROP CONSTRAINT` ×3, `DROP INDEX idx_accounts_user_card`, `DROP COLUMN credit_limit/statement_day/payment_due_day`, `DROP COLUMN type`, `DROP TYPE account_type`) in the safe order, authorized by the owner on 2026-10-04. `CreateAccountRequest` loses `type` and the three card fields; `AccountResponse` loses `type`, `credit_limit`, `statement_day`, `payment_due_day`, `used_balance`, `available_balance`, `usage_pct`, `alert_level` and `statement_balance`; `ACCOUNT_TYPES`, `validate_account_type`, `validate_card_fields` and `compute_card_metrics` are deleted. `NET_WORTH_SQL` becomes assets-only and the wire entry becomes `{currency, assets, net_worth}` (the always-zero `debts` field is removed; verified: no live consumer reads it).
- **Frontend**: `AccountWire` loses `type` and `alert_level`; `toAccountCards` loses every card-derived field and the `type === "credit_card"` branch; the Finance row loses its type chip; `BankAccountsSection` lists every non-archived account instead of filtering `row.type === "bank"` and creates with `{name}` only; the `finance.accountTypeLabel` key is retired.
- **MCP**: `CreateAccountSchema` loses the type enum and the card fields; the tool description and README catalog follow.
- **Supersession**: this change supersedes the `2026-10-03-finance-ui-fixes` delta requirement that the account row keep the account type (that clause only).

### W2 — Transfers return as one ledger row

- **Data**: three migrations in order: **0014** adds the enum value with `ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer'` outside any transaction (a value cannot be used in the transaction that adds it — Postgres `55P04`); **0015** adds the nullable `transfer_account_id` (`FK → accounts(id) ON DELETE RESTRICT`) with the consistency CHECK `(direction = 'transfer') = (transfer_account_id IS NOT NULL)`, the non-self CHECK and the no-category CHECK `(direction <> 'transfer') OR (category_id IS NULL)`, plus the `idx_movements_transfer_account` index, in its own transaction, safe only because 0014 committed earlier; **0016** is the W1 destructive block.
- **Contract**: a new `POST /api/movements/transfer` (deliberately not `/api/transfers`, which `finance-core-invariants` forbids resurrecting) takes `{from_account_id, to_account_id, amount, occurred_on, description?}`, validates ownership, amount and date, rejects same-account and cross-currency transfers with 422, locks both accounts in ascending UUID order and applies both balance legs in one sqlx transaction. `signed_delta` becomes direction-aware and fails closed on unknown directions; responses gain `transfer_account_id`; `MovementRow` grows from 10 to 11 columns, inside the sqlx 16-column cap.
- **Deletion**: deleting a transfer reverses both legs in one transaction; `PATCH` on a transfer row is 422 (delete + recreate), so no edit path can desynchronise the pair and a two-leg reversal plus lock ordering is out of scope for this change. The account-delete 409 guard additionally counts transfers where the account is the destination, matching the new `ON DELETE RESTRICT` FK.
- **Aggregations**: all ten mis-bucketing points listed in `explore.md` §2 are excluded by construction and pinned by tests: the transfer is neither income nor expense in the four client-side aggregates, the two list renderers gain a third branch, the currency guard applies unchanged, the backend applies two legs, and the MCP surface gains no movement or transfer tool.
- **UI**: a third entry control «Transferir» next to Agregar gasto / Agregar ingreso, a transfer modal (origin, destination, amount, date, description), a third history filter option, and transfer rows that render `Transferencia: <origen> → <destino>`.

### W3 — Login and session hardening

- **A1**: the limiter key walks `X-Forwarded-For` right-to-left and uses the right-most element outside the trusted set; the canonical scenario that pinned the first element is superseded in the same change.
- **A2**: rate limiting is per client IP (10 failures / 15 min) **and** per normalized account email (5 failures / 15 min), counts failures only, never consumes quota on success, and clears the account bucket on a successful login; a 429 is generic with `Retry-After`, an already-authenticated session is never throttled, and the residual self-lockout delay — bounded by the 15-minute window — is accepted and measured.
- **A3**: the login handler always runs exactly one Argon2id verification (stored hash or a fixed dummy PHC hash) before returning the generic 401, and evaluates `is_active` after it.
- **A4**: both session and API-token lookups join `users` and require `is_active = true`, including `GET /api/me` and logout.
- **A5**: `GET /api/sessions` (metadata only, never `token_hash`, `current` flag) and `DELETE /api/sessions` (revoke every active session except the presenting one, 204, idempotent), both session-only, plus a minimal Settings section with a «Cerrar otras sesiones» action.
- **A7**: `Cache-Control: no-store` on exactly the two responses that carry a one-shot secret (`POST /api/login`, `POST /api/tokens`), placed on those handlers, not in the global header layer.

### W4 — Productivity calendar

A new full-width, collapsed-by-default block rendered first in the Productivity `grid-cols-12`, reusing the Dashboard disclosure pattern: Monday-first 42-cell month grid built from the same cell shape as the habit history, prev/next month and «Hoy», task-vs-event markers distinguishable without colour alone, and a day-detail expansion listing that day's tasks and events. The events read widens to both bounds (`useEvents(from, to)`, RFC 3339 via `toEventRange`) so past months render too.

### W5 — Movement row copy

Expense rows show `Método de pago: <cuenta>` (reusing `finance.paymentMethod`), income rows show `Cuenta: <cuenta>`, and transfer rows show `Transferencia: <origen> → <destino>`. New copy uses new typed keys; `finance.paymentTransfer` keeps naming the subscription payment method only.

## Decisions taken before implementation

All from `explore.md` §0; this proposal treats them as binding:

1. A transfer is **one ledger row**: enum value `transfer` + nullable `transfer_account_id`, `account_id` is the origin, both legs in one transaction, excluded from category charts and income/expense totals.
2. The credit-card semantic layer is removed by explicit owner decision; this is an accepted owner loss, not a bug.
3. Migrations 0014–0016 (the additive transfer enum/column and the destructive block) may be applied to the production DB for local verification, one file at a time; the destructive 0016 block is explicitly authorized.
4. W3 scope is A1–A4 and A7 **plus** A5 session management.
5. No account type control may exist anywhere: not in Finance, not in Settings, not in the API, not in the database, not in MCP.
6. The card wire surface and the always-zero `debts` net-worth field are removed; patrimonio becomes assets-only, and `credit-card-summary` is retired.
7. W1 explicitly supersedes the `2026-10-03-finance-ui-fixes` delta requirement that the account row show its type.
8. Transfers carry no category (`category_id` NULL, `subscription_id` NULL) and are created through `POST /api/movements/transfer`.
9. W5 reuses `finance.paymentMethod` for expense rows and adds new keys for the income and transfer labels.
10. W4 is a new block inside the Productivity grid, rendered first, collapsed by default, using the Dashboard disclosure pattern; `productivity-layout` gets a delta.
11. A1 is fixed properly (right-most XFF element outside the trusted set), which contradicts the canonical `session-auth` scenario and two green tests; the delta and the tests change together.

## Reversals and accepted losses

**(a) The credit-card semantic layer is removed by explicit owner decision.** Patrimonio becomes assets-only (`Σ current_value`, no liabilities leg), the `credit-card-summary` capability is retired in full, and the account type/limit/cycle fields, the card metrics and their wire fields are deleted. **No real data is lost**: production holds 5 accounts and 0 credit-card accounts, so the card columns are all NULL and no statement/usage figure has ever been produced. The destructive block is authorized (owner, 2026-10-04) and recorded here as an accepted loss. `objetivo.md` lists «Tarjeta de crédito» as an account kind; that section MUST be corrected with a dated note.

**(b) Transfers return after the 2026-09-23 reversal, deliberately under a different shape.** The deleted `/transfers` module, its `apply_transfer_counterparty` function, its group id and its dedicated history UI do **not** return and MUST stay absent (`finance-core-invariants`). A transfer is now exactly one `movements` row with `direction = 'transfer'`, `account_id` = origin and `transfer_account_id` = destination, plus two balance legs in one transaction. The 2026-09-23 reasoning (the module's cost exceeded its value) is preserved as history: the new shape has no route family, no table, no trigger and no separate UI — only one enum value, one column and one endpoint.

**(c) `objetivo.md` is updated with dated reversal notes in the same change.** `finance-core-invariants` requires that discipline (the 2026-09-23 and 2026-09-24 notes are the precedent): the Transferencias section gets a dated 2026-10-04 note reversing the 2026-09-23 reversal and naming the one-ledger-row shape, and the Cuentas section gets a dated 2026-10-04 note removing the credit-card kind. Both older notes MUST remain readable and the diff MUST touch only those sections.

## Impact

- **Surfaces**: backend (`accounts`, `assets` net worth, `movements`, `login`, `logout`, `me`, `tokens`, `auth/*`, new `sessions`), migrations (new 0014–0016), frontend (Finance accounts/movements, Settings accounts + new sessions section, Productivity calendar, Dashboard snapshot copy, i18n), MCP create-account schema, tested docs (`objetivo.md`).
- **Data**: 0014 adds one enum value, 0015 one nullable column + constraints + index, and 0016 drops the unused card layer. No data migration, no backup and no dual read (`finance-core-invariants` no-backup posture).
- **Tests**: backend inline modules (`accounts`, `assets`, `movements`, `login`, `logout`, `me`, `tokens`, `auth/**`), `backend/tests/migration_0008_credit_cards.rs`, a new `migration_0014_0016_*` guard, `backend/tests/migration_0012_movements.rs` (enum pin), frontend unit/component suites for every touched surface, and live Playwright verification.
- **Sequencing**: W1 ships migrations 0014–0016 (0014/0015 declare the W2 transfer objects, 0016 is the authorized destructive block, applied in order); W2 depends on them and on W1's `movements.rs` baseline. W5 depends on W2's `MovementRowView.direction` widening. W3 is backend-first (A1–A4+A7), then sessions (A5) backend → frontend. W4 is independent of finance. `frontend/lib/i18n/es.ts` is touched by W1, W2, W3 and W4 and therefore runs sequentially, never concurrently.

**Review-workload forecast** (approximate authored/changed lines; a whole slice over 400 lines is split into the listed work units so each review stays bounded):

| Slice | Files touched | Approx. lines | Largest work unit | Over 400? |
| --- | --- | --- | --- | --- |
| W1 — type + card layer out | ~17 | ~880 | W1a migrations 0014–0016 + `accounts.rs` + backend guards (~450) | Yes as a slice; units split (W1a–W1c) |
| W2 — transfers | ~11 | ~1440 | W2a backend movement slice (~500) | Yes as a slice; units split (W2a–W2d) |
| W3 — login/sessions | ~17 | ~1260 | W3a login hardening (~450) | Yes as a slice; units split (W3a–W3c) |
| W4 — calendar | ~6 | ~565 | W4b calendar component + tests (~415) | Yes as a slice; units split (W4a–W4c) |
| W5 — row copy | ~4 | ~140 | W5 single unit (~140) | No |
| W0/W6 — artifacts + verification | 10 + 0 | ~1200 doc lines / 0 product lines | W6 verification has no authored product lines | No |

## Non-goals

- No change to asset valuations, subscriptions, categories, habits, goals, tasks, notes, notifications or their contracts.
- No multi-currency transfer support: transfers between accounts of different currencies are rejected with 422 as a deliberate refusal, consistent with the single-currency rule and the earlier currency-leak fix, never a silent conversion.
- No transfer editing: `PATCH` on a transfer is 422 because a two-leg reversal plus lock ordering is out of scope for this change; corrections are delete + recreate.
- No transfer MCP tool, no transfer chart, no transfer page, no `/api/transfers` route, no `apply_transfer_counterparty` function, no transfer group id.
- No account type replacement, label map, badge or migration of the type value to another column.
- No card data migration, backup, dual read or compatibility view; the card layer is simply dropped.
- No HttpOnly-cookie rework (A10), no API-token scope enforcement or default expiry (A6), no `--create-user` argv change (A9), no TLS/HSTS change (A8) — all remain documented risks.
- No idle session timeout, no session rotation on password change beyond what A5 lists, no revoke-by-id endpoint.
- No new dependency in backend, frontend or MCP; no lockfile change.
- No redesign of the Productivity four sections' data contracts, no calendar in Dashboard, no date navigation beyond prev/next month + «Hoy».
- No change to the Dashboard chart disclosures or their keys.

## Verification

1. **W0** (this task): `proposal.md`, `design.md`, `tasks.md` and ten capability deltas under `specs/`, written in English, no source change.
2. **W1–W5** each record RED-before-GREEN evidence for their smallest behaviour test and run only the focused suites they own, plus `node node_modules/typescript/bin/tsc --noEmit` before hand-off.
3. **W6** runs the full suites and build: `cd backend && cargo test --locked`, `cd frontend && pnpm test`, `cd frontend && pnpm run build`, `cd mcp-dashboard && npm run typecheck && npm run build`, and `pnpm exec playwright test --list` for discovery.
4. **Live Playwright** on the local stack pointed at the production DB with a throwaway `--create-user` account runs the explicit list: (a) accounts show no type anywhere and creating/editing an account never asks for one, (b) the full "Mover dinero" flow subtracts from the origin, adds to the destination and appears in Movimientos as a transfer, (c) the monthly calendar toggles, distinguishes task vs event and reveals a day's detail on click, (d) an expense row shows the "Método de pago" label with the account name, and (e) zero console errors and zero page errors across those runs, with the throwaway-user cleanup proven. The ungated `productivity-layout.spec.ts` evidence spec is **not** run (it rewrites committed evidence under the 2026-09-23 change folder).
5. The throwaway user is deleted at the end of the session and every row cascades. No commit, push or deploy is produced by this change.
