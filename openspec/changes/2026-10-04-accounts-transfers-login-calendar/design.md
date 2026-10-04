# Design — 2026-10-04-accounts-transfers-login-calendar

## Approach

Five independent workstreams with one shared constraint each. W1 removes an unused layer end to end (DB → backend → wire → frontend → MCP) in one authorized destructive migration (0016). W2 reuses the surviving movement transaction machinery instead of rebuilding the deleted transfers module: one enum value, one column, one endpoint, two balance legs. W3 is a security slice that changes the limiter's key model and adds the missing session-management capability without widening the request surface. W4 is a presentational block composed from existing helpers (habit-history cell shape, `DashboardDisclosure`, `toEventRange`) plus one widened read. W5 is copy plus two renderer branches. No new dependency is added anywhere.

| Unit | Files owned | Depends on |
|---|---|---|
| **W0 — artifacts** | this folder (`proposal.md`, `design.md`, `tasks.md`, `specs/**`) | — |
| **W1a — migrations 0014–0016 + backend account-type removal** | `backend/migrations/0014_movement_transfer_enum.sql`, `backend/migrations/0015_movement_transfer_account.sql`, `backend/migrations/0016_remove_account_type_and_card_fields.sql`, `backend/src/routes/accounts.rs`, `backend/tests/migration_0008_credit_cards.rs`, `backend/tests/migration_0014_0016_transfers_account_type.rs` (new) | W0 |
| **W1b — net-worth assets-only** | `backend/src/routes/assets.rs` (+ inline tests) | W1a (schema) |
| **W1c — frontend wire/UI/settings/i18n** | `frontend/lib/api/dashboard.ts`, `frontend/lib/api/finance.ts`, `frontend/lib/finance/finance.ts`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/settings/BankAccountsSection.tsx`, `frontend/lib/i18n/es.ts` (`finance.accountTypeLabel`, `settings.accounts*` values), plus the five pinning test files (§Testing strategy) | W1a, W1b |
| **W1d — MCP** | `mcp-dashboard/src/tools.ts`, `mcp-dashboard/README.md` | W1c |
| **W2a — transfer backend** | `backend/src/routes/movements.rs` (+ inline tests), `backend/tests/migration_0012_movements.rs` (enum pin), `backend/src/main.rs` (route) | W1a |
| **W2b — frontend transforms** | `frontend/lib/api/finance.ts`, `frontend/lib/finance/finance.ts`, `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/movements.test.ts` | W2a |
| **W2c — transfer UI** | `frontend/components/finance/MovementForms.tsx`, `frontend/components/finance/MovementHistory.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/components/dashboard/widgets/MovementsSnapshot.tsx`, `frontend/lib/i18n/es.ts` (`finance.transfer*`/`finance.movement*` keys) | W2b |
| **W2d — transfer tests + copy** | component tests for `MovementForms`, `MovementHistory`, `FinanceScreens`, `MovementsSnapshot` + the W5 row-copy assertions | W2c |
| **W3a — login hardening (A1, A2, A3, A7)** | `backend/src/routes/login.rs`, `backend/src/auth/rate_limit.rs`, `backend/src/auth/password.rs`, `backend/src/routes/tokens.rs` (no-store only) | W1 |
| **W3b — is_active enforcement (A4)** | `backend/src/auth/middleware.rs`, `backend/src/auth/helper.rs`, `backend/src/routes/me.rs`, `backend/src/routes/logout.rs` | W3a |
| **W3c — sessions (A5)** | `backend/src/routes/sessions.rs` (new), `backend/src/routes/mod.rs`, `backend/src/main.rs`, `frontend/lib/api/sessions.ts` (new), `frontend/components/settings/SessionsSection.tsx` (new), `frontend/app/dashboard/ajustes/page.tsx`, `frontend/lib/i18n/es.ts` (`settings.sessions*`) | W3b |
| **W4a — calendar helpers + widened read** | `frontend/lib/productivity/calendar.ts` (new), `frontend/lib/productivity/calendar.test.ts` (new), `frontend/lib/api/productivity.ts` (`useEvents`) | W1 |
| **W4b — calendar component** | `frontend/components/productivity/ProductivityCalendar.tsx` (new), `frontend/components/productivity/ProductivityCalendar.test.tsx` (new) | W4a |
| **W4c — wiring, skeleton, i18n** | `frontend/components/containers/ProductivityScreens.tsx`, `frontend/lib/i18n/es.ts` (`productivity.calendar*`), `frontend/components/productivity/productivity.test.tsx` | W4b |
| **W5** | folded into W2d for transfers; expense/income row copy in `MovementHistory.tsx` + `MovementsSnapshot.tsx` + their tests | W2c |
| **W6 — verification** | no product files | W1–W5 |

**Sequencing that is not negotiable.** (1) 0014–0016 land together in W1a: 0014 commits the enum value outside a transaction, 0015 adds the transfer column/CHECKs/index, and 0016 is the W1 destructive block; W2a only builds on them, and the three files apply one at a time in numeric order (never folded into a single transaction — see D1). (2) `frontend/lib/i18n/es.ts` is touched by W1c, W2c, W3c and W4c, so those units run strictly sequentially and every key lands in the same unit that consumes it. (3) `frontend/lib/finance/finance.ts` is touched by W1c and W2b; `frontend/lib/api/finance.ts` by W1c and W2b; `frontend/components/containers/FinanceScreens.tsx` by W1c and W2c; `backend/src/main.rs` by W2a and W3c. (4) W5 depends on W2c's third direction branch.

## D1 — Migrations 0014–0016

**Files**: `backend/migrations/0014_movement_transfer_enum.sql`, `backend/migrations/0015_movement_transfer_account.sql`, `backend/migrations/0016_remove_account_type_and_card_fields.sql` (all new; applied out of band exactly like 0001–0013, one file at a time and in numeric order). The split is forced by Postgres: a value added by `ALTER TYPE … ADD VALUE` cannot be used in the transaction that added it (`55P04` "unsafe use of new value of enum type"), and every migration body in this repository is wrapped in `BEGIN; … COMMIT;`. 0014 therefore stays outside a transaction and commits the value; 0015 uses it in its own transaction; 0016 carries the W1 destructive block. The three files MUST keep the per-file autocommit the CI loop uses (`psql -f` per file) — never folded into one `psql` transaction spanning 0014 and 0015, which would reintroduce `55P04`.

### D1.1 Ordered content

**`0014_movement_transfer_enum.sql`** — the only migration with no explicit transaction block:

```sql
-- Migration 0014: add the transfer direction to the movement enum.
--
-- This file MUST stay outside any explicit transaction block: Postgres raises
-- 55P04 ("unsafe use of new value ... of enum type") when a value added by
-- ALTER TYPE ... ADD VALUE is used in the same transaction, and every other
-- migration in this project wraps its body in BEGIN; ... COMMIT;. Applied with
-- autocommit (CI loops psql over migrations/*.sql one file at a time), the
-- value is committed here so 0015 is free to reference 'transfer'.
ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer';
```

**`0015_movement_transfer_account.sql`** — its own transaction; safe only because 0014 committed earlier:

```sql
BEGIN;

-- Safe only because 0014 committed earlier: the CHECKs below reference
-- 'transfer', which a transaction that added the value could not do (55P04).
ALTER TABLE movements
    ADD COLUMN transfer_account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE movements
    ADD CONSTRAINT chk_transfer_account_presence
        CHECK ((direction = 'transfer') = (transfer_account_id IS NOT NULL)),
    ADD CONSTRAINT chk_transfer_not_self
        CHECK (transfer_account_id IS NULL OR transfer_account_id <> account_id),
    ADD CONSTRAINT chk_transfer_no_category
        CHECK ((direction <> 'transfer') OR (category_id IS NULL));

-- Destination lookups and the ON DELETE RESTRICT probe on the new FK.
CREATE INDEX idx_movements_transfer_account
    ON movements (transfer_account_id)
    WHERE transfer_account_id IS NOT NULL;

COMMIT;
```

**`0016_remove_account_type_and_card_fields.sql`** — the W1 destructive block:

```sql
BEGIN;

-- W1 destructive block (owner-authorized 2026-10-04). No CASCADE anywhere.
-- Order: objects that depend on `type` go before `type`; objects that depend
-- on `credit_limit` go before that column.
ALTER TABLE accounts DROP CONSTRAINT chk_card_limit_presence;
ALTER TABLE accounts DROP CONSTRAINT chk_card_limit_pos;
ALTER TABLE accounts DROP CONSTRAINT chk_card_days_presence;
DROP INDEX idx_accounts_user_card;
ALTER TABLE accounts
    DROP COLUMN credit_limit,
    DROP COLUMN statement_day,
    DROP COLUMN payment_due_day;
ALTER TABLE accounts DROP COLUMN type;
DROP TYPE account_type;

COMMIT;
```

Why this order is safe: `chk_card_limit_presence` and `chk_card_days_presence` reference `type`; `chk_card_limit_pos` and `idx_accounts_user_card` reference `credit_limit`/`type`; dropping any of them after its column would silently rely on implicit drops. `DROP TYPE account_type` runs last, when its only owning column is gone — no `CASCADE` is needed or allowed. `idx_tx_card_user_date` lived on the `transactions` table dropped by 0011 and MUST NOT appear in 0016. The value is referenced only by 0015: 0014 merely declares it and 0016 never mentions it.

### D1.2 Never-edit-an-applied-migration discipline

`0001`–`0013` stay byte-identical; `0008_credit_cards.sql` in particular MUST keep its three CHECKs, the partial index and the dead `idx_tx_card_user_date`, because it is the historical record of the layer 0016 removes. The existing guards MUST keep passing:

- `backend/tests/migration_0011_removal.rs` (0002 untouched, 0011 removal-only),
- `backend/tests/migration_0012_movements.rs` (additive-only 0012, no edits to previous files),
- `backend/tests/migration_0013_gate.rs` (byte-identical archived copy),
- `backend/tests/migration_0008_credit_cards.rs` **file-content** tests (the SQL still contains `chk_card_*`), whose live card-insert tests are deleted/rewritten in W1a because the columns no longer exist.

New guard `backend/tests/migration_0014_0016_transfers_account_type.rs` proves, per file: **0014** exists, contains the single statement `ALTER TYPE movement_direction ADD VALUE IF NOT EXISTS 'transfer'`, contains **no** `BEGIN;`/`COMMIT;` block and no other DDL, and its comment names the `55P04` reason; **0015** wraps its body in `BEGIN; … COMMIT;`, contains `transfer_account_id`, the `REFERENCES accounts(id) ON DELETE RESTRICT` FK, all three CHECK names (`chk_transfer_account_presence`, `chk_transfer_not_self`, `chk_transfer_no_category`) and `idx_movements_transfer_account`, and is the only file that references the value after 0014 declares it; **0016** contains the three constraint drops, `DROP INDEX idx_accounts_user_card`, the four column drops and `DROP TYPE account_type`, with every constraint/index drop before every column drop and `DROP TYPE account_type` last; all three files contain no `CASCADE`, no `CREATE TYPE`, no `CREATE TABLE`, no `BACKUP`/`DUMP` and no `transactions` reference; the numeric order 0014 → 0015 → 0016 puts the transfer objects before the destructive block; `0008` still contains `chk_card_limit_presence` (byte-identity proxy). Live post-conditions (skip without `DATABASE_URL`, dev DB only; the live section replays the three files in order to observe each step): after 0014 `movement_direction` holds exactly `expense`, `income`, `transfer`; after 0015 `movements.transfer_account_id`, its FK, the index and all three CHECKs exist, and inserting a non-transfer row with a non-null `transfer_account_id`, a transfer row with NULL/self destination, or a transfer row carrying a `category_id` is rejected by the CHECKs; after 0016 `accounts` has no `type`/`credit_limit`/`statement_day`/`payment_due_day`, `account_type` is absent, `idx_accounts_user_card` is absent and all three `chk_card_*` constraints are absent.

`migration_0012_movements.rs` currently pins the enum to exactly `["expense","income"]` in a live test; W2a rewrites that assertion to the three values **after** 0014 is applied, and keeps the additive-only file-content guards for 0012 itself untouched.

## D2 — Transfer flow

### D2.1 Endpoint contract

`POST /api/movements/transfer`, registered in `main.rs` next to `/movements/{id}` (matchit gives the static `transfer` segment priority over `{id}`; no route conflict). Handler `create_transfer_handler` in `backend/src/routes/movements.rs`.

Request (`deny_unknown_fields`, so any other field — `category_id`, `subscription_id`, `direction`, `transfer_account_id` — is 422):

```ts
{
  from_account_id: string;   // origin, becomes movements.account_id
  to_account_id: string;     // destination, becomes movements.transfer_account_id
  amount: string;            // decimal string, > 0, <= 2 decimals, < 10^6
  occurred_on: string;       // YYYY-MM-DD
  description?: string;      // <= 2000 chars
}
```

Response `201` is the standard `MovementResponse` extended with `transfer_account_id`; a transfer serializes as `direction: "transfer"`, `category_id: null`, `account_id` = origin, `transfer_account_id` = destination, `subscription_id: null`.

`GET /api/movements` and `GET /api/movements/{id}` return the new field for every row (`null` for expense/income). `POST /api/movements` keeps its exact allowlist and MUST keep rejecting `transfer_account_id` as an unknown field (only the transfer handler writes it). `PATCH /api/movements/{id}` must not accept `transfer_account_id` either.

Validation (the existing `map_movement_db_err` maps `23503`/`23514`/`22P02` → Spanish 422):

| Check | Failure | Result |
|---|---|---|
| `amount` parses via `validate_movement_amount` | non-positive / > 2 decimals / ≥ 10^6 / JSON number | 422 |
| `occurred_on` parses via `validate_occurred_on` | unparseable date | 422 |
| `description` via `validate_description` | > 2000 chars | 422 |
| both accounts owned via `ensure_owned_account` | foreign/missing account | 422 "la cuenta debe pertenecer al usuario" |
| `from_account_id != to_account_id` | self transfer | 422 "las cuentas de la transferencia deben ser distintas" |
| both accounts share `currency` | cross-currency transfer | 422 "las cuentas deben tener la misma moneda" |

The currency check is a single `SELECT currency` per account (reusing the locked rows below). Rejecting a cross-currency transfer is a deliberate refusal, consistent with the single-currency rule and the earlier currency-leak fix; the ledger never applies a silent conversion.

### D2.2 Locking and atomicity

One `tx = state.pool.begin()`; lock both accounts in **ascending UUID order** (`let mut ids = [from, to]; ids.sort();`) with a transfer-scoped `LOCK_TRANSFER_ACCOUNTS_SQL = SELECT id, currency FROM accounts WHERE id=$1 AND user_id=$2 FOR UPDATE` so the locked rows carry the currency as well (the existing `LOCK_ACCOUNT_SQL` stays for the single-account paths). Opposite-direction transfers (A→B vs B→A) serialise identically to `PATCH` (`movements.rs:367-380`) and can never deadlock. Under the locks, verify ownership again (a foreign/missing lock result is 422) and the same-currency rule. Then insert the transfer row and apply both legs:

```
INSERT_TRANSFER_SQL: INSERT INTO movements
  (user_id, account_id, transfer_account_id, direction, amount, occurred_on, description, subscription_id)
  VALUES ($1,$2,$3,'transfer',$4,$5,$6,NULL)
  RETURNING id, account_id, transfer_account_id, category_id, direction::text, amount,
            occurred_on, description, subscription_id, created_at, updated_at

APPLY_BALANCE_SQL(origin, -amount);       -- debit leg
APPLY_BALANCE_SQL(destination, +amount);  -- credit leg
```

Any failure rolls back both the row and both legs; the account row locks serialise concurrent writers.

### D2.3 Direction-aware `signed_delta`

`movements.rs:231-239` currently defaults unknown directions to `+amount`, which would silently add money for a `transfer`. W2a changes it to fail closed:

```rust
fn signed_delta(direction: &str, amount: Decimal) -> Result<Decimal, AppError> {
    match direction {
        "expense" | "transfer" => Ok(-amount),  // transfer = origin debit
        "income" => Ok(amount),
        _ => Err(AppError::Internal),
    }
}
```

Every caller (`POST`, `PATCH`) uses `?`; the transfer destination leg is written explicitly as `+amount`, never through `signed_delta` (which is origin-semantics only). `validate_direction` still accepts exactly `expense`/`income` for `POST /movements`/`PATCH`.

### D2.4 Delete and patch semantics

`DELETE_MOVEMENT_SQL` becomes `... RETURNING account_id, transfer_account_id, direction::text, amount` (4-column tuple). Inside the delete transaction: lock `account_id` and, when present, `transfer_account_id` in ascending UUID order; then

- non-transfer: `APPLY_BALANCE_SQL(account_id, -signed_delta(direction, amount)?)`;
- transfer: `APPLY_BALANCE_SQL(account_id, +amount)` (undo the origin debit) and `APPLY_BALANCE_SQL(transfer_account_id, -amount)` (undo the destination credit).

`PATCH /api/movements/{id}` on a row whose stored `direction = 'transfer'` returns 422 "las transferencias no se pueden editar; elimina y vuelve a crearla" before any balance math (checked on the pre-transaction snapshot and again on the locked row). Transfers are therefore create/delete only; this removes the entire transfer leg of the `PATCH` reversal matrix. `body.direction == "transfer"` is impossible because `validate_direction` still rejects it. **Explicit non-goal**: an edit path would need a two-leg reversal of the pre-image plus the ascending-UUID lock ordering of the post-image accounts; that reversal matrix is out of scope for this change, and the frontend MUST render no edit affordance for a transfer row.

**Account-delete guard.** `ACCOUNT_MOVEMENT_COUNT_SQL` (`accounts.rs:531-532`) currently counts only `movements WHERE account_id=$1 AND user_id=$2`; it MUST become `WHERE (account_id=$1 OR transfer_account_id=$1) AND user_id=$2` (keeping the handler's existing bind order) (and the `delete_account_handler` doc comment at `accounts.rs:549-556` updated) because `movements.transfer_account_id` is also `ON DELETE RESTRICT`: an account that is only a transfer destination is a Spanish 409 exactly like an origin account with movements. The FK backstop (`map_account_delete_err`, `23503` → 409) already catches the race, but the pre-check must match it so the normal case answers with the guard's message. `idx_movements_transfer_account` keeps the `transfer_account_id` probe indexed.

### D2.5 Row shape and the sqlx 16-column cap

`MovementRow` grows from 10 to **11** columns (`transfer_account_id: Option<Uuid>` inserted after `account_id`); all five movement SQL statements (`INSERT_MOVEMENT_SQL`, `INSERT_TRANSFER_SQL`, `UPDATE_MOVEMENT_SQL`, `LOCK_MOVEMENT_SQL`, `LIST/GET_MOVEMENT_SQL`) select exactly the 11 columns in the same order, and `MovementResponse` adds the field as `Option<Uuid>` serialized as `null`/string. No join is added to any movement query, so the tuple stays far below the sqlx 0.8 `FromRow` cap of 16. The delete tuple is 4 columns.

### D2.6 Exclusion of transfers from the ten aggregation points

Each row references `explore.md` §2. All ten are covered by construction plus an explicit test.

| # | Point | Exact change | Proving test |
|---|---|---|---|
| 1 | `toCategoryMovementTotals` (`finance.ts:326-343`) | count only `expense`/`income`; a `transfer` contributes to neither | `finance.test.ts`: transfer + expense + income in category `C` → `{expense: 100, income: 50}` |
| 2 | `toCategoryTrend` (`finance.ts:516-551`) | skip `direction === "transfer"` before the income/expense branch | `finance.test.ts`: no ingreso point is created by a transfer |
| 3 | `toTotalTrend` (`finance.ts:553-579`) | same skip; buckets stay at 0/0 for transfer-only months | `finance.test.ts`: transfer-only period → all buckets `{expense:0, income:0}` |
| 4 | `toExpenseByCategory` (`finance.ts:629-657`) | keep the expense gate and add an explicit transfer skip so the exclusion is not incidental | `finance.test.ts`: transfer with no category in range adds no slice |
| 5 | Movement rows + history filter (`finance.ts:248-260,282-301`; `MovementHistory.tsx`) | `MovementRowView.direction` becomes `"expense" \| "income" \| "transfer"`; filter select gains `<option value="transfer">`; renderer no longer ternary | `MovementHistory.test.tsx` + `movements.test.ts` |
| 6 | Dashboard snapshot (`MovementsSnapshot.tsx:49-53,82-85`) | third branch renders the transfer label/route, never «Ingreso» | `DashboardHome.widgets.test.tsx` |
| 7 | Pie/trend/category/compare sections (`ExpensePieSection`, `TotalTrendSection`, `CategoryCharts`, compare page) | they only read points 1–4; section tests add a transfer fixture and assert it disappears | section-level regression test |
| 8 | `isUserCurrencyMovement` (`finance.ts:313-321`) | unchanged: transfers obey the same single-currency rule (both legs are the same currency by D2.1) | `finance.test.ts`: USD transfer excluded |
| 9 | Backend balance effect (`movements.rs`) | two legs per D2.2; `signed_delta` fails closed | `movements.rs` live tests: create/delete round-trip restores both balances; unknown direction never adds |
| 10 | MCP surface | no movement/transfer tool is registered | `mcp-dashboard` registry assertion in W1d review + spec |

## D3 — W1: account type and credit-card layer removal

### D3.1 Backend accounts (`backend/src/routes/accounts.rs`)

- `CreateAccountRequest` becomes `{ name, currency: Option<String>, notes, color, icon }` with `deny_unknown_fields`; `PatchAccountRequest` is unchanged (`balance`, `notes`, `color`, `icon`, `is_archived`), so `type`/`credit_limit` are unknown-field 422 like any structural edit.
- `CREATE_ACCOUNT_SQL` becomes `INSERT INTO accounts (user_id, name, currency, notes, color, icon) VALUES ($1,…, $6) RETURNING <10 columns>`; `LIST_ACCOUNTS_SQL` and `GET_ACCOUNT_SQL` return the same 10 columns.
- `AccountRow` shrinks from 14 to 10 tuple elements: `(Uuid, String, String, Decimal, Option<String>, Option<String>, Option<String>, bool, DateTime<Utc>, DateTime<Utc>)` — id, name, currency, balance, notes, color, icon, is_archived, created_at, updated_at (the `type` element and the three card elements disappear).
- `AccountResponse` drops `type`, `credit_limit`, `statement_day`, `payment_due_day`, `used_balance`, `available_balance`, `usage_pct`, `alert_level`, `statement_balance`; `From<(…)>` for `AccountResponse` shrinks accordingly.
- Deleted: `ACCOUNT_TYPES`, `validate_account_type`, `validate_card_fields`, `compute_card_metrics`, and every reference in `create_account_handler`/`list`/`get`/`patch`.
- Tests deleted or rewritten: `accounts.rs:608-621` (validator tests), `:651-676` (PATCH card-field rejection becomes unknown-field rejection), `:729` fixture, `:1001-1107` card create/get; new tests assert `{"type":"bank"}` on create is 422 and that the response JSON has no `type`/card keys.

### D3.2 Net worth (`backend/src/routes/assets.rs`)

`NET_WORTH_SQL` becomes assets-only:

```sql
SELECT currency, SUM(current_value) AS assets
FROM assets WHERE user_id = $1 AND NOT is_archived
GROUP BY currency ORDER BY currency ASC
```

The row tuple shrinks; the handler emits `{currency, assets, net_worth}` per currency with `net_worth = assets` and no `debts` key. The `FULL OUTER JOIN` on `accounts` and the `WHERE type='credit_card'` predicate disappear — this removes the last live `type=` SQL outside `accounts.rs`. `frontend/lib/api/dashboard.ts` `NetWorthEntryWire` drops `debts` (verified: no live frontend consumer reads it; `ProgressScreens`/`ReportsScreens` read `net_worth` only). Inline net-worth tests (`assets.rs:1273-1369`) drop the card seeds and assert the assets-only shape.

### D3.3 Frontend wire and transforms

- `frontend/lib/api/dashboard.ts`: `AccountWire` drops `type` and `alert_level` (keeps `id`, `name`, `currency`, `balance`).
- `frontend/lib/api/finance.ts`: `createBankAccount` posts `{name}` only; its doc comment loses the type mention.
- `frontend/lib/finance/finance.ts`: `AccountCardView` keeps `id`, `name`, `currency`, `balance`; drops `type`, `isCard`, `used`, `available`, `usagePct`, `alertLevel`, `statementBalance`. `AccountWireLike` is deleted and `toAccountCards(rows: AccountWire[])` no longer coerces card metrics or branches on `type === "credit_card"`. The function name stays to protect review focus; renaming is a non-goal.
- `frontend/components/containers/FinanceScreens.tsx:127-131`: the `{account.type}` chip and its `aria-label={t("finance.accountTypeLabel")}` are removed; nothing else about the row changes (`DashboardHome.tsx:144` keeps calling `toAccountCards` for `toTotalBalance`).

### D3.4 Settings (`frontend/components/settings/BankAccountsSection.tsx`)

The filter `(accounts.data ?? []).filter((row) => row.type === "bank")` is replaced by the unfiltered non-archived list `accounts.data ?? []` (the endpoint already excludes archived rows). The create payload becomes `{name}`. The component name, route and delete flow stay. Copy: `settings.accountsTitle` value «Cuentas bancarias» → «Cuentas» and `settings.accountsHint` adjusted to «Agregá cuentas por nombre o alias; aparecen automáticamente en Finanzas.» (key names unchanged — a value-only edit so no new key is introduced and no key is deleted).

### D3.5 MCP (`mcp-dashboard/src/tools.ts`, `mcp-dashboard/README.md`)

`CreateAccountSchema` becomes `{ name: z.string().min(1).max(200), currency: z.string().optional(), notes/color/icon: optionalText }`; the type enum and the three card fields are deleted. The tool's `description` becomes `"POST /api/accounts. Creates an account by name."` and its `inputSchema.properties`/`required` list loses type/card entries (`required: ["name"]`). `list_accounts`/`get_account`/`update_account` formatting is untouched; `update_account` keeps `balance`. The README catalog updates the create-account row and notes that account types and card fields were removed by this change. No movement or transfer tool is added.

### D3.6 i18n retirements (W1)

| Key | Action | Reason |
|---|---|---|
| `finance.accountTypeLabel` ("Tipo") | deleted | its only consumer was the Finance type chip |
| `settings.accountsTitle` | value «Cuentas bancarias» → «Cuentas» | the section now manages every account |
| `settings.accountsHint` | value adjusted (no type wording) | same |

No card key family exists to retire (verified: no `alert`/`limit`/`usage` card keys in `es.ts`).

### D3.7 Supersession

This change supersedes `openspec/changes/2026-10-03-finance-ui-fixes/specs/finance-accounts/spec.md` (`Single Account Row Composition` / `Account Balance Inline Edit`) in exactly one clause: the requirement that the surviving row keep the account type. Single-row composition, no duplicate card block and the inline balance edit remain binding. The canonical `finance-accounts` currently still says "on the account card" because that delta was never synced; this change does not reopen that wording.

## D4 — W3: login and session hardening

### D4.1 A1 — `X-Forwarded-For` key derivation (`login.rs::rate_limit_key`)

New algorithm: resolve the peer; if the peer is untrusted or absent, return the peer (or `LOCAL_PEER_FALLBACK` when `ConnectInfo` is absent). If the peer is trusted, split `X-Forwarded-For` on `,`, walk the elements **right to left**, trim each and take the right-most element that parses as an `IpAddr` **after skipping elements that are in the trusted set**:

1. right-most parseable element not in the trusted set → key;
2. if every parseable element is trusted, or the header is absent/empty → peer;
3. if the right-most comma-separated element is unparseable → peer (never fall through to an older, client-controlled element).

`X-Real-Ip` stays ignored. This supersedes the canonical scenario "the first XFF element is used as the key"; `login.rs` tests `:233-243` (first element), `:244-260` and `:351-388` are rewritten to pin the right-most rule, the spoofed-left-element case and the malformed-right-most fallback.

### D4.2 A2 — limiter key model (`auth/rate_limit.rs`)

The limiter keeps a single `Mutex` but two bounded maps and failure-only recording:

```text
by_ip:      HashMap<IpAddr, Vec<Instant>>   // 10 failures / 15 min
by_account: HashMap<String, Vec<Instant>>   // 5 failures / 15 min, key = trim().to_lowercase()
```

API:

- `check_login(ip: IpAddr, account: &str) -> Option<Duration>` — O(1) before any DB/Argon2 work; returns the larger remaining window when either bucket is full (429 + `Retry-After`).
- `record_failure(ip, account)` — pushes `Instant::now()` into both buckets (called only after `verify_password` returned false or the row was missing/inactive).
- `record_success(account)` — clears the account bucket for that email; the IP bucket is never consumed by a success and is not cleared.
- Both maps prune empty windows, cap at `MAX_KEYS` (4096) each with the existing least-recently-relevant eviction, and recover a poisoned mutex; a currently blocked key MUST survive eviction (the existing property is preserved per map).
- The login handler calls `check_login` before the DB lookup and records only on the failure path. Concurrency overshoot (several failures racing to the limit) is accepted and documented; the pre-Argon2 gate still bounds CPU work.
- The limiter gates `POST /api/login` only: a request presenting a valid session or API token is never throttled by it, and no other route consults the buckets. The 429 is generic and carries `Retry-After`.
- Residual self-lockout tradeoff: because the account bucket is keyed by email, an attacker who knows an owner's email can delay that account's next successful login for at most `WINDOW` (15 min). The delay is accepted and measured: it is bounded by the window, and a test asserts the lockout expires no later than `WINDOW` after the last recorded failure.
- `MAX_REQUESTS` (10/15 min) stays the IP budget; `MAX_ACCOUNT_FAILURES = 5` and `WINDOW` stay module constants. Existing tests asserting that every `check()` call consumed quota are rewritten.

### D4.3 A3 — constant-time login path (`login.rs`)

The decision is factored into a small helper so it is testable:

```rust
const DUMMY_PASSWORD_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$<fixed salt>$<fixed hash>";
fn verify_credentials(password: &str, row: Option<(&str /*hash*/, bool /*is_active*/)>) -> bool
```

`verify_credentials` ALWAYS calls `verify_password(password, hash)` — the stored hash, or `DUMMY_PASSWORD_HASH` when the row is `None` — and only then returns false for `None` or `is_active == false`. The handler keeps the single generic `AppError::Auth` and never logs. `password.rs` gains the constant and documents that the dummy hash uses the same Argon2id parameters as real hashes (`m=19456, t=2, p=1`). A `#[cfg(test)]` verification counter in `password.rs` proves exactly one Argon2 verify for unknown-email, inactive and wrong-password paths, and zero for the missing/oversized-input 422 path. The rate limiter stays in front of Argon2 so the dummy verify does not widen the CPU-DoS surface beyond the limiter's quota.

