// Behavior tests for MCP credential enforcement and bounded sessions
// (T10 / audit F-02 + F-03, specs S2 and S10).
//
// Each test boots the compiled server on an ephemeral loopback port, so the
// assertions run through the public HTTP surface a real MCP client uses. No
// backend request is made: the tools exercised here never reach the API.

import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../dist/index.js";
import { readAuditLog } from "../dist/tools.js";
import {
  INITIALIZE,
  callTool,
  closeSessions,
  initialize,
  listTools,
  postRpc,
  readResponse,
  startServer,
} from "./support/mcp-http.mjs";

// The env fallback (PERSONAL_DASHBOARD_TOKEN) is a configured credential, so it
// has to be absent for the "request without a credential" cases to mean
// anything. It is removed for this test file only (node --test runs each file
// in its own process).
delete process.env.PERSONAL_DASHBOARD_TOKEN;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = "pd_test_alpha_secret";

/** Fresh app plus listening loopback server, torn down by the test. */
async function boot(t, options = {}) {
  const { app, sessions } = createApp(options);
  const server = await startServer(app);
  t.after(async () => {
    closeSessions(sessions);
    await server.close();
  });
  return { base: server.base, sessions };
}

test("initialize without a bearer: 401 and no session retained", async (t) => {
  const { base, sessions } = await boot(t, { maxSessions: 4 });

  const res = await initialize(base, undefined);

  assert.equal(res.status, 401);
  assert.equal(res.sessionId, undefined);
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].jsonrpc, "2.0");
  assert.equal(res.messages[0].error.code, -32001);
  assert.match(res.messages[0].error.message, /Bearer token required/);
  // The rejection happens before a transport exists: nothing to retain.
  assert.equal(sessions.size, 0);
});

test("initialize with a valid bearer still works and opens one session (S10)", async (t) => {
  const { base, sessions } = await boot(t, { maxSessions: 4 });

  const res = await initialize(base, TOKEN);

  assert.equal(res.status, 200);
  assert.match(res.sessionId ?? "", UUID_RE);
  const init = res.messages.find((m) => m.id === 1)?.result;
  assert.equal(init.serverInfo.name, "personal-dashboard-mcp");
  assert.equal(sessions.size, 1);
  assert.deepEqual(sessions.ids(), [res.sessionId]);

  // The session keeps serving tools/list exactly as before.
  const tools = await listTools(base, { token: TOKEN, sessionId: res.sessionId });
  assert.equal(tools.status, 200);
  const names = tools.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("list_movements"), "list_movements must stay registered");
  assert.ok(names.includes("list_audit_log"));
  assert.equal(sessions.size, 1);
});

test("tools/call with a live session but no bearer: 401 and no audit entry", async (t) => {
  const { base, sessions } = await boot(t, { maxSessions: 4 });
  const first = await initialize(base, TOKEN);

  // One authenticated call, so a growing buffer would be noticeable.
  const legit = await callTool(base, {
    token: TOKEN,
    sessionId: first.sessionId,
    name: "list_audit_log",
    args: { limit: 10 },
  });
  assert.equal(legit.status, 200);
  assert.equal(legit.isError, false);
  const before = readAuditLog(200).length;
  assert.ok(before >= 1);

  const unauth = await readResponse(
    await postRpc(base, {
      body: {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "list_movements", arguments: {} },
      },
      sessionId: first.sessionId,
    }),
  );

  assert.equal(unauth.status, 401);
  assert.equal(unauth.messages[0].error.code, -32001);
  // Nothing was dispatched, so nothing was attributed to any caller.
  assert.equal(readAuditLog(200).length, before);
  assert.equal(sessions.size, 1);
});

test("GET and DELETE /mcp without a bearer are 401 and keep the session", async (t) => {
  const { base, sessions } = await boot(t, { maxSessions: 4 });
  const first = await initialize(base, TOKEN);

  const get = await fetch(`${base}/mcp`, {
    headers: { Accept: "text/event-stream", "mcp-session-id": first.sessionId },
  });
  await get.text();
  assert.equal(get.status, 401);

  const del = await fetch(`${base}/mcp`, {
    method: "DELETE",
    headers: { "mcp-session-id": first.sessionId },
  });
  await del.text();
  assert.equal(del.status, 401);

  // Neither unauthenticated request closed the live session.
  assert.equal(sessions.size, 1);
  const still = await listTools(base, { token: TOKEN, sessionId: first.sessionId });
  assert.equal(still.status, 200);
});

test("DELETE with a bearer still closes the session and frees its slot (preserve)", async (t) => {
  const { base, sessions } = await boot(t, { maxSessions: 1 });
  const first = await initialize(base, TOKEN);
  assert.equal(sessions.size, 1);

  const del = await fetch(`${base}/mcp`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "mcp-session-id": first.sessionId,
    },
  });
  await del.text();
  assert.equal(del.status, 200);
  assert.equal(sessions.size, 0);

  const second = await initialize(base, TOKEN);
  assert.equal(second.status, 200);
  assert.equal(sessions.size, 1);
});

test("session cap: an initialize past the cap is refused and the map stays at the cap", async (t) => {
  const { base, sessions } = await boot(t, { maxSessions: 2 });

  const a = await initialize(base, "pd_cap_alpha");
  const b = await initialize(base, "pd_cap_bravo");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(sessions.size, 2);

  const refused = await initialize(base, "pd_cap_charlie");
  assert.equal(refused.status, 503);
  assert.equal(refused.sessionId, undefined);
  assert.equal(refused.messages[0].error.code, -32002);
  assert.match(refused.messages[0].error.message, /too many active sessions/i);
  assert.equal(sessions.size, 2);

  // A live session is never evicted to make room for a newcomer.
  const still = await listTools(base, { token: "pd_cap_alpha", sessionId: a.sessionId });
  assert.equal(still.status, 200);
  assert.equal(sessions.size, 2);
});

test("TTL: an idle session expires on the injected clock and is closed", async (t) => {
  let clock = 1_000_000;
  const { base, sessions } = await boot(t, {
    maxSessions: 4,
    ttlMs: 60_000,
    now: () => clock,
  });
  const first = await initialize(base, TOKEN);
  assert.equal(sessions.size, 1);

  // No sleeping: the registry reads the injected clock.
  clock += 60_001;
  assert.deepEqual(sessions.sweep(), [first.sessionId]);
  assert.equal(sessions.size, 0);

  const stale = await listTools(base, { token: TOKEN, sessionId: first.sessionId });
  assert.equal(stale.status, 400);
  assert.equal(sessions.size, 0);
});

test("an expired session releases its slot instead of blocking a new one", async (t) => {
  let clock = 5_000_000;
  const { base, sessions } = await boot(t, {
    maxSessions: 1,
    ttlMs: 1_000,
    now: () => clock,
  });
  const first = await initialize(base, TOKEN);
  assert.equal(sessions.size, 1);

  clock += 1_001;
  const second = await initialize(base, TOKEN);

  assert.equal(second.status, 200);
  assert.notEqual(second.sessionId, first.sessionId);
  assert.equal(sessions.size, 1);
  assert.deepEqual(sessions.ids(), [second.sessionId]);
});

test("a malformed mcp-session-id is still a 400 before any session work", async (t) => {
  const { base, sessions } = await boot(t, { maxSessions: 4 });

  const res = await readResponse(
    await postRpc(base, {
      body: INITIALIZE,
      token: TOKEN,
      sessionId: "__proto__",
    }),
  );

  assert.equal(res.status, 400);
  assert.match(res.messages[0].error.message, /malformed session ID/);
  assert.equal(sessions.size, 0);
});
