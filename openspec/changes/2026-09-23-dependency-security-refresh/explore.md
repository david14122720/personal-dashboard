# Explore — 2026-09-23 dependency-security-refresh

```yaml
status: ready
skill_resolution: paths-injected
review_budget: 400
delivery_strategy: auto-chain (chain deferred)
artifact_store: openspec
executed_with: read-only file/code inspection; no shell available in this executor
  (no cargo/pnpm/npm/could be run — every "latest version" claim below is the
  parent-injected fact plus repo evidence, and is marked VERIFIED BY APPLY where needed)
```

## Executive summary

Two tracks, three codebases, one CI repair.

- **TRACK U (bumps)** is mechanically simple except for three majors: TypeScript 7.0.2 (two manifests),
  zod 4.6.5 (mcp-dashboard), `@types/node` 26 (mcp-dashboard). Both tsconfigs already use only
  TS-7-compatible option values, so the majors are *verification* work, not migration work.
- **Backend has no bump surface worth a PR**: `backend/Cargo.lock` now exists (generated this session by
  the parent) and is already latest-compatible; `.gitignore` already has `!backend/Cargo.lock`, so
  committing it is a one-file change. The only *required* backend change is CI:
  `.github/workflows/ci.yml:42` runs `cargo test --offline`, which cannot resolve `argon2` and is red.
- **The two Rust packages still behind latest could not be named offline** (no `cargo` in this
  executor). Exact command to name them is in §2.4; expected to be transitive-only, so the honest
  recommendation is: commit the lockfile as generated, do not chase transitive "latest".
- **Parent's bump list is incomplete**: `express`, `@types/express` (mcp-dashboard) and
  `@testing-library/jest-dom`, `@testing-library/react`, `@vitejs/plugin-react` (frontend) are
  "update everything to latest" members that were never enumerated. They need a version probe before
  the manifest diff is frozen.
- **TRACK S**: audits are clean, auth/authz/error-handling are genuinely good (no leaks, every
  authenticated handler scoped by `user_id`, API tokens cannot mint sessions). The real findings are
  (1) plaintext HTTP serving of a password + bearer-token app — **owner decision, not a repo fix**,
  (2) wildcard CORS that no code path needs, (3) no request timeout anywhere,
  (4) `X-Forwarded-For` trusted unconditionally by the login rate limiter, (5) mcp-dashboard has no
  lockfile at all *and* `.gitignore` ignores `package-lock.json`, (6) `docker/backend.Dockerfile`
  pinned to `rust:1.75` looks orphaned and unbuildable.
- **Review-budget warning**: the pnpm-lock.yaml churn alone will dwarf 400 lines. Lockfiles and
  generated `.sqlx`/`tsbuildinfo` artifacts should be treated as review-exempt, with the *manifest*
  diff as the reviewable unit. Proposal should state this explicitly.

## 1. File map (every file this change touches or must verify)

### 1.1 Frontend — `frontend/` (pnpm, workspace root `frontend/pnpm-workspace.yaml`)

