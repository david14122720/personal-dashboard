# Tasks — 2026-09-23-simplify-finance-productivity

- change: `2026-09-23-simplify-finance-productivity`
- phase: tasks
- date: 2026-09-23
- artifact_store: `openspec` (this file is the authoritative artifact)
- delivery_strategy: `auto-chain` (explicit session choice — chain automatically, never pause, never infer `size:exception`)
- chain_strategy: `stacked-to-main`
- review_budget: 400 changed lines (`additions + deletions`)
- strict_tdd: `false` (`openspec/config.yaml`) — no ceremonial RED/GREEN, but every task requires focused verification plus a full-suite check
- status: `ready_for_apply`
- Binding slice order: **S4 → S0 → S1 → S2 → S3a → S3b**. S4 is independent and merges first. S3a is the database point of no return; S3b is the UI-contract point of no return.

## Inputs read

`proposal.md`, `design.md`, all 16 delta specs under `specs/`, `i18n-candidates.txt`, `openspec/config.yaml`, plus direct inspection of `backend/migrations/`, `backend/tests/`, `backend/src/main.rs`, `frontend/e2e/{helpers,sections}.spec.ts`, `frontend/playwright.config.ts`, `frontend/package.json`, and the surviving test/module inventory under `frontend/`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~8,000–9,500 total across 6 slices (deletion-dominant) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | S4 → S0 → S1 → S2 → S3a → S3b (one stacked PR per slice, work-unit commits inside) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

### Per-slice forecast

| Slice | Est. changed lines | Budget risk | Chain decision | Internal split (work units) |
|-------|--------------------|-------------|----------------|-----------------------------|
| S4 — Productivity layout | ~340–460 | Medium | auto-chain, no pause | WU1 evidence + layout (~250), WU2 collapsed forms (~200) |
| S0 — helpers + hermetic fixtures | ~120–180 | Low | single PR | one unit |
| S1 — transfers removal | ~1,700–1,900 | High | auto-chain, no pause | WU1 frontend retirement (~700), WU2 backend + guard + docs (~1,100) |
| S2 — budgets removal | ~1,100–1,300 | High | auto-chain, no pause | WU1 frontend + dashboard (~500), WU2 backend + MCP + specs (~700) |
| S3a — transactions removal + 0011 + MCP | ~2,200–2,600 | High | auto-chain, no pause | ordered units S3a.1–S3a.14 (see below) |
| S3b — frontend + remaining specs | ~2,600–3,000 | High | auto-chain, no pause | WU1 transforms/API, WU2 screens, WU3 deletions, WU4 tests + i18n + specs |

Overage note: S1/S2/S3a/S3b exceed 400 changed lines by construction because they are deletions of working modules. Splitting them below the stated work units would either break the workspace (component + container import + API layer + tests must land together to compile) or violate `finance-core-invariants` "Removal Sequencing Without Dangling References" (zero surviving references per removal slice). No `size:exception` is inferred or requested; auto-chain proceeds automatically per preflight.

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

Decision note: both open design gates are resolved by the session constraints — the D8 `objetivo.md` analysis-block edit is authorized as a one-line spec amendment (S3b spec-sync task), and S1 does not pause for confirmation (`auto-chain`). The only remaining human gate is the production run of migration 0011 (parent lifecycle task L2), which is a deploy gate, not an apply-delivery decision.

---

## Slice S4 — Productivity layout (Track B)

- Intent: measurable layout/state fixes on `/dashboard/productividad/` (read-only) only. Zero API, zero data risk, merges first.
- Depends: none.
- Forecast: Medium risk; two work units; if the harness enforces a hard 400-line cap per PR, WU1 and WU2 become two stacked PRs (WU1 first).
- Evidence rule: before/after Playwright captures at 390×844, 768×768 and 1440×900 MUST exist **before** any layout class is touched. The evidence spec is ungated (never `E2E_SMOKE_LIVE`); it stubs `**/api/**` with `page.route` and seeds `localStorage["dashboard-token"]` via `page.addInitScript` (`frontend/e2e/helpers.ts` pattern).
- Files: `frontend/components/containers/ProductivityScreens.tsx`, `frontend/components/productivity/ProductivitySections.tsx`, `frontend/components/productivity/ProductivityForms.tsx`, `frontend/components/productivity/productivity.test.tsx`, `frontend/lib/i18n/es.ts`, new `frontend/e2e/productivity-layout.spec.ts`, new `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/`.

### S4-WU1 — Evidence harness + layout fixes

