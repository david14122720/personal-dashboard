import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createToken, listTokens, revokeToken } from "./tokens";
import { resetAuthRedirectForTests, setToken } from "./client";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seenBodies: unknown[] = [];
const seenDeletes: string[] = [];

const server = setupServer(
  http.get("http://test.local/api/tokens", () => {
    return HttpResponse.json([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "cli",
        prefix: "pd_Ab12Cd",
        scopes: [],
        expires_at: "2026-10-18T00:00:00Z",
        last_used_at: null,
        revoked_at: null,
        created_at: "2026-09-18T00:00:00Z",
      },
    ]);
  }),
  http.post("http://test.local/api/tokens", async ({ request }) => {
    const body = await request.json();
    seenBodies.push(body);
    const { name, expires_in_days } = body as { name: string; expires_in_days?: number };
    if (name === "duplicado") {
      return HttpResponse.json(
        { code: "CONFLICT", message: "a token with this name already exists" },
        { status: 409 },
      );
    }
    return HttpResponse.json(
      {
        id: "22222222-2222-2222-2222-222222222222",
        name,
        token: "pd_rawSecretOnlyOnce",
        prefix: "pd_rawSec",
        expires_at: expires_in_days ? "2026-10-18T00:00:00Z" : null,
      },
      { status: 201 },
    );
  }),
  http.delete("http://test.local/api/tokens/:id", ({ params }) => {
    seenDeletes.push(params.id as string);
    return HttpResponse.json({
      id: params.id,
      name: "cli",
      prefix: "pd_Ab12Cd",
      scopes: [],
      expires_at: null,
      last_used_at: null,
      revoked_at: "2026-09-18T00:00:00Z",
      created_at: "2026-09-18T00:00:00Z",
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  seenBodies.length = 0;
  seenDeletes.length = 0;
  resetAuthRedirectForTests();
});
afterAll(() => server.close());

describe("tokens api", () => {
  it("lists tokens with metadata but no raw secret", async () => {
    setToken("session-123");
    const tokens = await listTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ name: "cli", prefix: "pd_Ab12Cd" });
    expect(tokens[0]).not.toHaveProperty("token");
  });

  it("creates a token with expiry and returns the raw secret once", async () => {
    setToken("session-123");
    const created = await createToken("cli", 30);
    expect(created.token).toBe("pd_rawSecretOnlyOnce");
    expect(created.prefix).toBe("pd_rawSec");
    expect(seenBodies).toEqual([{ name: "cli", expires_in_days: 30 }]);
  });

  it("omits expires_in_days when the token never expires", async () => {
    setToken("session-123");
    const created = await createToken("permanente");
    expect(created.expires_at).toBeNull();
    expect(seenBodies).toEqual([{ name: "permanente" }]);
    expect(seenBodies[0]).not.toHaveProperty("expires_in_days");
  });

  it("surfaces duplicate names as a 409 ApiError", async () => {
    setToken("session-123");
    await expect(createToken("duplicado")).rejects.toMatchObject({ status: 409 });
  });

  it("revokes a token by id", async () => {
    setToken("session-123");
    await revokeToken("11111111-1111-1111-1111-111111111111");
    expect(seenDeletes).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });
});
