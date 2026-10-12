# Habits Simple Create Form (habitos-form-simple)

## Objective
Simplify the `Add Habit` form in `/dashboard/habitos/` to a name-only input in Control Deck style. The owner rejected the full-field form (direction, frequency, days, target, dates, color, icon, description): "no se supone que deba preguntarme si lo haré diario o no, y las demás tampoco".

## Problem
`HabitCreateForm` asks 10+ fields. Backend only requires `name` + `direction` (`frequency` defaults to `daily`, `start_date` defaults to today). The extra questions add friction and the section looks off next to the Control Deck hero.

## Why
Owner decision: creating a habit should be typing its name and hitting create. Sensible defaults (`direction: "build"`, backend defaults for the rest) cover the common case; advanced fields can return later if ever needed.

## Scope
- Frontend only. No backend changes.
- T1: shrink `HabitCreateForm` to name-only + submit/cancel + success/error states, Control Deck coherent styling (dark glass card, signal accent, Jakarta display font classes already in use).
- T2: test coverage for the simplified flow (page test: form opens; submit name-only posts `{name, direction:"build"}` and shows success; 409/422 surface neutral-ES errors).

## Constraints
- Technical artifacts in English; UI copy in neutral Spanish.
- `createHabit({name, direction: "build"})` — no other payload keys.
- Keep `aria-label={t("productivity.tracker.createTitle")}` ("Nuevo hábito") on the form so the page test anchor holds.
- Keep `HabitsSection` toggle (`aria-expanded`) intact.
- Unused `tracker.create*` i18n keys stay (harmless, avoids churn); reuse `createName`, `createNamePlaceholder`, `createDuplicate`, `createInvalid`, `createSuccess`, `productivity.requiredError`, `productivity.create/cancel/saving`, `productivity.saveFailed`.
- Perf/style: existing `dynamic`/SWR/`memo` untouched.

## Checklist (stable IDs)
- [ ] T1 — Name-only form: single required name input (maxLength 200, trim, non-empty validation), submit posts `{name, direction:"build"}`, revalidates `HABITS_TODAY_KEY` + `dashboard/habits-today`, resets + `onCreated` on success, neutral-ES 409/422 errors. Control Deck styling matching the hero card.
- [ ] T2 — Tests: page test still opens the form; new/updated coverage asserting name-only submit payload and success/error states.

## Authorized scope
Only T1-T2 above. No habit edit/delete/archive. No productivity/dashboard/finance changes. No backend changes. No push/PR without explicit order.

## Acceptance criteria
- `/dashboard/habitos/` Add Habit opens a form with exactly one input (name) + create/cancel.
- Submit with a name creates the habit with defaults; empty name shows required error client-side.
- 409 duplicate / 422 validation show neutral-ES messages; success shows confirmation and closes/resets.
- `tsc` + affected tests green.

## Applicable checks
- `pnpm --dir frontend test` (`vitest run`) — affected files only.
- `node ./frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`.
- No backend checks.

## Progress
- 2026-09-20: branch `feat/habitos-form-simple` created from `main`. T1-T2 pending.
- 2026-09-20: T1+T2 implemented via worker (name-only form + 2 page tests). Verified: `tsc --noEmit` exit 0, `vitest run app/dashboard/habitos/page.test.tsx` 8/8 passed. Committed as work-unit (see Commits). Awaiting owner paste (`habitos.md` instructions) before merge/push/deploy.

## Verification evidence
- (pending)
- T1: tests + `tsc`: pending.
- T2: form-flow tests: pending.

## TDD mode + runner
- TDD mode: DISABLED.
- Runner: `pnpm --dir frontend test` + node typescript bin. Record `<cmd>: <result>` per task.

## Delivery strategy
- Branch-first (done).
- Work-unit commits (Conventional Commits) on the feature branch. Push/PR only under ordinary policy.
- RDD review mode off; no native review transitions.

## Commits
- (pending push) `feat(habits): simplify Add Habit form to name-only` — HabitCreateForm + page.test.tsx (tsc 0, vitest 8/8)
