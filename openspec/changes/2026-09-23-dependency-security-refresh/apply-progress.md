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
