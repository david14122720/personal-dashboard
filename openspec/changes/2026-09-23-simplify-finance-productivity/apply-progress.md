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