### D4.4 A4 — `is_active` enforcement

All token resolution paths add the active-user guard:

- `middleware.rs::SESSION_LOOKUP_SQL`: `SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`.
- `middleware.rs::API_TOKEN_LOOKUP_SQL`: same join and predicate.
- `helper.rs::require_session_user_id`: same join added to its inline SQL.
- `me.rs`: the existing `JOIN users u` gains `AND u.is_active`.
- `logout.rs`: the revoking `UPDATE sessions` gains `AND user_id IN (SELECT id FROM users WHERE is_active)` (or an `EXISTS` predicate) so a deactivated user's logout is 401, consistent with every other authed request.

Deactivation therefore revokes nothing and rewrites nothing: existing sessions and API tokens simply stop resolving on the next request. Tests: a deactivated user's live session and live API token both return 401 on `GET /api/me` and on a domain route.

### D4.5 A5 — session management

**Backend**: new `backend/src/routes/sessions.rs`, registered in `routes/mod.rs` and mounted in `main.rs` as `.route("/sessions", get(list_sessions_handler).delete(delete_sessions_handler))` next to `/tokens`. Both handlers use `require_session_user_id` (API tokens get 401, matching the "sessions mint credentials, tokens don't" precedent).

- `GET /api/sessions` → `200 [SessionResponse]`, caller's rows only, ordered `created_at DESC`:

  ```ts
  { id, created_at, expires_at, revoked_at, user_agent, ip_address, current: boolean }
  ```

  `current` is computed in SQL as `(s.token_hash = $2)` using the presenting token's hash; `token_hash` is never selected into the response row and never serialized. `never expose token_hash` is asserted by a response-body test.
