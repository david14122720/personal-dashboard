import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HermesError,
  createHermesRun,
  getHermesRun,
  isHermesRunActive,
  isHermesRunTerminalEvent,
  resolveHermesApproval,
  streamHermesRun,
  type HermesRunEvent,
} from "./hermes";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const RUNS = "http://test.local/api/hermes/runs";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Verbatim gateway frame: cursor line + data line, exactly as the proxy reemits. */
function frame(payload: Record<string, unknown>, id: number): string {
  return `id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`;
}

describe("createHermesRun", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    localStorage.setItem("dashboard-token", "pd_test_token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("posts JSON with the session id and the dashboard token, without Hermes headers", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ runId: "run_abc", sessionId: "s1", createdAt: 1_700_000_000_000 }, 202),
    );
    const created = await createHermesRun("s1", { content: "hola" });

    expect(created).toEqual({ runId: "run_abc", sessionId: "s1", createdAt: 1_700_000_000_000 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RUNS);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer pd_test_token");
    expect(headers["X-Hermes-Session-Id"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ sessionId: "s1", message: "hola" }));
  });

  it("posts multipart with sessionId, message and repeated files", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ runId: "run_m", sessionId: "s1", createdAt: 42 }, 202),
    );
    const files = [
      new File(["a"], "uno.png", { type: "image/png" }),
      new File(["b"], "dos.txt", { type: "text/plain" }),
    ];
    const created = await createHermesRun("s1", { content: "mirá", files });

    expect(created.runId).toBe("run_m");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RUNS);
    const form = init.body as FormData;
    expect(form.get("sessionId")).toBe("s1");
    expect(form.get("message")).toBe("mirá");
    expect(form.getAll("files").map((value) => (value as File).name)).toEqual([
      "uno.png",
      "dos.txt",
    ]);
  });

  it("maps proxy error codes to typed HermesErrors", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "HERMES_UNAUTHORIZED" } }, 401),
    );
    await expect(createHermesRun("s", { content: "hola" })).rejects.toMatchObject({
      code: "unauthorized",
    });

    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "UNAUTHORIZED" } }, 401));
    await expect(createHermesRun("s", { content: "hola" })).rejects.toMatchObject({
      code: "session_expired",
    });

    fetchMock.mockResolvedValue(jsonResponse({ error: { code: "VALIDATION_ERROR" } }, 422));
    await expect(createHermesRun("s", { content: "hola" })).rejects.toMatchObject({
      code: "too_long",
    });

    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "HERMES_UPSTREAM_ERROR" } }, 502),
    );
    await expect(createHermesRun("s", { content: "hola" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("rejects a 202 without a run id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sessionId: "s" }, 202));
    await expect(createHermesRun("s", { content: "hola" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("maps a refused connection to a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(createHermesRun("s", { content: "hola" })).rejects.toMatchObject({
      code: "network",
    });
    await expect(createHermesRun("s", { content: "hola" })).rejects.toBeInstanceOf(HermesError);
  });
});

describe("streamHermesRun", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    localStorage.setItem("dashboard-token", "pd_test_token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("dispatches on the payload event and fires onTerminal only for terminal events", async () => {
    fetchMock.mockResolvedValue(
      streamResponse(
        frame({ event: "message.delta", run_id: "run_1", delta: "hola " }, 1) +
          frame({ event: "message.delta", run_id: "run_1", delta: "mundo" }, 2) +
          frame({ event: "run.completed", run_id: "run_1", output: "hola mundo" }, 3),
      ),
    );
    const seen: HermesRunEvent[] = [];
    const terminals: HermesRunEvent[] = [];
    await streamHermesRun(
      "run_1",
      {
        onEvent: (payload) => seen.push(payload),
        onTerminal: (payload) => terminals.push(payload),
      },
    );

    expect(seen.map((payload) => payload.event)).toEqual([
      "message.delta",
      "message.delta",
      "run.completed",
    ]);
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ event: "run.completed", output: "hola mundo" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RUNS}/run_1/events`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pd_test_token");
  });

  it("never delivers comment or id lines to onEvent (S4 keepalive tolerance)", async () => {
    fetchMock.mockResolvedValue(
      streamResponse(
        ": open\n\n" +
          ": keepalive\n\n" +
          frame({ event: "message.delta", run_id: "run_1", delta: "a" }, 41) +
          ": keepalive\n\n" +
          ": stream closed\n\n" +
          frame({ event: "run.failed", run_id: "run_1", error: "boom" }, 42) +
          ": keepalive\n\n",
      ),
    );
    const seen: HermesRunEvent[] = [];
    const terminals: HermesRunEvent[] = [];
    await streamHermesRun("run_1", {
      onEvent: (payload) => seen.push(payload),
      onTerminal: (payload) => terminals.push(payload),
    });

    // Only the two data payloads arrive; every comment and cursor line is silent.
    expect(seen).toHaveLength(2);
    expect(seen.map((payload) => payload.event)).toEqual(["message.delta", "run.failed"]);
    expect(terminals).toHaveLength(1);
  });

  it("concatenates multi-line data frames and skips unreadable ones", async () => {
    fetchMock.mockResolvedValue(
      streamResponse(
        "id: 1\ndata: {\ndata: " +
          '"event": "message.delta",\ndata: "run_id": "run_1",\ndata: "delta": "x"\ndata: }' +
          "\n\n" +
          "id: 2\ndata: {not json\n\n" +
          "id: 3\ndata: [1,2]\n\n" +
          frame({ event: "run.cancelled", run_id: "run_1" }, 4),
      ),
    );
    const seen: HermesRunEvent[] = [];
    const terminals: HermesRunEvent[] = [];
    await streamHermesRun("run_1", {
      onEvent: (payload) => seen.push(payload),
      onTerminal: (payload) => terminals.push(payload),
    });

    // Split data lines rejoin; the broken JSON and the event-less array die silently.
    expect(seen.map((payload) => payload.event)).toEqual(["message.delta", "run.cancelled"]);
    expect(terminals.map((payload) => payload.event)).toEqual(["run.cancelled"]);
  });

  it("treats run.failed, run.cancelled and run.interrupted as terminal", async () => {
    for (const event of ["run.failed", "run.cancelled", "run.interrupted"]) {
      fetchMock.mockResolvedValue(streamResponse(frame({ event, run_id: "r" }, 1)));
      const terminals: HermesRunEvent[] = [];
      await streamHermesRun("r", {
        onEvent: () => {},
        onTerminal: (payload) => terminals.push(payload),
      });
      expect(terminals.map((payload) => payload.event)).toEqual([event]);
    }
    expect(isHermesRunTerminalEvent("run.completed")).toBe(true);
    expect(isHermesRunTerminalEvent("message.delta")).toBe(false);
  });

  it("parses CRLF-framed streams with keepalive and id lines (JD-A-001)", async () => {
    const crlf =
      "id: 1\r\ndata: " +
      JSON.stringify({ event: "message.delta", run_id: "run_1", delta: "hola " }) +
      "\r\n\r\n" +
      ": keepalive\r\n\r\n" +
      "id: 2\r\ndata: " +
      JSON.stringify({ event: "message.delta", run_id: "run_1", delta: "mundo" }) +
      "\r\n\r\n" +
      ": keepalive\r\n\r\n" +
      "id: 3\r\ndata: " +
      JSON.stringify({ event: "run.completed", run_id: "run_1", output: "hola mundo" }) +
      "\r\n\r\n";
    fetchMock.mockResolvedValue(streamResponse(crlf));
    const seen: HermesRunEvent[] = [];
    const terminals: HermesRunEvent[] = [];
    const texts: string[] = [];
    await streamHermesRun("run_1", {
      onEvent: (payload) => {
        seen.push(payload);
        texts.push(JSON.stringify(payload));
      },
      onTerminal: (payload) => terminals.push(payload),
    });

    expect(seen.map((payload) => payload.event)).toEqual([
      "message.delta",
      "message.delta",
      "run.completed",
    ]);
    expect(terminals).toHaveLength(1);
    // No comment or cursor text ever reaches the consumer.
    expect(texts.join("\n")).not.toContain("keepalive");
    expect(texts.join("\n")).not.toContain("id:");
  });

  it("keeps the HTTP status mapping when the stream never starts", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "HERMES_UNAUTHORIZED" } }, 401),
    );
    await expect(
      streamHermesRun("run_1", {
        onEvent: () => {},
        onTerminal: () => {},
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rethrows aborts and maps anything else to network", async () => {
    const abort = new DOMException("aborted", "AbortError");
    fetchMock.mockRejectedValue(abort);
    await expect(
      streamHermesRun(
        "run_1",
        {
          onEvent: () => {},
          onTerminal: () => {},
        },
        new AbortController().signal,
      ),
    ).rejects.toBe(abort);

    fetchMock.mockRejectedValue(new TypeError("down"));
    await expect(
      streamHermesRun("run_1", {
        onEvent: () => {},
        onTerminal: () => {},
      }),
    ).rejects.toMatchObject({ code: "network" });
  });
});

describe("getHermesRun", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    localStorage.setItem("dashboard-token", "pd_test_token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("returns the status shape the UI consumes", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        runId: "run_1",
        status: "waiting_for_approval",
        sessionId: "pd-u1-s",
        createdAt: 1_700_000_000_000,
        executionGeneration: 3,
        output: "parcial",
        error: null,
        pendingControls: [{ prompt_id: "p" }],
      }),
    );
    const status = await getHermesRun("run_1");

    expect(status).toEqual({
      runId: "run_1",
      status: "waiting_for_approval",
      createdAt: 1_700_000_000_000,
      executionGeneration: 3,
      output: "parcial",
      error: null,
      pendingControls: [{ prompt_id: "p" }],
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RUNS}/run_1`);
    expect(isHermesRunActive(status.status)).toBe(true);
  });

  it("reads error prose from string and object shapes", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ runId: "r", status: "failed", createdAt: 1, error: "se cayó" }),
    );
    expect((await getHermesRun("r")).error).toBe("se cayó");

    fetchMock.mockResolvedValue(
      jsonResponse({ runId: "r", status: "failed", createdAt: 1, error: { message: "otro" } }),
    );
    expect((await getHermesRun("r")).error).toBe("otro");
  });

  it("marks a foreign or missing run as not found", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "HERMES_RUN_NOT_FOUND" } }, 404),
    );
    await expect(getHermesRun("run_nope")).rejects.toBeInstanceOf(HermesError);
    expect(isHermesRunActive("completed")).toBe(false);
    expect(isHermesRunActive("queued")).toBe(true);
  });
});

describe("resolveHermesApproval", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    localStorage.setItem("dashboard-token", "pd_test_token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("posts the prompt id, generation and choice", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runId: "run_1", choice: "once", resolved: true }));
    await resolveHermesApproval("run_1", {
      requestId: "9f8920aa",
      executionGeneration: 7,
      choice: "once",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RUNS}/run_1/approval`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({ requestId: "9f8920aa", executionGeneration: 7, choice: "once" }),
    );
  });

  it("surfaces an upstream conflict as a typed error", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "HERMES_APPROVAL_CONFLICT" } }, 409),
    );
    await expect(
      resolveHermesApproval("run_1", {
        requestId: "p",
        executionGeneration: 1,
        choice: "deny",
      }),
    ).rejects.toBeInstanceOf(HermesError);
  });
});