- [x] Create `frontend/e2e/productivity-layout.spec.ts` (not gated on `E2E_SMOKE_LIVE`): seed the bearer token via `page.addInitScript` into `localStorage["dashboard-token"]`, stub all `**/api/**` reads with deterministic fixtures (`/me` (read-only), goals, tasks, events, notes), and measure at 390×844, 768×768 and 1440×900: `document.documentElement.scrollWidth <= clientWidth`, the `getBoundingClientRect()` of every `input[type=date]`/` (read-only)input[type=datetime-local]`/` (read-only)select`, the `xl` spans per row, and the hit-area boxes of `Editar`/` (read-only)Eliminar`/` (read-only)Nuevo`. Write `metrics-{phase}.json` and full-page screenshots into `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` using `LAYOUT_EVIDENCE_PHASE=before|after` for filenames. <!-- sdd-owner: implementation -->
- [x] Capture BEFORE evidence on the pre-S4 commit: run `npx playwright test e2e/productivity-layout.spec.ts` with `LAYOUT_EVIDENCE_PHASE=before` and commit `evidence/390-before.png`, `evidence/1440-before.png`, `evidence/metrics-before.json`; the before run is allowed to fail the layout assertions (that failure is the recorded defect: overflow, clipped date inputs, xl spans summing 17). <!-- sdd-owner: implementation -->
- [x] Fix the `xl` grid spans in `frontend/components/containers/ProductivityScreens.tsx`: Metas `col-span-12 xl:col-span-6`, Tareas `col-span-12 md:col-span-6 xl:col-span-6`, Eventos `col-span-12 md:col-span-6 xl:col-span-6`, Notas `col-span-12 xl:col-span-6` (xl rows 6+6 and 6+6; md keeps Tareas/Eventos paired; mobile stays one column). <!-- sdd-owner: implementation -->
- [x] Align `SectionsSkeleton` in `frontend/components/containers/ProductivityScreens.tsx` with the resolved grid: `gap-4` → `gap-6`, the real per-breakpoint spans, 4 blocks instead of 3, keep `aria-busy`. <!-- sdd-owner: implementation -->
- [x] Fix form field columns in `frontend/components/productivity/ProductivityForms.tsx` (4 form grids at ~lines 146, 279, 424, 548): `grid grid-cols-2 gap-3` → `grid grid-cols-1 gap-3 sm:grid-cols-2`; every internal `col-span-2` → `sm:col-span-2`. <!-- sdd-owner: implementation -->
- [x] Raise touch targets and focus in `frontend/components/productivity/ProductivitySections.tsx`: `rowActionClass` → `min-h-[44px] min-w-[44px] px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-signal`, applied to `EditButton`, `DeleteButton`, the pin toggle and the task toggle; add a `Cancelar` button (≥44px, calls `onDone`) to each of the four forms. <!-- sdd-owner: implementation -->
- [x] Normalize vertical rhythm in `frontend/components/containers/ProductivityScreens.tsx`: remove the nested `<div className="mt-4">` wrappers around lists/tabs; `SectionShell` supplies the single `mt-4` to its children block. <!-- sdd-owner: implementation -->
- [x] Capture AFTER-WU1 evidence with `LAYOUT_EVIDENCE_PHASE=after` and commit `evidence/390-after.png`, `evidence/1440-after.png`, `evidence/metrics-after.json`; assert `scrollWidth == clientWidth` at all three widths, every measured input/select at full form width, every row control ≥44px, and `xl` spans summing exactly 12 per row. <!-- sdd-owner: implementation -->

### S4-WU2 — Collapsed creation forms behind «Nuevo»

- [x] Add `productivity.newEntry: "Nuevo"` and `productivity.newEntryLabel: "Nuevo en {section}"` to `frontend/lib/i18n/es.ts` (typed keys, composed from the existing `productivity.goals/tasks/events/notes` keys). <!-- sdd-owner: implementation -->
- [x] Add an optional `action?: React.ReactNode` header slot to `SectionShell` in `frontend/components/productivity/ProductivitySections.tsx` and render the per-section «Nuevo» control there (above the list, always present, including with an empty list). <!-- sdd-owner: implementation -->
- [x] Implement the collapsed-form state machine in `frontend/components/containers/ProductivityScreens.tsx`: `openSection: "goals"|"tasks"|"events"|"notes"|null` plus per-entity `editing*`; opening any section sets `openSection` and discards the previous draft; `Editar` opens the same form pre-filled; submit/cancel/`onDone` collapses and revalidates the list; toggle is `<button type="button" aria-expanded={open} aria-controls={formId} aria-label={t("productivity.newEntryLabel", {section})}>` with focus moved to the first field on open and back to the toggle on collapse. <!-- sdd-owner: implementation -->
- [x] Extend `frontend/components/productivity/productivity.test.tsx` with six cases: forms absent on mount / present after «Nuevo»; save collapses; `Editar` pre-fills and cancel collapses; single-open invariant across two sections; empty list still shows «Nuevo»; `aria-expanded` toggles. <!-- sdd-owner: implementation -->
- [x] Refresh the committed after-evidence so screenshots show the final collapsed-form state, and record in `evidence/metrics-after.json` that the layout metrics still pass (no regression from WU2). <!-- sdd-owner: implementation -->
- [x] Sync the canonical spec `openspec/specs/productivity-layout/spec.md` from `openspec/changes/2026-09-23-simplify-finance-productivity/specs/productivity-layout/spec.md` (new domain — create the canonical directory). <!-- sdd-owner: implementation -->
- [x] Full S4 verification: `cd frontend && pnpm test`, `pnpm tsc --noEmit`, `npx playwright test e2e/productivity-layout.spec.ts`; record the three command results plus the evidence paths in the slice PR body. <!-- sdd-owner: implementation -->

Slice S4 acceptance criteria: `pnpm test` green; Playwright metrics show no horizontal overflow at 390/768/1440; every measured row control ≥44px; date/select inputs full width at 390px; xl spans 12 per row; before/after screenshots + metrics committed under `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/`; six new component test cases green.
Slice S4 rollback: `git revert` of the WU2 commit then the WU1 commit (no schema, no API, no data).

---

## Slice S0 — Helper extraction + hermetic fixtures

- Intent: make the later removals compilable and the surviving tests independent of removed tables. No behaviour change.
- Depends: none (must precede S1/S2/S3a).
- Forecast: Low risk, ~120–180 lines, single PR.
- Files: `backend/src/finance/mod.rs`, new `backend/src/finance/validation.rs`, `backend/src/routes/{accounts,debts,savings,categories,subscriptions}.rs`, `backend/tests/migration_0008_credit_cards.rs` (left untouched).

