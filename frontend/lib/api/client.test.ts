import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  TOKEN_KEY,
  apiGet,
  clearToken,
  login,
  resetAuthRedirectForTests,
  setLoginNavigator,
  setToken,
  toApiError,
} from "./client";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seenAuthHeaders: (string | null)[] = [];
let loginCalls = 0;

const server = setupServer(
  http.get("http://test.local/api/secure", ({ request }) => {
    seenAuthHeaders.push(request.headers.get("Authorization"));
    return HttpResponse.json({ ok: true });
  }),
  http.get("http://test.local/api/expired", () => {
    return HttpResponse.json(
      { code: "UNAUTHORIZED", message: "Session expired" },
      { status: 401 },
    );
  }),
  http.post("http://test.local/api/login", async ({ request }) => {
    loginCalls += 1;
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === "you@example.com" && body.password === "secret") {
      return HttpResponse.json({ token: "tok-123", expires_at: "2026-09-08T00:00:00Z" });
    }
    return HttpResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } },
      { status: 401 },
    );
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  seenAuthHeaders.length = 0;
  loginCalls = 0;
  resetAuthRedirectForTests();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function mockRedirect() {
  const assign = vi.fn();
  setLoginNavigator(assign);
  return assign;
}

describe("Bearer injection", () => {
  it("attaches Authorization: Bearer <token> when stored", async () => {
    setToken("tok-123");
    await apiGet<{ ok: boolean }>("/secure");
    expect(seenAuthHeaders).toEqual(["Bearer tok-123"]);
  });

  it("sends no Authorization header without a token", async () => {
    clearToken();
    await apiGet<{ ok: boolean }>("/secure");
    expect(seenAuthHeaders).toEqual([null]);
  });
});

describe("single-flight 401 redirect", () => {
  it("redirects once and clears the token for concurrent 401s", async () => {
    setToken("stale-token");
    const assign = mockRedirect();

    const results = await Promise.allSettled([
      apiGet("/expired"),
      apiGet("/expired"),
      apiGet("/expired"),
    ]);

    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login/");
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("rejects with an UNAUTHORIZED ApiError", async () => {
    mockRedirect();
    await expect(apiGet("/expired")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "UNAUTHORIZED",
    });
  });
});

describe("login auth flow", () => {
  it("stores the token on success", async () => {
    const data = await login("you@example.com", "secret");
    expect(data.token).toBe("tok-123");
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok-123");
    expect(loginCalls).toBe(1);
  });

  it("throws UNAUTHORIZED and stores nothing on bad credentials", async () => {
    await expect(login("you@example.com", "wrong")).rejects.toMatchObject({
      status: 401,
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe("toApiError envelope parsing", () => {
  it("reads flat { code, message } envelopes", async () => {
    const err = await toApiError(
      new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "Session expired" }), {
        status: 401,
      }),
    );
    expect(err).toMatchObject({ status: 401, code: "UNAUTHORIZED", message: "Session expired" });
  });

  it("reads nested { error: { code, message } } envelopes", async () => {
    const err = await toApiError(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }), {
        status: 404,
      }),
    );
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("falls back to status-derived defaults for non-JSON bodies", async () => {
    const err = await toApiError(new Response("boom", { status: 500 }));
    expect(err).toMatchObject({ status: 500, code: "REQUEST_FAILED" });
  });
});