| File | Track | What changes / what to check |
|---|---|---|
| `frontend/package.json` | U | bump `next` 16.3.4→16.3.6, `react`/`react-dom` 19.2.8→19.3.0, `@types/react` 19.2.18→19.3.0, `@types/react-dom` 19.2.7→19.3.0, `@types/node` 26.5.0→26.6.2, `jsdom` 30.0.1→30.1.1, `vitest` 5.0.0→5.0.1, `typescript` 5.9.3→7.0.2; probe `@testing-library/jest-dom` 7.0.1, `@testing-library/react` 16.3.3, `@vitejs/plugin-react` 6.1.1 (not in parent list); caret deps `recharts ^3.10.1`, `@playwright/test ^1.63.0` can drift at install time — a `pnpm update` changes lock content even with no manifest edit |
| `frontend/package.json:7-11` | U | delete the ignored `pnpm.onlyBuiltDependencies` block (see §4 items 3–4 — key-name verification required) |
| `frontend/pnpm-workspace.yaml` | U | currently `allowBuilds: {esbuild,msw,sharp: true}`; must be the single source of build-approval truth |
| `frontend/pnpm-lock.yaml` | U | regenerated; review-exempt |
| `frontend/tsconfig.json` | U | **no change needed** — `target ES2022`, `module esnext`, `moduleResolution bundler`, `jsx react-jsx`, `incremental` + `noEmit`; none of the TS-7-removed values (`umd`/`amd`/`system`/`none`, `node`/`classic`/`node10`, `es5`) are used |
| `frontend/tsconfig.tsbuildinfo` | U | generated, ignored/untouched — do not commit |
| `frontend/vitest.config.ts` | U | vitest 5.0.1; config shape (`plugins:[react()]`, `test.environment jsdom`, `setupFiles`) unchanged between 5.0.0 and 5.0.1 |
| `frontend/next.config.ts` | S | `output: "export"`, `trailingSlash` — **no `headers()`**: they are inert in a static export, and there is nothing to remove |
| `frontend/playwright.config.ts` | U | verification only (`--list` in CI; live suite needs `E2E_SMOKE_LIVE=1` + backend) |
| `frontend/app/layout.tsx:38,44` | S | inline `FOUC_GUARD` script via `dangerouslySetInnerHTML` (constant, server-controlled → not an XSS finding, but it constrains any future CSP to allow inline script or a hash) |
| `frontend/lib/api/client.ts` | S | bearer from `localStorage`, default base `/api` (same-origin) → proves wildcard CORS is unneeded |
| `frontend/Dockerfile` (root `Dockerfile`, frontend stage) | U | `corepack prepare pnpm@11.23.0`; copies `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml`; a lockfile bump requires no Dockerfile edit, but `pnpm install --frozen-lockfile` fails if lock and manifest diverge |

### 1.2 mcp-dashboard (npm, no lockfile)

| File | Track | Notes |
|---|---|---|
| `mcp-dashboard/package.json` | U | `@modelcontextprotocol/sdk` `^1.12.0`→1.30.1, `zod` `^3.23.8`→4.6.5, `typescript` `^5.5.0`→7.0.2, `@types/node` `^20.12.0`→26.6.2, **plus parent-omitted** `express ^5.2.1`, `@types/express ^5.0.6` |
| `mcp-dashboard/package-lock.json` | U/S | **does not exist**; `.gitignore:11` ignores `package-lock.json` globally → needs `!mcp-dashboard/package-lock.json` (and `!frontend/package-lock.json` is not needed) to make the install reproducible |
| `mcp-dashboard/tsconfig.json` | U | `target ES2022`, `module`/`moduleResolution NodeNext` — TS-7 clean |
| `mcp-dashboard/src/tools.ts` | U | the entire zod surface: `z.object`, `z.string().uuid()`, `.email()`, `.min/.max/.optional`, `z.enum`, `z.number().int()`, `z.array`, `z.ZodTypeAny`, `.parse()`. All present in zod 4 "classic"; expect deprecation warnings on `.uuid()`/`.email()` only |
| `mcp-dashboard/src/index.ts` | S | already hardened (Host/Origin allowlist, UUID-only session id, per-request `AsyncLocalStorage` token, generic 500s). `app.use(express.json())` → default 100 kB limit; no body-size change needed |
| `mcp-dashboard/src/client.ts` | S | env-driven base URL, per-request token, no global credential slot. No finding |
| `mcp-dashboard/.env.example` | S | **unreadable by this executor** (harness blocked the `.env*` path). Not a secret: only a template. Confirm by eye in apply |
| `mcp-dashboard/README.md` | U | check for pinned versions / install instructions that mention npm without a lockfile |

### 1.3 Backend + CI + packaging

