# Design — 2026-09-23-dependency-security-refresh

- change: `2026-09-23-dependency-security-refresh`
- phase: design
- date: 2026-09-23
- artifact_store: `openspec` (this file is authoritative)
- status: `ready_for_apply`
- inputs read directly: `proposal.md`, `specs/{backend-base,build-reproducibility,edge-security-headers,frontend-dependencies,health-checks,mcp-dashboard,session-auth}/spec.md`, `tasks.md`, `openspec/config.yaml`; code: `backend/src/{main.rs,routes/login.rs,auth/rate_limit.rs,state.rs,config.rs}`, `backend/Cargo.toml`, and the vendored `tower-http 0.7.1` timeout source.
- binding inputs (recorded, not reopened): proposal §0 D1–D4 and tasks.md header (merge order **U2 → U1a → U1b → U3 → S1 → S2**, stacked-to-main, 400-line review budget with generated lockfiles exempt, no `size:exception`, compose pair refresh-only).

## 1. Architecture decisions

Everything not listed below is inherited: product decisions from proposal §0/§6, requirements from `specs/*`, step checklists from `tasks.md`. Each decision below resolves a point the specs left to design, or a genuine ambiguity found while reading the code; in each case the safer option is chosen and named.

| # | Decision | Rationale / safer option |
|---|---|---|
| DD1 | **Optional ConnectInfo via an own extractor.** Add a small infallible `PeerAddr(pub Option<SocketAddr>)` implementing `FromRequestParts` by reading the `ConnectInfo<SocketAddr>` extension. Tests inject `ConnectInfo(addr)` into `Request::extensions_mut()`. | Avoids depending on axum's optional-extractor support and makes "extension absent" infallible, so R3 cannot re-appear as a 500. Satisfies `session-auth`'s "ConnectInfo absent in tests" scenario. |
| DD2 | **One key-derivation helper**, `rate_limit_key(peer: Option<SocketAddr>, headers: &HeaderMap, trusted: &[TrustedProxy]) -> IpAddr`: use the peer address; only when that peer is trusted use the first parseable `X-Forwarded-For` element; otherwise keep the peer. `X-Real-Ip` is removed from the key path entirely. When `PeerAddr` is `None`, use `LOCAL_PEER_FALLBACK = 127.0.0.1` — never a header value. | A single trusted header path is a smaller spoof surface than two; malformed/absent XFF falls back to the peer (never a shared constant), and the no-ConnectInfo case collapses into one fail-closed bucket. Matches the `session-auth` scenarios exactly. |
| DD3 | **`TRUSTED_PROXIES` grammar and threading.** Env var optional; absent or empty ⇒ trust nobody. Value = comma-separated tokens; each token is an exact `IpAddr` or `IpAddr/prefix` (IPv4/IPv6, std-only mask compare, no new dependency). A token that parses as neither is a `Config::from_env` error → the process refuses to start. Stored as `AppState.trusted_proxies: Arc<[TrustedProxy]>`; `lazy_state()` in tests uses an empty slice. | Fail-closed on a typo in the mechanism that gates header trust; no wildcard/`any` form exists, so "trust everyone" cannot be configured by accident. |
| DD4 | **Timeout placement and test seam.** `API_TIMEOUT = Duration::from_secs(15)`; applied as `TimeoutLayer::with_status_code(StatusCode::GATEWAY_TIMEOUT, budget)` to the nested `/api` subtree only (`api_routes().layer(...)` before `.nest("/api", ...)`), so the API's own fallback is covered while `/health`, `/ready` and `ServeDir` are not. Extract private `assemble(state, static_dir, api_routes: Router<AppState>, budget)`; `build_router` calls it with the constant, tests call it with a short budget plus a `#[cfg(test)]` slow route added to `api_routes()`. | `TimeoutLayer::new` is deprecated in tower-http 0.7.1 (would fail `clippy -D warnings`) and defaults to **408**; `with_status_code(GATEWAY_TIMEOUT, …)` delivers the spec's bounded **504** deterministically. The seam proves placement (probes/static outside) without changing the production signature. |
| DD5 | **Bounded limiter concretes.** `MAX_KEYS = 4096`; `check(&self, ip: IpAddr) -> Option<Duration>` and the 10-per-15-min budget stay unchanged. Every call prunes expired attempts across the map and removes emptied keys; when over cap, evict the key with the oldest last attempt that is *not* currently blocked; if every retained key is blocked, allow a temporary over-cap (never reset a blocker). Replace `.expect(...)` with `lock().unwrap_or_else(|e| e.into_inner())`. Add a `#[cfg(test)] with_limits(window, max_keys)` constructor. | Peer addresses cannot be spoofed over TCP, so 4096 real keys is unreachable on a LAN; the only over-cap case is "all keys are active attackers", where retaining blocks is safer than shrinking the map. The public signature and budget are untouched per `session-auth`. |
| DD6 | **Header layer.** Four `SetResponseHeaderLayer::overriding` instances, values exactly as `backend-base` pins, applied to the assembled outer router inside `build_router*` — covering API JSON, error responses, the SPA fallback and `ServeDir`. `main.rs`'s request-id/trace layers stay outermost and unchanged; no `Permissions-Policy`, no `script-src`. | `overriding` (not `if_not_present`) guarantees exactly one copy even if a handler ever sets one, satisfying the no-duplicate-header invariant. Outer placement is what makes error/fallback coverage real rather than success-path-only. |
| DD7 | **`Cargo.toml` stays additive.** Add `timeout` and `set-header` to the existing `tower-http 0.7` feature list; retain the now-unused `cors` feature; change no version range. | Binding "additive-only" constraint; removing `cors` is a follow-up recorded in the verify report. |
| DD8 | **Compose pair is refresh-only.** Bump `docker/backend.Dockerfile` to a current stable Rust base satisfying the tree's MSRVs, add `--locked` to its gated build, state in the file that it serves no static assets; keep `docker-compose.yml` and prove it still parses. `docker build` is recorded **not evidenced** unless a daemon exists. | Binding constraint (minimal safe edit). This supersedes the proposal's A4 delete branch: no deletion consent gate exists, and the `build-reproducibility` "Refresh path" scenario is the one that applies. |

