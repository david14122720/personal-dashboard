# Design: Credit Card Tracking

## Technical Approach

Activate dormant card columns on `accounts` per proposal Approach A. Migration `0006` adds CHECKs/indexes only (never edits `0002`). `accounts.rs` exposes card fields and computes `used/available/usage_pct/alert_level` in the read SELECT (CASE, no N+1). `transactions.rs` accepts optional `credit_card_account_id` (expense only) reusing the existing balance trigger. Payments stay `POST /transfers` (bank → card); no new ledger table, no new router module.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Card as specialized account vs new `credit_cards` table | New table = clean domain but dual-truth drift + heavier joins on 1 CPU/1 GB; reuse = confusing negative `balance` semantics | Reuse `accounts` + dormant columns; document negative = debt |
| Statement balance cached vs date-cutoff aggregate | Cached drifts after cutoff; aggregate costs one indexed SUM | Cutoff aggregate `SUM … WHERE occurred_on <= cutoff`; cached `balance` = current only |
| Over-limit enforcement in trigger vs API | Trigger clamp hides errors; API guard gives 422 with message | API guard 422; CHECKs as backstop (debts precedent) |
| Computed metrics in SQL vs Rust | Rust needs 2 queries (N+1); SQL CASE is single row | SQL CASE in `GET/LIST` SELECT |
| New `/credit-cards` routes vs extend `/accounts` | New routes duplicate ownership/409 logic | Extend `POST/PATCH/GET /accounts`; no new routes in `main.rs` |

## Data Flow

```
POST /accounts (card) ──→ accounts (limit+days) ──→ GET /accounts/:id (CASE metrics)
POST /transactions (expense+card link) ──→ trigger: balance -= amount (both legs)
POST /transfers (bank → card) ──→ app txn: source -= amt, card += amt
GET /accounts/:id ──→ current (cached) + statement (cutoff SUM) + alert_level
GET /net-worth ──→ card debt (GREATEST(-balance,0)) added to liabilities
```

Month-end clamp: `cutoff = LEAST(statement_day, days_in_month(y,m))` computed in Rust (`chrono::NaiveDate`), passed as bind param; never in SQL date math.

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/migrations/0006_credit_cards.sql` | Create | CHECKs + partial/covering indexes (below) |
| `backend/src/routes/accounts.rs` | Modify | Card DTO fields, extended row (≤16 cols), CASE metrics, `alert_level` |
| `backend/src/routes/transactions.rs` | Modify | Optional `credit_card_account_id`, owned-card check, over-limit 422 |
| `backend/src/routes/transfers.rs` | Modify | Doc comment: bank → card payment contract |
| `backend/src/routes/assets.rs` | Modify | Net-worth liabilities include card debt |

## Interfaces / Contracts

```rust
// accounts.rs — only present for type='credit_card'; Option keeps row ≤16 cols
pub struct CreateAccountRequest { /* existing */ pub credit_limit: Option<String>,
  pub statement_day: Option<i16>, pub payment_due_day: Option<i16> }
pub struct AccountResponse { /* existing */ pub credit_limit: Option<Decimal>,
  pub used_balance: Option<Decimal>, pub available_balance: Option<Decimal>,
  pub usage_pct: Option<Decimal>, pub alert_level: Option<String> } // ok|warn|high
// transactions.rs
pub struct CreateTransactionRequest { /* existing */ pub credit_card_account_id: Option<Uuid> }
```

Validation: `deny_unknown_fields` everywhere; `credit_limit` via `parse_money_amount` (>0, scale≤2 → 422); days 1–31 → 422; non-card type with any card field → 422; card type without `credit_limit` → 422 (pre-CHECK). Ownership: every query `AND user_id=$N`; foreign card/account id → 404; `credit_card_account_id` pointing at non-card or nonexistent row → 422. `23505` → 409, `23514` → 422 via existing mappers. Over-limit: `used + amount > limit` → 422 before INSERT (inside transfer-style read or pre-insert SELECT).

Migration `0006` (NUMERIC(18,2) codebase standard, not 12,2):
```sql
ALTER TABLE accounts ADD CONSTRAINT chk_card_limit_presence CHECK (
  (type='credit_card') = (credit_limit IS NOT NULL));
ALTER TABLE accounts ADD CONSTRAINT chk_card_limit_pos CHECK (
  credit_limit IS NULL OR credit_limit > 0);
ALTER TABLE accounts ADD CONSTRAINT chk_card_days_presence CHECK (
  (type='credit_card') = (statement_day IS NOT NULL AND payment_due_day IS NOT NULL));
CREATE INDEX idx_accounts_user_card ON accounts(user_id) WHERE type='credit_card';
CREATE INDEX idx_tx_card_user_date ON transactions(credit_card_account_id, user_id, occurred_on DESC)
  WHERE credit_card_account_id IS NOT NULL;
```

Reads (single-row, index-backed):
```sql
-- metrics: used = GREATEST(-balance,0); available = limit + balance;
-- usage_pct = used/limit*100 (guard limit>0); alert: <70 ok, 70–90 warn, >90 high
-- statement: SELECT COALESCE(SUM(amount),0) FROM transactions
--   WHERE credit_card_account_id=$1 AND user_id=$2 AND type='expense' AND occurred_on <= $3;
-- net-worth liabilities: debts + SUM(GREATEST(-balance,0)) over user cards per currency
```

Trigger vs API: trigger keeps charging/reversing card balance on expense insert/delete (unchanged); API owns limit-presence, day ranges, card-type checks, over-limit 422, and payment-via-transfer docs. No trigger change in P5.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (`cargo test`) | `validate_card_fields`, clamp fn, alert thresholds, deny_unknown_fields, money-string rejects | One assertion/test, descriptive names; no DB |
| Integration (`cargo test`, DATABASE_URL) | CHECK rejects (limit iff card, days iff card), partial-index EXPLAIN (Index Scan, no Seq Scan per FTS precedent), purchase charges card, over-limit 422 leaves balance, transfer reduces debt, statement cutoff excludes post-cutoff rows, foreign card 404 / non-card link 422, duplicate name 409 | TDD; reuse `db_state`/`cleanup_user` harness; keep `query_as` tuples ≤16 cols (sqlx cap — split statement aggregate into second query) |
| E2E | — | None (API-only change) |

Constraints: do NOT run bare `cargo fmt` (rustfmt version drift per project memory); use `cargo test` only.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required beyond `0006` (additive CHECKs/indexes, `CONCURRENTLY` avoided — single-tenant Dokploy). Existing non-card rows unaffected (all card columns NULL). Rollback: revert route diffs, drop `0006` constraints/indexes.

## Open Questions

- None blocking. Defer: interest/accrual, cuotas engine (explicitly out of scope).
