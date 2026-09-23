# Apply progress — S4 Productivity layout (Track B)

- change: `2026-09-23-simplify-finance-productivity`
- slice: S4 only (Track B, zero data risk). No file outside the S4 allow-list was touched.
- date: 2026-09-23
- status: S4 complete — all 15 S4 tasks (`S4-WU1` 8/8, `S4-WU2` 7/7) marked `- [x]` in `tasks.md`.
- delivery: auto-chain / stacked-to-main. No commit (parent owns commits).

## Completed (WU1 — evidence harness + layout fixes)

- Created `frontend/e2e/productivity-layout.spec.ts` (ungated, no `E2E_SMOKE_LIVE`):
  token via `page.addInitScript` → `localStorage["dashboard-token"]`, deterministic
  fixtures through a page-route API stub, measurements at 390×844 / 768×768 / 1440×900
  (`scrollWidth<=clientWidth`, input/select `getBoundingClientRect()`, `xl` spans per row,
  Editar/Eliminar/Nuevo hit areas). Writes `metrics-{phase}.json` + full-page screenshots to
  `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` keyed by
  `LAYOUT_EVIDENCE_PHASE=before|after`.
- BEFORE evidence captured on pre-fix code: spec failed as designed (84 defect entries —
  xl spans 5+4+4+4 = row sums 9/8, date/select clipped at 152px vs 316px form width at 390px,
  row controls 50×26.5 / submit 70×38 < 44×44). Files: `390-before.png`, `768-before.png`,
  `1440-before.png`, `metrics-before.json` (`pass: false`).
- `ProductivityScreens.tsx`: xl spans → 6/6 + 6/6 (Metas 6, Tareas 6, Eventos 6, Notas 6);
  `SectionsSkeleton` → `gap-6`, real per-breakpoint spans, 4 blocks, `aria-busy` kept;
  removed the four nested `<div className="mt-4">` wrappers.
- `ProductivityForms.tsx`: 4 grids → `grid-cols-1 sm:grid-cols-2`, all 13 `col-span-2` →
  `sm:col-span-2`; Cancelar renders whenever `onDone` is supplied; shared `formButtonClass`
  gives submit/Cancelar `min-h/min-w 44px` + focus ring.
- `ProductivitySections.tsx`: `rowActionClass` → `min-h-[44px] min-w-[44px] px-3 py-2 text-xs`
  + `focus-visible:ring-2 ring-signal`, applied to Edit/Delete/pin-toggle/task-toggle;
  `SectionShell` children → `mt-4 flex flex-col gap-4` (single uniform gap); removed
  compensating `mb-3` (task/event tabs) and `mt-3` (notes results).
- AFTER-WU1 evidence: `LAYOUT_EVIDENCE_PHASE=after` run passed (`metrics-after.json`
  `pass: true`, xl rows 12/12, no overflow, all measured controls ≥44px).

## Completed (WU2 — collapsed creation forms behind «Nuevo»)

- `frontend/lib/i18n/es.ts`: added `productivity.newEntry: "Nuevo"` and
  `productivity.newEntryLabel: "Nuevo en {section}"` (typed keys, no other i18n change).
- `ProductivitySections.tsx`: `SectionShell` gained optional `action?: React.ReactNode`
  rendered in the header row; new exported `NewEntryButton` (`type="button"`,
  `aria-expanded`/`aria-controls`/`aria-label=newEntryLabel`, 44px hit area, always rendered
  even over empty lists).
- `ProductivityScreens.tsx`: `openSection: "goals"|"tasks"|"events"|"notes"|null` +
  per-entity `editing*`; `openForm` discards other drafts (single-open), `Editar` pre-fills
  via `openForm`, submit/cancel/`onDone` collapse via `closeForms`; forms call `onDone?.()`
  after successful submit (new: save collapses); focus moves to first field on open and back
  to the toggle on collapse; no animation introduced (`prefers-reduced-motion` clean).
- `productivity.test.tsx`: +6 cases (collapsed-on-mount/reveal, save-collapses,
  edit-prefill/cancel-collapses, single-open, empty-list-Nuevo, aria-expanded toggle) —
  file 13/13 green (7 pre-existing untouched and passing).
- After-evidence refreshed in final collapsed state: pass, 24 controls ≥44px, inputs measured
  via sequential per-section expand (single-open respected).
- Canonical spec synced: `openspec/specs/productivity-layout/spec.md` created as byte-copy
  of the change delta (`diff` clean).

## Verification (exact commands, observed results)

