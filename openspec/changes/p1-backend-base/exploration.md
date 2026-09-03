## Exploration: p1-backend-base

### Current State
- Backend is an empty shell: `backend/src/` is empty, `backend/Cargo.toml` is a placeholder package (`personal-dashboard-backend`, edition 2021) with zero dependencies. No Axum router, no pool, no middleware exists today.
- Auth model is already grounded in `backend/migrations/0001_init_auth_and_categories.sql`: `users` (CITEXT email UNIQUE, `password_hash TEXT`, `display_name`, `is_active`), `sessions` (`token_hash TEXT UNIQUE` — store hash, never raw token; `user_id FK CASCADE`, `expires_at`, `revoked_at`, `user_agent`, `ip_address INET`, partial index on active sessions), `user_preferences` (currency `COP`, locale `es-CO`, timezone `America/Bogota`, `dashboard_layout JSONB`). Comment in migration says "token-based auth, JWT-friendly".
- `objetivo.md` P1-relevant scope: private single-user dashboard; "autenticación segura", data only for authorized user, no public exposure, important operations protected. Architecture locked: Rust Axum + PostgreSQL, Next.js static export served by Axum/Nginx on 1 CPU / 1 GB RAM (frontend static serving saves ~300 MB).
- Infra as-is: `docker/backend.Dockerfile` (rust:1.75-slim builder, binary `personal-dashboard-backend`, EXPOSE 3000, no static-asset copy, no migrate step, no HEALTHCHECK), `docker-compose.yml` (backend:3000, hardcoded `DATABASE_URL`, `postgres:15-alpine`, no healthcheck, no resource limits, no env file), `.gitignore` (ignores `Cargo.lock` — wrong for a deployable binary; covers `.env` correctly).
- Later migrations (0002 finance, 0003 savings/debts/subs/assets, 0004 habits/goals/tasks/calendar/notes) all hang off `users(id) ON DELETE CASCADE` — so the auth + user-scoping foundation in 0001 is the load-bearing piece P1 must get right.

### Affected Areas
- `backend/Cargo.toml` — add axum, tokio, sqlx (postgres+runtime-tokio+tls), tower layers, argon2, rand/sha2, serde, tracing, tower-http; decide on `Cargo.lock` commit policy.
- `backend/src/` (empty) — new modules: `main.rs`, `config.rs`, `db.rs`, `error.rs`, `auth/` (hash, tokens, middleware), `routes/health.rs`, `routes/auth.rs`, `tests/` for login flow.
- `backend/migrations/0001_init_auth_and_categories.sql` — read-only reference; P1 must implement exactly this shape (token_hash lookup, revoked_at/expiry checks, CITEXT email). No schema change expected in P1.
- `docker/backend.Dockerfile` — needs static-dir serving path later, migrate-or-connect strategy, HEALTHCHECK, non-root user.
- `docker-compose.yml` — needs healthcheck, resource limits (1CPU/1GB), env-file secrets instead of hardcoded password, PG version alignment (file says 15-alpine; live DB reported as PG18.6).
- `.gitignore` — `Cargo.lock` ignore line conflicts with reproducible binary builds.

### Approaches
1. **Opaque session tokens (SHA-256 `token_hash`) + DB-backed middleware** — random 256-bit token issued at login, only `SHA256(token)` stored in `sessions.token_hash`; every request hashes Bearer and looks up active session (`revoked_at IS NULL`, `expires_at > now()`).
   - Pros: matches 0001 schema exactly; revocation is one UPDATE; no key rotation/JWKS infrastructure; minimal RAM/CPU; easiest to audit for single-user app; HttpOnly Secure SameSite cookie or Bearer both work.
   - Cons: one DB lookup per request (negligible for single user); not stateless across regions (irrelevant here).
   - Effort: Low
