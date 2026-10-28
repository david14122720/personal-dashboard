import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HermesError,
  sendHermesTurn,
  sendHermesTurnStream,
  type HermesToolEvent,
} from "./hermes";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const ENDPOINT = "http://test.local/api/hermes";

function sseResponse(frames: string[], status = 200): Response {
  const body = frames.join("");
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("sendHermesTurnStream", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses start, thinking, tool, delta and done in order", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        frame("start", { timeoutMs: 600_000 }),
        frame("thinking", { text: "dudo " }),
        frame("tool", { tool: "terminal", label: "ls", status: "running", toolCallId: "c1" }),
        frame("tool", { tool: "terminal", status: "completed", toolCallId: "c1" }),
        frame("delta", { text: "Hola " }),
        frame("delta", { text: "mundo" }),
        frame("done", { reply: "Hola mundo", artifacts: [], warnings: ["ojo"] }),
      ]),
    );

    const order: string[] = [];
    let timeout = 0;
    const tools: HermesToolEvent[] = [];
    let text = "";
    const reply = await sendHermesTurnStream(
      "s",
      { content: "hola" },
      {
        onStart: (value) => {
          timeout = value;
          order.push("start");
        },
        onThinking: (chunk) => {
          text += chunk;
          order.push("thinking");
        },
        onTool: (tool) => {
          tools.push(tool);
          order.push("tool");
        },
        onDelta: (chunk) => {
          text += chunk;
          order.push("delta");
        },
      },
    );

    expect(timeout).toBe(600_000);
    expect(order).toEqual(["start", "thinking", "tool", "tool", "delta", "delta"]);
    expect(tools.map((tool) => tool.status)).toEqual(["running", "completed"]);
    expect(text).toBe("dudo Hola mundo");
    expect(reply).toEqual({ reply: "Hola mundo", artifacts: [], warnings: ["ojo"] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
  });

  it("maps an error frame to a typed HermesError", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        frame("start", { timeoutMs: 600_000 }),
        frame("error", { code: "HERMES_TIMEOUT", message: "too slow" }),
      ]),
    );
    await expect(sendHermesTurnStream("s", { content: "hola" })).rejects.toMatchObject({
      name: "HermesError",
      code: "timeout",
    });
  });

  it("keeps the HTTP status mapping when the stream never starts", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "HERMES_UNAUTHORIZED" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(sendHermesTurnStream("s", { content: "hola" })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects a stream that closes without a done event", async () => {
    fetchMock.mockResolvedValue(sseResponse([frame("start", { timeoutMs: 1 })]));
    await expect(sendHermesTurnStream("s", { content: "hola" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

describe("sendHermesTurn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still understands the legacy upstream response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "**legacy**" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const reply = await sendHermesTurn("s", { content: "hola" });
    expect(reply.reply).toBe("**legacy**");
  });

  it("throws a typed error for an unreadable body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    await expect(sendHermesTurn("s", { content: "hola" })).rejects.toBeInstanceOf(HermesError);
  });
});
