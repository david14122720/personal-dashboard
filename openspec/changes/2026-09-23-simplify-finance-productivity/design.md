# Design — 2026-09-23-simplify-finance-productivity

- change: `2026-09-23-simplify-finance-productivity`
- phase: design
- date: 2026-09-23
- preflight: `execution: auto` · `artifact_store: openspec` · `review_budget: 400` · `chain_strategy: deferred`
- delivery strategy note: the preflight header says `auto-chain` while the injected session context says `ask-on-risk`. **Both agree that S1–S3 cannot fit in one 400-line review.** This design plans the chain as mandatory and leaves only one open question to the parent: whether the harness pauses for confirmation before opening S1 (the first >400 slice). See §12.
- status: `ready_for_tasks` — the four open questions from the spec (`next_recommended`) are resolved with file-level evidence in §2; three additional design decisions the specs left implicit are resolved in §3.

## Inputs read

`proposal.md`, `explore.md`, all 17 spec files under `specs/`, `openspec/config.yaml`, plus direct code/migration inspection: `backend/migrations/0001,0002,0003,0005,0008`, `backend/src/main.rs`, `backend/src/routes/{accounts,debts,savings,categories,subscriptions}.rs`, `backend/src/finance/{mod,money}.rs`, `backend/tests/migration_0005_transfer_trigger.rs`, `backend/tests/migration_0008_credit_cards.rs`, `frontend/components/containers/{DashboardHome,FinanceScreens,ReportsScreens,ProgressScreens,ProductivityScreens}.tsx`, `frontend/components/{finance,productivity,ui}/*`, `frontend/lib/{api,finance,dashboard,productivity,i18n}/*`, `frontend/e2e/*`, `frontend/playwright.config.ts`, `mcp-dashboard/src/tools.ts`, `objetivo.md`.

---

## 1. Executive summary

The design is **deletion-first and sequencing-driven**. Track A removes three modules whose only true coupling is the balance trigger and two inbound FK columns; the replacement (manual balance) is a small additive change to an existing handler. Track B is pure layout/state and ships first, alone.

Four load-bearing conclusions drive everything:

1. **The account delete guard disappears entirely.** Enumerating every `accounts(id)` reference in the migrations shows exactly three: `transactions.account_id ON DELETE RESTRICT` (dropped by 0011), `transactions.credit_card_account_id ON DELETE SET NULL` (dropped), and `assets.account_id ON DELETE SET NULL` (survives, non-blocking). No surviving table references `accounts` at all — debts, savings and subscriptions carry only `user_id`/`category_id`. So the guard is retired, not rewritten, and the `23503→409` mapping stays as dead-man's switch.
2. **`DROP TYPE transaction_type` is expected to succeed, and the migration must not depend on that.** The enum is referenced in exactly two migration lines: `0001:21` (create) and `0002:47` (`transactions.type`). After the table drop there is no dependent. Because the migration runs out-of-band with autocommit, the drop is wrapped in a `DO` block that catches `dependent_objects_still_exist` and leaves the type orphaned — the accepted fallback, decided inside the migration instead of by a human at deploy time.
3. **The home needs a real rewrite, not just a strip edit.** `DashboardHome` renders the flow-driven widgets, a 4-card `MetricCard` row (`month-balance`, `savings-rate`) *and* the strip. Removing only the strip items leaves two dead cards and four empty `WidgetShell`s, which the specs forbid ("no permanent empty artefact"). The design deletes the dead metric row and re-points the strip to five live sources.
4. **`objetivo.md` needs a third edit the spec did not enumerate.** Besides "Transferencias" and "Presupuestos" (lines 125–152) and the charts list, `objetivo.md` also mandates an "Análisis financiero" block (tasa de ahorro, promedio de gastos, variación mes anterior) that is 100% fed by the removed aggregates. Leaving it recreates exactly the R10 failure the proposal warns about. §3/D8 resolves it as part of the same "charts and indicators" edit and flags the one-line spec amendment to the parent.

---

## 2. Resolution of the four open questions

### D1 — `AnalysisSection`: full deletion, not a reduced edition

**Decision: delete the component, its test, its `toInsights` transform, its insight types and the whole `analysis.*` key family.**

Evidence: `AnalysisSectionProps` is `{ flow, byCatExpense, byCatIncome, budgets, descriptions?, locale?, currency? }` (`frontend/components/finance/AnalysisSection.tsx:13-21`). Every one of the five inputs comes from a removed source: `flow` ← `useMonthlyFlow`, `byCatExpense`/`byCatIncome` ← `useSpendByCategory`, `budgets` ← `useBudgets`, `descriptions` ← ledger rows. There is no surviving input to build a "reduced edition" from, and a component whose only honest render is the `EmptyState` branch is precisely the "perpetual empty block" the specs forbid.

What is *not* lost: the fixed non-advisor disclaimer. It already exists as `progress.score.disclaimer` (`es.ts:781`, asserted by `ProgressScreens.test.tsx:80,166`), and `progress-score` keeps its own requirement for it. `FinanceScreens`'s `SectionShell title={t("analysis.title")}` wrapper (`FinanceScreens.tsx:273`) goes with the component.

Deletion set: `components/finance/AnalysisSection.tsx`, `components/finance/AnalysisSection.test.tsx`, `lib/finance/finance.ts` → `toInsights`, `Insight`, `InsightsInput`, `MomDirection`, `BudgetInsightLike`; the `analysis.*` keys; and the `AnalysisSection`/`analysis.*` assertions in `components/finance/jd-round1.test.tsx` and `lib/i18n/i18n.test.ts:109-118`.

Rejected alternatives: (i) "reduced edition with surviving metrics only" — the surviving metrics would be net worth/debt/savings, which already have dedicated blocks in the same screen and in reports, so it would duplicate; (ii) keep the component unmounted — dead code with live i18n keys, forbidden by `frontend-i18n`'s key hygiene.

### D2 — Account delete guard: retire it; keep the `23503` mapping

**Decision: delete `ACCOUNT_MOVEMENT_COUNT_SQL` and the pre-check; keep `map_account_delete_err` (23503→409, Spanish message).**

Enumerated `accounts(id)` references (all migrations, `grep REFERENCES|ON DELETE`):

| Migration | Column | Action | After 0011 |
|---|---|---|---|
| `0002:46` | `transactions.account_id` | `ON DELETE RESTRICT` | table dropped |
| `0002:59` | `transactions.credit_card_account_id` | `ON DELETE SET NULL` | table dropped |
| `0003:181` | `assets.account_id` | `ON DELETE SET NULL` | **survives, non-blocking** |

No surviving table holds a blocking reference. `debts`, `debt_payments`, `savings_goals`, `savings_goal_movements`, `subscriptions` reference only `users(id)` and `categories(id)` — none has an `account_id`. So the spec's scenario ("deleting an owned account MUST succeed with 204 regardless of its debts, savings movements or subscriptions") is not a trade-off: there is no FK to evaluate.

New `delete_account_handler` shape: `require_user_id` → ownership probe (`ACCOUNT_OWNERSHIP_CHECK_SQL`) → 404 if absent → `DELETE_ACCOUNT_SQL` → 204. `map_account_delete_err` keeps the `23503 → AppError::Conflict("account has movements and cannot be deleted")` branch (unchanged behaviour for an unforeseen future `RESTRICT`; the message stays Spanish-compatible), which satisfies the spec's "Blocking constraint still maps to 409".

Tests to rewrite in `accounts.rs` `mod tests`:
- `delete_account_with_movements_is_409` → `delete_account_with_live_finance_rows_is_204`: seed account + debt + savings goal + subscription for the same user, assert 204 and the row is gone.
- the SQL-shape test asserting `ACCOUNT_MOVEMENT_COUNT_SQL.contains("credit_card_account_id")` (`accounts.rs:791`) is deleted with the constant; add `account_delete_sql_never_references_removed_tables` asserting `DELETE_ACCOUNT_SQL`/`ACCOUNT_OWNERSHIP_CHECK_SQL` contain no `transactions`/`budgets` token (spec scenario "No removed-table query").
- keep the existing 404-for-foreign-id integration test unchanged.

