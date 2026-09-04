# Design: p2-finance-core

## Technical Approach

Hybrid balance strategy over existing `0002_finance` schema: keep the `AFTER INSERT/DELETE` trigger for `income`/`expense` (O(1) cached reads), move all transfer balance logic to a single application-level transaction with explicit updates. Neutralize the broken `transfer` branch via additive migration `0005` (never edit `0002`). Money as `rust_decimal::Decimal` ↔ `NUMERIC(18,2)`, serialized as strings in DTOs. All queries scoped by `user_id` via extracted `require_user_id`; foreign-resource access returns 404 (no existence oracle).

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Trigger handles transfers vs app-level transfer txn | Trigger fires per-row, cannot see both legs atomically; first-leg insert sees no counterparty → skips or double-applies | App-level single txn: insert both legs + `SELECT FOR UPDATE` + explicit balance updates. Trigger transfer branch neutralized in 0005 |
| f64 vs rust_decimal-as-string | f64 drifts on money; NUMERIC exact | `rust_decimal` with `sqlx` `decimal` feature; DTOs carry strings, parsed/validated at boundary, 2dp enforced |
| Per-handler auth inline vs `require_user_id` helper | `me.rs` inlines bearer→session→user lookup (duplication risk) | Extract `auth::helper::require_user_id(headers, pool) -> Result<Uuid, AppError>`; all finance handlers use it |
| Budget precompute vs on-demand aggregate | Precompute needs invalidation jobs | On-demand single `GROUP BY` query per status request; thresholds mapped in Rust |
| Edit 0002 vs new 0005 migration | Editing applied migration breaks deployed DBs | 0005 `CREATE OR REPLACE` neutralizes only the `transfer` branch; income/expense/credit-card paths untouched |

## Data Flow

```
Client ──Bearer──→ require_user_id ──→ handler ──→ sqlx (user_id-scoped) ──→ Postgres
Transfers: handler ──BEGIN──→ SELECT accounts FOR UPDATE ──→ INSERT leg1 ──→ INSERT leg2 ──→ UPDATE balances ──→ COMMIT (any err → ROLLBACK)
Budgets:  handler ──→ budgets row ──→ single SUM(expenses) ──→ Rust maps ok/warn/over
```

Transfer txn order (fixed, avoids deadlock): lock accounts in sorted-UUID order with `SELECT ... FOR UPDATE`; verify both owned by `user_id`, distinct, amount > 0 with ≤2dp; `group_id = Uuid::new_v4()`; insert expense leg (src) and income leg (dst) with `type='transfer'`, `transfer_group_id`, `related_transfer_id` cross-links; `UPDATE accounts SET balance = balance ∓ amount` on both rows; commit. Trigger 0005 skips `transfer` rows so no double-apply. Income/expense inserts/deletes still rely on existing trigger branches.

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/migrations/0005_fix_transfer_trigger.sql` | Create | `CREATE OR REPLACE apply_transaction_to_balance()` with transfer branch as no-op; regression comment |
| `backend/src/auth/helper.rs` | Create | `require_user_id(&HeaderMap, &PgPool) -> Result<Uuid, AppError>` (401 on missing/invalid/expired) |
| `backend/src/auth/mod.rs` | Modify | Export `helper` module |
| `backend/src/routes/accounts.rs` | Create | CRUD + archive; all queries `WHERE id=$1 AND user_id=$2` |
| `backend/src/routes/transactions.rs` | Create | Create income/expense, limited patch (description/notes/category only), delete (trigger reverses) |
| `backend/src/routes/transfers.rs` | Create | Atomic transfer txn described above |
| `backend/src/routes/budgets.rs` | Create | CRUD + `GET /budgets/:id/status` aggregate |
| `backend/src/routes/mod.rs`, `main.rs` | Modify | Register modules and `/accounts`, `/transactions`, `/transfers`, `/budgets` routes |
| `backend/Cargo.toml` | Modify | Add `rust_decimal` (+ `serde`, `db-tokio-postgres` as needed) and `sqlx` `decimal` feature |

## Interfaces / Contracts

Routes (all require Bearer; 401 if missing/invalid):

| Method + Path | Body (money as string) | Success | Errors |
|---|---|---|---|
| `POST /accounts` `{name, type, currency?, notes?, color?, icon?}` | — | 201 | 409 dup name, 422 bad type |
| `GET /accounts`, `GET /accounts/:id` | — | 200 | 404 foreign/missing |
| `PATCH /accounts/:id` `{notes?, color?, icon?, is_archived?}` | — | 200 | 404, 422 |
| `POST /transactions` `{account_id, type: income\|expense, amount: "50.00", occurred_on, category_id?, description?}` | amount >0, ≤2dp | 201 (trigger adjusts balance) | 404 account, 422 amount/date/category-kind |
| `PATCH /transactions/:id` `{description?, notes?, category_id?}` only | amount/account/type rejected | 200 | 422 core-field edit |
| `DELETE /transactions/:id` | — | 204 | 404 |
| `POST /transfers` `{from_account_id, to_account_id, amount: "100.00", occurred_on, description?}` | distinct owned accounts, >0 ≤2dp | 201 + both legs | 404 foreign leg, 422 same-account/amount |
| `POST /budgets`, `GET /budgets/:id/status` | `{category_id, amount, period_start, period_end}` | 201 / 200 `{spent, remaining, pct, status}` | 422 period/amount/category-kind |

Shared money rule: parse string → `Decimal`; reject `<= 0` or `scale > 2` with 422. Category FK must be `kind='finance'` and owned, else 422. Budget status query (single round-trip, no N+1):

```sql
SELECT COALESCE(SUM(t.amount),0) FROM transactions t
WHERE t.user_id=$1 AND t.category_id=$2 AND t.type='expense'
  AND t.occurred_on BETWEEN $3 AND $4;
```

`status = pct >= over_threshold ? over : pct >= warn_threshold ? warn : ok`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `require_user_id` (missing/expired/revoked → 401); money validation (0, negative, 3dp → 422); budget status mapper (ok/warn/over boundaries); error mapping (UNIQUE→409, FK/category-kind→422) | `cargo test` per module, one assertion per test |
| Integration | Transfer atomicity: kill second leg → rollback, no orphan legs, balances unchanged; trigger-neutralization: transfer inserts move exact ±amount once; income/expense trigger still works; 404 on foreign account; `SUM(tx) == balance` reconciliation | `cargo test` with test DB, transactions rolled back per test |
| E2E | — | Out of scope (no frontend) |

Error mapping: `AppError` extended — pgcode `23505` (accounts `UNIQUE(user_id,name)`) → 409; `23503` FK + category `kind != 'finance'` or unowned → 422; ownership miss → 404 (query returns 0 rows, never 403, to avoid oracle).

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

0005 is additive `CREATE OR REPLACE FUNCTION` neutralizing only the `ELSE transfer` insert/delete branches to `RETURN NEW/OLD` no-ops. No backfill; deploy after code that does explicit transfer updates. Rollback: redeploy code + counter-migration restoring old function (known-buggy; requires balance audit via `SUM(transactions)` vs `accounts.balance`).

## Open Questions

- [ ] Round vs reject `scale > 2` amounts (spec says reject 422 — confirm policy)?
- [ ] Transfer DELETE semantics (delete both legs as unit vs forbid)?
