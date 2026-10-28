import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

import HermesChat from "./HermesChat";
import { HERMES_SESSION_KEY, isValidSessionId } from "@/lib/hermes/session";

process.env.NEXT_PUBLIC_API_URL = "http://test.local/api";

const ENDPOINT = "http://test.local/api/hermes";
const SESSION = "3f0f0a4e-6a4b-4c3d-8f2e-0b1c2d3e4f5a";

interface SeenTurn {
  session: string | null;
  authorization: string | null;
  body: unknown;
  form: { message: string; files: { name: string; size: number; type: string }[] } | null;
}

const seen: SeenTurn[] = [];
const signSeen: string[][] = [];
const SIGN = "http://test.local/api/hermes/media/sign";

// msw's fetch interceptor cannot serialize jsdom's FormData (it expects the
// undici implementation and throws while recording the request). Multipart
// turns are asserted through a fetch spy instead; the JSON path still goes
// through msw.
interface MultipartSeen {
  message: string;
  files: { name: string; size: number; type: string }[];
}
let multipartSeen: MultipartSeen[] = [];
let multipartReplies: { status: number; body: unknown }[] = [];

function stubMultipartFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const form = init?.body as FormData;
    multipartSeen.push({
      message: String(form.get("message") ?? ""),
      files: form.getAll("files").map((value) => {
        const file = value as File;
        return { name: file.name, size: file.size, type: file.type };
      }),
    });
    const next = multipartReplies.shift() ?? {
      status: 200,
      body: { reply: "ok", artifacts: artifactsPayload, warnings: warningsPayload },
    };
    if (next.status !== 200) {
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    }
    const payload = next.body as { reply?: string };
    return new Response(sseBody(payload.reply ?? "ok"), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  });
}

let reply = "**Hola**\n\n- uno\n- dos\n\n```js\nconst x = 1;\n```";

/**
 * The chat speaks SSE now. Every mocked turn answers the same envelope the
 * proxy emits on `done`, optionally preceded by thinking/tool frames.
 */
function sseBody(text: string, extra: string[] = []): string {
  const start = `event: start\ndata: ${JSON.stringify({ timeoutMs: 600_000 })}\n\n`;
  const done = `event: done\ndata: ${JSON.stringify({
    reply: text,
    artifacts: artifactsPayload,
    warnings: warningsPayload,
  })}\n\n`;
  return `${start}${extra.join("")}${done}`;
}

function sse(text: string, extra: string[] = []): HttpResponse<string> {
  return new HttpResponse(sseBody(text, extra), {
    headers: { "content-type": "text/event-stream" },
  });
}
let artifactsPayload: { name: string; url: string; mime?: string; size?: number }[] = [];
let warningsPayload: string[] = [];
let failNext = false;
let deferred = false;
let release: (() => void) | null = null;

