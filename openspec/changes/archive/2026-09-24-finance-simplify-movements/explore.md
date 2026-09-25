# Explore — finance-simplify-movements

- change: `finance-simplify-movements`
- phase: explore
- date: 2026-09-24
- store: hybrid (this file is authoritative; mirrored to Engram `sdd/finance-simplify-movements/explore`, project `personal-dashboard`)
- request language: Spanish (intent preserved; artifact in English per language contract)

## 1. Problem (what the owner asked)

1. Finance keeps only: Accounts, Subscriptions (payment only), Assets & net worth, new Add expense/income block. Delete "Savings: goals & deposits" and "Debts: payments & history" completely (code, routes, menu). Single view with cards/sections, NO tabs. Cards equal in size.
2. Subscriptions: create/edit moves to Settings (name + monthly due date). In Finance each subscription shows amount + "Pay" button → modal picks account → subtracts amount, records a movement with fixed category "Suscripciones", marks "Paid" for that cycle. State auto-resets on next due date (monthly recurring).
3. Categories: remove the `tipo` (kind) field (revert prior decision). One category can hold expenses and income. Update Category chart (two series expense/income when both exist) and Compare-two-categories (expense/income split per category, not net).
4. Bank accounts and categories: keep create/delete from Settings, listed in Finance (unchanged).
5. Add expense/income (new, highest priority): two buttons in Finance, each opens a modal with Amount, Account, Category (no kind restriction), Date, optional Description. Saving reflects in balance. Movement history/list (in Finance or inside each account) with edit/delete. Validate amount/account/category/date required + brief visual confirmation.
6. Resumen: rearrange to reflect changes (no "v2.4 Telemetría", total balance, latest movements, upcoming subscriptions). **If there is a better idea of what to show, surface it as an open product question — do NOT assume. Marked decision-needed-before-spec.**
7. Rules: do not break unmentioned functionality. No new dependencies without asking. No commit/push/deploy.

## 2. Current evidence (verified facts with paths)

### 2.1 Finance page structure — already a single view, no tabs (verified)

- `frontend/app/dashboard/finance/page.tsx` — thin guard + `<FinanceScreensShell />`. No tab router.
- `frontend/components/containers/FinanceScreens.tsx:248` — single `grid grid-cols-12`, four `SectionShell` cards (`finance.accounts`, `finance.subscriptions`, `finance.debts`, `finance.savings`, each `col-span-12 md:col-span-6`), then `CategoryChartSection`, then `S5Sections` (six write sections: `finance.manageSavings`, `finance.manageDebts`, `finance.manageSubs`, `finance.manageAssets`). No tab component anywhere in this file (verified by full read).
- `frontend/components/finance/FinanceSections.tsx:18` — `SectionShell` already has `flex h-full flex-col` + `flex-1` body, so equal-height cards are mostly a grid-span discipline issue, not a new component (prior P2 task in `odd/tasks/resumen-finanzas-config.md` already uniformed spans).
- Nav: `frontend/components/layout/AppShell.tsx:124-137` — primary nav has Resumen / Finanzas / Productividad / Hábitos; settings hub has Ajustes + Tokens. Compare page (`frontend/app/dashboard/finance/compare/page.tsx`) is intentionally NOT in nav (comment `:24-26`, grouped under Finance by URL prefix). Deleting savings/debts therefore means: remove shells + `S5Sections` savings/debts blocks + backend routes + i18n keys, no nav change needed except possibly nothing (savings/debts have no nav entries of their own — verified).

### 2.2 What must be deleted (savings + debts)

Frontend (verified by read):
- `FinanceScreens.tsx:200-201,300-319,359-390` — `useDebts`, `useSavingsGoals`, debts/savings `SectionShell`s, `S5Sections` savings/debts blocks, `SavingsDepositForm/SavingsGoalForm`, `DebtEditForm/DebtPayForm/DebtPaymentHistory/DebtProgressBar` imports.
- `frontend/lib/api/finance.ts:36-76,128-139` — `DebtWire/useDebts`, `SavingsGoalWire/useSavingsGoals`, `patchGoal/createMovement/deleteMovement`, `patchDebt/createPayment/deletePayment/fetchDebtPayments/useDebtPayments`.
- `frontend/lib/finance/finance.ts:110-172` — `toDebtRows`, `SavingsView/toSavingsViews`, `toCategoryTotals(subs, goals, …)` (expenses from subs + savings from goals — the exact function charts depend on; must be rewritten to a movement-based source).
- `frontend/components/finance/SavingsForms.tsx`, `frontend/components/finance/DebtPayments.tsx` — whole modules go.
- i18n `frontend/lib/i18n/es.ts:96-191` — `finance.debts/savings/manageSavings/manageDebts/deposit/withdraw/overWithdrawal/overPayment/creditor/paymentHistory/…` keys.

