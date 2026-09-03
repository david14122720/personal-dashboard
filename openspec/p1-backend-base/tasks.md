# Tasks: p1-backend-base — Lean Axum Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 550 - 750 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation) → PR 2 (Auth Core) → PR 3 (End-to-End Wiring) |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Server Boot, Config, DB Pool, & Errors | PR 1 | `cargo test` (Error/Config) | `curl localhost:PORT/health` | `backend/src/{config,db,error,state}.rs` |
| 2 | Auth Core: Passwords, Tokens, Rate Limit | PR 2 | `cargo test` (Auth logic) | `cargo test` (Auth unit) | `backend/src/auth/` |
| 3 | End-to-End Wiring: Routes & Middleware | PR 3 | `cargo test` (Integration) | `docker compose up` + curl | `backend/src/routes/`, `main.rs` |

## Phase 1: Foundation & Infrastructure (Work Unit 1)

- [x] 1.1 Update `backend/Cargo.toml` with Axum, Tokio, SQLx, tower-http, etc.
- [x] 1.2 Create `backend/src/config.rs` for env-driven boot (fail-closed).
- [x] 1.3 Create `backend/src/error.rs` with `AppError` enum and `IntoResponse` envelope.
- [x] 1.4 Create `backend/src/db.rs` with bounded `PgPool` (max 5, acquire ≤5s).
- [x] 1.5 Create `backend/src/state.rs` for shared `AppState`.
- [x] 1.6 Create `backend/src/main.rs` minimal boot logic (Config $\to$ DB $\to$ Server).
- [x] 1.7 Implement `GET /health` in `backend/src/routes/health.rs` (no DB).
- [x] 1.8 Implement `GET /ready` in `backend/src/routes/ready.rs` (`SELECT 1`, 2s timeout).
- [x] 1.9 Verify Unit 1: `cargo test`, `cargo clippy`, and curl probes for `/health` (read-only) and `/ready` (read-only).

## Phase 2: Auth Core Implementation (Work Unit 2)

- [x] 2.1 Create `backend/src/auth/password.rs`: Argon2id verify/hash.
- [x] 2.2 Create `backend/src/auth/tokens.rs`: 32-byte random $\to$ base64url $\to$ SHA-256 hash.
- [x] 2.3 Create `backend/src/auth/rate_limit.rs`: In-process `Mutex<HashMap>` (10/15min).
- [x] 2.4 Create `backend/src/auth/middleware.rs`: Bearer extraction $\to$ Hash $\to$ Session lookup.
- [x] 2.5 Write unit tests for token round-trip, password verification, and limiter windows.
- [x] 2.6 Verify Unit 2: `cargo test` (auth module) and `cargo clippy`.

## Phase 3: End-to-End Wiring & Integration (Work Unit 3)

- [x] 3.1 Implement `POST /login` in `backend/src/routes/login.rs` (Auth Core $\to$ DB).
- [x] 3.2 Implement `POST /logout` in `backend/src/routes/logout.rs` (Revoke $\to$ DB).
- [x] 3.3 Implement `GET /me` in `backend/src/routes/me.rs` (Middleware $\to$ User/Prefs).
- [x] 3.4 Implement a one-shot CLI command in `main.rs` (or separate bin) to create seed-user.
- [x] 3.5 Wire all routes into `main.rs` with correct layer order (RequestId $\to$ Trace $\to$ CORS $\to$ Auth).
- [x] 3.6 Update `docker/backend.Dockerfile` with `SQLX_OFFLINE=true`, `.sqlx` cache, and non-root user.
- [x] 3.7 Update `docker-compose.yml` with healthchecks, resource limits, and `depends_on healthy`.
- [x] 3.8 Update `.gitignore` to un-ignore `Cargo.lock`.
- [x] 3.9 Verify Unit 3: `cargo test` (integration), `docker compose up`, and full login/me/logout curl flow.

## Phase 4: Verification & Cleanup

- [x] 4.1 Run `cargo sqlx prepare` to generate `.sqlx/` offline cache (N/A by design: zero `query!` macros; `SQLX_OFFLINE=true cargo check --offline` passes).
- [x] 4.2 Verify `x-request-id` presence on all responses (including 401/500) — proven live on 200/401/404/422/429.
- [x] 4.3 Verify that passwords/tokens NEVER appear in logs — proven via code+log grep.
- [x] 4.4 Final check: `cargo clippy --all-targets -- -D warnings` — clean; plus C1 CITEXT fix re-proven live (31/31 tests).