- `DELETE /api/sessions` → `204`, idempotent. SQL: `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL AND expires_at > now()`. The presenting session is never revoked; a second call affects 0 rows and still returns 204.

**Frontend**: `frontend/lib/api/sessions.ts` (`SessionInfo`, `listSessions()`, `revokeOtherSessions()`) mirroring `lib/api/tokens.ts`; `frontend/components/settings/SessionsSection.tsx` (list with «Actual» badge, expiry date formatted `es-CO`, one «Cerrar otras sesiones» button with confirmation, Spanish loading/error/empty states, 44×44 controls) mounted in `frontend/app/dashboard/ajustes/page.tsx` after `BankAccountsSection`. No new nav entry and no new route. i18n keys: `settings.sessionsTitle`, `sessionsHint`, `sessionsCurrent`, `sessionsExpires`, `sessionsRevokeOthers`, `sessionsRevokeConfirm`, `sessionsRevokedOthers`, `sessionsEmpty`, `sessionsLoadFailed`, `sessionsIp` (all typed).

### D4.6 A7 — `Cache-Control: no-store` placement

`login_handler` and `tokens::create_token_handler` return their JSON with an explicit header tuple, e.g. `([(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))], Json(body))`. This is deliberately **not** a global `SetResponseHeaderLayer` on the outer router (`main.rs:271-286`), which would also stamp every static asset, the SPA fallback and every read endpoint; the no-store rule applies only to the two one-shot-secret responses. A test asserts the header is present on `POST /api/login` and `POST /api/tokens` and absent on e.g. `GET /api/movements`.