2. **JWT access tokens (stateless)** — signed JWT (HS256 or RS256+JWKS) as Bearer, sessions table used only for refresh/revocation list.
   - Pros: stateless validation, horizontal-scale friendly.
   - Cons: revocation needs blacklist/Redis (extra memory on 1 GB box); key rotation burden; single-user app gains nothing; api-security-patterns skill's RS256+JWKS guidance is SaaS-grade overkill here; mismatch with `token_hash UNIQUE` design (would need jti plumbing).
   - Effort: Medium
3. **sqlx (async, checked queries)** vs **Diesel (DSL + codegen)** — proposal already names sqlx.
   - Pros (sqlx): async-native with Tokio/Axum; compile-time `query!` checks against live DB; no schema-codegen drift across 21 tables / 4 migrations; lighter build; `PgPool` with max-connections tuned for 1 GB.
   - Cons (sqlx): needs `DATABASE_URL` at build for checked macros (use `sqlx offline` data / `.sqlx/` cache in Docker); Diesel's type-safe DSL fans lose their query builder.
   - Effort: Low (sqlx is the path of least resistance)
4. **Error shape: `thiserror` domain enum → `IntoResponse`** — `AppError::{Auth, Forbidden, Validation, NotFound, Conflict, Db, Internal}` mapped to 401/403/422/404/409/500 with stable JSON `{ "error": { "code": "...", "message": "..." } }`, generic 500 message, `x-request-id` tracing.
   - Pros: matches rust-best-practices (thiserror for domain, anyhow only at main boundary); never leaks internals (security-and-hardening); frontend gets a stable contract from day one.
   - Cons: small upfront boilerplate vs ad-hoc string errors.
   - Effort: Low
5. **Health depth: split liveness + readiness** — `GET /health` (no DB, cheap, Dokploy liveness) + `GET /ready` (SELECT 1 with timeout, Dokploy readiness).
   - Pros: avoids restart loops when DB blips; gives Dokploy/Docker distinct signals; trivial to implement.
   - Cons: two endpoints to document instead of one.
   - Effort: Low

### Recommendation
Ship **opaque session tokens (approach 1) + sqlx (approach 3) + thiserror JSON errors (approach 4) + split /health + /ready (approach 5)**. Rationale: it implements the schema that already exists instead of fighting it, keeps the 1 CPU / 1 GB box lean (no Redis/JWKS sidecars), satisfies objetivo.md's "autenticación segura, sin exposición pública" with the least crypto surface (argon2id for `password_hash`, SHA-256 for `token_hash`, constant-time compare), and establishes the error/health contracts every later P-module will reuse. JWT stays a future toggle — the `sessions` table comment already says "JWT-friendly", so a signed-token migration later does not require a schema rewrite.

### Risks
- `docker-compose.yml` pins `postgres:15-alpine` but live DB is reported as PG18.6 — verify migration SQL (enums, CITEXT, pgcrypto) applies cleanly on both before locking the Dockerfile base.
- `.gitignore` ignores `Cargo.lock`; for a deployed binary this breaks reproducible builds — commit the lockfile or scope the ignore to libraries.
- `docker/backend.Dockerfile` `COPY backend/Cargo.toml backend/Cargo.lock* ./Cargo.toml ./Cargo.lock` plus `mkdir src` shim is fragile and has no `sqlx` offline cache, no migration step, no HEALTHCHECK, no non-root user.
- Hardcoded `DATABASE_URL` credentials in compose; move to env file (`DATABASE_URL`, `SESSION_SECRET`/pepper) before any deploy.
- Argon2 cost parameters must be tuned for 1 CPU so login does not starve the box; add a strict login rate limit (e.g. 10 attempts / 15 min) from day one.
- Axum static serving (`ServeDir` for `frontend/out`) is not in the Dockerfile yet — keep the serving path behind a `STATIC_DIR` env so P1 API work is not blocked by frontend builds.

### Ready for Proposal
Yes — `openspec/p1-backend-base/proposal.md` already exists with matching scope (Axum, sqlx, auth middleware, error handling, health check). Orchestrator should proceed to sdd-spec (auth login/logout/me, error envelope, /health + /ready scenarios) and then sdd-design, reusing this exploration as input.
