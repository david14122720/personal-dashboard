// Behavior tests for binding MCP sessions to the validated identity.
//
// `mcp-session-id` is a bearer capability: whoever sends it gets the
// transport. The registry now also binds each session to the `users.id` the
// HTTP gate resolved, so a different valid credential that learns the UUID
// gets the exact same answer as for a session that never existed — and cannot
// consume or close it.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createApp } from "../dist/index.js";
import {
  closeSessions,
  initialize,
  listTools,
  postRpc,
  readResponse,
  startServer,
} from "./support/mcp-http.mjs";

const ALPHA = "pd_identity_alpha_secret";
const ALPHA_SECOND = "pd_identity_alpha_second_secret";
const BRAVO = "pd_identity_bravo_secret";
const USER_ALPHA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_BRAVO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Two accounts, and a second credential for the first one. */
function validator(token) {
  if (token === ALPHA || token === ALPHA_SECOND) {
    return Promise.resolve({ userId: USER_ALPHA });
  }
  if (token === BRAVO) return Promise.resolve({ userId: USER_BRAVO });
  return Promise.resolve(undefined);
}

async function boot(t, options = {}) {
  const { app, sessions } = createApp({ validateToken: validator, ...options });
  const server = await startServer(app);
  t.after(async () => {
    closeSessions(sessions);
    await server.close();
  });
  return { base: server.base, sessions };
}

/** POST tools/list against an existing session id (attach, not initialize). */
async function attach(base, token, sessionId) {
  return readResponse(
    await postRpc(base, {
      body: { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} },
      token,
      sessionId,
    }),
  );
}

async function getSession(base, token, sessionId) {
  const res = await fetch(`${base}/mcp`, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
      "mcp-session-id": sessionId,
    },
  });
  return { status: res.status, body: await res.text() };
}

async function deleteSession(base, token, sessionId) {
  const res = await fetch(`${base}/mcp`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "mcp-session-id": sessionId,
    },
  });
  return { status: res.status, body: await res.text() };
}

test("the same identity — through either of its credentials — attaches and closes", async (t) => {
  const { base, sessions } = await boot(t);
  const init = await initialize(base, ALPHA);
  assert.equal(init.status, 200);
  assert.equal(sessions.size, 1);

  // The credential that opened the session attaches normally.
  const own = await attach(base, ALPHA, init.sessionId);
  assert.equal(own.status, 200);

  // The binding is the resolved user id, not the token: a second valid
  // credential of the same account attaches too.
  const second = await attach(base, ALPHA_SECOND, init.sessionId);
  assert.equal(second.status, 200);

  const closed = await deleteSession(base, ALPHA_SECOND, init.sessionId);
  assert.equal(closed.status, 200);
  assert.equal(sessions.size, 0);
});

test("another valid identity gets the unknown-session answer for POST/GET/DELETE", async (t) => {
  const { base, sessions } = await boot(t);
  const init = await initialize(base, ALPHA);
  assert.equal(init.status, 200);

  const unknownId = randomUUID();
  assert.notEqual(unknownId, init.sessionId);

  // POST: same 400 JSON-RPC error as a UUID that was never issued.
  const foreignPost = await attach(base, BRAVO, init.sessionId);
  const unknownPost = await attach(base, BRAVO, unknownId);
  assert.equal(foreignPost.status, 400);
  assert.equal(unknownPost.status, 400);
  assert.deepEqual(foreignPost.messages, unknownPost.messages);

  // GET: same 400 body as an unknown session.
  const foreignGet = await getSession(base, BRAVO, init.sessionId);
  const unknownGet = await getSession(base, BRAVO, unknownId);
  assert.equal(foreignGet.status, 400);
  assert.equal(unknownGet.status, 400);
  assert.equal(foreignGet.body, unknownGet.body);
  assert.match(foreignGet.body, /unknown mcp-session-id/);

  // DELETE: same 400 body, and the foreign close is a no-op.
  const foreignDelete = await deleteSession(base, BRAVO, init.sessionId);
  const unknownDelete = await deleteSession(base, BRAVO, unknownId);
  assert.equal(foreignDelete.status, 400);
  assert.equal(unknownDelete.status, 400);
  assert.equal(foreignDelete.body, unknownDelete.body);

  assert.equal(sessions.size, 1);
  assert.deepEqual(sessions.ids(), [init.sessionId]);

  // The owner still has a live session and closes it normally.
  const own = await listTools(base, { token: ALPHA, sessionId: init.sessionId });
  assert.equal(own.status, 200);
  const closed = await deleteSession(base, ALPHA, init.sessionId);
  assert.equal(closed.status, 200);
  assert.equal(sessions.size, 0);
});
