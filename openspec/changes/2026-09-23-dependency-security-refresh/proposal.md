# Proposal — 2026-09-23-dependency-security-refresh

- change: `2026-09-23-dependency-security-refresh`
- phase: propose
- date: 2026-09-23
- preflight: `execution: auto` · `artifact_store: openspec` · `delivery_strategy: auto-chain` · `review_budget: 400` · `chain_strategy: deferred`
- inputs read directly: `openspec/changes/2026-09-23-dependency-security-refresh/explore.md`, `openspec/config.yaml`
- parent context honoured: context7 evidence for TS 7 / zod 4 classic / MCP SDK peers / axum `Json` 2 MB limit; explore §2.2, §3, §4, §5, §6.

## status

`ready_for_specs` — all four blocking owner decisions from explore §4 (D1 TLS, D2 CORS, D3 hardening
scope, D4 lockfiles) are **resolved and binding** (§0 below), and the review-accounting question
(§4.7) is answered by an explicit parent decision. What remains are four reviewable **assumptions**
recorded in §2 (auto-delegated question round); none of them block writing specs or tasks, and none
reopens a binding decision.

## executive_summary

**Two tracks, three codebases, one CI repair, five work units.**

- **Track U (refresh)** bumps `frontend/` and `mcp-dashboard/` to latest and makes both installs
  *reproducible*. The only two majors that need real verification are **TypeScript 5.9.3 → 7.0.2**
  (both manifests) and **zod 3.25.76 → 4.6.5** (mcp-dashboard). Both tsconfigs already avoid every
  option value TS 7 removed (`module umd|amd|system|none`, `moduleResolution node|classic|node10`,
  `target es5`), and `mcp-dashboard/src/tools.ts` uses only the zod 4 *classic* surface — so these
  are verification jobs, not migrations. The backend has **no bump surface worth a PR**: its crates
  are already latest-compatible.
- **The red CI is the actual blocker.** `.github/workflows/ci.yml:42` runs `cargo test --offline`,
  which cannot resolve `argon2` on a clean runner, so every push is red. Fix = commit
  `backend/Cargo.lock` (already generated, `!backend/Cargo.lock` already at `.gitignore:5`) and
  switch that step to `--locked` **in the same commit**, plus `--locked` on the real build step in
  the production `Dockerfile:27` so the committed lockfile actually means something in the image.
- **Track S (hardening)** fixes four real, repo-owned gaps found in explore §3: wildcard CORS nobody
  consumes (SEC-002), no request timeout anywhere (SEC-003), a login rate limiter whose key is a
  client-supplied `X-Forwarded-For` (SEC-004) backed by a `HashMap` that never shrinks (SEC-005), and
  zero security headers on the `ServeDir` path that serves the whole app (SEC-006). It also closes the
  supply-chain hole that `mcp-dashboard` has **no lockfile at all** while `.gitignore:11` ignores
  `package-lock.json` repo-wide (SEC-007).
- **The scariest finding is deliberately out of scope**: SEC-001 (plaintext HTTP carrying a password
  POST and a bearer token) is an edge/infra matter and the owner has **explicitly accepted
  plaintext-LAN** (D1) — this change records that acceptance as a spec constraint instead of doing
  infra work.

**Review accounting (parent decision, recorded here so the harness does not misread it):** generated
lockfiles — `Cargo.lock`, `pnpm-lock.yaml`, `package-lock.json` — are **EXEMPT** from the 400-line
review budget; the budget applies to hand-written code only. This is **not** a `size:exception`; no
exception is requested or implied. On that accounting the change is ≈ 200–260 hand-written lines
across five units (§9), i.e. comfortably inside budget with no unit close to the cap.

## 0. Binding owner decisions (recorded, not reopened)

| # | Decision | What it commits this change to |
|---|---|---|
| **D1** | **TLS: accept plaintext-LAN explicitly.** | No TLS/cert/Traefik/HSTS work in this change. The acceptance is *documented* as a spec constraint (`backend-base` + `edge-security-headers`) so a future change cannot "discover" it as a bug. Any non-LAN exposure invalidates the acceptance and is a new change. |
| **D2** | **CORS: restrictive same-origin — drop the wildcard. No env allow-list.** | `CorsLayer` is removed outright from `build_router`; no `API_ALLOWED_ORIGINS` is invented. Same-origin serving (`Dockerfile:36` `STATIC_DIR=/app/static`) + `localStorage` bearer (`frontend/lib/api/client.ts`) is the only supported access mode, and it keeps working. |
| **D3** | **Hardening full scope.** | U/S1 delivers all five: XFF rate-limit fix via `ConnectInfo` + trusted-proxy check, request timeout layer, bounded rate-limiter map, security headers on the Axum `ServeDir` path, CORS removal. |
| **D4** | **Lockfiles full.** | Commit `backend/Cargo.lock` and `mcp-dashboard/package-lock.json`, add the `.gitignore` negation for the latter, `--locked` in CI and in the Dockerfile, and clean up the ignored `pnpm.onlyBuiltDependencies` block — with the pnpm 11.23 key shape verified during apply (§7 U1, §2 A3). |
| — | **zod 4 deprecations: minimal fixes.** | `z.string().uuid()` → `z.uuid()` and `.email()` → `z.email()` land inside the MCP bump unit (U3), not as a separate "code change" change. |
| — | **Backend crate bumps: none.** | Only the two behind-latest *transitive* packages get **named** in apply (`cargo update --dry-run`, explore §2.4). They are never chased: changing them means editing `Cargo.toml` ranges, which is a separate deliberate decision. |

