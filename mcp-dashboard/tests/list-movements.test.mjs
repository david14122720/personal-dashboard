// Behavior tests for the `list_movements` MCP tool filters (T4 / S6).
//
// Runs against the compiled distribution (`npm test` builds dist/ first) and
// stubs globalThis.fetch, so no request ever leaves the process: no backend,
// no database. Assertions go through the public dispatchTool/toolDefinitions
// surface, exactly as an MCP client would.

import test from "node:test";
import assert from "node:assert/strict";

import { dispatchTool, toolDefinitions } from "../dist/tools.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";

const ACCOUNTS = [
  { id: ACCOUNT_A, name: "Banco", currency: "COP", balance: "0.00", is_archived: false },
  { id: ACCOUNT_B, name: "Efectivo", currency: "COP", balance: "0.00", is_archived: false },
];

const MOVEMENTS = [
  {
    id: "m1",
    account_id: ACCOUNT_A,
    transfer_account_id: null,
    category_id: null,
    direction: "expense",
    amount: "1000.00",
    occurred_on: "2026-10-01",
    description: "mercado",
  },
  {
    id: "m2",
    account_id: ACCOUNT_B,
    transfer_account_id: null,
    category_id: null,
    direction: "income",
    amount: "2000.00",
    occurred_on: "2026-10-02",
    description: "salario",
  },
  {
    // Transfers carry the origin in account_id and the destination in
    // transfer_account_id; the filer matches account_id, like the finance UI.
    id: "m3",
    account_id: ACCOUNT_A,
    transfer_account_id: ACCOUNT_B,
    category_id: null,
    direction: "transfer",
    amount: "500.00",
    occurred_on: "2026-10-03",
    description: "ahorro",
  },
];

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify(payload),
  };
}

/** Replace globalThis.fetch with a recorder; restore it in test teardown. */
function stubFetch(respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
    };
    calls.push(call);
    return respond(call);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function paths(calls) {
  return calls.map((call) => new URL(call.url).pathname);
}

test("no args: one unfiltered GET /api/movements and a byte-identical payload", async (t) => {
  const stub = stubFetch(() => jsonResponse(MOVEMENTS));
  t.after(() => stub.restore());

  const result = await dispatchTool("list_movements", {}, "pd_test-token");

  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].method, "GET");
  assert.match(stub.calls[0].url, /\/api\/movements$/);
  assert.equal(stub.calls[0].headers.Authorization, "Bearer pd_test-token");
  // Old behavior, byte for byte: fmt(await apiGet("/movements")).
  assert.equal(result, JSON.stringify(MOVEMENTS, null, 2));
});

test("account_id: forwards from/to server-side and keeps only that account's movements", async (t) => {
  const stub = stubFetch(() => jsonResponse(MOVEMENTS));
  t.after(() => stub.restore());

  const result = await dispatchTool(
    "list_movements",
    { account_id: ACCOUNT_A, from: "2026-10-01", to: "2026-10-03" },
    "t",
  );

  assert.equal(stub.calls.length, 1);
  const url = new URL(stub.calls[0].url);
  assert.equal(url.pathname, "/api/movements");
  assert.equal(url.searchParams.get("from"), "2026-10-01");
  assert.equal(url.searchParams.get("to"), "2026-10-03");
  assert.deepEqual(
    JSON.parse(result).map((m) => m.id),
    ["m1", "m3"],
  );
});

test("account_id: an uppercase UUID matches the lowercase backend ids (case-insensitive)", async (t) => {
  const stub = stubFetch(() => jsonResponse(MOVEMENTS));
  t.after(() => stub.restore());

  const result = await dispatchTool(
    "list_movements",
    { account_id: ACCOUNT_A.toUpperCase() },
    "t",
  );

  assert.equal(stub.calls.length, 1);
  assert.equal(new URL(stub.calls[0].url).pathname, "/api/movements");
  assert.deepEqual(
    JSON.parse(result).map((m) => m.id),
    ["m1", "m3"],
  );
});

test("account_name: resolves the exact owned account via GET /api/accounts, then filters", async (t) => {
  const stub = stubFetch((call) =>
    jsonResponse(call.url.endsWith("/accounts") ? ACCOUNTS : MOVEMENTS),
  );
  t.after(() => stub.restore());

  const result = await dispatchTool("list_movements", { account_name: "Efectivo" }, "t");

  assert.deepEqual(paths(stub.calls), ["/api/accounts", "/api/movements"]);
  assert.deepEqual(
    JSON.parse(result).map((m) => m.id),
    ["m2"],
  );
});

test("unknown account_name: clear validation error and no movements fetch", async (t) => {
  const stub = stubFetch((call) =>
    jsonResponse(call.url.endsWith("/accounts") ? ACCOUNTS : MOVEMENTS),
  );
  t.after(() => stub.restore());

  await assert.rejects(
    () => dispatchTool("list_movements", { account_name: "Fantasma" }, "t"),
    (err) => {
      assert.match(err.message, /unknown account_name/i);
      assert.match(err.message, /Fantasma/);
      return true;
    },
  );
  assert.deepEqual(paths(stub.calls), ["/api/accounts"]);
});

test("account_id + account_name together: validation error before any fetch", async (t) => {
  const stub = stubFetch(() => jsonResponse([]));
  t.after(() => stub.restore());

  await assert.rejects(
    () =>
      dispatchTool(
        "list_movements",
        { account_id: ACCOUNT_A, account_name: "Banco" },
        "t",
      ),
    /mutually exclusive/,
  );
  assert.equal(stub.calls.length, 0);
});

test("malformed date: clear error before any fetch", async (t) => {
  const stub = stubFetch(() => jsonResponse([]));
  t.after(() => stub.restore());

  await assert.rejects(
    () =>
      dispatchTool(
        "list_movements",
        { from: "01/10/2026", to: "2026-10-03" },
        "t",
      ),
    /YYYY-MM-DD/,
  );
  assert.equal(stub.calls.length, 0);
});

test("lone from: clear error before any fetch (backend needs from+to together)", async (t) => {
  const stub = stubFetch(() => jsonResponse([]));
  t.after(() => stub.restore());

  await assert.rejects(
    () => dispatchTool("list_movements", { from: "2026-10-01" }, "t"),
    /from and to must be provided together/,
  );
  assert.equal(stub.calls.length, 0);
});

test("from after to: clear error before any fetch", async (t) => {
  const stub = stubFetch(() => jsonResponse([]));
  t.after(() => stub.restore());

  await assert.rejects(
    () =>
      dispatchTool(
        "list_movements",
        { from: "2026-10-05", to: "2026-10-01" },
        "t",
      ),
    /to must be after from/,
  );
  assert.equal(stub.calls.length, 0);
});

test("registry: list_movements keeps its name with only optional filter properties", () => {
  const def = toolDefinitions.find((d) => d.name === "list_movements");
  assert.ok(def, "list_movements must stay registered");
  assert.deepEqual(
    Object.keys(def.inputSchema.properties).sort(),
    ["account_id", "account_name", "from", "to"],
  );
  assert.equal(def.inputSchema.required, undefined);
  assert.match(def.description, /client-side/i);
});