## D5 — W4: productivity calendar

### D5.1 Helpers (`frontend/lib/productivity/calendar.ts`, new)

Pure, dependency-free and unit-testable:

- `monthGridCells(monthKey: string): CalendarDayCell[]` — 42 cells (6 weeks, Monday-first) grown from the same `(getUTCDay()+6)%7` offset and UTC-midnight arithmetic as `logsToCalendarCells` (`lib/productivity/habitStats.ts:77-100`); each cell is `{ date: "YYYY-MM-DD", inMonth: boolean, isToday: boolean }`.
- `monthGridRange(monthKey: string): { from: string; to: string }` — the first and last of the 42 cells, so the fetch covers the visible grid, not only the calendar month.
- `shiftMonth(monthKey: string, delta: number): string`.
- `dayEntries(tasks, events, date): { tasks: TaskWire[]; events: EventWire[] }` — tasks by `due_date === date` (reusing `todayYmdLocal`/`toISODate` semantics); events whose `[starts_at, ends_at ?? starts_at]` overlaps that local day.

`formatMonth` (`lib/i18n/index.ts:45-57`) titles the grid; `todayYmdLocal` classifies today.

### D5.2 Component (`frontend/components/productivity/ProductivityCalendar.tsx`, new)

- Reuses `DashboardDisclosure` unchanged (h2 + `button[aria-expanded][aria-controls]`, 44×44, persistent hidden panel target, children only while open) with its own `open` state, default `false`, and `panelId="productivity-calendar-panel"`.
- Header controls: «‹» / «›» month buttons and «Hoy», each 44×44, keyboard reachable, disabled/aria-hidden labels in Spanish; the title is `formatMonth(monthKey)`.
- Grid: `role="grid"` with 7 column headers (Lun…Dom) and 42 `role="gridcell"` buttons, `min-h-[44px] min-w-[44px]`; in-month cells use the normal text token, adjacent-month cells `text-instrument/40`; today gets a visible ring.
- Task vs event distinction without colour alone: a task marker is a square glyph plus a count (`<count>` «tareas»), an event marker is a round dot plus a count; both appear in the cell's `aria-label` (e.g. «15 de octubre: 2 tareas, 1 evento»). Colour comes from existing tokens (`signal` for events, `flow` for tasks); no hardcoded hex.
- Day-detail expansion: activating a cell sets `selectedDate`; a panel below the grid lists that day's tasks (title + state label) and events (title + `kind`/time), in Spanish, with an `EmptyState` when the day is empty; activating the same cell again collapses; only one day is expanded at a time; the panel is a focusable region and Esc collapses it.
- Data: `useTasks()` and the widened `useEvents(grid.from, grid.to)` inside the panel content; loading uses `role="status"`, errors use `role="alert"` + retry mutating both keys; an empty month shows the grid with zero counts, never a bare skeleton.
- No animation beyond a CSS transition, suppressed under `prefers-reduced-motion`.