## 1. Intent / business problem

- **Why now, and what it costs today.** The CI for this repo has been red on every push because
  `cargo test --offline` cannot resolve dependencies on a clean runner. A red pipeline destroys the
  only automated evidence the dashboard has that a change did not break auth or finance math, so
  every future change (including the finance/productivity one in flight) is merged on manual
  confidence. That is the pain worth paying for.
- **Unpinable installs are a real supply-chain hole, not a hygiene nit.** `mcp-dashboard` has no
  lockfile *and* `.gitignore` ignores `package-lock.json` repo-wide, so a fresh `npm install`
  resolves whatever is current, silently, on a process that holds an API-token path to the entire
  personal dataset (finance, debts, subscriptions, notes). "npm audit is clean" is unverifiable if
  the resolved tree is not the reviewed tree. `--frozen-lockfile` in `Dockerfile:11` and `ci.yml:59`
  already assumes a committed lock; only `Cargo.lock` and the pnpm lock satisfy it today.
- **Stale dependencies are latent drift, and the majors are cheap right now.** TypeScript 7 and
  zod 4 are both *verification-only* here precisely because the repo's two tsconfigs and its one zod
  surface are already compatible. Deferring makes the next refresh more expensive, and doing it
  together with the lockfile commits is what makes "latest, reproducibly" a single meaningful act.
- **The hardening gaps are exploitable or user-visible, not theoretical.** SEC-004 defeats the only
  brute-force control that protects a password endpoint: anyone who can reach host port `8055`
  directly rotates `X-Forwarded-For` per request and gets unlimited attempts (explore §3 SEC-004,
  with archived evidence that Traefik is *not* in that request path). SEC-005 turns the same
  spoofable header into unbounded memory growth in a `Mutex<HashMap>` on a 1 CPU / 1 GB box.
  SEC-003 means one stuck handler holds a connection forever. SEC-006 leaves a dashboard with
  state-changing actions behind a bearer session with no frame guard at all in the repo-visible
  serving path.
- **What would stay broken without this change:** red CI, an advisory-only lockfile, a rate limiter
  that can be bypassed with one header, and a dependency set that drifts on every install.

## 2. Proposal question round (delegated by `auto` — reviewable assumptions, not silent choices)

Preflight chose `execution: auto`, so this round is **not** posed interactively; the four questions
below are the ones worth asking, each with the assumption this proposal fixed in its place. Correct
any of them and the proposal is revised before specs. Nothing here asks about harness mechanics.

1. **Does any real workflow ever point `NEXT_PUBLIC_API_URL` off-origin?** (Decides whether D2's CORS
   removal is a one-line deletion or needs a dev-proxy story.)
   **Assumption A1:** no. The build sets `ENV NEXT_PUBLIC_API_URL=/api` (`Dockerfile:13`) and
   `client.ts` defaults to `/api`, so the browser is always same-origin; local dev uses the Next
   rewrites/proxy or a same-port backend. CORS is therefore dropped with no replacement, and if a
   genuine off-origin dev need appears later it returns as its own change with an explicit allow-list.
2. **When should `X-Forwarded-For` be trusted at all?** (D3 says "ConnectInfo + trusted-proxy check"
   but does not say who is trusted.)
   **Assumption A2:** *never by default.* The peer socket address from the already-wired
   `into_make_service_with_connect_info::<SocketAddr>()` (`main.rs:319`) becomes the rate-limit key,
   and XFF is honoured only when the peer is in a trusted-proxy set that is **empty unless an
   operator opts in**. Chosen because the whole attack *is* on the LAN, so "trust any private-range
   peer" would preserve the bypass; and because today's browsed origin does not pass through a proxy
   at all. Cost if wrong: behind a future reverse proxy every LAN user collapses onto one key, which
   is exactly what the opt-in exists for.
3. **Which key does pnpm 11.23 actually honour for build-script approval?** (`package.json`
   `pnpm.onlyBuiltDependencies` list vs `pnpm-workspace.yaml` `allowBuilds:` map.) This is the only
   place a "cleanup" can silently break the install.
   **Assumption A3:** the workspace `allowBuilds:` map is authoritative for this pnpm and the
   `package.json` block is dead weight — which is why CI passes today while pnpm emits an
   `onlyBuiltDependencies` warning (`openspec/changes/archive/2026-09-10-p9-finanzas/verify-report.md:74`).
   Apply must **prove** it before deleting: `pnpm -v`, then an install with the block removed must
   still approve `esbuild`/`msw`/`sharp` builds (no `Ignored build scripts` for those three). If pnpm
   instead honours the `package.json` key, the change is a *migration* of the three entries into the
   workspace file, not a deletion.
4. **Is `docker-compose.yml` still a workflow you use?** Explore called `docker/backend.Dockerfile`
   "orphaned", and it is *not* orphaned by reference: `docker-compose.yml:5` builds it, mapping
   `3000:3000` with `PORT=3000`. It is stale instead (`FROM rust:1.75-slim-bookworm` against a tree
   on `rand 0.10` / `base64 0.23` / `sqlx 0.9`, whose MSRVs 1.75 may not satisfy — so it is plausibly
   unbuildable, not merely unused).
   **Assumption A4:** treat it as **confirm-or-delete with a bias toward deleting the pair**. If
   Dokploy builds the root `Dockerfile` (archived `odd/tasks/closeout-mvp.md:34,73` says so) and
   compose is not used, delete `docker/backend.Dockerfile` **and** `docker-compose.yml` together —
   leaving a compose file that points at a deleted Dockerfile is worse than either state. If compose
   *is* used, the honest minimal fix is `rust:1-slim-bookworm` + `--locked` there too, and a note that
   it still does not serve static assets. Apply must ask once before deleting; deletion of a working
   local workflow is not something this change infers.

