# Proposal: Finance Simplify + Movements (finance-simplify-movements)

- change: `finance-simplify-movements`
- date: 2026-09-24
- store: hybrid (this file is authoritative; mirrored to Engram `sdd/finance-simplify-movements/proposal`, project `personal-dashboard`)
- inputs: `openspec/changes/finance-simplify-movements/explore.md` (verified facts §2, approaches §3), owner binding decisions D1–D4 (answered 2026-09-24), user scope points 1–6
- parent change: `openspec/changes/2026-09-23-simplify-finance-productivity/` (migration 0011; deliberate ledger removal)

## Intent

The Finance page carries four feature groups, two of which the owner never uses (Savings goals/deposits, Debts/payments) while the one workflow that actually matters — recording an expense or income against an account and seeing it reflected in the balance — does not exist at all: there is no general movements table (verified: 0011 dropped it; `/api/transactions` is 404-gone), balances move only by manual `PATCH balance`, subscription "paying" is not modeled (PATCH accepts only `is_active`), and category charts are fed by a proxy (`toCategoryTotals` reads subscriptions + savings goals, which are being deleted). The owner asked for a smaller, honest finance surface: Accounts, Subscriptions (pay-only), Assets & net worth, a new expense/income ledger with history, kind-free categories, a Settings-based subscription manager, and a "minimally useful" Resumen. This change re-introduces a deliberately scoped ledger — a recorded reversal of the parent change's non-goal (see "Reversal" section).

## Scope

### In Scope

1. **Finance single view, reduced** — remove Savings and Debts completely (shells, S5 write-sections, forms modules, API hooks, transforms, backend routes, i18n keys, tests, e2e references). Keep Accounts, Subscriptions, Assets/net-worth, category chart, compare page. No tabs exist today (verified) — keep single `grid-cols-12` with `col-span-12 md:col-span-6` equal-height `SectionShell` cards.
2. **Movements backend (D4)** — new `movements` table (migration `0012`, additive), REST CRUD (`GET/POST /movements`, `GET/PATCH/DELETE /movements/{id}`), user-scoped, decimal-string wire, `deny_unknown_fields`; **app-level DB transaction** (NOT trigger) inserting the row and applying `±amount` to `accounts.balance` atomically; delete reverses the balance; full-field edit with delta reversal; account with movements cannot be deleted (block/409 — shape open for spec).
3. **Add expense/income UI (point 5)** — two Finance buttons → modals (Amount, Account, Category unrestricted, Date, optional Description), required-field validation, CSS-only save confirmation (no toast library), recent-20–50 history list in Finance with account/category/direction filters; clicking an account filters the list (per-account drill-down deferred).
4. **Subscriptions mensual fijo (D2)** — create/edit moves to Settings (name + monthly due date + price); frequency forced monthly in UI (`subscription_frequency` enum stays vestigial in DB); Finance shows amount + **Pay** button → modal picks account → atomic debit + movement with fixed "Suscripciones" category + "Paid this cycle"; double-pay in same cycle BLOCKED with message; cycle state computed lazily via `last_paid_on` + `next_billing_on += 1 month` advance (no cron, no worker).
5. **Categories without kind (D3)** — keep `category_kind` enum, `kind` column and `UNIQUE(user_id,kind,name)`; drop kind selector/badges/filters from all UI; every category row visible together; fixed "Suscripciones" movement category seeded as a `finance`-kind row (collision rule open for spec); backend kind-gate validators (`ensure_finance_category` / `ensure_subscription_category`) stop enforcing kind on writes.
6. **Charts/compare re-point (point 3)** — category chart consumes movements grouped by `(category, direction)`: two series (gasto/ingreso) when both exist, one otherwise; compare shows per-category expense/income side-by-side, no netting.
7. **Resumen mínimo (D1)** — strip: net worth + accounts + monthly sub cost (kept), debts + savings KPIs removed, **total balance** added (sum of `accounts.balance` in user currency); sections: latest 5 movements + upcoming subscriptions; habits widgets untouched; `pending-debts` widget retired; `goal-progress` loses its «Ahorro» segment («Metas» segment is habit-goal data and survives).
8. **Second destructive migration gate (recorded, NOT authorized here)** — migration `0013` (following the 0011 precedent) drops `savings_goals`, `savings_goal_movements`, `debts`, `debt_payments` and their trigger functions, plus the backend routes. It MUST NOT be applied until the owner gives explicit authorization at sdd-apply time, and the deploy gate re-confirms the intentional data loss (no backup/dump per standing decision).
9. **Forced cascade fixes** (unmentioned functionality that reads the removed tables): net-worth SQL (debts leg removed; `debts` wire field becomes credit-card liabilities only), `upcoming-payments` union minus debts, notifications minus `debt` kind, progress-score and reports-screen minus debt/savings inputs, `mcp-dashboard` MUST-keep tool list minus debts/savings tools, `objetivo.md` finance rule update (reversal note).
10. Slice sketch for spec/tasks with 400-line review-budget awareness (auto-chain).

