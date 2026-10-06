# personal-dashboard MCP (Streamable HTTP, TypeScript)

MCP HTTP server for the personal-dashboard Axum backend, using the
Streamable HTTP transport from `@modelcontextprotocol/sdk`. Exposes login plus
CRUD for accounts, tasks, habits, notes, events and goals, plus
list/read access to categories, subscriptions, assets and
net-worth, token management (`list/create/revoke`) with preferences
read/update, and a client-side dashboard summary.

> Removed by change 2026-09-23-simplify-finance-productivity (S2):
> `list_budgets` is unregistered (`GET /api/budgets` no longer exists).
> Removed by the same change (S3a): `list_transactions`,
> `create_transaction`, `update_transaction`, `delete_transaction`,
> `stats_transactions_by_category`, `stats_transactions_monthly_flow`
> (ledger eradicated end to end, migration 0011; see `objetivo.md`).
> `update_account` accepts the manual `balance` decimal string.

## Prereqs

- Node >= 18
- Backend running, e.g. `http://localhost:3001/api`

## Setup

```bash
cd mcp-dashboard
npm ci
npm run build
```

Copy the env template (create `mcp-dashboard/.env` locally, never commit it):

```bash
MCP_PORT=3101
PERSONAL_DASHBOARD_API_URL=http://localhost:3001/api
PERSONAL_DASHBOARD_TOKEN=
```

`.env.example` ships with the same three keys (`MCP_PORT=3101` plus the two
existing ones, token empty).

## Run

```bash
npm start
# node dist/index.js — Streamable HTTP on :3101
```

Endpoints:

- `POST /mcp` — JSON-RPC over Streamable HTTP (`initialize`, `tools/list`,
  `tools/call`, ...). New `initialize` creates a session and returns
  `mcp-session-id`; subsequent calls send that header back.
- `GET /mcp` — SSE stream for a bound session (`mcp-session-id` required).
- `DELETE /mcp` — close a session (`mcp-session-id` required).
- `GET /healthz` — liveness probe outside MCP, returns `200 { "ok": true }`.

## Auth

Auth is **per-request**, never cached globally:

1. Send `Authorization: Bearer <token>` on every MCP HTTP request. That token
   is forwarded as the backend Bearer token for all tool calls in the request.
2. Or set `PERSONAL_DASHBOARD_TOKEN` (e.g. a `pd_...` api token) as fallback
   when the header is absent.
3. Or call the `login` tool once with `{ "email": "...", "password": "..." }`
   to obtain a token, then send it as the `Authorization` header yourself.
   `login` does **not** store anything server-side, so concurrent clients can
   never leak credentials into each other.

## Smoke test

```bash
# health
curl -s http://localhost:3101/healthz
# -> {"ok":true}

# initialize a session (captures mcp-session-id)
curl -s -i -X POST http://localhost:3101/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# list tools on the session
curl -s -X POST http://localhost:3101/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: <session-id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# call a tool with auth
curl -s -X POST http://localhost:3101/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "mcp-session-id: <session-id>" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_accounts","arguments":{}}}'
```

## Remote MCP client config

Any MCP client that supports remote (Streamable HTTP) servers:

```json
{
  "mcpServers": {
    "personal-dashboard": {
      "url": "http://host:3101/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Replace `host` with the machine running `npm start` and `<token>` with a
backend session/api token (or omit `headers` when `PERSONAL_DASHBOARD_TOKEN`
is set server-side).

## Tools

Auth: `login` (returns the token, does not cache it).

Accounts: `list_accounts`, `get_account`, `create_account` (name plus
optional currency/notes/color/icon; the strict schema rejects unknown
keys — no account type and no card field), `update_account`
(balance/notes/color/icon/is_archived; balance is user-owned manual data,
the "edit balance" path),
`delete_account` (blocked with 409 while the account has movements).

Movements (T2 Finanzas FULL): `add_expense` (POST /api/movements with
direction=expense), `add_income` (direction=income), `list_movements`,
`get_movement`, `update_movement` (expense/income only; transfers are
create/delete only — delete and re-create instead), `delete_movement`,
`transfer_money` (POST /api/movements/transfer: same-currency, distinct
owned accounts, no category). Money is always a decimal string
(e.g. `"25000.00"`), dates are `YYYY-MM-DD`. Charts/summaries: no backend
aggregate endpoint exists — build them client-side from `list_movements`
(see gap G2 in `odd/tasks/mcp-review-tokens.md`).

Tasks: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`.

Habits (read-only): `list_habits`, `get_habit`, `habits_today`,
`get_habit_streak`.

Goals: `list_goals`, `get_goal`, `create_goal`, `update_goal`, `delete_goal`.

Events: `list_events`, `get_event`, `create_event`, `update_event`,
`delete_event`.

Notes: `list_notes`, `get_note`, `create_note`, `update_note`,
`delete_note`, `search_notes`.

Catalogs: `list_categories` (read-only: the backend exposes only
GET /api/categories, no create/delete — see gap G1 in
`odd/tasks/mcp-review-tokens.md`),
`list_subscriptions`, `get_subscription`, `list_assets`, `get_net_worth`.

Config (tokens & preferences, T3): `list_tokens` (GET /api/tokens:
metadata only — id, name, prefix, scopes, timestamps; never the raw
secret or its hash), `create_token` (POST /api/tokens, session auth
only: returns the raw `pd_...` secret exactly once with
`Cache-Control: no-store` — copy it now, it is never stored nor shown
again; never log, commit, or share it), `revoke_token`
(DELETE /api/tokens/{id}: immediate soft revoke, idempotent),
`get_preferences` (reads `GET /api/me` and returns its `preferences`
object — no dedicated backend GET exists, see gap G3 in
`odd/tasks/mcp-review-tokens.md`), `update_preferences`
(PATCH /api/me/preferences: partial update, every value validated
before any write, invalid input is 422 and writes nothing).

