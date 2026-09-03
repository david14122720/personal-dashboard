# Verify Report — p1-backend-base Phase 4 (tasks 4.1–4.4)

- change: p1-backend-base
- phase: 4 (Verification & Cleanup)
- mode: standard (Strict TDD OFF)
- verdict: FAIL (1 CRITICAL — CITEXT case-insensitive login broken at runtime)
- date: 2026-09-03 UTC
- verifier: sdd-verify (execution evidence below, no fixes applied, nothing committed)

## Scope

Tasks 4.1–4.4 verified against specs `backend-base`, `session-auth`, `health-checks`,
PR1 (310c06f) + PR2 (cae2717) + PR3 (1a005d5) implementation, live Dokploy PG 18.6
(host 192.168.50.120:5434, db pdbname). `backend/Cargo.lock` (untracked) and empty
`backend/.sqlx/` left untouched for orchestrator.

## Completeness (tasks 4.1–4.4 checkboxes in tasks.md are still unchecked)

| Task | Result |
|------|--------|
| 4.1 `cargo sqlx prepare` / `.sqlx` cache | N/A BY DESIGN (see WARNING W1) — no `query!` macros exist; runtime queries only |
| 4.2 `x-request-id` on all responses | PASS (200/401/404/422/429 live; 500 code-path only — WARNING W2) |
| 4.3 No secret leak + generic 401 | PASS (source + runtime; wrong-password-existing-user same variant — note N1) |
| 4.4 clippy clean + `cargo test` | PASS (clippy exit 0, 30/30 tests pass) |

## Build / test evidence (executed, not assumed)

| Command | Exit | Result |
|---------|------|--------|
| `cargo clippy --all-targets -- -D warnings` | 0 | clean, no warnings |
| `cargo test` | 0 | 30 passed, 0 failed (auth 23 + config 2 + db 1 + error 3 + password 5 overlap counted once) |
| `SQLX_OFFLINE=true cargo check --offline` | 0 | runtime queries need no `.sqlx` cache |
| `cargo sqlx prepare` | N/A | sqlx-cli not installed; cache unnecessary (no compile-time macros) |

## Live runtime evidence (server `personal-dashboard-backend`, PORT 18082, live DB)

| Probe | Result |
|-------|--------|
| `GET /health` | 200 `{"status":"ok"}` + `x-request-id` |
| `GET /ready` (DB up) | 200 `{"status":"ready"}` + `x-request-id` |
| `GET /me` no auth | 401 `UNAUTHORIZED`/`Invalid credentials` + `x-request-id` |
| `POST /login` unknown email | 401 generic + `x-request-id` |
| `POST /login` empty email | 422 `VALIDATION_ERROR` + `x-request-id` |
| `GET /nope-route-xyz` | 404 + `x-request-id` (empty body, Axum default) |
| 11 rapid `POST /login` same IP | 429 `RATE_LIMITED` + `Retry-After: 894` + `x-request-id` |
| CLI `--create-user P1Verify@example.com` | exit 0, `users` + `user_preferences` rows created |
| `POST /login` exact-case email | 200, 43-char base64url token, `expires_at` = now+24h |
| `GET /me` valid token | 200, prefs `COP/es-CO/America/Bogota`, no hashes exposed |
| `POST /logout` | 204, `revoked_at` set in DB, `token_hash` stored 64-hex (never raw) |
| `GET /me` revoked token | 401 generic + `x-request-id` |
| Server/request logs secret scan | CLEAN — no `password`, raw token, or `DATABASE_URL` value in code paths or runtime log |
| Cleanup | sessions (3) + prefs (1) + user (1) deleted; `users` count back to 0 — DB pristine |

## Spec compliance matrix

| Spec scenario | Status | Evidence |
|---------------|--------|----------|
| backend-base: boot + fail-closed env | PASS | server booted on PORT; `Config::from_env` unit-tested for missing `DATABASE_URL` |
| backend-base: pool bounds (≤5, ≤5s) | PASS | code review `db.rs` (prior phases); live pool served all probes |
| backend-base: 401 envelope + request-id | PASS | live 401 body + header |
| backend-base: 422 envelope | PASS | live 422 body + header |
| backend-base: 500 never leaks | PASS (code-path) | `error.rs` unit tests; no live 500 triggered (W2) |
| session-auth: successful login | PASS | live 200 + hash stored, `revoked_at NULL`, TTL 24h |
| session-auth: wrong password generic 401 | PASS | live 401 `Invalid credentials`; unknown-email path runtime-proven, wrong-password path shares `AppError::Auth` (N1) |
| session-auth: inactive denied | PASS (code-path) | `!is_active` → same `Auth` variant |
| session-auth: rate limit 10/15min + 429 | PASS | live 429 + `Retry-After`, in-process per-IP |
| session-auth: CITEXT case-insensitive | FAIL — CRITICAL C1 | exact-case 200; lowercase/uppercase 401 (reproduced 5×, distinct IPs; sqlx-level probe confirms) |
| session-auth: logout revoke + reuse 401 | PASS | live 204 → DB `revoked_at` set → 401 |
| session-auth: /me profile + prefs | PASS | live 200 with defaults, no `password_hash`/`token_hash` |
| session-auth: revoked/expired/malformed 401 | PASS | revoked + missing-header proven live; expired by code-path (`expires_at > now()` predicate) |
| session-auth: no secret in logs/API | PASS | source grep + empty runtime log + DB stores hash only |
| health-checks: /health 200, no DB/auth | PASS | live, incl. `x-request-id` |
| health-checks: /ready 200/503 | PASS | live 200; 503 DB-down path harnessed in PR3 (not re-run, DB was up) |