### Out of Scope

- Transfers, budgets, recurring movements, multi-currency ledger semantics (COP assumption carried; aggregation rule is a spec-open item).
- `POST/DELETE /categories` backend endpoints (custom categories remain localStorage; they stay out of movement category selects — same honesty as d22a220).
- Per-account movement drill-down; a `GET /movements/stats` endpoint; MCP tools for movements.
- New dependencies of any kind (charts stay div-bars, modals stay native, confirmation is CSS-only). Flag-only if implementation seems to need one.
- Cron/scheduler infrastructure; credit-card statement cycle revival; habits/productivity/notes changes beyond the removed-table reads in In-Scope 9.
- Any commit, push, or deploy (local only per rules).

## Reversal: re-introducing a ledger (recorded deliberately)

The parent change (`2026-09-23-simplify-finance-productivity`, applied, migration 0011) removed the `transactions` ledger and declared a replacement an explicit non-goal: *"No diseño de un reemplazo de ledger ligero… es change nuevo"* (parent proposal §8). Its `objetivo.md` rewrite (parent §10.6) recorded "an account balance is written by hand" as the governing rule.

This change reverses that non-goal by owner decision D4 (2026-09-24). Why it is justified now: the recorded requirements — editable/deletable expense/income history, balance reflection at save, subscription-pay debit + audit, two-series category charts — cannot be met by manual balance writes, and the 0011 removal left charts fed by a proxy (subscriptions + savings) that this change deletes.

Why this is not a resurrection of the old ledger: one table and one primitive instead of transactions + transfers + budgets + stats endpoints + statement columns + triggers; balance adjustment happens in an app-level DB transaction (D4 explicitly rejects the 0002-style trigger pattern the parent killed); the NUMERIC(18,2) decimal-string wire invariant is preserved; no compatibility views, no dual-read.

Governing-document duty (mirrors parent precedent): `objetivo.md` finance rule "balance is written by hand" MUST be amended in this same change with a dated reversal note — balance is written by manual PATCH (corrections) **and** by the movement transaction — plus the updated charts section. Recorded as a requirement on `finance-core-invariants` during the spec phase.

## Capabilities

> Contract for sdd-spec. New capability gets a full spec; each Modified capability gets a delta. Names verified against `openspec/specs/`.

### New Capabilities

- `finance-movements`: expense/income ledger — table shape, REST contract, transactional balance effect (+/−/delta-reversal), account-delete guard, direction+category aggregation semantics feeding history, charts, compare and Resumen "latest 5".

### Modified Capabilities

