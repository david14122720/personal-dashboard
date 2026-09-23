# Tasks — 2026-09-23-dependency-security-refresh

- change: `2026-09-23-dependency-security-refresh`
- phase: tasks
- date: 2026-09-23
- artifact_store: `openspec` (this file is the authoritative artifact)
- delivery_strategy: `auto-chain` (preflight; chain automatically, never pause, never infer `size:exception`)
- chain_strategy: `stacked-to-main`
- review_budget: 400 changed lines (`additions + deletions`), **generated lockfiles EXEMPT** (`Cargo.lock`, `pnpm-lock.yaml`, `package-lock.json`) — parent decision, recorded in `build-reproducibility`; this is **not** a `size:exception`
- strict_tdd: `false` (`openspec/config.yaml`) — S1 is TDD anyway (five `oneshot`-provable behaviours); U1/U2/U3/S2 are evidence-gated by their verification ladder
- status: `ready_for_apply`
- Binding merge order: **U2 → U1 → U3 → S1 → S2**; inside U1: **U1a (TypeScript 7 alone) → U1b (runtime bumps)**; U2 is one atomic commit; U1a/U1b/U3/S1/S2 are one PR each, stacked.

## Inputs read

`specs/{backend-base,build-reproducibility,edge-security-headers,frontend-dependencies,health-checks,mcp-dashboard,session-auth}/spec.md`, `proposal.md`, `explore.md`, `openspec/config.yaml`, plus direct inspection of `.github/workflows/ci.yml`, `Dockerfile`, `docker/backend.Dockerfile`, `docker-compose.yml`, `.gitignore`, `frontend/package.json`, `frontend/pnpm-workspace.yaml`, `mcp-dashboard/package.json`, `mcp-dashboard/README.md`, `mcp-dashboard/src/tools.ts`, `mcp-dashboard/src/index.ts`, `backend/Cargo.toml`, `backend/src/main.rs` (`build_router`, layer stack, `api_nest_tests`), `backend/src/config.rs`, `backend/src/routes/login.rs`, `backend/src/auth/rate_limit.rs`, `openspec/specs/`.