- [x] Create `backend/src/finance/validation.rs` moving `validate_occurred_on` (date parse → 422) and `ensure_finance_category` (owned + `kind='finance'` → 422) out of `backend/src/routes/transactions.rs` verbatim, with the same Spanish messages and their existing unit tests; add `pub mod validation;` to `backend/src/finance/mod.rs` and rewrite the stale module doc ("later PRs" sentence). <!-- sdd-owner: implementation -->
- [x] Update every surviving importer to `use crate::finance::validation::{...}`: `backend/src/routes/{accounts,debts,savings,categories}.rs` plus any additional consumer found by `grep -rn "validate_occurred_on\|ensure_finance_category" backend/src`. <!-- sdd-owner: implementation -->
- [x] Replace the `transactions` seeds in `backend/src/routes/debts.rs` (~line 1036) and `backend/src/routes/savings.rs` (~line 1088) with `UPDATE accounts SET balance = ...` fixtures (or drop the seed when it existed only to produce a `transaction_id`). <!-- sdd-owner: implementation -->
- [x] Replace the `transactions` seeds in `backend/src/routes/accounts.rs` (~lines 1191, 1253) with direct balance updates; keep the delete-guard fixture shape so S3a can rewrite it; leave `backend/tests/migration_0008_credit_cards.rs:254` (`EXPLAIN` on `transactions`) untouched — S3a retires it. <!-- sdd-owner: implementation -->
- [x] Check `backend/src/routes/subscriptions.rs` (~line 857) `seed_category(..., "finance", "budgets")`: rename the fixture label only; the `finance` kind stays accepted and documented as intentionally orphaned (doc comment lands in S3a). <!-- sdd-owner: implementation -->
- [x] Verify S0: `cd backend && cargo test` green with `transactions.rs`/` (read-only)transfers.rs`/` (read-only)budgets.rs` still present; `grep -rn "transactions::" backend/src` shows no surviving module importing helpers from `transactions`. <!-- sdd-owner: implementation -->
- [x] Create the canonical spec `openspec/specs/finance-core-invariants/spec.md` from the change delta (first slice implementing its "Shared Finance Validation Helper Ownership" requirement); later slices only amend it if their requirement text changes. <!-- sdd-owner: implementation -->

Slice S0 acceptance criteria: `cargo test` green with the three removed modules still present; helper definitions live outside `routes/transactions.rs`; no test seeds `transactions` for debts/savings/accounts fixtures.
Slice S0 rollback: `git revert` the slice commit (pure refactor + fixture swap, no schema change).

---

## Slice S1 — Transfers removal

- Intent: remove transfers end to end (routes, trigger test file, UI, API layer, i18n, spec, `objetivo.md` block).
- Depends: S0. Merges after S0.
- Forecast: High risk (deletion-dominant, ~1,700–1,900 changed lines); WU1 frontend retirement must land atomically with the component/container/tests so the build stays green; WU2 backend + guard + docs completes the removal.
- Boundary: do NOT touch transactions, budgets, `ManualCapture`, `TransactionsLedger` (the two `col-span-12` wrappers for capture/ledger stay until S3).
- Files: `backend/src/routes/transfers.rs`, `backend/src/routes/mod.rs`, `backend/src/main.rs`, `backend/tests/migration_0005_transfer_trigger.rs`, new `backend/tests/migration_0011_removal.rs`, `frontend/components/finance/TransferHistory.tsx`, `frontend/components/containers/FinanceScreens.tsx`, `frontend/lib/api/finance.ts`, `frontend/lib/finance/finance.ts`, `frontend/lib/i18n/es.ts`, `frontend/e2e/sections.spec.ts`, `objetivo.md`, canonical `openspec/specs/finance-transfers/`.

### S1-WU1 — Frontend retirement

- [x] Delete `frontend/components/finance/TransferHistory.tsx` and remove its import/`<TransferHistory/>` usage from `frontend/components/containers/FinanceScreens.tsx`. <!-- sdd-owner: implementation -->
- [x] Delete the transfers block in `frontend/lib/api/finance.ts`: `TransferLegWire`, `TransferCreateWire`, `CreateTransferInput`, `createTransfer`, `TransferHistoryWire`, `TransferListWire`, `TransferFilters`, `buildTransfersPath`, `transfersPageKey`, `fetchTransfersPage`, `useTransfersPage`. <!-- sdd-owner: implementation -->
- [x] Delete `TransferRow`, `TransferFilters`, `toTransferRows`, `transferKey` from `frontend/lib/finance/finance.ts`. <!-- sdd-owner: implementation -->
- [x] Delete transfer-shaped tests and mocks in `frontend/components/finance/finance.test.tsx`, `frontend/lib/finance/finance.test.ts` and the `frontend/lib/api/*` mocks; update the transfer assertions in `frontend/e2e/sections.spec.ts` to surviving sections only. <!-- sdd-owner: implementation -->
- [x] Delete the S1 i18n keys from `frontend/lib/i18n/es.ts` (`finance.transfersTitle`, `transfersSubtitle`, `transfersRegion`, `showingTransfers`, `noTransfers`, `noTransfersHint`, `loadingTransfers`, `transfersLoadFailed`, `transfersLoadFailedHint`, `transferDirection`, `newTransfer`, `saveTransfer`, `transferSaved`, `sameAccountError`, `fromAccount`, `toAccount`), run the orphan sweep from `i18n-candidates.txt` for those keys, and run `pnpm tsc --noEmit`. <!-- sdd-owner: implementation -->

### S1-WU2 — Backend, guard, docs