- `finance-debts`: **RETIRE** — every requirement removed (reason: owner scope point 1; tables dropped by gated migration 0013).
- `finance-savings`: **RETIRE** — every requirement removed (same reason).
- `finance-accounts`: "Manual Balance As Single Source Of Truth" rewritten — balance remains the stored source of truth and trigger-free, but gains a second sanctioned write path: the movement transaction (insert/delete/edit). "Account Delete Guard Uses Live References Only" rewritten — accounts referenced by movements MUST NOT be deletable (409/block; wording open for spec); old "succeeds with 204 regardless of its debts, savings movements or subscriptions" clause goes with those tables.
- `finance-subscriptions`: monthly-forced model (Settings CRUD with name/due-date/price; `PATCH` widened beyond `is_active` or a `POST /{id}/pay` — spec choice); pay = atomic movement + debit + cycle state (`last_paid_on`, lazy `next_billing_on` advance); double-pay-in-cycle blocked; "Category Scoping" kind gate removed; "Subscription Create Form" moves to Settings; "Payment Method Catalog Stability" loses its debt-payment scenario (Transferencia option stays for subscriptions).
- `finance-assets`: net-worth liabilities leg — active-debts term removed from `NET_WORTH_SQL`; per-currency `debts` field redefined as credit-card liabilities; `GET /net-worth` contract otherwise preserved.
- `finance-core-invariants`: migration discipline extended — 0012 additive (movements, `last_paid_on`), 0013 destructive gated by explicit owner authorization at apply time + deploy re-confirmation (same no-backup posture as 0011); category-kind validators stop gating writes; "no trigger writes balance" scenario restated for the movement transaction path; hermetic-test hygiene (no test may seed removed tables); objetivo.md reversal duty recorded.
- `dashboard-widgets`: `upcoming-payments` union loses its debts member (+ tie-break reword); "Pending Debts List" requirement retired; `goal-progress` loses the «Ahorro» segment («Metas» from `GET /goals` survives; no new widget).
- `frontend-dashboard`: "Telemetry Strip" rewritten per D1 (net worth, accounts, monthly sub cost, total balance; latest-5-movements + upcoming-subs sections); chart inventory updated — movements-based category chart (two series when both directions exist) and the compare view enter the explicit contract; `content-visibility`/equal-card discipline noted.
- `notifications`: `kind=debt` removed from the derivation union and "Vencidas"; tie-break and mute-toggle examples updated.
- `progress-score`: debt + savings-goal inputs removed from `toFinanceScore` composition; surviving inputs renormalized (minimal redefinition, no new product semantics).
- `reports-screen`: outstanding-debt figure removed from the reports aggregation; net worth + subscriptions behavior otherwise unchanged.
- `frontend-i18n`: savings/debts key families removed (same hygiene as the 11-key cleanup in `odd/tasks/cierre-8-puntos.md` T1); new `finance.movement*/pay/subscription-settings` typed keys; debt payment-method scenario retired.
- `mcp-dashboard`: MUST-keep tool list loses `debts` and `savings` tools (removed with their routes); no movements tools added (out of scope).

Unchanged: `finance-accounts` CRUD-in-Settings surface (point 4), `credit-card-summary` (its "Savings" fixture is an account name, not the removed table), `goal-tracking`, habits/productivity specs, `session-auth`, `api_tokens` scopes.

## Approach

Per binding decision, not re-litigated: **D4 backend-safe ledger** (explore §3.1 Option A) — `movements(id, user_id, account_id FK, category_id FK NULL, direction {expense|income}, amount NUMERIC(18,2) > 0, occurred_on DATE, description NULL, subscription_id NULL, created_at/updated_at)` + indexes `(user_id, occurred_on DESC)`, `(user_id, account_id)`, `(user_id, category_id)` (postgresql skill: B-tree composite covers history + chart scans at personal scale; no partial indexes, no partitioning; table starts empty). Balance effect in one SQL transaction: insert row → `UPDATE accounts SET balance = balance ± :amt WHERE id = :acc` (row lock serializes same-account writes); PATCH computes old/new deltas and reverses-then-applies; DELETE applies the inverse. Single round-trip means the frontend never orchestrates a double write (R2 eliminated). **D2 computed cycle state** (explore §3.2 Option A): "Paid this cycle" derived from `last_paid_on` within the cycle anchored at `next_billing_on`; Pay advances lazily; monthly-only makes `frequency` vestigial (kept in DB). **D3 hide-don't-migrate** for kinds (explore §4.4 recommendation): DB untouched, UI unified, cross-kind 422s dropped, "Suscripciones" seeded as finance-kind row (idempotent upsert by `(user_id, 'finance', 'Suscripciones')`, collision rule to spec). **D1 strip** is client-computed from existing reads (total balance = reduce of `accounts.balance` in user currency — no new aggregate endpoint) plus the movements list. Charts are client-side aggregates over the movements response for v1 (aggregation scope is a spec-open item). No new dependencies anywhere in this approach; if implementation needs one, STOP and flag per rules.