## 2. Per-unit approach

Checklists and gates live in `tasks.md`; this section is only the shape of each unit.

- **U2 (first, atomic):** one commit = `backend/Cargo.lock` (fresh) + `ci.yml` `--offline` → `--locked` + `Dockerfile` gated build `--locked`. No code seams. Acceptance is the `backend` CI job green with DB tests actually executed; the two behind-latest transitives are named, not chased.
- **U1a then U1b:** manifest + regenerated `pnpm-lock.yaml` only. U1a isolates TypeScript 7.0.2 and runs the full ladder before U1b touches runtime packages; any TS-7-driven source edit stays in U1a and, if non-trivial, is escalated to the parent rather than absorbed.
- **U3:** `mcp-dashboard` pins + `packageManager` + `.gitignore` negation + committed `package-lock.json`; the two zod one-liners (`z.uuid()`, `z.email()`) land here. Gate includes booting the built server and dispatching one read tool plus one rejecting-input tool, so the zod-4 error path is proven through the transport.
- **S1 (TDD, one reviewable unit):** five sub-changes in order CORS → timeout → peer key → bounded map → headers. DD1/DD4/DD5/DD6 supply the seams; each sub-change is RED with `tower::ServiceExt::oneshot` in `api_nest_tests` first. One revert, no data/config migration.
- **S2 (last):** pnpm proof-then-delete-or-migrate for the build-approval key; compose refresh (DD8); `npm ci` docs; canonical spec sync; verify report. No deletion, no `npm audit` job.

Delivery: six stacked PRs in the binding order above; the PR is the review unit (S1 max ≈ 280 hand-written lines), generated lockfiles are exempt, and no `size:exception` is requested or implied.

## 3. Request path and data flow (after S1)

```text
SetRequestId → PropagateRequestId → Trace                    (main.rs, unchanged)
  └ assembled router (build_router, contains DD6 header layer)
      ├ GET /health, GET /ready                              (no API timeout)
      ├ /api → TimeoutLayer(504, 15 s) → api_routes + /api fallback
      └ ServeDir → index.html fallback                       (no API timeout)

POST /login → PeerAddr(ConnectInfo) ─trusted?→ XFF[0] else peer
                          └─ absent ──→ LOCAL_PEER_FALLBACK → limiter.check(ip) → 429 | continue
```

## 4. Test strategy

- **S1 is TDD** (`strict_tdd: false` does not apply to it; the five behaviours are exactly `oneshot`-provable). Tests: no `Access-Control-*` on API and preflight-shaped `OPTIONS`; slow `/api` handler returns 504 while `/health` answers and a temp-`STATIC_DIR` asset still serves; key derivation cases (two peers + rotating XFF ⇒ two buckets; trusted peer ⇒ XFF[0]; malformed XFF ⇒ peer; extension absent ⇒ no panic/500); limiter cases (cap respected, empty window pruned, blocked key survives eviction pressure, poisoned mutex recovered); headers on static path, API path, 401/404 and SPA fallback, with `permissions-policy` absent and no `script-src` in the CSP.
- **Header assertions are exact-value**, and each includes at least one error response and the fallback document, so a success-path-only layer cannot pass.
- **U1/U2/U3/S2 are evidence-gated by their ladders** (`tasks.md` §Per-slice and verification ladder), stopping at the first red; no new tests are invented for manifest bumps. TypeScript checks run before runtime bumps (U1a) so failures are attributable.
- **Anti-false-green (R5):** U2's local gate exports `DATABASE_URL` and applies migrations so DB-gated tests execute; the verify report states which tests ran versus self-skipped, and CI green is the acceptance proof.

## 5. Risks and rollback

- Product risks R1–R12 are owned by proposal §13 and are not restated. Design residuals, all resolved above: DD1 removes the "optional extractor may not exist" failure mode; DD4 removes both the deprecated-API clippy failure and the 408-vs-504 mismatch; DD3 makes a bad proxy token a startup error instead of silent trust; DD5 accepts a temporary over-cap only when every key is an active blocker; DD6 prevents duplicate headers.
- **Rollback is uniformly `git revert` per PR.** No schema, data, migration, TLS or infra change exists anywhere in the five units. U2's revert returns CI to its known-red state with no partial lockfile left behind; S1's revert removes all five sub-changes atomically; S2's revert restores the (refreshed, not deleted) compose pair.
- **Known limitations carried to verify:** registry version claims and the A3 pnpm proof are apply-time checks with in-unit fallbacks (`npm view` mismatch ⇒ pin actual latest and record; failed proof ⇒ migrate the three entries); `docker build` is only evidence if a daemon exists; the compose image build is otherwise "not evidenced".

## 6. Open questions

None. D1–D4 are binding, the merge order is fixed, and the only deferred items (`script-src` CSP, TLS, behind-latest transitives, `npm audit` CI job) are explicitly recorded as future changes in the proposal/specs.