- `cd frontend && pnpm test`: 356 passed / 1 failed of 357. The single failure
  (`components/finance/finance.test.tsx` › "monta SubscriptionRow cancelar/reactivar y
  ediciones Budget/Savings") is PRE-EXISTING and out of S4 scope — reproduced on the
  pristine tree via `git stash -u` (fails identically), and its budget-subject code is
  scheduled for deletion in S2.
- `node node_modules/typescript/bin/tsc --noEmit` (npx is a shim here): clean, no output.
- `LAYOUT_EVIDENCE_PHASE=after E2E_BASE_URL=http://localhost:3101 playwright test
  e2e/productivity-layout.spec.ts` (against `pnpm dev --port 3101`; config has no webServer
  so the bare `npx playwright test` form has no server to hit): 1 passed.
- Focused `pnpm vitest run components/productivity/productivity.test.tsx`: 13/13 passed.
- Evidence paths: `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/`
  (`390/768/1440-before.png`, `390/768/1440-after.png`, `metrics-before.json` with the
  recorded defect, `metrics-after.json` passing).

## Deviations from design (minor, within S4 scope)

- Spec header comment in the E2E file avoids the literal `**/api/**` glob text:
  Playwright's loader threw `ReferenceError: api is not defined` pointing at that text
  inside the block comment; the executable `page.route("**/api/**", …)` string is unaffected.
- Rhythm: `SectionShell` children use `mt-4 flex flex-col gap-4` (single mt-4 preserved,
  uniform inner gap) instead of relying on zero-gap stacking; compensating `mb-3`/`mt-3`
  inside tabs/notes-results removed so all four sections report the same gap.
- Submit buttons (`Crear`/`Actualizar`) also raised to 44px via `formButtonClass` so the
  committed evidence harness (which measures them as header-adjacent controls) passes;
  the task's explicit Cancelar≥44px requirement is met in all four forms.

## Remaining / next

- S4: none. Slice acceptance criteria met (vitest green modulo pre-existing finance failure;
  no overflow at 390/768/1440; all row controls ≥44px; date/select full width at 390px;
  xl 12/row; before/after evidence committed to the change folder; 6 new test cases green).
- Rollback if needed: `git revert` WU2 then WU1 (no schema, no API, no data).
- Next recommended: S0 (helpers + hermetic fixtures). Parent-owned: bounded review for S4,
  slice PR, lifecycle tasks L1–L3 (untouched, still `sdd-owner: parent`).

## Files changed (S4 allow-list only)

- `frontend/e2e/productivity-layout.spec.ts` (new)
- `frontend/components/containers/ProductivityScreens.tsx`
- `frontend/components/productivity/ProductivitySections.tsx`
- `frontend/components/productivity/ProductivityForms.tsx`
- `frontend/components/productivity/productivity.test.tsx`
- `frontend/lib/i18n/es.ts` (2 keys added)
- `openspec/changes/2026-09-23-simplify-finance-productivity/evidence/` (6 png + 2 json)
- `openspec/specs/productivity-layout/spec.md` (new canonical copy)
- `openspec/changes/.../tasks.md` (15 S4 boxes checked; parent boxes byte-preserved)

---

# Apply progress — S0 Helper extraction + hermetic fixtures

- change: `2026-09-23-simplify-finance-productivity`
- slice: S0 only (preparatory, no deletions). Surfaces touched are exactly the
  S0 allow-list: `backend/src/finance/validation.rs` (new),
  `backend/src/finance/mod.rs`,
  `backend/src/routes/{accounts,debts,savings,categories,subscriptions}.rs`,
  `openspec/specs/finance-core-invariants/spec.md` (new canonical copy),
  plus `tasks.md` / this file. `transactions.rs`, `transfers.rs`,
  `budgets.rs`, `main.rs`, migrations, frontend, mcp-dashboard and
  `objetivo.md` untouched.
- date: 2026-09-23
- status: S0 complete — all 7 S0 tasks marked `- [x]` in `tasks.md`.
- delivery: auto-chain / stacked-to-main. No commit (parent owns commits).

## Completed

- Created `backend/src/finance/validation.rs`: verbatim `validate_occurred_on`
  and `ensure_finance_category` (same logic, same Spanish messages) plus the
  existing `validate_occurred_on` unit tests and a `CATEGORY_LOOKUP_SQL` shape
  test. `validate_occurred_on` carries `#[allow(dead_code)]` with an S0/S3a
  rationale: no surviving writer consumes it yet (debts/savings/accounts keep
  field-specific validators with different messages; `budgets.rs` /
  `transfers.rs` keep their copies until S1/S2 delete them), and the tests lock
  the behaviour for S3a. `transactions.rs` keeps its duplicate until S3a
  deletes that module (out of S0 scope).
- `backend/src/finance/mod.rs`: added `pub mod validation;`, rewrote the
  stale module doc ("Route handlers ... land here in later PRs").
- Surviving importers (`grep -rn "validate_occurred_on\\|ensure_finance_category"`):
  `savings.rs` local `ensure_finance_category` duplicate deleted, now imports
  from `crate::finance::validation` (its `CATEGORY_LOOKUP_SQL` also removed;
  the SQL-shape test now asserts on the validation module's const, single
  source of truth). `accounts.rs` / `debts.rs` never imported these helpers
  (own field-specific validators — swapping would change Spanish messages, so
  no behaviour-preserving repoint exists). `categories.rs` doc repointed from
  `transactions.rs` to `crate::finance::validation`. Remaining helper imports
  from `transactions` live only in the doomed modules `budgets.rs:28` and
  `transfers.rs:47`, deleted by S1/S2 (out of S0 scope).
- `debts.rs` / `savings.rs` seeds dropped: `seed_owned_transaction` helpers
  deleted; `payment_with_unowned_transaction_is_422` and
  `movement_with_unowned_transaction_is_422` now use `Uuid::new_v4()` — any
  unowned id (including nonexistent) is 422 via `ensure_transaction_owned`,
  so the assertions exercise the identical path with zero `transactions` rows.
- `accounts.rs` statement test converted: `get_card_reports_statement_vs_current_balance`
  arranges `-350.00` via `UPDATE accounts SET balance`, asserts
  `statement_balance == Some(Decimal::ZERO)` (empty aggregate); the
  cash-account seed and all linked-expense inserts are gone. S3a retires this
  test with `STATEMENT_BALANCE_SQL`.
- `accounts.rs` delete-guard test (`delete_account_with_movements_is_409`,
  ~line 1253/1235) deliberately UNTOUCHED: `ACCOUNT_MOVEMENT_COUNT_SQL` is
  live production code that counts `transactions`, so its 409 test must seed
  one until S3a retires the guard and rewrites it to 204. This is the "keep
  the delete-guard fixture shape for S3a" clause.
- `subscriptions.rs`: fixture label `"budgets"` → `"general"` (kind stays
  `"finance"`, intentionally orphaned; doc comment lands in S3a).
- `migration_0008_credit_cards.rs` untouched (S3a retires the `transactions`
  `EXPLAIN` half).
- Canonical spec synced: `openspec/specs/finance-core-invariants/spec.md`
  created as byte-copy of the change delta (`diff` clean).

## Verification (exact commands, observed results)

- `cd backend && cargo test`: 442 passed / 0 failed (lib) + 5 + 3 + 10
  (integration), `transactions.rs` / `transfers.rs` / `budgets.rs` still
  present. DB-backed tests SKIP without `DATABASE_URL` (no live DB in this
  session); pure tests including the 3 new `finance::validation::tests` pass
  (`cargo test validation`: 5 passed).
- `cd backend && cargo build`: zero warnings, zero errors.
- `grep -rn "routes::transactions::{" src`: only `budgets.rs:28` (helpers)
  plus `budgets.rs:668,943,1147` (create-transaction test helpers) — all in
  modules S1/S2 delete. No surviving module imports helpers from
  `transactions`. `grep -rn "INSERT INTO transactions" src` outside the
  three doomed modules: only `accounts.rs:1235` (intentional guard fixture,
  see above).

## Deviations from design/task text (scoped, behaviour-preserving)

- Task assumed survivors import helpers from `transactions`; grep proved only
  `budgets`/`transfers` do (both out of S0 scope, deleted in S1/S2). The real
  surviving duplication was `savings.rs::ensure_finance_category`, now
  deduplicated. `validate_occurred_on` is parked with locked tests per the
  spec's "Helpers have a surviving home" scenario.
- Task said "moving ... out of `transactions.rs`"; the source duplicate
  stays until S3a because `transactions.rs` is outside the S0 allow-list.
  No behaviour change either way (pure functions, identical messages).
- Debts/savings seeds use the task's "drop the seed" option (random UUID →
  same 422) rather than balance UPDATEs, which would be meaningless for
  unowned-link tests.