## Slice sketch (for spec/tasks; review budget 400 changed lines, auto-chain)

| Slice | Content | Depends | Budget note |
|---|---|---|---|
| **S-A** BE movements core | 0012 (additive: `movements`, indexes, `subscriptions.last_paid_on`), `routes/movements.rs`, validators, transactional balance, wiring + backend tests | — | one concern; target ≤400 |
| **S-B** BE subscriptions v2 | PATCH widening and/or `POST /{id}/pay` (atomic movement + advance + double-pay block), "Suscripciones" seed, tests | S-A | small–medium |
| **S-C** FE movements | `lib/api/finance.ts` movement hooks (rename resolves the dead `createMovement` collision with savings), Add-expense/income buttons + modals + validation + CSS confirmation, history shell + filters + account-click filter | S-A | split modals vs list if >400 |
| **S-D** FE subscriptions + Settings | Settings subscription manager (name/due/price), Pay button + account-pick modal + "Pagado este ciclo", row display | S-B, S-C | medium |
| **S-E** FE categories/charts | kind UI removal (selects/badges/Settings custom kinds — localStorage schema version bump), chart two-series from movements, compare re-point | S-A, S-C | medium |
| **S-F** FE removals (delete-only) | debts/savings shells, S5 blocks, `SavingsForms.tsx`/`DebtPayments.tsx`, hooks, `toCategoryTotals`/`toDebtRows`/`toSavingsViews`, i18n keys, MSW/e2e references | — | line count may exceed 400; cognitive load is "any reference left?"; escalate `size:exception` explicitly, never self-accept (parent rule) |
| **S-H** Resumen D1 rework | strip rewrite, latest-5 movements + upcoming-subs sections, widget retirements (`pending-debts`, goal-progress Ahorro segment), notifications/score/reports cascade | S-A, S-C | merge **before** S-G |
| **S-G** BE destructive removal **(GATED)** | 0013 (columns → tables → trigger functions per 0011 order), route deletions, net-worth SQL, MCP list, spec retirements | S-F, S-H | **requires explicit owner authorization at apply time** |

Merge order: `S-A → S-B → S-C → S-D → S-E → S-H → S-F → S-G`. Deploy/chain invariants: (1) movements endpoints and balance mechanics land together (S-A is atomic by construction); (2) no UI reads a removed route at any point — all FE removal/cascade slices merge before S-G; (3) S-G is the point of no return and the only gated slice. S-F is independent of the BE chain and can land anytime before S-G.

## Affected areas

