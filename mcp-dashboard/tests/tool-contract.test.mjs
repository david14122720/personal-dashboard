// Contract tests for the advertised tool surface.
//
// Two guarantees a client reads straight from `tools/list`:
// - there is no `login` tool (the HTTP gate validates every request before
//   dispatch, so an unauthenticated login relay cannot exist), and
// - `create_token` advertises the backend's real `expires_in_days` ceiling
//   (`MAX_EXPIRES_IN_DAYS = 90`), so a client that follows the tool's own
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

test("create_token advertises and enforces the backend's 90-day ceiling", async () => {
  const def = toolDefinitions.find((d) => d.name === "create_token");
  assert.ok(def, "create_token must stay registered");

  const prop = def.inputSchema.properties.expires_in_days;
  assert.ok(prop, "expires_in_days must stay documented");
  assert.equal(prop.minimum, 1);
  assert.equal(prop.maximum, 90);
  assert.match(prop.description, /1-90/);
  assert.match(def.description, /1-90/);
  assert.ok(!/1-3650/.test(def.description), "stale 3650-day contract must be gone");

  // Validation rejects one day past the ceiling before any backend call.
  await assert.rejects(
    () => dispatchTool("create_token", { name: "cli", expires_in_days: 91 }, "pd_unused"),
    /90/,
  );
});