## 3. Target users and situations

- **Owner/operator (one person) on their own LAN** — the app's only user. Affected indirectly: green
  CI and reproducibility protect the data they care about; the timeout and header work changes what
  a stalled request *feels* like (bounded 504/timeout instead of an open spinner).
- **Future-me / any agent making the next change** — the primary beneficiary of this one. Situation:
  opening any PR and seeing a pipeline that can actually be trusted; reading a lockfile that pins what
  shipped; finding the plaintext-LAN acceptance written down instead of re-litigating it.
- **The moment of urgency is "right now, before the next feature change"** — CI is red *today*, and
  the finance/productivity change in flight will merge against it.
- **Secondary consumer: MCP clients** (an LLM assistant talking to `mcp-dashboard` with an API token).
  Their situation: they install/run the server from a tree that today resolves differently on every
  machine. Their contract changes only in that zod deprecations are fixed and the tool schemas stay
  behaviourally identical.
- **Nobody else.** No multi-tenancy, no support load, no other team. Every cost lands on one person
  who made all four binding decisions.

## 4. Product outcome (what is true afterwards)

- CI is **green and meaningful**: `cargo test --locked` resolves `argon2` from a committed lockfile
  against the Postgres service, and the frontend job keeps installing `--frozen-lockfile`.
- **Three installs, all reproducible**: pnpm (already), Cargo (now committed + honoured by CI *and*
  by the production image via `--locked`), npm for `mcp-dashboard` (now `npm ci` with a committed
  lockfile and a `.gitignore` negation).
- **The login brute-force control actually binds**: the rate-limit key is the peer address, a spoofed
  `X-Forwarded-For` buys an attacker nothing unless a proxy was deliberately configured, and the map
  cannot grow without bound.
- **Requests end.** A hung handler returns instead of holding a connection forever, while `/health`,
  `/ready` and static streaming stay outside the timeout.
- **The app is served with a real, minimal header set from repo-owned code**, so the clickjacking and
  MIME-sniffing posture is visible to CI and to any deployment — not only to an edge nobody can
  evidence.
- **Dependencies are latest-compatible and stay honest** — TS 7, zod 4, MCP SDK 1.30, Next 16.3.6,
  React 19.3.0, `@types/node` 26 — with the majors proven by the verification ladder (§8), not by
  optimism.
- **Two stale artifacts are gone or explicitly fixed** (pnpm key block, `docker/backend.Dockerfile` +
  compose pair), and docs stop describing an install method that cannot be pinned.
- What does **not** change: no new or altered user-facing feature, no data movement, no TLS, no port
  or firewall change, no `Cargo.toml` version-range widening.

## 5. Current-state gap (measurable, with evidence)

| Gap | Evidence | Unit |
|---|---|---|
| Backend CI red on every push — `--offline` cannot resolve `argon2` | `.github/workflows/ci.yml:42` | U2 |
| Committed lockfile is advisory only in the shipped image | `Dockerfile:27` `cargo build --release` without `--locked`; `Dockerfile:19` `COPY backend/Cargo.lock*` (tolerant glob) | U2 |
| `mcp-dashboard` not reproducible and unpinnable | no `package-lock.json`; `.gitignore:11` ignores `package-lock.json` repo-wide; no `packageManager` field | U3 |
| Wildcard CORS with no consumer | `backend/src/main.rs:218-223`; same-origin serving `Dockerfile:36`; bearer from `localStorage` `frontend/lib/api/client.ts` | S1 |
| No request timeout anywhere | `main.rs:304-309` layers = RequestId + Trace only | S1 |
| Login rate limiter trusts client headers | `routes/login.rs:29-42` (XFF → `x-real-ip` → `127.0.0.1`), key used at `:63` | S1 |
| Limiter map grows without bound; panic-in-handler on poison | `auth/rate_limit.rs:48-50` (`.expect(...)`, `entry(ip).or_default()`, empty keys never removed, no cap) | S1 |
| No security headers in the repo-owned serving path | `frontend/next.config.ts` (`output: "export"` → `headers()` inert); `Dockerfile` serves via `ServeDir` with no header layer | S1 |
| Ignored pnpm build-approval block + pnpm warning | `frontend/package.json:7-11` vs `frontend/pnpm-workspace.yaml` `allowBuilds:`; warning logged in archived verify report | S2 |
| Stale, likely-unbuildable second Dockerfile wired into compose | `docker/backend.Dockerfile:2` `rust:1.75-slim-bookworm`; `docker-compose.yml:5` | S2 |
| Docs instruct an unpinnable install | `mcp-dashboard/README.md:26` `npm install` | S2 |
| Deps behind latest (2 majors + 7 minors/patches) | `frontend/package.json`, `mcp-dashboard/package.json` | U1, U3 |

## 6. Scope — work units (five)

Order of merge: **U2 → U1 → U3 → S1 → S2** (U2 first: it is the smallest change that turns evidence
back on; S1 after U1/U3 so hardening diffs are not competing with bump noise; S2 last: it deletes /
documents.)