- [x] Delete `backend/src/routes/transfers.rs`; remove the module from `backend/src/routes/mod.rs:3,19,20`; delete the `/transfers` (read-only) route block in `backend/src/main.rs:78-82` and update the doc comment at `backend/src/main.rs:38-39`. <!-- sdd-owner: implementation -->
- [x] Rewrite `backend/tests/migration_0005_transfer_trigger.rs`: keep only the `migration_is_function_only_and_0002_untouched` byte-guard (0002 still contains `counter_account_id`), move it into a new `backend/tests/migration_0011_removal.rs`, and delete the six transfer-specific tests; S3a appends the 0011 post-conditions to the same file. <!-- sdd-owner: implementation -->
- [x] Delete the canonical spec `openspec/specs/finance-transfers/`; sync `openspec/specs/finance-subscriptions/spec.md` (Payment Method Catalog Stability) and the S1 section of `openspec/specs/frontend-i18n/spec.md`. <!-- sdd-owner: implementation -->
- [x] Edit `objetivo.md` "Transferencias" block only (D8): replace with the manual-balance rule and a dated reversal note (ledger/transfers unused, maintenance cost exceeded value, manual balance covers the use case); no other block changes in this slice. <!-- sdd-owner: implementation -->
- [x] Verify S1: `cd backend && cargo test`; `cd frontend && pnpm test && pnpm tsc --noEmit`; `grep -rn "transfers" backend/src frontend/components frontend/lib` returns only the payment-method word (`finance.paymentTransfer` consumers `SubscriptionForms.tsx`, `DebtPayments.tsx`); `grep -rn "transfer" mcp-dashboard/src` confirms no MCP change is needed (no transfer tool ever existed). <!-- sdd-owner: implementation -->

Slice S1 acceptance criteria: both suites green; no mounted `/api/transfers` (read-only) path; no live reference to transfer routes/components/keys outside the specs that document the removal; `objetivo.md` transfer block replaced with the dated reversal note; canonical `finance-transfers` spec deleted.
Slice S1 rollback: `git revert` WU2 then WU1 (no schema change; the transfer rows still exist until 0011).

---

## Slice S2 — Budgets removal

- Intent: remove budgets end to end (routes, table use, UI, LED, MCP tool, i18n, specs, `objetivo.md` block).
- Depends: S0. Merges after S1.
- Forecast: High risk (deletion-dominant, ~1,100–1,300 changed lines); WU1 frontend + dashboard; WU2 backend + MCP + specs.
- Boundary: do NOT touch transactions/flow artefacts (they belong to S3); `tplBudget` moves to S3 with the `analysis.*` family.
- Files: `backend/src/routes/budgets.rs`, `backend/src/routes/mod.rs`, `backend/src/main.rs`, `frontend/components/finance/BudgetForm.tsx`, `frontend/components/ui/BudgetBars.tsx`, `frontend/components/finance/FinanceSections.tsx`, `frontend/components/containers/{FinanceScreens,DashboardHome}.tsx`, `frontend/lib/api/{dashboard,finance}.ts`, `frontend/lib/finance/finance.ts`, `frontend/lib/dashboard/transforms.ts`, `mcp-dashboard/src/tools.ts`, `mcp-dashboard/README.md`, `frontend/lib/i18n/es.ts`, canonical `openspec/specs/{finance-budgets,frontend-dashboard,dashboard-widgets,frontend-i18n}/`.

### S2-WU1 — Frontend + dashboard

- [x] Delete `frontend/components/finance/BudgetForm.tsx` and `frontend/components/ui/BudgetBars.tsx`; remove `BudgetsList` and its budget-shaped props from `frontend/components/finance/FinanceSections.tsx`. <!-- sdd-owner: implementation -->
- [x] Remove from `frontend/components/containers/FinanceScreens.tsx`: `useBudgets`, `toBudgetViews`, `BudgetWireWithThresholds`, `toBudgetFormValue`, the Presupuestos `SectionShell` (`:210-214`), the `manageBudgets` block (`:357-367`) and the `budgets` prop threading. <!-- sdd-owner: implementation -->
- [x] Remove the budget widget/LED from `frontend/components/containers/DashboardHome.tsx` (`useBudgets`, `budgetRows`, `budgetLed`, `BudgetBars`); remove `BudgetWire` + `useBudgets` from `frontend/lib/api/dashboard.ts`; remove `BudgetView`/` (read-only)BudgetWireLike`/` (read-only)toBudgetViews` from `frontend/lib/finance/finance.ts`; remove `worstBudgetStatus` from `frontend/lib/dashboard/transforms.ts`; remove the budgets writes from `frontend/lib/api/finance.ts`. <!-- sdd-owner: implementation -->
- [x] Delete the S2 i18n keys (`finance.budgets`…`finance.overThreshold`, `dashboard.budgets`…`dashboard.noBudgetsHint`), run the orphan sweep for them, and run `pnpm tsc --noEmit`; leave `analysis.tplBudget` for S3. <!-- sdd-owner: implementation -->
- [x] Delete the budget tests in `frontend/components/finance/finance.test.tsx`, `frontend/components/finance/jd-round1.test.tsx`, `frontend/components/containers/DashboardHome.test.tsx`, `frontend/lib/api/dashboard.test.ts`, `frontend/lib/dashboard/transforms.test.ts`, `frontend/lib/i18n/i18n.test.ts` and `frontend/e2e/sections.spec.ts:33-34`; add a component test that a persisted `dashboard_layout` naming a removed widget id is ignored (no block, no request). <!-- sdd-owner: implementation -->

### S2-WU2 — Backend, MCP, specs

