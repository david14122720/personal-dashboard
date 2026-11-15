// Behavior tests for server-side credential validation (audit F-09/F-10/F-17,
// specs S1-S3).
//
// The HTTP gate validates the presented Bearer with the injected validator
// (the real one is `GET /api/me`), so no test reaches a backend. Assertions run
// through the public HTTP surface a real MCP client uses, plus a direct unit
// test of the bounded verdict cache.

import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

import { createApp } from "../dist/index.js";
import {
  MAX_VALIDATION_TTL_MS,
  TokenValidationCache,
  createApiValidator,
} from "../dist/auth.js";
import { ApiError } from "../dist/client.js";
import { principalForUser, readAuditLog } from "../dist/tools.js";
import {
  INITIALIZE,
  acceptToken,
  callTool,
  closeSessions,
  initialize,
  listAudit,
  listTools,
  readResponse,
  startServer,
} from "./support/mcp-http.mjs";

/** Fresh app plus listening loopback server, torn down by the test. */
async function boot(t, options = {}) {
  const { app, sessions } = createApp({ validateToken: acceptToken, ...options });
  const server = await startServer(app);
  t.after(async () => {
    closeSessions(sessions);
    await server.close();
  });
  return { base: server.base, sessions };
}

/** POST /mcp over node:http, so the Host header can be overridden. */
function rawPost(base, { headers, body }) {
  const url = new URL("/mcp", base);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

// --- S1: validate the credential, not its presence -------------------------

test("an invented bearer is rejected before any session is allocated", async (t) => {
  const valid = "pd_valid_secret";
  const seen = [];
  const { base, sessions } = await boot(t, {
    maxSessions: 4,
    validateToken: async (token) => {
      seen.push(token);
      return token === valid ? { userId: "11111111-1111-4111-8111-111111111111" } : undefined;
    },
  });
  const auditBefore = readAuditLog(200).length;

  const res = await initialize(base, "pd_invented_secret");

  assert.equal(res.status, 401);
  assert.equal(res.sessionId, undefined);
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].error.code, -32001);
  assert.match(res.messages[0].error.message, /invalid or expired/);
  // Nothing was allocated, nothing was audited, and the validator did run.
  assert.equal(sessions.size, 0);
  assert.equal(readAuditLog(200).length, auditBefore);
  assert.deepEqual(seen, ["pd_invented_secret"]);
});