### U1 — `chore(frontend): refresh deps to latest (TypeScript 7 as its own subunit first)`

- **U1a (TS 7 alone, first commit):** `typescript` `5.9.3 → 7.0.2` in `frontend/package.json` +
  regenerated `pnpm-lock.yaml`. Proven by `pnpm exec tsc --noEmit` and `pnpm run build` **before** any
  runtime package moves, so if 7.0.2 surfaces type errors that 5.9.3 tolerated, the failure is
  unambiguous and revertable in one commit.
- **U1b (everything else):** `next` 16.3.4→16.3.6, `react`/`react-dom` 19.2.8→19.3.0,
  `@types/react` 19.2.18→19.3.0, `@types/react-dom` 19.2.7→19.3.0, `@types/node` 26.5.0→26.6.2,
  `jsdom` 30.0.1→30.1.1, `vitest` 5.0.0→5.0.1, **plus the parent-omitted "latest" members** to be
  probed and enumerated at apply: `@testing-library/jest-dom`, `@testing-library/react`,
  `@vitejs/plugin-react`, and the caret floaters `recharts`, `@playwright/test`.
- **Gates:** `pnpm install` → `pnpm test` → `pnpm exec tsc --noEmit` → `pnpm run build` →
  `pnpm exec playwright test --list`.
- **No change expected** in `frontend/tsconfig.json` (already TS-7 clean), `vitest.config.ts` (5.0.0 →
  5.0.1 keeps the config shape), or `next.config.ts`.
- **First-slice boundary:** if TS 7 forces source edits, U1a grows its own follow-up commit inside
  U1; the unit does not fold runtime bumps into a TS-7 fix.
- **Rollback:** `git revert` the U1b commit (and/or U1a) — no data, no migration.

### U2 — `ci: commit backend Cargo.lock and build/test with --locked`

- `.github/workflows/ci.yml:42`: `cargo test --offline` → `cargo test --locked`.
- `Dockerfile:27`: `cargo build --release` → `cargo build --release --locked` (the one line that makes
  the committed lock real in the shipped image). The dependency-warmup dummy build at `Dockerfile:17`
  stays tolerant (`|| true`) by design; the gated build is the one that changes.
- Commit `backend/Cargo.lock` (247 pkgs, generated fresh; `.gitignore:5` already negates it).
- **Atomicity rule:** the lockfile and the CI flag land in the **same commit** — CI changed first
  stays red, which defeats the purpose.
- **Gates:** locally `cargo build --locked` and `cargo test --locked` (DB tests need `DATABASE_URL`;
  they self-skip without it — see risk R5), then the real proof: **the `backend` CI job green**.
- Also **names** (does not chase) the two behind-latest transitive crates via
  `cargo update --dry-run`, and records them in the verify report with the reason they stay.
- **Rollback:** `git revert` the single commit; CI returns to a red-but-known state.

### U3 — `chore(mcp): refresh deps (MCP SDK 1.30, zod 4, TS 7, @types/node 26) + commit lockfile`

- `mcp-dashboard/package.json`: `@modelcontextprotocol/sdk` `^1.12.0`→1.30.1, `zod` `^3.23.8`→4.6.5,
  `typescript` `^5.5.0`→7.0.2, `@types/node` `^20.12.0`→26.6.2, and the parent-omitted `express`
  `^5.2.1` / `@types/express` `^5.0.6` probed to latest; add a `packageManager` field.
- `.gitignore`: add `!mcp-dashboard/package-lock.json` next to the repo-wide `package-lock.json`
  ignore; commit the generated lockfile (exempt from the line budget).
- Minimal zod deprecation fixes in `src/tools.ts` per the binding decision: `z.string().uuid()` →
  `z.uuid()`, `.email()` → `z.email()`. Everything else (`z.object`, `.min/.max/.optional`, `z.enum`,
  `z.number().int()`, `z.array`, `z.ZodTypeAny`, `.parse()`) is unchanged zod-4 classic.
- **Gates:** `npm ci` → `npm run typecheck` → `npm run build` → `node dist/index.js` boots and
  `curl :3101/healthz` answers → one read tool and one rejecting-input tool dispatched, to prove the
  zod-4 error path still returns the generic rejection rather than throwing through the transport.
- **Boundary:** no change to `src/index.ts` host/origin allow-list behaviour, no new tools, no
  body-limit change (express default 100 kB stays).
- **Rollback:** `git revert` (manifest + lock + the `tools.ts` one-liners revert together; the
  `.gitignore` negation is harmless if left behind).

### S1 — `feat(backend): harden serving path — CORS, timeout, peer-address rate limit, bounded map, security headers` (TDD)

Five sub-changes, one reviewable unit, each RED first with the existing `oneshot` harness
(`main.rs` `#[cfg(test)] mod api_nest_tests`):

1. **CORS (D2).** Delete the `CorsLayer` from `build_router` — same-origin only, no env allow-list.
   Test: a preflight-less same-origin-shaped request still gets its JSON, and no
   `access-control-allow-origin: *` appears on any response.
2. **Request timeout (SEC-003).** `tower_http::timeout::TimeoutLayer` (new `timeout` feature on the
   existing `tower-http 0.7` dep) applied to the **`/api` nest only** — *not* the outermost layer and
   *not* `ServeDir` streaming, and *not* `/health`/`/ready`, so the probes and the static export stay
   outside it. Generous budget (15 s) so argon2 login is never cut off. Test: a slow handler yields
   the timeout status; `/health` is unaffected.