Dashboard (read-only, T3): `get_dashboard_summary` — client-side
composition of `GET /api/accounts` + `GET /api/movements` +
`GET /api/tasks?view=today` + `GET /api/habits/today` into one JSON
snapshot. No backend aggregate endpoint exists (no `/stats` or
`/dashboard` route in `backend/src/main.rs`; the layout is
frontend-only) — aggregate `list_movements` locally for charts/totals
(see gap G4 in `odd/tasks/mcp-review-tokens.md`).

Audit log (T7, optional demo): `list_audit_log` — read-only view of the
in-memory ring buffer (last 200 `tools/call` outcomes, newest-first,
optional `limit` 1–200 default 50). Every entry stores only
`occurred_at`, `tool`, `success`, `error_code` (`UNKNOWN_TOOL` |
`TOOL_ERROR` | null), `token_prefix` (masked: 8-char display prefix for
`pd_...` tokens, `session` for opaque session tokens, `none` when
absent), and `request_id` (UUID per call). NEVER stored: raw tokens,
hashes, tool arguments, bodies, headers. The buffer resets on restart —
durable Postgres design (additive `CREATE TABLE IF NOT EXISTS`, NOT
applied to prod) lives in `backend/migrations/0017_mcp_audit_log.sql`;
owner decision pending (see `odd/tasks/mcp-review-tokens.md` T7).

> Removed by change 2026-09-23-simplify-finance-productivity (S2):
> `list_budgets` (budgets eradicated end to end; see `objetivo.md`).
> Removed by the same change (S3a): `list_transactions`,
> `create_transaction`, `update_transaction`, `delete_transaction`,
> `stats_transactions_by_category`, `stats_transactions_monthly_flow`
> (ledger eradicated end to end, migration 0011; cached clients receive an
> unknown-tool error, accepted for this single-user deployment).
> Removed by change finance-simplify-movements (S-G): `list_debts`
> (debts eradicated end to end — routes `/debts*` gone, tables dropped by
> gated migration 0013; cached clients receive an unknown-tool error,
> accepted for this single-user deployment).
> Removed by change 2026-10-04-accounts-transfers-login-calendar (W1): the
> account type and the whole credit-card field layer (`type`,
> `credit_limit`, `statement_day`, `payment_due_day`). `create_account` now
> accepts `name` plus the optional `currency`/`notes`/`color`/`icon` and its
> strict Zod schema rejects unknown keys (a legacy `type` argument is a
> validation error, never silently stripped); `list_accounts`/`get_account`
> return the type-free backend response unchanged. Owner decision
> 2026-10-04: production held 0 credit-card accounts, so the layer was
> retired end to end (destructive migration 0016).

## Typecheck

```bash
npm run typecheck
# tsc --noEmit, must be clean
```

## Env vars

| Var | Default | Purpose |
| --- | ------- | ------- |
| `MCP_PORT` | `3101` | HTTP listen port |
| `PERSONAL_DASHBOARD_API_URL` | `http://localhost:3001/api` | Axum backend base URL |
| `PERSONAL_DASHBOARD_TOKEN` | (empty) | Optional fallback backend token |
| `MCP_ALLOWED_HOSTS` | (empty) | Extra Host values allowed on /mcp (comma-separated; localhost always allowed) |

## Production container

The Dokploy image (root `Dockerfile`) runs this MCP server next to the Axum
backend in the same container, supervised by `docker/entrypoint.sh`: the MCP
listens on `MCP_PORT=3002` while the backend serves `:80`. If either process
exits, the entrypoint stops the sibling and exits with the same (non-zero)
status so a restart policy set to restart on failure brings both back — a
crashed MCP never goes silent. Pass an explicit command to
`docker run <image> <cmd>` to override the services, as with any entrypoint.

Image env defaults (each overridable in the Dokploy env field):

| Var | Default | Purpose |
| --- | ------- | ------- |
| `MCP_PORT` | `3002` | HTTP listen port inside the container |
| `PERSONAL_DASHBOARD_API_URL` | `http://127.0.0.1:80/api` | Sibling backend in the same container |
| `MCP_ALLOWED_HOSTS` | `192.168.50.120` | LAN host allowed through the host guard |
| `PERSONAL_DASHBOARD_TOKEN` | (unset) | No baked token: auth stays per-request `Authorization: Bearer ...` |

The `/mcp` host guard strips the `:port` suffix before matching, so
`MCP_ALLOWED_HOSTS=192.168.50.120` accepts `Host: 192.168.50.120:3002` from
the LAN while `localhost`/`127.0.0.1`/`::1` stay allowed for probes; any
other `Host` gets `403`. `/healthz` is exempt from the guard so the image
`HEALTHCHECK` can probe both `:80/health` and `:3002/healthz`.

The owner publishes host port 3002 manually in the Dokploy UI (container
`3002` → LAN `http://192.168.50.120:3002`); nothing in this repo touches the
deploy.

## Notes

- Money amounts travel as decimal strings (e.g. `"50.00"`), never JSON numbers.
- Dates are `YYYY-MM-DD`; event datetimes are RFC3339.
- Backend rejects unknown JSON fields with 422; this server only sends known keys.
