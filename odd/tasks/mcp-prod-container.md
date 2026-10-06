# ODD: ship the MCP server inside the Dokploy image (port 3002)

## Objective

Make the Streamable HTTP MCP server (`mcp-dashboard/`) run inside the same
container Dokploy already deploys, listening on **3002**, so external MCP
clients can reach it from the LAN. The owner publishes host port 3002 manually
in the Dokploy UI; the agent never touches the deploy.

## Problem / Why

The root `Dockerfile` (the one Dokploy builds) has only two stages: Next static
export + Rust Axum backend. `mcp-dashboard/` is never copied, installed or run,
so the MCP only exists on the developer machine. Today the site is reached at
`http://192.168.50.120:8055/` (host `8055` → container `80`, `domains: []`).

## Scope (authorized)

- Root `Dockerfile`: add MCP build stage + runtime + env + `EXPOSE 3002`.
- New `docker/entrypoint.sh`: run backend and MCP in one container.
- `mcp-dashboard/README.md`: document the production container path.

Out of scope: Dokploy ports/domains/env UI, Traefik, TLS, deploy triggers,
backend or MCP application code, migrations.

## Constraints

- No deploy action of any kind (no `application-deploy`/`redeploy`/`start`).
- Owner pushes policy: work-unit commit(s) on a feature branch, FF to `main`,
  `push origin main` — authorized explicitly by the owner.
- Production DB rules from `CLAUDE.md` still apply; tests must not write rows.
- Auth stays per-request: no baked token in the image.

## Design decisions

1. Final stage base becomes `node:22-slim` (bookworm, same family as before) so
   one image runs both processes; keep `libssl3 ca-certificates curl
   libcap2-bin`, `appuser` uid 10001, `setcap cap_net_bind_service` on the
   backend binary, `STATIC_DIR=/app/static`, `PORT=80`.
2. MCP runtime lives at `/app/mcp-dashboard` (`dist/` + pruned production
   `node_modules` from `npm ci && npm run build && npm prune --omit=dev`).
3. `docker/entrypoint.sh` (bash): start MCP and backend, `wait -n`, and on any
   child exit terminate the sibling and exit with that code, so the container
   restart policy brings both back. Fail fast, no silent MCP death.
4. Env defaults (overridable in Dokploy):
   - `MCP_PORT=3002`
   - `PERSONAL_DASHBOARD_API_URL=http://127.0.0.1:80/api` (in-container backend)
   - `MCP_ALLOWED_HOSTS=192.168.50.120` — `hostAllowed()` strips `:port`, so the
     LAN Host `192.168.50.120:3002` matches; `localhost`/`127.0.0.1`/`::1`
     always allowed. DNS-rebinding guard stays on.
   - `PERSONAL_DASHBOARD_TOKEN` intentionally unset → header auth in prod.
5. `EXPOSE 80 3002`; HEALTHCHECK probes **both** `:80/health` and
   `:3002/healthz` (`/healthz` is exempt from the host guard by design).

## Tasks

- [x] T1 Dockerfile: `mcp` build stage (node:22-slim, `npm ci`, `tsc`, prune),
      final stage on `node:22-slim`, copy MCP dist + node_modules, env defaults,
      `EXPOSE 3002`, dual HEALTHCHECK, `ENTRYPOINT docker/entrypoint.sh`.
- [x] T2 `docker/entrypoint.sh`: supervisor with signal trap; executable bit.
- [x] T3 README: production container section (env table, 3002, host guard,
      owner publishes the port in Dokploy).
- [x] T4 Verification: local `docker build` + run + smoke (health, MCP
      `initialize` + `tools/list`, host-guard 403 vs allowed Host), cleanup.

## Acceptance criteria

- `docker build` of the root Dockerfile succeeds.
- Container serves `:80/health` and `:3002/healthz`.
- MCP `initialize` returns a session id; `tools/list` returns all 50 tools.
- `/mcp` with a non-allowlisted `Host` → 403; with `192.168.50.120:3002` → 200.
- No deploy API called; owner publishes 3002 himself.

## Checks

- TDD exception: a Dockerfile/entrypoint has no runnable unit test. The
  deterministic check is the container smoke test above (build → run → probe →
  cleanup), which is the verification of record.
- RDD is clone-local **off** for this repo → after the writer returns, run
  `gentle-ai review assess` on the diff and follow the tier table.

## Route declaration

- T1–T4: **delegated direct** (writer trigger: 2+ non-trivial files, new
  entrypoint script + non-trivial Dockerfile edit). Evidence gathered inline
  in one bounded batch (Dockerfile, `index.ts` host guard, `package.json`,
  `.dockerignore`, Dokploy app config).

## Progress

- [x] T1 Dockerfile
- [x] T2 entrypoint
- [x] T3 README
- [x] T4 verification
- [x] Commit + push to main (owner-authorized; no deploy by agent)

### Verification evidence (2026-10-06)

- Writer (delegated): `docker build` exit 0; container healthy; `:80/health`
  `{"status":"ok"}`; `:3002/healthz` `{"ok":true}`; MCP `initialize` issues a
  UUID `mcp-session-id`; `tools/list` → 50 tools; `Host: evil.example` → 403;
  `Host: 192.168.50.120:3002` → 200; `list_accounts` without Bearer → backend
  `401 UNAUTHORIZED` (proves `PERSONAL_DASHBOARD_API_URL` wiring); image and
  container cleaned up; no DB writes.
- RDD off → `gentle-ai review assess` on the diff returned **risk: high**
  (`shell_source` / `process_boundary` on `docker/entrypoint.sh`), so the tier
  table required writer self-verification **plus an independent verifier**.
- Independent verifier: **pass** — 0 BLOCKER, 0 MAJOR, 5 MINOR, 4 NIT.
  MINOR-1 (entrypoint ignored `"$@"`, breaking `docker run <img> <cmd>`)
  and MINOR-4 (README overstated the restart-policy guarantee) were fixed;
  MINOR-2 (no `package-lock.json` in runtime image, provenance only),
  MINOR-3 (Node toolchain size/attack surface, inherent to the design) and
  MINOR-5 (a fail-fast entrypoint makes the health probe a hung-child detector
  only) are accepted as informational.
- Parent spot check on the corrected bytes: rebuild + run + `:80/health` and
  `:3002/healthz` OK, `initialize` session issued, **exactly 50 tools**
  (parsed from the SSE payload, not grepped), `Host: evil.example` → 403,
  `docker run <img> echo OVERRIDE_OK` → `OVERRIDE_OK` (args guard), image
  `healthy`, entrypoint `["/usr/local/bin/entrypoint.sh"]`; cleanup OK.
- Extra evidence: starting the container without `SESSION_TTL_HOURS` exited
  the container with code 1 in seconds — the fail-fast supervisor propagates
  the child status as designed.

Route per task: T1–T4 **delegated direct** (writer); verification delegated
once to `gentle-ai-verify`, spot check inline. Evidence for the assess call
used `--untracked-scope=select --intended-untracked=docker/entrypoint.sh`.

Commit identity for this work unit is recorded in the Engram mirror
(`odd/mcp-prod-container/tasks`) and in the delivery report.