| File | Track | Notes |
|---|---|---|
| `.github/workflows/ci.yml:42` | U | `cargo test --offline` → `cargo test --locked` (the red-CI fix). No other CI edit required |
| `backend/Cargo.lock` | U | exists, 247 pkgs, generated fresh; `!backend/Cargo.lock` already in `.gitignore:5` → commit as-is |
| `backend/Cargo.toml` | S | **only if** a timeout layer is added: needs `tower-http` `timeout` feature or `tower` `timeout` feature (neither enabled today) |
| `backend/src/main.rs:218-223` | S | `CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)` |
| `backend/src/main.rs:306-309` | S | layer stack is RequestId + Trace only — **no timeout, no body-limit override** |
| `backend/src/main.rs:311` | S | binds `0.0.0.0:{PORT}` |
| `backend/src/routes/login.rs:29-42` | S | `client_ip()` trusts `x-forwarded-for` / `x-real-ip`; used as the rate-limit key at `login.rs:63` |
| `backend/src/auth/rate_limit.rs:48-50` | S | `.expect("rate limiter mutex poisoned")` + `map.entry(ip).or_default()` — per-IP `HashMap` never prunes empty keys |
| `Dockerfile:15` | U/S | `FROM rust:1-slim-bookworm` (floating `1` tag) |
| `Dockerfile:19` | U | `COPY backend/Cargo.lock* ./` — tolerant glob; committing the lockfile makes it real, but `RUN cargo build --release` (`Dockerfile:27`) does **not** pass `--locked`, so the committed lock can still be silently re-resolved in the image. Adding `--locked` there is the one-line change that makes the `Cargo.lock` commit mean something in production builds |
| `Dockerfile:11` | U | `pnpm install --frozen-lockfile` → fails if manifest and lock diverge |
| `Dockerfile:36-37` | S | `ENV STATIC_DIR=/app/static`, `ENV PORT=80` (plaintext, host-published 8055→80) |
| `docker/backend.Dockerfile:2` | S | `FROM rust:1.75-slim-bookworm` — stale; see §5 item 7 |

### 1.4 Explicitly out of scope
`.codegraph/`, `.pi/`, `frontend/AGENTS.md`, `frontend/CLAUDE.md`, `CLAUDE.md`,
`frontend/tsconfig.tsbuildinfo`, `odd/`, `openspec/changes/2026-09-23-simplify-finance-productivity/verify-report.md`.

## 2. Bump plan with per-package verification

### 2.1 Risk tiering

| Tier | Packages | Why | Gate |
|---|---|---|---|
| **Safe** | next 16.3.6, react/react-dom 19.3.0, @types/react(-dom) 19.3.0, @types/node 26.6.2 (frontend), jsdom 30.1.1, vitest 5.0.1, MCP SDK 1.30.1 | patch/minor within same major | `pnpm test` + `pnpm build` |
| **Medium** | `@types/node` ^20→26 in mcp-dashboard | major *range*, type-only; code uses `node:async_hooks`, `node:crypto`, `process.env`, `fetch`; runtime is node 24, engines `>=18` | `npm run typecheck` + `npm run build` + `node dist/index.js` boot |
| **High (named major)** | **TypeScript 5.9.3 → 7.0.2** (both manifests) | Go-native compiler; removed option values (none used here); stricter checks may surface *new* errors in previously-passing code; `next build` runs its own typecheck pass | `tsc --noEmit` (mcp) + `next build` (frontend) + `vitest run` |
| **High (named major)** | **zod 3.25.76 → 4.6.5** (mcp-dashboard) | MCP SDK peers allow `^3.25 \|\| ^4.0`; `tools.ts` uses classic API only; `.uuid()`/`.email()` deprecated-but-working; error shape (`ZodError.issues`) and `z.ZodTypeAny` unchanged | `tsc --noEmit` + `dispatchTool` smoke for one read tool and one rejecting case |
| **Unmeasured (parent gap)** | `express`, `@types/express`, `@testing-library/jest-dom`, `@testing-library/react`, `@vitejs/plugin-react` | "update everything" was stated but versions never probed; `@types/express` × express 5 has historically been the fiddliest pair | version probe + same gates as their suite |

### 2.2 Commit / review-unit shape (keeps each unit reviewable)

1. `ci: run cargo test --locked with a committed Cargo.lock` — `ci.yml` + `backend/Cargo.lock` (lock exempt from line budget).
2. `chore(frontend): drop ignored pnpm.onlyBuiltDependencies` — `package.json` (+ `pnpm-workspace.yaml` only if the key must change).
3. `chore(frontend): refresh deps to latest` — `package.json` + `pnpm-lock.yaml`.
4. `chore(mcp): refresh deps (SDK, zod 4, TS 7, @types/node 26) + commit lockfile` — `package.json` + new `package-lock.json` + `.gitignore` negation.
5. Security slices (§3), each its own unit: CORS, timeout, lockfile/CI-supply-chain, dockerfile.

