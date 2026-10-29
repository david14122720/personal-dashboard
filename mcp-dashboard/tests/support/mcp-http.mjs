// Shared MCP-over-HTTP helpers for the node --test suites.
//
// `npm test` compiles dist/ first, so these tests drive the compiled server
// exactly like a real client: JSON-RPC messages over POST /mcp, answers read
// back from the SSE body the Streamable HTTP transport produces. Only the
// loopback interface is used and no backend request is made.

import { once } from "node:events";

/** The MCP handshake message a client sends first. */
export const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-dashboard-test", version: "1.0.0" },
  },
};

/** Start the express app on an ephemeral loopback port. */
export async function startServer(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Close every retained session so the server can shut down cleanly. */
export function closeSessions(sessions) {
  for (const id of sessions.ids()) sessions.close(id);
}

/**
 * POST one JSON-RPC message. `token === undefined` means "send no
 * Authorization header", which is the unauthenticated case under test.
 */
export function postRpc(base, { body, token, sessionId } = {}) {
  const headers = {
    "Content-Type": "application/json",
    // The Streamable HTTP transport requires the client to accept both.
    Accept: "application/json, text/event-stream",
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (sessionId !== undefined) headers["mcp-session-id"] = sessionId;
  return fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** JSON-RPC messages carried by an SSE or plain-JSON response body. */
export function parseMessages(text, contentType) {
  if (!(contentType ?? "").includes("text/event-stream")) {
    return text.trim().length === 0 ? [] : [JSON.parse(text)];
  }
  const messages = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (data.length > 0) messages.push(JSON.parse(data));
  }
  return messages;
}

/** Consume a response into { status, sessionId, messages, text }. */
export async function readResponse(res) {
  const text = await res.text();
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id") ?? undefined,
    messages: parseMessages(text, res.headers.get("content-type")),
    text,
  };
}

/** Full handshake (initialize + notifications/initialized) as a client does. */
export async function initialize(base, token) {
  const first = await readResponse(await postRpc(base, { body: INITIALIZE, token }));
  if (first.status === 200 && first.sessionId !== undefined) {
    await readResponse(
      await postRpc(base, {
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
        token,
        sessionId: first.sessionId,
      }),
    );
  }
  return first;
}

/** POST tools/list and return the raw response plus the parsed result. */
export async function listTools(base, { token, sessionId, id = 3 } = {}) {
  const out = await readResponse(
    await postRpc(base, {
      body: { jsonrpc: "2.0", id, method: "tools/list", params: {} },
      token,
      sessionId,
    }),
  );
  return { ...out, result: out.messages.find((m) => m.id === id)?.result };
}

/** POST tools/call; `text` is the first text part the tool returned. */
export async function callTool(base, { token, sessionId, name, args = {}, id = 2 } = {}) {
  const out = await readResponse(
    await postRpc(base, {
      body: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } },
      token,
      sessionId,
    }),
  );
  const result = out.messages.find((m) => m.id === id)?.result;
  return {
    ...out,
    result,
    text: result?.content?.[0]?.text,
    isError: result?.isError === true,
  };
}

/** Call list_audit_log on an authenticated session and parse its rows. */
export async function listAudit(base, { token, sessionId, limit } = {}) {
  const call = await callTool(base, {
    token,
    sessionId,
    name: "list_audit_log",
    args: limit === undefined ? {} : { limit },
  });
  if (call.isError) throw new Error(`list_audit_log failed: ${call.text}`);
  return JSON.parse(call.text);
}
