# Feature: categories-crud

## Objective

Give the owner real backend-backed finance categories: create and delete
categories from Ajustes, and have them listed in the Agregar gasto / Agregar
ingreso modal (which already reads `GET /categories`).

## Problem / Why

- Prod `categories` table has 0 rows (wiped 2026-10-06, never reseeded).
- The backend exposes only `GET /categories` — no create/delete endpoint.
- Ajustes "Categorías" is a localStorage-only system (`pd-custom-categories`)
  that by design never reaches the API or the movement selects. Proven E2E
  (2026-10-10): a category created in Ajustes stays in localStorage, DB keeps
  0 rows, the modal keeps showing only the placeholder.
- Owner authorized the full fix: create + delete categories, listed correctly
  in the expense/income modal.

## Scope

- Backend: `POST /categories` (201) + `DELETE /categories/{id}` (204).
- Frontend: `CustomCategoriesSection` rewritten onto the backend API, with a
  one-time migration of existing localStorage customs; modal needs NO change
  (it already lists backend categories via `useCategories`).
- Kind for Ajustes-created categories: `finance` (default when omitted).
- Spanish user-facing messages (frontend shows VALIDATION_ERROR/CONFLICT as-is).

## Constraints

- NO schema migrations. `UNIQUE(user_id, kind, name)` stays; duplicate → 409.
  `movements.category_id ON DELETE SET NULL` makes delete safe (verify
  `subscriptions.category_id` FK too; if RESTRICT, pre-check and 409 in Spanish).
- Every query scoped by `user_id`; foreign/missing ids → 404 (never leak).
- No `git commit`, no `git push` (standing owner prohibition).
- Backend DB tests run against the PRODUCTION database with throwaway users
  only (existing `db_state`/`cleanup_user` pattern); owner rows are untouchable.
- Follow existing handler patterns (`create_account_handler`, `map_account_db_err`,
  `deny_unknown_fields`, `validate_category_kind`).

## Tasks

- [x] **T1 (backend, route: delegated)** — `POST /categories { name, kind? }`
      → 201 `CategoryResponse`. Trimmed name 1..=80 chars, no null bytes;
      kind optional default `finance`, validated via `validate_category_kind`;
      23505 → 409 CONFLICT (Spanish), else 422/500 per conventions. Unit tests
      for validators.
- [x] **T2 (backend, route: delegated)** — `DELETE /categories/{id}` → 204,
      scoped `WHERE id=$1 AND user_id=$2`; missing/foreign → 404. Verify FK
      behavior on `subscriptions.category_id` first. Handler tests (create then
      delete, foreign id 404, delete nulls movement `category_id`).
- [x] **T3 (backend, route: delegated)** — Register both routes in `main.rs`
      (`{id}` path style like `/tokens/{id}`); run
      `SQLX_OFFLINE=true cargo test --offline categories` green.
- [x] **T4 (frontend, route: delegated)** — `createCategory`/`deleteCategory`
      in `lib/api/finance.ts` + MSW tests (mirror `finance-subscriptions.test.ts`
      style); new i18n keys in `lib/i18n/es.ts` as needed.
- [x] **T5 (frontend, route: delegated)** — Rewrite `CustomCategoriesSection`
      onto the backend (SWR `finance/categories`, revalidate movement selects
      after create/delete); one-time migration of `pd-custom-categories`
      localStorage rows via POST (tolerate 409 duplicates, then clear the key);
      update the section copy (no longer local-only).
- [x] **T6 (verify, parent)** — `tsc --noEmit`, full targeted vitest run,
      Playwright E2E on prod-build + prod DB (throwaway user): create category
      in Ajustes → appears in modal; delete → disappears; report evidence.

## Acceptance criteria

1. Category created in Ajustes persists in prod `categories` (kind `finance`).
2. It appears in the Categoría select of Agregar gasto / Agregar ingreso.
3. Deleting it removes it from the select; existing movements keep audit
   (`category_id` SET NULL, no data loss).
4. Duplicate name → honest 409 message in Spanish; no cross-user leaks (404).

## Progress

- 2026-10-10: document created; implementation delegated (one writer).
- 2026-10-10: T1–T6 done and verified. Evidence: cargo test categories 17 passed;
  vitest finance-categories 2 passed; tsc clean; API contract 201/409-ES/422/204/404
  checked with curl; Playwright E2E on prod-build + prod DB (throwaway user,
  deleted after): legacy localStorage migrated, created "Alquiler E2E" listed in
  modal, deleted → gone from modal. NO commit/push per owner prohibition.
  Follow-up suggested: remove now-unused `frontend/lib/settings/customCategories.ts`.
  Work-unit commit: `dcbbc7d` (feat, code+tests).
