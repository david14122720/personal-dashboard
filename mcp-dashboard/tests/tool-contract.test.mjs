// Contract tests for the advertised tool surface.
//
// Two guarantees a client reads straight from `tools/list`:
// - there is no `login` tool (the HTTP gate validates every request before
//   dispatch, so an unauthenticated login relay cannot exist), and
// - `create_token` advertises the backend's real `expires_in_days` ceiling
//   (`MAX_EXPIRES_IN_DAYS = 180`), so a client that follows the tool's own
//   documentation cannot send a value the API rejects with 422.

import test from "node:test";
import assert from "node:assert/strict";

import { dispatchTool, listToolNames, toolDefinitions } from "../dist/tools.js";

test("the unauthenticated login relay is gone", async () => {
  assert.ok(
    !listToolNames().includes("login"),
    "login must not be registered: every request needs a validated Bearer",
  );
  assert.equal(
    toolDefinitions.find((def) => def.name === "login"),
    undefined,
  );

  // A cached client that still calls it gets the generic unknown-tool error,
  // never a relayed /api/login request.
  await assert.rejects(
    () => dispatchTool("login", { email: "someone@example.com", password: "secret" }),
    /unknown tool/,
  );
});

test("create_token advertises and enforces the backend's 180-day ceiling", async (t) => {
  const def = toolDefinitions.find((d) => d.name === "create_token");
  assert.ok(def, "create_token must stay registered");

  const prop = def.inputSchema.properties.expires_in_days;
  assert.ok(prop, "expires_in_days must stay documented");
  assert.equal(prop.minimum, 1);
  assert.equal(prop.maximum, 180);
  assert.match(prop.description, /1-180/);
  assert.match(def.description, /1-180/);
  assert.ok(!/1-3650/.test(def.description), "stale 3650-day contract must be gone");

  // Omitting the field is the backend's default, not a shorter promise: the
  // tool must not advertise a lifetime the API no longer applies.
  assert.match(def.description, /omitted means 180 days/);

  // Validation rejects one day past the ceiling before any backend call.
  await assert.rejects(
    () => dispatchTool("create_token", { name: "cli", expires_in_days: 181 }, "pd_unused"),
    /180/,
  );

  // Positive pin independent of zod's wording: the ceiling value itself must
  // validate. fetch is stubbed so no request can leave the process.
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    await dispatchTool("create_token", { name: "cli", expires_in_days: 180 }, "pd_session");
  } catch (err) {
    assert.notEqual(
      err?.name,
      "ZodError",
      `expires_in_days: 180 must pass validation, got: ${err}`,
    );
  }
});
