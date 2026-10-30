import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

/**
 * Manual SSE harness for the generation-race tests (HIGH-1 follow-up). When
 * `manual` is on, `streamHermesRun` never touches the network: each call
 * parks its handlers in `pending` until the test settles them, so a stale
 * subscription's callbacks can be invoked directly after a re-attach — the
 * microtask race an aborted msw stream cannot reproduce deterministically.
 * Off by default: every other test keeps the real msw-backed transport.
 */
interface ManualSubscription {
  runId: string;
  handlers: {
    onEvent: (payload: HermesRunEvent) => void;
    onTerminal: (payload: HermesRunEvent) => void;
  };
  resolve: () => void;
  reject: (error: unknown) => void;
}
const streamHarness = vi.hoisted(() => ({
  manual: false,
  pending: [] as ManualSubscription[],
}));
vi.mock("@/lib/api/hermes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/hermes")>();
  return {
    ...actual,
    streamHermesRun: (...args: Parameters<typeof actual.streamHermesRun>): Promise<void> => {
      if (!streamHarness.manual) return actual.streamHermesRun(...args);
      const [runId, handlers, signal] = args;
      return new Promise<void>((resolve, reject) => {
        streamHarness.pending.push({ runId, handlers, resolve, reject });
        signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      });
    },
  };
});

import HermesChat from "./HermesChat";
import { HermesError } from "@/lib/api/hermes";
import type { HermesRunEvent } from "@/lib/api/hermes";
import {
  HERMES_MESSAGES_KEY,
  HERMES_RUN_KEY,
  HERMES_SESSION_KEY,
  isValidSessionId,
} from "@/lib/hermes/session";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const API = "http://test.local/api";
const RUNS = `${API}/hermes/runs`;
const SESSION = "3f0f0a4e-6a4b-4c3d-8f2e-0b1c2d3e4f5a";

interface SeenCreate {
  runId: string | null;
  sessionId: unknown;
  message: unknown;
  authorization: string | null;
  hermesSession: string | null;
}

const creates: SeenCreate[] = [];
const statusRequested: string[] = [];
const approvalSeen: { runId: string; body: unknown }[] = [];

interface TestStream {
  push: (payload: Record<string, unknown>) => void;
  comment: (text: string) => void;
  close: () => void;
  fail: (message?: string) => void;
}
const streams: { runId: string; stream: TestStream }[] = [];

let runSeq = 0;
let createdAtOverride: number | null = null;
let failCreateOnce: { status: number; body: unknown } | null = null;
let failApprovalOnce = false;
let statusFor: ((runId: string) => Record<string, unknown>) | null = null;

// msw's fetch interceptor cannot serialize jsdom's FormData (it expects the
// undici implementation and throws while recording the request). Multipart
// requests are asserted through a fetch spy instead: the spy answers
// `POST /api/uploads` and the multipart run, and delegates everything else
// (JSON runs, events) to the patched fetch so msw still serves those.
interface MultipartSeen {
  sessionId: string;
  message: string;
  files: { name: string; size: number; type: string }[];
}
const multipartSeen: MultipartSeen[] = [];

/**
 * Owner spec S4: `POST /api/uploads` stores one file per request (D-B1) and
 * answers `{ id, name, mime_type, size, url, local_path }` with `201`.
 * `uploadGate` parks an upload so the per-file statuses can be asserted.
 */
const UPLOADS = `${API}/uploads`;
const uploadedSeen: string[] = [];
let uploadGate: Promise<void> | null = null;
let failUploadOnce: { status: number; body: unknown } | null = null;
/** Fail one named file, so a batch keeps a deterministic failure order. */
let failUploadFor: { name: string; status: number; body: unknown } | null = null;
/** The signal each upload was given, to prove the batch aborts its siblings. */
const uploadSignals: (AbortSignal | undefined)[] = [];
/** Park only this file's upload, so the batch can fail while it is in flight. */
let gateUploadFor: string | null = null;

/**
 * Reads of a stored attachment (D-B2). The route is session-authenticated, so
 * an element cannot point at it: the chat fetches the bytes with the bearer
 * and draws an object URL. The list records the auth proof per read.
 */
const storedMedia: { id: string; authorization: string | null }[] = [];
let storedMediaStatus = 200;

/** The MIME the Rust side would report for these bytes, by extension. */
function sniffedMime(file: File): string {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const table: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    webm: file.type.startsWith("audio/") ? "audio/webm" : "video/webm",
    mp4: file.type.startsWith("audio/") ? "audio/mp4" : "video/mp4",
  };
  return table[extension] ?? (file.type || "application/octet-stream");
}

function uploadReceipt(sequence: number, file: File) {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1) : "bin";
  return {
    id: `up-${sequence}`,
    name: file.name,
    mime_type: sniffedMime(file),
    size: file.size,
    url: `/api/uploads/up-${sequence}`,
    local_path: `/opt/data/uploads/up-${sequence}.${extension}`,
  };
}

function stubMultipartFetch() {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const body = init?.body;
    if (url === UPLOADS && body instanceof FormData) {
      const file = body.get("file") as File;
      uploadedSeen.push(file.name);
      uploadSignals.push(init?.signal ?? undefined);
      if (uploadGate && (gateUploadFor === null || file.name === gateUploadFor)) {
        await uploadGate;
      }
      if (failUploadFor !== null && file.name === failUploadFor.name) {
        const failure = failUploadFor;
        return HttpResponse.json(failure.body as Record<string, unknown>, {
          status: failure.status,
        });
      }
      if (failUploadOnce) {
        const failure = failUploadOnce;
        failUploadOnce = null;
        return HttpResponse.json(failure.body as Record<string, unknown>, {
          status: failure.status,
        });
      }
      return HttpResponse.json(uploadReceipt(uploadedSeen.length, file), { status: 201 });
    }
    if (url === RUNS && body instanceof FormData) {
      runSeq += 1;
      multipartSeen.push({
        sessionId: String(body.get("sessionId") ?? ""),
        message: String(body.get("message") ?? ""),
        files: body.getAll("files").map((value) => {
          const file = value as File;
          return { name: file.name, size: file.size, type: file.type };
        }),
      });
      creates.push({
        runId: `run_${runSeq}`,
        sessionId: String(body.get("sessionId") ?? ""),
        message: String(body.get("message") ?? ""),
        authorization:
          (init?.headers as Record<string, string> | undefined)?.["Authorization"] ?? null,
        hermesSession: null,
      });
      return HttpResponse.json(
        { runId: `run_${runSeq}`, sessionId: SESSION, createdAt: Date.now() },
        { status: 202 },
      );
    }
    return realFetch(input, init);
  });
}

