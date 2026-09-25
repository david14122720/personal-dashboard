# Design: Finance Simplify + Movements (finance-simplify-movements)

- change: `finance-simplify-movements`
- phase: design
- date: 2026-09-24
- store: hybrid (this file is authoritative; mirrored to Engram `sdd/finance-simplify-movements/design`, project `personal-dashboard`)
- inputs: `proposal.md`, `explore.md` §2 (verified file/line facts), 14 spec files under `specs/`, binding owner decisions D1–D4
- codebase read for this design: `backend/src/main.rs`, `backend/src/error.rs`, `backend/src/db.rs`, `backend/src/state.rs`, `backend/src/routes/{accounts,subscriptions,assets,events,mod}.rs`, `backend/src/finance/{validation,money}.rs`, `backend/migrations/{0001,0003,0004,0011}`, `backend/tests/migration_0011_removal.rs`, `.github/workflows/ci.yml`, `docker-compose.yml`, `frontend/lib/api/{finance,dashboard,money,client}.ts`, `frontend/lib/finance/finance.ts`, `frontend/lib/dashboard/transforms.ts`, `frontend/lib/settings/customCategories.ts`, `frontend/lib/i18n/{es,index}.ts`, `frontend/components/containers/{FinanceScreens,DashboardHome}.tsx`, `frontend/components/finance/{FinanceSections,CategoryCharts,SubscriptionForms}.tsx`, `frontend/components/settings/*.tsx`, `frontend/components/dashboard/widgets/*.tsx`, `frontend/components/notifications/useNotifications.ts`, `frontend/e2e/*.spec.ts`, `frontend/package.json`, `mcp-dashboard/src/tools.ts`, `openspec/changes/2026-09-23-simplify-finance-productivity/*`.

## Technical Approach

One new backend primitive, one new migration, and a removal chain:

1. **Movements are backend-owned** (`movements` table, migration **0012** additive, REST CRUD) and the account balance effect is applied by an **application-level `sqlx` transaction inside the request handler** — never a trigger (D4). Every movement write is a single HTTP request; the frontend never orchestrates two writes. Existing validators are reused (`finance/money.rs`, `finance/validation.rs`, date parsing), with the kind gates removed (D3). Money stays a decimal **string** on the wire; foreign ids are 404 only when they are the addressed resource, referenced-body ids are 422 (matches every surviving finance route).
2. **Subscription pay is a dedicated endpoint** (`POST /api/subscriptions/{id}/pay`): one transaction inserts the movement, debits the account, stamps `last_paid_on` and advances `next_billing_on`. Paid-this-cycle is derived lazily (`last_paid_on IS NOT NULL AND next_billing_on > today`) — no cron, no worker. The fixed `Suscripciones` category is an idempotent upsert on `(user_id, 'finance', 'Suscripciones')` inside the same transaction.
3. **Frontend** keeps the single Finance grid: Accounts (click filters history), Subscriptions (amount + Pay), Assets/net worth, Add expense/income, Movements history, Category chart. Category UI loses `kind` everywhere; charts/compare/totals aggregate `GET /movements` client-side by `(category_id, direction)` with a single-currency guard. Resumen renders 4 KPIs (D1) plus «Últimos movimientos» (5) and «Próximas suscripciones» (5). Subscription create/edit moves to Settings; custom categories move to a kind-free localStorage v2 schema.
4. **Removal** happens in two stages: reversible slices delete UI/hooks/transforms first (no build ever reads a removed route), then the **gated** migration **0013** drops the four tables and both trigger functions. 0013 lives in the change folder — **not** in `backend/migrations/` — until the owner authorizes it, because CI and the compose initdb mount apply every `backend/migrations/*.sql` automatically (see §Migration/Rollout).

No new dependencies in any layer (verified against `backend/Cargo.toml` and `frontend/package.json`); the few places where a library would be the obvious reflex (timezone, month math, toast, modal, charts) are solved with the existing stack (fixed UTC-05:00 offset, pure `chrono` arithmetic, native dialog pattern, div bars).

## Architecture Decisions

### Decision: App-level transaction with a deterministic lock order (not a trigger)

**Choice**: Every movement write runs inside one `sqlx::Transaction` on the request's pool. The account row is **locked first** (`SELECT id FROM accounts WHERE id = $1 AND user_id = $2 FOR UPDATE`), then the balance is updated, then/with the movement row written; commit at the end. When a PATCH touches two accounts, both are locked in **ascending UUID order**.

**Alternatives considered**: (a) DB trigger writing `balance` (the 0002 pattern the parent change deliberately killed — rejected by D4 and by `finance-core-invariants` "Movement Balance Write Discipline"); (b) insert-first-then-update (FK check takes only `FOR KEY SHARE`, then the `UPDATE` upgrades to `FOR UPDATE` — classic upgrade deadlock between two concurrent movements on the same account); (c) client orchestration of `POST /movements` + `PATCH /balance` (no atomicity, R2).

**Rationale**: lock-first is the only order that serializes concurrent same-account writers without deadlocks and gives deterministic ownership semantics (the `FOR UPDATE` select returns `None` → 422 for a referenced account). Ascending-UUID locking makes two-account PATCHes (`A→B` vs `B→A`) deadlock-free. The DB still enforces the invariant that no trigger writes `balance` (0011-era test `post_0011_accounts_balance_present_with_only_updated_at_trigger` keeps passing; 0012 adds no trigger).

### Decision: Status-code matrix — 404 for the addressed id, 422 for referenced body ids

**Choice**:

| Situation | Status |
|---|---|
| No/invalid token | 401 |
| `/movements/{id}` missing or foreign (GET/PATCH/DELETE) | 404 |
| `POST`/`PATCH` body references a foreign or missing `account_id` / `category_id` | 422 |
| Unknown field, missing required field, malformed amount/date/direction | 422 (axum `Json` rejection or validator) |
| Account deleted between validation and transaction | 422 (rollback, nothing persisted) |
| `DELETE /accounts/{id}` with movements | 409 (`finance.accountDeleteBlocked`) |
| `POST /subscriptions/{id}/pay` references a foreign/missing subscription or account | 404 |
| Pay on inactive subscription, or price `0.00`, or `account_id` missing | 422 |
| Pay on a subscription already paid this cycle | 409 (`finance.subscriptionPaidThisCycle`) |