### D5.3 Mount (`frontend/components/containers/ProductivityScreens.tsx`)

The calendar is rendered **first**, as a `col-span-12` block above Metas, inside the existing `grid-cols-12` (`:316-321`). It is a `DashboardDisclosure` inside a full-width wrapper, so the disclosure semantics are the shared ones (no new `SectionShell` variant and no second disclosure implementation). The four existing sections keep their exact order, spans and forms; the error banner and loading skeleton (`ProductivityScreens` loading state) gain one full-width calendar placeholder above the four section placeholders so resolving produces no layout shift.

### D5.4 Events fetch widening (`frontend/lib/api/productivity.ts`)

`useEvents(from: string | null, to: string | null)` (the productivity hook only; the Dashboard hook in `lib/api/dashboard.ts` already takes two bounds and keeps its signature). Key `productivity/events?from=…&to=…` via a two-bound `eventsKey(from, to)`; the URL sends both bounds when present. The component converts the local `YYYY-MM-DD` grid range with `toEventRange` (`lib/finance/finance.ts:239-241`) to RFC 3339 because `GET /events` rejects bare dates (422) and filters by overlap (`events.rs:23-27`). `ProductivityScreens.tsx:110` currently pins `eventsFrom` once to `new Date().toISOString()`; the calendar passes `useEvents(gridFrom, gridTo)` with both RFC 3339 bounds, while the Eventos section keeps its existing one-sided read through the widened signature as `useEvents(eventsFrom, null)`. No bare date ever reaches the backend.