### D3 — `DROP TYPE transaction_type`: attempt with an in-migration fallback

**Decision: `DROP TYPE transaction_type` inside a `DO` block that catches `dependent_objects_still_exist` (SQLSTATE 2BP01) and continues with a `RAISE NOTICE`. Never `CASCADE`, never `CREATE TYPE` + reconversion.**

Dependency evidence: the string `transaction_type` appears in migrations only at `0001:21` (`CREATE TYPE`) and `0002:47` (`type transaction_type NOT NULL`), plus a comment in `0002:3`. No function, cast, view or other column uses it. Therefore, after `DROP TABLE transactions`, the type is unreferenced and the drop is expected to succeed.

Why the guard is still required: the migration runs out-of-band with autocommit (no `_sqlx_migrations`), against a database whose catalog we cannot fully prove from the repo (hand-created objects, views, ad-hoc casts). A failing `DROP TYPE` at deploy time would abort the migration *after* the destructive table drops, leaving a half-applied file and a human firefight. The `DO` block makes the fallback deterministic and reviewable: either the type is gone or it is provably harmless (no column of that type exists).

`CASCADE` is explicitly rejected: it would silently drop an unforeseen dependent (e.g. a view or a column) — the opposite of this change's "explicit inventory" discipline. `CREATE TYPE` + reconversion is rejected by the spec and by the proposal (the `transfer` value cannot be removed with `ALTER TYPE DROP VALUE`).

Migration-test assertions (tolerant of both outcomes, per the spec edge case):
1. zero columns in `pg_attribute` joined to `pg_type` with `typname='transaction_type'` (and `NOT attisdropped`);
2. if `to_regtype('transaction_type') IS NOT NULL`, then `pg_depend` has no entry whose `refobjid` is that type's OID;
3. `to_regtype('transaction_type') IS NULL` is asserted **only** as a soft check (recorded in the test output, not as a hard failure).

### D4 — Exact i18n inventory

**Decision: delete by *consumer-orphanhood*, not by keyword.** The rule: a key is deleted iff every non-dictionary reference to it lives in a file this change deletes or rewrites. `finance.paymentTransfer` survives by explicit exception. This is the only safe rule here because the word "transferencia" appears in a surviving payment-method catalog.

**KEEP (verified, non-negotiable):**

| Key(s) | Surviving consumer |
|---|---|
| `finance.paymentTransfer` | `SubscriptionForms.tsx:83`, `DebtPayments.tsx:62` (payment method "Transferencia") |
| `finance.paymentMethod`, `finance.selectPaymentMethod`, `finance.paymentCash`, `finance.paymentDebit`, `finance.paymentCard`, `finance.paymentOther` | `SubscriptionForms`, `DebtPayments` |
| `finance.amountCop`, `finance.amountPlaceholder`, `finance.amountPositiveError`, `finance.requiredFieldError`, `finance.saveFailed`, `finance.deleteFailed`, `finance.saving`, `finance.dateLabel`, `finance.description` | CardForm, AssetForms, SubscriptionForms, DebtPayments, SavingsForms |
| `finance.goalName`, `finance.cardLimit`, `finance.statementDay`, `finance.paymentDueDay`, `finance.createCard`, `finance.limitChangeHint`, `finance.cardLimitDetail`, `finance.cardAlert` | CardForm / CardDetail (survive; `limitChangeHint` copy is rewritten to drop the "el historial no se reescribe" clause) |
| `charts.periodLabel`, `charts.periodWeek`, `charts.periodMonth`, `charts.periodQuarter`, `charts.periodYear`, `charts.periodCustom`, `charts.periodFrom`, `charts.periodTo`, `charts.periodInvalidRange` | `PeriodSelector.tsx:30-79` — **survives for `/reportes`** (the finance-screen instance dies, the component does not) |
| `progress.*` (all), `reports.*` (except the flow-specific keys below), `productivity.*` (except new keys) | surviving screens |

**DELETE by slice** (families; the task must still run the orphan sweep of §9 before deleting each one):

- **S1 (transfers):** `finance.transfersTitle`, `transfersSubtitle`, `transfersRegion`, `showingTransfers`, `noTransfers`, `noTransfersHint`, `loadingTransfers`, `transfersLoadFailed`, `transfersLoadFailedHint`, `transferDirection`, `newTransfer`, `saveTransfer`, `transferSaved`, `sameAccountError`, `fromAccount`, `toAccount`.
- **S2 (budgets):** `finance.budgets`, `budgetsHint`, `noBudgets`, `noBudgetsHint`, `manageBudgets`, `confirmDeleteBudget`, `budgetRemaining`, `spentDetail`, `budgetSpendLabel`, `warnThreshold`, `overThreshold`; `dashboard.budgets`, `dashboard.noBudgets`, `dashboard.onTrack`, `dashboard.budgetsHint`, `dashboard.loadingBudgets`, `dashboard.noBudgetsData`, `dashboard.noBudgetsHint`.
- **S3 (transactions/flow/analysis):** `finance.ledgerTitle`, `ledgerSubtitle`, `ledgerRegion`, `showingCount`, `loadMore`, `loadMoreFailed`, `noTransactions`, `noTransactionsHint`, `ledgerFilters`, `loadingTransactions`, `ledgerLoadFailed`, `ledgerLoadFailedHint`, `txType`, `allTypes`, `income`, `expense`, `allAccounts`, `allCategories`, `date`, `amount`, `from`, `to`, `apply`, `clear`, `captureTitle`, `captureSubtitle`, `captureRegion`, `newIncome`, `newExpense`, `saveIncome`, `saveExpense`, `captureSaved`, `captureFailed`, `descriptionOptional`, `descriptionPlaceholder`, `statementBalance`; `dashboard.monthBalance`, `savingsRate`, `longestStreak`, `streakDays`, `monthlyFlow`, `monthlyFlowHint`, `spendByCategory`, `spendByCategoryHint`, `loadingFlow`, `loadingCategory`, `noFlowData`, `noFlowHint`, `noCategoryData`, `noCategoryHint`, `monthIncome`, `monthExpense`, `monthSavings`, `monthSavingsHint`; `charts.balance`, `balanceHint`, `savings`, `savingsHint`, `monthlyExpenses`, `monthlyExpensesHint`, `monthCompare`, `monthCompareHint`, `incomeSource`, `incomeSourceHint`; the entire `analysis.*` family (14 keys).
- **S3 copy rewrites (not deletions):** `finance.subtitle` (drop "Libro mayor, presupuestos"), `dashboard.overviewSubtitle` (drop "presupuestos"), `dashboard.telemetryStrip`/`telemetryStatus` stay as-is.

**ADD:**
- `productivity.newEntry: "Nuevo"` — the per-section toggle label (spec requires the literal «Nuevo»).
- `productivity.newEntryLabel: "Nuevo en {section}"` — accessible name (`aria-label`) composed from the existing typed `productivity.goals/tasks/events/notes` keys, so the toggle is distinguishable per section without hardcoded copy.
- `reports.financeCurrent: "Valor actual"` and `progress.financeHint` copy rewrite — the finance blocks are now current snapshots, not period-windowed (see §6.4).
- `finance.balanceEdit: "Editar saldo"`, `finance.balanceEditLabel: "Editar saldo de {name}"`, `finance.balanceConfirm: "Guardar saldo"`, `finance.balanceCancel: "Cancelar"`, `finance.balanceInvalid: "Escribe un monto válido con máximo 2 decimales."`, `finance.balanceSaved: "Saldo actualizado."` — the inline balance edit needs typed copy (spec: no hardcoded strings). Existing `finance.save`/`cancel`/`amountCop` may be reused instead; the task SHOULD reuse and only add what is missing.

