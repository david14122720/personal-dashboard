# Design: p3-finance-extended

## Technical Approach

Thin CRUD handlers over final migration `0003` triggers, following the `transactions.rs` pattern: `require_user_id` scoping, string-amount DTOs via `finance/money.rs`, `deny_unknown_fields` PATCH, trigger-owned derived fields. Four route modules + `GET /net-worth` (assets). No `UPDATE` on amount fields anywhere; corrections via DELETE+recreate.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Signed movement amount vs separate deposit/withdraw endpoints | One endpoint is simpler; direction ambiguity | Signed string amount (`≠0`), handler interprets sign; trigger adds directly |
| API-level overpayment clamp vs relying on `GREATEST(...,0)` trigger | Trigger silently clamps, hiding user error | Reject payment `> pending_amount` with 422 before INSERT |
| Valuation ordering via trigger vs API guard | Trigger `sync_asset_current_value` blindly overwrites `current_value` | API rejects `recorded_on <= max(recorded_on)` with 422; valuations INSERT-only (no DELETE — trigger has no DELETE branch) |
| Net worth materialized vs on-demand | Stale-cache invalidation complexity | On-demand `GROUP BY currency` query over non-archived assets minus active debts |
| `0006` index migration now vs later | Premature indexes cost write time | Defer; existing 0003 indexes cover per-user access except movement/payment history by user — measure in verify, add `CONCURRENTLY` only on evidence |
| Money parser variants vs one parser + inline checks | Inline checks scatter the `>0 / ≥0 / signed` rules | Add `parse_money_amount_nonneg` (subs price, valuations) and `parse_signed_amount` (savings movements) beside existing `parse_money_amount` |

## Data Flow

```
Client ──→ require_user_id ──→ parse/validate DTO ──→ ownership check ──→ INSERT/DELETE
                                                                              │
                                                              0003 trigger ──→ derived field
                                               savings: saved_amount/is_completed
                                               debts: pending_amount/status | assets: current_value
Net-worth: Client ──→ GET /net-worth ──→ single GROUP BY currency aggregate (no trigger)
```

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/src/finance/money.rs` | Modify | Add `parse_money_amount_nonneg` (≥0) and `parse_signed_amount` (≠0); unit tests |
| `backend/src/routes/savings.rs` | Create | Goals CRUD + nested movements; signed validation; duplicate name → 409 |
| `backend/src/routes/debts.rs` | Create | Debts CRUD + nested payments; overpayment + paid-off guards (422) |
| `backend/src/routes/subscriptions.rs` | Create | Subs CRUD + status-only PATCH (`is_active`); category kind=`subscription` check |
| `backend/src/routes/assets.rs` | Create | Assets CRUD + valuations + `GET /net-worth` handler |
| `backend/src/routes/mod.rs` | Modify | Register 4 modules |
| `backend/src/main.rs` | Modify | Wire routes |
| `backend/migrations/0006_finance_history_user_indexes.sql` | Create (conditional) | Only if verify shows slow history-by-user queries |

## Interfaces / Contracts

Endpoints (all `Authorization: Bearer` → 401 via `require_user_id`):

- `POST /savings-goals {name, target_amount: string>0, currency?, category_id?} → 201`; `GET /savings-goals`; `GET /savings-goals/:id`; `DELETE → 204`
- `POST /savings-goals/:id/movements {amount: signed string≠0, occurred_on, transaction_id?, notes?} → 201`; `DELETE .../:mid → 204` (trigger reverses)
- `POST /debts {name, creditor, original_amount>0, start_date, ...} → 201` (pending=original, status=active); nested `POST /debts/:id/payments {amount>0, paid_on, transaction_id?}` with guards: `status≠active → 422`, `amount>pending → 422`
- `POST /subscriptions {name, price≥0 string, frequency enum, category_id?} → 201`; `PATCH /subscriptions/:id {is_active: bool}` only (`deny_unknown_fields` → 422 otherwise); `DELETE → 204`
- `POST /assets {name, category enum, current_value implied 0, ...} → 201`; `POST /assets/:id/valuations {value≥0 string, recorded_on}` with ordering guard; `GET /net-worth → 200 {per_currency: [{currency, assets, debts, net_worth}]}`

Status mapping: cross-user access → 404 (never leak existence); FK/kind mismatch/unowned `transaction_id`/`category_id` → 422; duplicate `(user_id,name)` savings goal → 409; `AppError` variants already cover 401/404/409/422. Savings `category_id` must be kind=`finance`; subs kind=`subscription`.

```rust
// money.rs additions — same error shape as existing parser
pub fn parse_money_amount_nonneg(raw: &str) -> Result<Decimal, AppError>; // ≥0, scale≤2
pub fn parse_signed_amount(raw: &str) -> Result<Decimal, AppError>;       // ≠0, scale≤2
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | 3 money parsers; date/enum validators; SQL-scope string asserts | `cargo test` pure tests, mirror `transactions.rs` style (one assertion per test) |
| Integration (DB) | Per-domain RED→GREEN: 201 happy path, 404 cross-user, 422 guards (bad money, overpayment, out-of-order valuation, paid-off payment, wrong category kind), 409 duplicate goal, trigger effects (saved/pending/current_value, status flips), net-worth math | `tokio::test` with `DATABASE_URL` skip-guard pattern from existing routes |
| E2E | None (no frontend in scope) | N/A |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. `0003` is final and already applied. Optional additive `0006` (user-scoped history indexes, `CREATE INDEX CONCURRENTLY`) only on measured need during verify.

## Open Questions

- None blocking. Minor: should `DELETE /assets/:id` hard-delete or set `is_archived`? Propose archive-flag (keeps valuation history for charts); tasks will encode it.