Backend (verified by read):
- `backend/src/main.rs:87-122` — `/savings-goals` (+`/{id}`, `/{id}/movements`, `/{id}/movements/{mid}`), `/debts` (+`/{id}`, `/{id}/payments`, `/{id}/payments/{pid}`) route blocks.
- `backend/src/routes/mod.rs:4,14` — `pub mod debts; pub mod savings;`.
- `backend/src/routes/savings.rs` — goal CRUD (`create_goal_handler:271`, `list:301`, `get:314`, `delete:330`, `patch:348`) + `create_movement_handler:559`, `delete_movement_handler:582`; append-only `savings_goal_movements` + `update_savings_goal_saved()` trigger (`migrations/0003:33-76`).
- `backend/src/routes/debts.rs` — debt CRUD (`create:289`, `list:321`, `get:334`, `delete:350`, `patch:368`) + payments (`list:477`, `delete:493`, `create:620`); `update_debt_pending()` trigger (`migrations/0003:117-144`).
- DB: `migrations/0003_savings_debts_subs_assets.sql:10-144` owns `savings_goals`, `savings_goal_movements`, `debts`, `debt_payments` + 2 triggers. A removal migration would follow the 0011 precedent (see §2.6).

Resumé/Resumen side effects (verified): `DashboardHome.tsx:157-163` telemetry strip reads `financeDebts` + `financeSavings` (`outstandingDebt`, `totalSavings` via `lib/dashboard/transforms.ts`); widgets `PendingDebts`, `GoalProgress` (`DashboardHome.tsx:243-252,283-292`); `reports`/`progress` i18n blocks reference savings/debts. All must be touched by the Resumen rearrangement — this is why Resumen is decision-gated, not assumed.

### 2.3 Subscriptions today (verified)

- Table `migrations/0003:149-168`: `name, price NUMERIC>=0, currency, frequency subscription_frequency (7 values: daily…annual), next_billing_on DATE NULL, category_id FK, payment_method, url, notes, is_active, cancelled_at`. Indexes on active + next billing.
- API `backend/src/routes/subscriptions.rs`: create validates name/price/frequency/currency/optional date + `ensure_subscription_category` (**kind must be `subscription`**, else 422 — `:285-302`); **`patch_subscription_handler:390` accepts ONLY `{is_active}`** (`validate_subscription_patch:276`, `deny_unknown_fields`); no pay endpoint, no `last_paid_*`, no cycle state. `PATCH_SUB_SQL:68` only flips `is_active/cancelled_at`.
- Frontend `frontend/components/finance/SubscriptionForms.tsx`: `SubscriptionCreateForm` (name, price COP, frequency select of 7, next billing date, category select, payment method, url, notes) + `SubscriptionRow` (cancel/reactivate via `setSubscriptionActive`, delete). Display `toSubscriptionRows` (`finance.ts:95-108`): active only, detail = `next_billing_on`, amount = monthly-equivalent price.
- Consequence: the requested "Pay → debit account + record movement + Paid this cycle + auto-reset" has **no backend primitive today**. It needs either a new endpoint or a client-side orchestration of existing ones (see §3.2).

### 2.4 Categories today — why "remove tipo" is a revert with a backend catch (verified)