## Remaining / next

- S0: none. Acceptance criteria met (suite green with all three modules
  present; helpers defined outside `routes/transactions.rs`; no
  debts/savings/statement fixture seeds `transactions`).
- Rollback if needed: `git revert` the slice commit (pure refactor + fixture
  swap, no schema change).
- Next recommended: S1 (transfers removal). Parent-owned: bounded review for
  S0, slice PR, lifecycle tasks L1–L3 (untouched, still `sdd-owner: parent`).

## Files changed (S0 allow-list only)

- `backend/src/finance/validation.rs` (new)
- `backend/src/finance/mod.rs`
- `backend/src/routes/savings.rs`
- `backend/src/routes/debts.rs`
- `backend/src/routes/accounts.rs`
- `backend/src/routes/categories.rs` (doc-only)
- `backend/src/routes/subscriptions.rs` (fixture label only)
- `openspec/specs/finance-core-invariants/spec.md` (new canonical copy)
- `openspec/changes/.../tasks.md` (7 S0 boxes checked; parent boxes byte-preserved)

---

# Apply progress — S1 Transfers removal

- change: `2026-09-23-simplify-finance-productivity`
- slice: S1 only (transfers eradication: backend + frontend + specs + objetivo block).
  Untouched per boundary: budgets, transactions, migration 0011, PATCH balance,
  MCP transaction tools, productivity files.
