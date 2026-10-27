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

const seen: {
  session: string | null;
  authorization: string | null;
  body: unknown;
}[] = [];

let reply = "**Hola**\n\n- uno\n- dos\n\n```js\nconst x = 1;\n```";
let failNext = false;
let deferred = false;
let release: (() => void) | null = null;

const server = setupServer(
  http.post(ENDPOINT, async ({ request }) => {
    seen.push({
      session: request.headers.get("x-hermes-session-id"),
      authorization: request.headers.get("authorization"),
      body: await request.json(),
    });
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
    return HttpResponse.json({ choices: [{ message: { content: reply } }] });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
  reply = "**Hola**\n\n- uno\n- dos\n\n```js\nconst x = 1;\n```";
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