- DB `migrations/0001:53-54,105-117`: `category_kind` enum (`finance|habit|goal|task|subscription`), `categories(user_id, kind, name)` unique. No `POST /categories` exists: `main.rs:83-86` wires only `GET /categories`; `categories.rs:1-17` docstring says "only READS". Verified: there is no create/delete category endpoint.
- `GET /categories?kind=` filter with 422 on unknown kind (`categories.rs:89-101`); `kind='finance'` is **intentionally orphaned since S3a** (docstring `:11-13`) — accepted/stored, consumed by nobody after the ledger removal (prior proposal `2026-09-23-simplify-finance-productivity/proposal.md §2.3` fixed this assumption deliberately).
- Frontend per-kind split is the d22a220 fix (see `odd/tasks/cierre-8-puntos.md` T2 + `odd/judgment-ledger-cierre-8pts.md`): `FinanceScreens.tsx:216-235` builds `financeOptions` (`kind=finance`) + `subscriptionOptions` (`kind=subscription`) + union `chartOptions`; backend rejects cross-kind writes with 422 (`ensure_finance_category` in `finance/validation.rs:42-59`, `ensure_subscription_category` in `subscriptions.rs:285-302`).
- Custom categories are **frontend-only localStorage** (`frontend/lib/settings/customCategories.ts:1-77`, key `pd-custom-categories`, `{id, name, kind: gasto|ingreso}`) and — critically — **currently EXCLUDED from Finance selects** (`FinanceScreens.tsx:216-220` comment: IDs unknown to API, persisting them fails 422). The settings copy admits it (`es.ts:718,725`: "todavía no se asignan"). Prior doc `resumen-finanzas-config.md:12-15` planned a merge that d22a220 later reversed for honesty.
- Removing `tipo` therefore means: (a) frontend drops the kind selector + kind badges/filters (easy); (b) backend question — keep the `category_kind` enum + `kind` column (rows exist, UNIQUE includes kind) while ignoring kind in UI, OR migrate kinds away. Prior change explicitly rejected touching the enum ("borrarlo requiere tocar un enum y rompe filas existentes sin beneficio", proposal §2.3). **Recommendation to carry into spec: keep enum/column, stop filtering by kind in UI, and decide what `ensure_subscription_category` becomes** (see open question Q3).
- Charts today: `CategoryCharts.tsx:65-124` (`CategoryChartSection` + `CategoryBars` with `chartExpenses/chartSavings` labels) renders `toCategoryTotals(subs, goals, id)` = monthly-equiv active-sub spend + saved-in-goals. Compare page (`compare/page.tsx:58-59`) renders two `CategoryBars`. Both consume the to-be-deleted savings source — they must be re-pointed at movements (see §3.3).

### 2.5 Accounts, settings, balances (verified, unchanged per request §4)

- `POST /accounts {name, type:"bank"}` + `DELETE /accounts/{id}` exist (`accounts.rs:397,548`); `PATCH /accounts/{id} {balance,…}` is the S3a manual-balance write (`accounts.rs:467-523`, decimal-string wire). `GET` returns card metrics derived from `balance`; `statement_balance` is always `None` (comment `:462-464`).
- Settings hub `ajustes/page.tsx:28-29` = `BankAccountsSection` (create by name + delete + revalidate `finance/*`+`dashboard/*`) + `CustomCategoriesSection` (localStorage CRUD with kind select). Request keeps both, adds subscription create/edit here.
- Physical delete of accounts has no movement guard today (S3a comment `accounts.rs:525`); deleting an account referenced by future movements needs a spec decision (409 vs cascade vs block).

### 2.6 No general movement/expense table exists (verified — the core gap)

- `main.rs:502-602` test asserts `/api/transactions`, `/api/transfers`, `/api/budgets` are **404-gone**; migration `0011_remove_transactions_budgets.sql` dropped `transactions`, `budgets`, `transaction_id` FK columns, balance triggers, and `transaction_type` enum. Surviving movement-like tables are **scoped children only**: `savings_goal_movements` (amount⇄0, trigger updates goal), `debt_payments` (amount>0, trigger updates debt), `asset_valuations` (INSERT-only, `sync_asset_current_value`). None is a general expense/income ledger; none links account↔category↔date in one row.
- Balances today move ONLY via manual `PATCH balance` (`FinanceScreens.tsx:110-126` inline `AccountBalanceEdit` per account). So "saving reflects in balance" currently means one PATCH per account — the new movement feature must define the movement→balance mechanism (see §3.1).

### 2.7 Resumen today (verified — basis for the decision-gated question)