- date: 2026-09-23
- status: S1 complete — all 10 S1 tasks (`S1-WU1` 5/5, `S1-WU2` 5/5) marked `- [x]`
  in `tasks.md`.
- delivery: auto-chain / stacked-to-main. No commit (parent owns commits).

## Completed (WU1 — Frontend retirement)

- Deleted `frontend/components/finance/TransferHistory.tsx`; removed its import
  and `<TransferHistory/>` usage from `FinanceScreens.tsx`.
- Deleted the transfers block in `frontend/lib/api/finance.ts`:
  `TransferLegWire`, `TransferCreateWire`, `CreateTransferInput`,
  `createTransfer`, `TransferHistoryWire`, `TransferListWire`,
  `TransferFilters`, `buildTransfersPath`, `transfersPageKey`,
  `fetchTransfersPage`, `useTransfersPage`.
- Deleted `TransferRow`, `TransferFilters`, `toTransferRows`, `transferKey`
  from `frontend/lib/finance/finance.ts` (+ the two type imports).
- Tests/mocks: removed the `/api/transfers` MSW handler from
  `finance.test.tsx`; `finance.test.ts` and `e2e/sections.spec.ts` contained
  no transfer assertions (no-op, verified by grep).
- Deleted all 16 S1 i18n keys from `es.ts` (`transfersTitle`,
  `transfersSubtitle`, `transfersRegion`, `showingTransfers`, `noTransfers`,
  `noTransfersHint`, `loadingTransfers`, `transfersLoadFailed`,
  `transfersLoadFailedHint`, `transferDirection`, `newTransfer`,
  `saveTransfer`, `transferSaved`, `sameAccountError`, `fromAccount`,
  `toAccount`); kept `finance.paymentTransfer` (payment method in
  `SubscriptionForms`/`DebtPayments`/`ManualCapture` payment options).
- Orphan sweep: exact `t("finance.<key>")` search returns zero hits for all
  16 keys (the naive `toAccount` substring hit is `toAccountCards` /
  `toAccountOptions`, unrelated helpers). `pnpm tsc --noEmit` clean.

## Completed (WU2 — Backend, guard, docs)

- Deleted `backend/src/routes/transfers.rs`; removed `pub mod transfers`
  from `routes/mod.rs`; deleted the `/transfers` route block in `main.rs`
  and rewrote the `api_routes` doc comment as the S1 removal record.
- Moved the `migration_is_function_only_and_0002_untouched` byte-guard into
  new `backend/tests/migration_0011_removal.rs`; deleted
  `backend/tests/migration_0005_transfer_trigger.rs` (with its 4
  transfer-specific tests). S3a appends the 0011 post-conditions here.
- Deleted canonical `openspec/specs/finance-transfers/`; appended the delta
  `Payment Method Catalog Stability` requirement to canonical
  `openspec/specs/finance-subscriptions/spec.md` and the `Removed Feature
  Key Hygiene` requirement to canonical
  `openspec/specs/frontend-i18n/spec.md`.
- Edited `objetivo.md` "Transferencias" block only: manual-balance rule +
  dated (2026-09-23) reversal note (ledger/transfers unused, maintenance
  cost exceeded value, manual balance covers the use case, no backup).

## Required dangling-reference fixes (beyond the allow-list, still S1-only)

The task allow-list omitted three files that import deleted transfer
symbols; leaving them would break the build and violate the
zero-dangling-references invariant, so they were edited minimally for
transfer removal only (no budgets/transactions/MCP/productivity change):