3. **Peer-address rate limiting (SEC-004).** `login_handler` takes
   `ConnectInfo<SocketAddr>` (the server already uses
   `into_make_service_with_connect_info::<SocketAddr>()`) and keys the limiter on `addr.ip()`.
   `X-Forwarded-For` / `X-Real-Ip` are consulted **only** when the peer is a configured trusted proxy,
   with the trusted set **empty by default** (A2) — so the shipped behaviour ignores both headers.
   Tests: (a) spoofed XFF from two different peers gets two independent buckets; (b) with the
   opt-in configured, a proxy peer's first XFF element is used; (c) malformed XFF falls back to the
   peer, never to a shared constant.
4. **Bounded limiter map (SEC-005).** Prune-and-remove keys whose window is empty, and cap distinct
   keys with eviction of the least-recently-relevant entries; replace the
   `.expect("rate limiter mutex poisoned")` with a poisoning-tolerant
   `unwrap_or_else(|e| e.into_inner())` so a panic elsewhere cannot turn into a panic inside the
   request path. Tests: repeated distinct keys never exceed the cap; a blocked key expires; a
   re-appearance after eviction is allowed.
5. **Security headers (SEC-006).** `tower-http` `set-header` feature +
   `SetResponseHeaderLayer` on the **outer** router so both `ServeDir` responses and API JSON carry:
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
   `Content-Security-Policy: frame-ancestors 'none'`. Deliberately **no** `script-src` (the inline
   FOUC guard at `frontend/app/layout.tsx:38,44` would need `'unsafe-inline'` or a hash — recorded as
   a deferred CSP decision), and deliberately **no** `Permissions-Policy` here, because that header is
   already owned by the `edge-security-headers` spec and setting it twice invites a duplicate-header
   conflict. Tests assert presence and exact values on a static path and on an API path.
- **`Cargo.toml` diff is features-only** (`tower-http = [... , "timeout", "set-header"]`) — no version
  range change, consistent with the binding "no backend crate bumps".
- **Body size:** left alone — axum's `Json` extractor already enforces a 2 MB default (context7
  evidence), and no endpoint needs more.
- **Rollback:** revert S1 as one commit; every sub-change is additive/removable and there is no data
  or config migration anywhere in it.

### S2 — `chore: pnpm build-approval key, stale compose pair, docs` (confirm-or-delete + evidence)

- **pnpm key (D4, A3):** delete `frontend/package.json:7-11` `pnpm.onlyBuiltDependencies` **only after**
  proving `pnpm -v` + a clean install still approves `esbuild`/`msw`/`sharp` via
  `pnpm-workspace.yaml`'s `allowBuilds:`. If the proof fails, migrate the three entries instead, and
  say which in the commit message.
- **`docker/backend.Dockerfile` + `docker-compose.yml`:** confirm-or-delete per A4 — ask once, then
  delete the pair, or refresh (`rust:1-slim-bookworm`, `--locked`, and an explicit note that this file
  serves no static assets, unlike the root `Dockerfile`). No third option: a compose file pointing at
  a stale build is the status quo being preserved by half a fix.
- **Docs:** `mcp-dashboard/README.md:26` `npm install` → `npm ci` + a sentence that the lockfile is
  committed; note the pinning policy (`--locked` in CI and image builds) wherever install steps are
  documented; and — if U2 names the two behind-latest transitives — record them as *intentionally*
  not chased so the next agent does not treat it as an oversight.
- **Gates:** `pnpm install --frozen-lockfile` + `pnpm test` still green after the key deletion;
  `pnpm exec tsc --noEmit`; `cargo test --locked` unaffected.
- **Rollback:** `git revert`; if the compose pair was deleted, the revert restores both files.

## 7. Scope — explicit non-goals / later

- **No TLS, certificates, HSTS, Traefik/Dokploy or firewall work** (D1). Plaintext-LAN acceptance is
  *documented*, not *fixed*, in this change.
- **No new user-facing features and no behaviour redesign.** Not a layout change, not an i18n change,
  not a finance change.
- **No `Cargo.toml` version-range widening**; no chasing of the two behind-latest transitive Rust
  packages (binding).
- **No CORS env allow-list** (D2).
- **No `script-src` CSP** — needs a decision about the inline FOUC guard; deferred with the reason
  written down (S1.5).
- **No docker daemon verification assumed.** If no daemon is available in apply, the image build is
  recorded as *not evidenced* in the verify report rather than inferred from `pnpm build` +
  `cargo build` success (explore §5.8).
- **No new npm CI job** for `mcp-dashboard` in this change unless it is free — the lockfile commit is
  the required outcome; a `npm ci && npm audit --audit-level=high` job is a tempting scope creep and
  is explicitly *later*.
- **Prior-change leftovers untouched:** `openspec/changes/2026-09-23-simplify-finance-productivity/`,
  the finance/productivity code it owns, `odd/`, `.codegraph/`, `.pi/`, `CLAUDE.md`,
  `frontend/{AGENTS,CLAUDE}.md`, `frontend/tsconfig.tsbuildinfo`.
- **No secret-scanning repo settings work** — explore SEC-008 found the tree clean and the GitHub
  push-protection question is a repo-settings follow-up, not a diff.