- [x] Delete `backend/src/routes/budgets.rs`; remove the module from `backend/src/routes/mod.rs:20`; delete the budget routes in `backend/src/main.rs:87-100` and update the doc comment. <!-- sdd-owner: implementation -->
- [x] Delete `list_budgets` from `mcp-dashboard/src/tools.ts` and update `mcp-dashboard/README.md:6,136` plus the "removed by this change" note. <!-- sdd-owner: implementation -->
- [x] Delete the canonical spec `openspec/specs/finance-budgets/`; rewrite `openspec/specs/frontend-dashboard/spec.md` (strip LED + the "MUST remain intact" clause replaced by the explicit removed-visual inventory) and `openspec/specs/dashboard-widgets/spec.md` (budget references); sync the S2 section of `openspec/specs/frontend-i18n/spec.md`. <!-- sdd-owner: implementation -->
- [x] Edit `objetivo.md` "Presupuestos" block only (D8): remove the budget mandate and record the dated reversal reason; no other block changes in this slice. <!-- sdd-owner: implementation -->
- [x] Verify S2: `cd backend && cargo test`; `cd frontend && pnpm test && pnpm tsc --noEmit`; `grep -rn "budgets" backend/src frontend/components frontend/lib mcp-dashboard/src` returns no live reference; the canonical `frontend-dashboard` spec no longer protects a removed artefact. <!-- sdd-owner: implementation -->

Slice S2 acceptance criteria: both suites green; no `/api/budgets` (read-only) path mounted; no budget LED/chip/bar or `worstBudgetStatus` consumer remains; `list_budgets` unregistered and README updated; `objetivo.md` budget block reversed with date and reason; stale layout ids ignored without fetch.
Slice S2 rollback: `git revert` WU2 then WU1 (no schema change; budget rows still exist until 0011).

---

## Slice S3a — Ledger removal + manual balance + migration 0011 + MCP

- Intent: remove transactions/ledger end to end, ship the manual balance write and migration 0011 together so no deployable build freezes balances, and update the MCP surface.
- Depends: S0 (S1/S2 ideally already merged; this slice removes any remaining routes if they are not).
- Forecast: High risk (~2,200–2,600 changed lines, mostly deletion); internal order is binding.
- Files: `backend/src/finance/money.rs`, `backend/src/routes/{accounts,debts,savings,categories}.rs`, `backend/src/{main.rs,routes/mod.rs}`, new `backend/migrations/0011_remove_transactions_budgets.sql`, `backend/tests/{migration_0011_removal,migration_0008_credit_cards}.rs`, `mcp-dashboard/{src/tools.ts,README.md}`, canonical `openspec/specs/{finance-transactions,credit-card-summary,finance-debts,finance-savings,finance-accounts,finance-core-invariants,mcp-dashboard}/`.

