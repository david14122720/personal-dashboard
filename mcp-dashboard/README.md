# personal-dashboard MCP (Streamable HTTP, TypeScript)

MCP HTTP server for the personal-dashboard Axum backend, using the
Streamable HTTP transport from `@modelcontextprotocol/sdk`. Exposes login plus
CRUD for accounts, tasks, habits, notes, events and goals, plus
list/read access to categories, debts, subscriptions, assets and
net-worth.

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
npm install
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

Accounts: `list_accounts`, `get_account`, `create_account`, `update_account`
(balance/notes/color/icon/is_archived; balance is user-owned manual data),
`delete_account`.

Tasks: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`.

Habits: `list_habits`, `get_habit`, `create_habit`, `update_habit`,
`delete_habit`, `habits_today`, `create_habit_log`, `get_habit_streak`.

Goals: `list_goals`, `get_goal`, `create_goal`, `update_goal`, `delete_goal`.

Events: `list_events`, `get_event`, `create_event`, `update_event`,
`delete_event`.

Notes: `list_notes`, `get_note`, `create_note`, `update_note`,
`delete_note`, `search_notes`.

Catalogs: `list_categories`, `list_debts`,
`list_subscriptions`, `list_assets`, `get_net_worth`.

> Removed by change 2026-09-23-simplify-finance-productivity (S2):
> `list_budgets` (budgets eradicated end to end; see `objetivo.md`).
> Removed by the same change (S3a): `list_transactions`,
> `create_transaction`, `update_transaction`, `delete_transaction`,
> `stats_transactions_by_category`, `stats_transactions_monthly_flow`
> (ledger eradicated end to end, migration 0011; cached clients receive an
> unknown-tool error, accepted for this single-user deployment).

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

## Notes

- Money amounts travel as decimal strings (e.g. `"50.00"`), never JSON numbers.
- Dates are `YYYY-MM-DD`; event datetimes are RFC3339.
- Backend rejects unknown JSON fields with 422; this server only sends known keys.