- **No `cargo audit`** (tool absent / unverifiable offline); recorded as a tooling gap, with
  `cargo update --dry-run`, `cargo tree`, and the clean npm/pnpm audits as the substitute evidence.

## 8. Verification ladder (per unit; run in order, stop at first red)

```
U2 backend:  cargo build --locked → cargo test --locked (DATABASE_URL set locally so DB tests really run)
             → cargo clippy --all-targets --all-features --locked -- -D warnings
             → acceptance: the `backend` CI job green (this is the goal of the unit)
U1 frontend: pnpm install → pnpm test → pnpm exec tsc --noEmit → pnpm run build
             → pnpm exec playwright test --list        (U1a runs this ladder before U1b starts)
U3 mcp:      npm ci → npm run typecheck → npm run build → node dist/index.js
             → curl :3101/healthz → dispatch one read tool + one rejecting tool
S1 backend:  RED/GREEN per sub-change with tower::ServiceExt::oneshot in `api_nest_tests`, then the full
             U2 ladder again (cargo test/clippy --locked) and a manual curl -sI against a locally-run
             STATIC_DIR build to eyeball headers when a runtime is available
S2 mixed:    pnpm -v + clean install proves build-approval for esbuild/msw/sharp → pnpm test →
             pnpm exec tsc --noEmit → cargo test --locked unaffected
packaging:   docker build -f Dockerfile .  — only if a daemon exists locally; otherwise record
             "not evidenced" honestly
```

`config.yaml` declares `strict_tdd: false`, so the ritual is not globally mandated — but **S1 is
TDD regardless**: its five sub-changes are exactly the kind of behaviour a `oneshot` test can pin,
and explore §6 reached the same conclusion. U1/U2/U3/S2 are **evidence-gated by the ladder**, which
is the honest verification story for a dependency refresh.

## 9. Review-budget accounting (first-slice sizing)

| Unit | Hand-written lines (est.) | Generated (exempt) |
|---|---|---|
| U1a + U1b frontend bumps | ~15 (manifest) + 0 source ideally | `pnpm-lock.yaml` |
| U2 lockfile + CI + Dockerfile | ~3 (`ci.yml`, `Dockerfile:27`) | `Cargo.lock` |
| U3 mcp bumps + lockfile | ~15 (manifest, `packageManager`) + ~4 (`tools.ts` z.uuid/z.email) + 1 (`.gitignore`) | `package-lock.json` |
| S1 hardening | ~120–160 code + ~80–120 tests | — |
| S2 pnpm key + compose pair + docs | ~10 + deletions + doc lines | `pnpm-lock.yaml` (if the deletion regenerates) |
| **Total hand-written** | **≈ 250–330** | exempt per parent decision |

S1 is the only unit anywhere near the cap and it is still well inside 400. No `size:exception` is
needed or requested, and none is inferred: if apply discovers that TS 7 forced non-trivial source
edits, the risk of exceeding budget **in U1** is flagged back to the parent as a delivery decision
(`ask-on-risk` behaviour), not absorbed silently.

## 10. Affected areas (index)

- **Frontend:** `frontend/package.json` (bumps + delete `:7-11` pnpm block in S2),
  `frontend/pnpm-lock.yaml` (regenerated, exempt), `frontend/pnpm-workspace.yaml` (only if A3 proves
  the key must change); verification-only: `tsconfig.json`, `vitest.config.ts`, `next.config.ts`,
  `playwright.config.ts`, `frontend/Dockerfile` (no edit needed; `--frozen-lockfile` is the tripwire).
- **mcp-dashboard:** `package.json`, new `package-lock.json`, `src/tools.ts` (zod 2 one-liners),
  `README.md:26`; verify-only `src/index.ts`, `src/client.ts`, `.env.example` (blocked by the
  read-only executor — confirm by eye at apply), `tsconfig.json`.
- **Backend:** `backend/Cargo.lock` (commit), `Cargo.toml` (tower-http features only),
  `src/main.rs:218-223` (CORS), `:304-309` (timeout + header layers), `:319` (ConnectInfo already
  wired), `src/routes/login.rs:29-42,63` (peer-address key), `src/auth/rate_limit.rs:44-64` (bounded
  map + poison tolerance), `main.rs` `api_nest_tests` (new tests).
- **CI / packaging:** `.github/workflows/ci.yml:42`, `Dockerfile:19,27`,
  `docker/backend.Dockerfile` + `docker-compose.yml` (confirm-or-delete pair), `.gitignore:11`
  (add the mcp negation; `:5` already negates `backend/Cargo.lock`).
- **Specs to update (this is where the durable knowledge lands):** `backend-base` (CORS gone,
  timeout, peer-address rate limit, header set, and the **accepted plaintext-LAN constraint** from D1),
  `session-auth` (rate-limit key = peer address, bounded map), `edge-security-headers` (what the app
  owns vs what the edge owns; record the deferred `script-src` decision), `mcp-dashboard` (lockfile +
  `npm ci` + pinning), `health-checks` (probes stay outside the timeout).
- **Out of scope (do not touch):** §7 list.

## 11. Edge cases

- **TS 7 rejects code that 5.9.3 tolerated** → green `next build` goes red with no "wrong" source
  change. Handled by making U1a its own commit and gating it before U1b.
- **Trusted-proxy opt-in changes the limiter's key granularity.** With the default empty set, a
  behind-proxy deployment collapses all users onto the proxy's address; the opt-in is the escape
  hatch and must be documented in the spec, not just the code.