- `DashboardHome.tsx:157-163` strip = 5 KPIs (net worth, account count, monthly sub cost, outstanding debt, total savings). No `v2.4` badge remains (P1 done — verified absent). `overviewSubtitle` still says "Telemetría en vivo…".
- Widgets: Hoy/habits, upcoming-payments, pending-debts, active-subs, pending-tasks, upcoming-events, goal-progress + customize toggles persisted in `user_preferences.dashboard_layout`.
- Net worth source `assets.rs:97 NET_WORTH_SQL`: assets sum minus active-debt pending minus credit-card negative balances, per currency. `GET /net-worth` survives (request keeps Activos y patrimonio).
- Requested Resumen (total balance, latest movements, upcoming subscriptions) maps to: total balance = sum of `accounts.balance` (new aggregate, no endpoint today — client-computable from existing list); latest movements = needs the new movement source; upcoming subscriptions = `next_billing_on` ordering (exists, `idx_subscriptions_user_next`). Anything beyond that is product judgment → §5 Q1.

### 2.8 Prior-work context (read, local-only)

- `odd/tasks/resumen-finanzas-config.md` — P1-P8 rationale (backend-real accounts, localStorage categories because no POST endpoint, chart semantics, compare route without nav, card-form removal).
- `odd/tasks/cierre-8-puntos.md` — DONE at d22a220: 11 dead i18n keys removed, per-kind categories fix, 323 tests green.
- `odd/judgment-ledger-cierre-8pts.md` — APPROVED; known follow-ups: `toCategoryTotals` ignores row currency, compare h1 duplication, tautological card test, empty-state-before-select, stale `customCategories.ts` docstring (still stale — verified `:3-11` claims a merge that d22a220 removed).
- `openspec/changes/2026-09-23-simplify-finance-productivity/` — ledger removal + manual balance + orphaned `kind='finance'` (proposal §2, §10). Direct parent of this change: this change re-introduces a ledger (movements) the parent deliberately removed as a non-goal ("No diseño de un reemplazo de ledger ligero… es change nuevo" §8). That reversal must be recorded in the proposal, same as the parent recorded its `objetivo.md` reversal.
- `openspec/changes/2026-09-23-dependency-security-refresh/` — noted as existing sibling change; not deep-read (no dependency claims made from it). Respected via the no-new-deps rule: charts stay div-bars (`CategoryBars`), modals stay native patterns, no chart/modal library is assumed.

## 3. Approaches compared

### 3.1 Where movement CRUD lives (the highest-stakes decision)

**Option A — Backend-owned `movements` table + REST (recommended).**
Shape (indicative, spec to fix): `movements(id, user_id, account_id FK, category_id FK NULL, direction {expense|income}, amount NUMERIC(18,2)>0, occurred_on DATE, description/notes NULL, subscription_id NULL, created_at/updated_at)`, migration `0012`, routes `GET/POST /movements`, `GET/PATCH/DELETE /movements/{id}`, `user_id`-scoped, `deny_unknown_fields`, decimal-as-string wire, 422 validators mirroring `subscriptions.rs`/`accounts.rs` idioms (rust-best-practices: `Result`/`AppError`, no unwrap outside tests). Balance effect EITHER via trigger (0002-style, precedent exists but parent deliberately killed triggers) OR app-level: `POST /movements` runs in a DB transaction that inserts the row + updates `accounts.balance` (+/− amount); `DELETE`/amount-change reverses/applies delta. Edits to `account_id/amount/direction/date` must be covered by the same transaction logic.
- Pros: single-user truth survives reload/device; consistent with every finance domain except the localStorage compromise; Resumen "latest movements" + charts + compare all read one source; subscription-pay becomes one `POST` (see §3.2); tests live with the backend suite.
- Cons: largest effort (migration + routes + validators + frontend hooks + tests); destructive-delete spec for savings/debts rides in the same change (migration ordering risk, same class as 0011 R1/R2).
- Effort: High.

**Option B — Frontend-local movements (localStorage, customs-style).**
- Pros: no migration, no backend review, fastest to demo; zero data-loss risk to server tables.
- Cons: movements (real money) diverge from backend `accounts.balance` truth; multi-device/export breaks; balance reflection becomes two manual writes (movement + PATCH) with no atomicity; repeats the exact compromise d22a220 already flagged as dishonest for categories; Resumen/backend charts can never read it. Strongly discouraged for anything beyond a throwaway prototype.
- Effort: Low, but inherits integrity debt.

**Option C — No movement entity: manual double-balance-edit (status quo stretched).**
Reuse `PATCH balance` twice (out of one account, conceptually into a category). No history possible → fails requirement §5 (history with edit/delete). Rejected; recorded only to show the status quo cannot satisfy the request.

### 3.2 How subscription paid-state resets monthly (computed vs stored)