### D5.5 `productivity-layout` delta

The canonical requirement "Productivity Desktop Grid Balance" says four sections in a 12-column grid; this change ADDS a full-width calendar block above them and the delta states the five-block inventory while preserving the four sections' arithmetic and order. The canonical scope line "Out: … new components" is superseded by exactly one new block component. Loading-skeleton fidelity includes the calendar placeholder.

## D6 — W5: exact row copy

`MovementRowView` (finance.ts:282-301) gains `transferAccountName: string | null` resolved from the same account map (`m.transfer_account_id`), and `direction` widens to three values. `MovementHistory.tsx:217-225` and `MovementsSnapshot.tsx:82-85` render:

| Row | Rendered metadata line (exact copy) | Key(s) |
|---|---|---|
| Expense | `Método de pago: Cuenta principal` | reuses `finance.paymentMethod` ("Método de pago") |
| Income | `Cuenta: Cuenta principal` | new `finance.movementAccountLabel: "Cuenta"` |
| Transfer | `Transferencia: Ahorros → Nequi` | new `finance.movementTransferRoute: "Transferencia: {from} → {to}"` |

The direction label used by filters, the dashboard snapshot and accessibility text is `finance.movementDirectionTransfer: "Transferencia"`. The expense/income modal keeps its two-option direction select (`finance.movementPaymentLabel` stays «Tipo de movimiento»); the transfer modal replaces it with fixed origin/destination selects (`finance.transferFrom: "Cuenta origen"`, `finance.transferTo: "Cuenta destino"`) and title `finance.transferModalTitle: "Transferir entre cuentas"`, entry button `finance.addTransfer: "Transferir"`, success `finance.transferSaved: "Transferencia registrada."`, validation `finance.transferSameAccountError: "Elige dos cuentas distintas."` and `finance.transferCurrencyError: "Ambas cuentas deben usar la misma moneda."`. `finance.paymentTransfer` survives untouched and continues to name the subscription payment method only.