- [ ] S3a.1 — Add `parse_balance_amount(raw) -> Result<Decimal, AppError>` to `backend/src/finance/money.rs`: signed decimal string, `scale <= 2`, `|x| < 10^6`, 422 with a Spanish-compatible message; unit tests for `"980000.00"`, `"-750.50"`, `"0"`, `"10.005"`, `"1000000.00"`, `"abc"`, `""`, and the JSON-number path (deserialization rejects it before the parser). <!-- sdd-owner: implementation -->
- [ ] S3a.2 — `backend/src/routes/accounts.rs`: `PatchAccountRequest` gains `balance: Option<String>`; `validate_account_patch` validates the parsed balance; the "no updatable fields" guard adds `body.balance.is_none()`; `patch_account_handler` binds `balance` into the `QueryBuilder` (`", balance = "` + `push_bind`); rewrite `patch_rejects_core_field_edits_as_422` so `balance` is accepted while `name`/` (read-only)type`/` (read-only)credit_limit`/` (read-only)statement_day`/` (read-only)payment_due_day` stay 422; add the four spec scenarios (`-750.50` round-trip, bad values 422, structural edits 422, foreign 404 / no-token 401). <!-- sdd-owner: implementation -->
- [ ] S3a.3 — Retire the delete guard in `backend/src/routes/accounts.rs`: delete `ACCOUNT_MOVEMENT_COUNT_SQL` and the pre-check, keep `map_account_delete_err` (23503→409, Spanish message); rewrite `delete_account_with_movements_is_409` → `delete_account_with_live_finance_rows_is_204` (seed account + debt + savings goal + subscription, assert 204 and the row is gone); delete the `credit_card_account_id` SQL-shape test; add `account_delete_sql_never_references_removed_tables` asserting `DELETE_ACCOUNT_SQL`/` (read-only)ACCOUNT_OWNERSHIP_CHECK_SQL` contain no `transactions`/` (read-only)budgets` token. <!-- sdd-owner: implementation -->
- [ ] S3a.4 — Retire `STATEMENT_BALANCE_SQL` in `backend/src/routes/accounts.rs`: delete the constant, `statement_balance_for_card`, `statement_cutoff` (verify no other consumer) and the second query in `get_account_handler`; `statement_balance` stays `Option<Decimal>` and is always `None`; update the `AccountResponse` doc comment; delete/rewrite the statement-balance test (~line 1188). <!-- sdd-owner: implementation -->
- [ ] S3a.5 — Remove `transaction_id` from debts and savings: `backend/src/routes/debts.rs` drop `TRANSACTION_OWNERSHIP_SQL`, `ensure_transaction_owned`, `CreatePaymentRequest.transaction_id`, `PaymentResponse.transaction_id`, the `PaymentRow` tuple slot, the `LIST_PAYMENTS_SQL`/` (read-only)CREATE_PAYMENT_SQL` column lists, the ownership call and the module doc (`:11-13`), fixing tests at `:896` and `:1315-1318`; `backend/src/routes/savings.rs` same treatment at `:48,53,481,493,510-517,567-575,612-614` plus doc `:10-14`. <!-- sdd-owner: implementation -->
- [ ] S3a.6 — Add one doc comment line in `backend/src/routes/categories.rs` recording that `kind='finance'` stays accepted as an intentionally orphaned value (no code change). <!-- sdd-owner: implementation -->
- [ ] S3a.7 — Route/module removal in `backend/src/main.rs` (delete `:60-82` transactions, transfers if S1 has not landed, and `:87-100` budgets; rewrite the doc comment) and `backend/src/routes/mod.rs` (remove the three modules). <!-- sdd-owner: implementation -->
- [ ] S3a.8 — Create `backend/migrations/0011_remove_transactions_budgets.sql` exactly per design §7: (a) `ALTER TABLE debt_payments DROP COLUMN transaction_id`, `savings_goal_movements DROP COLUMN transaction_id`; (b) `DROP TABLE budgets`, `DROP TABLE transactions` (no CASCADE); (c) `DROP FUNCTION apply_transaction_to_balance()`, `DROP FUNCTION apply_transfer_counterparty()`; (d) `DROP TYPE transaction_type` inside a `DO` block catching `dependent_objects_still_exist` with a `RAISE NOTICE` fallback (never CASCADE, never `CREATE TYPE`). <!-- sdd-owner: implementation -->
- [ ] S3a.9 — Extend `backend/tests/migration_0011_removal.rs` with the eight post-conditions from design §7 (tables gone; functions gone; `transaction_id` columns gone while `amount`/date columns remain; ` (read-only)accounts.balance` present with only `trg_accounts_updated_at`; enum tolerant assertion via `pg_attribute`/` (read-only)pg_depend`; surviving triggers intact; 0002/0005 byte-identical; seeded balance unchanged), `SKIP` when `DATABASE_URL` is unset, matching the existing test style. <!-- sdd-owner: implementation -->
- [ ] S3a.10 — `backend/tests/migration_0008_credit_cards.rs`: delete the `transactions` half of `card_queries_use_indexes_no_seq_scan` (the index it proves no longer exists), keep the `accounts` half. <!-- sdd-owner: implementation -->
- [ ] S3a.11 — Rewrite the wiring tests in `backend/src/main.rs`: `protected_routes_live_under_api_prefix` → `/api/accounts` (read-only); `legacy_root_paths_are_gone` → `/accounts` (read-only); `p9_finanzas_write_routes_are_wired` → surviving writes (`PATCH /api/savings-goals/{id}`, `PATCH /api/debts/{id}`, `GET /api/debts/{id}/payments`, `PATCH /api/assets/{id}`) plus the new assertions that `PATCH /api/accounts/{id}` accepts `balance` and that no `/api/transactions` (read-only), `/api/transfers` (read-only) or `/api/budgets` (read-only) path resolves (401 mounted vs 404 removed). <!-- sdd-owner: implementation -->
- [ ] S3a.12 — MCP: delete the six transaction tools (`list/create/update/delete_transaction`, `stats_transactions_by_category`, `stats_transactions_monthly_flow`) from `mcp-dashboard/src/tools.ts`; give `update_account` a `balance` property (`optStrProp("Manual balance as a decimal string, e.g. \"980000.00\"")`) and rewrite its description to the allowlist `balance/notes/color/icon/is_archived` stating the balance is user-owned; update `mcp-dashboard/README.md:6,136` with the removed-tools note. <!-- sdd-owner: implementation -->
- [ ] S3a.13 — Spec sync: delete canonical `openspec/specs/finance-transactions/`; rewrite `openspec/specs/credit-card-summary/spec.md`, `finance-debts`, `finance-savings` and the API half of `finance-accounts`; extend `openspec/specs/finance-core-invariants/spec.md` (post-migration shape + atomic deployability); create canonical `openspec/specs/mcp-dashboard/spec.md`. <!-- sdd-owner: implementation -->
- [ ] S3a.14 — Verify S3a: `cd backend && cargo test` green; run the migration test against the dev DB (`DATABASE_URL` → `192.168.50.120:5434`); confirm the MCP server lists no removed tool and `update_account` accepts `balance`; confirm the slice contains migration + balance write together (asserted by the wiring test). <!-- sdd-owner: implementation -->

Slice S3a acceptance criteria: `cargo test` green; 0011 applied cleanly on the dev DB with all eight post-conditions passing; `PATCH /api/accounts/{id}` accepts `balance` in the same slice as the migration; no `/api/transactions|transfers|budgets` (read-only) route resolves; debts/savings wire and SQL free of `transaction_id`; MCP registry and README list only surviving tools.
Slice S3a rollback: code is revertible, **data is not** — once 0011 is applied the rows and both FK columns are gone; the only recovery is a forward migration 0012 (never edit 0011). Reverting the code does not restore data.

---

## Slice S3b — Frontend + remaining specs