Units 3 and 4 are the ones to gate: split them if TS 7 forces source edits.

### 2.3 Verification ladder (run in this order; stop at first red)

```
frontend:      pnpm install → pnpm test → pnpm exec tsc --noEmit → pnpm run build → pnpm exec playwright test --list
mcp-dashboard: npm ci (after locking) → npm run typecheck → npm run build → node dist/index.js + curl :3101/healthz
backend:       cargo build --locked → cargo test --locked (needs local PG via DATABASE_URL for the DB tests) → cargo clippy --all-targets --all-features --locked -- -D warnings
packaging:     docker build -f Dockerfile . (only if a docker daemon is available locally)
```

### 2.4 Naming the two lagging Rust packages (deferred, one command)

No `cargo` in this executor, so this stays an apply-phase task rather than a guess:

```bash
cd backend && cargo update --dry-run 2>&1 | grep -Ei 'Updating|Adding|Removing'
# or, if permitted: cargo install cargo-outdated && cargo outdated --root-dev-deps --exit-code 1
```

Interpretation guidance for proposal: the lockfile was generated with default (semver-compatible)
resolution, so "behind latest" almost certainly means *newer major outside the declared range* — e.g.
`hex 0.4.3` (only 0.4.x exists), or `sha2 0.10.9` sitting next to `sha2 0.11.0` transitively. Changing
those means editing `backend/Cargo.toml` ranges, not `cargo update`. **Recommendation: do not chase
them in this change** — the reproducible-build goal (committed lockfile) is met by committing what
exists; a range widening is a separate, deliberate decision.

## 3. Security findings (file:line evidence, severity, fix ownership)

Reviewed with the `security-review` skill's research-before-flagging discipline: React JSX is
auto-escaped, `dangerouslySetInnerHTML` here is a module constant, all SQL is parameterized
(`$1` binds), errors are generic (`AppError::Internal → "Internal server error"`, error.rs:39-46),
tokens are SHA-256-hashed at rest with 32-byte CSPRNG generation (tokens.rs:7-18), and
`require_session_user_id` correctly stops a leaked API token from minting sessions (helper.rs:30-48).
Every authenticated handler carries `require_user_id`/`require_session_user_id`; only `/health`,
`/ready`, `/api/login`, `/api/logout` are unauthenticated-by-design.

### SEC-001 — Plaintext HTTP carries passwords and bearer sessions — **High, owner decision**
- **Evidence**: `openspec/specs/edge-security-headers/spec.md:5` documents the browsed origin as
  `http://192.168.50.120:8055/`; `Dockerfile:37` `ENV PORT=80`; `backend/src/main.rs:311` binds
  `0.0.0.0`; `frontend/lib/api/client.ts:99-107` POSTs the password, `:9`/`setToken` stores the returned
  token in `localStorage`.
- **Impact**: anyone on the LAN (or a positioned attacker on the host network) captures credentials and
  full personal-finance data. Every other control in this list is decorative next to this.
- **Not repo-fixable**: TLS termination lives in Dokploy/Traefik. **Needs the owner**, and it is the
  question worth asking in this change (HTTPS + HSTS, or an explicit accepted "trusted-LAN-only"
  exception recorded as a spec constraint).

### SEC-002 — Wildcard CORS with no consumer — **Low (hardening), safe fix**
- **Evidence**: `backend/src/main.rs:218-223`.
- **Analysis**: `allow_origin(Any)` without `allow_credentials(true)`. The browser app is served
  same-origin by Axum (`Dockerfile:36`, `STATIC_DIR=/app/static`) and authenticates with a
  `localStorage` bearer header (`client.ts` `getToken`/`apiFetch`), never a cookie. So the wildcard buys
  nothing: cross-origin reads need a token that a foreign page cannot obtain. Real risk is low, but the
  surface is unnecessary and it will silently become dangerous if anyone later moves to cookie sessions.