## Issues

### CRITICAL

- **C1 — `POST /login` email lookup is case-sensitive at runtime, violating
  session-auth "CITEXT email case-insensitive" scenario.**
  `GET /me`-style exact-case login returns 200, but lowercase/UPPERCASE variants
  of the same stored email return 401. Reproduced via HTTP (3 casings × fresh
  source IPs) and via an isolated sqlx probe (`WHERE email = $1` + `.bind()`:
  exact-case found, other casings not found), while the same lookup through
  psycopg2 (unknown-type param) IS case-insensitive and `email` is `citext` in
  `information_schema`. Root cause: sqlx binds `$1` with explicit TEXT OID; with
  only a `citext=citext` operator in `pg_operator`, PG 18.6 resolves
  `citext = text` to a case-sensitive comparison (column effectively coerced to
  text). Fix direction (for apply, not verify): cast the parameter —
  `WHERE email = $1::citext` in `login.rs` (and audit `me.rs`/others for the same
  pattern) + regression test with mixed-case email. Verifier applied no fix.

### WARNING

- **W1 — Task 4.1 (`cargo sqlx prepare`) is vacuous for this codebase.**
  sqlx-cli is not installed, `backend/.sqlx/` is empty, and there is nothing to
  populate it with: all queries use runtime `sqlx::query`/`query_as`, zero
  `query!`/`query_as!` compile-time macros, so `SQLX_OFFLINE=true` builds pass
  regardless (proven: `cargo check --offline` exit 0). The Dockerfile's
  `.sqlx`-copy + `SQLX_OFFLINE=true` is harmless but misleading. Recommend
  rewording 4.1 (or adopting `query!` macros if offline checking is actually
  wanted) rather than chasing an empty cache file.
- **W2 — No live 500-response evidence.**
  `x-request-id` proven on 200/401/404/422/429; the 500 envelope path is covered
  only by `error.rs` unit tests (`Internal`/`Db` → 500 `INTERNAL_ERROR`). No
  500 was triggered live (would require fault injection, e.g. taking PG down
  mid-request). Acceptable residual risk given unit coverage.
- **W3 — PG pin (15-alpine) vs live 18.6 drift stands.**
  `citext` + `pgcrypto` present and functional on 18.6; zero version-specific
  incompatibility observed. C1 is a client bind-typing bug, not a server-version
  issue (would reproduce on PG 15 identically). Still recommend aligning the
  compose pin with the deployed version in P2 per PR3 notes.

### SUGGESTION

- **S1 — CLI `--create-user` takes the password as an argv parameter**
  (`main.rs`); it is visible in process listings and shell history. Prefer
  prompting via stdin (rpassword) or `PGPASSWORD`-style env var.
- **S2 — 404 body is Axum's empty default**, not the `{ error: { code… } }`
  envelope. Consistent error shape on unknown routes would aid clients.
- **S3 — `tasks.md` 4.1–4.4 checkboxes remain unchecked**; orchestrator to tick
  4.2/4.3/4.4 on acceptance, and reword 4.1 per W1. Verifier changed no files.

## PG 15-alpine vs live 18.6 (task item 6)

Live server is PostgreSQL 18.6 (Debian). Extensions `citext`, `pgcrypto` verified
present; `citext = citext` equality case-insensitive as specified; `users.email`
column type `citext` confirmed. No `citext`/`pgcrypto` behavioral incompatibility
observed. C1 root cause is sqlx explicit-TEXT parameter typing, orthogonal to
server version.

## Verdict

**FAIL** — 1 CRITICAL (C1). All other Phase 4 checks pass with executed evidence.
Unblocks after C1 fix + rerun of the 3-casing login probe. Do NOT mark tasks
4.1–4.4 complete until then. Nothing committed; `Cargo.lock` + `.sqlx` state
left for orchestrator.