Honest gap: `design.md` does not exist — the proposal's `next_recommended` #2 explicitly skips design (D1–D4 binding, remaining decisions local and decided in proposal §6/S1). No design input was fabricated; the local decisions it would have carried are written into the S1 tasks below.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ≈ 360–500 hand-written across 6 stacked PRs (lockfiles exempt); S1 ≈ 200–280 and S2 ≈ 100–130 dominate |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (U2) → PR 2 (U1a) → PR 3 (U1b) → PR 4 (U3) → PR 5 (S1) → PR 6 (S2) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```text
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium
```

Decision note: no delivery decision is pending. `auto-chain` + `stacked-to-main` are the session preflight; the change needs **no** `size:exception` because generated lockfiles are exempt by parent decision and every individual PR stays under 400 hand-written lines. A4 (compose pair) is resolved by the parent's binding constraint to the **refresh** path, so no deletion consent gate exists; A3 is a proof-then-act gate that falls back to migration inside S2 without pausing; version claims are verified against the registry inside U1/U3 with "pin latest actual and record" as the fallback, also without pausing.

### Per-slice forecast

| Slice / PR | Hand-written changed lines (est.) | Generated (exempt) | Budget risk | Internal work units |
|---|---|---|---|---|
| U2 — CI + lockfile atomicity | ~6 (1 `ci.yml`, 1 `Dockerfile`, evidence notes) | `backend/Cargo.lock` | Low | one commit, no split |
| U1a — TypeScript 7 alone | ~2–4 (one pin) | `frontend/pnpm-lock.yaml` | Low | one commit |
| U1b — frontend runtime bumps | ~20–40 (pins + probed packages) | `frontend/pnpm-lock.yaml` | Low | one commit |
| U3 — mcp refresh + lockfile | ~25–40 (manifest, `packageManager`, `.gitignore`, `tools.ts` one-liners) | `mcp-dashboard/package-lock.json` | Low | one commit |
| S1 — backend hardening (TDD) | ~120–160 code + ~80–120 tests = ~200–280 | — | Medium | S1.1 CORS, S1.2 timeout, S1.3 peer key, S1.4 bounded map, S1.5 headers |
| S2 — pnpm key, compose pair, docs, spec sync | ~100–130 (incl. ~60–90 lines of canonical spec markdown) | `frontend/pnpm-lock.yaml` if regenerated | Low–Medium | S2-WU1 pnpm key, S2-WU2 compose pair, S2-WU3 docs + specs + verify report |

Overage note: the whole change exceeds 400 lines in total, but the review unit is the PR and no PR exceeds ~280 lines. If S1's test growth or U1's TypeScript-7 fallout pushes a single PR toward the cap, apply reports the budget risk back to the parent instead of absorbing it (that is the `ask-on-risk` behaviour inside `auto-chain`), and the S1 sub-changes become their own stacked PRs.

---

## Slice U2 — CI + committed lockfile, one atomic commit (merges first)

- Intent: turn evidence back on. `cargo test --offline` cannot resolve `argon2` on a clean runner; the committed `backend/Cargo.lock` is currently advisory because neither CI nor the image build honours it.
- Depends: none.
- Files: `.github/workflows/ci.yml:42`, `Dockerfile:27` (and `:17`/` (read-only):19` verify-only), `backend/Cargo.lock` (newly tracked), `.gitignore:5` (verify-only), `backend/Cargo.toml` (must NOT change).
- Boundary: no `Cargo.toml` version-range edit anywhere; the warm-up dummy build stays tolerant by design.
- Acceptance criteria: the `backend` CI job is **green** with `cargo test --locked`; lockfile + CI flag + Dockerfile flag are in the **same commit**; DB-gated tests actually executed (recorded); behind-latest transitives named with reasons; no `--offline` remains in `ci.yml`.
- Rollback: `git revert` the single commit — CI returns to its known-red state with no partial lockfile state left behind.

- [x] Name the behind-latest transitives without chasing them: `cd backend && cargo update --dry-run 2>&1 | tee /tmp/u2-transitives.txt`, list each crate with its declared range and the reason it stays, and confirm `backend/Cargo.toml` needs no edit (range widening is a separate deliberate decision). <!-- sdd-owner: implementation -->
- [x] Confirm the lockfile is fresh and tracked-ready: `cd backend && cargo build --locked` succeeds (if it reports drift, regenerate with `cargo generate-lockfile` and no manifest edit), and `git check-ignore -v backend/Cargo.lock` shows the existing `.gitignore:5` negation. <!-- sdd-owner: implementation -->
- [x] Land the atomic commit: `git add backend/Cargo.lock`, change `.github/workflows/ci.yml:42` `cargo test --offline` → `cargo test --locked`, and change `Dockerfile:27` `RUN cargo build --release` → `RUN cargo build --release --locked`; leave `Dockerfile:17`'s `2>/dev/null || true` warm-up and `Dockerfile:19`'s tolerant `COPY backend/Cargo.lock*` untouched. <!-- sdd-owner: implementation -->
- [ ] Run the local gate with a real database so DB-gated tests execute: export `DATABASE_URL` (local PG `192.168.50.120:5434` or equivalent), apply `backend/migrations/*.sql`, then `cd backend && cargo test --locked` and record exactly which tests ran versus self-skipped. <!-- sdd-owner: implementation -->
- [ ] `cd backend && cargo clippy --all-targets --all-features --locked -- -D warnings` exits 0. <!-- sdd-owner: implementation -->
- [ ] Prove drift fails loudly (spec scenario, reverted probe): temporarily bump one `backend/Cargo.toml` range, observe `cargo build --locked` fail, then revert the probe and confirm `git diff backend/Cargo.toml` is empty. <!-- sdd-owner: implementation -->
- [ ] Prove the goal of the unit: push the branch and confirm the `backend` CI job is green with `cargo test --locked`; attach the job output to the PR body and do not weaken the step back to `--offline` or add skip flags. <!-- sdd-owner: implementation -->

---

## Slice U1 — frontend refresh, TypeScript 7 isolated first (U1a then U1b)

- Intent: latest-compatible, reproducible frontend toolchain, with the TS 7 risk confined to a revertable step.
- Depends: U2 merged (evidence on before bump noise).
- Files: `frontend/package.json`, `frontend/pnpm-lock.yaml` (exempt). Verify-only: `frontend/tsconfig.json`, `frontend/vitest.config.ts`, `frontend/next.config.ts`, `frontend/playwright.config.ts`, root `Dockerfile:11` / `ci.yml:59` (`--frozen-lockfile` tripwires), `frontend/tsconfig.tsbuildinfo` (must not be committed).
- Boundary: no application source, no config change unless the isolated TS 7 step demands it; every manifest edit ships its regenerated lock in the same commit.

### U1a — TypeScript 7 alone (own PR, own commit)

- [x] Verify the version claim against the registry: `npm view typescript version`; if the answer is not `7.0.2`, pin the actual latest and record the mismatch in the PR body and verify report. <!-- sdd-owner: implementation -->
- [x] Record the TS 7 preconditions before editing: `frontend/tsconfig.json` uses `target ES2022`, `module esnext`, `moduleResolution bundler`, `jsx react-jsx`, and contains none of the removed values (`module` `umd`/` (read-only)amd`/` (read-only)system`/` (read-only)none`, `moduleResolution` `node`/` (read-only)classic`/` (read-only)node10`, `target` `es5`). <!-- sdd-owner: implementation -->
- [x] Capture the pre-bump baseline so any TS 7 error is attributable: `cd frontend && pnpm exec tsc --noEmit && pnpm run build` green on the current TypeScript. <!-- sdd-owner: implementation -->
- [x] Set `typescript` in `frontend/package.json` to the verified version and regenerate the lock **in the same commit**: `pnpm install`, then `git add frontend/package.json frontend/pnpm-lock.yaml`. <!-- sdd-owner: implementation -->
- [x] Run the U1a ladder and stop at the first red: `pnpm install` → `pnpm test` → `pnpm exec tsc --noEmit` → `pnpm run build` → `pnpm exec playwright test --list`; record each result in the PR body. <!-- sdd-owner: implementation -->
- [x] If TS 7 surfaces source errors that 5.9.3 tolerated, fix them inside U1a only (its own commit) and re-run the full ladder; do not fold runtime bumps into the fix, and if the fix becomes non-trivial (new module or > ~60 lines) report the budget risk to the parent before continuing. <!-- sdd-owner: implementation -->
- [x] Verify the diff surface: `git diff --stat` for U1a is `frontend/package.json` + `frontend/pnpm-lock.yaml` only, and `frontend/tsconfig.tsbuildinfo` is not staged. <!-- sdd-owner: implementation -->

### U1b — runtime and tooling bumps (own PR)

- [x] Probe and record the parent-omitted and enumerated packages against the registry: `@testing-library/jest-dom`, `@testing-library/react`, `@vitejs/plugin-react`, `recharts`, `@playwright/test`, plus `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@types/node`, `jsdom`, `vitest` — each either bumped or explicitly recorded as already latest (never assumed). <!-- sdd-owner: implementation -->
- [x] Apply the pins in `frontend/package.json` (`next` 16.3.6, `react`/` (read-only)react-dom` 19.3.0, `@types/react`/` (read-only)@types/react-dom` 19.3.0, `@types/node` 26.6.2, `jsdom` 30.1.1, `vitest` 5.0.1, plus the probed members) and regenerate `frontend/pnpm-lock.yaml` in the same commit, attributing any caret-floater churn (`recharts`, `@playwright/test`) to this unit. <!-- sdd-owner: implementation -->
- [x] Run the U1b ladder and stop at the first red: `pnpm install` → `pnpm test` → `pnpm exec tsc --noEmit` → `pnpm run build` → `pnpm exec playwright test --list`. <!-- sdd-owner: implementation -->
- [x] Verify no runtime or config surface changed: `git diff --stat` is `frontend/package.json` + `frontend/pnpm-lock.yaml` only; `frontend/next.config.ts` still has `output: "export"` and `trailingSlash` unchanged. <!-- sdd-owner: implementation -->
- [x] Prove the tripwires still hold from a clean tree: `rm -rf frontend/node_modules && cd frontend && pnpm install --frozen-lockfile` succeeds (mirrors root `Dockerfile:11` and `.github/workflows/ci.yml:59`). <!-- sdd-owner: implementation -->

Slice U1 acceptance criteria: pinned versions verified against the registry (mismatches recorded); U1a's ladder green **before** U1b starts; U1b's ladder green; diff is manifest + lock only; TypeScript 7 is revertable on its own commit.
Slice U1 rollback: `git revert` the U1b commit, then the U1a commit if needed (no source, no data, no migration).

---

## Slice U3 — mcp-dashboard refresh + committed lockfile

- Intent: pin the MCP toolchain and make the install reproducible (today there is no lockfile at all and `.gitignore:11` ignores `package-lock.json` repo-wide).
- Depends: U1 merged.
- Files: `mcp-dashboard/package.json`, `mcp-dashboard/src/tools.ts` (lines 36 and 73), `.gitignore:11`, new `mcp-dashboard/package-lock.json` (exempt, never hand-edited). Verify-only: `mcp-dashboard/src/index.ts`, `mcp-dashboard/src/client.ts`, `mcp-dashboard/tsconfig.json`.
- Boundary: no change to `src/index.ts` host/origin allow-list, no new tools, no express body-limit change; a TypeScript 7 error in `mcp-dashboard` is fixed inside this unit only.
- Acceptance criteria: `npm ci` reproducible with one zod resolution; `npm run typecheck` + `npm run build` clean with no zod deprecation from `tools.ts`; server boots and `/healthz` (read-only) answers; rejecting-tool path returns the generic validation rejection; lockfile tracked (`git check-ignore` finds no match); transport contract untouched.
- Rollback: `git revert` the unit commit (manifest + lock + `tools.ts` one-liners revert together; the `.gitignore` negation is harmless if left behind).

- [ ] Verify the four version claims against the registry and record the answers: `npm view @modelcontextprotocol/sdk version`, `npm view zod version`, `npm view typescript version`, `npm view @types/node version`, plus `npm view express version` and `npm view @types/express version`; on mismatch pin the actual latest and record it. <!-- sdd-owner: implementation -->
- [ ] Record the pre-bump baseline: `cd mcp-dashboard && npm run typecheck && npm run build` green, with `npm ls --depth=0` captured so the currently resolved versions are on the record. <!-- sdd-owner: implementation -->
- [ ] Apply the pins and `packageManager` in `mcp-dashboard/package.json`: `@modelcontextprotocol/sdk` 1.30.1, `zod` 4.6.5, `typescript` 7.0.2, `@types/node` 26.6.2, `express`/` (read-only)@types/express` at the probed latest. <!-- sdd-owner: implementation -->
- [ ] Replace the two deprecated zod forms in `mcp-dashboard/src/tools.ts`: `const uuid = z.string().uuid();` (line 36) → `z.uuid()` and `email: z.string().email()` (line 73) → `z.email()`; leave `z.object`, `.min/.max/.optional`, `z.enum`, `z.number().int()`, `z.array`, `z.ZodTypeAny` and `.parse()` behaviourally identical. <!-- sdd-owner: implementation -->
- [ ] Add `!mcp-dashboard/package-lock.json` immediately after the repo-wide `package-lock.json` line in `.gitignore` (line 11) and prove it with `git check-ignore -v mcp-dashboard/package-lock.json` (no match reported). <!-- sdd-owner: implementation -->
- [ ] Generate and commit the lockfile in the same commit as the manifest: `cd mcp-dashboard && npm install`, then `git add mcp-dashboard/package.json mcp-dashboard/package-lock.json .gitignore mcp-dashboard/src/tools.ts`. <!-- sdd-owner: implementation -->
- [ ] Prove reproducibility and single-resolution: `rm -rf mcp-dashboard/node_modules && cd mcp-dashboard && npm ci` succeeds with no resolution step and `npm ls zod` shows exactly one zod 4.x resolution. <!-- sdd-owner: implementation -->
- [ ] Run the U3 ladder: `npm ci` → `npm run typecheck` → `npm run build` → start `node dist/index.js` in the background → `curl -sS http://localhost:3101/healthz` returns `{"ok":true}`. <!-- sdd-owner: implementation -->
- [ ] Prove the zod 4 rejection path through the transport: dispatch one tool with input that must be rejected and confirm the generic validation rejection (`ZodError.issues`-derived) is returned instead of a throw through the transport; if no reachable backend/token exists, still prove the rejecting path with a dummy token and record the read-tool dispatch as "not evidenced" rather than inferred. <!-- sdd-owner: implementation -->
- [ ] Verify the transport contract is untouched: `git diff mcp-dashboard/src/index.ts` is empty, host/origin allow-listing and the express default 100 kB body limit are unchanged, and the tool-registry name set is identical before and after. <!-- sdd-owner: implementation -->

---

## Slice S1 — backend hardening: CORS, timeout, peer-address key, bounded map, headers (TDD)

- Intent: close SEC-002/003/004/005/006 in one reviewable unit, each sub-change RED first with the existing `tower::ServiceExt::oneshot` harness in `backend/src/main.rs` `#[cfg(test)] mod api_nest_tests`.
- Depends: U1 and U3 merged (hardening diffs must not compete with bump noise).
- Files: `backend/src/main.rs` (CORS at 218-223, imports at 18, `build_router` 211-238, layer stack 305-309, `api_nest_tests` from 326), `backend/src/routes/login.rs` (`client_ip` 29-42, key use 62-63), `backend/src/auth/rate_limit.rs` (44-64), `backend/src/config.rs`, `backend/Cargo.toml:10` (features only), `backend/src/state.rs` if the trusted set is threaded there.
- Boundary: `Cargo.toml` feature list only (add `timeout`, `set-header`; keep `cors` — the `backend-base` spec requires the diff to be additive-only with no version-range change); no data, migration or route-behaviour change outside these five concerns; `main.rs:319` `into_make_service_with_connect_info::<SocketAddr>()` stays wired.
- Acceptance criteria: all five sub-changes' tests green; `cargo test --locked` (with `DATABASE_URL`) and `cargo clippy --all-targets --all-features --locked -- -D warnings` green; `grep -rn "allow_origin(Any)" backend/src` returns nothing; no `Access-Control-*` header on any response; `/health` (read-only) and `/ready` (read-only) unaffected by the API timeout; exact four headers on static, API, error and fallback responses with no `Permissions-Policy` and no `script-src`; the `backend` CI job still green.
- Rollback: revert the S1 commit — every sub-change is additive or removable and there is no data or config migration in the unit.

### S1.1 — CORS removal (D2)

- [ ] RED: add `no_cors_headers_on_api_response` to `api_nest_tests`: `build_router(lazy_state(), None)` then `oneshot` a request to `/api/accounts` (read-only) and a preflight-shaped `OPTIONS` request, asserting no `access-control-allow-origin`, `access-control-allow-methods` or `access-control-allow-headers` on the response; run `cargo test no_cors_headers` and record it failing against the current wildcard layer. <!-- sdd-owner: implementation -->
- [ ] GREEN: delete the `CorsLayer` block (`backend/src/main.rs:218-223`) and the `cors::{Any, CorsLayer}` import (line 18) while keeping the merge/fallback wiring intact, then re-run `cargo test no_cors_headers` to green. <!-- sdd-owner: implementation -->
- [ ] Verify no env allow-list was invented: no new CORS or allowed-origin environment variable exists in `backend/src/config.rs`, and `grep -rn "allow_origin(Any)\|CorsLayer" backend/src` returns nothing. <!-- sdd-owner: implementation -->
- [ ] Record the rationale for keeping the now-unused `cors` feature in `backend/Cargo.toml:10` (additive-only Cargo.toml diff per `backend-base`; removing it is a follow-up) in the verify report. <!-- sdd-owner: implementation -->

### S1.2 — Bounded request timeout on the `/api` (read-only) nest (SEC-003)

- [ ] RED: add `api_nest_times_out_but_probes_and_static_do_not` to `api_nest_tests`: mount a test-only slow handler inside the `/api` (read-only) nest (a `#[cfg(test)]` route sleeping past the budget) with a test-injected short budget, and assert the slow request returns a bounded timeout status (504); run it and record the failure. <!-- sdd-owner: implementation -->
- [ ] GREEN: add `timeout` to `backend/Cargo.toml:10`'s `tower-http` feature list (feature-only, no version change) and apply `tower_http::timeout::TimeoutLayer` with a 15 s production budget to the `/api` (read-only) nest only (the `nest("/api", ...)` wiring at `backend/src/main.rs:212-215`) — never as the outermost layer and never over `ServeDir`. <!-- sdd-owner: implementation -->
- [ ] Assert the exclusions in the same test: `GET /health` and `GET /ready` answer normally while a slow `/api` (read-only) request is in flight, and a `ServeDir`-served asset from a temp `STATIC_DIR` fixture (the pattern in `health_stays_at_root_and_spa_fallback_serves_index`) still serves with the timeout layer installed. <!-- sdd-owner: implementation -->
- [ ] Assert the budget is login-safe: the production timeout constant is 15 s and a handler finishing just under an injected budget returns 200 (an argon2-length login is never cut off). <!-- sdd-owner: implementation -->

### S1.3 — Peer-address rate-limit key, empty-by-default trusted proxies (SEC-004, A2)

- [ ] RED: add tests covering (a) two peers sending different `X-Forwarded-For` values get independent buckets and rotating the header never creates a new bucket, (b) with the trusted-proxy set containing the peer the first XFF element is used, (c) a malformed XFF falls back to the peer and never to a shared constant, and (d) with the connect-info extension absent (the `oneshot` harness) the handler uses a fixed non-spoofable local default and neither panics nor returns 500; record each failing first. <!-- sdd-owner: implementation -->
- [ ] GREEN: add an empty-by-default trusted-proxy configuration to `backend/src/config.rs` (`TRUSTED_PROXIES`, comma-separated IP/CIDR list; absent or empty means trust nobody) and thread it into the state the login handler reads. <!-- sdd-owner: implementation -->
- [ ] GREEN: change `login_handler` in `backend/src/routes/login.rs` to take `Option<ConnectInfo<SocketAddr>>` and derive the key from one helper — peer address when present, the first XFF element only when the peer is in the trusted set, and the fixed local default when connect-info is absent (never a header-derived value); remove the unconditional `client_ip(&headers)` precedence at lines 29-42 and its use at 62-63. <!-- sdd-owner: implementation -->
- [ ] Document the opt-in and its consequence (all clients behind a proxy share one bucket until `TRUSTED_PROXIES` is set) where backend environment variables are documented, and confirm `backend/src/main.rs:319` still wires `into_make_service_with_connect_info::<SocketAddr>()`. <!-- sdd-owner: implementation -->

### S1.4 — Bounded, poison-tolerant limiter state (SEC-005)

- [ ] RED: add tests in `backend/src/auth/rate_limit.rs`: (a) inserting more distinct keys than the cap never retains more than the cap, (b) a key whose window is empty is removed, (c) a currently blocked key still returns `Some(retry_after)` under eviction pressure, and (d) a poisoned mutex does not panic — the guard is recovered; record the failures first. <!-- sdd-owner: implementation -->
- [ ] GREEN: prune keys whose window is empty, add a named cap constant with eviction of the least-recently-relevant entries that never evicts a currently blocked key, and replace `self.inner.lock().expect("rate limiter mutex poisoned")` with a poisoning-tolerant `lock().unwrap_or_else(|e| e.into_inner())`. <!-- sdd-owner: implementation -->
- [ ] Keep the 10-per-15-min budget and the `check(ip) -> Option<Duration>` signature unchanged, then run `cd backend && cargo clippy --all-targets --all-features --locked -- -D warnings` and fix only what it reports. <!-- sdd-owner: implementation -->

### S1.5 — Repo-owned security headers on the serving path (SEC-006)

- [ ] RED: add `security_headers_on_static_api_error_and_fallback` to `api_nest_tests` asserting the exact values `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: no-referrer`, `content-security-policy: frame-ancestors 'none'` on (i) a static path from a temp `STATIC_DIR`, (ii) an API JSON response, (iii) a 401 and a 404 error response, and (iv) the SPA fallback `index.html`; also assert `permissions-policy` is absent and the CSP contains no `script-src`; record the failures first. <!-- sdd-owner: implementation -->
- [ ] GREEN: add `set-header` to `backend/Cargo.toml:10`'s `tower-http` feature list and apply `SetResponseHeaderLayer::overriding` for the four headers to the outer router inside `build_router`, so both the merged API and the `ServeDir` fallback are covered, with the `main.rs:306-309` request-id/trace layers left outermost and unchanged. <!-- sdd-owner: implementation -->
- [ ] Verify the header layer is not a success-path-only fix (the RED error/fallback assertions turn green), and that the app emits no `Permissions-Policy` (ownership split with `edge-security-headers`) and no `script-src` (deferred CSP decision). <!-- sdd-owner: implementation -->

### S1 — closing verification

- [ ] Full S1 gate: `cd backend && cargo test --locked` with `DATABASE_URL` set, then `cargo clippy --all-targets --all-features --locked -- -D warnings`, then confirm the `backend` CI job is still green. <!-- sdd-owner: implementation -->
- [ ] Runtime eyeball when a runtime is available: build with `STATIC_DIR` pointing at `frontend/out`, run the binary, and `curl -sI` a static path and an API path to record the four header values; if no runtime is available, record "not evidenced" instead of inferring. <!-- sdd-owner: implementation -->
- [ ] Verify the unit stayed inside its boundary: `backend/Cargo.toml` differs only by the added `timeout` and `set-header` features (no version range, `cors` retained), and the diff touches no route behaviour, migration or data outside the five sub-changes. <!-- sdd-owner: implementation -->

---

## Slice S2 — pnpm approval key, compose pair, docs, canonical specs, verify report (merges last)

- Intent: single source of build-script approval, one coherent second container path, documentation that matches what can actually be pinned, and the durable knowledge landed in the canonical specs.
- Depends: U2, U1, U3, S1 merged.
- Files: `frontend/package.json:7-11`, `frontend/pnpm-workspace.yaml`, `frontend/pnpm-lock.yaml` (if regenerated, exempt), `docker/backend.Dockerfile:2,12`, `docker-compose.yml`, `mcp-dashboard/README.md:26`, new canonical `openspec/specs/build-reproducibility/spec.md` and `openspec/specs/frontend-dependencies/spec.md`, updated canonical `openspec/specs/{backend-base,session-auth,edge-security-headers,health-checks,mcp-dashboard}/spec.md`.
- Boundary: no deletion of the compose pair in this change (parent binding constraint: minimal safe edit, keep `docker-compose.yml` working, record the image build as unverified); no `npm audit` CI job; no Dokploy/Traefik/firewall work.
- Acceptance criteria: pnpm 11.23.0 still approves `esbuild`/` (read-only)msw`/` (read-only)sharp` builds with a single authoritative approval source; the compose pair is refreshed coherently and parses; docs use `npm ci` and state the `--locked` / `--frozen-lockfile` policy; canonical specs carry the D1 plaintext-LAN acceptance, the deferred `script-src` decision, the empty-by-default trusted-proxy opt-in and the named-but-not-chased transitives; the verify report states what was and was not evidenced.
- Rollback: `git revert` the S2 commits (the compose refresh is a revertible edit; no file is deleted).

### S2-WU1 — pnpm build-approval key (A3 proof gate)

- [ ] Prove the key shape **before** deleting anything: `cd frontend && pnpm -v` (must report 11.23.0), then temporarily remove the `pnpm.onlyBuiltDependencies` block, run a clean install (`rm -rf node_modules && pnpm install`) and capture the output; the proof passes only if no `Ignored build scripts` warning names `esbuild`, `msw` or `sharp`. <!-- sdd-owner: implementation -->
- [ ] If the proof passes, delete `frontend/package.json:7-11` and state in the commit message that `frontend/pnpm-workspace.yaml`'s `allowBuilds:` is the authoritative approval source; if the proof fails, migrate the three entries into the workspace file instead of deleting and state which file became authoritative. <!-- sdd-owner: implementation -->
- [ ] Regenerate and commit `frontend/pnpm-lock.yaml` if the install changed it (attributing the churn to this unit, not U1), then re-run `pnpm install --frozen-lockfile`, `pnpm test` and `pnpm exec tsc --noEmit`. <!-- sdd-owner: implementation -->
- [ ] Verify the single-source invariant: `frontend/pnpm-workspace.yaml` `allowBuilds:` lists exactly the three packages, no other key approves build scripts, and no `onlyBuiltDependencies` warning appears in the captured install output. <!-- sdd-owner: implementation -->

### S2-WU2 — stale compose pair, minimal safe edit

- [ ] Bump `docker/backend.Dockerfile:2` from `rust:1.75-slim-bookworm` to a current stable Rust image satisfying the tree's MSRVs (verify the MSRVs of `rand`/` (read-only)base64`/` (read-only)sqlx` in `backend/Cargo.lock` before choosing, e.g. `rust:1-slim-bookworm`) and add `--locked` to its gated `cargo build --release` (line 12), leaving the dummy warm-up build tolerant. <!-- sdd-owner: implementation -->
- [ ] Keep `docker-compose.yml` working: confirm `docker compose -f docker-compose.yml config` (or `docker compose config --quiet`) parses and still references an existing Dockerfile, and change only what the Dockerfile refresh requires. <!-- sdd-owner: implementation -->
- [ ] Record in the verify report that the pair was refreshed (not deleted) per the parent's minimal-safe-edit constraint, that no half-fixed state remains (a stale Dockerfile pointing nowhere or a compose file pointing at a stale build), and that `docker build` is **unverified** because no daemon is assumed; note deletion as a follow-up change requiring explicit owner confirmation. <!-- sdd-owner: implementation -->

### S2-WU3 — docs, canonical specs, verify report

- [ ] Update `mcp-dashboard/README.md:26`: `npm install` → `npm ci`, add that `package-lock.json` is committed, and state the pinning policy. <!-- sdd-owner: implementation -->
- [ ] State the `--locked` / `--frozen-lockfile` / `npm ci` pinning policy wherever install or build steps are documented (at minimum the READMEs touched by this change) and record the two behind-latest transitive crates as intentionally not chased. <!-- sdd-owner: implementation -->
- [ ] Create the canonical specs for the new domains: `openspec/specs/build-reproducibility/spec.md` and `openspec/specs/frontend-dependencies/spec.md` from their change deltas. <!-- sdd-owner: implementation -->
- [ ] Merge the change deltas into the existing canonical specs: `openspec/specs/backend-base/spec.md`, `openspec/specs/session-auth/spec.md` (apply the MODIFIED login requirement text), `openspec/specs/edge-security-headers/spec.md`, `openspec/specs/health-checks/spec.md`, `openspec/specs/mcp-dashboard/spec.md`. <!-- sdd-owner: implementation -->
- [ ] Write the verify report with: which backend tests executed versus self-skipped, the A3 proof result and which file became authoritative, the named-but-not-chased transitives, the D1 plaintext-LAN acceptance and its invalidation condition, the deferred `script-src` decision with the inline FOUC guard as its blocker, the empty-by-default trusted-proxy opt-in, the compose refresh decision, and "docker build not evidenced". <!-- sdd-owner: implementation -->
- [ ] Final full-change gate: `cd backend && cargo test --locked && cargo clippy --all-targets --all-features --locked -- -D warnings`; `cd frontend && pnpm install --frozen-lockfile && pnpm test && pnpm exec tsc --noEmit && pnpm run build`; `cd mcp-dashboard && npm ci && npm run typecheck && npm run build` — record every result in the verify report. <!-- sdd-owner: implementation -->

---

## Post-apply (parent-owned)

- [ ] Start or reuse bounded review for the six stacked PRs (U2 → U1a → U1b → U3 → S1 → S2) and confirm the review accounting applies the lockfile exemption rather than counting `Cargo.lock` / `pnpm-lock.yaml` / `package-lock.json`. <!-- sdd-owner: parent -->
- [ ] Gate the merge chain: confirm the `backend` CI job is green on the head of each stacked PR before merging down the chain, and confirm no `size:exception` was requested or implied. <!-- sdd-owner: parent -->
- [ ] Close the change lifecycle: decide archive versus keep-open for `openspec/changes/2026-09-23-dependency-security-refresh/` once the canonical spec sync and verify report are reviewed. <!-- sdd-owner: parent -->
