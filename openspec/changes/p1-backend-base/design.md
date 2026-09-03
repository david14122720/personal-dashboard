# Design: p1-backend-base — Lean Axum Foundation

## Technical Approach

One Axum binary booted from env, `PgPool` capped for 1CPU/1GB, opaque session auth grounded in migration 0001 (`users`, `sessions.token_hash`, `user_preferences`), unified `AppError` envelope, split `/health` (no DB) vs `/ready` (`SELECT 1`, 2s timeout). Covers specs `backend-base`, `session-auth`, `health-checks`; no P2+ domains, no RBAC.

## Architecture Decisions

| # | Decision | Options (tradeoff) | Choice |
|---|----------|--------------------|--------|
| 1 | Session tokens | JWT stateless but needs JWKS/rotation + revocation needs blacklist/Redis; Opaque costs one DB lookup/req, revocation is one UPDATE, matches 0001 schema | Opaque: 32 random bytes → base64url; store only `hex(SHA256(token))`; `POST /logout` sets `revoked_at=now()` |
| 2 | sqlx checks in Docker | Runtime queries (no DB at build, lose compile-time checks) vs offline cache (extra `cargo sqlx prepare` step) | `SQLX_OFFLINE=true` + committed `.sqlx/` cache; builder needs no DB |
| 3 | Pool sizing (1CPU/1GB) | Large pool (contention, RAM) vs bounded (queues under burst; fine for single user) | max 5, min 1, acquire ≤5s, idle ≤300s, `/ready` `SELECT 1` ≤2s |
| 4 | Password hash cost | bcrypt-12 (fast, weaker vs GPU) vs Argon2id OWASP default (heavy for 1CPU) | argon2id m=19456,t=2,p=1 (~19MiB, one thread); login-only cost, acceptable latency |
| 5 | Login rate limit | Redis sliding window (infra P1 lacks) vs in-process fixed window (lost on restart, single replica) | In-process `Mutex<HashMap<IpAddr, Vec<Instant>>>` on `POST /login`: 10/15min → 429 + `Retry-After`; single-replica assumption documented |
| 6 | Static serving | Separate web server (more containers) vs optional fallback | `STATIC_DIR` unset → API only; set → `ServeDir` fallback after API routes, 404 hides paths |
| 7 | Middleware order | RequestId inside auth (errors lose ID) vs outermost | Outermost→in: `SetRequestId`+`PropagateRequestId` → `TraceLayer` (never log password/token) → CORS → routes; auth layer only on `/logout`, `/me` |

## Data Flow

```
Client → Router ─┬─ public: /health (no DB), /ready (SELECT 1), POST /login
                 └─ auth layer (Bearer→SHA256→sessions⨝users) → POST /logout, GET /me
Handlers → PgPool (≤5) → PostgreSQL 15+          AppError → envelope + x-request-id
```

Only non-obvious pattern — token issue/verify:

```rust
let raw: [u8; 32] = rand::random(); let token = base64url(raw);
let hash = hex::encode(Sha256::digest(token.as_bytes())); // stored; raw returned once
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/Cargo.toml` | Modify | axum, tokio, sqlx/postgres+rustls+offline, argon2, rand, sha2, base64, thiserror, tower-http, uuid, chrono, serde |
| `backend/src/main.rs` | Create | boot: load config, PgPool, migrate-or-connect, layer stack, serve on PORT |
| `backend/src/config.rs` | Create | env struct (`DATABASE_URL`, `PORT`, `SESSION_TTL_HOURS`, `STATIC_DIR?`); fail-closed |
| `backend/src/db.rs` | Create | pool builder with bounds from decision 3 |
| `backend/src/error.rs` | Create | `AppError` thiserror enum → `IntoResponse` envelope + codes |
| `backend/src/state.rs` | Create | `AppState { pool, login_attempts, ttl }` |
| `backend/src/auth/{password,tokens,middleware,rate_limit}.rs` | Create | argon2 verify, token issue/hash, Bearer layer, in-process limiter |
| `backend/src/routes/{health,ready,login,logout,me}.rs` | Create | probes + session endpoints |
| `backend/.sqlx/` | Create | offline query cache (`cargo sqlx prepare`) |
| `docker/backend.Dockerfile` | Modify | `SQLX_OFFLINE=true` + copy `.sqlx`, non-root `appuser`, `HEALTHCHECK /health` |
| `docker-compose.yml` | Modify | healthchecks, mem/cpu limits, env_file, PG pin 15-alpine, `depends_on healthy` |
| `.gitignore` | Modify | un-ignore `Cargo.lock`, keep `.env*` ignored |

## Interfaces / Contracts

```json
POST /login {email,password} → 200 {token, expires_at} | 401 UNAUTHORIZED "Invalid credentials" | 422 VALIDATION_ERROR | 429 + Retry-After
POST /logout (Bearer) → 204 | 401
GET /me (Bearer) → 200 {id,email,display_name,preferences:{currency_code,locale,timezone,dashboard_layout}} | 401
GET /health → 200 {status:ok} (no DB, no auth) · GET /ready → 200 {status:ready} | 503 {status:not-ready}
Envelope: {error:{code,message}} + x-request-id (UUIDv4) always; 500 is always "Internal server error"
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `AppError`→status/code map; token hash round-trip; limiter window | `cargo test`, one assertion/test |
| Integration | login ok/401/inactive/CITEXT-case/429; logout revokes; `/me` valid/expired/revoked/malformed; `/health` 200 DB-down vs `/ready` 503 | axum test client + isolated PG (`#[sqlx::test]`), offline mode |
| E2E | container boot, probes via compose healthchecks under 1CPU/1GB | `docker compose up`, curl probes |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. HTTP auth hardening (fail-closed middleware, generic 401s, no secret logging) is covered in decisions 1/4/5/7 and propagates to tasks.

## Migration / Rollout

No migration required: 0001 already defines schema. Boot runs embedded `sqlx::migrate!` (migrate-or-connect, fail-closed). PG pinned `15-alpine` (matches compose + verified extensions; re-evaluate 18 in P2). Rollback: revert pre-P1 commit; no P1 data beyond test users.

## Open Questions

- [ ] `SESSION_TTL_HOURS` default (propose 24)?
- [ ] Seed-user bootstrap (one-shot CLI vs manual SQL) — tasks decide.
