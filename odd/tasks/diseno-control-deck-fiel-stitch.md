# Feature: diseno-control-deck-fiel-stitch

## Objective
Redesign login (`/login`) and the standalone habits section (`/dashboard/habitos/`) to be visually faithful to the Stitch "Control Deck" design (project `Rediseño Dashboard Personal UI/UX`), keeping real auth and real habit data/logic untouched.

## Problem
Current login is a plain card on `bg-deck`; habits page is a bare title + grid. Stitch defines a richer Control Deck language (glass card with top glow, ambient glows + grid pattern, gradient CTA, KPI cards, category tabs, legend, month matrix with streak/% columns, sidebar + header chrome) that the app does not reflect.

## Why
Owner asked explicitly: redesign exactly as in Stitch — login first, habits section as built there — maximum visual fidelity.

## Scope
IN:
- T1: Login page restyle (visual only, same `login()` flow, same guards/redirects).
- T2: Habits page restyle: hero, 4 KPI cards (computed from real data where possible), category tabs (only if data has categories; else omit honestly), legend + HOY pill, month matrix visual upgrade (streak + success columns, today highlight, future dimmed), month controls wired to real month state.
- T3: Shell chrome: sidebar/header adapted to Stitch within AppShell (no duplicate nav systems; mobile tabs preserved).
- T4: Final verification + doc update.
OUT: finanzas, tareas, notas, configuración, backend, migrations, auth logic changes, editing past days (past stays visual-only, today clickable — prior owner decision stands).

## Constraints
- No backend, no migrations. Real data only: `useHabitsToday`, `useHabitsHistory`, `habitStats`, existing log-today flow.
- Copy visible in neutral Spanish; code/comments English. Reuse existing i18n keys; add only missing ones (`login.remember`, `login.forgot`, `login.secureNote`, habits hero/KPI/legend keys).
- Fonts: add Plus Jakarta Sans (display) via next/font or existing font pipeline; Inter already body. No CDN `<script>` tailwind in production code — translate Stitch classes to repo Tailwind v4 tokens.
- Visual tokens: map Stitch palette onto `@theme` (`--color-deck ≈ #0b0f19` base for these surfaces, `--color-signal` ≈ `#38bdf8` accents). Extend theme minimally; no global restyle outside login + hábitos + shell chrome.
- Reduced motion respected (`usePrefersReducedMotion`, existing `animate-glow-pulse` may be reused subtly).
- Tests: keep `app/login/page.test.tsx`, `app/dashboard/habitos/page.test.tsx`, `HabitsTrackerGrid.test.tsx`, i18n test green; extend where new UI needs coverage.
- Branch: `feat/control-deck-stitch` (from `feat/habitos-apartado` tip `32dbc66`, carries unpushed `156498d`+`32dbc66`). Work-unit commits, no push without owner order.
- TDD: UNKNOWN (no explicit mode configured; vitest runner `cd frontend && npx vitest run`). Ordinary functional checks, no invented RED/GREEN.

## Tasks
- [ ] T1 — Login fiel Stitch. Route: delegated writer (writer trigger: 2+ files). Files: `frontend/app/login/page.tsx`, `frontend/app/login/page.test.tsx`, `frontend/lib/i18n/es.ts` (+ maybe `globals.css` for grid-pattern utility). Acceptance: glass card + top glow + ambient background + gradient CTA + remember/forgot visuals + secure note; submit/pending/error/redirect behavior unchanged; tests green. Checks: focused vitest + `node node_modules/typescript/bin/tsc --noEmit` (NOT bare `npx tsc`, decoy in this repo).
- [x] T2 DONE (`9235905 feat(habits): control deck tracker faithful to Stitch`, 6 archivos +536/-58, sin push): hero + 4 KPI reales + leyenda/HOY + matriz Racha/Éxito + nav mes real; tabs omitidos honestamente (wire sin categoría), CRUD no inventado. Writer: 45/45 + tsc real 0; padre spot-check exit 0.
- [ ] T3 — Shell chrome Stitch (sidebar/header adaptado en AppShell). Route: delegated writer (same writer as T2 if contiguous, else fresh). Files: `frontend/components/layout/AppShell.tsx` (+ tests touching it). Acceptance: dark sidebar language (logo, active glow, user card or logout), breadcrumb header on hábitos; mobile tabs intact; no second nav system. Checks: same + `app/dashboard/habitos/page.test.tsx`, tokens page test.
- [ ] T4 — Verificación final y cierre. Route: parent inline (spot check one command) + doc update. Acceptance: full focused suites green, tsc real exit 0, doc + Engram mirror updated, report with failed/skipped checks honest.

- [x] T3 DONE (`8db8dae feat(shell): control deck sidebar chrome plus Jakarta Sans`, 8 archivos +207/-38, sin push): sidebar Stitch (iconos, glow activo, card logout sin usuario inventado), breadcrumb solo en hábitos, tabs mobile intactos, Plus Jakarta Sans vía next/font variable aplicada solo login+hábitos. Writer: 32/32 + grid 10/10 + tsc real 0; padre spot-check exit 0 + tsc 0.
- [x] T4 DONE (padre inline): suite completa `npx vitest run` 300/300 exit 0 + `node node_modules/typescript/bin/tsc --noEmit` exit 0 sobre `8db8dae`. Sin fallos ni skips. Pendiente manual (no bloquea): `next build` con red (valida descarga real de la fuente) + revisión visual (glow sidebar, breadcrumb, tabs mobile, fuente en login/hábitos).

## Verification evidence
- T1 writer: 18/18 + tsc 0; padre spot 18/18.
- T2 writer: 45/45 + tsc 0; padre spot exit 0.
- T3 writer: 32/32 + grid 10/10 + tsc 0; padre spot exit 0 + tsc 0.
- T4 padre: full suite 300/300 exit 0, tsc real exit 0. Rama `feat/control-deck-stitch`: b2d64e9 + 9235905 + 8db8dae, sin push (aguardando orden del dueño).

## Next step
- DONE: merge FF `156498d..8db8dae` a main + push `origin main` + deploy Dokploy `fhhbVxFYT1qyQEeh90sOo` status `done` (commit 8db8dae, sin error). Solo queda la pasada visual en prod.

## Verification evidence
- (pending)

## Next step
- Branch `feat/control-deck-stitch`, delegate writer T1 (login).