**Option A — Computed cycle state, lazy `next_billing_on` advance (recommended).**
Add `last_paid_on DATE NULL` (+ optionally `last_paid_amount`, `last_paid_account_id` for audit) to `subscriptions`. "Paid this cycle" is derived: `last_paid_on` falls in the current billing cycle anchored at `next_billing_on` (monthly). `Pay` endpoint (or client orchestration) debits the account, inserts a movement (`direction=expense`, fixed category "Suscripciones", `subscription_id` set), sets `last_paid_on=today`, advances `next_billing_on += 1 month`. Next cycle the derived flag flips to unpaid with no cron and no background worker (fits static-export + serverless posture; vercel-react guidance avoids server-state timers on the client).
- Pros: no scheduler, idempotent-ish, auditable via movement row; monthly-only scope matches request (frequency column becomes vestigial — see Q2).
- Cons: needs the movement primitive first (§3.1); cycle math edge cases (31st → Feb, timezone America/Bogota) must be spec'd + tested.
- Effort: Medium (given A).

**Option B — Stored `paid_for_cycle YYYY-MM` + cron/reset job.**
- Pros: explicit.
- Cons: needs a scheduler that does not exist in this stack (no cron/worker in `main.rs`; static frontend cannot own it); clock/ownership edge cases; over-engineering for monthly-only. Rejected unless the owner explicitly wants server jobs.

**Option C — Pure client orchestration, no schema change.**
Pay = `PATCH balance` (subtract) + local "paid" flag in localStorage + optional note. Fails cross-device + audit + auto-reset honesty. Rejected except as demo scaffolding.

### 3.3 Where the history list lives

**Option A — Finance-level "Movements" section (recent N + filters), recommended for v1.**
One list in Finance (latest ~20-50, filter by account/category/direction), full CRUD modals. Simplest information architecture, matches "single view with cards", reuses `SectionShell` equal-card pattern, one SWR key (`finance/movements`), one place for the "brief visual confirmation" (toast/inline success — new micro-pattern; keep it CSS-only per tailwind-design-system, no toast lib per no-new-deps).
- Effort: Medium.

**Option B — Per-account drill-down (inside each account card).**
- Pros: answers "where did THIS account's money go".
- Cons: N lists, N queries or one query + client grouping; harder to show cross-account category history; heavier render work (rerender/memo discipline per vercel-react rules).
- Effort: Medium-High.

**Option C — Both (recent in Finance + full per account).**
Best UX long-term, biggest scope. Defer to follow-up; spec v1 as A with per-account filtering as the bridge (clicking an account filters the Finance list).

### 3.4 Category chart + compare after `tipo` removal

Current `toCategoryTotals(subs, goals)` dies with savings/debts. Replacement source is movements grouped by `(category_id, direction)` in range: chart shows two bars (Gastos/Ingresos) when both nonzero, one bar otherwise; compare shows per-category expense/income side-by-side (no netting). Aggregation can be client-side over the movements list response for v1 volumes (personal scale; avoids a stats endpoint), with a `GET /movements/stats/by-category` deferred. Currency caveat carries over (judgment INFO-1: totals ignore row currency — spec must decide: single-currency COP assumption vs per-currency grouping).

### 3.5 Subscription create/edit in Settings (scope check)

Settings gains a subscriptions manager (name + monthly due date per request — plus price, which Finance must display; the request text omits price but Finance "shows amount", so price stays a required field — flag as Q2 clarification, not an assumption). Open sub-decisions: frequency column forced to `monthly` vs kept; category/payment_method/url/notes fields dropped from the form vs kept in API; `PATCH` widened beyond `is_active` (name/date/price edit needs `PatchSubscriptionRequest` + SQL widening — small, mechanical). Deleting a subscription with linked movements: keep movements (audit) with `subscription_id` set NULL vs block — spec call.

## 4. Recommendation