const server = setupServer(
  http.post(ENDPOINT, async ({ request }) => {
    const contentType = request.headers.get("content-type") ?? "";
    const entry: SeenTurn = {
      session: request.headers.get("x-hermes-session-id"),
      authorization: request.headers.get("authorization"),
      body: null,
      form: null,
    };
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      entry.form = {
        message: String(form.get("message") ?? ""),
        files: form.getAll("files").map((value) => {
          const file = value as File;
          return { name: file.name, size: file.size, type: file.type };
        }),
      };
    } else {
      entry.body = await request.json();
    }
    seen.push(entry);
    if (deferred) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    if (failNext) {
      failNext = false;
      return HttpResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "boom" } },
        { status: 502 },
      );
    }
    return sse(reply);
  }),
  http.post(SIGN, async ({ request }) => {
    const body = (await request.json()) as { paths?: string[] };
    signSeen.push(body.paths ?? []);
    return HttpResponse.json({
      items: (body.paths ?? []).map((path) => ({
        path,
        name: path.split("/").pop() ?? "archivo",
        mime: "image/png",
        size: 12,
        url: `/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=stub`,
      })),
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
  reply = "**Hola**\n\n- uno\n- dos\n\n```js\nconst x = 1;\n```";
  artifactsPayload = [];
  warningsPayload = [];
  multipartSeen = [];
  multipartReplies = [];
  signSeen.length = 0;
  vi.restoreAllMocks();
  failNext = false;
  deferred = false;
  release = null;
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

beforeEach(() => setAuth());

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

  it("sends only the current message with the session header and the dashboard token", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("primer mensaje");
    await screen.findByTestId("hermes-markdown");

    expect(seen).toHaveLength(1);
    expect(seen[0].session).toBe(SESSION);
    expect(seen[0].authorization).toBe("Bearer pd_test_token");
    expect(seen[0].body).toEqual({
      messages: [{ role: "user", content: "primer mensaje" }],
    });
  });

  it("does not replay history on the second turn", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("uno");
    await screen.findByTestId("hermes-markdown");
    await send("dos");
    await waitFor(() => expect(seen).toHaveLength(2));

    expect(seen[1].body).toEqual({ messages: [{ role: "user", content: "dos" }] });
    const userTurns = Array.from(
      document.querySelectorAll('[data-role="user"] p.whitespace-pre-wrap'),
    ).map((node) => node.textContent);
    expect(userTurns).toEqual(["uno", "dos"]);
  });

  it("renders the reply as sanitized Markdown", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const markdown = await screen.findByTestId("hermes-markdown");

    expect(within(markdown).getByText("Hola").tagName).toBe("STRONG");
    expect(within(markdown).getAllByRole("listitem")).toHaveLength(2);
    expect(markdown.querySelector("pre code")?.textContent).toContain("const x = 1;");
  });

  it("never renders raw HTML from the agent", async () => {
    reply = '<script>window.__pwned = true</script>\n\n**seguro**';
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    const { container } = render(<HermesChat />);
    await send("hola");
    await screen.findByText("seguro");
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("shows the working indicator until the reply arrives", async () => {
    deferred = true;
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");

    expect(await screen.findByRole("status")).toHaveTextContent("Hermes está trabajando...");
    expect(sendButton()).toBeDisabled();
    await waitFor(() => expect(release).not.toBeNull());
    release!();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows an inline error and retries the same message", async () => {
    failNext = true;
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");

    expect(
      await screen.findByText("No se pudo conectar con el servidor de Hermes. Revisá que esté disponible."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByTestId("hermes-markdown");
    expect(screen.queryByText(/No se pudo conectar/)).toBeNull();
    expect(seen).toHaveLength(2);
  });

  it("starts a new conversation with a fresh UUID and clears the screen", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
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
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(seen).toHaveLength(0);
    fireEvent.keyDown(input(), { key: "Enter" });
    await screen.findByTestId("hermes-markdown");
    expect(seen).toHaveLength(1);
  });

  it("preserves single line breaks from the agent", async () => {
    reply = "linea uno\nlinea dos";
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const markdown = await screen.findByTestId("hermes-markdown");
    expect(markdown.querySelector("br")).not.toBeNull();
  });

  it("treats a 422 as a permanent validation error without a retry loop", async () => {
    server.use(
      http.post(ENDPOINT, () =>
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
      http.post(ENDPOINT, () =>
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
    failNext = true;
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("hola");
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    retry.focus();
    fireEvent.click(retry);
    expect(document.activeElement).toBe(input());
    await screen.findByTestId("hermes-markdown");
  });

  function fileInput() {
    return screen.getByTestId("hermes-file-input");
  }

  function attach(files: File[]) {
    fireEvent.change(fileInput(), { target: { files } });
  }

  it("sends several attachments in one multipart turn", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await waitFor(() => expect(input()).toBeEnabled());
    attach([
      new File(["png"], "foto.png", { type: "image/png" }),
      new File(["# nota"], "nota.md", { type: "text/markdown" }),
    ]);
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(2);

    fireEvent.change(input(), { target: { value: "mirá esto" } });
    fireEvent.click(sendButton());
    await screen.findByTestId("hermes-markdown");

    expect(multipartSeen).toHaveLength(1);
    expect(multipartSeen[0].message).toBe("mirá esto");
    expect(multipartSeen[0].files.map((file) => file.name)).toEqual(["foto.png", "nota.md"]);
    expect(screen.queryAllByTestId("attachment-chip")).toHaveLength(0);
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
    await screen.findByTestId("hermes-markdown");
    expect(multipartSeen[0].files.map((file) => file.name)).toEqual(["dos.txt"]);
  });

  it("accepts files dropped on the chat", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    fireEvent.drop(screen.getByTestId("hermes-dropzone"), {
      dataTransfer: {
        files: [new File(["x"], "drop.zip", { type: "application/zip" })],
        types: ["Files"],
      },
    });
    const chip = await screen.findByTestId("attachment-chip");
    expect(chip).toHaveTextContent("drop.zip");
  });

  it("sends a turn with attachments and no text", async () => {
    stubMultipartFetch();
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["x"], "solo.png", { type: "image/png" })]);
    expect(sendButton()).toBeEnabled();
    fireEvent.click(sendButton());
    await screen.findByTestId("hermes-markdown");
    expect(multipartSeen[0]).toEqual({
      message: "",
      files: [{ name: "solo.png", size: 1, type: "image/png" }],
    });
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

  it("renders Hermes artifacts with a download link and warnings", async () => {
    artifactsPayload = [
      {
        name: "reporte.pdf",
        url: "https://example.test/reporte.pdf",
        mime: "application/pdf",
        size: 2048,
      },
    ];
    warningsPayload = ["No se pudo enviar la nota de voz «nota.webm»."];
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("pasame el reporte");

    const card = await screen.findByTestId("hermes-artifact");
    expect(within(card).getByText("reporte.pdf")).toBeInTheDocument();
    const link = within(card).getByRole("link", { name: "Descargar archivo: reporte.pdf" });
    expect(link).toHaveAttribute("href", "https://example.test/reporte.pdf");
    expect(link).toHaveAttribute("download", "reporte.pdf");
    expect(screen.getByRole("note")).toHaveTextContent("nota.webm");
  });

  it("turns file links written by Hermes into artifact cards", async () => {
    reply = "Te dejo el gráfico: [grafico.png](https://example.test/grafico.png)";
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    await send("graficame");

    const card = await screen.findByTestId("hermes-artifact");
    expect(within(card).getByText("grafico.png")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Descargar: grafico.png" })).toHaveAttribute(
      "href",
      "https://example.test/grafico.png",
    );
  });

  it("keeps the attachments when the turn fails and retries with them", async () => {
    stubMultipartFetch();
    multipartReplies = [
      { status: 502, body: { error: { code: "INTERNAL_ERROR", message: "boom" } } },
      { status: 200, body: { reply: "ok", artifacts: [], warnings: [] } },
    ];
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);
    attach([new File(["pdf"], "reporte.pdf", { type: "application/pdf" })]);
    fireEvent.change(input(), { target: { value: "adjunto" } });
    fireEvent.click(sendButton());

    expect(await screen.findByText(/No se pudo conectar/)).toBeInTheDocument();
    expect(screen.getAllByTestId("attachment-chip")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByTestId("hermes-markdown");
    expect(multipartSeen).toHaveLength(2);
    expect(multipartSeen[1].files.map((file) => file.name)).toEqual(["reporte.pdf"]);
  });

  it("keeps a file added after the failure when the retry succeeds", async () => {
    stubMultipartFetch();
    multipartReplies = [
      { status: 502, body: { error: { code: "INTERNAL_ERROR", message: "boom" } } },
      { status: 200, body: { reply: "ok", artifacts: [], warnings: [] } },
    ];
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    render(<HermesChat />);

    attach([new File(["uno"], "primero.pdf", { type: "application/pdf" })]);
    fireEvent.change(input(), { target: { value: "adjunto" } });
    fireEvent.click(sendButton());
    await screen.findByText(/No se pudo conectar/);

    attach([new File(["dos"], "segundo.txt", { type: "text/plain" })]);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByTestId("hermes-markdown");

    expect(multipartSeen[1].files.map((file) => file.name)).toEqual(["primero.pdf"]);
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

  it("signs paths the proxy did not pre-sign and draws a card", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    reply = "El render quedó acá:\n\n/tmp/render.png";
    render(<HermesChat />);
    await send("generá el render");

    const card = await screen.findByTestId("hermes-artifact");
    expect(card).toHaveTextContent("render.png");
    expect(signSeen).toEqual([["/tmp/render.png"]]);
    const markdown = screen.getByTestId("hermes-markdown");
    expect(markdown).not.toHaveTextContent("/tmp/render.png");
  });

  it("keeps the reply when signing a path fails", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    reply = "El render quedó en /tmp/render.png";
    server.use(http.post(SIGN, () => HttpResponse.json({ error: { code: "BOOM" } }, { status: 500 })));
    render(<HermesChat />);
    await send("generá el render");

    await screen.findByTestId("hermes-markdown");
    expect(screen.getByTestId("hermes-markdown")).toHaveTextContent("/tmp/render.png");
    expect(screen.queryByTestId("hermes-artifact")).not.toBeInTheDocument();
  });

  it("streams thinking and tools into a collapsed accordion", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    server.use(
      http.post(ENDPOINT, () =>
        sse("La respuesta", [
          `event: thinking\ndata: ${JSON.stringify({ text: "Estoy pensando" })}\n\n`,
          `event: tool\ndata: ${JSON.stringify({
            tool: "terminal",
            label: "ls -A /opt/data",
            status: "running",
            toolCallId: "call-1",
          })}\n\n`,
        ]),
      ),
    );
    render(<HermesChat />);
    await send("hola");

    const accordion = await screen.findByTestId("hermes-thought");
    expect(accordion).toHaveTextContent("Llamando a terminal");
    // Collapsed by default: the reasoning exists but is not rendered.
    expect(screen.queryByText("Estoy pensando")).not.toBeInTheDocument();
    fireEvent.click(within(accordion).getByRole("button"));
    expect(screen.getByText("Estoy pensando")).toBeInTheDocument();
    expect(screen.getByText(/ls -A \/opt\/data/)).toBeInTheDocument();
  });

  it("turns a numbered choice list into an interactive card that answers itself", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    reply =
      "¿Cómo querés que maneje las notificaciones?\n\n1. Solo Telegram\n2. Telegram + resumen semanal\n3. Silencioso\n\nRespondé con el número.";
    render(<HermesChat />);
    await send("configurá las notificaciones");

    const card = await screen.findByTestId("hermes-question");
    expect(card).toHaveTextContent("¿Cómo querés que maneje las notificaciones?");
    expect(within(card).getByText("Solo Telegram")).toBeInTheDocument();
    // The static list never reaches the markdown body.
    const markdown = screen.getByTestId("hermes-markdown");
    expect(markdown).not.toHaveTextContent("Solo Telegram");
    expect(markdown).not.toHaveTextContent("Respondé con el número");

    fireEvent.click(within(card).getByText("Telegram + resumen semanal"));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1].body).toEqual({
      messages: [{ role: "user", content: "Telegram + resumen semanal" }],
    });
    await waitFor(() =>
      expect(within(card).getByText(/Respondido: Telegram \+ resumen semanal/)).toBeInTheDocument(),
    );
  });

  it("shows the live clock while waiting and offers the limit banner", async () => {
    localStorage.setItem(HERMES_SESSION_KEY, SESSION);
    server.use(
      http.post(ENDPOINT, () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(`event: start\ndata: ${JSON.stringify({ timeoutMs: 0 })}\n\n`),
            );
            release = () => {
              controller.enqueue(
                encoder.encode(
                  `event: done\ndata: ${JSON.stringify({
                    reply: "tarde",
                    artifacts: [],
                    warnings: [],
                  })}\n\n`,
                ),
              );
              controller.close();
            };
          },
        });
        return new HttpResponse(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    render(<HermesChat />);
    await send("tardá lo que haga falta");

    const clock = await screen.findByTestId("hermes-elapsed");
    expect(clock).toHaveTextContent("00:00");
    expect(screen.getByRole("status")).toHaveTextContent("Hermes está trabajando");
    const banner = await screen.findByTestId("hermes-time-limit");
    expect(within(banner).getByText("Seguir esperando")).toBeInTheDocument();

    fireEvent.click(within(banner).getByText("Seguir esperando"));
    await waitFor(() =>
      expect(screen.queryByTestId("hermes-time-limit")).not.toBeInTheDocument(),
    );
    release?.();
    await screen.findByText("tarde");
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
      await screen.findByTestId("hermes-markdown");
      expect(seen[0].body).toEqual({
        messages: [{ role: "user", content: "sin storage" }],
      });
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