| Area | Impact | Description |
|---|---|---|
| `backend/migrations/0012_movements.sql` | New | movements table + indexes + `last_paid_on` (additive only) |
| `backend/migrations/0013_remove_savings_debts.sql` | New (gated) | drop `savings_goals`, `savings_goal_movements`, `debts`, `debt_payments`, `update_savings_goal_saved()`, `update_debt_pending()`; never edit 0002/0003/0011 |
| `backend/src/routes/movements.rs` | New | CRUD + transactional balance; `finance/validation.rs` reuse without kind gate |
| `backend/src/routes/{savings,debts}.rs`, `routes/mod.rs`, `main.rs` | Modified/Removed | savings/debts blocks gone; movements wired; wiring tests updated |
| `backend/src/routes/subscriptions.rs` | Modified | widened PATCH and/or pay endpoint; kind gate removed; seed |
| `backend/src/routes/accounts.rs` | Modified | delete guard blocks accounts with movements |
| `backend/src/routes/assets.rs` | Modified | `NET_WORTH_SQL` debts leg removed |
| `frontend/components/containers/FinanceScreens.tsx` | Modified | shells removed/added; single grid preserved |
| `frontend/components/finance/{SavingsForms.tsx,DebtPayments.tsx}` | Removed | whole modules |
| `frontend/components/finance/{SubscriptionForms.tsx,CategoryCharts.tsx,FinanceSections.tsx}` | Modified | Settings form migration, pay row, chart re-point |
| `frontend/app/dashboard/finance/compare/page.tsx` | Modified | expense/income split |
| `frontend/app/dashboard/page.tsx` (`DashboardHome.tsx`) + `lib/dashboard/transforms.ts` | Modified | D1 strip + widgets per In-Scope 7 |
| `frontend/app/dashboard/ajustes/page.tsx` | Modified | subscription manager section |
| `frontend/lib/api/finance.ts` + `lib/finance/finance.ts` | Modified | movement hooks/wire, removals, new transforms |
| `frontend/lib/settings/customCategories.ts` | Modified | localStorage v2 (kind dropped, schema versioned); stale docstring fixed |
| `frontend/lib/i18n/es.ts` | Modified | key removals + movement/pay/settings-sub keys |
| `mcp-dashboard/` (tools, README) | Modified | debts/savings tools removed from MUST-keep set |
| `objetivo.md` | Modified | finance-rule reversal note (dated, same-section discipline) |
| `openspec/specs/*` | Modified at archive | per Capabilities contract |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| R1 — Second destructive migration (0013) destroys data with no backup | Certain if applied | Hard gate: explicit owner authorization at apply time + deploy-gate re-confirmation (0011 precedent); S-G merges last; all reversible slices land before it |
| R2 — Balance/movement inconsistency (money stranded) | Low | App-level single transaction (D4); never client-orchestrated PATCH+POST; backend tests for insert/delete/edit-reversal and failure rollback |
| R3 — Kind revert re-creates d22a220's 422 surprise | Med | Spec lands validators-down and UI-down in one capability delta; MSW direction-based tests replace kind-based ones |
| R4 — Cycle math (31st→Feb, America/Bogota date boundary, double-pay) | Med | Explicit derived-state rules + edge tests in S-B; blocked double-pay with Spanish message (D2) |
| R5 — Scope pile-up vs 400-line budget | High | Slice sketch above; chained PRs per strategy auto-chain; delete-only slices justified by cognitive-load argument; `size:exception` escalated, never inferred |
| R6 — 14 capability deltas drift out of sync with code | Med | Capabilities table names exact spec files + requirement headings; verify-report checks "no live reference to removed names" (core-invariants pattern) |
| R7 — "Suscripciones" seed collides with user-owned name | Med | Idempotent upsert on `UNIQUE(user_id,'finance','Suscripciones')`; collision rule (reuse vs suffix) decided in spec as open item |
| R8 — Cascade specs (score/reports/notifications/net-worth) quietly change semantics | Med | Each gets an explicit named delta above; minimal redefinition only — no invented replacement figures |
| R9 — Test/i18n churn breaks suites until removal slice lands | Low | Slices keep each merge green (removal sequencing invariant, core-invariants pattern) |

## Rollback Plan

Local-only delivery (no commit/push/deploy per rules) makes git-revert the primary tool, and the chain order exists so every slice is revertible until S-G:

- **S-A…S-E, S-H, S-F (pre-gate):** revert the slice's commits; 0012 is additive and revertible by dropping `movements` + `last_paid_on` via a fresh follow-up migration or by discarding local-DB state (dev DB only, no prod apply authorized). Removed FE code returns with the revert; the parent tables still exist until S-G, so nothing is unrecoverable.
- **S-G (post-0013): NO rollback of data.** Dropped savings/debt rows are gone by design (standing no-backup decision, same as 0011). Reverting S-G restores code and schema shape but not rows — which is exactly why the gate (explicit owner authorization at apply time + deploy re-confirmation) precedes it and why every other slice must merge and be verified first.
- Per-slice verification before chaining: `cargo test` (backend), `pnpm test` + `tsc --noEmit` (frontend), `pnpm build` static export; full-suite + visual Playwright sweep (3 viewports, 0 console errors) after the chain, following the `odd/tasks/resumen-finanzas-config.md` evidence pattern.

## Dependencies

- None to install. **No-new-deps rule**: if any slice needs a package (toast, modal, chart library, date lib), flag and stop — do not install. Existing stack suffices (native dialogs, div bars, Intl, SWR, sqlx transactions).
- Prerequisites: 0011 applied state (verified parent), Engram/openspec hybrid persistence, owner gate for S-G.
- Related sibling `2026-09-23-dependency-security-refresh` untouched; respected only via the no-new-deps rule.

## Open items carried to spec (non-blocking; owner input not needed now)

1. **Layout placement** — exact position of the Add-expense/income shell and Pay affordance within the 12-col grid; modal a11y baseline (Esc, focus return, ≥44px targets per existing convention).
2. **Aggregation scope/currency** — client-side over the list response vs endpoint (v1 recommendation: client-side); COP-only vs per-currency grouping for totals/charts (existing `toCategoryTotals` currency bug must not be cloned).
3. **Account-delete 409 shape** — status + Spanish message + i18n key; block is decided (D4), response wording is not.
4. **Seed-collision rule** — reuse existing user row vs suffixed auto-name vs error; must respect `UNIQUE(user_id,kind,name)`.
5. **PATCH widening vs `POST /subscriptions/{id}/pay`** — one widened endpoint or CRUD-PATCH + dedicated pay (recommendation from explore: dedicated pay action keeps the movement transaction honest).
6. **Net-worth `debts` field semantics** — keep field as card-only liabilities (recommended, wire-compatible) vs rename; reports/score consumers must agree.
7. **Resumen "total balance" currency rule** — user-currency sum of `accounts.balance` (D1 wording); per-currency accounts handling decided in spec alongside item 2.

## Success Criteria

- [ ] Finance renders Accounts, Subscriptions (amount + Pay), Assets/net-worth, Add expense/income, movements history, category chart — single view, no tabs, equal-size cards; zero references to savings/debts in code, routes, menu, i18n, tests, e2e.
- [ ] Recording an expense/income changes the account balance in one atomic backend transaction and survives reload; edit reverses+reapplies; delete reverses; invalid/foreign inputs yield Spanish 422/404 never 500.
- [ ] Subscription create/edit works from Settings (name, monthly due, price); Pay debits the chosen account once per cycle, marks "Pagado este ciclo", blocks same-cycle second pay with a message, and resets lazily next cycle without any scheduler.
- [ ] Category UI shows all rows without kind; chart renders gasto+ingreso two-series when both exist (single series otherwise); compare shows the split without netting.
- [ ] Resumen = strip (net worth, accounts, monthly sub cost, total balance) + latest 5 movements + upcoming subs; habits widgets untouched.
- [ ] An account with movements cannot be deleted (409/block per spec shape).
- [ ] Migration 0013 exists in the change folder but is NOT applied: owner authorization for it is requested and recorded at apply time; deploy gate re-confirms data loss before any production apply.
- [ ] `cargo test`, `pnpm test`, `tsc --noEmit`, `pnpm build` green at every chain link; zero new dependencies; no commit/push/deploy performed.
- [ ] `objetivo.md` carries the dated ledger-reintroduction reversal note; all Capabilities deltas above land at archive with the spec phase.