- **`ConnectInfo` is absent in `oneshot` tests.** `build_router`'s existing test harness has no
  IO make-service, so a strict `ConnectInfo<SocketAddr>` extractor would fail the very tests meant to
  prove the fix. Design consequence: derive the peer address from an **optional** `ConnectInfo`
  (absent → a fixed non-spoofable local default, never a header-derived value), or supply the
  extension in tests. Whichever is chosen must be *tested both ways*, because getting this wrong
  re-creates SEC-004 as a 500.
- **Timeout vs argon2 and vs streaming.** A too-low global timeout would break slow logins and
  `ServeDir`; hence `/api`-nest-only placement and a 15 s budget, with `/health`/`/ready` explicitly
  outside.
- **`--locked` fails hard on drift.** If a `Cargo.toml` range and the committed lock disagree, both CI
  and the image build fail — that is the intended trade (loud beats silent), but it means the
  lockfile commit must be *fresh*, not stale, in the same commit.
- **`--frozen-lockfile` fails on manifest/lock divergence** in both `Dockerfile:11` and `ci.yml:59`;
  every manifest edit must land with its regenerated lock or the image job dies.
- **pnpm caret floaters** (`recharts`, `@playwright/test`) change lock content with no manifest edit;
  S2's deletion may regenerate the lock too, so verify which unit owns which lock churn.
- **Deleting `frontend/package.json`'s pnpm block while pnpm actually honours it** would silently
  un-approve `esbuild`/`msw`/`sharp` build scripts (broken vitest/msw/sharp with no error message) —
  hence A3's proof-before-delete gate.
- **Empty-state / boundary cases for headers:** error responses (401/404/422/500) and the SPA-fallback
  `index.html` must still carry the headers — a layer placed only on success paths would be a
  false-confidence fix. Test at least one error response and one fallback document.
- **Duplicate `Permissions-Policy`:** setting it in the app while the edge also sets it risks a
  duplicated header the edge spec forbids; hence "app does not own it".
- **Rate-limiter eviction vs live blocks:** bounded eviction must not silently reset a
  currently-blocked attacker's counter; cap and prune must be proven compatible by test.
- **zod 4 error shape through MCP:** rejecting tools must still return the same validation-failure
  path (`ZodError.issues`), which is why U3 dispatches one rejecting tool rather than only typecheck.

## 12. Implications / impact

- **Development workflow gets measurably better:** green CI, `npm ci`/`pnpm --frozen-lockfile`/
  `cargo --locked` all meaningful, and one documented place where "latest" is pinned.
- **Operational:** no infra change, but three *behaviour* changes a user could notice — requests can
  now time out (bounded 504 instead of a hang), responses gain headers, and login throttling keys on
  the real peer (so a LAN user behind a future proxy shares a bucket until the opt-in is set).
- **Support burden:** none (personal). **Other teams:** none.
- **Data:** none touched. No migration, no row, no schema change anywhere in these five units — which
  is what makes rollback uniformly `git revert`.
- **Review load:** concentrated in S1 (≈ 200–280 lines including tests); the bump units are
  manifest-plus-exempt-lock reviews.
- **Risk of a false green (from explore §5.6, kept honest):** DB-gated backend tests self-skip
  without `DATABASE_URL`; CI provides Postgres and applies migrations, so the green run is real — but
  a *local* green run proves less than it looks, and the fix must not turn `--offline` into a false
  pass. Record in verify exactly which tests executed.
- **Precedent set:** "generated lockfiles are review-exempt; the manifest diff is the reviewable
  unit" is now an explicit accounting rule for future refresh changes (and it came from the parent,
  so it is a decision to reuse, not to re-litigate).

## 13. Risks

| # | Risk | Mitigation / owner |
|---|---|---|
| R1 | **TS 7 surfaces pre-existing type errors** and turns green builds red for reasons that look like regressions. | U1a alone, first; ladder order; revert U1a only. Budget note §9 flags a U1 blow-up back to the parent instead of absorbing it. |
| R2 | **A3 wrong → build scripts silently un-approved** after the pnpm block deletion. | Proof-before-delete (install output must show `esbuild`/`msw`/`sharp` approved); fall back to migrating the entries. |
| R3 | **`ConnectInfo` absent in `oneshot`** breaks the new tests, or the fallback accidentally trusts headers. | A2 default "ignore XFF"; test both with and without the extension; explicit test that XFF cannot influence the bucket. |
| R4 | **Timeout too aggressive** for argon2 login or `ServeDir`. | `/api`-nest-only placement, 15 s, probes excluded, test that `/health` is untouched. |
| R5 | **CI green without actually running DB tests** (self-skipping) → false confidence. | Verify report states which tests ran; keep the Postgres service + migration step; never "fix" `--offline` into a silent skip. |
| R6 | **Lock/manifest drift breaks `--frozen-lockfile` / `--locked`** in image and CI. | Every manifest edit ships its regenerated lock; one atomic commit for lockfile + CI flag; no `Cargo.toml` range edits in this change. |
| R7 | **Deleting the compose pair destroys a working local workflow.** | A4: confirm before deleting; refresh path is a legitimate outcome; never half-fix. |
| R8 | **Image build unverifiable without a docker daemon.** | Record "not evidenced" in verify; rely on `cargo build --locked` + `pnpm build`; no docker daemon is assumed. |
| R9 | **MCP SDK × zod peer ambiguity** lets an install mix resolutions. | The committed `package-lock.json` *is* the mitigation (SEC-007), plus the two tool dispatches in U3's gate. |
| R10 | **Hardening reads as scope creep on a "dependency refresh".** | D3 made it in scope by owner decision; S1 is its own unit with its own revert, and specs record the new invariants. |
| R11 | **Headers create a duplicate/conflicting policy with the edge** the repo cannot observe. | App owns `nosniff`/`XFO`/`Referrer-Policy`/`frame-ancestors`; edge keeps `Permissions-Policy`; `edge-security-headers` updated to say so. |
| R12 | **Behind-latest transitives tempt an unplanned range widening.** | Binding decision; U2 only *names* them, and S2 documents why they stay. |

