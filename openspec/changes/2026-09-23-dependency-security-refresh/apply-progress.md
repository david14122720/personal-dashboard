# Apply progress — U2 CI + committed lockfile (atomic)

- change: `2026-09-23-dependency-security-refresh`
- slice: U2 only (merges first, one atomic commit). No file outside the U2 allow-list was touched.
- date: 2026-09-23
- status: U2 implementation complete in the working tree; **not committed** (staging/commits are parent-owned per the delegation contract).
- checkboxes: U2 items 1–3 marked `- [x]` in `tasks.md`; items 4–7 left `- [ ]` with reasons below (no DB available/authorized, clippy not authorized, the drift probe needs a `Cargo.toml` edit outside the allowed surfaces, CI push is parent-owned). This is a documented deviation from "mark all U2 implementation boxes".
- delivery: auto-chain / stacked-to-main. The single U2 commit must carry `backend/Cargo.lock` + `.github/workflows/ci.yml` + `Dockerfile` together.

## Files touched in this delegation

- `.github/workflows/ci.yml` — backend job: `cargo test --offline` → `cargo test --locked` (line 42; the only `--offline` occurrence in the file).
- `Dockerfile` — gated backend build: `RUN cargo build --release` → `RUN cargo build --release --locked` (line 27). Left untouched: the tolerant warm-up dummy build (line 17, `2>/dev/null || true`) and the tolerant `COPY backend/Cargo.lock*` (line 19).
- `backend/Cargo.lock` — current in the working tree (pre-existing refresh preserved: 42 insertions / 51 deletions). Transitive bumps: bitflags 2.13.1→2.13.2, cc 1.4.5→1.4.7, cfg-if 1.0.4→1.0.5, find-msvc-tools 0.1.12→0.1.13, rand 0.10.2→0.10.3, rustls 0.23.44→0.23.45, smallvec 1.16.0→1.16.1, syn 3.0.5→3.0.6, synstructure 0.13.2→0.14.0, tinyvec 1.13.2→1.13.3, toml_edit 0.25.13→0.25.15, unicode-ident 1.0.24→1.0.26, uuid 1.26.0→1.26.1, yoke-derive 0.8.2→0.8.3, zerofrom-derive 0.1.7→0.1.8; `tinyvec_macros` removed. Freshness proven by `cargo build --locked` and `cargo test --locked` (both refuse to run on manifest/lock drift).
- `openspec/specs/build-reproducibility/spec.md` — created as a byte-identical copy of the change delta (`diff` clean); new canonical domain.
- `openspec/changes/2026-09-23-dependency-security-refresh/apply-progress.md` — this file.
- `openspec/changes/2026-09-23-dependency-security-refresh/tasks.md` — U2 checkboxes 1–3 checked.
- `backend/Cargo.toml` — untouched (`git diff backend/Cargo.toml` is empty); no version range widened.

Note: `backend/Cargo.lock` is already tracked in the index today (only its content is modified), so the "newly tracked" wording in `tasks.md` is stale.

## Behind-latest transitives named, not chased

`cd backend && cargo update --dry-run -v` output: `Locking 0 packages to latest compatible versions` with exactly two `Unchanged … (available: …)` entries:

1. **`matchit v0.8.4` (available v0.8.6)** — the dependent declares an exact range: `axum v0.8.9` requires `matchit = "=0.8.4"`. Probe `cargo update --dry-run -p matchit --precise 0.8.6` fails with `failed to select a version for the requirement matchit = "=0.8.4"`. Nothing moves until axum raises its pin.
2. **`crypto-common v0.1.6` (available v0.1.7)** — chain `sqlx-core v0.9.0` → `sha2 v0.10.9` → `digest v0.10.7`, whose declared range is `crypto-common = "0.1.3"` (allows 0.1.7). But `crypto-common v0.1.7` pins `generic-array = "=0.14.7"` while the lock has `generic-array v0.14.9`; probe `cargo update --dry-run -p crypto-common@0.1.6 --precise 0.1.7` reports `Downgrading generic-array v0.14.9 -> v0.14.7`, and plain `cargo update` never downgrades, so the lock keeps 0.1.6. Forcing it would trade a transitive refresh for a downgrade; not chased.

## Verification (exact commands, observed results)

- `cd backend && cargo build --locked`: success — `Finished dev profile [unoptimized + debuginfo] target(s) in 1m 02s` (U2 checkbox 2 evidence).
- `cd backend && cargo test --locked`: success — **395 passed / 0 failed / 0 ignored** across 4 targets: unit `src/main.rs` 372, `tests/migration_0007_goal_progress.rs` 3, `tests/migration_0008_credit_cards.rs` 10, `tests/migration_0011_removal.rs` 10.
- Executed vs self-skipped: `DATABASE_URL` was **unset** in the apply shell, so DB-gated tests self-skipped (their `eprintln!("SKIP …: no DATABASE_URL")` is captured by the harness and does not appear in the pass output). Self-skip sites: **124 unit + 12 integration = 136 of 395**; the remaining **259** tests exercised real assertions. Unit skip sites by module: accounts 13, assets 11, categories 3, debts 13, events 7, goals 5, habits 21, me 2, notes 8, savings 16, subscriptions 6, tasks 8, tokens 7, auth::helper 4. Integration: migration_0007 1, migration_0008 4, migration_0011 7. Consequence: the local run did **not** evidence DB-backed behaviour; the CI Postgres service plus the migration step is the acceptance proof.
- `git check-ignore -v --no-index backend/Cargo.lock`: `.gitignore:5:!backend/Cargo.lock	backend/Cargo.lock` (exit 0). Without `--no-index` the tracked file reports no match (exit 1) — the expected "already tracked, not subject to ignore rules" result.
- `git status --short` after all edits:

```text
 M .github/workflows/ci.yml
 M Dockerfile
 M backend/Cargo.lock
?? .codegraph/
?? .pi/
?? frontend/AGENTS.md
?? frontend/CLAUDE.md
?? frontend/tsconfig.tsbuildinfo
?? odd/
?? openspec/changes/2026-09-23-dependency-security-refresh/
?? openspec/changes/2026-09-23-simplify-finance-productivity/verify-report.md
?? openspec/specs/build-reproducibility/
```

  The `M` entries are exactly the U2 surfaces (the lockfile modification pre-dates this delegation and was preserved). The untracked entries other than the change dir and the new canonical spec directory pre-date this delegation and were preserved untouched.