- **Safe fix**: allow-list the dev origins (`.env`-driven `API_ALLOWED_ORIGINS`, default same-origin →
  no CORS layer emitted) or drop the layer. Decision needed only if a real cross-origin dev workflow
  exists (`NEXT_PUBLIC_API_URL` suggests it might).

### SEC-003 — No request timeout anywhere in the API — **Low/Medium (hardening), safe fix**
- **Evidence**: `backend/src/main.rs:304-309` layers only Trace + RequestId; no `TimeoutLayer`,
  no `tokio::time::timeout` except the deliberate 2 s probe in `routes/ready.rs:9`.
- **Impact**: a slow or stuck handler (DB stall, `ServeDir` on a dead mount) holds a connection open
  indefinitely. Single-user app → availability annoyance, not RCE.
- **Safe fix**: `tower::timeout::TimeoutLayer` (needs the `timeout` feature in `backend/Cargo.toml`) or
  `tower_http::timeout::TimeoutLayer`, applied to the `/api` nest only, generous (10–15 s) so argon2
  login is not cut off. **Caution**: a naive global timeout on the *outermost* layer would also kill
  `ServeDir` streaming and the `/health`/`/ready` probes if set too low.

### SEC-004 — Login rate limiter trusts client-supplied `X-Forwarded-For` — **Medium, safe fix**
- **Evidence**: `backend/src/routes/login.rs:29-42` takes the first `x-forwarded-for` value, then
  `x-real-ip`, falling back to `127.0.0.1`; `:63` uses it as the rate-limit key. The service binds
  `0.0.0.0:80` (`main.rs:311`, `Dockerfile:37`) and is published host-port `8055→80` with
  `domains: []` — per `openspec/changes/archive/2026-09-08-p7-es-futurista/evidence/slice-1/verification-report.md:27`
  Traefik is therefore **not** in the request path for the browsed origin.
- **Impact**: an attacker talking directly to `:8055` rotates `X-Forwarded-For` per request and gets
  unlimited login attempts against 10-per-15-min-per-IP (defeats the only brute-force control).
- **Fix has two halves**: (a) code — use the already-collected
  `ConnectInfo<SocketAddr>` (`main.rs:319` uses `into_make_service_with_connect_info::<SocketAddr>()`)
  and only honour `XFF` when the peer is a trusted proxy CIDR; (b) infra — do not publish the app port
  past the proxy. (a) is safe and small; (b) is an owner decision.
- **Note**: `require_user_id` has no per-token throttle either; SEC-004 is the only auth-rate finding.

### SEC-005 — Rate-limiter map grows without bound — **Low (DoS / hygiene), safe fix**
- **Evidence**: `backend/src/auth/rate_limit.rs:50` `map.entry(ip).or_default()` — expired timestamps
  are pruned inside a key's `Vec`, but empty per-IP keys are never removed, and there is no size cap.
  Combined with spoofable XFF (SEC-004) the key space is attacker-chosen, so `Mutex<HashMap>` growth
  has no natural ceiling.
- **Safe fix**: drop the entry when its vec becomes empty and/or add a max-key count with LRU eviction.
  Also `check()` uses `.expect("rate limiter mutex poisoned")` (`:48`) — a panic inside a request
  handler; acceptable today (no other code touches the map) but worth a `lock().unwrap_or_else(|e| e.into_inner())`.

### SEC-006 — Static export cannot own headers; edge has none in the request path — **Low/Medium, mostly infra**
- **Evidence**: `frontend/next.config.ts` (`output: "export"` → `headers()` is a no-op, and none are
  declared today); the prior change already established the edge is not repo-owned and could not even
  be reached by the agent
  (`openspec/changes/archive/2026-09-08-p7-es-futurista/evidence/slice-1/verification-report.md:8-34`,
  including the `Permissions-Policy` spec that was never evidenced as applied); `Dockerfile` serves
  `frontend/out` straight from Axum via `ServeDir` with no response-header layer.
