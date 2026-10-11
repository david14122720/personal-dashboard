# Judgment ledger — categories lifecycle (round 1, blind dual)

## Target (frozen)
- Change: `dcbbc7d` "feat(categories): backend-backed create/delete with Ajustes section on the API" (on top of `676bd0a`), inspected at revision `c573394d2b8d6b745b2cabe5cc3adda00949c833` (working tree clean of tracked modifications).
- Frozen target identity: `483d8dc22817ba2df6c5013f6aa0a4d9404cf84d033de8a849949f8ef77c5819` (sha256 over revision + blob hashes of the scope below).
- Scope: `backend/src/routes/categories.rs`, `backend/src/main.rs` (route registration), `frontend/components/settings/CustomCategoriesSection.tsx`, `frontend/lib/settings/customCategories.ts`, `frontend/lib/api/finance.ts`, `frontend/lib/api/finance-categories.test.ts`, `frontend/lib/i18n/es.ts`, `frontend/app/dashboard/ajustes/page.tsx`.
- Why this target: freshest shipped surface (2026-10-10), never adversarially reviewed, writes real rows in the production database, and carries a one-time localStorage data migration plus a delete path with FK side effects and cross-user isolation rules. Money path, movements, accounts/transfers/login and MCP were judged in earlier ledgers.
- Skills passed to both judges: `.agents/skills/rust-best-practices`, `.agents/skills/supabase-postgres-best-practices`, `.agents/skills/next-best-practices`, `.agents/skills/security-and-hardening`, plus `CLAUDE.md`.

## Judges (blind, parallel, identical scope)
- Judge B — role `jd-judge-b` (claude-haiku-5-5, thinking high) — task `mv414sas-2-8krs` — completed: 11 findings (0 CRITICAL, 5 WARNING, 6 SUGGESTION), all `introduced`.
- Judge A — role `jd-judge-a` (model `opencode-go/step-5-preview-free`) — **unusable in this environment**: tasks `mv414sar-1-wzev` and `mv415mew-3-zxy0` both ended `assistant reported an error` after ~12 turns / 11 tool calls with no partial result. Declared fallback: `gentle-ai-verify` (deepseek-v4.1-flash, thinking max), same frozen scope and same output contract — task `mv419040-4-b3fv` — completed: 5 findings (0 CRITICAL, 2 WARNING, 3 SUGGESTION).
- The `review-*` lens roles were tried first and rejected free-text dispatch ("review subagent dispatch contains an unsupported input field"); they only accept the provider-issued lens envelope.

## Findings (merged)
### Corroborated by both judges (5) — still informational: no CRITICAL was reported
- `C1 WARNING` (deterministic, introduced) — **the migration never closes when one legacy row is rejected.** `CustomCategoriesSection.tsx:45-70`: `allOk` is cleared by any non-409 error and `localStorage.removeItem(CUSTOM_CATEGORIES_KEY)` runs only when `allOk`, so a single row the API always rejects (legacy writer had no length cap, `customCategories.ts:91-97`; `categories.rs:139` rejects >80 bytes and NUL with 422) keeps the key forever and every Ajustes mount re-POSTs every legacy row. Judge B `:45-71` + Judge A `:46-70`.
- `C2 WARNING` (deterministic, introduced) — **deleted categories come back.** While the key survives `C1`, each Ajustes mount re-creates the legacy names the user already deleted (`handleDelete` → `DELETE /categories/{id}` is a hard delete), so they reappear in the list and in the expense/income pickers. Judge B `:45-71` + Judge A `:46-70`.
- `C3 WARNING` (deterministic, introduced) — **the 80 limit counts UTF-8 bytes but the copy promises characters.** `categories.rs:139` uses `name.len()` while the doc comment and the Spanish message say "1-80 caracteres"; a 41-character accented name is 82 bytes and gets 422. The repo is inconsistent: `movements.rs:251` uses `chars().count()`. Tests only cover ASCII `"x".repeat(80|81)`. Judge B WARNING + Judge A SUGGESTION.
- `C4 WARNING` (deterministic listing / inferential impact, introduced) — **Ajustes claims to be finance-only but lists and deletes every kind.** `useCategories` → `fetchCategories` calls `GET /categories` with no `kind` filter (`finance.ts:198-208`, deliberate "kind-free set" design) and `DELETE_CATEGORY_SQL` scopes only `id` + `user_id` (`categories.rs:38`), so habit/goal/task/subscription rows appear under the copy "Tus categorías de finanzas" with a working Eliminar that `SET NULL`s references in other modules. Judge B WARNING + Judge A WARNING.
- `C5 SUGGESTION` (deterministic, introduced) — **English text reaches the Spanish UI.** `categories.rs:104` returns "category kind must be one of: …" and `client.ts:18-31` surfaces `VALIDATION_ERROR` verbatim. UI-reachable only from a client that sends a bad kind (the Ajustes form always sends `finance`). Judge B + Judge A.