- Intent: finish the frontend side of the ledger removal (screens, hooks, transforms, i18n, inline balance edit) and the remaining spec rewrites including the `objetivo.md` charts/analysis reversal.
- Depends: S3a for contract truth (the frontend may land before 0011 is applied to production, never the reverse).
- Forecast: High risk (~2,600–3,000 changed lines); WU1 transforms/API, WU2 screens, WU3 component deletions, WU4 tests + i18n + specs.
- Files: `frontend/lib/dashboard/transforms.ts`, `frontend/lib/api/{dashboard,finance}.ts`, `frontend/lib/finance/finance.ts`, `frontend/components/containers/{DashboardHome,FinanceScreens,ReportsScreens,ProgressScreens}.tsx`, `frontend/components/finance/{AnalysisSection,ManualCapture,TransactionsLedger}.tsx`, `frontend/components/ui/{BalanceChart,SavingsChart,MonthlyExpensesChart,MonthCompareChart,CategoryDonut}.tsx`, the listed test files, `frontend/lib/i18n/es.ts`, `objetivo.md`, canonical `openspec/specs/{frontend-dashboard,dashboard-widgets,reports-screen,progress-score,finance-accounts,frontend-i18n}/`.

### S3b-WU1 — Transforms and API layer

- [ ] Add to `frontend/lib/dashboard/transforms.ts`: `toMonthlyCost` (daily×30, weekly×52/12, biweekly×26/12, monthly×1, quarterly÷3, semiannual÷6, annual÷12; inactive excluded; unknown frequency excluded, never a 1× assumption; empty/undefined → 0), `toOutstandingDebt`, `toTotalSavings`, `toFinanceSnapshot`, `toFinanceScore` (100·(netWorth+savings)/(netWorth+savings+debt), clamped 0..100, `null` when all three inputs are zero). <!-- sdd-owner: implementation -->
- [ ] Delete from `frontend/lib/dashboard/transforms.ts`: `toFlowPoints`/` (read-only)FlowPoint`/` (read-only)MonthlyFlowWire`, `toDonutSlices`/` (read-only)CategoryWire`/` (read-only)DonutSlice` (after confirming no surviving consumer), `savingsRate`, `monthBalance`, `toMonthIncome/Expense/Savings`, `toMonthSummary`, `worstAlertLevel` and `longestStreak` (only after the orphan sweep confirms no surviving consumer). <!-- sdd-owner: implementation -->
- [ ] Update `frontend/lib/api/dashboard.ts`: `DEFAULT_DASHBOARD_LAYOUT` → the 6 widgets in default order 20,21,22,23,24,30; delete `MonthlyFlowRowWire`, `CategoryTotalWire`, `BudgetWire`, `useMonthlyFlow`, `useSpendByCategory`, `useBudgets`; keep `resolveDashboardLayout`/` (read-only)isWidgetVisible`/` (read-only)buildNextLayout` unchanged (stale ids already ignored). <!-- sdd-owner: implementation -->
- [ ] Update `frontend/lib/api/finance.ts`: delete the transactions block; change `patchAccount(id, {balance})`; drop `transaction_id` from `DebtPaymentWire`. <!-- sdd-owner: implementation -->
- [ ] Update `frontend/lib/finance/finance.ts`: delete `LedgerRow`/` (read-only)toLedgerRows`/` (read-only)ledgerKey`, `FlowLike`/` (read-only)toMonthOverMonth`/` (read-only)toBalanceSeries`/` (read-only)toSavingsSeries`/` (read-only)toExpenseSeries`/` (read-only)toMonthCompare`/` (read-only)MonthCompare`, `toInsights` + insight types (`Insight`, `InsightsInput`, `MomDirection`, `BudgetInsightLike`); keep `PeriodSel`/` (read-only)toPeriodRange`/` (read-only)toEventRange` for the reports selector. <!-- sdd-owner: implementation -->

### S3b-WU2 — Screens

- [ ] Rewrite `frontend/components/containers/DashboardHome.tsx`: delete the 4-card metric row (D5), the flow/budget/category widgets, the three month-split blocks and the removed hooks/imports; rebuild the strip from the five live sources (`useNetWorth`, `useAccounts().length`, `useSubscriptions` + `toMonthlyCost`, `useDebts` + `toOutstandingDebt`, `useSavingsGoals` + `toTotalSavings`); `customizeRows` drops `month-income`/` (read-only)month-expense`/` (read-only)month-savings`; hidden widgets still trigger no fetch. <!-- sdd-owner: implementation -->
- [ ] Rewrite `frontend/components/containers/FinanceScreens.tsx`: delete `ManualCaptureSection`, `TransactionsLedger`/` (read-only)TransferHistory` wrappers, the four flow charts + finance `PeriodSelector` section + income donut + `AnalysisSection`, and the removed hooks/transforms; keep the surviving grid (7+5, 4+4+4, 6+6) and `S5Sections` minus budgets; add the inline balance edit per design §6.2 (current value visible, client guard mirroring `/^-?\d{1,6}(\.\d{1,2})?$/` (read-only) and `|v| < 1e6`, `Cancelar` sends nothing, success revalidates the `finance/` scope, ≥44px control with focus ring and per-account `aria-label`). <!-- sdd-owner: implementation -->
- [ ] Rewrite `frontend/components/containers/ReportsScreens.tsx`: `FinanceBlock` becomes the current snapshot (`useNetWorth` + `useSubscriptions` + `useDebts`, `toFinanceSnapshot`), keep the screen's own `PeriodSelector`, label the block with `reports.financeCurrent`, preserve per-block error isolation and the removal of any aggregate request. <!-- sdd-owner: implementation -->
- [ ] Rewrite `frontend/components/containers/ProgressScreens.tsx`: drop `useMonthlyFlow`; compute the finance area with `toFinanceScore({netWorth, savings, debt})`; rewrite the finance figures to patrimonio / deuda pendiente / ahorro acumulado; keep the disclaimer and the `progress.score.*` keys. <!-- sdd-owner: implementation -->