- **Repo-owned gap**: security headers for a static export on a bare `STATIC_DIR` deployment
  (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
  `Content-Security-Policy` or at minimum a `frame-ancestors 'none'`) can be set by the Axum
  `ServeDir` path with `tower_http::set_response_header::SetResponseHeaderLayer` /
  `ResponseHeadersLayer`. That is the only version of this fix CI can see.
- **CSP caveat**: `frontend/app/layout.tsx:38,44` inject an inline FOUC script, so `script-src 'self'`
  breaks it — needs `'unsafe-inline'` or a hash, or drop the CSP-script ambition and ship
  `frame-ancestors 'none'` alone. Recommend the minimal, non-breaking set and record the CSP decision.
- **Clickjacking severity check** (per `security-audit/CLIENT-SIDE.md:42`): the dashboard *does* have
  state-changing actions behind a bearer session and no frame guard → this is a real, if
  low-likelihood (private LAN app), hardening item rather than a pure note.

### SEC-007 — mcp-dashboard is not reproducible and cannot be pinned — **Medium (supply chain), safe fix**
- **Evidence**: `find mcp-dashboard` → no `package-lock.json`; `.gitignore:11` ignores
  `package-lock.json` repo-wide with no negation; no `packageManager` field (unlike
  `frontend/package.json:5` `pnpm@11.23.0`); `package.json` declares caret ranges for all five deps.
- **Impact**: "npm audit reports 0 vulnerabilities" is unverifiable and unpinable — a fresh `npm i`
  resolves whatever is current, silently, on a server that holds an API-token-capable path to the whole
  personal dataset. This is the weakest link in the supply-chain story and it is entirely repo-owned.
- **Safe fix**: `!mcp-dashboard/package-lock.json` in `.gitignore`, commit a generated lockfile, add a
  `"packageManager"` field, and (optional) an npm job in `ci.yml` running
  `npm ci && npm run typecheck && npm run build && npm audit --audit-level=high`.

### SEC-008 — Secret scan: clean — **no finding**
- Pattern sweep over tracked source/config/docs (`api[_-]?key|secret|password|token|private[_-]?key` = quoted
  ≥12-char literal) → 3 hits: two identical test fixtures
  (`frontend/lib/api/tokens.test.ts:41`, `frontend/app/dashboard/ajustes/tokens/page.test.tsx:79`,
  value `pd_rawSecretOnlyOnce`) and one documentation placeholder
  (`.agents/skills/next-best-practices/scripts.md:127`). `find **/.env*` → only
  `mcp-dashboard/.env.example`. `.gitignore:16-20` excludes `.env*`. No private-key blocks, no
  provider-format tokens. GitHub secret scanning / push protection is a repo-settings item
  (`secret-scanning` skill steps 1–2) that cannot be verified from the working tree — record as a
  follow-up question, not a finding.
- **Cargo audit gap**: no shell in this executor → `cargo audit` was **not** run and `cargo-audit`
  presence is unknown. Per the parent's instruction, recorded as a tooling gap; `cargo update --dry-run`
  + `cargo tree` and the clean npm/pnpm audits are the substitute evidence for this round.

### Not flagged (researched and dismissed)
`apiBaseUrl()` from `NEXT_PUBLIC_API_URL` (build-time constant, not attacker-controlled); env-driven
`PERSONAL_DASHBOARD_API_URL` in `mcp-dashboard/src/client.ts:24` (operator config); server-side request
targets in MCP tools (server-controlled base + operator token); `res.json()` parse-in-try in
`client.ts:132-142`; sqlx string SQL constants with `$n` binds everywhere; `AppError` mapping table.

## 4. Decisions that need the owner (blocking for proposal)

1. **TLS / HTTPS exposure** (SEC-001) — fix at the edge, or accept plaintext-LAN explicitly.
2. **CORS** (SEC-002) — same-origin only (drop wildcard) vs an env allow-list; needs the answer to "is
   `NEXT_PUBLIC_API_URL` ever pointed off-origin in practice?"
3. **`pnpm.onlyBuiltDependencies` fix shape** — delete the stale `package.json` block, or also
   rename the workspace key. The workspace file already uses `allowBuilds:` for the same three
   packages, so this may be a pure deletion. Needs `pnpm -v` behaviour confirmed by apply.