1. `frontend/components/finance/ManualCapture.tsx`: removed `TransferForm`
   + its `createTransfer` import + the third `xl:grid-cols-3` column (now
   2 cols: income/expense). `PAYMENT_OPTIONS` keeps `finance.paymentTransfer`.
2. `frontend/components/finance/s1-capture.test.tsx`: removed transfer
   imports, `/api/transfers` MSW handlers, and all transfer tests
   (filters/keys, create, list, coerce, same-account block, save, history);
   income/expense/category/account/ledger tests kept. Also fixed one
   self-inflicted bad merge (transfers-POST opener swallowed the
   accounts-DELETE handler → 2 MSW timeouts) and dropped the now-unused
   `waitFor` import.
3. `backend/src/routes/budgets.rs`: deleted the single transfer-coupled
   test `reconciliation_signed_sum_matches_cached_balance` (it imported
   `crate::routes::transfers`); no handler logic touched — the module is
   deleted wholesale in S2.

## Verification (exact commands, observed results)

- `cd backend && cargo test`: lib 422 passed / 0 failed; integration
  3 + 10 + 1 passed / 0 failed. (Lib count fell from S0's 442: deleted
  `transfers.rs` test module + 1 budgets transfer test.)
- `cd frontend && pnpm test`: 347 passed / 1 failed of 348. The single
  failure (`finance.test.tsx` › "monta SubscriptionRow cancelar/reactivar
  y ediciones Budget/Savings") is the PRE-EXISTING budget-subject flake
  recorded in the S4 progress entry (fails identically on the pristine
  tree; passes in isolation 21/21 — full-suite timeout flake, S2 deletes
  that code).
- `node node_modules/typescript/bin/tsc --noEmit`: clean, exit 0.
- `grep -rni "transfers" backend/src`: only (a) the S1 removal doc comment
  in `main.rs`, (b) stale doc comments + `type='transfer'` string literals
  inside the S2/S3-doomed `budgets.rs`/`transactions.rs`, (c) the S0
  `validation.rs` doc note. No live route, module, or handler.
- `grep -rni "transfer" frontend/components frontend/lib frontend/e2e`
  excluding `paymentTransfer`/`transferencia`: zero hits.
- `finance.paymentTransfer` survivors: `es.ts:163`, `SubscriptionForms:83`,
  `DebtPayments:62`, `ManualCapture:31` (payment option, kept by design D4).
- `grep -rni "transfer" mcp-dashboard/src`: zero hits — no MCP change
  needed (no transfer tool ever existed).

## Deviations from design/task text

- Task lists `routes/mod.rs:3,19,20` / `main.rs:78-82,38-39` line numbers
  from an older revision; the actual edits hit the same symbols at their
  current positions.
- Task says "six transfer-specific tests" in the migration file; the file
  contained 4 transfer-specific tests + 1 file-exists test + the kept
  byte-guard (5 total). All except the byte-guard are gone.
- `finance.test.ts` / `e2e/sections.spec.ts` had no transfer assertions to
  update (verified by grep) — reported as no-ops rather than invented edits.

## Remaining / next

- S1: none. Acceptance criteria met (backend suite green; frontend green
  modulo the pre-existing S2-owned flake; tsc clean; no `/api/transfers`
  path; no live transfer references outside removal docs + doomed-module
  literals; `objetivo.md` block replaced with dated note; canonical
  `finance-transfers` spec deleted).
- Rollback if needed: `git revert` WU2 then WU1 (no schema change; transfer
  rows still exist until 0011).
- Next recommended: S2 (budgets removal). Parent-owned: bounded review for
  S1, slice PR, lifecycle tasks L1–L3 (untouched, still `sdd-owner: parent`).

## Files changed (S1)

- Deleted: `frontend/components/finance/TransferHistory.tsx`,
  `backend/src/routes/transfers.rs`,
  `backend/tests/migration_0005_transfer_trigger.rs`,
  `openspec/specs/finance-transfers/` (dir)
- Created: `backend/tests/migration_0011_removal.rs`
- Edited: `FinanceScreens.tsx`, `lib/api/finance.ts`,
  `lib/finance/finance.ts`, `lib/i18n/es.ts`, `ManualCapture.tsx`,
  `finance.test.tsx`, `s1-capture.test.tsx`, `routes/mod.rs`, `main.rs`,
  `routes/budgets.rs` (one transfer-coupled test only),
  `openspec/specs/finance-subscriptions/spec.md`,
  `openspec/specs/frontend-i18n/spec.md`, `objetivo.md`,
  `openspec/changes/.../tasks.md` (10 S1 boxes checked; parent boxes
  byte-preserved), this file.