**Alternatives considered**: making referenced foreign accounts 404 (as `finance-movements`' contract bullet loosely reads) or making foreign movements 422. Rejected: 422-for-referenced-ids is the established convention in every surviving finance route (`ensure_finance_category`, `ensure_subscription_category`, `validate_link_ids` in `events.rs`) and it is what the spec's explicit 422 enumeration says; 404 stays for the URL-addressed resource so foreign ids never leak existence.

**Rationale**: one consistent rule instead of per-endpoint improvisation; keeps the existing test idiom (`assert_422`, `assert_404`) and the "never 403" rule intact.

### Decision: One shared ownership validator; kind gates deleted

**Choice**: `backend/src/finance/validation.rs` keeps date parsing (`validate_occurred_on`) and gains `ensure_owned_category(pool, category_id, user_id)` (ownership only) and `ensure_owned_account(pool, account_id, user_id)` (existence + ownership; the locking variant is inline in the movement transaction). `ensure_finance_category`'s kind check and `subscriptions.rs::ensure_subscription_category` are removed; subscriptions and movements both call `ensure_owned_category`. `#[allow(dead_code)]` on `validate_occurred_on` is removed (first live consumer).

**Alternatives considered**: keeping two kind-gated helpers and have movements call the finance one (recreates the d22a220 422 surprise, R3); migrating rows to a single kind (rejected by parent change §2.3 and by D3).

**Rationale**: `finance-core-invariants` "Shared Finance Validation Helper Ownership" requires a surviving home and ownership-only behaviour; the helper is defined outside any removed module and imported by every surviving consumer.

### Decision: Dedicated `POST /subscriptions/{id}/pay`; PATCH widened to exactly `name|price|next_billing_on|is_active`

**Choice**: Pay is its own endpoint with body exactly `{account_id}` (`deny_unknown_fields`), returning `200` with the full updated subscription (now including `last_paid_on`). `PATCH /subscriptions/{id}` accepts exactly those four fields via `COALESCE` (omitted fields keep their value); `cancelled_at` stays server-owned (`CASE` on the `is_active` bind: `NULL` → keep, `true` → clear, `false` → `COALESCE(cancelled_at, now())`). `next_billing_on` is required on create; `frequency` becomes `Option<String>` accepting only absent or `"monthly"` (anything else 422); the column/enum stay in the DB untouched.

**Alternatives considered**: a widened PATCH that also pays (mixes a money-moving transaction into a metadata endpoint; impossible to express "which account" without widening further); client PATCH+POST (R2).

**Rationale**: the pay action is a distinct capability with its own guards (404/422/409) and its own audit row; keeping it separate keeps PATCH purely declarative. `COALESCE` keeps the patch a single atomic statement (no read-modify-write race) and matches the existing `patch_account_handler`/`patch_asset_handler` QueryBuilder style.

### Decision: Cycle math — threshold is `max(pay_date, stored_due)`, day-of-month anchor preserved

**Choice**: `advance_next_billing(stored, pay_date)`:
- `stored = NULL` → `pay_date + 1 calendar month` (clamped).
- otherwise: anchor day = `stored.day()`; step `k = 1, 2, …`; `candidate_k = clamp_to_month(stored.year, stored.month + k, anchor_day)`; return the first `candidate_k > max(pay_date, stored)`. (Bounded loop, 1200 iterations, fallback `pay_date + 1 month`.)
- `add_months_clamped(date, k)`: month index arithmetic + `day = min(date.day(), last_day(target month))` — so `2026-01-31` → `2026-02-28/29` → `2026-03-31` (**no drift**: the anchor day survives the February clamp).

**Alternatives considered**: "first occurrence strictly after the pay date" (the spec's prose) — **it fails the binding scenario "Early payment counts for the cycle"**: due `2026-09-15`, paid `2026-09-10` would set `next_billing_on = 2026-09-15`, and on `2026-09-24` the derived flag `next_billing_on > today` would be false, contradicting "reads paid this cycle and a second pay is blocked". Stepping from the *clamped* value (28 Feb → 28 Mar drift) is also rejected.

**Rationale**: `max(pay_date, stored)` satisfies **every** scenario in `finance-subscriptions` "Subscription Cycle State": due-date-arrival (`10-15` → `11-15`), early payment (`09-10` on due `09-15` → `10-15`), month-end clamp (`01-31` → `02-28`), long-dormant (`04-15`, today `09-24` → `10-15`), null due (pay + 1 month). The spec prose should be corrected to this rule at archive; the scenarios are the binding acceptance criteria.

### Decision: America/Bogota "today" without a new dependency

**Choice**: `finance/dates.rs::today_bogota()` = `Utc::now() - 5h`, then `.date_naive()`. Colombia has had no DST since 1993, so a fixed UTC-05:00 offset is exact. The frontend mirrors it with `Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" })` (built-in). No `chrono-tz`, no `date-fns-tz`, no `user_preferences.timezone` read (kept as future work; the spec fixes the zone to America/Bogota).

**Alternatives considered**: `chrono-tz` (new Rust dependency → violates the no-new-deps rule → flag-and-stop, so rejected), reading `user_preferences.timezone` per request (an extra query and a semantic the spec does not ask for), using `Utc::now().date_naive()` (wrong for Bogota between 19:00 and 24:00 local, would flip "paid this cycle" a day early).

**Rationale**: zero dependencies, exact for the spec'd zone, unit-testable as a pure function with an injected `now`.

### Decision: Fixed category seed via `ON CONFLICT … DO UPDATE` returning id

**Choice**: inside the pay transaction, and only there:

```sql
INSERT INTO categories (user_id, kind, name)
VALUES ($1, 'finance'::category_kind, 'Suscripciones')
ON CONFLICT (user_id, kind, name) DO UPDATE SET name = EXCLUDED.name
RETURNING id
```

The `DO UPDATE` no-op is the only way to get the existing id back in one statement. The conflict target is the exact `(user_id, kind, name)` key, so a user-owned `subscription`-kind `Suscripciones` row is untouched (no rename, no suffix, no delete). The movement references the returned id directly (never a name lookup at pay time).

**Alternatives considered**: `DO NOTHING` + re-`SELECT` (two statements and a race window); name convention without a seeded row (breaks FK honesty — spec requires the seeded row); server-side "seed on boot" migration (no data migration is allowed for user rows; and 0012 is additive DDL only).

**Rationale**: atomic, idempotent, transaction-local, and safe against the `UNIQUE(user_id, kind, name)` constraint.

### Decision: 0013 is stored **outside** `backend/migrations/` while gated

**Choice**: the migration is authored at `openspec/changes/finance-simplify-movements/migrations/0013_remove_savings_debts.sql`. It is copied into `backend/migrations/0013_remove_savings_debts.sql` **only at the authorized gate step**, then applied out-of-band (autocommit psql, 0011 convention). A RED guard test asserts the file is in the change folder and **not** in `backend/migrations/` pre-gate.

**Alternatives considered**: putting it in `backend/migrations/` immediately (the spec's literal path) — **it would be auto-applied by CI** (`.github/workflows/ci.yml` loops `for migration in migrations/*.sql; do psql -f …;` with `ON_ERROR_STOP=1`) **and by every fresh local compose database** (`./backend/migrations:/docker-entrypoint-initdb.d:ro`), silently destroying rows before any owner authorization. A `.sql.disabled` suffix inside `backend/migrations/` (still matches nothing in the CI glob? — it does not match `*.sql`, but it clutters the applied-migrations folder and is easy to rename by accident; also the compose initdb only picks `*.sql`). A `gated/` subfolder under `backend/migrations/` (compose mounts the directory recursively? no — initdb reads the top level only, but CI's `migrations/*.sql` also ignores subfolders; still, an operator copy step is needed either way and the change folder is the honest home for an unauthorized artifact).

**Rationale**: the gate must be structural, not procedural. The change folder keeps the artifact next to the spec that governs it; the copy step is the gate.

### Decision: Kind-free UI with a versioned localStorage envelope; custom categories stay out of API picks

**Choice**: `customCategories.ts` keeps the key `pd-custom-categories` but stores `{ v: 2, categories: [{id, name}] }`. The reader accepts the legacy array shape (`{id, name, kind}`) and migrates in place (id/name preserved, `kind` dropped, write-back of the v2 envelope). `CustomCategoriesSection` loses its kind select and kind badge. All Finance selects/charts use a **single unfiltered** `GET /categories` set; customs remain excluded from movement/subscription selects (their ids are unknown to the API — copy says so, per `frontend-dashboard` "Kind-Free Category UI").

**Alternatives considered**: new key `pd-custom-categories:v2` (a second key to clean up, and stale v1 data silently resurrects if the loader falls back); keeping `kind` as an ignored field (keeps the lie visible in the UI's own data model and in tests).

**Rationale**: versioned envelope + in-place migration matches the vercel-react `client-localstorage-schema` rule and the spec's "migrating existing entries by preserving id/name and dropping the kind without data loss".

### Decision: Charts and totals are client-side aggregates with a single-currency guard

**Choice**: `GET /movements` returns all movements (no pagination in v1); the Finance chart, the compare view, the Resumen «Últimos movimientos» and the history list all consume that one SWR key (`finance/movements`). Category aggregates are computed in `lib/finance/finance.ts` as `toCategoryMovementTotals(movements, accountCurrencyById, userCurrency, categoryId) → { expense, income }`: rows with `category_id = null` are excluded, rows whose account currency ≠ user currency are excluded (never converted, never mixed), values are never netted. `CategoryBars` becomes a two-series div-bar composition (gasto/ingreso; a series is rendered only when its value is > 0 in the aggregated set).

**Alternatives considered**: a `GET /movements/stats/by-category` endpoint (explicitly out of scope; personal-scale volumes make it unnecessary — postgresql skill: the `(user_id, occurred_on DESC)` index covers the list scan); cloning `toCategoryTotals`' currency bug (explicitly forbidden by the spec).

**Rationale**: one source, one aggregation point, no new endpoint, no new library, and the currency rule is testable as a pure function.

## Data Flow

### Movement create/edit/delete (one request = one transaction)

```
FE modal ──POST /api/movements {direction, amount, account_id, category_id, occurred_on, description?}
                │
        routes/movements.rs::create_movement_handler
                │  validate: direction ∈ {expense,income} · parse_money_amount + <1e6
                │            validate_occurred_on · description ≤ 2000
                ▼
        BEGIN (sqlx::Transaction)
          1. SELECT id FROM accounts   WHERE id=$acc AND user_id=$u FOR UPDATE   → None ⇒ 422
          2. SELECT id FROM categories WHERE id=$cat AND user_id=$u               → None ⇒ 422   (ensure_owned_category)
          3. INSERT INTO movements (…, subscription_id = NULL) RETURNING …
          4. UPDATE accounts SET balance = balance + ($dir='expense' ? -amt : +amt), updated_at=now()
                WHERE id=$acc AND user_id=$u
        COMMIT  → 201 MovementResponse (amount as decimal string)
             any error ⇒ transaction drops ⇒ full rollback (no row, no balance change)

FE PATCH /api/movements/{id} (subset of direction, amount, account_id, category_id, occurred_on, description)
        load row (404 if foreign/missing) → validate provided fields
        BEGIN
          1. lock account(s) — old and new — in ascending UUID order
          2. reverse old signed delta on the old account
          3. apply new signed delta on the (possibly same) account
          4. UPDATE movements SET <final merged values>, updated_at=now()
             WHERE id=$1 AND user_id=$2  → 0 rows ⇒ rollback ⇒ 404
        COMMIT → 200

FE DELETE /api/movements/{id}
        BEGIN
          1. DELETE FROM movements WHERE id=$1 AND user_id=$2 RETURNING account_id, direction, amount → none ⇒ 404
          2. UPDATE accounts SET balance = balance - signed_delta(row) WHERE id=… AND user_id=…
        COMMIT → 204
```

### Subscription pay (one request = one transaction)

```
FE Pay modal ──POST /api/subscriptions/{id}/pay {account_id}
                │
        routes/subscriptions.rs::pay_subscription_handler
                │  1. BEGIN
                │  2. lock ACCOUNT first (FOR UPDATE, ownership)              → None ⇒ 404
                │  3. lock SUBSCRIPTION (FOR UPDATE, ownership)              → None ⇒ 404
                │  4. guards: is_active=false ⇒ 422 · price=0 ⇒ 422
                │            paid this cycle (last_paid_on NOT NULL AND next_billing_on > today_bogota) ⇒ 409
                │  5. seed/reuse category (idempotent upsert) → category_id
                │  6. INSERT movement(expense, price, today_bogota, category_id=Suscripciones, subscription_id)
                │  7. UPDATE accounts   balance = balance - price
                │  8. UPDATE subscriptions SET last_paid_on = today, next_billing_on = advance_next_billing(stored, today)
                │  9. COMMIT → 200 SubscriptionResponse (now with last_paid_on)
```

### Frontend data flow (single view, no new endpoints)

```
useAccounts ─┐                                   ┌─ Accounts cards (+ inline balance edit)
useSubscriptions ─┼─ FinanceScreens ─────────────┼─ Subscriptions rows (price · paid → Pay modal)
useAssets ─┤        (parallel SWR reads)         ├─ Assets + net worth number
useNetWorth ─┤                                   ├─ Add expense / Add income → MovementModal
useCategories ─┤                                 ├─ MovementHistory (local filters: account/category/direction)
useMovements ─┘                                  └─ CategoryChartSection  ──→ compare sub-route
      │                                                  (two-series div bars, client aggregate)
      ├─→ DashboardHome strip (total balance = Σ accounts.balance, same currency)
      ├─→ «Últimos movimientos» (5)                     ← same SWR key, no refetch duplication
      └─→ «Próximas suscripciones» (useSubscriptions filtered active + next_billing_on ≥ today)
```

## File Changes

Slice tags: **S-A** movements core, **S-B** subscriptions v2, **S-C** FE movements, **S-D** FE subs+Settings, **S-E** categories/charts, **S-H** Resumen cascade, **S-F** FE removals, **S-G** gated BE removal.

| File | Action | Slice | Description |
|---|---|---|---|
| `backend/migrations/0012_movements.sql` | Create | S-A | `movement_direction` enum, `movements` table + 3 indexes, `subscriptions.last_paid_on` (additive only) |
| `backend/src/routes/movements.rs` | Create | S-A | CRUD + transactional balance effect + status matrix + DB-gated tests |
| `backend/src/finance/validation.rs` | Modify | S-A | `ensure_owned_category` (kind gate removed), `ensure_owned_account`, live use of `validate_occurred_on` |
| `backend/src/routes/mod.rs` | Modify | S-A | `pub mod movements;` |
| `backend/src/main.rs` | Modify | S-A/S-B/S-G | Mount `/movements*` (S-A), `/subscriptions/{id}/pay` (S-B); wiring test updated per slice; removal assertions added in S-G |
| `backend/tests/migration_0012_movements.rs` | Create | S-A | File-content guard + live post-0012 shape (indexes, no trigger on `accounts`) |
| `backend/src/routes/accounts.rs` | Modify | S-A | Rewrite `delete_account_with_live_finance_rows_is_204` (no removed-table seeds) into 204-without-movements + new 409-with-movements test; docstring |
| `backend/src/finance/dates.rs` | Create | S-B | `today_bogota()`, `add_months_clamped()`, `advance_next_billing()` + unit tests |
| `backend/src/routes/subscriptions.rs` | Modify | S-B | widened PATCH, `pay_subscription_handler`, seed SQL, `last_paid_on` in row/response, kind gate removed, tests |
| `frontend/lib/api/finance.ts` | Modify | S-C/S-D/S-E/S-F | Movement wire+hooks, `paySubscription`, `patchSubscription`, single unfiltered `useCategories`; savings `createMovement`/`deleteMovement` renamed (S-C) then deleted (S-F); debts/savings hooks deleted (S-F) |
| `frontend/lib/finance/finance.ts` | Modify | S-C/S-E/S-F | `toMovementRows`, `toCategoryMovementTotals`, `toTotalBalance`, `todayInBogota`, `isPaidThisCycle`, `toSubscriptionRows` rework (S-C/E); `toCategoryTotals`/`toDebtRows`/`toSavingsViews`/`toDebtProgress` deletion (S-F) |
| `frontend/components/finance/MovementForms.tsx` | Create | S-C | `MovementModal` (add/edit), validation, Esc/focus return, CSS-only confirmation, delete confirm |
| `frontend/components/finance/MovementHistory.tsx` | Create | S-C | Latest-50 list, filters, `content-visibility`, account-click filter, edit/delete affordances |
| `frontend/components/containers/FinanceScreens.tsx` | Modify | S-C/S-D/S-E/S-F | Remove debts/savings shells + S5 blocks; add Add-buttons shell, history shell, Pay wiring, account-click filter state; chart props |
| `frontend/components/finance/FinanceSections.tsx` | Modify | S-C/S-F | `AccountsList` gains `onSelect`/`activeAccountId`; `SavingsList` deleted with savings (S-F) |
| `frontend/components/finance/SubscriptionForms.tsx` | Modify | S-D/S-F | Create/edit form extracted to Settings; `SubscriptionRow` keeps cancel/reactivate/delete + gains Pay button and paid state (S-D); form remnant removed (S-F) |
| `frontend/components/settings/SubscriptionsSection.tsx` | Create | S-D | Settings manager: list + create/edit (name, price, monthly due date, category, payment method) — no frequency control |
| `frontend/app/dashboard/ajustes/page.tsx` | Modify | S-D | Render `SubscriptionsSection` |
| `frontend/lib/settings/customCategories.ts` | Modify | S-E | v2 envelope, legacy migration, kind dropped, stale docstring fixed |
| `frontend/components/settings/CustomCategoriesSection.tsx` | Modify | S-E | Kind select/badge removed |
| `frontend/components/finance/CategoryCharts.tsx` | Modify | S-E | Two-series `CategoryBars` (gasto/ingreso), movement-based `CategoryChartSection` |
| `frontend/app/dashboard/finance/compare/page.tsx` | Modify | S-E | Split per category (no netting), unfiltered categories, movement source |
| `frontend/components/containers/DashboardHome.tsx` | Modify | S-H | 4-KPI strip (D1), two new sections, `pending-debts` widget/customize row removed |
| `frontend/components/dashboard/widgets/MovementsSnapshot.tsx` | Create | S-H | «Últimos movimientos» (5) with loading/error/empty + link to Finance |
| `frontend/components/dashboard/widgets/UpcomingSubs.tsx` | Create | S-H | «Próximas suscripciones» (active, `next_billing_on ≥ today`, top 5, paid state) |
| `frontend/components/dashboard/widgets/PendingDebts.tsx` | Delete | S-F | Widget retired with the capability |
| `frontend/components/dashboard/widgets/{GoalProgress,UpcomingPayments}.tsx` | Modify | S-H | GoalProgress = «Metas» only; UpcomingPayments union loses debts |
| `frontend/lib/dashboard/transforms.ts` | Modify | S-H/S-F | Strip/score/snapshot rework, union minus debts, `toPendingDebts`/`toOutstandingDebt`/`toTotalSavings` deleted, savings segment removed |
| `frontend/lib/api/dashboard.ts` | Modify | S-H/S-F | 5-widget default layout (20, 22, 23, 24, 30), debt hooks/keys deleted |
| `frontend/components/notifications/useNotifications.ts` | Modify | S-H | Debt source and `pending-debts` branches removed; stale debt mute stays inert |
| `frontend/components/containers/ProgressScreens.tsx` | Modify | S-H | Finance area = net worth only; score renormalized |
| `frontend/components/containers/ReportsScreens.tsx` | Modify | S-H | Outstanding-debt figure and debt read removed |
| `frontend/lib/i18n/es.ts` | Modify | S-C…S-F | New movement/pay/settings/total-balance/Resumen keys; savings/debts families and stale copy deleted (key plan in §Interfaces) |
| `frontend/components/finance/{SavingsForms,DebtPayments}.tsx` | Delete | S-F | Whole modules |
| `frontend/lib/finance/finance.test.ts`, `frontend/lib/dashboard/transforms.test.ts`, `frontend/lib/api/dashboard.test.ts`, `frontend/components/containers/DashboardHome.test.tsx`, `frontend/components/dashboard/widgets/__tests__/DashboardHome.widgets.test.tsx`, `frontend/components/notifications/__tests__/notifications.test.tsx`, `frontend/components/finance/finance.test.tsx` | Modify | per slice | Consumers of removed symbols/tables rewritten against surviving behaviour |
| `frontend/e2e/{sections,dashboard-widgets,notifications}.spec.ts` | Modify | S-F/S-H | Sweep covers surviving sections/widgets only (no savings/debts, 5 widgets) |
| `backend/migrations/0013_remove_savings_debts.sql` | **Staged** | S-G | Authored at `openspec/changes/finance-simplify-movements/migrations/0013_remove_savings_debts.sql`; copied into `backend/migrations/` only at the authorized gate |
| `backend/src/routes/{savings,debts}.rs` | Delete | S-G | Routes removed with their tables |
| `backend/src/routes/events.rs` | Modify | S-G | **Discovered cascade**: `events.debt_id` FK, DTO field, SQL columns/binds and the `validate_link_ids` debt arm must go before `DROP TABLE debts` |
| `backend/src/routes/assets.rs` | Modify | S-G | `NET_WORTH_SQL` debts leg removed (`debts` = card-only `GREATEST(-balance,0)`); test seeds rewritten |
| `mcp-dashboard/src/tools.ts`, `mcp-dashboard/README.md` | Modify | S-G | `list_debts` removed; README documents the debts removal + gated 0013 |
| `objetivo.md` | Modify | S-G | Dated ledger-reintroduction reversal note + charts section update |
| `openspec/specs/*` | Modify | archive | Canonical spec sync per the proposal Capabilities table (sdd-archive) |

## Interfaces / Contracts

### Migration 0012 (additive; no pre-existing object is touched)

```sql
CREATE TYPE movement_direction AS ENUM ('expense', 'income');

CREATE TABLE movements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    direction       movement_direction NOT NULL,
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    occurred_on     DATE NOT NULL,
    description     TEXT,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The first index carries the full list ORDER BY (occurred_on DESC, created_at DESC, id DESC);
-- the two partial-purpose indexes cover the history/per-account filters and the chart scan.
CREATE INDEX idx_movements_user_date     ON movements (user_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX idx_movements_user_account  ON movements (user_id, account_id);
CREATE INDEX idx_movements_user_category ON movements (user_id, category_id);

ALTER TABLE subscriptions ADD COLUMN last_paid_on DATE;
```

### Backend SQL (the whole write surface, in lock order)

```sql
-- lock + ownership (movement create/delete: one account; patch: one or two, ascending UUID)
LOCK_ACCOUNT_SQL:  SELECT id FROM accounts   WHERE id=$1 AND user_id=$2 FOR UPDATE
LEGACY_OWNER_SQL:  SELECT id FROM categories WHERE id=$1 AND user_id=$2          -- ensure_owned_category

INSERT_MOVEMENT_SQL:
  INSERT INTO movements (user_id, account_id, category_id, direction, amount, occurred_on, description, subscription_id)
  VALUES ($1,$2,$3,$4::movement_direction,$5,$6,$7,$8)
  RETURNING id, account_id, category_id, direction::text, amount, occurred_on, description,
            subscription_id, created_at, updated_at

APPLY_BALANCE_SQL:
  UPDATE accounts SET balance = balance + $2, updated_at = now() WHERE id=$1 AND user_id=$3

REVERSE_BALANCE_SQL:
  UPDATE accounts SET balance = balance - $2, updated_at = now() WHERE id=$1 AND user_id=$3

UPDATE_MOVEMENT_SQL:   -- final merged values bound explicitly (no COALESCE + enum cast ambiguity)
  UPDATE movements SET account_id=$3, category_id=$4, direction=$5::movement_direction, amount=$6,
         occurred_on=$7, description=$8, updated_at=now()
  WHERE id=$1 AND user_id=$2
  RETURNING id, account_id, category_id, direction::text, amount, occurred_on, description,
            subscription_id, created_at, updated_at

DELETE_MOVEMENT_SQL:
  DELETE FROM movements WHERE id=$1 AND user_id=$2
  RETURNING account_id, direction::text, amount

-- listings / reads
LIST_MOVEMENTS_SQL: SELECT <same columns> FROM movements WHERE user_id=$1
                    ORDER BY occurred_on DESC, created_at DESC, id DESC
GET_MOVEMENT_SQL:   SELECT <same columns> FROM movements WHERE id=$1 AND user_id=$2

-- subscriptions (S-B)
PAY_LOCK_SUB_SQL:  SELECT id, price, is_active, next_billing_on, last_paid_on
                   FROM subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE
SEED_CATEGORY_SQL: INSERT INTO categories (user_id, kind, name)
                   VALUES ($1, 'finance'::category_kind, 'Suscripciones')
                   ON CONFLICT (user_id, kind, name) DO UPDATE SET name = EXCLUDED.name
                   RETURNING id
PAY_UPDATE_SUB_SQL: UPDATE subscriptions SET last_paid_on=$3, next_billing_on=$4, updated_at=now()
                    WHERE id=$1 AND user_id=$2 RETURNING <14 cols> , last_paid_on

PATCH_SUB_SQL (widened, single statement, cancelled_at server-owned):
  UPDATE subscriptions SET
    name            = COALESCE($3, name),
    price           = COALESCE($4, price),
    next_billing_on = COALESCE($5, next_billing_on),
    is_active       = COALESCE($6, is_active),
    cancelled_at    = CASE WHEN $6 IS NULL THEN cancelled_at
                           WHEN $6      THEN NULL
                           ELSE COALESCE(cancelled_at, now()) END,
    updated_at      = now()
  WHERE id=$1 AND user_id=$2
  RETURNING <14 cols>, last_paid_on
```

### Delta-reversal matrix (balance effect of every operation)

Signed delta: `expense → −amount`, `income → +amount`. Reversal always applies the inverse of the **stored** (old) signed delta; then the new signed delta is applied. `updated_at` on `accounts` is set by the same `UPDATE`; a rollback removes it.

| Operation | Old (direction, amount, account) | New | Account updates (in one transaction, lock order) |
|---|---|---|---|
| POST expense | — | expense `a` @A | `A += −a` |
| POST income | — | income `a` @A | `A += +a` |
| PATCH amount only | expense `a₁` @A | expense `a₂` @A | `A += +a₁` then `A += −a₂` |
| PATCH direction flip | expense `a` @A | income `a` @A | `A += +a` then `A += +a` |
| PATCH account move | expense `a` @A | expense `a` @B | `A += +a` then `B += −a` |
| PATCH combo | expense `a₁` @A | income `a₂` @B | `A += +a₁` then `B += +a₂` |
| PATCH no money-relevant change | expense `a` @A | same | `A += +a`, `A += −a` (net 0, still one transaction) |
| DELETE expense | expense `a` @A | — | `A += +a` |
| DELETE income | income `a` @A | — | `A += −a` |
| PAY | — | expense `price` @A | `A += −price` |

### Rust interfaces (new/changed)

```rust
// routes/movements.rs
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct CreateMovementRequest {
    pub direction: String,      // "expense" | "income" → 422 otherwise
    pub amount: String,         // decimal string, > 0, scale ≤ 2, < 10^6
    pub account_id: Uuid,
    pub category_id: Uuid,      // required on create (column stays nullable in the DB)
    pub occurred_on: String,    // YYYY-MM-DD
    pub description: Option<String>,
}
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct PatchMovementRequest {
    pub direction: Option<String>, pub amount: Option<String>, pub account_id: Option<Uuid>,
    pub category_id: Option<Uuid>, pub occurred_on: Option<String>, pub description: Option<String>,
}   // any subset; omitted fields keep stored value; subscription_id is NOT a field → 422

#[derive(Debug, Serialize)]
pub struct MovementResponse {
    pub id: Uuid, pub direction: String, pub amount: Decimal, pub occurred_on: NaiveDate,
    pub description: Option<String>, pub account_id: Uuid, pub category_id: Option<Uuid>,
    pub subscription_id: Option<Uuid>, pub created_at: DateTime<Utc>, pub updated_at: DateTime<Utc>,
}   // Decimal/NaiveDate serialize as "25000.00" / "2026-09-24"

pub async fn create_movement_handler(State<AppState>, HeaderMap, Json<CreateMovementRequest>)
    -> Result<(StatusCode, Json<MovementResponse>), AppError>;
pub async fn list_movements_handler(State<AppState>, HeaderMap) -> Result<Json<Vec<MovementResponse>>, AppError>;
pub async fn get_movement_handler(State<AppState>, HeaderMap, Path<Uuid>) -> Result<Json<MovementResponse>, AppError>;
pub async fn patch_movement_handler(State<AppState>, HeaderMap, Path<Uuid>, Json<PatchMovementRequest>)
    -> Result<Json<MovementResponse>, AppError>;
pub async fn delete_movement_handler(State<AppState>, HeaderMap, Path<Uuid>) -> Result<StatusCode, AppError>;

pub fn validate_direction(raw: &str) -> Result<String, AppError>;   // 422 with Spanish body
pub fn validate_movement_amount(raw: &str) -> Result<Decimal, AppError>; // parse_money_amount + < 10^6 cap
fn map_movement_db_err(e: sqlx::Error) -> AppError;                 // 23514 | 23503 | 22P02 → 422, else Internal

// finance/validation.rs (survives every removal)
pub async fn ensure_owned_category(pool: &sqlx::PgPool, category_id: Uuid, user_id: Uuid) -> Result<(), AppError>;
pub async fn ensure_owned_account(pool: &sqlx::PgPool, account_id: Uuid, user_id: Uuid) -> Result<(), AppError>;
pub fn validate_occurred_on(raw: &str) -> Result<NaiveDate, AppError>;  // first live consumer; #[allow(dead_code)] removed

// finance/dates.rs (S-B)
pub fn today_bogota() -> NaiveDate;
pub fn add_months_clamped(base: NaiveDate, months: i32) -> NaiveDate;
pub fn advance_next_billing(stored: Option<NaiveDate>, pay_date: NaiveDate) -> NaiveDate;

// routes/subscriptions.rs (S-B)
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct PaySubscriptionRequest { pub account_id: Uuid }
#[derive(Debug, Deserialize)] #[serde(deny_unknown_fields)]
pub struct PatchSubscriptionRequest { pub name: Option<String>, pub price: Option<String>,
    pub next_billing_on: Option<String>, pub is_active: Option<bool> }
pub async fn pay_subscription_handler(State<AppState>, HeaderMap, Path<Uuid>, Json<PaySubscriptionRequest>)
    -> Result<Json<SubscriptionResponse>, AppError>;
// SubscriptionResponse gains `pub last_paid_on: Option<NaiveDate>`; SubscriptionRow tuple 14 → 15 (sqlx cap 16)
// CreateSubscriptionRequest.frequency becomes Option<String>: None | "monthly" → monthly, else 422
// next_billing_on becomes required (String, not Option)
```

### Frontend interfaces (new/changed)

```ts
// lib/api/finance.ts
export interface MovementWire {
  id: string; direction: "expense" | "income"; amount: string | number; occurred_on: string;
  description: string | null; account_id: string; category_id: string | null;
  subscription_id: string | null; created_at: string; updated_at: string;
}
export function useMovements(): SWRResponse<MovementWire[]>;            // key "finance/movements"
export function createMovement(input: { direction: "expense"|"income"; amount: string; account_id: string;
  category_id: string; occurred_on: string; description?: string }): Promise<unknown>;
export function patchMovement(id: string, body: Partial<{ direction: "expense"|"income"; amount: string;
  account_id: string; category_id: string; occurred_on: string; description: string }>): Promise<unknown>;
export function deleteMovement(id: string): Promise<void>;
export function paySubscription(id: string, accountId: string): Promise<SubscriptionWire>;
export function patchSubscription(id: string, body: { name?: string; price?: string; next_billing_on?: string; is_active?: boolean }): Promise<SubscriptionWire>;
export function useCategories(): SWRResponse<CategoryWire[]>;           // GET /categories (no kind param), key "finance/categories"
export interface SubscriptionWire { /* + */ last_paid_on: string | null }

// lib/finance/finance.ts
export interface MovementRowView { id: string; direction: "expense"|"income"; amount: number; occurredOn: string;
  description: string | null; accountName: string; categoryName: string | null; }
export function toMovementRows(movements: MovementWire[] | null | undefined,
  accounts: NamedOption[], categories: NamedOption[]): MovementRowView[];
export function toCategoryMovementTotals(movements: MovementWire[] | null | undefined,
  currencyByAccountId: Map<string, string>, userCurrency: string, categoryId: string): { expense: number; income: number };
export function toTotalBalance(accounts: AccountCardView[], currency: string): number;
export function todayInBogota(now?: Date): string;                       // Intl en-CA + America/Bogota
export function isPaidThisCycle(sub: { last_paid_on: string | null; next_billing_on: string | null }, today: string): boolean;
export function toSubscriptionRows(rows, today): SubscriptionRowView[];  // price + due + paid + payable(price>0 && is_active)
```

### i18n key plan (`frontend/lib/i18n/es.ts`, single ES dictionary, typed `EsKey`)

- **Added — movements**: `finance.movementsTitle`, `finance.movementsHint`, `finance.addExpense`, `finance.addIncome`, `finance.movementModalExpenseTitle`, `finance.movementModalIncomeTitle`, `finance.movementSaved`, `finance.movementDeleteConfirm`, `finance.movementsEmpty`, `finance.movementsEmptyHint`, `finance.movementFilterAccount`, `finance.movementFilterCategory`, `finance.movementFilterDirection`, `finance.movementFilterAll`, `finance.movementFilterClear`, `finance.movementDirectionExpense`, `finance.movementDirectionIncome`, `finance.movementPaymentLabel`, `finance.movementDescriptionLabel` (reuse `finance.amountCop`, `finance.dateLabel`, `finance.category`, `finance.selectAccount`, `finance.selectCategory`, `finance.save`, `finance.cancel`, `finance.saving`, `finance.amountPositiveError`, `finance.requiredFieldError`, `finance.saveFailed`, `finance.deleteFailed` where they already fit).
- **Added — pay/settings**: `finance.subscriptionPay`, `finance.subscriptionPayTitle`, `finance.subscriptionPayConfirm`, `finance.paidThisCycle`, `finance.subscriptionPaidThisCycle`, `finance.subscriptionFreeNoPay`, `finance.subscriptionSettingsTitle`, `finance.subscriptionSettingsHint`, `finance.subscriptionCreate`, `finance.subscriptionDueDate`, `finance.subscriptionDueRequired`.
- **Added — account delete**: `finance.accountDeleteBlocked`.
- **Added — charts/strip/Resumen**: `finance.chartTitle`, `finance.chartHint`, `finance.chartExpenses` (rewritten), `finance.chartIncome`, `dashboard.totalBalance`, `dashboard.latestMovementsTitle`, `dashboard.latestMovementsHint`, `dashboard.latestMovementsEmpty`, `dashboard.upcomingSubscriptionsTitle`, `dashboard.upcomingSubscriptionsHint`, `dashboard.upcomingSubscriptionsEmpty`.
- **Rewritten copy**: `finance.subtitle` (drop "deudas, ahorros"), `dashboard.overviewSubtitle` (drop "deudas"), `dashboard.goalProgressHint`/`dashboard.goalVsSavings` (metas only), `finance.categoryChartHint`, `finance.chartEmptyHint`.
- **Deleted families**: `finance.debts*`, `finance.savings*`, `finance.manageDebts*`, `finance.manageSavings*`, `finance.deposit*`, `finance.withdraw*`, `finance.overWithdrawal*`, `finance.overPayment*`, `finance.paymentHistory*`, `finance.creditor*`, `finance.installment`, `finance.interestRate`, `finance.confirmDeleteGoal`, `finance.confirmDeletePayment`, `finance.correctPayment`, `finance.goalName`*, `finance.savedPct`, `finance.completedBadge`, `finance.noDebts*`, `finance.noSavings*`, `finance.noSubscriptionCategories`, `finance.frequency`, `dashboard.pendingDebts*`, `dashboard.savingsSegment`, `dashboard.noFlowData`, `dashboard.noFlowHint`.
  (*) `finance.goalName` is deleted only if no surviving consumer remains after the Settings form rewrite (verified in S-D/S-F).
- **Preserved deliberately**: `finance.paymentTransfer` ("Transferencia" — a payment method, not the transfers feature).

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Backend unit | `validate_direction`, amount cap `< 10^6`, `today_bogota` (injected clock), `add_months_clamped` (31 Jan → 28/29 Feb → 31 Mar), `advance_next_billing` (all five cycle scenarios), seed SQL string guard, PATCH allowlist rejection | `#[cfg(test)] mod tests` in `routes/movements.rs`, `finance/dates.rs`, `routes/subscriptions.rs` (existing idiom: `assert_422`, SQL-scope assertions) |
| Backend DB-gated (skip without `DATABASE_URL`) | Movement CRUD + full delta-reversal matrix; rollback leaves no row/balance change; concurrent same-account serialization; 404 vs 422 matrix; account delete 204/409 (23503 mapping); pay debits atomically + double-pay 409 + free 422 + inactive 422 + clamping + dormant advance; seed idempotency and other-kind collision; widened PATCH accepts only the four fields; kind-free category acceptance | `#[tokio::test]` with `db_state`/`cleanup_user` helpers; `sqlx::query_scalar` probes; fixtures through the API or surviving tables only |
| Migration guards | `0012` exists, additive tokens only (`CREATE TABLE`/`CREATE TYPE`/`CREATE INDEX`/`ADD COLUMN`, no `DROP`/`ALTER … DROP`), post-0012 indexes + `subscriptions.last_paid_on` + no trigger writes `balance`; `0013` exists **only** in the change folder, removal-only tokens, no `CASCADE`/`CREATE`/`BACKUP`/`DUMP`, gate order recorded | `backend/tests/migration_0012_movements.rs`, `backend/tests/migration_0013_gate.rs` (file-content guards never skip; live shape tests skip without DB) |
| Frontend unit (vitest) | `toMovementRows`, `toCategoryMovementTotals` (two series, no netting, null-category excluded, foreign-currency excluded), `toTotalBalance` (currency filter), `todayInBogota`, `isPaidThisCycle`, customCategories legacy→v2 migration without loss, subscription row paid/payable derivation | pure-function tests in `lib/finance/finance.test.ts`, `lib/settings/customCategories.test.ts` (new), `lib/dashboard/transforms.test.ts` |
| Frontend component (vitest + MSW) | Movement modal required-field validation sends no request; Esc closes + restores focus; successful submit posts decimal-string amount and revalidates `finance/movements`; history filters (account/category/direction) compose; account click sets the filter; 409 account delete shows `finance.accountDeleteBlocked`; Settings form has no frequency control; Pay modal sends only `{account_id}`; double-pay 409 message; Resumen sections loading/error/empty; no request to `/debts` or `/savings-goals` | `@testing-library/react` + msw handlers keyed by `direction`; container tests updated per slice |
| E2E (live smoke, skipped without `E2E_SMOKE_LIVE=1`) | Sections sweep lists surviving finance sections only; widgets sweep covers 5 widgets with no `pending-debts`; notifications with no `/debts` | `frontend/e2e/{sections,dashboard-widgets,notifications}.spec.ts` |
| Per-slice gate | `cd backend && cargo test`; `cd frontend && pnpm test && pnpm exec tsc --noEmit && pnpm build` | Chain invariant: every merge point green |

## Threat Matrix

**N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary exists in this design.** The change adds HTTP API routes and DDL migrations and edits UI components; it executes no shell commands, classifies no document-like files, and performs no git/PR automation. The complete adversarial surface (foreign ids, 404-vs-422, rollback, lock serialization, double-pay, destructive-migration gating) is covered by the movement/pay test matrix above and the `0013` gate guard, not by this matrix.

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A — no file-classification or execution boundary | — | — |
| Git repository selection | N/A — no git/shell automation in the design | — | — |
| Commit state | N/A — no VCS automation; the change is explicitly local-only | — | — |
| Push state | N/A — no VCS automation | — | — |
| PR commands | N/A — no PR automation | — | — |

## Migration / Rollout

**Migrations**

- **0012** (additive, safe to apply immediately after S-A): creates `movement_direction`, `movements`, three indexes, `subscriptions.last_paid_on`. Nothing pre-existing is altered; `accounts.balance` keeps exactly one trigger (`trg_accounts_updated_at`) and no trigger writes balance.
- **0013** (destructive, gated): authored at `openspec/changes/finance-simplify-movements/migrations/0013_remove_savings_debts.sql`, **never** in `backend/migrations/` while gated — because CI applies every `migrations/*.sql` with `psql -v ON_ERROR_STOP=1` and the local compose DB mounts the folder as `docker-entrypoint-initdb.d`. Statement order (0011 order, adapted):

```sql
-- (a) Inbound FK column on a surviving table (0013-discovery: events.debt_id).
ALTER TABLE events DROP COLUMN debt_id;

-- (b) Child tables first (they own the inbound FKs to the parents).
DROP TABLE debt_payments;
DROP TABLE savings_goal_movements;

-- (c) Parent tables.
DROP TABLE debts;
DROP TABLE savings_goals;

-- (d) Trigger functions are unreferenced once their tables are gone.
DROP FUNCTION update_debt_pending();
DROP FUNCTION update_savings_goal_saved();
```

  No `CASCADE`, no `CREATE`, no data migration, no backup, no compatibility view (standing no-backup decision; same posture as 0011). `events.debt_id` is the one inbound FK to `debts` on a surviving table; `savings_goals`/`debts` have no other surviving referents (verified by grepping every `REFERENCES debts|savings_*` across `backend/migrations/*.sql`).

**Gate order (recorded)**: (1) owner explicitly authorizes 0013 at apply time; (2) deploy gate re-confirms the intentional data loss (goals, goals movements, debts, payments — no dump); (3) only then is the file copied into `backend/migrations/` and applied out-of-band, after every reversible slice has merged and every reference to the removed routes/tables is gone.

**Chain and merge order** (proposal order preserved; each slice must leave `cargo test`, `pnpm test`, `tsc --noEmit` and `pnpm build` green):

`S-A → S-B → S-C → S-D → S-E → S-H → S-F → S-G`

- **S-A** is atomic by construction: migration + routes + transactional balance together.
- **S-H before S-F**: Resumen/widgets stop reading the debt hooks while the modules still exist (green), then S-F deletes the now-unused modules and their tests (delete-only).
- **S-F is independent of the BE chain** and may land anytime before S-G; it is the slice most likely to exceed 400 changed lines (delete-only, "any reference left?" cognitive load) → escalated as `size:exception`, never self-accepted.
- **S-G is the only gated slice and the point of no return** for data.

**Per-slice design ownership (for `sdd-tasks` splitting)**

| Slice | Owned files | Likely split at 400 lines |
|---|---|---|
| S-A | `migrations/0012`, `routes/movements.rs`, `finance/validation.rs`, `routes/mod.rs`, `main.rs` (movements wiring), `routes/accounts.rs` (delete tests), `tests/migration_0012_movements.rs` | A1 = 0012 + validation helpers + shape guard; A2 = routes + transaction + accounts 409 tests (both merge as S-A before S-B) |
| S-B | `finance/dates.rs`, `routes/subscriptions.rs`, `main.rs` (pay wiring), tests | no split expected |
| S-C | `api/finance.ts` (movement hooks + savings rename), `lib/finance/finance.ts` (movement transforms/dates), `MovementForms.tsx`, `MovementHistory.tsx`, `FinanceScreens.tsx` (add shells + filter state), `FinanceSections.tsx` (AccountsList select), i18n movement keys, tests | C1 = hooks/transforms + tests; C2 = modals + history + screen wiring |
| S-D | `settings/SubscriptionsSection.tsx`, `SubscriptionForms.tsx` (extract form, Pay row/modal), `ajustes/page.tsx`, `api/finance.ts` (pay/patch hooks), i18n pay/settings keys, tests | no split expected |
| S-E | `customCategories.ts` + section, `CategoryCharts.tsx`, `compare/page.tsx`, `FinanceScreens.tsx` (single unfiltered category set), i18n chart keys, tests | no split expected |
| S-H | `DashboardHome.tsx`, `lib/dashboard/transforms.ts`, `lib/api/dashboard.ts` (layout), widgets (+ new sections), `notifications/useNotifications.ts`, `ProgressScreens.tsx`, `ReportsScreens.tsx`, i18n Resumen keys, tests | H1 = strip + sections + widgets; H2 = notifications/score/reports cascade |
| S-F | deletions + import cleanups + test rewrites + e2e updates | delete-only; escalate `size:exception` if > 400 |
| S-G | `migrations/0013` move+apply, `routes/{savings,debts}.rs` delete, `routes/mod.rs`, `main.rs` removal assertions, `events.rs` debt_id, `assets.rs` net-worth SQL + seeds, MCP tool/README, `objetivo.md`, `tests/migration_0013_gate.rs` post-apply flip | gated; splits allowed but the migration must land with the code that removes its references |

**Rollback**: pre-gate slices are git-revertible; 0012 is additive (revert by a follow-up drop or by discarding local dev DB state — no production apply authorized). Post-0013 there is **no data rollback** by design; reverting S-G restores code and schema shape only. Delivery stays local: no commit, push or deploy is performed by this change.

## Open Questions

- [ ] **`next_billing_on` cannot be cleared through PATCH** (the `COALESCE` form keeps the stored value; sending `null` is not expressible). Accepted for v1 because create requires the due date and every subscription is payable monthly; needs owner confirmation only if a "no due date" state is ever wanted.
- [ ] **Spec prose alignment (non-blocking, for archive)**: `finance-subscriptions` "Subscription Cycle State" prose says "first monthly occurrence strictly after the pay date". The binding scenarios (especially "Early payment counts for the cycle") require the threshold `max(pay_date, stored_due)` documented above. The canonical spec should be corrected at `sdd-archive`; no owner decision is needed to implement the scenarios.
- [ ] **Discovered cascade not in the proposal's affected-areas table**: `events.debt_id` (FK + DTO + `events.rs` link validation + tests seeding `debts`). The spec's "no live reference to `debts`" and 0013's `DROP TABLE debts` make this removal mandatory; it is assigned to S-G. Flagged for the orchestrator/owner so the slice scope and budget include it.
- [ ] **Tests currently seeding removed tables** (`routes/accounts.rs` delete test, `routes/assets.rs` net-worth test, `routes/events.rs` link tests) must be rewritten in the slice that changes their subject (S-A/S-G). No test may seed a removed table after the change; this is a task-level detail, listed here so it is not discovered at verify time.