1. **Movements backend-owned (A)** via migration `0012` + REST + transactional balance update. It is the only option that satisfies history/edit/delete + balance reflection + Resumen without integrity debt, and it reverses the parent's explicit non-goal — so the proposal must record the reversal (as the parent recorded its `objetivo.md` reversal).
2. **Subscription pay as movement + lazy `next_billing_on` advance (A)**, monthly scope, fixed "Suscripciones" category seeded per user (seed row vs special-case name — spec call; UNIQUE(user_id,kind,name) constrains seeding).
3. **History in Finance v1 (A)**, per-account filter as bridge; per-account drill-down deferred.
4. **Categories: keep DB enum/column, drop kind from UI**; charts/compare re-pointed at `(category, direction)` movement aggregates; `ensure_subscription_category` fate decided in spec (Q3).
5. **Finance layout**: delete debts/savings shells + S5 savings/debts blocks; keep accounts/subs/assets/net-worth shells; add Add-expense/Add-income buttons + movements shell; keep `CategoryChartSection` shell with new data source; keep `col-span-12 md:col-span-6` discipline for equal cards (already `h-full`).
6. **Resumen: NO changes assumed** — Q1 goes to the owner before spec.

## 5. Open questions (decision-needed-before-spec; do not assume)

- **Q1 (blocking, Resumen): what does Resumen show?** Owner sketch: no telemetry badge (already gone — confirm), total balance, latest movements, upcoming subscriptions. SURFACED alternatives (not assumed): (a) keep 5-KPI strip minus debts/savings + add total-balance + upcoming-subs (minimal churn); (b) goal-progress/habits widgets untouched (they are out of scope — confirm); (c) latest-movements widget depth (5 vs 10) and whether it links to Finance. **Needed before spec: pick (a) vs richer, and define "total balance" (sum of non-archived `accounts.balance` in user currency? per-currency? include/exclude credit cards?).**
- **Q2 (blocking, subscriptions): exact subscription model.** Is `frequency` forced to `monthly` (dropping the 7-value enum from UI, DB column vestigial) or kept? Is `price` editable in Settings (required for Finance amount display)? Do category/payment_method/url/notes survive in API, form, or neither? What does "Pagar" do on double-click/double-pay in the same cycle (block with message vs allow second movement)?
- **Q3 (blocking, categories): kind semantics.** Keep `category_kind` enum + `UNIQUE(user_id,kind,name)` with UI ignoring kind (recommended) vs migrate all to one kind vs drop enum (explicitly rejected by parent — confirm rejection stands)? Does the fixed "Suscripciones" movement category live as a seeded `finance`-kind row, a `subscription`-kind row, or a name convention with no seed? What happens to existing user rows of each kind (visible all together — confirm)?
- **Q4 (blocking, movements): ownership + balance mechanics.** Confirm backend-owned (recommended) vs local. If backend: trigger vs app-level transaction for balance updates? Are movements editable in all fields (account/amount/direction/date/category/description) with delta reversal, or amount/date/description only? Delete = reverse balance (recommended) vs leave balance (audit-only)? What blocks account deletion with movements (409 vs SET NULL vs CASCADE)?
- **Q5 (non-blocking, layout): equal cards + history placement.** Confirm Finance-level history (recommended) vs per-account; confirm Add buttons live as a Finance shell vs floating action vs account-card actions; modal a11y baseline (focus trap? Esc? ≥44px targets — existing convention).
- **Q6 (non-blocking, charts): aggregation scope.** Client-side over list response (recommended v1) vs new stats endpoint; period selector reuse (`toPeriodRange` in `finance.ts:260` exists — confirm reuse for movement filters); currency rule (COP-only assumption vs per-currency split).

## 6. Implementation implications (for spec/tasks, not this phase)

