# Verify report — 2026-10-03-finance-ui-fixes

- change: `2026-10-03-finance-ui-fixes`
- phase: verify
- date: 2026-10-03
- delivery: **code commit + push, no deploy** (the owner first chose local-only, then explicitly authorised `commit + push to main` and took the deploy on themselves) — the code landed as `a7fe0b4`
- verdict: **PASS** — 4/4 requested points implemented and observed live; working-tree gate green; zero console errors

## 1. What was verified, and how

| Layer | Command | Result |
|---|---|---|
| Unit/component (focused, per work unit) | `pnpm test <files>` | W1 26 passed · W2 12 · W3 33 · W4 10 · `finance.test.tsx` 15 |
| Unit/component (full) | `pnpm test` (from `frontend/`) | **418 passed / 44 files, exit 0** |
| Types | `node node_modules/typescript/bin/tsc --noEmit` | exit 0, no output |
| Static export | `pnpm build` | exit 0, 13 routes incl. `/dashboard/finance` and `/dashboard/finance/compare`; `out/` refreshed (2026-10-03 07:31) |
| Live UI (Playwright, Node `@playwright/test` already in the repo — no install) | script `/tmp/verify-uifix.cjs` against the debug backend on `:3010` serving `frontend/out`, `DATABASE_URL` → production | **29/29 checks PASS**, console errors 0, `pageerror` 0, failed requests 0 |

Live environment: ephemeral user `verify-uifix@example.com` (`254309b7-ab98-4530-9efe-ac75815e0d7d`) created with the backend's `--create-user` one-shot, seeded through `odd/tasks/prod-seed-ui-fixes.sql` (2 accounts, 3 categories, 18 movements spread over days 0/1/3/6/12/20/34/50/75/110/175/260/330/600/900/1200/1500 so that all four periods own data). Screenshots in `/tmp/verify-uifix/` (`1440-finance-top`, `1440-movements-15`, `1440-movements-filtered`, `1440-chart-{mes,dia,semana,ano}`, `1440-compare-{mes,dia}`, `768-finance`, `390-finance`).

## 2. Requested points, observed

1. **Cuentas sin redundancia** — each account renders exactly once (`Cuenta Verif` ×1, `Efectivo Verif` ×1), the raw type survives as a chip in the row (`bank`, `cash`), two "Editar saldo" controls, and zero credit-usage progressbars. The `AccountsList` card block, its `LedDot`/`ProgressBar` helpers and the separator wrapper are gone (grep: zero source references).
2. **Movimientos paginados** — 5 rows initially, exactly 5 of 5 with the button; "Ver más" → 15 rows with the first five unchanged (not replaced); second activation → all 18 rows and the control disappears. Changing the "Tipo" filter with 18 rows visible resets the list to 5 while the filter value itself stays `expense`.
3. **Gráfica de categoría** — the div-bars are gone; the section renders a line chart with a Gastos and an Ingresos series (2 `path.recharts-line-curve`), a legend, four period pills (`Día`, `Semana`, `Mes`, `Año`; `Mes` default), a compact Y axis (`0 … 80 k`) and a `Día` view with 14 consecutive points (`21 sept … 3 oct`). All four periods switch and re-render.
4. **Comparar categorías** — same selector, one shared chart with **four** labelled series (`Gastos · Alimentación Verif`, `Ingresos · Alimentación Verif`, `Gastos · Transporte Verif`, `Ingresos · Transporte Verif`), category B dashed; period switching works. Aggregates cross-checked in SQL against the seed: every one of the four series has non-zero values inside the 12-month window, so no line is mute for lack of data.
5. **Responsive** — 768 and 390 both render the single-account-row list and the paginated history; no console errors at any width.

## 3. N per period delivered

| Periodo | N | Unidad | Etiqueta de eje |
|---|---|---|---|
| Día | **14** | día calendario | `3 oct` |
| Semana | **8** | semana que arranca lunes | `sem 28 sept` |
| Mes | **12** | mes calendario | `oct 26` |
| Año | **5** | año calendario | `2026` |