## 14. Success criteria (acceptance, observable)

1. The `backend` CI job is **green** on `main` with `cargo test --locked`, and `backend/Cargo.lock` is
   tracked; `Dockerfile`'s real build step carries `--locked`.
2. `frontend` and `mcp-dashboard` installs are reproducible from committed locks:
   `pnpm install --frozen-lockfile` and `npm ci` both succeed from a clean checkout.
3. `typescript` is 7.0.2 in **both** manifests with `tsc --noEmit` and `next build` green; `zod` is
   4.6.5 with zero deprecation warnings from `src/tools.ts`; MCP SDK 1.30.1 and the parent-omitted
   packages enumerated and at latest.
4. `grep -rn "allow_origin(Any)" backend/src` returns nothing; no `access-control-allow-origin`
   header appears on any response.
5. A request to a slow `/api` handler terminates with a bounded timeout while `/health` and static
   assets keep answering.
6. A request carrying a spoofed `X-Forwarded-For` cannot obtain more than 10 login attempts per
   15 minutes **per peer address**, and the limiter's key count is bounded across many distinct keys.
7. `curl -sI` on both a static path and an API path shows
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   `Content-Security-Policy: frame-ancestors 'none'`.
8. No pnpm `onlyBuiltDependencies` warning during install, with `esbuild`/`msw`/`sharp` still building.
9. `docker/backend.Dockerfile` is either refreshed *or* deleted together with `docker-compose.yml`,
   with the decision and reason recorded in the verify report.
10. D1's plaintext-LAN acceptance, the deferred `script-src` decision, the empty-by-default trusted
    proxy set, and the two named-but-not-chased transitives are **written into the specs** so the next
    agent does not rediscover them as bugs.
11. No new feature, no schema change, no data change in the diff.

## artifacts

- `openspec/changes/2026-09-23-dependency-security-refresh/proposal.md` — this document.
- `openspec/changes/2026-09-23-dependency-security-refresh/explore.md` — the technical evidence base
  (file:line, SEC-001…SEC-008, risks). Read directly; not duplicated here.
- Memory: this proposal is also saved to Engram with
  `topic_key: sdd/2026-09-23-dependency-security-refresh/proposal`. The OpenSpec file is authoritative
  for this store (`artifact_store: openspec`).

## next_recommended

1. **`specs` for the five units**, in merge order U2 → U1 → U3 → S1 → S2, each spec delta naming the
   file(s) it makes true. S1's spec work is the substantial one (backend-base + session-auth +
   health-checks + edge-security-headers).
2. **Design phase: skip.** With D1–D4 binding, the remaining design decisions are small and local
   (A2 trusted-proxy default, timeout placement, `ConnectInfo`-absent handling, header set). Each is
   decided *in* §6/S1 above; opening a design doc would only re-state them.
3. **Ask A4 once at apply time** before touching the compose pair, and confirm A1/A3 assumptions
   opportunistically (`NEXT_PUBLIC_API_URL` usage in practice; pnpm key behaviour proof).
4. **If the user corrects any §2 assumption** — especially A2 (trusted-proxy default) or A3 (pnpm key
   shape) — revise this proposal before specs, since both change what S1 and S2 must implement.

## skill_resolution

`paths-injected` — all four exact `SKILL.md` paths from the parent were read before any file work:
`.claude/skills/{rust-best-practices,next-best-practices,vercel-react-best-practices,security-review}/SKILL.md`.
Honest notes: (1) `security-review` and `rust-best-practices` drove the S1 shape (research-before-flagging,
report only confirmed-exploitable, no `unwrap`/`expect` in request paths, features-only Cargo.toml edit);
(2) `next-best-practices`/`vercel-react-best-practices` were consulted for the *static export*
constraints that make `next.config.ts` `headers()` inert and for the RSC/bundling facts that keep U1 a
manifest-only change — their rule files were not individually opened because U1 adds no components;
(3) **CodeGraph not usable by this executor** — no shell tool here, so no `gentle-ai codegraph init`
and no CLI queries; facts were confirmed with `read`/`grep`/`find` on concrete paths (CI step, `.gitignore`
negations and the repo-wide `package-lock.json` ignore, CORS lines and layer stack, `client_ip`,
`rate_limit.rs`, both package manifests, both Dockerfiles, `docker-compose.yml`, `pnpm-workspace.yaml`,
the existing `oneshot` test harness, and the spec list). Apply/verify phases with shell should run
`gentle-ai codegraph init` before impact analysis, and should verify the four version claims
(TS 7.0.2, zod 4.6.5, MCP SDK 1.30.1, `@types/node` 26.6.2) plus the parent-omitted packages against
the registry, since every version figure here is inherited from the parent, not probed.