test("a bearer the backend accepts opens a session and tools/call works", async (t) => {
  const userId = "22222222-2222-4222-8222-222222222222";
  const { base, sessions } = await boot(t, {
    validateToken: async (token) =>
      token === "pd_real_secret" ? { userId } : undefined,
  });

  const init = await initialize(base, "pd_real_secret");
  assert.equal(init.status, 200);
  assert.equal(sessions.size, 1);

  const tools = await listTools(base, {
    token: "pd_real_secret",
    sessionId: init.sessionId,
  });
  assert.equal(tools.status, 200);

  // list_audit_log is in-process, so this exercises dispatch end to end.
  const call = await callTool(base, {
    token: "pd_real_secret",
    sessionId: init.sessionId,
    name: "list_audit_log",
  });
  assert.equal(call.status, 200);
  assert.equal(call.isError, false);
  assert.deepEqual(JSON.parse(call.text), []);

  // The recorded principal is the resolved user id, not the token hash.
  const rows = await listAudit(base, {
    token: "pd_real_secret",
    sessionId: init.sessionId,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool, "list_audit_log");
  assert.equal(rows[0].principal, principalForUser(userId));
});

test("the validation verdict is cached: the validator runs once for N calls", async (t) => {
  const calls = [];
  const { base } = await boot(t, {
    validateToken: async (token) => {
      calls.push(token);
      return { userId: "33333333-3333-4333-8333-333333333333" };
    },
  });

  const init = await initialize(base, "pd_cached_secret");
  assert.equal(init.status, 200);
  for (let i = 0; i < 4; i += 1) {
    const res = await listTools(base, {
      token: "pd_cached_secret",
      sessionId: init.sessionId,
      id: 10 + i,
    });
    assert.equal(res.status, 200);
  }

  assert.deepEqual(calls, ["pd_cached_secret"]);
});

test("a cached verdict expires after the TTL and the credential is re-checked", async (t) => {
  let clock = 0;
  const calls = [];
  const { base } = await boot(t, {
    now: () => clock,
    validationTtlMs: 1_000,
    validateToken: async (token) => {
      calls.push(token);
      return { userId: "44444444-4444-4444-8444-444444444444" };
    },
  });

  const init = await initialize(base, "pd_ttl_secret");
  assert.equal(init.status, 200);
  assert.equal(calls.length, 1);

  clock += 1_001;
  const after = await listTools(base, {
    token: "pd_ttl_secret",
    sessionId: init.sessionId,
  });
  assert.equal(after.status, 200);
  assert.equal(calls.length, 2);
});

test("the verdict cache is bounded and never trusts a verdict beyond 60 s", async () => {
  let clock = 0;
  const calls = [];
  const cache = new TokenValidationCache(
    async (token) => {
      calls.push(token);
      return { userId: token };
    },
    { ttlMs: 10 * 60_000, maxEntries: 2, now: () => clock },
  );

  await cache.check("alpha");
  await cache.check("bravo");
  await cache.check("alpha");
  assert.equal(calls.length, 2);
  assert.equal(cache.size, 2);

  // A third credential evicts the oldest verdict instead of growing the map.
  await cache.check("charlie");
  assert.equal(cache.size, 2);

  // TTL is clamped to MAX_VALIDATION_TTL_MS even if a caller asks for more:
  // bravo was cached at t=0 and is re-checked once 60 s have passed.
  clock = MAX_VALIDATION_TTL_MS + 1;
  await cache.check("bravo");
  assert.equal(calls.filter((token) => token === "bravo").length, 2);
});

test("invalid verdicts are cached too, so a bad bearer cannot hammer the API", async () => {
  let calls = 0;
  const cache = new TokenValidationCache(async () => {
    calls += 1;
    return undefined;
  });
  assert.equal(await cache.check("pd_bad_secret"), undefined);
  assert.equal(await cache.check("pd_bad_secret"), undefined);
  assert.equal(calls, 1);
});

test("the audit principal comes from the resolved identity, not the token", async (t) => {
  const userId = "55555555-5555-4555-8555-555555555555";
  const otherUser = "66666666-6666-4666-8666-666666666666";
  const { base } = await boot(t, {
    validateToken: async (token) => {
      if (token === "pd_identity_alpha" || token === "pd_identity_bravo") return { userId };
      if (token === "pd_identity_other") return { userId: otherUser };
      return undefined;
    },
  });

  const alpha = await initialize(base, "pd_identity_alpha");
  assert.equal(alpha.status, 200);
  const seeded = await listAudit(base, {
    token: "pd_identity_alpha",
    sessionId: alpha.sessionId,
  });
  assert.deepEqual(seeded, []);

  // A second credential of the same account sees the same principal's rows.
  const bravo = await initialize(base, "pd_identity_bravo");
  assert.equal(bravo.status, 200);
  const shared = await listAudit(base, {
    token: "pd_identity_bravo",
    sessionId: bravo.sessionId,
  });
  assert.equal(shared.length, 1);
  assert.equal(shared[0].token_prefix, "pd_ident");
  assert.equal(shared[0].principal, principalForUser(userId));

  // Another account never sees them.
  const other = await initialize(base, "pd_identity_other");
  const foreign = await listAudit(base, {
    token: "pd_identity_other",
    sessionId: other.sessionId,
  });
  assert.deepEqual(foreign, []);
});

test("GET/DELETE /mcp with an invented bearer are 401 and keep the session", async (t) => {
  const valid = "pd_session_owner";
  const { base, sessions } = await boot(t, {
    validateToken: async (token) => (token === valid ? { userId: "owner" } : undefined),
  });
  const init = await initialize(base, valid);
  assert.equal(sessions.size, 1);

  for (const method of ["GET", "DELETE"]) {
    const res = await fetch(`${base}/mcp`, {
      method,
      headers: {
        Authorization: "Bearer pd_invented_secret",
        "mcp-session-id": init.sessionId,
      },
    });
    await res.text();
    assert.equal(res.status, 401, `${method} must not accept an invented bearer`);
  }
  assert.equal(sessions.size, 1);
});

// --- S2: no environment fallback ------------------------------------------

test("PERSONAL_DASHBOARD_TOKEN never authenticates a request", async (t) => {
  const envToken = "pd_env_fallback_secret";
  process.env.PERSONAL_DASHBOARD_TOKEN = envToken;
  t.after(() => {
    delete process.env.PERSONAL_DASHBOARD_TOKEN;
  });

  // The validator would accept the env value if it were ever consulted, so a
  // 401 proves the header — not the environment — is the only credential.
  const seen = [];
  const { base, sessions } = await boot(t, {
    validateToken: async (token) => {
      seen.push(token);
      return token === envToken ? { userId: "env-user" } : undefined;
    },
  });
  const before = readAuditLog(200).length;

  const cases = [
    { label: "no header", headers: {} },
    { label: "non-Bearer scheme", headers: { Authorization: `Basic ${envToken}` } },
    { label: "token scheme", headers: { Authorization: `Token ${envToken}` } },
    { label: "empty bearer", headers: { Authorization: "Bearer " } },
    { label: "malformed bearer", headers: { Authorization: `Bearer${envToken}` } },
  ];

  for (const { label, headers } of cases) {
    const res = await readResponse(
      await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify(INITIALIZE),
      }),
    );
    assert.equal(res.status, 401, `${label} must be rejected`);
    assert.equal(res.messages[0].error.code, -32001);
    assert.equal(res.sessionId, undefined);
  }

  assert.equal(sessions.size, 0);
  assert.equal(readAuditLog(200).length, before);
  // The validator was never asked: no header ever carried a credential.
  assert.deepEqual(seen, []);
});