Single source of truth: `TREND_BUCKETS` in `frontend/lib/finance/finance.ts` (`{ day: 14, week: 8, month: 12, year: 5 }`). Changing a number there changes the chart, the compare view and their tests. Buckets are always emitted (empty ones as 0), oldest → newest, the last one being the unit in progress.

## 4. Delta

- 12 tracked files changed: **+856 / −412** (`git diff --stat`), plus 4 new files (227 lines: `CategoryTrendChart.tsx` 98, `TrendPeriodSelector.tsx` 47 and their two test files). Squashed into one code commit: **`a7fe0b4`** — "feat(finance): account de-duplication, movements paging and category trend charts" (16 files, +1083/−412).
- Patch (pre-commit snapshot of the working tree): `odd/tasks/finance-ui-fixes-delta.patch` — 1905 lines, 16 files, sha256 `91fe97048c573edd9191bdd0293ca6885ac4e93c319e197757c27256f9d0c348`.
- The patch was produced with an intent-to-add round trip on the four new files only; `git status --porcelain` was byte-identical before and after, so the index was untouched and nothing was staged. `odd/`, `.pi/`, `.codegraph/` and the generated `frontend/{AGENTS.md,CLAUDE.md,tsconfig.tsbuildinfo}` stayed untracked, matching the repository's existing convention.

## 5. Deviations, findings and follow-ups

| Item | Nature | Detail |
|---|---|---|
| Stale screen-level assertion | **Found and fixed during verification** | The first full-suite run had 1 failure (`finance.test.tsx:181`, still expecting two `progressbar` bars named Gastos/Ingresos). It was a real leftover of this change, not a flake — rewritten to assert the `role="img"` trend chart, its two series and the default period. After the fix: 418/418. The verifier's `pnpm build` ran before this test-only edit; the export is unaffected by test files, and `out/` was regenerated afterwards by the live run's dependency on the current build. |
| Empty-state judgement call (W1) | Accepted | The zero-account `EmptyState` used to live inside `AccountsList`; it was inlined into the surviving container so "Sin cuentas aún" survives and the `finance.noAccounts*` keys do not become orphans. |
| Information lost with the cards | Reported, per design D2 | The alert LED and the credit-card usage bar disappear with the cards. Nobody asked to preserve them. |
| Type label renders raw | Reported (follow-up) | `bank`, `cash`, `digital_wallet` are shown as stored, exactly as the cards did. A Spanish label map is a product decision, not taken here. |
| i18n hygiene | Cleaned | Six keys orphaned by the card removal (`usedAvailable`, `statementBalance`, `ledStatus`, `cardUsageLabel`, `noAccountsForSelect`, `noCategoriesForSelect`) were deleted. `finance.chartExpenses`/`chartIncome` stay (the new series use them). Pre-existing dead keys unrelated to this change (`assetsHint`, `balanceSaved`) were left alone. |
| Test-label nuance | Reported | ICU renders September as `sept` (`sem 28 sept`), so the axis label differs from the `sep` sketch in the design table. Intl was preferred over a hardcoded month table. |
| Pagination is presentation-only | By design (D1) | `GET /api/movements` still returns every row (`no pagination in v1`). With thousands of rows the history would need server-side keyset pagination. |
| No navigation to `compare` | Pre-existing | The compare view remains reachable only through the "Comparar categorías" button, and now also has no e2e spec. |
| `.next/dev` stale strings | Not a defect | The gitignored dev cache under `frontend/.next/` still holds pre-change compiled strings; `out/` was rebuilt and is clean. |

## 6. Database hygiene

- Seed script: `odd/tasks/prod-seed-ui-fixes.sql` (owner-authorised work against the production DB).
- Cleanup executed: `DELETE FROM users WHERE email='verify-uifix@example.com'` → cascade. Post-check: 0 matching users/accounts/categories, **0 orphan movements**, and the database back to the owner's own data (2 users, 4 accounts, 37 movements, 7 categories — no seeded row of mine survives).
- The local backend was stopped; port 3010 is free.
