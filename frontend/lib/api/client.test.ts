import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  ApiError,
  LOGOUT_TIMEOUT_MS,
  TOKEN_KEY,
  apiGet,
  apiPatch,
  clearToken,
  login,
  logout,
  resetAuthRedirectForTests,
  serverMessage,
  setLoginNavigator,
  setToken,
  toApiError,
} from "./client";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const seenAuthHeaders: (string | null)[] = [];
const seenPatchAuth: (string | null)[] = [];
const seenPatchBodies: unknown[] = [];
const seenPatchContentTypes: (string | null)[] = [];
let loginCalls = 0;
let logoutCalls = 0;
const seenLogoutAuth: (string | null)[] = [];

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
  http.patch("http://test.local/api/prefs", async ({ request }) => {
    seenPatchAuth.push(request.headers.get("Authorization"));
    seenPatchContentTypes.push(request.headers.get("Content-Type"));
    seenPatchBodies.push(await request.json());
    return HttpResponse.json({ ok: true });
  }),
  http.patch("http://test.local/api/expired-patch", () => {
    return HttpResponse.json({ code: "UNAUTHORIZED", message: "Session expired" }, { status: 401 });
  }),
  http.patch("http://test.local/api/invalid-patch", () => {
    return HttpResponse.json({ code: "VALIDATION", message: "bad layout" }, { status: 422 });
  }),
  http.post("http://test.local/api/logout", ({ request }) => {
    logoutCalls += 1;
    seenLogoutAuth.push(request.headers.get("Authorization"));
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  seenAuthHeaders.length = 0;
  seenPatchAuth.length = 0;
  seenPatchBodies.length = 0;
  seenPatchContentTypes.length = 0;
  loginCalls = 0;
  logoutCalls = 0;
  seenLogoutAuth.length = 0;
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

describe("apiPatch (PR1 RED)", () => {
  it("sends JSON + Bearer and parses the response", async () => {
    setToken("tok-123");
    const body = { dashboard_layout: { widgets: [] } };
    const data = await apiPatch<{ ok: boolean }>("/prefs", body);
    expect(data).toEqual({ ok: true });
    expect(seenPatchAuth).toEqual(["Bearer tok-123"]);
    expect(seenPatchContentTypes[0]).toContain("application/json");
    expect(seenPatchBodies).toEqual([body]);
  });

  it("single-flights 401 like apiGet", async () => {
    setToken("stale-token");
    const assign = mockRedirect();
    await expect(apiPatch("/expired-patch", { a: 1 })).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("throws 422 via toApiError on invalid layout", async () => {
    setToken("tok-123");
    mockRedirect();
    await expect(apiPatch("/invalid-patch", { bad: true })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION",
    });
  });
});

describe("logout revocation", () => {
  it("awaits server revocation before navigating and clears the token", async () => {
    setToken("tok-123");
    const assign = mockRedirect();
    const result = await logout();
    expect(result).toEqual({ revoked: true });
    expect(logoutCalls).toBe(1);
    expect(seenLogoutAuth).toEqual(["Bearer tok-123"]);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login/");
  });

  it("still clears the token and navigates when revocation fails", async () => {
    setToken("tok-123");
    server.use(http.post("http://test.local/api/logout", () => HttpResponse.error()));
    const assign = mockRedirect();
    const result = await logout();
    expect(result).toEqual({ revoked: false });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login/");
  });

  it("bounds the revoke wait and still clears the local session", async () => {
    vi.useFakeTimers();
    setToken("tok-123");
    const assign = mockRedirect();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort);
      });
    });
    try {
      const pending = logout();
      await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS + 1);
      await expect(pending).resolves.toEqual({ revoked: false });
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://test.local/api/logout",
        expect.objectContaining({ method: "POST" }),
      );
      expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(assign).toHaveBeenCalledWith("/login/");
    } finally {
      vi.useRealTimers();
    }
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

describe("serverMessage gate (F11.1)", () => {
  it("returns the server's Spanish message for VALIDATION_ERROR", () => {
    const err = new ApiError(422, "VALIDATION_ERROR", "el precio debe ser menor a 1000000000");
    expect(serverMessage(err, "fallback")).toBe("el precio debe ser menor a 1000000000");
  });

  it("returns the server's Spanish message for CONFLICT", () => {
    const err = new ApiError(409, "CONFLICT", "ya está pagada este ciclo");
    expect(serverMessage(err, "fallback")).toBe("ya está pagada este ciclo");
  });

  it.each(["NOT_FOUND", "INTERNAL_ERROR", "UNAUTHORIZED", "REQUEST_FAILED"])(
    "falls back for the non-Spanish code %s",
    (code) => {
      const err = new ApiError(500, code, "English server message");
      expect(serverMessage(err, "fallback")).toBe("fallback");
    },
  );

  it("falls back for a plain Error", () => {
    expect(serverMessage(new Error("boom"), "fallback")).toBe("fallback");
  });

  it("falls back when a gated ApiError carries an empty message", () => {
    const err = new ApiError(422, "VALIDATION_ERROR", "");
    expect(serverMessage(err, "fallback")).toBe("fallback");
  });
});