### Suspect — reported by one judge only, never auto-fixed (7)
- `S1 WARNING` (B) — no failure path revalidates the SWR list: `mutate("finance/categories")` runs only on success (`:85-104`), and `financeConfig` disables `revalidateOnFocus`, so a delete that 404s (stale row) loops on retry and a 409 leaves the list stale.
- `S2 SUGGESTION` (B) — only NUL is rejected: control/zero-width characters accepted, uniqueness case-sensitive, so visually identical duplicates are possible.
- `S3 SUGGESTION` (B) — `UNIQUE(user_id, kind, name)` covers archived rows while `LIST_CATEGORIES_SQL` hides them (`NOT is_archived`), so an invisible archived name yields 409 with no UI path to remove it.
- `S4 SUGGESTION` (B) — `customCategories.ts:3-12` header still says there is no create/delete endpoint; `createCustomCategory` / `deleteCustomCategory` now have no production callers.
- `S5 SUGGESTION` (B) — test gap: nothing covers 409/404 handling, the component migration (409 tolerance, key clearing, partial failure), error-path revalidation, or multibyte limits.
- `S6 SUGGESTION` (B) — the delete confirm ("Esta acción no se puede deshacer") never says that referencing movements/subscriptions lose their category label via `SET NULL`.
- `S7 SUGGESTION` (A) — `pd-custom-categories` is device-global with no user id: on a shared browser the first account to open Ajustes absorbs another user's legacy categories and then clears the key.

Contradictions: NONE. Pre-existing findings: NONE.

## Independent verification (parent, read-only spot-check of both judges' claims)
- `CustomCategoriesSection.tsx:45-70` re-read: `allOk` gate and `removeItem` placement confirmed verbatim; `physically` no per-row cleanup exists. `C1`/`C2` are factual, not inferred.
- `categories.rs:35,139-141` re-read: `name.len()` vs "caracteres" confirmed. `C3` factual.
- `finance.ts:198-208` re-read: no `kind` param; comment shows the unfiltered set is intentional design (S-C), so `C4` is a labeling/scope mismatch rather than a broken query — impact (cross-module `SET NULL`) is real.
- `categories.rs:104` + `client.ts:18-31` re-read: English message with `VALIDATION_ERROR` shown as-is confirmed. `C5` factual.
- No build, test suite, or production-database access was used by any judge or by this verification; every claim above is source-level.

## Verdict (terminal)
```yaml
target_identity: 483d8dc22817ba2df6c5013f6aa0a4d9404cf84d033de8a849949f8ef77c5819
round: 1
confirmed: []            # no CRITICAL from either judge
corroborated_info: [C1, C2, C3, C4, C5]
suspect: [S1, S2, S3, S4, S5, S6, S7]
contradictions: []
fix_work_units: []
scoped_rejudgment: not_run
terminal_state: approved
skill_resolution: paths-injected (jd-judge-a unusable → declared fallback gentle-ai-verify)
```

**JUDGMENT: APPROVED ✅** — round 1, 0 confirmed severe findings, 0 fix rounds used, 5 corroborated INFO rows and 7 single-judge suspects escalated to the owner as human decisions.

## Escalated to the owner (recommended, not authorized by this ceremony)

1. `C1` + `C2` — **ADDRESSED** by ordinary ODD follow-up work (`odd/tasks/categories-migration-closure.md`, T1) on the owner's explicit authorization: the migration now resolves each legacy row independently (201/409 migrated, 422/`VALIDATION_ERROR` skipped and reported in Spanish, anything else pending), rewrites the key with only pending rows and removes it when none remain, so the key closes and deleted categories can no longer resurrect. Written test-first, independently verified. Uncommitted: commit/push remain the owner's decision.
2. `C4` — **STILL OPEN (product decision)**: either filter the Ajustes section to `finance` or relabel it as a general category manager and warn that deleting detaches other modules' references. Must respect the deliberate "kind-free set" for pickers/charts.
3. `C3` — **ADDRESSED** in the same follow-up (T2): `validate_category_name` counts characters, matching `movements.rs:251` and the Spanish copy. Uncommitted.
4. `S1`–`S7` — **STILL OPEN as info**: no failure-path revalidation (`S1`), control-char/case duplicates (`S2`), 409 from invisible archived rows (`S3`), stale `customCategories.ts` header and dead helpers (`S4`), remaining test gaps (`S5`), delete-confirm copy omitting the `SET NULL` effect (`S6`), device-global legacy key on a shared browser (`S7`).