// --- S3: production error posture -----------------------------------------

test("malformed JSON is a 400 JSON parse error with no stack and no X-Powered-By", async (t) => {
  const { base } = await boot(t);

  const res = await rawPost(base, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Content-Length": "1",
    },
    body: "{",
  });

  assert.equal(res.status, 400);
  assert.equal(res.headers["x-powered-by"], undefined);
  assert.ok(!res.text.includes("stack"), "no stack trace in the body");
  assert.ok(!res.text.includes("/app/"), "no container path in the body");

  const body = JSON.parse(res.text);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, null);
  assert.equal(body.error.code, -32700);
  assert.match(body.error.message, /parse error/i);
});

test("a wrong Host is rejected by the guard, not by the JSON parser", async (t) => {
  const { base } = await boot(t);

  const res = await rawPost(base, {
    headers: {
      Host: "evil.example",
      "Content-Type": "application/json",
      "Content-Length": "1",
    },
    body: "{",
  });

  assert.equal(res.status, 403);
  assert.match(res.text, /host not allowed/i);
  // The parser never ran: this is the guard's answer, not a JSON parse error.
  assert.ok(!res.text.includes("-32700"));
});

// --- S1: undetermined transport failures are never cached as invalid ------

test("a validator that throws (transport failure) is not cached as invalid", async () => {
  let calls = 0;
  const cache = new TokenValidationCache(async () => {
    calls += 1;
    throw new Error("connect ECONNREFUSED 127.0.0.1:3001");
  });

  assert.equal(await cache.check("pd_valid_during_outage"), undefined);
  assert.equal(await cache.check("pd_valid_during_outage"), undefined);
  // Retried on the next call, not pinned for the TTL: a backend restart must
  // stop answering 401 as soon as it is back.
  assert.equal(calls, 2);
  assert.equal(cache.size, 0);
});

test("a validator that surfaces a 5xx is not cached as invalid", async () => {
  let calls = 0;
  const cache = new TokenValidationCache(async () => {
    calls += 1;
    throw new ApiError(503, "Service Unavailable");
  });

  assert.equal(await cache.check("pd_valid_during_5xx"), undefined);
  assert.equal(await cache.check("pd_valid_during_5xx"), undefined);
  assert.equal(calls, 2);
  assert.equal(cache.size, 0);
});

test("the real validator treats a 5xx / transport failure as undetermined", async (t) => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("Service Unavailable", { status: 503 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  const cache = new TokenValidationCache(createApiValidator());
  assert.equal(await cache.check("pd_valid_backend_restarting"), undefined);
  assert.equal(await cache.check("pd_valid_backend_restarting"), undefined);
  assert.equal(calls, 2, "each undetermined check must retry the backend");
  assert.equal(cache.size, 0);
});

test("the real validator caches a definitive 401", async (t) => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("Unauthorized", { status: 401 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  const cache = new TokenValidationCache(createApiValidator());
  assert.equal(await cache.check("pd_revoked"), undefined);
  assert.equal(await cache.check("pd_revoked"), undefined);
  assert.equal(calls, 1, "a definitive rejection is served from the cache");
  assert.equal(cache.size, 1);
});

test("a validator that throws the backend's 401 is still a definitive rejection", async () => {
  let calls = 0;
  const cache = new TokenValidationCache(async () => {
    calls += 1;
    throw new ApiError(401, "Unauthorized");
  });

  assert.equal(await cache.check("pd_rejected_by_backend"), undefined);
  assert.equal(await cache.check("pd_rejected_by_backend"), undefined);
  assert.equal(calls, 1);
  assert.equal(cache.size, 1);
});

test("HTTP gate: a transport failure answers 401 but is retried, not cached", async (t) => {
  let calls = 0;
  const { base } = await boot(t, {
    validateToken: async () => {
      calls += 1;
      throw new Error("socket hang up");
    },
  });

  for (let i = 0; i < 2; i += 1) {
    const res = await initialize(base, "pd_valid_during_outage");
    assert.equal(res.status, 401);
    assert.equal(res.messages[0].error.code, -32001);
  }
  assert.equal(calls, 2);
});