4. **pnpm key-name verification** — `frontend/pnpm-workspace.yaml` currently uses
   `allowBuilds: {pkg: true}` (map form); `onlyBuiltDependencies` (list form) is what older pnpm 10
   documents. Apply must confirm which key pnpm 11.23 honours before deleting anything, or the
   esbuild/msw/sharp build scripts stop being approved silently. This is the only place where a
   "cleanup" can silently break the install.
5. **Committing `mcp-dashboard/package-lock.json`** (SEC-007) — requires editing `.gitignore`
   semantics that were clearly intentional (`package-lock.json` is ignored repo-wide).
6. **Timeout + header layers** — a small but real behaviour change in the serving path; confirm it is
   in scope for a "dependency refresh" change or should be a follow-up.
7. **Delivery strategy** — units 1+2+5(CI/lock/pnpm/dockerfile) are tiny; unit 3 and 4 are lockfile-heavy.
   The 400-line review budget cannot meaningfully count generated lockfiles; propose lockfile-exempt
   accounting or the change looks over budget immediately.

## 5. Risks

1. **TS 7 surfaces pre-existing type errors** that were tolerated by 5.9.3, turning green `next build` red
   without any source change being "wrong". Mitigation: land TS 7 as its own unit inside the frontend
   bump, or bump TS separately from the runtime packages.
2. **zod 4 deprecation noise**: `z.string().uuid()`/`.email()` still work in classic mode but may print
   warnings; the minimal honest fix is `z.uuid()`/`z.email()`, which is a code change and therefore
   expands this change beyond "dependency refresh". Decide before writing tasks.
3. **MCP SDK × zod peer range**: `^3.25 || ^4.0` is permissive; with caret ranges in
   `mcp-dashboard/package.json` an install can silently mix resolutions. Committing a lockfile (SEC-007)
   is also the mitigation for this risk.
4. **Lockfile churn breaks `--frozen-lockfile`**: both `Dockerfile:11` and `ci.yml:59` install with
   `--frozen-lockfile`, so a manifest edit without a regenerated `pnpm-lock.yaml` fails the image build
   (and the CI job), not just local dev. Related: `Dockerfile:27` builds the backend without `--locked`,
   so a committed `Cargo.lock` is advisory inside the image unless that flag is added.
5. **`cargo test --locked` needs the lockfile committed in the same commit**; a PR that changes CI first
   stays red. Order matters: lockfile + CI in one unit.
6. **Backend CI still needs Postgres**: `ci.yml:15-30` provides a service and applies
   `migrations/*.sql` with `psql`; DB-gated tests self-skip without `DATABASE_URL`
   (`auth/helper.rs:106-110`), so a green run proves less than it appears to. Do not "fix" the offline
   flag into a false pass.
7. **Two Dockerfiles, one live** (see §1.3): editing only the root `Dockerfile` may leave a stale,
   unbuildable `docker/backend.Dockerfile` in the tree; deleting it is a repo-owned cleanup that needs
   confirmation it is truly orphaned (nothing in CI references it; `odd/tasks/closeout-mvp.md:34,73` says
   the root file is the one Dokploy builds).
8. **No local docker daemon guarantee** → the frontend+backend image build may be unverifiable in apply,
   leaving the bump validated only by `pnpm build` + `cargo build`. Record honestly in verify.
9. **Review budget vs generated files**: without an explicit exemption, this change reads as
   `size:exception` purely from `pnpm-lock.yaml`/`Cargo.lock`, which would trigger a delivery decision the
   owner did not intend.

## 6. Recommended next phase shape

`explore → proposal → design (skip or keep minimal) → tasks`, with tasks grouped by the five work units
in §2.2 and the owner questions in §4 resolved *before* implementation. TDD applies to the backend
hardening units only (SEC-003/004/005/006 are testable with `tower::ServiceExt::oneshot` in the existing
`main.rs` `#[cfg(test)] mod api_nest_tests` harness); the bump units are evidence-gated by the §2.3
ladder, which is the honest verification story for a dependency refresh.