New keys added by this change (all typed, consumed in the unit that adds them): `finance.addTransfer`, `finance.transferModalTitle`, `finance.transferFrom`, `finance.transferTo`, `finance.transferSaved`, `finance.transferSameAccountError`, `finance.transferCurrencyError`, `finance.movementDirectionTransfer`, `finance.movementTransferRoute`, `finance.movementAccountLabel`, `productivity.calendar*`, `settings.sessions*`. Retired: `finance.accountTypeLabel`.

## Testing strategy

**Suites and exact commands** (from `explore.md` §6):

| Suite | Command (from the stated working dir) | Proves |
|---|---|---|
| Backend unit + DB-gated integration | `cd backend && cargo test --locked` | movement transaction math, transfer legs, validators, limiter, login paths, sessions, migration guards |
| Apply migrations for backend tests | `for m in backend/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$m"; done` (repo root) | 0014–0016 shapes against a live DB before the DB-gated tests (per-file autocommit; 0014 must not be folded into one transaction) |
| Frontend unit/component | `cd frontend && pnpm test` | transforms, renderers, sections, i18n coverage |
| Frontend build (type gate incl. i18n keys) | `cd frontend && pnpm run build` | unknown `t(key)` fails, static export intact |
| E2E discovery | `cd frontend && pnpm exec playwright test --list` | specs compile; no live server needed |
| E2E live smoke | `E2E_SMOKE_LIVE=1 E2E_USER=… E2E_PASSWORD=… pnpm test:e2e` | live flows (selective; see DB rules) |
| MCP | `cd mcp-dashboard && npm run typecheck && npm run build` | create-account schema compiles and boots |

**RED-before-GREEN expectation per slice.** W1: a test that `POST /accounts` with `type` is 422 and that `toAccountCards` output has no card fields fails first, then turns green; the migration guard test fails before the three files exist. W2: the `signed_delta("transfer", …)` unit test, the two-leg balance round-trip and each of the ten exclusion tests fail before the implementation (unknown direction currently returns `+amount`). W3: the right-most-XFF test fails against the current first-element code; the failure-only limiter test fails while successes consume quota; the one-Argon2-verify test fails on the current early return; the deactivated-session 401 test fails while the join is absent; the `GET/DELETE /api/sessions` tests fail while the route is missing; the `no-store` assertion fails while no header is set. W4: `monthGridCells`/`monthGridRange`/`useEvents(from,to)` tests fail before the helpers exist and before the hook accepts `to`. W5: the row-copy assertions fail while the metadata line is `{date} · {account}`. Each unit records the observed RED output and the focused GREEN run in its task line; broad suites run only in W6.

**Production-DB rules for live checks.** Production is the sanctioned verification DB for API-level smoke (owner rule, 2026-10-03) but with these hard rules: (1) every live write runs through a throwaway user created with the backend's `--create-user` and deleted at the end of the session (every row cascades from `users(id)`); (2) the destructive 0016 sanity checks and any new migration live test run against the dev DB only — never production, mirroring the `migration_0011_removal.rs:47-50` / `migration_0013_gate.rs` warnings; (3) applying 0014–0016 to production is a separate owner-authorized operation, one file at a time (0014 outside a transaction, 0015 after 0014 commits), permitted only because the destructive 0016 block removes the unused card layer (0 cards) and because resolution 3 authorizes it; (4) no test seeds data outside the throwaway user and no cleanup relies on table-level deletes.

## Risks

