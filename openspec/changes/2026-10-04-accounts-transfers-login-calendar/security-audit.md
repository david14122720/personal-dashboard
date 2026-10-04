# Security audit — authentication and session flow (read-only, 2026-10-04)

Scope: static audit of the login/session/API-token flow. Method: `.agents/skills/security-audit/SKILL.md` and `.agents/skills/security-review/SKILL.md` (entry points, trust boundaries, exploitability over theory). No server, DB or migration was run.

## Findings

| ID | Severity | Title | Evidence | Impact | Minimal fix | New dep? |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | HIGH (conditional) | Rate-limit key trusts the first `X-Forwarded-For` element | `backend/src/routes/login.rs:70-92` (esp. 87-91); test enshrining it at `login.rs:234-243` | When `TRUSTED_PROXIES` names a fronting proxy that *appends* (Traefik's documented default), a client-supplied `X-Forwarded-For: <fake>` yields a fresh limiter bucket per request → brute force fully bypassed; each request also burns one Argon2 verify (CPU DoS) | Walk `XFF` right-to-left and use the right-most element outside the trusted set; or require the edge to overwrite the header | No |
| A2 | MEDIUM | Global login lockout behind a proxy when `TRUSTED_PROXIES` is unset | `login.rs:112-116`; `config.rs:85-103`; `docker-compose.yml:1-14` (no `TRUSTED_PROXIES`) | With no trusted proxies every client shares the proxy socket IP → 10 requests / 15 min **total**; an unauthenticated attacker locks the owner out with 10 POSTs, and successful logins consume quota too (`rate_limit.rs:12-13`) | Key per IP *and* per account, count only failures, keep the response generic | No |
| A3 | MEDIUM | Timing-based user enumeration on login | `login.rs:119-130`; `password.rs:31-40` | Unknown user or `is_active=false` returns **before** Argon2 (19 MiB, t=2); the measurable gap distinguishes existing/active accounts | Always run `verify_password` against a fixed dummy PHC hash when the row is missing/inactive | No |
| A4 | MEDIUM | `is_active=false` not enforced on existing sessions or API tokens | `middleware.rs:24-26`; `helper.rs:30-40`; checked only at `login.rs:128` | Deactivating a user does not revoke 24 h sessions nor non-expiring API tokens — disabled credentials keep working | Require `users.is_active` in both lookup SQLs, or revoke sessions/tokens on deactivation | No |
| A5 | MEDIUM | No session rotation and no revoke-all; only the presented session can be revoked | `logout.rs:13`; `login.rs:132-142`; `main.rs:65-211` | A stolen token stays valid for the full absolute TTL (24 h) and the owner cannot invalidate it without DB surgery; no idle timeout | Add session list + revoke-all endpoint and a minimal Settings action; revoke all on password change | No |
| A6 | LOW | API-token `scopes` never enforced; expiry optional | `middleware.rs:26`; `tokens.rs:38-40, 52-57`; test `tokens.rs:386-389` | `scopes` defaults to `[]` and callers cannot set it, yet tokens gain full account access on every `require_user_id` route; omitting `expires_in_days` mints a permanent credential | Enforce a non-empty scope set or drop `scopes`; default expiry (e.g. 90 d) | No |
| A7 | LOW | No `Cache-Control: no-store` on token-bearing responses | `main.rs:271-286`; `login.rs:145`; `tokens.rs:190` | Session/API raw tokens are returned in JSON and may be retained by caches or browser history | `Cache-Control: no-store` on `POST /login` and `POST /tokens` | No |
| A8 | LOW (deployment) | Cleartext transport possible; no HSTS/`Secure` | `main.rs:366-380` (plain HTTP on 0.0.0.0); `docker-compose.yml:5-8` | In compose/HTTP-only mode, password and tokens cross the LAN in clear | Terminate TLS at the edge, HSTS, stop publishing port 3000 | No (infra) |
| A9 | LOW | `--create-user` takes the password as argv | `main.rs:311-318` | Password visible in shell history and `ps` while running | Read the password from stdin/env | No |
| A10 | INFO | Session token in `localStorage` (no HttpOnly cookie) | `frontend/lib/api/client.ts:9, 42-58` | Any XSS would exfiltrate the bearer token; no XSS sink found today | HttpOnly cookie (larger change) or accept; make logout retry | No |

## Already correct (do not re-fix)

- **Password hashing**: Argon2id, m=19456 KiB, t=2, p=1, random PHC salt, constant-time verify (`password.rs:7-40`); only `users.password_hash` stored.
- **Session tokens**: 256-bit CSPRNG, base64url (`auth/tokens.rs:7-10`); only the SHA-256 hex hash is stored (`login.rs:132-142`, `0001*.sql:74-76`); every lookup enforces `revoked_at IS NULL AND expires_at > now()` (`middleware.rs:24`, `me.rs:31-37`, `logout.rs:13`, `helper.rs:30-40`).
- **Login** mints a brand-new token per login → session fixation impossible; unknown/wrong/inactive all return the same generic 401 (`login.rs:125-130`, `error.rs:14-36`); no stack traces or secret leakage.
- **No cookies at all**; auth is `Authorization: Bearer` only (`middleware.rs:9-16`); no CORS headers (`main.rs:684-742`) → cross-site state changes are infeasible; CSRF is not a finding.
- **API tokens**: creation requires a session (`tokens.rs:163`); raw value shown once, hash at rest, revocation checked per request, `DELETE` scoped by `user_id`.
- **IDOR**: every domain handler calls `require_user_id` and every SQL carries `user_id=$n`; `ensure_asset_writable` maps foreign rows to 404 (`assets.rs:307-330`).
- **Limiter internals**: mutex-poison recovery, bounded keys, no race bypass (`rate_limit.rs:100-145`); generic 429 with `Retry-After`.
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP `frame-ancestors 'none'` (`main.rs:271-286`); no secret/token logging.

## Cannot verify statically

- Whether Dokploy sets `TRUSTED_PROXIES` and whether its proxy appends or overwrites `XFF` (decides whether A1 or A2 is the live exposure).
- Whether the production edge terminates TLS and emits HSTS (A8).
- Production `SESSION_TTL_HOURS`, live stale sessions, or `is_active=false` rows.
- Real-network timing distinguishability for A3 (the code-path difference is clear; not measured).
- Traefik append-vs-overwrite semantics for the exact deployed version.

## Owner decision on scope (2026-10-04)

Apply the **core** fixes (A1–A4, A7) plus **session management** (A5): an endpoint to list and revoke sessions (all but the current one) and a minimal Settings action. A6/A8/A9/A10 stay documented as accepted or infra-level risks unless the owner says otherwise.
