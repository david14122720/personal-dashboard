# Feature: categories-migration-closure

## Objective

Close the two corroborated WARNING rows of the categories-lifecycle Judgment Day
(`odd/judgment-ledger-categories-crud.md`, `C1` + `C2`) and align the name cap with
the copy the user reads (`C3`). No schema change, no route change, no behavior change
for anything else.

## Problem / Why

Judgment Day round 1 on `dcbbc7d` (revision `c573394`) confirmed by both blind judges:

- **C1 — the legacy migration never closes.** `CustomCategoriesSection.tsx:45-70`
  sets `allOk = false` on any non-409 error and calls
  `localStorage.removeItem(CUSTOM_CATEGORIES_KEY)` only when `allOk` is still true.
  One legacy row the API permanently rejects (the old localStorage writer had no length
  cap; `categories.rs` answers 422 for a name over 80 bytes) keeps the whole key alive,
  so **every** Ajustes mount re-POSTs **every** legacy row.
- **C2 — deleted categories resurrect.** While the key survives C1, the next Ajustes
  mount re-creates rows the user already deleted (the delete endpoint is a hard delete).
- **C3 — the cap counts bytes, not characters.** `validate_category_name` uses
  `name.len() > 80` while the doc comment and the Spanish message say
  "entre 1 y 80 caracteres"; a 41-character accented name is 82 bytes and gets 422.
  `movements.rs:251` already uses `chars().count()` for the same kind of cap.

## Explicitly out of scope

- **C4** (Ajustes lists and deletes every `kind` while its copy says "categorías de
  finanzas"): it is a product decision (filter the section to `finance` vs. relabel it
  as a general manager and warn about `SET NULL` on other modules). Not implemented here.
- Suspect rows `S1`–`S7` from the ledger, including the stale `customCategories.ts`
  header and the unused legacy create/delete helpers.
- Any refactor, rename, dependency, schema migration, or unrelated cleanup.

## Constraints

- `pd-custom-categories` stays the legacy key name and its stored shape is unchanged
  (the legacy envelope is read with `listCustomCategories()`).
- The migration still runs at most once per mount (`migrated` ref) and must never
  re-POST a row that already resolved in an earlier run.
- Spanish user-facing copy; the module keeps its `"use client"` SWR pattern and the
  shared `finance/categories` key.
- No commit, no push, no database access, no Dokploy.
- Test-first: observe RED before GREEN for both tasks.

## Tasks

- [x] **T1 (frontend, route: delegated)** — per-row migration closure in
      `frontend/components/settings/CustomCategoriesSection.tsx`.
      Row outcomes: `201` created and `409` already-exists → **migrated** (drop the row);
      `422`/`VALIDATION_ERROR` → **skipped** (deterministically impossible to migrate:
      drop the row and count it); anything else (network, 5xx, 401) → **pending**
      (keep it for a later attempt). After the loop rewrite `pd-custom-categories` with
      only the pending rows and `removeItem` when none remain; keep the final
      `void mutate("finance/categories")`. When any row was skipped, surface **one**
      honest Spanish message through the existing `setError` slot, naming the count
      (new i18n key in `frontend/lib/i18n/es.ts`).
      Tests in a new `frontend/components/settings/CustomCategoriesSection.test.tsx`
      (MSW + SWR, mirroring `frontend/lib/api/finance-categories.test.ts` style):
      (a) mixed `201/409/422/500` → key keeps only the 500 row and the Spanish message
      shows the skipped count; (b) `201/409` only → key removed; (c) `422` only → key
      removed + message; (d) remount after a partial failure does NOT re-POST an
      already migrated row (assert per-name call counts).
- [x] **T2 (backend, route: delegated)** — `validate_category_name` in
      `backend/src/routes/categories.rs` counts characters
      (`name.chars().count() > MAX_CATEGORY_NAME_LEN`) so the "80 caracteres" copy is
      true. Keep the constant, the trim, and the NUL rejection. Unit tests: 80 accented
      characters accepted, 81 rejected, existing ASCII cases still green.
- [x] **T3 (verify, route: delegated)** — independent verification: focused vitest run
      for the section + `lib/api` categories tests, `tsc --noEmit`, backend
      `SQLX_OFFLINE=true cargo test --offline categories`, i18n parity test. Report exact
      commands and observed results; no database connection.
- [x] **T4 (parent)** — update this document, the ledger escalation block, and the
      Engram mirror; report the verified outcome and the still-open owner decisions
      (`C4`, `S1`–`S7`, commit/push authorization).

## Acceptance criteria

1. A legacy row deleted after being migrated never reappears on a later mount.
2. A legacy row the API permanently rejects no longer blocks the key from clearing, and
   the user is told, in Spanish, how many rows could not be migrated.
3. A transient failure keeps only the unresolved rows, and the next mount retries those
   only.
4. A category name of 80 accented characters is accepted; 81 characters are rejected
   with the Spanish message.
5. `tsc --noEmit`, the focused vitest suites, and `cargo test categories` are green, with
   RED evidence recorded before each fix.

## Progress

- 2026-10-11: document created from the Judgment Day ledger; implementation delegated to
  one bounded writer (single-threaded).
- 2026-10-11: T1+T2 implemented by one bounded writer (`gentle-ai-worker`), test-first.
  RED T1: `vitest run components/settings/CustomCategoriesSection.test.tsx` → 3 failed / 1
  passed. GREEN T1: same command → 4 passed. RED T2: `SQLX_OFFLINE=true cargo test --offline
  categories` → 17 passed / 1 failed (`category_name_cap_counts_characters_not_bytes`). GREEN
  T2: same command → 18 passed / 0 failed. Diff: 3 files changed, 42 insertions(+), 11
  deletions(-), plus the new untracked test file. `tsc --noEmit` clean.
- 2026-10-11: T3 independent verification (`gentle-ai-verify`, read-only, no
  `DATABASE_URL`): focused vitest 4 files / 38 tests passed; `tsc --noEmit` exit 0; `cargo
  test --offline categories` 18 passed; `git status` before and after identical (the four
  claimed surfaces only); per-row classification, key rewrite and no-re-POST reviewed with
  line references; the mixed-outcome test proven to assert stored-key contents and exact
  per-name request counts, not just rendered text; the new backend test proven to
  discriminate against byte counting. Verdict per item: confirmed.
- 2026-10-11: FOLLOW-UP discovered by the writer and confirmed by the verifier (pre-existing,
  not caused by this change): `frontend/app/dashboard/ajustes/page.test.tsx` → 1 failed / 3
  passed — it registers MSW handlers only for `/accounts`, so the categories section stays in
  `Cargando…` and the assertion at `page.test.tsx:69` fails. The writer additionally proved it
  by restoring the HEAD version of the section (identical failure) and then restoring the fix.
  Out of scope here; deserves its own task.
- 2026-10-11: **NOT COMMITTED.** Owner standing rule: no commit/push without an explicit
  order. Follow-up decisions still open: C4 (Ajustes scope/kind), S1–S7 suspects, and the
  `page.test.tsx` mock gap.