**Enforcement (this is the design's contract, not a suggestion):** after each slice, for every candidate key run
`grep -rF "<key>" frontend --include='*.ts' --include='*.tsx' -l` and require the result set ⊆ {`lib/i18n/es.ts`, `lib/i18n/i18n.test.ts`} ∪ deleted files. Then `pnpm tsc --noEmit` (the typed dictionary makes a missing-but-referenced key a build error, per `frontend-i18n`).

---

## 3. Additional design decisions the specs left implicit

### D5 — The home's 4-card metric row is deleted

`DashboardHome.tsx:283-310` renders `MetricCard`s for net worth, **month balance**, habits today and **savings rate**. Two of the four are flow-derived and have no surviving source; the spec's "Finance Screen Source Integrity" forbids rendering them, and "no permanent empty artefact" forbids leaving them greyed. The row is deleted whole rather than partially re-pointed, because:
- net worth is already KPI #1 of the strip and habits-today already has the `dashboard.today` widget;
- keeping 2 of 4 cards leaves a half-empty `lg:grid-cols-4` band (dead space, the exact defect Track B is fixing elsewhere).

Resulting home composition: header → **5-KPI strip** → widget grid (6 surviving widgets + customize panel). No other layout change.

### D6 — Strip sources, and the widget-fetch invariant

| KPI | Source hook | Wire key |
|---|---|---|
| Patrimonio | `useNetWorth()` | `dashboard/net-worth` |
| Cuentas | `useAccounts()` → `length` (endpoint excludes archived: `LIST_ACCOUNTS_SQL` has `AND NOT is_archived`) | `dashboard/accounts` |
| Suscripciones | `useSubscriptions()` + new pure `toMonthlyCost` | `finance/subscriptions` |
| Deudas | `useDebts()` + `toPendingDebts`-style sum of `pending_amount` | `finance/debts` |
| Ahorros | `useSavingsGoals()` + sum of `saved_amount` | `finance/savings-goals` |

The strip uses the `finance/*` hooks, **not** the widgets' conditional `dashboard/*` keys. This is deliberate: `dashboard-widgets` requires that a hidden widget triggers no fetch, and widget keys are `null` when hidden (`debtsKey(v)`, `subscriptionsKey(v)`, `savingsGoalsKey(v)`). Pointing the strip at those keys would make the fetch unconditional and quietly break that requirement. Cost: one extra GET per collection, cached with `revalidateOnFocus: false`. Accepted.

The `cards` LED (`dashboard.cards`, `worstAlertLevel`) is removed from the strip: the spec requires *exactly five* KPIs. The card alert indicator that "MAY remain" is the one already rendered inside the accounts list (`FinanceSections.tsx:124-133` via `alertLevel`), which keeps the 1:1 enum mapping. `worstAlertLevel` therefore loses its only consumer and is deleted with `worstBudgetStatus`.

`longestStreak` is deleted from `lib/dashboard/transforms.ts` **only after** the orphan sweep confirms no surviving consumer (habits dashboard may use it); if the habits screen consumes it, it stays and only the `dashboard.longestStreak`/`streakDays` keys go.

### D7 — New pure transforms (all in `lib/dashboard/transforms.ts`, all unit-tested)

```ts
// Monthly-equivalent cost of active subscriptions. Frequency catalog mirrors
// backend SUBSCRIPTION_FREQUENCIES (subscriptions.rs:44-52).
// daily×30, weekly×52/12, biweekly×26/12, monthly×1, quarterly÷3,
// semiannual÷6, annual÷12. Inactive subs excluded. Unknown frequency → excluded
// (never a silent 1× assumption). Empty/undefined → 0.
export function toMonthlyCost(subs: Array<{ price?: string|number|null; frequency?: string|null; is_active?: boolean|null }> | null | undefined): number;

// Outstanding debt = sum of pending_amount over debts whose status is active-ish.
// Reuses the existing status filter semantics of toPendingDebts.
export function toOutstandingDebt(debts: DebtWireLike[] | null | undefined): number;

// Total savings = sum of saved_amount (falls back to saved) over non-completed goals.
export function toTotalSavings(goals: SavingsGoalLike[] | null | undefined): number;

// Reports finance snapshot: three current values, no period window.
export function toFinanceSnapshot(input: { netWorth: number; monthlySubsCost: number; outstandingDebt: number }): { netWorth: number; monthlySubsCost: number; outstandingDebt: number };

// Progress finance score from surviving inputs only. Documented formula:
// share of the positive position not owed: 100*(netWorth+savings)/(netWorth+savings+debt),
// clamped 0..100. All three inputs zero → null ("sin datos"), never a fabricated score.
export function toFinanceScore(input: { netWorth: number; savings: number; debt: number }): number | null;
```

`scoreByArea` is **not** modified: it already normalizes/clamps and its `AreaScoreInput` accepts `number | null`. Only `ProgressScreens`'s computation of the `finance` argument changes.

### D8 — `objetivo.md`: three edits, one spec amendment

The spec (`finance-core-invariants` → "Governing Document Reversal Recorded") mandates replacing the "Transferencias" and "Presupuestos" sections and updating the financial-charts section, with "No other part of the document MAY change".

Finding: `objetivo.md` also contains an **"Análisis financiero"** section (tasa de ahorro, promedio de gastos/ingresos, categoría donde más gasto, variación mes anterior, gastos recurrentes/extraordinarios, mes con mayor gasto/ahorro) — every item is fed by the removed aggregates. If it is left untouched, the same R10 failure the proposal guards against returns: the next agent reads a mandate for deleted features.

**Decision:** treat the charts list and the analysis-indicators block as one edit unit ("financial charts and indicators"), replacing the flow-derived entries with (i) the surviving charts (patrimonio evolution from assets/valuations; deuda pendiente; costo mensual de suscripciones; distribución de activos) and (ii) an explicit withdrawal note naming what is withdrawn and why. Transferencias and Presupuestos become: manual-balance rule + dated reversal note (per spec). Nothing else in the document changes.

**Parent action:** this needs a one-line spec amendment in `finance-core-invariants` (change "(iii) an updated financial-charts section" → "an updated financial-charts-and-indicators section"), or an explicit acceptance that the analysis block stays contradictory. Recommended: amend. The tasks phase MUST NOT silently widen the `objetivo.md` diff beyond these three blocks.

### D9 — `S3` splits into `S3a`/`S3b` at a named seam

The proposal allows splitting S3. The design fixes the seam so the atomicity invariant (migration + manual balance in one deployable build) is never violated:

- **S3a (backend + DB + MCP):** migration 0011, `PATCH balance` + validation + tests, route/module removal in `main.rs`/`mod.rs`, `statement_balance`→`null` + `STATEMENT_BALANCE_SQL` deletion, delete-guard retirement, debts/savings `transaction_id` removal (DTO + SQL + guards), MCP tools + README, backend wiring tests. **This slice contains both the migration and the balance write → deployable alone.**
- **S3b (frontend + specs):** `FinanceScreens`/`DashboardHome`/`ReportsScreens`/`ProgressScreens` rewrites, component/API/transform/i18n deletions, inline balance edit, spec rewrites for `frontend-dashboard`/`dashboard-widgets`/`credit-card-summary`/`reports-screen`/`progress-score`/`finance-subscriptions`/`frontend-i18n`.

S3b must land **before** the migration is applied to production, but the *code* order is flexible: a build with S3b applied and 0011 not yet run is safe (the FE simply stops calling removed endpoints; `statement_balance` is still returned but unrendered). The unsafe direction is the reverse, which is why the migration lives in S3a and the chain rule stands.

### D10 — Evidence harness for Track B without a live backend

The existing smoke suite is gated by `E2E_SMOKE_LIVE=1` and needs a live backend + seeded user (`e2e/helpers.ts`). The spec's Visual Evidence Gate cannot depend on that.

**Decision:** S4 adds `e2e/productivity-layout.spec.ts`, **not** gated on `E2E_SMOKE_LIVE`, which:
1. seeds the bearer token via `page.addInitScript` (`localStorage["dashboard-token"]`, mirroring `loginViaApi` without the network call);
2. stubs every productivity read with `page.route("**/api/**")` returning deterministic fixtures (goals/tasks/events/notes + `/me`);
3. measures at 390×844, 768×768 and 1440×900: `document.documentElement.scrollWidth <= clientWidth`, the `getBoundingClientRect()` of each `input[type=date]`/`input[type=datetime-local]`/`select`, the `xl` spans per row, and the hit-area boxes of `Editar`/`Eliminar`/`Nuevo`;
4. captures full-page before/after screenshots into `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` (`390-before.png`, `390-after.png`, `1440-before.png`, `1440-after.png`, `metrics.json`).

"Before" is captured on the pre-S4 commit (`git stash`-free: run the spec before applying the S4 diff). The spec must not be merged without `metrics.json` showing `scrollWidth == clientWidth` and every measured box ≥ 44px.

---

## 4. Architecture and data flow

```
                    ┌──────────────────────────── backend (Axum) ───────────────────────────┐
PATCH /api/accounts/{id}                                                                     │
  require_user_id ─▶ validate_account_patch ─▶ parse_balance_amount (finance/money.rs)        │
    └─ 422 on scale>2 | |x|>=10^6 | non-string                                                   │
  ─▶ QueryBuilder: UPDATE accounts SET updated_at=now(), balance=$n, … WHERE id AND user_id    │
  ─▶ RETURNING AccountRow ─▶ AccountResponse (balance: Decimal → JSON string)                  │
                                                                                              │
DELETE /api/accounts/{id}: ownership probe ─▶ DELETE ─▶ 204 | 404 | 409(23503, future RESTRICT) │
GET /api/accounts/{id}: AccountResponse with statement_balance = null (no second query)         │
(removed: /transactions*, /transfers*, /budgets*)                                              │
                    └──────────────────────────────────────────────────────────────────────────┘
                                              ▲ bearer, string money, deny_unknown_fields
                    ┌──────────────────────────── frontend (static export) ───────────────────┐
lib/api/dashboard.ts   useNetWorth, useAccounts, useHabitsToday, usePreferences, layout utils
                       (delete: MonthlyFlowRowWire, CategoryTotalWire, BudgetWire, useMonthlyFlow,
                        useSpendByCategory, useBudgets, DEFAULT_DASHBOARD_LAYOUT 9→6)
lib/api/finance.ts     useSubscriptions, useDebts, useSavingsGoals, useAssets, useFinanceCategories,
                       patchAccount(balance), payment/goal/card/asset writes
                       (delete: transactions + transfers + budgets blocks)
lib/dashboard/transforms.ts  toMonthlyCost, toOutstandingDebt, toTotalSavings, toFinanceSnapshot,
                             toFinanceScore, worstAlertLevel, ledDotClass, existing surviving transforms
                       (delete: toFlowPoints, toDonutSlices, worstBudgetStatus, savingsRate,
                        monthBalance, toMonthIncome/Expense/Savings, toMonthSummary, longestStreak?)
containers/DashboardHome    strip(5 KPIs) + 6 widgets + customize  (no metric row, no flow widgets)
containers/FinanceScreens   accounts(+inline balance) | subs | debts | savings | categories | assets | net worth
containers/ReportsScreens   finance snapshot (current values) + habits + goals + activity
containers/ProgressScreens  score(finance from net worth/debt/savings) + snapshot blocks
containers/ProductivityScreens  4 sections: 2×2 xl, collapsed forms, single-open invariant
                    └──────────────────────────────────────────────────────────────────────────┘
mcp-dashboard/tools.ts: −7 tools; update_account gains `balance` (string) + description rewrite
```

---

## 5. Slice plans

### S4 — Productivity layout (Track B) — merges first

**Intent:** measurable layout/state fixes only; zero API, zero data risk.

Files:
- `components/containers/ProductivityScreens.tsx`
  - grid spans → Metas `col-span-12 xl:col-span-6`, Tareas `col-span-12 md:col-span-6 xl:col-span-6`, Eventos `col-span-12 md:col-span-6 xl:col-span-6`, Notas `col-span-12 xl:col-span-6` (xl rows = 6+6 and 6+6; mobile 12; md keeps Tareas/Eventos paired).
  - `SectionsSkeleton`: `gap-4`→`gap-6`, `md:col-span-6`→the real spans, 4 blocks instead of 3, `aria-busy` kept.
  - replace the four always-mounted forms with collapsed state: `openSection: "goals"|"tasks"|"events"|"notes"|null` + `editing*` per entity. Opening any section sets `openSection` (discarding the previous draft, i.e. clearing the other `editing*`); `onDone` collapses. `Nuevo` button rendered **inside each `SectionShell`**, above the list, always present even with an empty list.
  - remove the redundant inner `<div className="mt-4">` wrappers around lists/tabs (rhythm normalisation) — `SectionShell` already supplies `mt-4` to children.
- `components/productivity/ProductivitySections.tsx`
  - `SectionShell` gains an optional `action?: React.ReactNode` slot rendered in the header row (so `Nuevo` is part of the section header, not a floating control) and keeps `mt-4` for children.
  - `rowActionClass`: `px-2 py-1 text-[11px]` → `min-h-[44px] min-w-[44px] px-3 py-2 text-xs` with `focus-visible:ring-2 focus-visible:ring-signal`. Applies to `EditButton`, `DeleteButton`, the pin toggle and the task toggle buttons.
- `components/productivity/ProductivityForms.tsx`
  - four forms: `className="grid grid-cols-2 gap-3"` → `"grid grid-cols-1 gap-3 sm:grid-cols-2"` (lines 146, 279, 424, 548).
  - every internal `col-span-2` → `sm:col-span-2` (task title/goal/actions, goal name/description/actions, event title/location/actions, note title/body/pinned/actions).
  - submit/cancel buttons: add a `Cancelar` button calling `onDone` (required by "save or cancel collapses") with the same ≥44px hit area.
- `lib/i18n/es.ts`: add `productivity.newEntry`, `productivity.newEntryLabel` (§2/D4).
- `e2e/productivity-layout.spec.ts` + `openspec/changes/.../evidence/*` (D10).

State machine (must be implemented exactly):

```
openSection = null                 → four lists, four "Nuevo" controls, no form
click Nuevo(section)               → openSection=section, editing*=null, others' drafts discarded
click Editar(row of section)       → openSection=section, editing=row (pre-filled)
submit ok | Cancelar | onDone      → openSection=null, editing*=null, list revalidated
click Nuevo(other section) while open → previous form unmounts (draft dropped, no confirm)
empty list                         → "Nuevo" still rendered
```

Accessibility contract: toggle is a `<button type="button" aria-expanded={open} aria-controls={formId} aria-label={t("productivity.newEntryLabel", {section})}>`; the form container carries `id={formId}`; focus moves to the first field on open and back to the toggle on collapse; no transition under `prefers-reduced-motion` (no animation is introduced at all).

Tests: extend `components/productivity/productivity.test.tsx` with (a) forms absent on mount + present after `Nuevo`; (b) save collapses; (c) `Editar` pre-fills and cancel collapses; (d) single-open invariant across two sections; (e) empty list still shows `Nuevo`; (f) `aria-expanded` toggles. Playwright spec per D10.

Exit criteria: `pnpm test` green; Playwright metrics show no horizontal overflow at 390/768/1440 and all row controls ≥44px; evidence files committed; before/after screenshots in the change folder.

### S0 — Helper extraction + hermetic fixtures

**Intent:** make the removals compilable and the surviving tests independent of removed tables. No behaviour change.

- `backend/src/finance/mod.rs`: `pub mod money;` → add `pub mod validation;` and update the module doc (currently says "Route handlers for accounts/transactions/transfers/budgets land here in later PRs" — rewrite).
- new `backend/src/finance/validation.rs`: move `validate_occurred_on` (date parse → 422) and `ensure_finance_category` (category owned + `kind='finance'` → 422) from `routes/transactions.rs`, **verbatim behaviour**, with the same Spanish messages; keep the existing unit tests with them.
- update importers: `routes/{accounts,debts,savings,categories}.rs` (and any surviving consumer) to `use crate::finance::validation::{...}`.
- fixture replacement (seed `transactions` → direct column updates):
  - `routes/debts.rs:1036` — the seed only needs an owned account id for a payment link test; replace the transaction insert with `UPDATE accounts SET balance = ...` (or drop the seed if the link is gone; see S3a for the DTO change).
  - `routes/savings.rs:1088` — same pattern (`RETURNING id` was used as a `transaction_id` fixture → delete the seed with the field).
  - `routes/accounts.rs:1191,1253` — replace with `UPDATE accounts SET balance = $1 WHERE id=$2`; the statement-balance test (`accounts.rs:~1188`) is deleted in S3a with `STATEMENT_BALANCE_SQL`, so S0 only needs the delete-guard test fixture (see D2).
  - `tests/migration_0008_credit_cards.rs:254` — the `EXPLAIN` on `transactions` must move/retire with 0011; S0 leaves it (0008 is still applied) and **S3a deletes that assertion** (it proves an index on a table that no longer exists).
- `routes/subscriptions.rs:857` `seed_category(..., "finance", "budgets")` — rename the label only if it is a fixture name; the `finance` kind stays accepted (D4/orphan kind decision).

Exit criteria: `cargo test` green with `transactions.rs`/`transfers.rs`/`budgets.rs` still present; no surviving module imports helpers from `transactions`.

### S1 — Transfers removal

Backend: delete `src/routes/transfers.rs`; `src/routes/mod.rs` (`:3,19,20`); `src/main.rs:78-82` + doc comment `:38-39`; `backend/tests/migration_0005_transfer_trigger.rs` (7 transfer-only tests) — **keep the byte-guard assertion** that 0002 still contains `counter_account_id` (proposal BR5); if the file is deleted entirely, move that assertion into the new `migration_0011_removal.rs` (preferred: the guard must survive).
Frontend: delete `components/finance/TransferHistory.tsx`; `lib/api/finance.ts` transfers block (`TransferLegWire`, `TransferCreateWire`, `CreateTransferInput`, `createTransfer`, `TransferHistoryWire`, `TransferListWire`, `TransferFilters`, `buildTransfersPath`, `transfersPageKey`, `fetchTransfersPage`, `useTransfersPage`); `lib/finance/finance.ts` `TransferRow`, `TransferFilters`, `toTransferRows`, `transferKey`; `FinanceScreens` imports/`<TransferHistory/>` and the two `<div className="col-span-12">` wrappers for capture/ledger stay until S3; i18n keys per D4; `e2e/sections.spec.ts` assertions that mention transfers.
Docs/specs: delete `openspec/specs/finance-transfers/`; edit `objetivo.md` "Transferencias" block (part of the D8 edit unit).

Tests: delete transfer-shaped tests in `components/finance/finance.test.tsx`, `lib/finance/finance.test.ts`, `lib/api/*` mocks. Exit: both suites green; `grep -rn "transfers" backend/src frontend/components frontend/lib` returns only the payment-method word.

### S2 — Budgets removal

Backend: delete `src/routes/budgets.rs`, `main.rs:87-100`, `routes/mod.rs:20`.
Frontend: delete `components/finance/BudgetForm.tsx`, `components/ui/BudgetBars.tsx`; `FinanceSections.tsx` `BudgetsList` (`:65-90` region) and the `budget`-shaped props; `FinanceScreens.tsx` `useBudgets`, `toBudgetViews`, `BudgetWireWithThresholds`, `toBudgetFormValue`, the Presupuestos `SectionShell` (`:210-214`), the `manageBudgets` `S5Sections` block (`:357-367`), and the `budgets` prop threading; `DashboardHome.tsx` `useBudgets`/`budgetRows`/`budgetLed`/`BudgetBars` widget/LED; `lib/api/dashboard.ts` `BudgetWire`+`useBudgets`; `lib/finance/finance.ts` `BudgetView`/`BudgetWireLike`/`toBudgetViews`; `lib/dashboard/transforms.ts` `worstBudgetStatus`; `lib/api/finance.ts` budgets writes; `lib/finance/finance.ts` `BudgetInsightLike` if `toInsights` is deleted in S3 (coordinate: S2 may leave the type until S3, but no live consumer may remain).
MCP: `list_budgets` + its README entry.
Specs: delete `finance-budgets`; rewrite `frontend-dashboard` (strip LED + "intact" clause) and `dashboard-widgets` (budget references) — these are acceptance criteria of S2, not deferred.
Tests: delete budget tests in `finance.test.tsx`, `jd-round1.test.tsx`, `DashboardHome.test.tsx`, `dashboard.test.ts`, `transforms.test.ts`, `i18n.test.ts` (`tplBudget` moves to S3 with `analysis.*`), `e2e/sections.spec.ts:33-34`.
Exit: green; `frontend-dashboard`'s canonical spec no longer protects a removed artefact.

### S3a — Ledger removal + manual balance + migration (deployable atomically)

Backend:
1. **`finance/money.rs`**: add `parse_balance_amount(raw) -> Result<Decimal, AppError>` — signed, `scale <= 2`, `|x| < 10^6`, 422 with a Spanish-compatible message; unit tests for `"980000.00"`, `"-750.50"`, `"0"`, `"10.005"`, `"1000000.00"`, `"abc"`, `""`, and a JSON-number path (deserialization rejects it before the parser).
2. **`routes/accounts.rs`**:
   - `PatchAccountRequest` gains `pub balance: Option<String>`; `validate_account_patch` returns/validates the parsed balance; the "no updatable fields provided" guard adds `body.balance.is_none()`.
   - `patch_account_handler` binds `balance` into the `QueryBuilder` (`", balance = "` + `push_bind`).
   - delete `STATEMENT_BALANCE_SQL`, `statement_balance_for_card`, `statement_cutoff` (verify no other consumer), and the second query in `get_account_handler`; `statement_balance` stays `Option<Decimal>` and is always `None`. `AccountResponse`'s doc comment is updated.
   - delete `ACCOUNT_MOVEMENT_COUNT_SQL` + the pre-check (D2); keep `map_account_delete_err`.
   - rewrite `patch_rejects_core_field_edits_as_422` → balance is accepted; `name`/`type`/`credit_limit`/`statement_day`/`payment_due_day` stay 422; add unit tests for the four spec scenarios (`-750.50` round-trip, bad values 422, structural edits 422, foreign/401).
3. **`routes/debts.rs`**: drop `TRANSACTION_OWNERSHIP_SQL`, `ensure_transaction_owned`, `CreatePaymentRequest.transaction_id`, `PaymentResponse.transaction_id`, `PaymentRow` tuple slot, `LIST_PAYMENTS_SQL`/`CREATE_PAYMENT_SQL` column lists, and the ownership call; update the module doc (`:11-13`) and tests (`:896`, `:1315-1318`).
4. **`routes/savings.rs`**: identical treatment (`:48`, `:53`, `:481`, `:493`, `:510-517`, `:567-575`, `:612-614`, `:10-14` doc).
5. **`routes/categories.rs`**: no code change (`finance` kind stays accepted and documented as intentionally orphaned — add one doc comment line).
6. **`main.rs`**: delete `:60-82` (transactions + transfers routes if S1 has not landed) and `:87-100` (budgets), rewrite the doc comment, and rewrite the three wiring tests: `protected_routes_live_under_api_prefix` → `/api/accounts`; `legacy_root_paths_are_gone` → `/accounts`; `p9_finanzas_write_routes_are_wired` → surviving writes (`PATCH /api/savings-goals/{id}`, `PATCH /api/debts/{id}`, `GET /api/debts/{id}/payments`, `PATCH /api/assets/{id}`) **plus the new assertion** that `PATCH /api/accounts/{id}` accepts `balance` and that no `/api/transactions`, `/api/transfers`, `/api/budgets` path resolves (401 for mounted, 404 for removed).
7. **`routes/mod.rs`**: remove the three modules.
8. **`backend/migrations/0011_remove_transactions_budgets.sql`** (§7).
9. **`backend/tests/migration_0011_removal.rs`** (§7 assertions) + move the 0002 byte-guard assertion here if S1 deleted `migration_0005_transfer_trigger.rs`.
10. **`backend/tests/migration_0008_credit_cards.rs`**: delete `card_queries_use_indexes_no_seq_scan`'s `transactions` `EXPLAIN` half (keep the `accounts` half) — the index it proves no longer exists.

MCP: `mcp-dashboard/src/tools.ts` delete the 6 transaction tools + `list_budgets`; `update_account` gains `balance: optStrProp("Manual balance as a decimal string, e.g. \"980000.00\"")`, description rewritten to list `balance/notes/color/icon/is_archived` and to state the balance is user-owned; `mcp-dashboard/README.md:6,136` updated and a "removed by this change" note added.

Specs: delete `finance-transactions`; rewrite `credit-card-summary` (statement null, card delete 204), `finance-accounts` (already spec'd), `finance-debts`, `finance-savings`, `finance-subscriptions` (payment method stability).

Exit: `cargo test` green with `SKIP` semantics unchanged; migration test green against the dev DB (`192.168.50.120:5434`); MCP server lists no removed tool; **the slice contains migration + balance write together** (asserted by the wiring test).

### S3b — Frontend + remaining specs

Frontend:
- `FinanceScreens.tsx`: delete `ManualCaptureSection`, `TransactionsLedger`, `TransferHistory` wrappers, the four flow charts + `PeriodSelector` section + income donut + `AnalysisSection`, `useMonthlyFlow`/`useSpendByCategory`, `toBalanceSeries`/`toSavingsSeries`/`toExpenseSeries`/`toPeriodRange`/`PeriodSel` usage, `AggregatesSkeleton` (or keep if accounts block still uses it), `BudgetWire` threading; keep the surviving grid (`7+5`, `4+4+4`, `6+6` pattern) and `S5Sections` minus budgets; add the inline balance edit (§6.2).
- `DashboardHome.tsx`: delete the 4-card metric row (D5), the flow/budget/category widgets, the three month-split metric blocks, `useMonthlyFlow`/`useSpendByCategory`/`useBudgets`, `FlowChart`/`CategoryDonut`/`BudgetBars` imports, `toFlowPoints`/`toDonutSlices`/`monthBalance`/`savingsRate`/`worstBudgetStatus`/`worstAlertLevel`/`toMonthSummary` usage; rebuild the strip from the five live sources (D6); `customizeRows` drops `month-income`/`month-expense`/`month-savings`.
- `ReportsScreens.tsx`: `FinanceBlock` rewritten to the current snapshot (`useNetWorth` + `useSubscriptions` + `useDebts`, `toFinanceSnapshot`), `useMonthlyFlow`/`useSpendByCategory` deleted, `PeriodSelector` **kept** (it is the reports screen's own), period no longer drives the finance block (label it with `reports.financeCurrent`), error isolation per block preserved.
- `ProgressScreens.tsx`: drop `useMonthlyFlow`, compute `financeScore` via `toFinanceScore({netWorth, savings, debt})`, rewrite the finance block's three figures to patrimonio / deuda pendiente / ahorro acumulado, keep the disclaimer and the `progress.score.*` keys.
- `lib/api/dashboard.ts`: `DEFAULT_DASHBOARD_LAYOUT` → 6 widgets in default order 20,21,22,23,24,30; delete `MonthlyFlowRowWire`, `CategoryTotalWire`, `BudgetWire`, `useMonthlyFlow`, `useSpendByCategory`, `useBudgets`; `resolveDashboardLayout`/`isWidgetVisible`/`buildNextLayout` unchanged (stale ids are already ignored by `isWidgetVisible`).
- `lib/api/finance.ts`: delete the transactions block; `patchAccount(id, {balance})`; `DebtPaymentWire` loses `transaction_id`.
- `lib/finance/finance.ts`: delete `LedgerRow`/`toLedgerRows`/`ledgerKey`, `FlowLike`/`toMonthOverMonth`/`toBalanceSeries`/`toSavingsSeries`/`toExpenseSeries`/`toMonthCompare`/`MonthCompare`, `toInsights` + insight types, `PeriodSel`/`toPeriodRange` **only if** the reports `PeriodSelector` keeps its own copy (it currently imports from here — keep `PeriodSel`/`toPeriodRange`/`toEventRange` if so; the design keeps them).
- `lib/dashboard/transforms.ts`: delete `toFlowPoints`/`FlowPoint`/`MonthlyFlowWire`, `toDonutSlices`/`CategoryWire`/`DonutSlice` (check the income-donut reuse), `worstBudgetStatus`, `savingsRate`, `monthBalance`, `toMonthIncome/Expense/Savings`, `toMonthSummary`, `worstAlertLevel`, `longestStreak` (if orphaned); add D7's five transforms.
- components deleted: `components/finance/{ManualCapture,TransactionsLedger,AnalysisSection,BudgetForm}.tsx`, `components/ui/{BudgetBars,BalanceChart,SavingsChart,MonthlyExpensesChart,MonthCompareChart,CategoryDonut}.tsx` (verify each is orphaned; `CategoryDonut` and `SavingsChart` may be used by reports — the reports rewrite decides).
- i18n: D4 S3 deletions + rewrites.
- tests: `finance.test.tsx`, `s1-capture.test.tsx`, `jd-round1.test.tsx`, `AnalysisSection.test.tsx` (deleted), `lib/finance/finance.test.ts`, `lib/finance/jd-round1.test.ts`, `lib/api/dashboard.test.ts`, `lib/dashboard/transforms.test.ts`, `DashboardHome.test.tsx`, `ReportsScreens.test.tsx`, `ProgressScreens.test.tsx`, `i18n.test.ts`, `e2e/sections.spec.ts` — rewritten against surviving behaviour only, with new coverage for `toMonthlyCost` (all 7 frequencies + inactive + unknown), `toFinanceSnapshot`, `toFinanceScore` (4 cases) and the inline balance edit (validation blocked client-side, cancel sends nothing, success revalidates `finance/`).
- specs: `frontend-dashboard`, `dashboard-widgets`, `reports-screen`, `progress-score`, `finance-subscriptions`, `frontend-i18n`, `finance-core-invariants` (D8 amendment).

Exit: `pnpm test` green; no request to a removed endpoint on any screen; `pnpm tsc --noEmit` green (typed-key enforcement); orphan-key sweep clean.

---

## 6. API contracts

### 6.1 `PATCH /api/accounts/{id}`

```
Request  (JSON, deny_unknown_fields → 422 on anything else)
{ "balance"?: "980000.00", "notes"?: string, "color"?: string, "icon"?: string, "is_archived"?: bool }
  balance: string, scale <= 2, |value| < 10^6; JSON number → 422 (deserialization)
Response 200 → AccountResponse (balance serialized as a decimal string, e.g. "-750.50")
Errors   401 no bearer · 404 foreign/missing (never 403) · 422 validation/no-updatable-fields
Invariant: balance is persisted verbatim; no trigger or aggregate rewrites it (0011 removes the only writer)
```

### 6.2 Inline balance edit (account card)

```
[ balance text ] [ "Editar saldo" ]                    → view mode
[ input value="980000.00" ] [Guardar] [Cancelar]       → edit mode
  • current value pre-filled and visible before editing (spec: mis-typed balance is undetectable)
  • client-side guard mirrors the server: /^-?\d{1,6}(\.\d{1,2})?$/ and |v| < 1e6 → else
    t("finance.balanceInvalid"), no request
  • Guardar → patchAccount(id, { balance }) → 200 → mutate((k)=>String(k).startsWith("finance/"))
  • Cancelar → no request
  • control: min-h-[44px] min-w-[44px], focus-visible ring, aria-label per account name
```

### 6.3 `GET /api/accounts` / `GET /api/accounts/{id}`

`statement_balance` is always `null` (both reads); `used_balance`/`available_balance`/`usage_pct`/`alert_level` unchanged (still computed from `balance` + `credit_limit` in `compute_card_metrics`). `GET /accounts/{id}` no longer runs the second query. Cycle days remain editable metadata (delete + recreate only).

### 6.4 Reports / progress contracts

- `/reportes` finance block: `{ patrimonio, costo mensual de suscripciones, deuda pendiente }`, all current values, explicitly labelled (`reports.financeCurrent`), never period-windowed; each figure has its own live source and error isolation.
- `/progreso` finance block: `{ patrimonio, deuda pendiente, ahorro acumulado }`; the area score comes from `toFinanceScore` (pure, presentational, `null` when there is no data).

### 6.5 MCP

`update_account(id, balance?, notes?, color?, icon?, is_archived?)`; description lists the allowlist and says the balance is user-owned. Seven tools unregistered (`list/create/update/delete_transaction`, `stats_transactions_by_category`, `stats_transactions_monthly_flow`, `list_budgets`). No aliases, no scopes migration.

---

## 7. Migration 0011

`backend/migrations/0011_remove_transactions_budgets.sql`

```sql
-- Migration 0011: remove transfers, transactions and budgets.
--
-- Destructive by explicit decision: no backup, no data migration, no
-- compatibility views, no dual read. Applied out-of-band with autocommit
-- (this project has no _sqlx_migrations table). Never edit 0002/0005 — the
-- guard test asserts their bytes; 0005 already neutralised the transfer
-- branch, which is why the balance effect dies with the table.
--
-- Order matters: inbound FK columns → tables → functions → enum.

-- (a) Inbound foreign keys must go before their target table.
ALTER TABLE debt_payments DROP COLUMN transaction_id;
ALTER TABLE savings_goal_movements DROP COLUMN transaction_id;

-- (b) Tables. No CASCADE: an unforeseen dependent must fail loudly instead of
-- being silently dropped. Indexes and triggers (idx_tx_*, trg_tx_*,
-- idx_budgets_*, trg_budgets_updated_at) fall with their tables.
DROP TABLE budgets;
DROP TABLE transactions;

-- (c) Trigger functions are unreferenced once the table is gone.
DROP FUNCTION apply_transaction_to_balance();
DROP FUNCTION apply_transfer_counterparty();

-- (d) The enum was used only by transactions.type. Drop it; if an unforeseen
-- dependent exists, leaving the type orphaned (no column of that type) is the
-- accepted fallback — never CREATE TYPE + reconversion, never CASCADE.
DO $$
BEGIN
    DROP TYPE transaction_type;
EXCEPTION WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'transaction_type left orphaned: dependent object present';
END
$$;
```

Post-conditions asserted by `backend/tests/migration_0011_removal.rs` (all against `DATABASE_URL`, `SKIP` when unset, matching the existing test style):

1. `to_regclass('public.transactions') IS NULL` and `to_regclass('public.budgets') IS NULL`.
2. `to_regprocedure('apply_transaction_to_balance()') IS NULL`, same for `apply_transfer_counterparty()`.
3. no `transaction_id` column in `debt_payments` or `savings_goal_movements`; their `amount`/`paid_on`/`occurred_on` columns still exist.
4. `accounts.balance` exists; `pg_trigger` on `accounts` contains only `trg_accounts_updated_at`.
5. enum: zero `pg_attribute` rows typed `transaction_type`; if the type still exists, zero `pg_depend` references to it (tolerant assertion, §2/D3).
6. surviving triggers intact: `update_debt_pending`, `update_savings_goal_saved`, the 0007 goal-progress trigger, `trg_accounts_updated_at`.
7. 0002 and 0005 byte-identical to their committed content (moved/kept guard).
8. `accounts.balance` values are unchanged by 0011 for a seeded account (the migration never touches balances).

Deployment: out-of-band, autocommit, **human gate** — the destructive loss is re-confirmed before running against production (spec: "Deploy gate reconfirms the loss"). The design does not automate this gate.

---

## 8. Frontend layout specifications

### Productivity (S4)

```
mobile 390            md 768                    xl 1440
┌──────────┐          ┌───────┬───────┐         ┌─────────┬─────────┐
│ Metas    │          │Metas  │Notas  │         │ Metas 6 │Tareas 6 │
├──────────┤          ├───────┼───────┤         ├─────────┼─────────┤
│ Tareas   │          │Tareas │Eventos│         │Eventos6 │Notas 6  │
├──────────┤          └───────┴───────┘         └─────────┴─────────┘
│ Eventos  │          (md: Tareas/Eventos pair)   xl rows: 6+6, 6+6
├──────────┤
│ Notas    │          form fields: grid-cols-1 → sm:grid-cols-2
└──────────┘          full-row fields: col-span-2 → sm:col-span-2
```
Rhythm: `SectionShell` supplies exactly one `mt-4` to its children block; no nested `mt-4` wrapper around lists/tabs. Skeleton mirrors `gap-6` + the real spans with 4 blocks.

### Finance (S3b) — surviving grid

`col-span-12 xl:col-span-7` (Cuentas) + `xl:col-span-5` (Suscripciones); `4/4/4` (Deudas, Ahorros, Categorías/Activos); `6/6` for the write sections. No `xl` row sums above 12 (the reference pattern already used at `FinanceScreens.tsx:212-252`).

---

## 9. i18n inventory enforcement

Delivered as a repeatable check, run per slice and recorded in the slice's PR body:

```bash
# orphan sweep: for each candidate key, list consumers outside the dictionary
for k in $(cat openspec/changes/2026-09-23-simplify-finance-productivity/i18n-candidates.txt); do
  grep -rF "\"$k\"" frontend --include='*.ts' --include='*.tsx' -l \
    | grep -v 'lib/i18n/es.ts' | grep -v 'lib/i18n/i18n.test.ts'
done
# then: pnpm tsc --noEmit  (typed dictionary ⇒ a deleted-but-referenced key fails the build)
```
Candidate list lives in the change folder (`i18n-candidates.txt`) so the sweep is reviewable. Any key with a surviving consumer is moved to the KEEP column and the decision recorded in the PR body.

---

## 10. Test strategy

| Layer | Command | Coverage added by this change |
|---|---|---|
| Backend unit | `cargo test` in `backend/` | `parse_balance_amount` (9 cases); `validate_account_patch` allowlist; delete-guard SQL shape; wiring tests (accounts PATCH accepts balance; removed paths 404); `migration_0011_removal.rs` post-conditions |
| Backend integration (DB) | same, `SKIP` without `DATABASE_URL` | balance round-trip through the handler; 404/401; card metrics from manual balance; debt/savings payment without `transaction_id`; delete account with live finance rows → 204 |
| Frontend unit/component | `pnpm test` in `frontend/` | `toMonthlyCost` (7 frequencies, inactive, unknown, empty), `toOutstandingDebt`, `toTotalSavings`, `toFinanceSnapshot`, `toFinanceScore` (4 cases), inline balance edit (block/cancel/success), home strip 5 KPIs, reports snapshot, progress finance block, productivity collapsed-form state machine (6 cases) |
| Static | `pnpm tsc --noEmit` | typed i18n keys, no import of a removed module |
| E2E (stubbed, always on) | `npx playwright test e2e/productivity-layout.spec.ts` | layout metrics + evidence (D10) |
| E2E (live smoke) | `E2E_SMOKE_LIVE=1 … pnpm test:e2e` | updated section sweep; only surviving sections asserted |

`strict_tdd: false` (`openspec/config.yaml`) → no RED/GREEN ritual required, but every slice must leave both suites green and must not lower coverage of surviving modules. Deleted tests are deleted, never skipped.

---

## 11. Risks, alternatives, rollback

| # | Risk | Mitigation in this design |
|---|---|---|
| R1 | Irreversible data loss (accepted) | Not mitigated by design; the human deploy gate is preserved (spec requires re-confirmation) |
| R2 | Frozen balances in a half-shipped build | S3a contains migration + balance write; wiring test asserts the pair; S3b is FE-only and safe in either order |
| R3 | Compile/test breakage from orphaned helpers and seeds | S0 lands first and is the only enabler; exit criterion is a green suite with the removed modules still present |
| R4 | Specs protecting deleted artefacts | Spec rewrite is an acceptance criterion of the slice that deletes the code (S2/S3a/S3b), not a follow-up |
| R5 | MCP clients hitting removed tools | Same slice (S3a), README updated, unknown-tool accepted and documented |
| R6 | `DROP TYPE` with an unforeseen dependent | In-migration `DO`/exception fallback; tolerant test; never CASCADE |
| R7 | Silent empty widgets | D5/D6 delete dead blocks and re-point the strip; no `EmptyState` is left for a removed source |
| R8 | Track B fixed blind | D10 evidence gate with metrics, not screenshots alone |
| R9 | Deletion-heavy slices exceed 400 review lines | Chain S4 → S0 → S1 → S2 → S3a → S3b, each slice self-contained; if the harness reports `size:exception` it is escalated, never auto-accepted |
| R10 | `objetivo.md` reversal under-recorded | D8: three named blocks, dated reason, explicit withdrawal list; spec amendment flagged |
| R11 | Stale `dashboard_layout` entries break the home | `isWidgetVisible` already ignores unknown ids; the requirement is explicit in `dashboard-widgets` and covered by a component test |
| R12 | Duplicate fetches (strip vs widget keys) | Accepted and documented (D6); SWR dedupes within a key, `revalidateOnFocus:false` limits cost |

**Alternatives considered and rejected**

1. *Keep a lightweight register instead of manual balance* — out of scope by the proposal; would need its own design for "how money enters".
2. *Balance snapshots (append-only, like asset valuations)* — rejected by the user (A1 manual); would add a series and a chart the spec explicitly forbids.
3. *Keep `AnalysisSection` with surviving metrics* — duplicates existing blocks, keeps dead keys (D1).
4. *Rewrite the delete guard against a live table* — there is no live blocking table (D2).
5. *`DROP TYPE ... CASCADE`* — silent dependent removal, contrary to the explicit-inventory discipline (D3).
6. *Point the strip at the widget keys* — breaks "hidden widget triggers no fetch" (D6).
7. *Keep the metric row with two live cards* — leaves dead space and duplicates the strip (D5).
8. *Gate Track B evidence behind `E2E_SMOKE_LIVE`* — the gate would silently skip; D10 stubs the API instead.

**Rollback**

- S4, S0, S1, S2, S3b: `git revert` of the slice commit is sufficient (no schema change in S4/S0/S1/S2/S3b).
- S3a: **no data rollback exists or is planned.** Once 0011 is applied, the rows and the two FK columns are gone; reverting the code does not restore them (spec: "No-Backup And No-Dual-Read Decision"). The only recovery is re-implementing the capability as a new change. This is the accepted cost and MUST be re-confirmed at the deploy gate.
- If 0011 partially fails (e.g. a `DROP TABLE` blocked by an unforeseen FK), the transaction-free autocommit means earlier statements are already applied: recovery is a new forward migration (0012) that completes the removal, never an edit of 0011.

---

## 12. Rollout, ordering, gates

```
merge order:  S4 ─▶ S0 ─▶ S1 ─▶ S2 ─▶ S3a ─▶ S3b ─▶ deploy 0011 (human gate)
              (independent)  (enabler)  (delete-only)      (atomic)   (FE)
```
- S4 is independent of Track A and should merge first for visible value on mobile.
- S0 must precede S1/S2/S3a (helper ownership + hermetic fixtures).
- S3a is the point of no return for the *database*; S3b is the point of no return for the *UI contract*.
- Deploy order: ship S3a code and S3b, then run 0011 at the human gate. A build may run with S3a code and 0011 not yet applied (harmless); it must never run with 0011 applied and S3a code absent.
- **Open gate for the parent:** the preflight header (`auto-chain`) and the injected session context (`ask-on-risk`) disagree on whether S1's >400-line review pauses for confirmation. The chain itself is not optional; only the pause is. Resolve before opening S1.
- **Open gate for the parent:** D8's `objetivo.md` analysis-block edit needs either a one-line spec amendment or explicit acceptance of a remaining contradiction.

---

## 13. Traceability (spec → design)

| Spec requirement | Design section |
|---|---|
| `finance-core-invariants` removal sequencing / helper ownership / migration discipline / post-migration shape / hermetic tests / no-backup / atomic deployability / governing document / FE suite alignment | §5 S0/S1/S2/S3a/S3b, §7, §2/D2/D3, §3/D8, §10 |
| `finance-accounts` (updates, manual balance SSOT, inline edit, delete guard) | §2/D2, §6.1, §6.2 |
| `credit-card-summary` (balance types, detail, no limit patch, contract preserved) | §6.3, §5 S3a/S3b, §2/D2 |
| `finance-transactions` / `finance-transfers` / `finance-budgets` (removals) | §5 S1/S2/S3a/S3b, §7 |
| `finance-debts` / `finance-savings` (self-contained payments/movements) | §5 S3a, §6 |
| `finance-subscriptions` (payment method stability) | §2/D4 KEEP table |
| `frontend-dashboard` (strip, charts, inventory, source integrity) | §3/D5/D6, §5 S3b, §6.4 |
| `dashboard-widgets` (6 widgets, stale ids, composition, empty states) | §5 S3b, §3/D6, §11 R11 |
| `reports-screen` (period vs snapshot, composition) | §3/D7, §5 S3b, §6.4 |
| `progress-score` (areas, finance basis) | §3/D7, §5 S3b, §6.4 |
| `frontend-i18n` (key hygiene, payment method preserved, typed new keys) | §2/D4, §9 |
| `mcp-dashboard` (removed tools, account balance, catalog) | §5 S3a, §6.5 |
| `productivity-layout` (grid, forms, collapsed, skeleton, rhythm, touch, evidence) | §5 S4, §8, §3/D10 |

---

## 14. Handoff to tasks

1. Write tasks for **S4 first** (independent, evidence-gated), then S0, S1, S2, then S3a/S3b.
2. Every slice's task list must include its spec edits and its i18n sweep as acceptance criteria, not as cleanup.
3. S3a's task list must contain, in this order: `parse_balance_amount` → `PatchAccountRequest`/handler → `ACCOUNT_MOVEMENT_COUNT_SQL` retirement → `STATEMENT_BALANCE_SQL` retirement → debts/savings `transaction_id` removal → routes/modules → 0011 → `migration_0011_removal.rs` → wiring tests → MCP.
4. S4's task list must contain the evidence capture **before** the layout edits (before/after pair).
5. Two parent gates before S1 and before the production run of 0011 (§12).

## skill_resolution

`paths-injected` — read the six exact paths injected by the parent before working:
`.claude/skills/{rust-best-practices,supabase-postgres-best-practices,next-best-practices,tailwind-design-system,web-design-guidelines,webapp-testing}/SKILL.md`.
Honest caveats: (1) `web-design-guidelines` requires fetching a remote rule list and this session has no network tool, so the layout/a11y decisions are justified from `tailwind-design-system` (breakpoints, touch targets) plus the repo's own patterns; (2) `supabase-postgres-best-practices` is an index whose `references/*.md` were not needed — the DB finding here is destructive-DDL ordering and catalog verification, not query performance; (3) **CodeGraph not executable in this session** (no shell tool; `.codegraph/` contains only `.gitignore`), so impact analysis was done with indexed `grep`/`find`/`read` over concrete paths, and every claim in §2 is anchored to a file:line. The apply/verify phase SHOULD run `gentle-ai codegraph init --cwd <root>` before its own impact analysis.
