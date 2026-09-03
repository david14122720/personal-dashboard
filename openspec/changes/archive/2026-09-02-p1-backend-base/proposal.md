# Proposal: p1-backend-base

## Intent

Establish the secure, lean backend foundation for the personal dashboard. This change provides the necessary infrastructure (server, database pool, error handling) and the critical authentication layer required for all subsequent feature modules.

## Scope

### In Scope
- **Core Infrastructure**: Axum server setup, `sqlx` PgPool tuned for 1CPU/1GB, and configuration management via env files.
- **Session Authentication**: Opaque session token system (SHA-256 `token_hash`), Argon2id password hashing, and authentication middleware.
- **Error Handling**: Global `thiserror` domain enum mapping to a stable JSON error envelope `{ "error": { "code", "message" } }`.
- **Health Probes**: Split `GET /health` (liveness) and `GET /ready` (readiness with DB check).
- **Infrastructure Hardening**: Dockerfile optimization (non-root user, HEALTHCHECK) and `docker-compose.yml` resource limits.

### Out of Scope
- Implementation of P2+ domains (Finance, Habits, Goals, etc.).
- Frontend build/deployment logic (only `STATIC_DIR` serving support).
- Complex RBAC (single-user scope only).

## Capabilities

### New Capabilities
- `backend-base`: Project scaffolding, configuration, DB pool, and global error handling.
- `session-auth`: Opaque token issuance, validation middleware, and login/logout/me endpoints.
- `health-checks`: Liveness and readiness probes for orchestration.

### Modified Capabilities
- None

## Approach

The backend will use a **Lean Foundation** approach to minimize the footprint on the 1CPU/1GB box:
- **Auth**: Opaque session tokens. A random 256-bit token is issued; only its SHA-256 hash is stored in the `sessions` table. This avoids the overhead of JWKS/Redis and matches the existing migration 0001 schema.
- **Database**: `sqlx` for async-native, compile-time checked queries against PostgreSQL.
- **Errors**: A domain-specific error enum mapped to `IntoResponse`, ensuring internal details are never leaked and the frontend receives a consistent contract.
- **Probes**: `/health` returns 200 immediately; `/ready` performs a `SELECT 1` with a timeout to ensure DB connectivity.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/Cargo.toml` | New | Add `axum`, `sqlx`, `tokio`, `argon2`, `thiserror`, `tower-http` |
| `backend/src/` | New | Full implementation of server, auth, and error modules |
| `docker/backend.Dockerfile` | Modified | Add HEALTHCHECK, non-root user, and `sqlx` offline support |
| `docker-compose.yml` | Modified | Add resource limits (1CPU/1GB) and env-file secrets |
| `.gitignore` | Modified | Stop ignoring `Cargo.lock` for reproducible builds |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| PG Version Drift | Med | Verify migration SQL against both PG15 and PG18 before locking base image |
| Resource Starvation | Low | Tune Argon2 cost parameters for 1CPU; implement strict login rate limiting |
| Secret Exposure | Med | Use `.env` files and strictly exclude them from git; use environment variables |

## Rollback Plan

Revert to the commit prior to the start of `p1-backend-base` implementation. Since it's a foundation change on an empty shell, no data loss is expected.

## Dependencies

- PostgreSQL 15+ (with `CITEXT` and `pgcrypto` extensions).
- Rust 1.75+.

## Success Criteria

- [ ] User can successfully login, receive a session token, and access `/me`.
- [ ] `GET /health` returns 200; `GET /ready` returns 200 only when DB is reachable.
- [ ] All errors return the stable JSON envelope.
- [ ] `cargo test` passes for all auth and health scenarios.
- [ ] Backend container respects 1CPU/1GB limits in Docker.