- Backend: migration `0012` (movements table + indexes `idx_movements_user_date`, `(user_id,account_id,date)`, `(user_id,category_id,date)`; consider `last_paid_*` on subscriptions); routes `movements.rs` + `mod.rs` + `main.rs` wiring + wiring tests update (`p9_finanzas_write_routes_are_wired` pattern); validators (`validate_amount>0`, `validate_occurred_on` reuse from `finance/validation.rs`, category-ownership check WITHOUT kind gate per Q3); transactional balance mutation (trigger vs handler — rust-best-practices: `?`, `AppError`, clippy clean); removal migration for `savings_goals*`/`debts*` + triggers (0011 precedent: columns → tables → functions; never rewrite 0002/0003/0005); `PATCH /subscriptions` widening (name/date/price) or new `POST /subscriptions/{id}/pay`.
- Frontend: `lib/api/finance.ts` movement hooks (`useMovements`, `createMovement` general — name-collision with savings `createMovement` must be resolved by rename); `finance.ts` transforms (movement rows, `(category,direction)` totals, balance total); Finance shells (delete 2 + S5 blocks, add expense/income buttons + modals + history shell + subscription Pay button/modal); Settings subscription manager; charts/compare re-point; Resumen rearrangement (gated); i18n churn (remove savings/debts keys, add movement/pay keys — same hygiene as the 11-key cleanup in `cierre-8-puntos.md` T1); tests (MSW per-kind pattern from d22a220 extends to direction).
- DB perf (postgresql skill): B-tree on `(user_id, occurred_on DESC)` covers history + charts at personal scale; partial index `WHERE` unnecessary; no partitioning; `CREATE INDEX CONCURRENTLY` for production backfill (table starts empty — non-issue); `NUMERIC(18,2)` + string-wire invariant preserved.
- Perf/render (vercel-react/next/tailwind skills): parallel SWR reads stay (FinanceScreens pattern); `Promise.all` for independent revalidations; modals via conditional render, no new deps; `content-visibility` for long movement lists; derived paid-state during render (no effect-stored state); equal cards via existing `h-full` + span discipline.
- Docs: proposal records the ledger-reintroduction reversal (parent precedent §10.6 style) + `objetivo.md` finance section update; specs for `finance-movements` (new), `finance-subscriptions`/`finance-accounts`/`finance-categories`/dashboard-widgets/compare edits, savings/debts specs retired.

## 7. Risks

- **R1 — Second destructive migration in a row.** Removing `savings_goals*`/`debts*` repeats the 0011 data-loss class (rows + triggers gone, no dump per standing precedent). Needs the same explicit owner authorization + deploy-gate re-confirmation the parent required (R1 there).
- **R2 — Balance/movement double-write inconsistency.** Movement insert + `accounts.balance` update must be atomic; trigger vs app-transaction is THE correctness fork. A non-atomic client orchestration (PATCH + POST separately) can strand money on retry/failure.
- **R3 — Category-kind revert breaks subscription validation.** Dropping kind from UI while `ensure_subscription_category` still demands `kind='subscription'` recreates the exact 422 surprise d22a220 fixed. Spec must resolve Q3 before any UI ships.
- **R4 — Subscription double-pay / cycle-edge disputes.** Same-cycle double-click, month-end (31→Feb), timezone (America/Bogota vs UTC date) need explicit rules + tests, else "Pagado" lies.
- **R5 — Scope pile-up vs 400-line review budget.** Backend (table+routes+removals) + frontend (shells+modals+charts+settings+resumen) + specs exceeds one review; slice like the parent (S4-first autonomous, removals as delete-only slices, movements split backend/frontend) or escalate `size:exception` explicitly.
- **R6 — Resumen assumed instead of asked.** Any Resumen content beyond the owner's sketch without Q1 sign-off repeats the "restore deleted" failure mode the parent flagged (R10 there).
- **R7 — Fixed "Suscripciones" category collision.** Seeding a name users may already own collides with `UNIQUE(user_id,kind,name)`; a name-convention without seed breaks FK honesty. Spec must pick seed/rename/convention deliberately.
- **R8 — Test/i18n drift.** Savings/debts keys, MSW handlers, `finance.test`/`compare/page.test`/`i18n.test`, e2e `sections.spec` will fail loudly until the removal slice lands with them (parent §10.7 pattern: no test may seed removed tables).

## 8. Verified facts vs assumptions

**Verified (read on disk this session):** single-view Finance with no tabs; SectionShell `h-full`; all §2 file/line claims; no POST/DELETE /categories; PATCH subscription = `{is_active}` only; no movement/pay primitive; no `v2.4` badge; strip = 5 KPIs; 0011 dropped ledger + enum; customs excluded from selects + stale docstring; 7-frequency enum; net-worth SQL; manual PATCH balance; 404-gone transactions/transfers/budgets.
**Assumed (needs spec/owner):** everything in §5 (Resumen content, subscription model, kind fate, movement ownership/mechanics, layout placement, chart aggregation). The dependency-refresh sibling was listed, not deep-read — no claims depend on it.

## 9. Ready for proposal

**No — blocked on Q1-Q4 owner answers first** (Resumen content, subscription model, category-kind fate, movement ownership/mechanics). Q5-Q6 can ride into spec as reviewable assumptions. Once Q1-Q4 are answered, proposal writes itself from §4 + §6, including the explicit ledger-reintroduction reversal note.