## Checkbox status

| U2 item | Status | Evidence / reason |
|---|---|---|
| 1 — name behind-latest transitives | `- [x]` | named above with declared ranges; `backend/Cargo.toml` untouched |
| 2 — lockfile fresh and tracked-ready | `- [x]` | `cargo build --locked` green; `check-ignore --no-index` shows the `.gitignore:5` negation; file tracked |
| 3 — land the atomic commit | `- [x]` (edits only) | `ci.yml`, `Dockerfile` and the lockfile are in the working tree; `git add`/commit intentionally left to the parent per the delegation contract |
| 4 — local gate with a real database | `- [ ]` | no `DATABASE_URL` in this environment; applying migrations / connecting a DB was not authorized in this delegation |
| 5 — clippy `-D warnings` | `- [ ]` | not authorized; and the test-target build emits two pre-existing warnings that `-D warnings` promotes to errors: `duplicated attribute` at `backend/src/routes/accounts.rs:919` (test `card_metrics_compute_used_available_usage` runs twice) and `unused variable: app` at `backend/src/main.rs:400` — both outside U2's surfaces |
| 6 — drift probe | `- [ ]` | needs a temporary `backend/Cargo.toml` edit, outside the allowed surfaces; `--locked` drift-failure semantics are cargo-documented and are exercised by CI on the next push |
| 7 — push branch + CI green | `- [ ]` | no push in this delegation (parent-owned) |

## Risks / notes

- The lockfile refresh was already present in the working tree when this slice started; it was preserved, verified fresh, and must ride in the same commit as the two flag changes (atomicity requirement).
- The two pre-existing test-target warnings above mean the U2 clippy gate as written cannot pass without a source edit; if that gate is required, it needs a separate scoped decision.
- `docker build` is not evidenced (no daemon assumed); the root `Dockerfile` change is a one-flag edit verified by inspection only.

---

# Apply progress — U1a TypeScript 7 alone (own PR, own commit)

- change: `2026-09-23-dependency-security-refresh`
- slice: U1a only (frontend TypeScript 5.9.3 → 7.0.2). No file outside the U1a allow-list was touched.
- date: 2026-09-23
- status: U1a implementation complete in the working tree; **not committed** (staging/commits are parent-owned per the delegation contract).
- checkboxes: all seven U1a items marked `- [x]` in `tasks.md`; item 4 covers the manifest edit + lock regeneration only — `git add`/commit is parent-owned — and item 6 is vacuous (no TS 7 errors surfaced). Parent-owned post-apply boxes untouched.

## Files touched in this delegation

- `frontend/package.json` — single-line devDependency edit: `"typescript": "5.9.3"` → `"typescript": "7.0.2"`. No runtime package touched.
- `frontend/pnpm-lock.yaml` — regenerated by `pnpm install` (pnpm 11.23.0). Churn is exclusively TypeScript 7: the `typescript@5.9.3` resolution is replaced by `typescript@7.0.2` plus the new `@typescript/typescript-<platform>@7.0.2` optional packages, and the peer-dependency key strings that embed `typescript@5.9.3` are rewritten to `7.0.2`. No other package resolution changed (`git diff --stat`: 219 insertions / 18 deletions).
- `openspec/changes/2026-09-23-dependency-security-refresh/tasks.md` — seven U1a checkboxes checked.
- `openspec/changes/2026-09-23-dependency-security-refresh/apply-progress.md` — this section.

## Registry verification

- `npm view typescript version` → `7.0.2` (exit 0). The expected pin is the actual latest; no mismatch to record.

## TS 7 preconditions recorded (before editing)

`frontend/tsconfig.json` (verified unchanged after the bump): `target ES2022`, `module esnext`, `moduleResolution bundler`, `jsx react-jsx`. Contains none of the TS 7 removed values (`module` `umd`/`amd`/`system`/`none`; `moduleResolution` `node`/`classic`/`node10`; `target` `es5`). No config migration was needed and none was made.

## Pre-bump baseline (TypeScript 5.9.3)

- `node node_modules/typescript/bin/tsc --noEmit` → exit 0 (`Version 5.9.3`).
- `pnpm run build` → exit 0; Next.js 16.3.4, 11/11 static pages generated (10 routes + `_not-found`).

## U1a ladder (spec order, after the bump)

| Step | Command | Result |
|---|---|---|
| 1 | `pnpm install` | exit 0 — `typescript 5.9.3 → 7.0.2`, lock regenerated |
| 2 | `pnpm test` | exit 0 — 32 test files, 309 tests passed |
| 3 | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 — `Version 7.0.2`, no removed-option error, no `--ignoreDeprecations` needed |
| 4 | `pnpm run build` | exit 0 — 11/11 static pages, static export intact |
| 5 | `pnpm exec playwright test --list` | exit 0 — 15 tests in 7 files |

TS 7 fallout: **none**. No source error surfaced that 5.9.3 tolerated, so no fix commit was needed and the >60-line budget-risk stop did not trigger.

## Extra evidence

- `pnpm install --frozen-lockfile` → exit 0 (`Already up to date`), proving the manifest/lock pair is consistent for CI and the root `Dockerfile`.
- `git diff --stat -- frontend/` → `frontend/package.json` (1 line) + `frontend/pnpm-lock.yaml` only.
- `git diff -- frontend/tsconfig.json frontend/next.config.ts frontend/vitest.config.ts frontend/playwright.config.ts` → empty.
- `frontend/tsconfig.tsbuildinfo` remains untracked and was never staged (nothing was staged in this delegation).

## Canonical spec sync decision