| Risk | Mitigation |
|---|---|
| Spec contradictions resolved only in this change (W1 vs `credit-card-summary`/`finance-accounts`/`finance-assets`/`2026-10-03-finance-ui-fixes`; W2 vs `finance-movements`/`finance-core-invariants`/`objetivo.md`; A1 vs `session-auth`) | the ten deltas supersede explicitly, `objetivo.md` carries both dated notes, and A1's contradictory scenario + two tests change in the same unit |
| 0014–0016 split: 0014 must stay outside a transaction (`55P04`) and 0015 must run only after 0014 commits; the destructive block must stay ordered | 0014 contains only `ALTER TYPE … ADD VALUE IF NOT EXISTS` with the reason in a comment and no `BEGIN;`/`COMMIT;`; 0015 wraps the column/CHECKs/index in its own transaction and is the only file referencing the value after 0014 declares it; 0016 is asserted ordered and no-CASCADE; the guard pins the split and the files apply one at a time |
| `NOT NULL` `type` drop with 5 live rows and every account insert/select | `accounts.rs` is rewritten in the same unit (W1a) that ships 0016; the movement account selector only used `id`/`name` and is safe; MCP follows in W1d before the slice is accepted |
| W2 atomicity with two accounts | ascending-UUID lock order shared with `PATCH`; both legs and the row in one transaction; delete locks both before reversing |
| Aggregation silent regressions (three frontend transforms default non-expense to income; `signed_delta` defaults unknown to `+`) | the ten-point matrix is implemented and each point has a named proving test; `signed_delta` fails closed |
| W3 sequencing: A1 contradicts a canonical scenario and two green tests; A2 changes the limiter key type and its bounded-key tests; A3 adds ~19 MiB per failed login; A4 touches every authed request | one unit per finding, tests rewritten in the same unit, dummy verify behind the limiter, `is_active` join covered by a deactivation test |
| W3 A5 must not revoke the caller's session nor expose `token_hash` | `token_hash <> $2` predicate and an SQL-computed `current` flag; response-body test asserts the hash is absent |
| A7 must not blanket every response | header set on the two handlers only; test asserts presence there and absence on a read route |
| W4 range semantics: backend rejects bare dates and filters by overlap; a past month has no events today | grid range converted with `toEventRange`, both bounds sent, past-month fixture test |
| i18n hygiene: `frontend-i18n` forbids restoring the deleted transfer key family while `finance.paymentTransfer` must survive | every new key uses a new name; `paymentTransfer` untouched; `tsc`/`next build` fails on unknown keys |
| MCP drift (separate package, no tests) | W1d updates schema, description and README in one unit and W6 runs `typecheck` + `build`; no movement/transfer tool |
| DB safety (production is the sanctioned verification DB; 0016 is destructive) | throwaway-user rule, cascade cleanup, dev-DB-only destructive tests, owner-authorized per-file apply |
| Review workload | W1–W4 exceed 400 lines as whole slices and are split into the units in the Task table; no unit is expected to exceed ~500 changed lines |

## Decisions closed by the orchestrator

1. **`frontend-dashboard` delta.** Added as the tenth delta (`specs/frontend-dashboard/spec.md`): the card-alert clause and the "Card alert mapping preserved" scenario are retired, and no card alert surface replaces them (W1 removes the producer).
2. **Migration split.** The single 0014 is replaced by three files: 0014 (enum value, no explicit transaction, comment states the `55P04` reason), 0015 (column + three CHECKs + index; safe only because 0014 committed earlier), 0016 (W1 destructive block; `0008` stays byte-identical).
3. **Transfer `PATCH` semantics.** Create/delete only: `PATCH` on a transfer row is 422 and the frontend renders no edit affordance, because a two-leg reversal plus lock ordering is out of scope for this change.
4. **Cross-currency transfers.** Same-currency only; a different-currency transfer is rejected with 422 as a deliberate refusal, consistent with the single-currency rule and the earlier currency-leak fix, never a silent conversion.
5. **Per-account failure threshold.** 5 failures / 15 min per normalized email (10 / 15 min per IP); success clears the account bucket; only failures count; a 429 is generic with `Retry-After`; an authenticated session is never throttled; the bounded self-lockout delay is accepted and measured.
6. **Live verification.** One observable check per workstream plus the console-error check, enumerated as (a)–(e) in W6.3.

## Deviations from this design, as built

Verified against the working tree and the recorded W1–W5 runs; each item supersedes the named part of this design.

- **Migrations landed as 0014/0015/0016 and were applied to production.** 0014 (`ALTER TYPE … ADD VALUE`, outside any transaction to avoid Postgres `55P04`), 0015 (nullable `transfer_account_id` + the three CHECKs + the destination index), 0016 (the ordered destructive block, every drop `IF EXISTS`-tolerant, executed against production where the `0008` card CHECKs and `idx_accounts_user_card` never existed). Production schema after 0016: `accounts` has 12 columns, `account_type` is absent, and the 5 real account rows kept their ids, names and balances. (D1.1/D1.2)
- **W4 calendar helpers live in `frontend/lib/productivity/productivity.ts`**, not in the `calendar.ts` module named by D5.1; `ProductivityCalendar.tsx` and its tests consume them from there.
- **The sessions UI shipped as its own page** (`frontend/app/dashboard/ajustes/sesiones/`) with a settings-nav entry, following the tokens-page precedent, instead of the inline Settings section named by D4.5.
- **The transfer entry control is the per-account row button labelled «Mover dinero»** (the owner's literal wording, which supersedes the draft key value `"Transferir"`); there is no panel-level transfer button. (D6 / W2.6)
- **The rate limiter as built**: failure-only, 10 failures/15 min per IP and 5 failures/15 min per normalized account, the account bucket cleared on success, a read-only `check_login` that reports the true remaining window, generic 429 with `Retry-After`, authenticated sessions never throttled, both maps bounded with the existing eviction discipline. (D4.2)
- **A4 was completed with one extra predicate in `backend/src/routes/me.rs`** (the `me` lookup now requires `u.is_active`, matching the middleware and helper), covered by two new tests. (D4.4)
- **Disclosed incident**: the first production application of 0016 happened inside the migration-guard test's replay branch rather than in the planned manual step (D1.2 / Testing strategy), which left two throwaway users and one probe account mid-run; they were deleted and the final state was verified, and the guard now serializes its live section.

## Open items

None. Every item open in the previous revision is resolved above, and each resolution is reflected in this artifact set.