const server = setupServer(
  http.post(RUNS, async ({ request }) => {
    if (failCreateOnce) {
      const failure = failCreateOnce;
      failCreateOnce = null;
      return HttpResponse.json(failure.body as Record<string, unknown>, {
        status: failure.status,
      });
    }
    const body = (await request.json()) as { sessionId?: unknown; message?: unknown };
    runSeq += 1;
    creates.push({
      runId: `run_${runSeq}`,
      sessionId: body.sessionId,
      message: body.message,
      authorization: request.headers.get("authorization"),
      hermesSession: request.headers.get("x-hermes-session-id"),
    });
    return HttpResponse.json(
      {
        runId: `run_${runSeq}`,
        sessionId: body.sessionId ?? SESSION,
        createdAt: createdAtOverride ?? Date.now(),
      },
      { status: 202 },
    );
  }),
  http.get(`${API}/hermes/runs/:runId/events`, ({ params }) => {
    const runId = params.runId as string;
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let seq = 0;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    streams.push({
      runId,
      stream: {
        push(payload) {
          seq += 1;
          controller?.enqueue(
            encoder.encode(`id: ${seq}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        },
        comment(text) {
          controller?.enqueue(encoder.encode(`: ${text}\n\n`));
        },
        close() {
          controller?.close();
        },
        fail(message = "transport down") {
          controller?.error(new TypeError(message));
        },
      },
    });
    return new HttpResponse(body, {
      headers: { "content-type": "text/event-stream" },
    });
  }),
  http.get(`${API}/hermes/runs/:runId`, ({ params }) => {
    const runId = params.runId as string;
    statusRequested.push(runId);
    if (statusFor) return HttpResponse.json(statusFor(runId));
    return HttpResponse.json({
      runId,
      status: "running",
      createdAt: Date.now(),
      executionGeneration: 0,
      output: "",
      error: null,
      pendingControls: [],
    });
  }),
  http.post(`${API}/hermes/runs/:runId/approval`, async ({ params, request }) => {
    const runId = params.runId as string;
    const body = await request.json();
    approvalSeen.push({ runId, body });
    if (failApprovalOnce) {
      failApprovalOnce = false;
      return HttpResponse.json(
        { error: { code: "HERMES_UPSTREAM_ERROR", message: "boom" } },
        { status: 502 },
      );
    }
    return HttpResponse.json({ runId, choice: (body as { choice?: string }).choice, resolved: true });
  }),
  // D-B2: the stored attachment is only served with the session bearer. The
  // chat reads it through the transport and hands the element an object URL.
  http.get(`${API}/uploads/:id`, ({ params, request }) => {
    storedMedia.push({
      id: params.id as string,
      authorization: request.headers.get("authorization"),
    });
    if (storedMediaStatus !== 200) {
      return HttpResponse.json(
        { error: { code: "NOT_FOUND", message: "Not found" } },
        { status: storedMediaStatus },
      );
    }
    return new HttpResponse("bytes", {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(async () => {
  // Flush pending React passive effects first: the transcript persist effect
  // may still be queued when the last assertion resolves, and without this
  // its save would land after the clear and pollute the next test.
  await act(async () => {});
  server.resetHandlers();
  creates.length = 0;
  statusRequested.length = 0;
  approvalSeen.length = 0;
  streams.length = 0;
  streamHarness.manual = false;
  streamHarness.pending.length = 0;
  multipartSeen.length = 0;
  uploadedSeen.length = 0;
  uploadSignals.length = 0;
  failUploadFor = null;
  gateUploadFor = null;
  storedMedia.length = 0;
  storedMediaStatus = 200;
  uploadGate = null;
  failUploadOnce = null;
  runSeq = 0;
  createdAtOverride = null;
  failCreateOnce = null;
  failApprovalOnce = false;
  statusFor = null;
  vi.restoreAllMocks();
  replace.mockClear();
  localStorage.clear();
});
afterAll(() => server.close());

function setAuth() {
  localStorage.setItem("dashboard-token", "pd_test_token");
}

function input() {
  return screen.getByRole("textbox", { name: "Escribí tu mensaje…" });
}

function sendButton() {
  return screen.getByRole("button", { name: "Enviar" });
}

async function send(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.click(sendButton());
}

/**
 * The stream for one run, matched by id: a late registration from a
 * previous test must never steal pushes meant for the current run.
 */
async function streamFor(runId: string) {
  await waitFor(() =>
    expect(streams.some((entry) => entry.runId === runId)).toBe(true),
  );
  return streams.find((entry) => entry.runId === runId)!;
}

/** The stream the chat opened for its latest run. */
async function lastStream() {
  await waitFor(() => expect(creates.length).toBeGreaterThan(0));
  return streamFor(creates[creates.length - 1].runId!);
}

/** Finish the latest run with the authoritative output. */
async function completeLast(output: string) {
  const entry = await lastStream();
  entry.stream.push({ event: "run.completed", run_id: entry.runId, output });
  entry.stream.close();
  return entry.runId;
}

beforeEach(() => setAuth());

/**
 * jsdom implements neither object-URL method. The composer previews local
 * files and the user bubble draws stored attachments this way (D-B2), so the
 * two methods are stubbed once and their calls tracked for the assertions.
 */
const createdObjectUrls: string[] = [];
const revokedObjectUrls: string[] = [];
beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => {
      const url = `blob:http://test.local/object-${createdObjectUrls.length + 1}`;
      createdObjectUrls.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: (url: string) => {
      revokedObjectUrls.push(url);
    },
  });
});
beforeEach(() => {
  createdObjectUrls.length = 0;
  revokedObjectUrls.length = 0;
});

describe("HermesChat", () => {
  it("mints and persists a UUID v4 when no session exists", async () => {
    render(<HermesChat />);
    const stored = localStorage.getItem(HERMES_SESSION_KEY);
    expect(stored).not.toBeNull();
    expect(isValidSessionId(stored!)).toBe(true);
    await waitFor(() => expect(input()).toBeEnabled());
  });

  it("reuses a stored valid session id", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    expect(localStorage.getItem(HERMES_SESSION_KEY)).toBe(SESSION);
    await waitFor(() => expect(input()).toBeEnabled());
    expect(screen.getByTitle(SESSION)).toBeInTheDocument();
  });

  it("creates a run with the session id and the dashboard token, without Hermes headers", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("primer mensaje");
    await waitFor(() => expect(creates).toHaveLength(1));

    expect(creates[0]).toMatchObject({
      sessionId: SESSION,
      message: "primer mensaje",
      authorization: "Bearer pd_test_token",
      hermesSession: null,
    });
    await completeLast("hola");
    await screen.findByTestId("hermes-markdown");
  });

  it("does not replay history on the second turn", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("uno");
    await completeLast("r1");
    await screen.findByTestId("hermes-markdown");
    await send("dos");
    await waitFor(() => expect(creates).toHaveLength(2));

    expect(creates[1]).toMatchObject({ sessionId: SESSION, message: "dos" });
    const userTurns = Array.from(
      document.querySelectorAll('[data-role="user"] p.whitespace-pre-wrap'),
    ).map((node) => node.textContent);
    expect(userTurns).toEqual(["uno", "dos"]);
  });

  it("renders the authoritative output as sanitized Markdown", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    await completeLast("**Hola**\n\n- uno\n- dos\n\n```js\nconst x = 1;\n```");
    const markdown = await screen.findByTestId("hermes-markdown");

    expect(within(markdown).getByText("Hola").tagName).toBe("STRONG");
    expect(within(markdown).getAllByRole("listitem")).toHaveLength(2);
    expect(markdown.querySelector("pre code")?.textContent).toContain("const x = 1;");
  });

  it("replaces the streamed draft with the authoritative output", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const entry = await lastStream();
    entry.stream.comment("keepalive");
    entry.stream.push({ event: "message.delta", run_id: entry.runId, delta: "borrador " });
    entry.stream.push({ event: "message.delta", run_id: entry.runId, delta: "parcial" });
    await waitFor(() => expect(screen.getByTestId("hermes-elapsed")).toBeInTheDocument());
    entry.stream.push({ event: "run.completed", run_id: entry.runId, output: "final" });
    entry.stream.close();

    await waitFor(() => expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("final"));
    expect(screen.getByTestId("hermes-markdown")).not.toHaveTextContent("borrador");
  });

  it("never renders raw HTML from the agent", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    const { container } = render(<HermesChat />);
    await send("hola");
    await completeLast('<script>window.__pwned = true</script>\n\n**seguro**');
    await screen.findByText("seguro");
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("never turns a model-authored img payload into an element", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    const { container } = render(<HermesChat />);
    await send("hola");
    const payload = '<img src=x onerror="alert(1)">';
    await completeLast(`Miralo: ${payload}`);
    const markdown = await screen.findByTestId("hermes-markdown");

    // Spec S11: the raw HTML never becomes markup nor an executable node.
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(markdown.querySelector("img")).toBeNull();
    // Spec S11: escaped, not dropped — the text stays readable and inert.
    expect(markdown).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it("shows the working indicator until the run completes", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");

    expect(await screen.findByRole("status")).toHaveTextContent("Hermes está trabajando...");
    // The composer stays enabled while the run is active: that is the queue.
    expect(sendButton()).toBeDisabled();
    fireEvent.change(input(), { target: { value: "otro" } });
    expect(sendButton()).toBeEnabled();
    await completeLast("listo");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("keeps the clock running after the first delta, from the run createdAt", async () => {
    createdAtOverride = Date.now() - 65_000;
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const entry = await lastStream();
    entry.stream.push({ event: "message.delta", run_id: entry.runId, delta: "algo" });

    const clock = await screen.findByTestId("hermes-elapsed");
    await waitFor(() => expect(clock).toHaveTextContent("01:0"));
    // Still working, and no legacy wait/retry banner ever appears.
    expect(screen.getByRole("status")).toHaveTextContent("Hermes está trabajando");
    expect(screen.queryByText("Seguir esperando")).toBeNull();
    expect(screen.queryByText(/seguir esperando o reintentar/)).toBeNull();
    await completeLast("listo");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows an inline error and retries the same message", async () => {
    failCreateOnce = { status: 502, body: { error: { code: "HERMES_UPSTREAM_ERROR" } } };
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");

    expect(
      await screen.findByText("No se pudo conectar con el servidor de Hermes. Revisá que esté disponible."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(creates).toHaveLength(1));
    await completeLast("reintentado");
    await screen.findByTestId("hermes-markdown");
    expect(screen.queryByText(/No se pudo conectar/)).toBeNull();
  });

  it("pushes an error bubble with the upstream message when the run fails", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const entry = await lastStream();
    entry.stream.push({
      event: "run.failed",
      run_id: entry.runId,
      error: "el modelo se cayó",
    });
    entry.stream.close();

    await screen.findByText("el modelo se cayó");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("starts a new conversation with a fresh UUID and clears the screen", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    await completeLast("hola");
    await screen.findByTestId("hermes-markdown");

    fireEvent.click(screen.getByRole("button", { name: "➕ Nueva conversación" }));

    const stored = localStorage.getItem(HERMES_SESSION_KEY);
    expect(stored).not.toBe(SESSION);
    expect(isValidSessionId(stored!)).toBe(true);
    expect(screen.queryByText("hola")).toBeNull();
    expect(screen.getByText("Empezá una conversación")).toBeInTheDocument();
  });

  it("sends with Enter and keeps Shift+Enter for a line break", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    fireEvent.change(input(), { target: { value: "con enter" } });
    // Shift+Enter is left to the browser (no preventDefault): the textarea
    // inserts the newline itself and no run starts.
    expect(fireEvent.keyDown(input(), { key: "Enter", shiftKey: true })).toBe(true);
    expect(creates).toHaveLength(0);
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(creates).toHaveLength(1));
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
  });

  it("preserves single line breaks from the agent", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    await completeLast("linea uno\nlinea dos");
    const markdown = await screen.findByTestId("hermes-markdown");
    expect(markdown.querySelector("br")).not.toBeNull();
  });

  it("treats a 422 as a permanent validation error without a retry loop", async () => {
    server.use(
      http.post(RUNS, () =>
        HttpResponse.json({ error: { code: "VALIDATION_ERROR" } }, { status: 422 }),
      ),
    );
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("mensaje enorme");
    expect(await screen.findByText(/supera el límite de 32 KB/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("redirects to login when the dashboard session expired", async () => {
    server.use(
      http.post(RUNS, () =>
        HttpResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
      ),
    );
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login/"));
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("returns focus to the composer after retrying", async () => {
    failCreateOnce = { status: 502, body: { error: { code: "HERMES_UPSTREAM_ERROR" } } };
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    retry.focus();
    fireEvent.click(retry);
    expect(document.activeElement).toBe(input());
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
  });

  function fileInput() {
    return screen.getByTestId("hermes-file-input");
  }

  function attach(files: File[]) {
    fireEvent.change(fileInput(), { target: { files } });
  }

  function chipStatus() {
    return screen.getByTestId("attachment-status");
  }

  it("uploads every attachment, keeps only images inline and references the documents", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await waitFor(() => expect(input()).toBeEnabled());
    attach([
      new File(["png"], "foto.png", { type: "image/png" }),
      new File(["docx"], "informe.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ]);
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(2);

    fireEvent.change(input(), { target: { value: "mirá esto" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(multipartSeen).toHaveLength(1));

    // Owner spec S4 + D-B1: one POST /api/uploads per file, before the run.
    expect(uploadedSeen).toEqual(["foto.png", "informe.docx"]);
    // Only the image travels inline; the docx is referenced in the turn text.
    expect(multipartSeen[0].sessionId).toBe(SESSION);
    expect(multipartSeen[0].files.map((file) => file.name)).toEqual(["foto.png"]);
    expect(String(multipartSeen[0].message)).toContain("mirá esto");
    expect(String(multipartSeen[0].message)).toContain(
      "[archivo adjunto: informe.docx (application/vnd.openxmlformats-officedocument.wordprocessingml.document, 4 B), ruta: /opt/data/uploads/up-2.docx]",
    );
    expect(String(multipartSeen[0].message)).not.toContain("foto.png");

    // S5: the bubble draws the image from the stored upload and the document
    // card. D-B2: the stored url is session-authenticated, so the bubble asks
    // the transport for the bytes and hands the element a blob URL.
    const bubble = screen.getByText("mirá esto").closest('[data-role="user"]') as HTMLElement;
    const image = await within(bubble).findByRole("img", { name: "foto.png" });
    expect(image.getAttribute("src")).toMatch(/^blob:http:\/\/test\.local\//);
    // JD-B-005: the bytes are already here as a local preview, so the bubble
    // does not download them again; the stored url is only for a later mount.
    expect(storedMedia).toEqual([]);
    const card = within(bubble).getByTestId("user-attachment-card");
    expect(card).toHaveTextContent("informe.docx");
    expect(card).toHaveTextContent("4 B");

    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("shows the server's message when an upload is rejected and sends nothing", async () => {
    stubMultipartFetch();
    failUploadOnce = {
      status: 400,
      body: {
        error: {
          code: "CONTENT_TYPE_MISMATCH",
          message: "the content of informe.pdf does not match the extension .pdf",
        },
      },
    };
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["pdf"], "informe.pdf", { type: "application/pdf" })]);
    fireEvent.change(input(), { target: { value: "adjunto" } });
    fireEvent.click(sendButton());

    expect(
      await screen.findByText(
        "the content of informe.pdf does not match the extension .pdf",
      ),
    ).toBeInTheDocument();
    // Nothing is sent: no run, no multipart body, and a retry is offered.
    expect(creates).toHaveLength(0);
    expect(multipartSeen).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    // JD-B-001: the rejected turn takes its chips with it. Keeping them would
    // make the next message re-upload the same file; Retry re-sends from the
    // error bubble, which is where the turn's files live now.
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("aborts the sibling uploads when one file is rejected", async () => {
    stubMultipartFetch();
    failUploadFor = {
      name: "foto.png",
      status: 400,
      body: { error: { code: "UNSUPPORTED_TYPE", message: "foto.png is not an allowed type" } },
    };
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    // The document rides behind a gate so it is still in flight when the image
    // is refused: its request must be aborted, not left to finish into a turn
    // that will never be sent.
    let release: () => void = () => {};
    gateUploadFor = "informe.docx";
    uploadGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    attach([
      new File(["png"], "foto.png", { type: "image/png" }),
      new File(["docx"], "informe.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ]);
    fireEvent.change(input(), { target: { value: "adjunto" } });
    fireEvent.click(sendButton());

    expect(await screen.findByText("foto.png is not an allowed type")).toBeInTheDocument();
    expect(uploadSignals).toHaveLength(2);
    expect(uploadSignals[1]?.aborted).toBe(true);
    expect(creates).toHaveLength(0);
    release();
  });

  it("marks each chip subiendo while its upload is in flight and listo once stored", async () => {
    stubMultipartFetch();
    let release: () => void = () => {};
    uploadGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["png"], "foto.png", { type: "image/png" })]);
    fireEvent.click(sendButton());

    await waitFor(() => expect(chipStatus()).toHaveAttribute("data-status", "uploading"));
    expect(chipStatus()).toHaveTextContent("subiendo");

    release();
    await waitFor(() => expect(chipStatus()).toHaveAttribute("data-status", "ready"));
    expect(chipStatus()).toHaveTextContent("listo");
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
  });

  it("keeps a queued turn's chips en cola until that turn starts uploading", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("uno");
    await lastStream();
    attach([new File(["png"], "segundo.png", { type: "image/png" })]);
    fireEvent.click(sendButton());

    const queued = await screen.findByTestId("attachment-status");
    expect(queued).toHaveAttribute("data-status", "queued");
    expect(queued).toHaveTextContent("en cola");

    await completeLast("uno listo");
    await waitFor(() => expect(creates).toHaveLength(2));
    await completeLast("dos listo");
    await waitFor(() => expect(screen.getAllByTestId("hermes-markdown")).toHaveLength(2));
  });

  it("rejects a file past its family ceiling without uploading or sending", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    const oversized = new File(["x"], "informe.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 60 * 1024 * 1024 });
    attach([oversized]);

    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("informe.pdf");
    expect(notice).toHaveTextContent("50 MB");
    // S3/D-B5: the client refuses before spending network; nothing is queued.
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
    expect(sendButton()).toBeDisabled();
    expect(uploadedSeen).toEqual([]);
    expect(creates).toHaveLength(0);
    expect(multipartSeen).toHaveLength(0);
  });

  it("removes a single attachment before sending", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([
      new File(["a"], "uno.txt", { type: "text/plain" }),
      new File(["b"], "dos.txt", { type: "text/plain" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Quitar uno.txt" }));
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1);

    fireEvent.change(input(), { target: { value: "solo dos" } });
    fireEvent.click(sendButton());
    // A document no longer rides the run: it is stored once and referenced.
    await waitFor(() => expect(creates).toHaveLength(1));
    expect(uploadedSeen).toEqual(["dos.txt"]);
    expect(String(creates[0].message)).toContain("solo dos");
    expect(String(creates[0].message)).toContain(
      "[archivo adjunto: dos.txt (text/plain, 1 B), ruta: /opt/data/uploads/up-1.txt]",
    );
    expect(multipartSeen).toHaveLength(0);
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
  });

  it("accepts several dropped files and shows the hint while dragging", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    const zone = screen.getByTestId("hermes-dropzone");
    expect(screen.queryByTestId("hermes-drop-hint")).toBeNull();

    fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByTestId("hermes-drop-hint")).toHaveTextContent(/Arrastrá y soltá/);

    fireEvent.drop(zone, {
      dataTransfer: {
        files: [
          new File(["x"], "drop.zip", { type: "application/zip" }),
          new File(["y"], "nota.docx"),
        ],
        types: ["Files"],
      },
    });
    expect(screen.queryByTestId("hermes-drop-hint")).toBeNull();
    const chips = screen.getAllByTestId("attachment-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("drop.zip");
    expect(chips[1]).toHaveTextContent("nota.docx");
  });

  it("attaches a file pasted from the clipboard and still sends it with no text", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    fireEvent.paste(input(), {
      clipboardData: {
        files: [new File(["png"], "captura.png", { type: "image/png" })],
        types: ["Files"],
      },
    });

    const chip = await screen.findByTestId("attachment-chip");
    expect(chip).toHaveTextContent("captura.png");
    // S3: attachments keep the send button active with an empty message.
    expect(sendButton()).toBeEnabled();
    fireEvent.click(sendButton());
    await waitFor(() => expect(multipartSeen).toHaveLength(1));
    expect(multipartSeen[0]).toMatchObject({
      message: "",
      files: [{ name: "captura.png", size: 3, type: "image/png" }],
    });
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
  });

  it("still pastes plain text into the textarea without attaching anything", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    fireEvent.paste(input(), {
      clipboardData: {
        files: [],
        types: ["text/plain"],
        getData: () => "texto pegado",
      },
    });
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
    fireEvent.change(input(), { target: { value: "texto pegado" } });
    expect(input()).toHaveValue("texto pegado");
  });

  it("grows the textarea with its content up to max-h-40 and resets it after sending", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    const box = input() as HTMLTextAreaElement;
    let measured = 120;
    Object.defineProperty(box, "scrollHeight", {
      configurable: true,
      get: () => measured,
    });

    fireEvent.change(box, { target: { value: "uno\ndos\ntres" } });
    expect(box.style.height).toBe("120px");

    // Past the `max-h-40` cap the box stops growing and scrolls instead.
    measured = 400;
    fireEvent.change(box, { target: { value: "uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete" } });
    expect(box.style.height).toBe("160px");

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(creates).toHaveLength(1));
    // Back to one row: the inline height is dropped, `rows=1` governs again.
    expect(box.style.height).toBe("");
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
  });

  it("sends a turn with attachments and no text", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["x"], "solo.png", { type: "image/png" })]);
    expect(sendButton()).toBeEnabled();
    fireEvent.click(sendButton());
    await waitFor(() => expect(multipartSeen).toHaveLength(1));
    expect(multipartSeen[0]).toMatchObject({
      message: "",
      files: [{ name: "solo.png", size: 1, type: "image/png" }],
    });
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
  });

  it("rejects a batch past the attachment cap and keeps the first 20", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach(
      Array.from({ length: 21 }, (_, index) =>
        new File(["x"], `f${index}.txt`, { type: "text/plain" }),
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Máximo 20 archivos");
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(20);
  });

  it("does not carry a failed turn's files into the next message", async () => {
    stubMultipartFetch();
    failCreateOnce = { status: 502, body: { error: { code: "HERMES_UPSTREAM_ERROR" } } };
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["pdf"], "reporte.pdf", { type: "application/pdf" })]);
    fireEvent.change(input(), { target: { value: "adjunto" } });
    fireEvent.click(sendButton());
    expect(await screen.findByText(/No se pudo conectar/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0));

    // A brand-new message after the failure is clean: no chip, no upload and no
    // reference to the file that belonged to the turn that failed.
    fireEvent.change(input(), { target: { value: "otra pregunta" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(creates).toHaveLength(1));
    expect(uploadedSeen).toEqual(["reporte.pdf"]);
    expect(String(creates[0].message)).toBe("otra pregunta");
    expect(String(creates[0].message)).not.toContain("archivo adjunto");
  });

  it("inlines an image with the type the server sniffed, not the browser guess", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await waitFor(() => expect(input()).toBeEnabled());
    // No declared type: the browser would send octet-stream and the proxy's
    // `part_for` would degrade the picture to a text descriptor (JD-B-006).
    attach([new File(["png"], "foto.png")]);
    fireEvent.change(input(), { target: { value: "mirá" } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(multipartSeen).toHaveLength(1));
    expect(multipartSeen[0].files).toEqual([
      { name: "foto.png", size: 3, type: "image/png" },
    ]);
  });

  it("keeps the attachments when the run fails and re-uploads them on retry", async () => {
    stubMultipartFetch();
    // A document-only turn is JSON, so the failure is injected on the create.
    failCreateOnce = { status: 502, body: { error: { code: "HERMES_UPSTREAM_ERROR" } } };
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["pdf"], "reporte.pdf", { type: "application/pdf" })]);
    fireEvent.change(input(), { target: { value: "adjunto" } });
    fireEvent.click(sendButton());

    expect(await screen.findByText(/No se pudo conectar/)).toBeInTheDocument();
    // JD-B-001: the failed turn's chips leave the composer. Keeping them made
    // the next message re-upload and re-reference the same files; the retry
    // data lives in the error bubble instead.
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
    expect(uploadedSeen).toEqual(["reporte.pdf"]);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(creates).toHaveLength(1));
    // The retry stores the document again before creating the run.
    expect(uploadedSeen.filter((name) => name === "reporte.pdf")).toHaveLength(2);
    expect(String(creates[0].message)).toContain("reporte.pdf");
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
  });

  it("keeps a file added after the failure when the retry succeeds", async () => {
    stubMultipartFetch();
    failCreateOnce = { status: 502, body: { error: { code: "HERMES_UPSTREAM_ERROR" } } };
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);

    attach([new File(["uno"], "primero.pdf", { type: "application/pdf" })]);
    fireEvent.change(input(), { target: { value: "adjunto" } });
    fireEvent.click(sendButton());
    await screen.findByText(/No se pudo conectar/);

    attach([new File(["dos"], "segundo.txt", { type: "text/plain" })]);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(creates).toHaveLength(1));

    // The retry re-sends the failed turn only; the chip added after the
    // failure stays pending in the composer.
    expect(String(creates[0].message)).toContain("primero.pdf");
    expect(String(creates[0].message)).not.toContain("segundo.txt");
    await completeLast("ok");
    await screen.findByTestId("hermes-markdown");
    const chips = screen.getAllByTestId("attachment-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("segundo.txt");
  });

  it("clears pending attachments when starting a new conversation", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["x"], "pendiente.txt", { type: "text/plain" })]);
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "➕ Nueva conversación" }));
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
    expect(screen.getByText("Empezá una conversación")).toBeInTheDocument();
  });

  it("streams reasoning and tools into a collapsed accordion", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const entry = await lastStream();
    entry.stream.comment("keepalive");
    entry.stream.push({ event: "reasoning.available", run_id: entry.runId, text: "Estoy pensando" });
    entry.stream.push({
      event: "tool.started",
      run_id: entry.runId,
      tool: "terminal",
      preview: "ls -A /opt/data",
      tool_call_id: "call-1",
    });
    entry.stream.push({
      event: "tool.completed",
      run_id: entry.runId,
      tool: "terminal",
      preview: "ls -A /opt/data",
      tool_call_id: "call-1",
    });

    const accordion = await screen.findByTestId("hermes-thought");
    // Collapsed by default: the reasoning exists but is not rendered.
    expect(screen.queryByText("Estoy pensando")).not.toBeInTheDocument();
    fireEvent.click(within(accordion).getByRole("button"));
    expect(screen.getByText("Estoy pensando")).toBeInTheDocument();
    expect(screen.getByText(/ls -A \/opt\/data/)).toBeInTheDocument();
    await completeLast("La respuesta");
    await screen.findByTestId("hermes-markdown");
  });

  it("turns a numbered choice list into an interactive card that answers itself", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("configurá las notificaciones");
    await completeLast(
      "¿Cómo querés que maneje las notificaciones?\n\n1. Solo Telegram\n2. Telegram + resumen semanal\n3. Silencioso\n\nRespondé con el número.",
    );

    const card = await screen.findByTestId("hermes-question");
    expect(card).toHaveTextContent("¿Cómo querés que maneje las notificaciones?");
    expect(within(card).getByText("Solo Telegram")).toBeInTheDocument();
    // The static list never reaches the markdown body.
    const markdown = screen.getByTestId("hermes-markdown");
    expect(markdown).not.toHaveTextContent("Solo Telegram");
    expect(markdown).not.toHaveTextContent("Respondé con el número");

    fireEvent.click(within(card).getByText("Telegram + resumen semanal"));
    await waitFor(() => expect(creates).toHaveLength(2));
    expect(creates[1]).toMatchObject({
      sessionId: SESSION,
      message: "Telegram + resumen semanal",
    });
    await waitFor(() =>
      expect(within(card).getByText(/Respondido: Telegram \+ resumen semanal/)).toBeInTheDocument(),
    );
    await completeLast("dale");
    await waitFor(() => expect(screen.getAllByTestId("hermes-markdown")).toHaveLength(2));
  });

  it("keeps working when localStorage is unavailable", async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      render(<HermesChat />);
      await waitFor(() => expect(input()).toBeEnabled());
      await send("sin storage");
      await waitFor(() => expect(creates).toHaveLength(1));
      expect(creates[0]).toMatchObject({ message: "sin storage" });
      await completeLast("ok");
      await screen.findByTestId("hermes-markdown");
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  describe("approvals", () => {
    const approvalPayload = (runId: string) => ({
      event: "approval.request",
      run_id: runId,
      kind: "approval",
      prompt_id: "9f8920aa",
      execution_generation: 7,
      tool: "terminal",
      command: "rm -rf /tmp/x",
      description: "delete in root path",
      choices: ["once", "deny", "session", "always"],
    });

    it("renders the approval card and sends once on Aprobar", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("borrá eso");
      const entry = await lastStream();
      entry.stream.comment("keepalive");
      entry.stream.push(approvalPayload(entry.runId));

      const card = await screen.findByTestId("hermes-approval");
      expect(card).toHaveAttribute("role", "alert");
      expect(card).toHaveTextContent("terminal");
      expect(card.querySelector("pre")).toHaveTextContent("rm -rf /tmp/x");
      expect(card).toHaveTextContent("delete in root path");

      fireEvent.click(within(card).getByRole("button", { name: "Aprobar" }));
      const sending = within(card).getAllByRole("button", { name: "Enviando…" });
      expect(sending).toHaveLength(2);
      sending.forEach((button) => expect(button).toBeDisabled());
      await waitFor(() => expect(approvalSeen).toHaveLength(1));
      expect(approvalSeen[0]).toEqual({
        runId: entry.runId,
        body: { requestId: "9f8920aa", executionGeneration: 7, choice: "once" },
      });
      await screen.findByText("✓ Aprobado");

      // Settling an answered gate clears the card; the run keeps streaming.
      entry.stream.push({
        event: "approval.settled",
        run_id: entry.runId,
        prompt_id: "9f8920aa",
        execution_generation: 7,
      });
      await waitFor(() => expect(screen.queryByTestId("hermes-approval")).toBeNull());
      expect(screen.getByRole("status")).toHaveTextContent("Hermes está trabajando");
      await completeLast("borrado");
      await screen.findByTestId("hermes-markdown");
    });

    it("sends deny on Denegar", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("borrá eso");
      const entry = await lastStream();
      entry.stream.push(approvalPayload(entry.runId));

      const card = await screen.findByTestId("hermes-approval");
      fireEvent.click(within(card).getByRole("button", { name: "Denegar" }));
      await waitFor(() => expect(approvalSeen).toHaveLength(1));
      expect(approvalSeen[0]).toEqual({
        runId: entry.runId,
        body: { requestId: "9f8920aa", executionGeneration: 7, choice: "deny" },
      });
      await screen.findByText("✕ Denegado");
      await completeLast("no lo borré");
      await screen.findByTestId("hermes-markdown");
    });

    it("expires the card when the gate settles first", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("borrá eso");
      const entry = await lastStream();
      entry.stream.push(approvalPayload(entry.runId));
      await screen.findByTestId("hermes-approval");

      entry.stream.push({
        event: "approval.settled",
        run_id: entry.runId,
        prompt_id: "9f8920aa",
        execution_generation: 7,
      });
      await screen.findByText("La aprobación expiró");
      expect(screen.queryByRole("button", { name: "Aprobar" })).toBeNull();
      expect(approvalSeen).toHaveLength(0);
      await completeLast("se venció el permiso");
      await screen.findByTestId("hermes-markdown");
    });

    it("surfaces approval errors next to the card without killing the run", async () => {
      failApprovalOnce = true;
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("borrá eso");
      const entry = await lastStream();
      entry.stream.push(approvalPayload(entry.runId));

      const card = await screen.findByTestId("hermes-approval");
      fireEvent.click(within(card).getByRole("button", { name: "Aprobar" }));
      await waitFor(() => expect(approvalSeen).toHaveLength(1));
      await waitFor(() =>
        expect(screen.getByTestId("hermes-approval")).toHaveTextContent(
          "Hermes devolvió un error. Probá de nuevo en unos segundos.",
        ),
      );
      // Buttons come back; the run keeps streaming.
      expect(screen.getByRole("button", { name: "Aprobar" })).toBeEnabled();
      expect(screen.getByRole("status")).toHaveTextContent("Hermes está trabajando");
      await completeLast("seguí igual");
      await screen.findByTestId("hermes-markdown");
    });
  });

  describe("queue", () => {
    it("badges a message sent while a run is active and sends it on terminal", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("uno");
      await lastStream();

      await send("dos");
      const queued = screen.getByText("dos").closest('[data-role="user"]');
      expect(queued).not.toBeNull();
      expect(queued).toHaveTextContent("En cola ⏳");
      // No second run while the first is active.
      expect(creates).toHaveLength(1);

      await completeLast("respuesta uno");
      await waitFor(() => expect(creates).toHaveLength(2));
      expect(creates[1]).toMatchObject({ message: "dos" });
      // The badge lifts once the queued turn starts.
      await waitFor(() =>
        expect(screen.getByText("dos").closest('[data-role="user"]')).not.toHaveTextContent(
          "En cola ⏳",
        ),
      );
      // The follow-up run opens its own stream: wait for it explicitly so the
      // terminal below cannot land on the closed stream of the first run.
      await waitFor(() => expect(streams).toHaveLength(2));
      await completeLast("respuesta dos");
      // findAllBy resolves on the first match (the first bubble), so wait
      // for the count explicitly.
      await waitFor(() => expect(screen.getAllByTestId("hermes-markdown")).toHaveLength(2));
    });
  });

  describe("dead subscription (JD-B-001)", () => {
    it("retries the same run after a transport failure without a second create", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      const entry = await lastStream();
      const streamsBefore = streams.length;
      entry.stream.fail();

      // The retry re-subscribes the SAME run: a new events stream, no new run.
      await waitFor(() => expect(streams.length).toBeGreaterThan(streamsBefore), {
        timeout: 8_000,
      });
      expect(creates).toHaveLength(1);
      // The stored pointer survives the dead subscription.
      expect(localStorage.getItem(HERMES_RUN_KEY)).not.toBeNull();
      // No error bubble while the retry is in flight.
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();

      const retry = streams[streams.length - 1];
      expect(retry.runId).toBe(entry.runId);
      // The gateway replays the backlog: rebuild without duplicating.
      retry.stream.push({ event: "message.delta", run_id: retry.runId, delta: "hola " });
      retry.stream.push({ event: "message.delta", run_id: retry.runId, delta: "mundo" });
      retry.stream.push({ event: "run.completed", run_id: retry.runId, output: "hola mundo" });
      retry.stream.close();

      await waitFor(
        () => expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("hola mundo"),
        { timeout: 8_000 },
      );
      expect(creates).toHaveLength(1);
      expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull();
    }, 15_000);

    it("does not start the queued turn when the stream dies", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("uno");
      const entry = await lastStream();
      await send("dos");
      expect(creates).toHaveLength(1);
      const streamsBefore = streams.length;
      entry.stream.fail();

      // Bounded retry re-subscribes the same run instead of pumping the queue.
      await waitFor(() => expect(streams.length).toBeGreaterThan(streamsBefore), {
        timeout: 8_000,
      });
      expect(creates).toHaveLength(1);
      expect(localStorage.getItem(HERMES_RUN_KEY)).not.toBeNull();
      // The queued badge stays: the queue never releases because a stream died.
      expect(screen.getByText("dos").closest('[data-role="user"]')).toHaveTextContent(
        "En cola ⏳",
      );

      const retry = streams[streams.length - 1];
      retry.stream.push({ event: "run.completed", run_id: retry.runId, output: "uno listo" });
      retry.stream.close();
      await waitFor(() => expect(creates).toHaveLength(2), { timeout: 8_000 });
      expect(creates[1]).toMatchObject({ message: "dos" });
    }, 15_000);
  });

  describe("approval resume (JD-B-002)", () => {
    it("restores the approval card from pendingControls and approves", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_gate", startedAt: Date.now() - 5_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "waiting_for_approval",
        createdAt: Date.now() - 5_000,
        executionGeneration: 7,
        output: "",
        error: null,
        pendingControls: [
          {
            prompt_id: "9f8920aa",
            execution_generation: 7,
            command: "rm -rf /tmp/x",
            description: "delete in root path",
          },
        ],
      });
      render(<HermesChat />);

      const card = await screen.findByTestId("hermes-approval", undefined, { timeout: 8_000 });
      expect(card.querySelector("pre")).toHaveTextContent("rm -rf /tmp/x");
      fireEvent.click(within(card).getByRole("button", { name: "Aprobar" }));
      await waitFor(() => expect(approvalSeen).toHaveLength(1));
      expect(approvalSeen[0]).toEqual({
        runId: "run_gate",
        body: { requestId: "9f8920aa", executionGeneration: 7, choice: "once" },
      });
    });

    it("still clears the pointer when the status is settled and no controls pend", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_done", startedAt: Date.now() - 60_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "completed",
        createdAt: Date.now() - 60_000,
        executionGeneration: 0,
        output: "",
        error: null,
        pendingControls: [],
      });
      render(<HermesChat />);

      await waitFor(() => expect(statusRequested).toEqual(["run_done"]));
      await waitFor(() => expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull());
      expect(streams).toHaveLength(0);
      expect(screen.queryByTestId("hermes-approval")).toBeNull();
    });
  });

  describe("refresh resilience", () => {
    it("re-subscribes to a stored run that is still active on mount", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_9", startedAt: Date.now() - 5_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "running",
        createdAt: Date.now() - 5_000,
        executionGeneration: 0,
        output: "",
        error: null,
        pendingControls: [],
      });
      render(<HermesChat />);

      await waitFor(() => expect(statusRequested).toEqual(["run_9"]));
      // Still running: re-subscribe only, no settled bubble is invented.
      expect(screen.queryByTestId("hermes-markdown")).toBeNull();
      const entry = await streamFor("run_9");
      // Timer restored from the run, still ticking.
      expect(await screen.findByRole("status")).toHaveTextContent("Hermes está trabajando");

      entry.stream.push({ event: "message.delta", run_id: "run_9", delta: "seguí " });
      entry.stream.push({ event: "run.completed", run_id: "run_9", output: "seguí acá" });
      entry.stream.close();
      await waitFor(() =>
        expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("seguí acá"),
      );
      expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull();
    });

    it("restores a stored transcript on mount", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_MESSAGES_KEY,
        JSON.stringify([
          { id: 7, role: "user", content: "hola guardado", attachments: [], queued: false },
          {
            id: 8,
            role: "assistant",
            content: "respuesta guardada",
            artifacts: [],
            warnings: [],
            thoughts: [],
            question: null,
            answered: null,
          },
        ]),
      );
      render(<HermesChat />);

      expect(await screen.findByText("hola guardado")).toBeInTheDocument();
      expect(screen.getByText("respuesta guardada")).toBeInTheDocument();
      expect(screen.queryByText("Empezá una conversación")).toBeNull();
      // Restored ids do not collide: the next turn gets a fresh bubble.
      await send("nuevo");
      await waitFor(() => expect(creates).toHaveLength(1));
      await completeLast("ok nuevo");
      await waitFor(() =>
        expect(screen.getAllByTestId("hermes-markdown")).toHaveLength(2),
      );
    });

    it("repaints a stored image from its persisted url through the authenticated fetch", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_MESSAGES_KEY,
        JSON.stringify([
          {
            id: 5,
            role: "user",
            content: "mirá",
            queued: false,
            attachments: [
              {
                name: "foto.png",
                size: 12,
                kind: "image",
                url: "/api/uploads/up-9",
                mime_type: "image/png",
                local_path: "/opt/data/uploads/up-9.png",
              },
            ],
          },
        ]),
      );
      const { unmount } = render(<HermesChat />);

      // D-B2: the element never points at the protected route; the bytes are
      // fetched with the session bearer and drawn through an object URL.
      const image = await screen.findByRole("img", { name: "foto.png" });
      expect(image.getAttribute("src")).toMatch(/^blob:http:\/\/test\.local\//);
      expect(storedMedia).toEqual([{ id: "up-9", authorization: "Bearer pd_test_token" }]);

      // The blob URL is owned by the bubble and released with it.
      const blobUrl = image.getAttribute("src")!;
      unmount();
      expect(revokedObjectUrls).toContain(blobUrl);
    });

    it("draws stored video and audio with their native controls", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_MESSAGES_KEY,
        JSON.stringify([
          {
            id: 7,
            role: "user",
            content: "",
            queued: false,
            attachments: [
              { name: "clip.mp4", size: 2048, kind: "video", url: "/api/uploads/up-v" },
              { name: "voz.mp3", size: 1024, kind: "audio", url: "/api/uploads/up-a" },
            ],
          },
        ]),
      );
      const { container } = render(<HermesChat />);

      const video = await waitFor(() => {
        const element = container.querySelector("video");
        expect(element).not.toBeNull();
        return element as HTMLVideoElement;
      });
      expect(video).toHaveAttribute("controls");
      expect(video.getAttribute("src")).toMatch(/^blob:/);

      const audio = await waitFor(() => {
        const element = container.querySelector("audio");
        expect(element).not.toBeNull();
        return element as HTMLAudioElement;
      });
      expect(audio).toHaveAttribute("controls");
      expect(audio.getAttribute("src")).toMatch(/^blob:/);
      expect(storedMedia.map((entry) => entry.id)).toEqual(["up-v", "up-a"]);
    });

    it("falls back to the document card when the stored attachment cannot be read", async () => {
      storedMediaStatus = 404;
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_MESSAGES_KEY,
        JSON.stringify([
          {
            id: 6,
            role: "user",
            content: "mirá",
            queued: false,
            attachments: [
              { name: "foto.png", size: 12, kind: "image", url: "/api/uploads/up-broken" },
            ],
          },
        ]),
      );
      render(<HermesChat />);

      // A 401/404 never breaks the bubble: the attachment degrades to its card.
      const card = await screen.findByTestId("user-attachment-card");
      expect(card).toHaveTextContent("foto.png");
      expect(card).toHaveTextContent("12 B");
      expect(screen.queryByRole("img", { name: "foto.png" })).toBeNull();
      expect(storedMedia.map((entry) => entry.id)).toEqual(["up-broken"]);
    });

    it("persists settled bubbles but never live streaming text", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("persistime");
      const entry = await lastStream();
      entry.stream.push({ event: "message.delta", run_id: entry.runId, delta: "borrador" });

      // The user turn is stored; the in-flight draft is not.
      await waitFor(() => {
        const raw = localStorage.getItem(HERMES_MESSAGES_KEY);
        expect(raw).not.toBeNull();
        expect(raw).toContain("persistime");
        expect(raw).not.toContain("borrador");
      });

      await completeLast("final guardado");
      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem(HERMES_MESSAGES_KEY)!);
        expect(stored).toHaveLength(2);
        expect(stored[1]).toMatchObject({ role: "assistant", content: "final guardado" });
      });
    });

    it("clears the stored transcript on a new conversation", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      await completeLast("respuesta");
      await screen.findByTestId("hermes-markdown");
      expect(localStorage.getItem(HERMES_MESSAGES_KEY)).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "➕ Nueva conversación" }));
      await waitFor(() => {
        expect(JSON.parse(localStorage.getItem(HERMES_MESSAGES_KEY)!)).toEqual([]);
      });
      expect(screen.getByText("Empezá una conversación")).toBeInTheDocument();
    });

    it("renders an empty chat on a corrupt stored payload", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(HERMES_MESSAGES_KEY, "not-json{{{");
      render(<HermesChat />);
      await waitFor(() => expect(input()).toBeEnabled());
      expect(screen.getByText("Empezá una conversación")).toBeInTheDocument();

      localStorage.setItem(
        HERMES_MESSAGES_KEY,
        JSON.stringify([{ role: "user" }, { id: 1, role: "nonsense" }, 42]),
      );
      render(<HermesChat />);
      await waitFor(() =>
        expect(screen.getAllByText("Empezá una conversación")).toHaveLength(2),
      );
    });

    it("recovers a stored run that completed while away", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_7", startedAt: Date.now() - 60_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "completed",
        createdAt: Date.now() - 60_000,
        executionGeneration: 0,
        output: "respuesta recuperada",
        error: null,
        pendingControls: [],
      });
      render(<HermesChat />);

      await waitFor(() => expect(statusRequested).toEqual(["run_7"]));
      await waitFor(() =>
        expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("respuesta recuperada"),
      );
      // The pointer is cleared and no stream is opened for a settled run.
      await waitFor(() => expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull());
      expect(streams).toHaveLength(0);
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("does not duplicate a recovered answer that is already shown", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_MESSAGES_KEY,
        JSON.stringify([
          { id: 3, role: "user", content: "hola", attachments: [], queued: false },
          {
            id: 4,
            role: "assistant",
            content: "respuesta recuperada",
            artifacts: [],
            warnings: [],
            thoughts: [],
            question: null,
            answered: null,
          },
        ]),
      );
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_7", startedAt: Date.now() - 60_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "completed",
        createdAt: Date.now() - 60_000,
        executionGeneration: 0,
        output: "respuesta recuperada",
        error: null,
        pendingControls: [],
      });
      render(<HermesChat />);

      await waitFor(() => expect(statusRequested).toEqual(["run_7"]));
      await screen.findByText("respuesta recuperada");
      await waitFor(() => expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull());
      expect(screen.getAllByTestId("hermes-markdown")).toHaveLength(1);
    });

    it("recovers a stored run that failed while away as an error bubble", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_6", startedAt: Date.now() - 60_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "failed",
        createdAt: Date.now() - 60_000,
        executionGeneration: 0,
        output: "",
        error: "se cayó el run",
        pendingControls: [],
      });
      render(<HermesChat />);

      await waitFor(() => expect(statusRequested).toEqual(["run_6"]));
      await screen.findByText("se cayó el run");
      await waitFor(() => expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull());
      expect(streams).toHaveLength(0);
    });

    it("clears a finished stored run with no output and renders nothing", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_8", startedAt: Date.now() - 60_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "completed",
        createdAt: Date.now() - 60_000,
        executionGeneration: 0,
        output: "",
        error: null,
        pendingControls: [],
      });
      render(<HermesChat />);

      await waitFor(() => expect(statusRequested).toEqual(["run_8"]));
      await waitFor(() => expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull());
      expect(streams).toHaveLength(0);
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByTestId("hermes-markdown")).toBeNull();
    });
  });

  describe("stream exhaustion (HIGH-1)", () => {
    it("two consecutive transport failures re-subscribe the same run without pumping the queue", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("uno");
      const first = await lastStream();
      await send("dos");
      expect(creates).toHaveLength(1);
      first.stream.fail();

      // First bounded retry (~1 s): same run, no new create.
      await waitFor(() => expect(streams.length).toBeGreaterThan(1), { timeout: 8_000 });
      expect(creates).toHaveLength(1);
      const second = streams[streams.length - 1];
      expect(second.runId).toBe(first.runId);
      second.stream.fail();

      // Second bounded retry (~3 s): still the same run.
      await waitFor(() => expect(streams.length).toBeGreaterThan(2), { timeout: 8_000 });
      expect(creates).toHaveLength(1);
      const third = streams[streams.length - 1];
      expect(third.runId).toBe(first.runId);
      // The queue is never pumped by a dead stream: the badge stays.
      expect(screen.getByText("dos").closest('[data-role="user"]')).toHaveTextContent(
        "En cola ⏳",
      );

      // The retried turn is not lost: the terminal releases the queued turn.
      third.stream.push({ event: "run.completed", run_id: third.runId, output: "uno listo" });
      third.stream.close();
      await waitFor(() => expect(creates).toHaveLength(2), { timeout: 8_000 });
      expect(creates[1]).toMatchObject({ message: "dos" });
    }, 20_000);

    it("exhaustion stays recoverable: sends queue visibly and new conversation escapes", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      const first = await lastStream();
      first.stream.fail();
      await waitFor(() => expect(streams.length).toBeGreaterThan(1), { timeout: 8_000 });
      streams[streams.length - 1].stream.fail();
      await waitFor(() => expect(streams.length).toBeGreaterThan(2), { timeout: 8_000 });
      streams[streams.length - 1].stream.fail();

      // Exhaustion: retryable error bubble + visible stream-lost status, guard held.
      await screen.findByRole("button", { name: "Reintentar" }, { timeout: 8_000 });
      expect(await screen.findByText(/Se perdi\u00f3 el stream/i, undefined, { timeout: 8_000 })).toBeInTheDocument();
      expect(localStorage.getItem(HERMES_RUN_KEY)).not.toBeNull();
      expect(creates).toHaveLength(1);

      // A send does not silently disappear: it queues behind the guarded run.
      await send("nuevo");
      const queued = screen.getByText("nuevo").closest('[data-role="user"]');
      expect(queued).not.toBeNull();
      expect(queued).toHaveTextContent("En cola ⏳");
      expect(creates).toHaveLength(1);

      // The escape hatch works once the stream is lost.
      const fresh = screen.getByRole("button", { name: "➕ Nueva conversaci\u00f3n" });
      expect(fresh).toBeEnabled();
      fireEvent.click(fresh);
      await waitFor(() => expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull());
      expect(screen.getByText("Empez\u00e1 una conversaci\u00f3n")).toBeInTheDocument();
      expect(screen.queryByRole("status")).toBeNull();
    }, 25_000);

    it("retry() after exhaustion re-attaches the same run without a new create", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      const first = await lastStream();
      first.stream.fail();
      await waitFor(() => expect(streams.length).toBeGreaterThan(1), { timeout: 8_000 });
      streams[streams.length - 1].stream.fail();
      await waitFor(() => expect(streams.length).toBeGreaterThan(2), { timeout: 8_000 });
      streams[streams.length - 1].stream.fail();
      const retryButton = await screen.findByRole("button", { name: "Reintentar" }, {
        timeout: 8_000,
      });
      const streamsBefore = streams.length;
      fireEvent.click(retryButton);
      await waitFor(() => expect(streams.length).toBeGreaterThan(streamsBefore), {
        timeout: 8_000,
      });
      expect(creates).toHaveLength(1);
      const reattached = streams[streams.length - 1];
      expect(reattached.runId).toBe(first.runId);
      // The error bubble is gone and the status is working again.
      await waitFor(() => expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull());
      expect(screen.getByRole("status")).toHaveTextContent("Hermes est\u00e1 trabajando");
      reattached.stream.push({
        event: "run.completed",
        run_id: reattached.runId,
        output: "recuperado",
      });
      reattached.stream.close();
      await waitFor(
        () => expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("recuperado"),
        { timeout: 8_000 },
      );
    }, 25_000);

    it("a 401 stream failure surfaces immediately without the retry delays", async () => {
      server.use(
        http.get(`${API}/hermes/runs/:runId/events`, () =>
          HttpResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
        ),
      );
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      await waitFor(() => expect(creates).toHaveLength(1));
      // Immediate: well within the 1 s first-retry budget, and no retry
      // subscription is ever opened.
      await screen.findByText(/Tu sesi\u00f3n expir\u00f3/i);
      expect(await screen.findByText(/Se perdi\u00f3 el stream/i)).toBeInTheDocument();
      expect(streams).toHaveLength(0);
      expect(creates).toHaveLength(1);
    });
  });

  describe("approval aliases (MEDIUM-2)", () => {
    it("renders a card from request_id + preview and approves with that identity", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_alias", startedAt: Date.now() - 5_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "waiting_for_approval",
        createdAt: Date.now() - 5_000,
        executionGeneration: 3,
        output: "",
        error: null,
        pendingControls: [{ request_id: "abc123", preview: "ls -la /tmp" }],
      });
      render(<HermesChat />);

      const card = await screen.findByTestId("hermes-approval", undefined, { timeout: 8_000 });
      expect(card.querySelector("pre")).toHaveTextContent("ls -la /tmp");
      fireEvent.click(within(card).getByRole("button", { name: "Aprobar" }));
      await waitFor(() => expect(approvalSeen).toHaveLength(1));
      expect(approvalSeen[0]).toEqual({
        runId: "run_alias",
        body: { requestId: "abc123", executionGeneration: 3, choice: "once" },
      });
    });

    it("shows a notice and keeps the pointer for an unmappable control", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_dark", startedAt: Date.now() - 5_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "running",
        createdAt: Date.now() - 5_000,
        executionGeneration: 0,
        output: "",
        error: null,
        pendingControls: [{ foo: "bar" }],
      });
      render(<HermesChat />);

      // Never silent: the notice names the parked permission, the card stays
      // hidden, and the pointer survives so a reload can retry the mapping.
      expect(await screen.findByText(/no se pudo mostrar/i, undefined, { timeout: 8_000 })).toBeInTheDocument();
      expect(screen.queryByTestId("hermes-approval")).toBeNull();
      await waitFor(() => expect(statusRequested).toEqual(["run_dark"]));
      expect(localStorage.getItem(HERMES_RUN_KEY)).not.toBeNull();
    });
  });

  describe("stale subscription generation (HIGH-1 follow-up)", () => {
    it("ignores a terminal from a superseded generation: single settle, queue intact", async () => {
      streamHarness.manual = true;
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("uno");
      await waitFor(() => expect(streamHarness.pending).toHaveLength(1));
      const stale = streamHarness.pending[0];
      await send("dos");
      expect(creates).toHaveLength(1);

      // Exhaust immediately with a non-transient failure (no 1 s + 3 s budget).
      stale.reject(new HermesError("upstream", "boom"));
      await screen.findByRole("button", { name: "Reintentar" }, { timeout: 8_000 });

      // Manual retry re-attaches the SAME run: new generation, no new create.
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await waitFor(() => expect(streamHarness.pending).toHaveLength(2));
      expect(creates).toHaveLength(1);
      const current = streamHarness.pending[1];
      expect(current.runId).toBe(stale.runId);
      expect(screen.getByRole("status")).toHaveTextContent("Hermes est\u00e1 trabajando");

      // Late event + terminal from the superseded generation: ignored.
      // Without the guard the stale terminal would settle the new
      // subscription (clearing its guard) and pump the queue early, and the
      // stale output would replace the authoritative answer.
      stale.handlers.onEvent({ event: "message.delta", run_id: stale.runId, delta: "STALE" });
      stale.handlers.onTerminal({
        event: "run.completed",
        run_id: stale.runId,
        output: "STALE OUTPUT",
      });
      // Let the 60 ms delta flush and the async settle path run, if any.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      expect(screen.queryByText(/STALE/)).toBeNull();
      expect(screen.queryByTestId("hermes-markdown")).toBeNull();
      expect(creates).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Hermes est\u00e1 trabajando");
      expect(localStorage.getItem(HERMES_RUN_KEY)).not.toBeNull();

      // The current subscription still settles authoritatively, exactly once.
      current.handlers.onTerminal({
        event: "run.completed",
        run_id: current.runId,
        output: "REAL",
      });
      await waitFor(() => expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("REAL"));
      await waitFor(() => expect(creates).toHaveLength(2));
      expect(creates[1]).toMatchObject({ message: "dos" });
    });

    it("ignores events from a superseded generation", async () => {
      streamHarness.manual = true;
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      await waitFor(() => expect(streamHarness.pending).toHaveLength(1));
      const stale = streamHarness.pending[0];
      stale.handlers.onEvent({ event: "message.delta", run_id: stale.runId, delta: "hello" });
      await screen.findByText("hello");

      stale.reject(new HermesError("upstream", "boom"));
      await screen.findByRole("button", { name: "Reintentar" }, { timeout: 8_000 });
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await waitFor(() => expect(streamHarness.pending).toHaveLength(2));
      const current = streamHarness.pending[1];
      expect(current.runId).toBe(stale.runId);

      // A stale delta and a stale approval gate must not mutate the live bubble.
      stale.handlers.onEvent({ event: "message.delta", run_id: stale.runId, delta: "STALE-DELTA" });
      stale.handlers.onEvent({
        event: "approval.request",
        run_id: stale.runId,
        prompt_id: "stale-id",
        execution_generation: 1,
        command: "rm -rf /stale",
        choices: ["once", "deny"],
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      expect(screen.queryByText(/STALE-DELTA/)).toBeNull();
      expect(screen.queryByTestId("hermes-approval")).toBeNull();

      // The current subscription is still healthy: deltas render, terminal settles.
      current.handlers.onEvent({ event: "message.delta", run_id: current.runId, delta: "world" });
      await screen.findByText("world");
      current.handlers.onTerminal({
        event: "run.completed",
        run_id: current.runId,
        output: "world",
      });
      await waitFor(() =>
        expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("world"),
      );
    });
  });

  describe("clean EOF without terminal (HIGH)", () => {
    it("enters the recoverable stream-lost state and queues the next send visibly", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      const entry = await lastStream();
      entry.stream.push({ event: "message.delta", run_id: entry.runId, delta: "parcial" });
      entry.stream.close();
      expect(
        await screen.findByText(/Se perdi\u00f3 el stream/i, undefined, { timeout: 8_000 }),
      ).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
      expect(localStorage.getItem(HERMES_RUN_KEY)).not.toBeNull();
      await send("siguiente");
      const queued = screen.getByText("siguiente").closest('[data-role="user"]');
      expect(queued).not.toBeNull();
      expect(queued).toHaveTextContent("En cola \u23f3");
      expect(creates).toHaveLength(1);
    });

    it("does not double-settle when the stream closes after a terminal", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      const runId = await completeLast("final");
      await waitFor(() =>
        expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("final"),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
      });
      expect(screen.getAllByTestId("hermes-markdown")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
      expect(screen.queryByText(/Se perdi\u00f3 el stream/i)).toBeNull();
      expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull();
      expect(creates).toHaveLength(1);
      expect(statusRequested).not.toContain(runId);
    });

    it("settles via the status confirm when the run already finished", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("hola");
      const entry = await lastStream();
      statusFor = (runId) => ({
        runId,
        status: "completed",
        createdAt: Date.now(),
        executionGeneration: 0,
        output: "terminado en el servidor",
        error: null,
        pendingControls: [],
      });
      entry.stream.close();
      await waitFor(
        () =>
          expect(screen.getByTestId("hermes-markdown")).toHaveTextContent(
            "terminado en el servidor",
          ),
        { timeout: 8_000 },
      );
      expect(screen.queryByText(/Se perdi\u00f3 el stream/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
      await waitFor(() => expect(localStorage.getItem(HERMES_RUN_KEY)).toBeNull());
    });
  });

  describe("retry on a resumed run (MEDIUM)", () => {
    it("re-attaches the same guarded run even though the error bubble carries no text", async () => {
      streamHarness.manual = true;
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_resumed", startedAt: Date.now() - 5_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "running",
        createdAt: Date.now() - 5_000,
        executionGeneration: 0,
        output: "",
        error: null,
        pendingControls: [],
      });
      render(<HermesChat />);
      await waitFor(() => expect(streamHarness.pending).toHaveLength(1), { timeout: 8_000 });
      expect(streamHarness.pending[0].runId).toBe("run_resumed");
      streamHarness.pending[0].reject(new HermesError("upstream", "boom"));
      const retryButton = await screen.findByRole("button", { name: "Reintentar" }, {
        timeout: 8_000,
      });
      fireEvent.click(retryButton);
      await waitFor(() => expect(streamHarness.pending).toHaveLength(2), { timeout: 8_000 });
      expect(streamHarness.pending[1].runId).toBe("run_resumed");
      expect(creates).toHaveLength(0);
      expect(screen.getByRole("status")).toHaveTextContent("Hermes est\u00e1 trabajando");
    });

    it("hides Retry when there is no guarded run and no text to re-send", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_old", startedAt: Date.now() - 60_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "failed",
        createdAt: Date.now() - 60_000,
        executionGeneration: 0,
        output: "",
        error: "se cay\u00f3",
        pendingControls: [],
      });
      render(<HermesChat />);
      await screen.findByText("se cay\u00f3");
      expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
    });
  });

  describe("unmappable gate notice (MEDIUM)", () => {
    it("survives adding a file and clears once a mappable card renders", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      localStorage.setItem(
        HERMES_RUN_KEY,
        JSON.stringify({ sessionId: SESSION, runId: "run_dark2", startedAt: Date.now() - 5_000 }),
      );
      statusFor = (runId) => ({
        runId,
        status: "running",
        createdAt: Date.now() - 5_000,
        executionGeneration: 0,
        output: "",
        error: null,
        pendingControls: [{ foo: "bar" }],
      });
      render(<HermesChat />);
      expect(
        await screen.findByText(/no se pudo mostrar/i, undefined, { timeout: 8_000 }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("hermes-approval")).toBeNull();
      fireEvent.change(screen.getByTestId("hermes-file-input"), {
        target: { files: [new File(["x"], "nota.txt", { type: "text/plain" })] },
      });
      expect(screen.getByText(/no se pudo mostrar/i)).toBeInTheDocument();
      const entry = await streamFor("run_dark2");
      entry.stream.push({
        event: "approval.request",
        run_id: "run_dark2",
        kind: "approval",
        prompt_id: "abc",
        execution_generation: 1,
        command: "ls /tmp",
        description: null,
        choices: ["once", "deny"],
      });
      await screen.findByTestId("hermes-approval");
      expect(screen.queryByText(/no se pudo mostrar/i)).toBeNull();
    });

    it("live unmappable approval.request sets the same notice", async () => {
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await send("borr\u00e1 eso");
      const entry = await lastStream();
      entry.stream.push({ event: "approval.request", run_id: entry.runId, foo: "bar" });
      expect(await screen.findByText(/no se pudo mostrar/i)).toBeInTheDocument();
      expect(screen.queryByTestId("hermes-approval")).toBeNull();
    });
  });

  describe("new conversation during create", () => {
    it("looks disabled while a create is in flight", async () => {
      let release: (value: unknown) => void = () => {};
      const gate = new Promise<unknown>((resolve) => {
        release = resolve;
      });
      server.use(
        http.post(RUNS, async () => {
          await gate;
          runSeq += 1;
          creates.push({
            runId: `run_${runSeq}`,
            sessionId: SESSION,
            message: "hola",
            authorization: null,
            hermesSession: null,
          });
          return HttpResponse.json(
            { runId: `run_${runSeq}`, sessionId: SESSION, createdAt: Date.now() },
            { status: 202 },
          );
        }),
      );
      localStorage.setItem(HERMES_SESSION_KEY, SESSION);
      render(<HermesChat />);
      await waitFor(() => expect(input()).toBeEnabled());
      fireEvent.change(input(), { target: { value: "hola" } });
      fireEvent.click(sendButton());
      const button = screen.getByRole("button", { name: "\u2795 Nueva conversaci\u00f3n" });
      await waitFor(() => expect(button).toBeDisabled());
      expect(screen.queryByRole("status")).toBeNull();
      release(null);
      const entry = await lastStream();
      expect(button).toBeDisabled();
      entry.stream.push({ event: "run.completed", run_id: entry.runId, output: "ok" });
      entry.stream.close();
      await screen.findByTestId("hermes-markdown");
      await waitFor(() => expect(button).toBeEnabled());
    });
  });
});
