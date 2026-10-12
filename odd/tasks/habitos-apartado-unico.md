# Habits Single-Owner Section (habitos-apartado-unico)

## Objective
Remove the habits block from `/dashboard/productivity/` and keep `/dashboard/habitos/` as the single owner of the habits tracker, with a working `Add Habit` create flow. No other CRUD, no backend changes.

## Problem
Habits currently live in two places: the productivity screen (`ProductivityScreens` + `HabitsList` + `HabitHistorySection` + `#calendario-habitos`) and the standalone `/dashboard/habitos/` tracker (`HabitsSection` + `HabitsTrackerGrid`). Dual ownership splits attention, duplicates SWR reads (`productivity/habits-today` + range history), and the standalone page has an honestly-disabled `Add Habit` button with no create path.

## Why
Explicit owner decision: drop habits from productivity, keep everything under `/dashboard/habitos` with the tracker, and enable `Add Habit`. This ends the dual-cache/dual-owner confusion and unblocks habit creation without expanding scope to full habit CRUD.

## Scope
- Frontend only. No backend changes.
- T1: strip habits from `ProductivityScreens`.
- T2: keep single-owner habits stack intact (`HabitsSection`, `HabitsTrackerGrid`, `habitStats`, `useHabitsToday`/`useHabitsHistory`/`logHabitToday`).
- T3: add `createHabit(input)` to `frontend/lib/api/productivity.ts`.
- T4: enable the `Add Habit` button in `HabitsSection` with a modal/form + tests.

## Constraints
- Technical artifacts in English; UI copy in neutral Spanish.
- No CRUD beyond create. No backend edits.
- Perf: `client-swr-dedup` (SWR keys, `revalidateOnFocus: false`), `async-parallel` (parallel SWR reads stay parallel), no barrel imports, existing `dynamic` for the evolution chart stays, `memo` in grid stays, trailing slash `/login/` with slash, client-side auth guard intact.
- `HabitsSection` + `HabitsTrackerGrid` + `habitStats` + `useHabitsToday`/`useHabitsHistory`/`logHabitToday` stay intact except T4.
- Nav `AppShell` already has `/dashboard/habitos/`; no nav changes needed.

## Checklist (stable IDs)
- [ ] T1 — Remove productivity habits block: delete `HabitHistorySection` import (l55), `habits` hook (l115), `handleLog` (138-146), `SectionShell` habits (264-283 with `HabitsList` + calendar), clean unused imports (`HABITS_TODAY_KEY`/`logHabitToday`/`useHabitsToday`/`HabitLogStatus`/`HabitsList`), leave `queries=[goals,tasks,events,notes]`. Verify `ProductivitySections.HabitsList` has no other importers before deleting the export; if it has, keep the export but unused in productivity. Update `productivity.test.tsx` habits assertions + empty-state accordingly (tests ship with behavior).
- [ ] T2 — Single owner intact: no edits to `HabitsSection` + `HabitsTrackerGrid` + `habitStats` + `useHabitsToday`/`useHabitsHistory`/`logHabitToday` except T4. Verify `AppShell` nav still links `/dashboard/habitos/`.
- [ ] T3 — `createHabit(input)` in `frontend/lib/api/productivity.ts` via `apiPost("/habits", stripEmptyStrings(input))` mirroring `createGoal`. Exact payload: `{name 1-200 trim, direction build|maintain|reduce|quit, frequency? daily|weekly|monthly|custom, days_of_week? number[] custom→non-empty 0-6 else omit, target_per_period? string >0, start_date? YYYY-MM-DD, end_date? YYYY-MM-DD, category_id? uuid habit-kind, color? <=32, icon? <=64, description? <=2000}`. Surface `ApiError` 409/422. Caller revalidates `HABITS_TODAY_KEY` on success plus `dashboard/habits-today` when present to avoid stale dual-cache.
- [ ] T4 — Enable button in `HabitsSection.tsx:179-187`: replace disabled with modal/form (name required, direction select, frequency select, days selector only when custom, target, dates, color/icon/description optional). Reuse `productivity.save`/`saveFailed`/`requiredError` or add `tracker.create*`. Handle 409 duplicate + 422 validation with neutral-ES messages. Update tests asserting disabled (`habitos/page.test.tsx` 94-101 + `HabitsTrackerGrid.test` i18n assertions) and add create-flow coverage.

## Authorized scope
Only T1-T4 above. No edit/delete/archive habit flows. No productivity redesign. No dashboard/finance changes. No backend, migration, or route-handler changes. No push/PR creation without explicit order (ordinary policy applies).

## Acceptance criteria
- `/dashboard/productivity/` renders goals/tasks/events/notes only; no `HabitsList`, no `#calendario-habitos`, no habits SWR read; `tsc` clean.
- `/dashboard/habitos/` still loads tracker (month grid, KPIs, history via `useHabitsHistory`, today log via `logHabitToday`) with zero regression.
- `createHabit` POSTs `/habits` with stripped payload, mirrors `createGoal`, surfaces 409/422 as `ApiError`.
- `Add Habit` button opens a form, validates required name + custom-days rule client-side, POSTs, revalidates both habits-today keys, shows neutral-ES success/error (409 duplicate, 422 validation), closes/resets on success.
- Affected tests + `tsc` green: `habitos/page.test.tsx`, `HabitsTrackerGrid.test.tsx`, `productivity.test.tsx` (updated), new/updated `createHabit` coverage.

## Applicable checks
- `pnpm --dir frontend test` (`vitest run`) — affected files only per TDD runner rule, plus full-file runs when a test file is touched.
- `npx -y tsc --noEmit -p frontend/tsconfig.json` (or `node` typescript bin if `npx` fails — `npx tsc` is a known decoy in this repo; prefer the real binary).
- No backend checks (no backend changes).

## Progress
- 2026-09-20: branch `feat/habitos-apartado-unico` created from `main`. Feature doc created before first source write. Engram mirror written with full doc content. T1-T4 pending implementation.

## Verification evidence
- (pending — per work-unit commit: `<cmd>: <result>` + commit IDs)
- T1: `pnpm --dir frontend test <affected>`: pending; `tsc`: pending.
- T2: guard/Nav check: pending.
- T3: `createHabit` tests: pending.
- T4: `habitos/page.test.tsx` + grid tests: pending.

## TDD mode + runner
- TDD mode: DISABLED (source: no explicit enable; existing tests do not enable TDD).
- Runner: `pnpm --dir frontend test` (`vitest run`) + `npx -y tsc --noEmit -p frontend/tsconfig.json` (or node typescript bin on `npx` failure). Run affected tests + `tsc` only. Any other required failure = partial. Record `<cmd>: <result>` per task.

## Delivery strategy
- Branch-first (done: `feat/habitos-apartado-unico` from `main`).
- Work-unit commits (Conventional Commits) on the feature branch, one per task (T1, T3, T4; T2 is verify-only, folds into T1 evidence unless it produces a diff). Tests + docs ship with the behavior commit. No cosmetic trimming to fit budgets; 400-line heuristic is advisory-only.
- Commit IDs recorded here under Verification evidence as they land.
- Push/PR only under ordinary policy; do not create without order.
- RDD: `gentle-ai review mode status` = off (`clone-local: off`); no native review transitions initiated. Never infer low-risk from a failed assess.

## Commits
- (pending)
