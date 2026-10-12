# Feature: categories-finance-only

## Objective

Close corroborated WARNING row `C4` of the categories-lifecycle Judgment Day
(`odd/judgment-ledger-categories-crud.md`) and repair the pre-existing Ajustes page
test gap discovered by the previous feature.

`C4`: the Ajustes categories section claims to be finance-only — its hint reads "Tus
categorías de finanzas" and the page subtitle reads "Cuentas bancarias y categorías para
tus finanzas" — while `useCategories()` calls `GET /categories` with **no** `kind` filter
and `DELETE /categories/{id}` deletes any owned row, so habit/goal/task/subscription rows
were listed there with a working Eliminar that `SET NULL`s other modules' references.

Owner direction (in-session, 2026-10-11): "en ajustes yo puedo crear las categorias y en
finanzas al agregar un gasto o un ingreso yo las puedo listar y elegir" → the section
becomes **finance-only**; the deliberate kind-free pickers/charts stay untouched.

## Problem / Why

- `frontend/components/settings/CustomCategoriesSection.tsx:41` reads
  `useCategories()` → `fetchCategories()` → `apiGet<CategoryWire[]>("/categories")`
  (`frontend/lib/api/finance.ts:201-211`), i.e. every `kind`.
- `backend/src/routes/categories.rs:38` (`DELETE_CATEGORY_SQL`) scopes only `id` +
  `user_id`, so a row of any kind is deletable through the section's button, and every
  `category_id` FK is `ON DELETE SET NULL`.
- The kinds are functional, not decorative: habits require an owned `kind='habit'`
  category, goals `kind='goal'`, tasks `kind='task'`, subscriptions `kind='subscription'`
  (`backend/src/routes/{habits,goals,tasks,subscriptions}.rs`).
- The only UI that creates rows in `categories` is this section, and
  `createCategory()` always sends `kind: "finance"` (`frontend/lib/api/finance.ts:216`),
  so non-finance rows can only be created through the API/MCP today.
- The kind-free set is deliberate for the pickers and charts
  (`frontend/components/containers/FinanceScreens.tsx:253`) and must not change; a
  kind-filtered hook already exists and is idiomatic: `useFinanceCategories()` →
  `GET /categories?kind=finance`, SWR key `finance/categories-finance`
  (`frontend/lib/api/finance.ts:54-65`).
- Pre-existing, unrelated: `frontend/app/dashboard/ajustes/page.test.tsx` failed
  1 of 4 tests because its MSW server registered handlers only for `/accounts`, so the
  categories fetch failed and the `Sin categorías aún` assertion at `page.test.tsx:69` was
  unreachable — it also masked a latently racy synchronous delete assertion in the same
  test.

## Decision

Filter the section to finance:

1. Read through `useFinanceCategories()` (`GET /categories?kind=finance`).
2. Never render a row whose `kind !== "finance"`, even if a response contains one
   (the Eliminar button must be unreachable for another module's category).
3. After create, delete and the legacy migration loop, revalidate **both**
   `finance/categories-finance` (this section) and `finance/categories` (the kind-free
   source of the Finanzas pickers/charts), so a category created here still appears in
   the expense/income selects.
4. The existing Spanish copy stays as-is: under this direction it becomes **true** — no
   i18n change is expected.

## Explicitly out of scope

- Suspect rows `S1`–`S7` (`S6`'s delete-confirm `SET NULL` copy included).
- Any change to `useCategories()` or its consumers (`FinanceScreens`,
  `MovementsSnapshot`, `ExpensePieSection`, `finance/compare`, `SubscriptionsSection`):
  the kind-free picker/chart set is deliberate.
- Backend routes, SQL, validation, and the generic `DELETE /categories/{id}` contract.
- `C5` (English 422 message reaching the Spanish UI).
- Any refactor, rename, dependency, schema migration, or unrelated cleanup.

## Constraints

- No schema change, no backend change, no i18n copy change.
- Test-first: RED observed before GREEN for each task.
- Spanish user-facing copy; the module keeps its `"use client"` SWR pattern.
- No commit, no push, no database access, no Dokploy.
- Single-threaded: one bounded writer, then one independent verifier.

## Tasks

- [x] **T1 (frontend, route: delegated, first)** — repair
      `frontend/app/dashboard/ajustes/page.test.tsx`: add stateful MSW handlers for
      `GET`/`POST`/`DELETE` `/api/categories` (in-memory list reset between tests) so the
      four existing tests pass with their current assertions intact, including the query
      string the section will use after T2.
- [x] **T2 (frontend, route: delegated)** — `C4` in
      `frontend/components/settings/CustomCategoriesSection.tsx` + its test:
      finance-only read, defensive render filter, double revalidation, module doc comment
      updated. Tests must prove (a) the outgoing request carries `kind=finance`,
      (b) a non-finance row in the response is not rendered, (c) a create from the section
      is visible to a mounted `useCategories()` consumer (or an equally honest proof of
      the double revalidation), and (d) the four existing migration tests stay green.
- [x] **T3 (verify, route: delegated)** — independent verification: focused vitest run
      for both touched test files + `tsc --noEmit`, read-only; confirm no `useCategories()`
      remains in the section, the defensive filter exists, both keys are revalidated, no
      other consumer changed, and the new tests discriminate (fail if the fix is
      reverted).
- [ ] **T4 (parent)** — update this document, the ledger escalation block and the Engram
      mirror; report the verified outcome and the still-open owner decisions (`S1`–`S7`,
      commit/push authorization).

## Acceptance criteria

1. The Ajustes section lists and can delete only `finance` categories; deleting another
   module's category from the UI is structurally impossible.
2. A category created in Ajustes still appears in the Finanzas expense/income selects
   (both SWR keys revalidated).
3. The kind-free pickers/charts and every other consumer behave exactly as before.
4. `frontend/app/dashboard/ajustes/page.test.tsx` → 4 passed / 0 failed.
5. `tsc --noEmit` and the focused vitest suites are green, with RED evidence recorded
   before each fix.

## Adjacent fix — DashboardHome date-bomb test (owner-authorized in-session, same branch)

Owner decision 2026-10-11: fix it now, in this branch, without committing.

- Symptom: the full-suite gate failed `frontend/components/containers/DashboardHome.test.tsx:126`
  (`getByText("Music")`) because the fixture pinned `Music.next_billing_on = "2026-10-05"`
  while `UpcomingSubs.tsx:46-53` filters `next_billing_on >= todayInBogota()`; from
  2026-10-06 on the row is correctly excluded. Pre-existing (last touched by `8dbf7c9`),
  identical to `main`, unrelated to `C4`.
- Fix (test-only): the three `financeSubs.next_billing_on` values now come from a local
  `daysFromToday(offset)` helper built on the real `todayInBogota()` — the same clock the
  widget reads — with margins that make a Bogotá-midnight skew harmless (`+2`, `-10`, `+3`).
  `last_paid_on` stays static on purpose: only `next_billing_on` is compared against today
  (`isPaidThisCycle` checks `next_billing_on > today`).
- Why not freeze the clock (`vi.useFakeTimers()` + `vi.setSystemTime`, the
  `ExpensePieSection.test.tsx:69-71` pattern): freezing "today" for the whole file would move
  every widget's window in a 300+-line file whose other assertions were never written
  against a frozen date. Deriving the fixture from the app clock is surgical and cannot rot
  again.
- Not a production bug: excluding a past `next_billing_on` is the widget's intended
  behavior (“past excluded”).

## Progress

- 2026-10-11: document created; direction confirmed with the owner in-session (filter to
  finance, flow Ajustes-creates → Finanzas-picks preserved). Branch
  `feat/2026-10-11-categories-finance-only` created from `main`. Implementation delegated
  to one bounded writer (single-threaded).
- 2026-10-11: T1+T2 implemented by one bounded writer (`gentle-ai-worker`), test-first. RED
  T1: `pnpm vitest run app/dashboard/ajustes/page.test.tsx` → 1 failed / 3 passed
  (`page.test.tsx:69` unreachable, no `/api/categories` handler). GREEN T1: same command →
  4 passed. RED T2 (against the unfiltered component): `pnpm vitest run
  components/settings/CustomCategoriesSection.test.tsx` → 2 failed / 5 passed (the request
  lacked `kind=finance`; the `habit` row `Salud` rendered). GREEN T2: same command →
  7 passed. TRIANGULATION: removing `void mutate("finance/categories")` from
  `revalidateCategorySources` makes the kind-free-consumer test fail (`Nueva` not found);
  restored → 7 passed, so test (c) discriminates the double revalidation. Writer report:
  3 files changed, 156 insertions(+), 17 deletions(-); `tsc --noEmit` exit 0.
- 2026-10-11: T3 independent verification (`gentle-ai-verify`, read-only, on hashes
  `page.test.tsx b3e1cc39…`, `CustomCategoriesSection.test.tsx a579de2c…`,
  `CustomCategoriesSection.tsx aff27a9f…`): claims 1–5 CONFIRMED with line references
  (`CustomCategoriesSection.tsx:11,56` hook; `:30-32` helper; `:106,121,135` call sites;
  `:145` render filter; `finance.ts:56,61-63,207`). The verifier re-ran the commands:
  focused vitest 2 files / 11 tests passed; `tsc --noEmit` exit 0.
  `git diff --name-only HEAD` = exactly the three surfaces; `frontend/lib/i18n/es.ts` and
  `backend/` untouched; `FinanceScreens.tsx:220` still kind-free. The `waitFor` wrapper
  (matcher text unchanged) is justified, not masking: delete is genuinely async and the
  assertion still fails on a broken delete or stale revalidation. No `.only`/`.skip`. The
  verifier changed nothing tracked (`tsconfig.tsbuildinfo` byte-identical, sha256
  `9e96865b…`).
- 2026-10-11: Residual risks accepted and recorded: the writer's RED outputs and its
  triangulation are historical (the read-only verifier reproduced only the
  reversion-fails analysis); the kind-free revalidation from the migration and delete
  paths is exercised through the shared helper while the consumer test asserts the create
  path; "structurally impossible" is UI-level — `DELETE /categories/{id}` still accepts any
  owned id by design; the consumer test is coupled to SWR internals; default 1s `waitFor`
  timeout could be tight on a very slow host.
- 2026-10-11: Full-suite gate (`gentle-ai-verify`, read-only `cd frontend && pnpm vitest run`):
  **1 failed / 576 passed (577), 52 files, 34.24s, no skips.** The only failure is
  `frontend/components/containers/DashboardHome.test.tsx:126` (`getByText("Music")`) — a
  pre-existing date-dependent fixture: the test pins `Music.next_billing_on = "2026-10-05"`
  while `UpcomingSubs.tsx:46-53` filters `next_billing_on >= todayInBogota()`, so from
  2026-10-06 on the row is correctly excluded. The three changed surfaces are absent from
  that test's import graph, `git diff --stat HEAD` and `main..HEAD` for
  `DashboardHome.test.tsx`, `DashboardHome.tsx` and `UpcomingSubs.tsx` are both empty, and
  the file was last touched by `8dbf7c9` (2026-10-03). The parent re-checked the fixture,
  the filter and the empty diff independently: unrelated, out of scope, reported. The run
  changed no tracked file; the verifier's flagged worktree mutation
  (`odd/judgment-ledger-categories-crud.md`, +1/−1) is this feature's sibling ledger update
  written by the parent (T4), expected.
- 2026-10-11: Adjacent fix verified (`gentle-ai-verify`, read-only): focused
  `pnpm vitest run components/containers/DashboardHome.test.tsx` → 14 passed; full suite
  `pnpm vitest run` → **52 files / 577 tests passed**, 33.37s, zero failures (the earlier
  `1 failed / 576 passed` is gone); `tsc --noEmit` exit 0. Scope confirmed: three hunks in
  `DashboardHome.test.tsx` (`:3` import, `:17-26` helper, `:37-39` fixture), no assertion
  text changed; `git diff HEAD -- frontend/components/dashboard/widgets/UpcomingSubs.tsx
  frontend/lib/finance/finance.ts` empty; the verifier's commands mutated no tracked file
  (identical pre/post diff hash `555ef572…`). Rot/flake analysis confirmed from the code:
  only `next_billing_on` is compared to today, the `+2/-10/+3` margins tolerate a
  Bogotá-midnight skew of up to 2 days, and `last_paid_on` only feeds the paid sub-label.
  Residual: `movements[].occurred_on` and `last_paid_on` stay static (no consumer compares
  them to today, so no current rot vector); `frontend/tsconfig.tsbuildinfo` remains untracked
  and is not gitignored.
- 2026-10-11: Browser verification (live smoke against the real stack, owner-requested): the
  compiled backend served `frontend/out` on :3000 against the production DB with a throwaway user
  (`--create-user`, deleted afterwards; DB restored to 1 user / 11 categories / 3 movements).
  Playwright ran with the repo's 1.63 driver; the cached browsers are 1208 while that driver
  expects 1243, so it used `PW_EXECUTABLE=<…>/chromium_headless_shell-1208/…` — installing the
  matching browsers remains pending. **10/10 checks green, zero console errors**: (1) API login
  200; (2) seeded `Mercado E2E` (`finance`) and `Salud E2E` (`habit`) through the API; (3) the
  Categorías section lists `Mercado E2E`; (4) **the section does not list the habit row
  (count 0)**; (5) no `Eliminar: Salud E2E` button exists anywhere on the page; (6) a category
  created in the UI (`Cafe E2E 757269`) appears in the list; (7) the Finanzas expense picker
  offers both the pre-existing and the freshly created category. Both screenshots were reviewed
  by the parent.
- 2026-10-11: Observation recorded for the owner (out of scope here): on the same Ajustes page the
  habit category appears as an `<option>` inside the **Suscripciones** section, whose category
  select reads the unfiltered `useCategories()` (`SubscriptionsSection.tsx:59`). Same family as
  `C4` (kind-free where a specific kind would be more precise) but a different surface; the
  Finanzas movement picker lists it too, by the deliberate kind-free design.
- 2026-10-11: Cleanup done: throwaway user deleted (cascade, `DELETE 1`), backend stopped, port
  3000 free, `frontend/.next`, `frontend/out` and `backend/target` removed, `/tmp` artifacts
  deleted, `git status` back to the five modified tracked files plus the expected untracked docs.
- 2026-10-11: **NOT COMMITTED — working tree left for owner review** (owner order "no
  commitees todavía"). Modified tracked files: the three `C4` surfaces,
  `frontend/components/containers/DashboardHome.test.tsx`, and
  `odd/judgment-ledger-categories-crud.md`; new untracked doc:
  `odd/tasks/categories-finance-only.md`. Planned commit split when ordered:
  `fix(settings): manage only finance categories in Ajustes` (3 files) →
  `test(dashboard): derive the upcoming-subscription fixture from the app clock` (1 file) →
  `docs(tasks): record the categories finance-only change and the fixture fix` (2 docs).
  A push to `main` triggers a Dokploy autoDeploy build. Still open from the ledger:
  `S1`–`S7` (including `S6` delete-confirm copy) and `C5`.