### S3b-WU3 — Component deletions

- [ ] Delete `frontend/components/finance/AnalysisSection.tsx` and `frontend/components/finance/AnalysisSection.test.tsx` (D1 full deletion), and the `AnalysisSection`/` (read-only)analysis.*` assertions in `frontend/components/finance/jd-round1.test.tsx` and `frontend/lib/i18n/i18n.test.ts:109-118`. <!-- sdd-owner: implementation -->
- [ ] Delete `frontend/components/finance/ManualCapture.tsx` and `frontend/components/finance/TransactionsLedger.tsx`. <!-- sdd-owner: implementation -->
- [ ] Delete `frontend/components/ui/{BalanceChart,SavingsChart,MonthlyExpensesChart,MonthCompareChart,CategoryDonut}.tsx` after verifying each is orphaned (`CategoryDonut`/` (read-only)SavingsChart` may still be used by reports — resolve, then record the decision in the PR body). <!-- sdd-owner: implementation -->

### S3b-WU4 — Tests, i18n, specs

- [ ] Rewrite the affected tests against surviving behaviour: `frontend/components/finance/finance.test.tsx`, `s1-capture.test.tsx`, `jd-round1.test.tsx`, `frontend/lib/finance/finance.test.ts`, `frontend/lib/finance/jd-round1.test.ts`, `frontend/lib/api/dashboard.test.ts`, `frontend/lib/dashboard/transforms.test.ts`, `frontend/components/containers/{DashboardHome,ReportsScreens,ProgressScreens}.test.tsx`, `frontend/lib/i18n/i18n.test.ts` and `frontend/e2e/sections.spec.ts`; add coverage for `toMonthlyCost` (7 frequencies + inactive + unknown + empty), `toOutstandingDebt`, `toTotalSavings`, `toFinanceSnapshot`, `toFinanceScore` (4 cases), the inline balance edit (blocked input sends nothing, cancel sends nothing, success revalidates `finance/`), the 5-KPI strip, the reports snapshot and the progress finance block. <!-- sdd-owner: implementation -->
- [ ] Apply the S3 i18n changes in `frontend/lib/i18n/es.ts`: delete the transaction/ledger/capture/flow/chart/analysis key families from `i18n-candidates.txt`; rewrite `finance.subtitle` and `dashboard.overviewSubtitle` (drop the removed words); add `reports.financeCurrent`, the `progress.financeHint` rewrite and only the missing balance-edit keys (reuse `finance.save`/` (read-only)cancel`/` (read-only)amountCop` where possible); run the orphan sweep over every candidate key and `pnpm tsc --noEmit`. <!-- sdd-owner: implementation -->
- [ ] Spec sync: rewrite canonical `openspec/specs/{frontend-dashboard,dashboard-widgets,reports-screen,progress-score,finance-accounts,frontend-i18n}/spec.md` from the deltas (including the explicit removed-visual inventory and the 6-widget fallback); amend the change delta `openspec/changes/2026-09-23-simplify-finance-productivity/specs/finance-core-invariants/spec.md` one-liner ("financial-charts section" → "financial-charts-and-indicators section"); edit `objetivo.md` charts + "Análisis financiero" block only (D8) with the surviving charts list and the explicit withdrawal note. <!-- sdd-owner: implementation -->
- [ ] Verify S3b: `cd frontend && pnpm test && pnpm tsc --noEmit`; confirm no screen issues a request to a removed endpoint (SWR key audit + `page.route` stub spec); confirm the orphan sweep is clean; re-run `npx playwright test e2e/productivity-layout.spec.ts` to prove Track B did not regress. <!-- sdd-owner: implementation -->

Slice S3b acceptance criteria: `pnpm test` and `pnpm tsc --noEmit` green; no removed component/hook/transform imported anywhere; no request to a removed endpoint on any screen; inline balance edit verified in three states; canonical specs match the code (no false MUSTs); `objetivo.md` charts/analysis reversal recorded with date and reason; no unrelated `objetivo.md` diff.
Slice S3b rollback: `git revert` the slice commit (frontend-only; safe in either order relative to the production run of 0011, but must land before 0011 reaches production).

---

## Parent / lifecycle tasks

Grouped after all implementation work. These are the only actions owned by the parent.

- [ ] Start or reuse bounded review for S4 (evidence gate: before/after metrics, no overflow, ≥44px targets). <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review for S0 and confirm the helper move is behaviour-preserving. <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review for S1 (zero dangling transfer references, guard test preserved, `objetivo.md` block scope respected). <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review for S2 (canonical specs no longer protect budget artefacts, MCP README updated). <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review for S3a (migration + balance write atomicity, 0011 post-conditions, no CASCADE, no `CREATE TYPE`). <!-- sdd-owner: parent -->
- [ ] Start or reuse bounded review for S3b (orphan sweep clean, no removed endpoint requested, canonical specs truthful). <!-- sdd-owner: parent -->
- [ ] L1 — Record the auto-chain decision: no pause before S1, no `size:exception`; each slice is its own stacked PR in the order S4 → S0 → S1 → S2 → S3a → S3b. <!-- sdd-owner: parent -->
- [ ] L2 — Human deploy gate before running migration 0011 against production: explicitly reconfirm the irreversible loss (no backup, no dual read) with the owner, then run 0011 out-of-band with autocommit and record the outcome in the change folder. <!-- sdd-owner: parent -->
- [ ] L3 — Close the change: confirm canonical specs reflect all deltas (or archive the deltas), verify no `objetivo.md` diff outside the three authorized blocks, and record the 0011 production result. <!-- sdd-owner: parent -->