The change delta `specs/frontend-dependencies/spec.md` covers U1a + U1b together (pinned toolchain, TS 7 preconditions, ladder, single build-approval source, no runtime/config surface change). Per the delegation instruction, the canonical `openspec/specs/frontend-dependencies/spec.md` sync is therefore deferred to U1b (and the change's own `tasks.md` S2-WU3 assigns canonical creation to S2). **No canonical spec was created or edited in U1a.**

## Checkbox status

| U1a item | Status | Evidence / reason |
|---|---|---|
| 1 — registry verify | `- [x]` | `npm view typescript version` → `7.0.2` |
| 2 — record preconditions | `- [x]` | tsconfig recorded above; no removed option value present |
| 3 — pre-bump baseline | `- [x]` | tsc 5.9.3 exit 0; build exit 0 (11/11 pages) |
| 4 — pin + regenerate lock | `- [x]` (edits only) | manifest + lock edited together in the working tree; `git add`/commit parent-owned |
| 5 — U1a ladder | `- [x]` | all five steps green, recorded above |
| 6 — fix TS 7 fallout | `- [x]` (vacuous) | no TS 7 error surfaced; nothing to fix |
| 7 — diff surface | `- [x]` | manifest + lock only; tsbuildinfo untracked, not staged |

## Risks / notes

- The lockfile diff is large in raw lines (235 changed lines) but is entirely the TypeScript 7 platform-package matrix; per the parent's decision lockfiles are exempt from the review budget.
- pnpm 11.23.0 emits a standing warning that the `package.json` `pnpm.onlyBuiltDependencies` field is no longer read; that is the S2-WU1/A3 surface, untouched here.
- Playwright `--list` proves collection only; no e2e execution was requested or run in U1a.

---

# Apply progress — U1b frontend runtime and tooling bumps (own PR)

- change: `2026-09-23-dependency-security-refresh`
- slice: U1b only (frontend runtime + dev bumps on top of the U1a TypeScript 7 commit). No file outside the U1b allow-list was touched.
- date: 2026-09-23
- status: U1b implementation complete in the working tree; **not committed** (staging/commits are parent-owned per the delegation contract).
- checkboxes: all five U1b items marked `- [x]` in `tasks.md`; item 2 covers the manifest edit + lock regeneration only — `git add`/commit is parent-owned. Parent-owned post-apply boxes untouched.

## Files touched in this delegation

- `frontend/package.json` — exactly 8 pin edits, no other line: `next` 16.3.4 → 16.3.6, `react` 19.2.8 → 19.3.0, `react-dom` 19.2.8 → 19.3.0, `@types/node` 26.5.0 → 26.6.2, `@types/react` 19.2.18 → 19.3.0, `@types/react-dom` 19.2.7 → 19.3.0, `jsdom` 30.0.1 → 30.1.1, `vitest` 5.0.0 → 5.0.1. `typescript` stays 7.0.2 (U1a); every other entry untouched.
- `frontend/pnpm-lock.yaml` — regenerated by `pnpm install` (pnpm 11.23.0); `git diff --stat` 225 insertions / 237 deletions.
- `openspec/changes/2026-09-23-dependency-security-refresh/tasks.md` — five U1b checkboxes checked.
- `openspec/changes/2026-09-23-dependency-security-refresh/apply-progress.md` — this section.

## Registry verification (`npm view <pkg> version`, each observed)

All 13 packages probed before editing; **no mismatch** — no fallback pinning was needed.

| Package | Registry latest | Expected target | Result |
|---|---|---|---|
| `next` | 16.3.6 | 16.3.6 | pinned |
| `react` | 19.3.0 | 19.3.0 | pinned |
| `react-dom` | 19.3.0 | 19.3.0 | pinned |
| `@types/react` | 19.3.0 | 19.3.0 | pinned |
| `@types/react-dom` | 19.3.0 | 19.3.0 | pinned |
| `@types/node` | 26.6.2 | 26.6.2 | pinned |
| `jsdom` | 30.1.1 | 30.1.1 | pinned |
| `vitest` | 5.0.1 | 5.0.1 | pinned |
| `@testing-library/jest-dom` | 7.0.1 | — | already latest; manifest 7.0.1, untouched |
| `@testing-library/react` | 16.3.3 | — | already latest; manifest 16.3.3, untouched |
| `@vitejs/plugin-react` | 6.1.1 | — | already latest; manifest 6.1.1, untouched |
| `recharts` | 3.10.1 | — | already latest; manifest `^3.10.1`, untouched |
| `@playwright/test` | 1.63.0 | — | already latest; manifest `^1.63.0`, untouched |

## Lockfile churn attribution

Direct bumps: the 8 pins above. Transitive churn attributable to them:

- `next` 16.3.6: `@next/env` and all `@next/swc-*` platform binaries 16.3.4 → 16.3.6.
- `react`/`react-dom` 19.3.0: `scheduler` 0.27.0 → 0.28.0.
- `jsdom` 30.1.1: `@asamuzakjp/css-color` 6.0.7 → 7.0.1, `@asamuzakjp/dom-selector` 8.3.2 → 9.2.1, `@csstools/css-calc` 3.3.0 → 3.4.0, `@csstools/css-color-parser` 4.2.2 → 4.2.3, `@csstools/css-syntax-patches-for-csstree` 1.1.12 → 1.1.14, `@csstools/css-tokenizer` 4.0.0 → 4.0.1, `bidi-js` 1.0.3 → 1.1.0, `html-encoding-sniffer` 6.0.0 → 7.0.0, `w3c-xmlserializer` 5.0.0 → 6.0.0, `whatwg-url` 17.1.0 → 17.1.2; `lru-cache` 11.5.3 added; `symbol-tree` 3.2.4 removed.
- `vitest` 5.0.1: `@vitest/mocker` and `@vitest/spy` 5.0.0 → 5.0.1.
- `@types/node` 26.6.2: the stale peer-context entry `@types/node@24.0.0` and its `undici-types` 7.8.0 are removed; 26.6.2 is the single resolved entry.

Caret floaters: `recharts@3.10.1` and `@playwright/test@1.63.0` did **not** change version — their lock lines moved only as peer-key context rewrites caused by `react` 19.3.0 (same for `react-redux@9.3.0`, `@reduxjs/toolkit@2.12.0`, `use-sync-external-store@1.6.0`, `vite@8.2.2`, `msw@2.15.0`, `sharp@0.35.4`, `styled-jsx@5.1.6`, `swr@2.5.1`, `@inquirer/*`, `@testing-library/*`, `@vitejs/plugin-react`). No caret-floater version churn to attribute.

## U1b ladder (spec order, after the bumps)

| Step | Command | Result |
|---|---|---|
| 1 | `pnpm install` | exit 0 — exactly the 8 bumps listed above; `Done in 25.6s using pnpm v11.23.0` |
| 2 | `pnpm test` | exit 0 — 32 test files, 309 tests passed (vitest 5.0.1, 78.33s) |
| 3 | `node node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| 4 | `pnpm run build` | exit 0 — Next.js 16.3.6 (Turbopack), 11/11 static pages generated, static export intact |
| 5 | `pnpm exec playwright test --list` | exit 0 — 15 tests in 7 files |

No red step; no fix was needed and no refactor was absorbed.

## Extra evidence

- Clean-tree tripwire proof (U1b item 5): `rm -rf node_modules && pnpm install --frozen-lockfile` → exit 0 in 8.3s, node_modules restored; mirrors root `Dockerfile:11` and `.github/workflows/ci.yml:59`.
- `git diff --stat -- frontend/`: `frontend/package.json` (16 lines = 8 pins) + `frontend/pnpm-lock.yaml` only; nothing else.
- `git diff -- frontend/next.config.ts frontend/vitest.config.ts frontend/playwright.config.ts frontend/tsconfig.json` → empty. `frontend/next.config.ts` still has `output: "export"` and `trailingSlash: true`.
- Lockfile resolves the pins: `next@16.3.6`, `react@19.3.0`, `react-dom@19.3.0`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@types/node@26.6.2`, `jsdom@30.1.1`, `vitest@5.0.1`; no `typescript@5.9.3` remains (U1a already verified).
- `frontend/tsconfig.tsbuildinfo` remains untracked (`??`) and was never staged (nothing was staged in this delegation).

## Checkbox status

| U1b item | Status | Evidence / reason |
|---|---|---|
| 1 — probe and record all 13 packages | `- [x]` | registry table above; 8 pinned, 5 recorded already-latest |
| 2 — apply pins + regenerate lock | `- [x]` (edits only) | 8 manifest lines + regenerated lock in the working tree; `git add`/commit parent-owned |
| 3 — run the U1b ladder | `- [x]` | all five steps green, recorded above |
| 4 — no runtime/config surface change | `- [x]` | diff is manifest + lock only; config/source diff empty; `output: "export"` / `trailingSlash` intact |
| 5 — clean-tree tripwire proof | `- [x]` | `pnpm install --frozen-lockfile` exit 0 from a removed `node_modules` |

## Risks / notes

- Not committed: the manifest + lock pair must ride in the same U1b commit (parent-owned).
- pnpm 11.23.0 still emits the `pnpm.onlyBuiltDependencies` "field no longer read" warning — that is the S2-WU1/A3 surface, untouched here.
- Playwright `--list` proves collection only; no e2e execution was requested or run in U1b.
- Lockfile raw churn (462 changed lines) is large but exempt from the review budget per the parent decision.

---

# Apply progress — U3 mcp-dashboard refresh + committed lockfile (own PR)

- change: `2026-09-23-dependency-security-refresh`
- slice: U3 only (MCP toolchain pins, zod 4 one-liners, committed `package-lock.json`). No file outside the U3 allow-list was touched.
- date: 2026-09-23
- status: U3 implementation complete in the working tree; **not committed / not staged** (staging and commits are parent-owned per the delegation contract).
- checkboxes: all ten U3 items marked `- [x]` in `tasks.md`; items 6 (lockfile generation) and 7 (`npm ci` proof) carry documented method deviations below. Parent-owned post-apply boxes untouched.

## Files touched in this delegation

- `mcp-dashboard/package.json` — four pins + `packageManager`:
  - `@modelcontextprotocol/sdk` `^1.12.0` → `1.30.1` (baseline resolved 1.30.0)
  - `zod` `^3.23.8` → `4.6.5` (baseline resolved 3.25.76)
  - `typescript` `^5.5.0` → `7.0.2` (baseline resolved 5.9.3)
  - `@types/node` `^20.12.0` → `26.6.2` (baseline resolved 20.19.43)
  - added `"packageManager": "npm@11.18.0"` (the npm in use: `npm --version` → `11.18.0`)
  - `express` `^5.2.1` and `@types/express` `^5.0.6` left untouched: both already resolve to the registry latest, recorded below
- `mcp-dashboard/src/tools.ts` — exactly two one-liners, no other construct touched:
  - line 36 `const uuid = z.string().uuid();` → `const uuid = z.uuid();`
  - line 73 `email: z.string().email(),` → `email: z.email(),`
  - grep for remaining deprecated chained forms (`.uuid()`/`.email()`/`.datetime(`/`.url()`/`.ip()` on strings) finds only the two new top-level calls; `z.object`, `.min/.max/.optional`, `z.enum`, `z.number().int()`, `z.array`, `z.ZodTypeAny` and `.parse()` are untouched. No `message`→`error` custom-error usage exists in the file, so nothing was touched for it.
- `.gitignore` — `!mcp-dashboard/package-lock.json` inserted immediately after the repo-wide `package-lock.json` line (now line 12). Narrow: no other lockfile negation added.
- `mcp-dashboard/package-lock.json` — generated by `npm install` (was already present untracked on disk from a pre-existing install; regenerated under the new manifest). Never hand-edited. Now untracked-visible (`??`), i.e. tracked-ready for the parent's commit.
- `openspec/specs/mcp-dashboard/spec.md` — three ADDED requirements appended verbatim from the change delta (72 insertions / 0 deletions, `git diff --numstat`), inserted before `## Edge cases`; no existing (MODIFIED-owned) content rewritten.
- `openspec/changes/2026-09-23-dependency-security-refresh/tasks.md` — ten U3 checkboxes checked.
- `openspec/changes/2026-09-23-dependency-security-refresh/apply-progress.md` — this section.

## Registry verification (`npm view <pkg> version`, each observed)

| Package | Registry latest | Expected target | Result |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.1 | 1.30.1 | pinned |
| `zod` | 4.6.5 | 4.6.5 | pinned |
| `typescript` | 7.0.2 | 7.0.2 | pinned |
| `@types/node` | 26.6.2 | 26.6.2 | pinned |
| `express` | 5.2.1 | probe-only | already latest (`^5.2.1` → 5.2.1); manifest untouched |
| `@types/express` | 5.0.6 | probe-only | already latest (`^5.0.6` → 5.0.6); manifest untouched |

No mismatch to record; no fallback pinning was needed.

## Pre-bump baseline

- `npm ls --depth=0`: `@modelcontextprotocol/sdk@1.30.0`, `@types/express@5.0.6`, `@types/node@20.19.43`, `express@5.2.1`, `typescript@5.9.3`, `zod@3.25.76`.
- `npm run typecheck` → exit 0; `npm run build` → exit 0 (TypeScript 5.9.3).

## U3 ladder (spec order, after the bump)

| Step | Command | Result |
|---|---|---|
| 1 | `npm install` | exit 0 — added 1, changed 5, audited 108, 0 vulnerabilities; lockfile regenerated |
| 2 | `npm ci` | exit 0 — added 107 packages, 0 vulnerabilities, no resolution step |
| 3 | `npm run typecheck` | exit 0 — TypeScript 7.0.2, no zod deprecation error from `tools.ts` |
| 4 | `npm run build` | exit 0 — `dist/` rebuilt with TS 7.0.2 |
| 5 | boot + `curl /healthz` | `{"ok":true}` HTTP 200 (port note below) |

Single-resolution proof: `npm ls zod` → `zod@4.6.5` on the direct dependency, deduped under `@modelcontextprotocol/sdk@1.30.1` and `zod-to-json-schema@3.25.2`; exactly one zod 4.x resolution, no mixed 3.x/4.x tree. `npm ls --depth=0` after: sdk 1.30.1, `@types/express` 5.0.6, `@types/node` 26.6.2, express 5.2.1, typescript 7.0.2, zod 4.6.5.

Reproducibility method note: `npm ci` itself removes `node_modules` before installing, so it is the clean-install proof; `rm -rf mcp-dashboard/node_modules` was **not** run because this delegation forbids destructive shell commands, and the parent's verification list specifies `npm ci`-equivalent install evidence rather than the literal `rm -rf`. No resolution step occurred and the install matched the lock exactly.

## Boot / health / transport evidence (MCP_PORT=3199)

Default port 3101 is occupied by an unrelated pre-existing Next.js dev server (`pnpm dev --port 3101`, `next-server` pid 379505) which 308-redirects everything; no process was killed. The MCP server was booted with `MCP_PORT=3199 node dist/index.js`:

- listening line: `[personal-dashboard-mcp] Streamable HTTP listening on :3199`
- `GET /healthz` → `{"ok":true}` HTTP 200
- `POST /mcp initialize` → session UUID issued, `protocolVersion: 2025-06-18`
- `notifications/initialized` → HTTP 202
- `tools/list` → **40 tools**, removed names present: `[]`
- `update_account` input schema exposes `balance` as `{"type":"string","description":"Manual balance as a decimal string, e.g. \"980000.00\""}`
- unknown-tool dispatch (`tools/call` `list_transactions`) → HTTP 200, `isError: true`, text `unknown tool: list_transactions` — clean error, no transport throw
- zod rejection dispatch (`tools/call` `get_account` `{"id":"not-a-uuid"}`) → HTTP 200, `isError: true`, `ZodError.issues`-derived text (`code: invalid_format`, `format: uuid`, `path: ["id"]`) — fails before any backend call, so no token/backend was needed
- server stopped afterwards; no stray process left (`pgrep -af 'dist/index.js'` clean)

## Transport contract proof

- `git diff -- mcp-dashboard/src/index.ts mcp-dashboard/src/client.ts mcp-dashboard/tsconfig.json` → empty (host/origin allow-list and express default 100 kB body limit untouched by construction).
- Tool-registry name set: sorted `name: "..."` extraction checksum `2453926053daad0c2c0093eef620d70e` before and after, 40 names — identical.

## Canonical spec sync decision

The parent instruction was to sync `openspec/specs/mcp-dashboard/spec.md` with **ADDED requirements only**. The three ADDED requirements were inserted verbatim (diff against the delta: `IDENTICAL`) with 0 deleted lines. The delta's Edge cases / Non-goals additions were deliberately **not** merged here; the change's own `tasks.md` S2-WU3 owns the full canonical merge. Another active change's MODIFIED blocks were not touched.

## Checkbox status

| U3 item | Status | Evidence / reason |
|---|---|---|
| 1 — registry verify four claims + probes | `- [x]` | table above; no mismatch |
| 2 — pre-bump baseline | `- [x]` | `npm ls` snapshot + typecheck/build exit 0 |
| 3 — apply pins + `packageManager` | `- [x]` (edits only) | manifest edited in the working tree; staging/commit parent-owned |
| 4 — zod one-liners | `- [x]` | two lines changed; grep clean; typecheck/build green |
| 5 — gitignore negation + proof | `- [x]` | `git check-ignore -q` exit 1 (not ignored); `git status --porcelain` → `?? mcp-dashboard/package-lock.json`; `yarn.lock` still ignored (exit 0). Note: `git check-ignore -v` prints the negation line itself (last-match reporting, exit 0) — the not-ignored proof is the `-q` exit code and `git status` |
| 6 — generate + commit lockfile | `- [x]` (edits only) | `npm install` regenerated the lock in the working tree; `git add` intentionally not run (parent-owned staging) |
| 7 — reproducibility + single resolution | `- [x]` | `npm ci` exit 0 from the committed-shape tree; `npm ls zod` single 4.6.5 deduped (method note above) |
| 8 — U3 ladder | `- [x]` | npm ci / typecheck / build green; healthz `{"ok":true}` on `MCP_PORT=3199` (3101 pre-occupied) |
| 9 — zod rejection path via transport | `- [x]` | unknown-tool + invalid-UUID dispatches above, both `isError` with clean messages |
| 10 — transport contract untouched | `- [x]` | transport diff empty; name-set checksum identical |

## Risks / notes

- The manifest + regenerated `package-lock.json` + `.gitignore` negation + `tools.ts` one-liners must ride in one U3 commit (parent-owned); the lockfile is currently untracked and staged by nobody.
- `git check-ignore -v` reporting the negation pattern is standard last-match output, not a failure; the authoritative not-ignored evidence is recorded above.
- Port 3101 collision with the pre-existing Next.js dev server is environmental; the server contract itself was verified on `MCP_PORT=3199` with no code change.
- `npm audit` reported 0 vulnerabilities at install time; no audit CI job is added (out of scope).
- The delta's mcp-dashboard Edge cases / Non-goals additions remain change-local until S2-WU3, per the parent's ADDED-requirements-only sync instruction.

---

# Apply progress — S1 backend hardening (STRICT TDD) — PARTIAL, S1.3 BLOCKED ON SURFACES

- change: `2026-09-23-dependency-security-refresh`
- slice: S1.1, S1.2, S1.4, S1.5 implemented and green in the working tree. **S1.3 is not implemented**: its GREEN steps (and DD3) require `backend/src/config.rs` (`TRUSTED_PROXIES` in `Config::from_env`) and `backend/src/state.rs` (`AppState.trusted_proxies`), neither of which is in the parent-supplied Allowed edit surfaces. Escalated as `interaction_required`; not guessed and not absorbed.
- status: **partial** — not committed, not staged (parent-owned).
- stop condition engaged: the backend S1 diff is **491 insertions / 26 deletions, over the ~280 hand-written stop threshold**, so no further implementation was absorbed. See the escalation note below.
- checkboxes: 14 completed S1 items marked `- [x]` in `tasks.md`; S1.3 items, the `cors`-rationale item and the DB/CI/runtime closing items left `- [ ]` with reasons. Parent-owned boxes untouched.

## Files touched in this delegation

- `backend/src/main.rs` — S1.1: `CorsLayer` block and `cors::{Any, CorsLayer}` import deleted, merge/fallback wiring intact. S1.2: `assemble(state, static_dir, api_routes, api_timeout)` seam, `API_TIMEOUT = Duration::from_secs(15)`, `TimeoutLayer::with_status_code(StatusCode::GATEWAY_TIMEOUT, budget)` applied to the `/api` nest only, and `#[cfg(test)]` `/api/__test__/slow` + `/api/__test__/fast` routes. S1.5: four `SetResponseHeaderLayer::overriding` layers on the outer assembled router. Tests: `no_cors_headers_on_api_response`, `api_nest_times_out_but_probes_and_static_do_not`, `security_headers_on_static_api_error_and_fallback` plus the `assert_security_headers` helper.
- `backend/src/auth/rate_limit.rs` — S1.4: `MAX_KEYS = 4096`, `#[cfg(test)] with_limits(window, max_keys)`, whole-map pruning of expired attempts and emptied keys, cap eviction of the least-recently-active non-blocked key (temporary over-cap only when every retained key is blocked), poison-tolerant `lock().unwrap_or_else(|e| e.into_inner())`. Tests: `key_count_stays_bounded_by_cap`, `expired_key_is_removed`, `blocked_key_survives_eviction_pressure`, `poisoned_mutex_does_not_panic`. The 10-per-15-min budget and the `check(ip) -> Option<Duration>` signature are unchanged.
- `backend/Cargo.toml` — feature-only `tower-http` edit: `features = ["trace", "request-id", "cors", "fs", "timeout", "set-header"]`. No version range changed; the now-unused `cors` feature is retained (additive-only diff per `backend-base`; removal is a follow-up). That rationale is staged here because the tasks.md S1.1 item 4 destination is the verify report, which is S2-WU3-owned.
- `backend/Cargo.lock` — untouched (feature selection is not recorded there; `--locked` accepted the tree).
- `openspec/specs/{backend-base,session-auth,health-checks,edge-security-headers}/spec.md` — canonical sync from the change deltas (requirements only): backend-base +4 ADDED; session-auth MODIFIED `Login — Opaque Token Issuance` replaced with the delta block including the `(Previously: …)` note and +2 ADDED; health-checks +1 ADDED; edge-security-headers +2 ADDED. Verification: a Python block-substring check confirmed every delta requirement block (title + body) is present verbatim in the canonical files; the only delta content deliberately not merged is the per-delta `## Edge cases` / `## Non-goals` sections (same ADDED-requirements-only precedent as U3; S2-WU3 owns the full canonical merge). The session-auth old text `enforce rate limit 10 requests / 15 min per IP` is gone and `(Previously:` is present.
- `openspec/changes/2026-09-23-dependency-security-refresh/tasks.md` — 14 completed S1 checkboxes flipped to `- [x]`.
- `openspec/changes/2026-09-23-dependency-security-refresh/apply-progress.md` — this section.

## TDD evidence (strict TDD active)

| Sub-change | RED command / observed failure | GREEN command / observed pass |
|---|---|---|
| S1.1 CORS | `cargo test no_cors_headers` → `FAILED`: `cross-origin response must not emit access-control-allow-origin` (0 passed / 1 failed) | `cargo test no_cors_headers` → `1 passed; 0 failed`; `grep -rn "allow_origin(Any)\|CorsLayer" backend/src` → no matches |
| S1.2 timeout | `cargo test api_nest_times_out` → `FAILED`: `a handler stalling past the budget must return 504`, left 200 / right 504 (2.06 s) | `cargo test api_nest_times_out` → `1 passed; 0 failed`; `/health`, `/ready` and the `ServeDir` asset asserted while the slow request is in flight; `assert_eq!(API_TIMEOUT, Duration::from_secs(15))` |
| S1.4 limiter | `cargo test rate_limit` → 4 failures: cap test (10 retained with cap 4), `expired key must be removed` (left 1 / right 0), eviction `key_count() <= 2` (3 retained), poisoned mutex panic at the old `.expect(...)` | `cargo test rate_limit` → `9 passed; 0 failed`; `blocked_key_survives_eviction_pressure` was green pre-change and stays green (triangulation) |
| S1.5 headers | `cargo test security_headers` → `FAILED`: `static asset: missing x-content-type-options` | `cargo test security_headers` → `1 passed; 0 failed` (static, 401 JSON, 404 JSON, SPA fallback; `permissions-policy` absent; CSP has no `script-src`) |
| S1.3 | not run — blocked on `config.rs`/`state.rs` surfaces | not run |

REFACTOR: the `assemble(..., budget)` extraction plus the `#[cfg(test)]` slow/fast routes are the DD4 test seam; the S1.2 RED run observes the missing behaviour (200 instead of 504), not a compile error.

## Verification (exact commands, observed results)

- `cd backend && cargo test --locked`: `378 passed; 0 failed` (unit) + `3 passed` + `10 passed` + `10 passed` (integration) = **401 passed / 0 failed / 0 ignored**. `DATABASE_URL` was unset in this shell, so DB-gated tests self-skipped exactly as recorded for U2; CI with the Postgres service remains the DB acceptance proof.
- `cd backend && cargo clippy --all-targets --locked`: `Finished` with **zero warnings/errors**.
- RED/GREEN per sub-change: table above.
- Diff calibration: `git diff --numstat` → `backend/Cargo.toml` 1/1, `backend/src/auth/rate_limit.rs` 105/4, `backend/src/main.rs` 385/21 = **491 insertions / 26 deletions in backend**, plus canonical-spec markdown +220/-3. Over the ~280-line S1 stop threshold.

## Checkbox status

| S1 item | Status | Evidence / reason |
|---|---|---|
| S1.1 RED / GREEN / no-env-allow-list | `- [x]` | failure and pass observed; `config.rs` untouched and has no CORS/origin variable; grep clean |
| S1.1 cors-feature rationale | `- [ ]` | rationale staged above; the box requires it in the verify report, which is S2-WU3-owned |
| S1.2 RED / GREEN / exclusions / login-safe | `- [x]` | both tests green; probes and static asserted in-flight; `API_TIMEOUT == 15 s` asserted |
| S1.3 all four items | `- [ ]` | **blocked**: GREEN requires `backend/src/config.rs` + `backend/src/state.rs`, outside the supplied allowed edit surfaces |
| S1.4 RED / GREEN + clippy | `- [x]` | 4 failing tests observed first; 9/9 green after; budget and signature unchanged; clippy clean |
| S1.5 RED / GREEN / verify | `- [x]` | missing-header failures observed first; error/fallback coverage green; no `Permissions-Policy`, no `script-src` |
| S1 closing — full gate with DB + CI | `- [ ]` | no `DATABASE_URL` in this environment; no push/CI in a worker delegation |
| S1 closing — runtime eyeball | `- [ ]` | not run; the `oneshot` tests are the recorded evidence |
| S1 closing — boundary check | `- [x]` | `git diff backend/Cargo.toml` is the feature list only; no route behaviour, migration or data change |

## Escalation — S1.3 allowed edit surfaces (interaction_required)

The delegated S1.3 GREEN steps and DD3 require: (1) `backend/src/config.rs` — `TRUSTED_PROXIES` parsing in `Config::from_env` (malformed token = startup error; absent/empty = trust nobody); (2) `backend/src/state.rs` — `AppState.trusted_proxies: Arc<[TrustedProxy]>` threaded to the login handler. Neither path is in the parent-supplied Allowed edit surfaces. The same behaviour can alternatively be delivered with the trusted set owned by `LoginRateLimiter` (parse `TRUSTED_PROXIES` in `main.rs`), but that deviates from DD3/tasks.md storage-location wording, so the worker stopped instead of guessing.

## Risks / notes

- S1.3 is unimplemented: the login rate-limit key is still header-derived (`X-Forwarded-For` / `X-Real-Ip` precedence) and `SocketAddr` is not yet extracted; SEC-004 is **not** closed.
- The backend diff (491 insertions) exceeds the ~280 stop threshold even with S1.3 missing; adding S1.3 grows it further. If the review budget must hold, the slice needs splitting (per-sub-change stacked PRs) or a `size:exception` decision from the parent.
- Canonical `session-auth` now states the peer-address key and empty-default trusted proxies before S1.3 is implemented; that is intended (spec = target state) but the code/spec gap must not be reported as done.
- Nothing was staged or committed.

---

# Apply progress — S1.3 peer-address rate-limit key + trusted proxies (STRICT TDD) — RESOLVED

- change: `2026-09-23-dependency-security-refresh`
- slice: S1.3 only (SEC-004, A2). This section **supersedes the S1.3 escalation** in the section above, resolved by the parent with **OPTION 2 approved** and the binding DD3 storage-location amendment recorded below.
- status: implementation complete in the working tree; **not committed / not staged** (parent-owned).
- checkboxes: all four S1.3 items marked `- [x]` in `tasks.md`; parent-owned boxes untouched.

## DD3 storage-location amendment (binding, recorded per parent instruction)

> The trusted-proxy set is carried on `LoginRateLimiter` (already inside `AppState`) instead of a new `AppState` field. All DD3 security properties hold: `Config::from_env` parses/validates `TRUSTED_PROXIES` as exact IP/CIDR list, empty default = trust nobody, malformed token = startup error; `login.rs` derives the key through the single helper reading the set from the limiter in state; `AppState` shape untouched. DD1 (infallible `PeerAddr` extractor via `ConnectInfo` extension, optional + loopback fallback) and DD2 (peer → trusted XFF[0] → peer; drop `X-Real-Ip`) stand unchanged.

Implementation conforms to every clause:

- `backend/src/config.rs` — `TrustedProxy` (exact IP or CIDR, std-only mask compare) + `TrustedProxy::parse` + `parse_trusted_proxies(Option<&str>)` + `trusted_proxies_from_env()`; `Config::from_env` calls the env reader and returns `Err("TRUSTED_PROXIES: …")` on a malformed token (startup error), while absent/empty parses to an empty set (trust nobody).
- `backend/src/auth/rate_limit.rs` — `LoginRateLimiter` carries `trusted_proxies: Vec<TrustedProxy>` and exposes `trusted_proxies() -> &[TrustedProxy]`.
- `backend/src/routes/login.rs` — `PeerAddr(pub Option<SocketAddr>)` (infallible `FromRequestParts`, DD1), `LOCAL_PEER_FALLBACK = 127.0.0.1`, `rate_limit_key(peer, headers, trusted)` (DD2: peer; first parseable XFF element only when the peer is trusted; never `X-Real-Ip`; never a header without a peer), and `login_handler` derives the key via `rate_limit_key(peer.0, &headers, state.rate_limiter.trusted_proxies())`; `client_ip` is deleted (`grep -rn client_ip backend/src` → no matches).
- `backend/src/state.rs` — **untouched**: `git diff backend/src/state.rs` is empty; the 33 literal `AppState` construction sites keep compiling.

### Wiring resolution (why the limiter reads the env var)

`backend/src/main.rs` is outside this delegation's allowed edit surfaces, and `LoginRateLimiter::new()` is invoked at 33+ literal `AppState` construction sites, so the parsed set cannot be injected as a constructor argument. Resolution: `LoginRateLimiter::new()` calls the same `config::trusted_proxies_from_env()` helper that `Config::from_env` uses for startup validation; on a parse error it fails closed to an empty set (unreachable in production, where `Config::from_env` exits first). Single parse implementation and single security semantics; the only duplication is the `env::var` read. Handler tests use the `#[cfg(test)]` `with_trusted_proxies` constructor, so they never depend on the process environment.

## Files touched in this delegation

- `backend/src/config.rs` — `TrustedProxy` + parse/validate + `Config::from_env` validation; opt-in consequence documented on the parser (no backend env-var README exists in-tree; this is the in-surface home of the variable). Tests: 3.
- `backend/src/auth/rate_limit.rs` — trusted-set field/accessor, `new()` env read (fail-closed), `with_trusted_proxies` test constructor; `with_window`/`with_limits` initialize an empty set. No change to `check(ip)` or the 10/15-min budget.
- `backend/src/routes/login.rs` — `PeerAddr`, `LOCAL_PEER_FALLBACK`, `rate_limit_key`, handler signature + derivation, `client_ip` removed. Tests: 10 new.
- `backend/src/state.rs` — untouched (verified empty diff).
- `openspec/changes/2026-09-23-dependency-security-refresh/tasks.md` — four S1.3 checkboxes checked.
- `openspec/changes/2026-09-23-dependency-security-refresh/apply-progress.md` — this section.

## TDD evidence (strict TDD active)

| Step | RED command / observed failure | GREEN command / observed pass |
|---|---|---|
| (a) `PeerAddr` + `rate_limit_key` | `cargo test --locked` → compile failure, 14 errors: E0425 `rate_limit_key` ×7, E0425 `LOCAL_PEER_FALLBACK` ×3, E0433 `PeerAddr` ×2, E0432 unresolved import `crate::config::TrustedProxy` ×1, E0425 `ConnectInfo` ×1 | `cargo test --locked routes::login` → `6 passed; 0 failed` (5 new + the pre-existing CITEXT test) |
| (b) `TRUSTED_PROXIES` parse/validate | `cargo test --locked trusted_proxies` → compile failure: E0425 cannot find function `parse_trusted_proxies` | `cargo test --locked trusted_proxies` → `3 passed; 0 failed` |
| (c) handler derivation through the limiter-owned set | `cargo test --locked` → compile failure, 13 errors: E0061 `login_handler` takes 3 arguments but 4 were supplied ×8, E0599 no `with_trusted_proxies` ×5 | `cargo test --locked routes::login` → `11 passed; 0 failed` |
| (d) explicit untrusted-XFF / trusted-XFF[0] tests | same RED batch as (c): the handler tests cannot compile before the new signature and limiter constructor exist | same GREEN run: `untrusted_peer_ignores_a_blocked_xff_key`, `peers_get_independent_buckets_and_rotating_xff_never_creates_one`, `trusted_peer_uses_first_xff_element`, `trusted_peer_with_malformed_xff_falls_back_to_peer`, `absent_connect_info_uses_local_fallback_without_panicking` all pass |

RED honesty note: steps (a)–(d) introduce new types, a new function and a changed handler signature, so the observed RED is a compile failure (the canonical first failure for a new Rust API surface) rather than a runtime assertion failure. Every behaviour the parent asked for is asserted by a GREEN test that fails if the implementation is reverted: the XFF key is pre-blocked while an untrusted peer still passes the limiter, a trusted peer is blocked exactly when its XFF[0] is blocked, and a rotating XFF never blocks a fresh peer or unblocks an exhausted one.

TRIANGULATE: parser negatives (7 malformed forms, `/33`, `/129`, empty token, cross-family mismatch), helper negatives (absent header, malformed header, `X-Real-Ip` ignored, no-peer fallback with a trusted-looking header), handler contrasts (peer independence while sharing an XFF value; XFF[1] and the peer address are not the key; malformed XFF falls back to a blocked peer key).

REFACTOR: none needed after GREEN. One test-hygiene fix inside the GREEN cycle: the handler tests' lazy pool first used sqlx's default 30 s acquire timeout, making the allowed-path test take 330 s; `PgPoolOptions::acquire_timeout(100 ms)` reduced the module to 1.12 s with identical assertions.

## Verification (exact commands, observed results)

- `cd backend && cargo test --locked`: **414 passed / 0 failed / 0 ignored** — unit `src/main.rs` 391, `tests/migration_0007_goal_progress.rs` 3, `tests/migration_0008_credit_cards.rs` 10, `tests/migration_0011_removal.rs` 10. Net +13 tests over the pre-S1.3 tree (401 → 414). `DATABASE_URL` was unset in this shell, so the same DB-gated tests self-skip as recorded for U2; CI with the Postgres service remains the DB acceptance proof.
- `cd backend && cargo clippy --all-targets --locked`: `Finished` with **zero warnings/errors** (exit 0).
- `git diff -- backend/src/state.rs`: empty (AppState shape untouched).
- `grep -n "into_make_service_with_connect_info" backend/src/main.rs` → line 383, still wired (moved from 319 by the earlier S1 edits; `main.rs` itself is unchanged by this delegation — its diff remains 385/21).
- `grep -rn "client_ip" backend/src` → no matches (header precedence path fully removed).

## Checkbox status

| S1.3 item | Status | Evidence / reason |
|---|---|---|
| 1 — RED tests (a)–(d) | `- [x]` | compile RED observed for all four; GREEN assertions listed above |
| 2 — `TRUSTED_PROXIES` config + threading | `- [x]` | config parse/validate + limiter-owned set per the DD3 amendment; `AppState` untouched |
| 3 — handler derivation + `client_ip` removal | `- [x]` | `rate_limit_key` is the single path; `grep client_ip` clean |
| 4 — opt-in documentation + connect-info wiring | `- [x]` | opt-in and shared-bucket consequence documented on `parse_trusted_proxies` (no backend env README exists in-tree; S2-WU3 owns the verify report); `into_make_service_with_connect_info` confirmed at `main.rs:383` |

## Risks / notes

- The env var is read twice (startup validation in `Config::from_env`, set construction in `LoginRateLimiter::new()`). Single parse implementation, fail-closed fallback; the alternative would need `main.rs`, which is outside the allowed surfaces.
- `LoginRateLimiter::new()` is now environment-dependent. Production semantics are unchanged (validated at startup); handler tests pin their own trusted set, and the remaining tests exercise `check()` directly.
- No backend env-var documentation file exists in the repository; the in-surface documentation is the doc comment on the parser. A user-facing doc statement remains an S2-WU3/verify-report item.
- S1 diff size now totals 1016 insertions / 44 deletions across `backend/` (config 161/1, login 334/17, rate_limit 135/4, main 385/21, Cargo.toml 1/1) — well over the ~280-line S1 stop threshold flagged earlier; the parent's review-budget decision (split or `size:exception`) still applies.
- Nothing was staged or committed.
