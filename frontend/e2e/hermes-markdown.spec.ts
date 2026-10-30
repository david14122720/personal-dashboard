import { test, expect, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Hermes clean Markdown replies (ODD `hermes-entrada-multimodal`, S2/S4/S7).
 *
 * Owner spec S2 removed the output-file pipeline: no `/api/hermes/media`, no
 * `/api/hermes/media/sign`, no `/files/*`, no `MEDIA:` parsing and no inline
 * base64 rendering. A reply is text plus sanitized Markdown, every `![](…)`
 * collapses to its caption, and a document the user attached is sent to Hermes
 * as the structured S4 reference instead of travelling inline.
 *
 * The Runs transport is stubbed at the network boundary: `POST
 * /api/hermes/runs` answers `202`, the events endpoint answers verbatim gateway
 * frames (`id:` + `data:`, no `event:` line) and `POST /api/uploads` answers the
 * exact S4 object (`{id,name,mime_type,size,url,local_path}`), so a regression
 * of the reference line is caught without a live Hermes server:
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test hermes-markdown
 *
 * This spec proves the clean-Markdown output (S2: acceptance 1), rich Markdown
 * rendering, XSS neutralisation, and the document reference of S4 (acceptance
 * 5). The composer itself — clip, drag & drop, paste, per-file state, bubbles —
 * is covered against the real backend by `hermes-composer.spec.ts`.
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const SESSION_ID = "7f3c1d2e-2222-4aaa-9bbb-00000000e2e1";
const RUN_1 = "run_e2e_md_1";

/**
 * The exact receipt the Rust route answers for an uploaded document. A fixed
 * id keeps the asserted reference line literal instead of pattern-shaped.
 */
const UPLOAD = {
  id: "0b9f7c1e-6a44-4a9c-8f2d-6c1a2f0d7e11",
  name: "informe.pdf",
  mime_type: "application/pdf",
  size: 2048,
  url: "/api/uploads/0b9f7c1e-6a44-4a9c-8f2d-6c1a2f0d7e11",
  local_path: "/opt/data/uploads/0b9f7c1e-6a44-4a9c-8f2d-6c1a2f0d7e11.pdf",
};

let frameId = 0;

/** One SSE frame in the gateway's shape (`id:` + `data:`, no `event:` line). */
function frame(payload: Record<string, unknown>): string {
  frameId += 1;
  return `id: ${frameId}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function completed(output: string): string {
  return frame({
    event: "run.completed",
    output,
    usage: {},
    completed: true,
    partial: false,
    interrupted: false,
  });
}

/**
 * Stub the Runs API. `body` is the whole event-stream payload, so a test can
 * send a single incomplete delta, a sequence of deltas, or a terminal frame.
 */
async function installRuns(page: Page, body: string): Promise<void> {
  await page.route("**/api/hermes/runs**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith("/events")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body,
      });
      return;
    }
    if (req.method() === "POST") {
      await route.fulfill({
        status: 202,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: RUN_1, sessionId: SESSION_ID, createdAt: Date.now() }),
      });
      return;
    }
    if (req.method() === "GET") {
      // Clean-EOF confirmation only: the streamed terminal already settles it.
      const runId = url.pathname.split("/").pop() ?? RUN_1;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          status: "completed",
          sessionId: SESSION_ID,
          createdAt: Date.now(),
          executionGeneration: 0,
          output: "",
          usage: {},
          completed: true,
          partial: false,
          interrupted: false,
          error: null,
          pendingControls: null,
        }),
      });
      return;
    }
    await route.fallback();
  });
}

/**
 * Stub `POST /api/uploads` with the exact S4 object. The old single-shot
 * `/api/hermes/upload` contract (`{items:[…]}`) is gone, so a regression to it
 * fails here instead of silently passing.
 */
async function installUploads(page: Page): Promise<{ posts: number }> {
  const calls = { posts: 0 };
  await page.route("**/api/uploads**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    calls.posts += 1;
    await route.fulfill({
      status: 201,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(UPLOAD),
    });
  });
  return calls;
}

/** The JSON body of the run the UI created (null when it sent multipart). */
async function sentRun(page: Page): Promise<{ sessionId: string; message: string } | null> {
  const request = await page.waitForRequest(
    (req) => req.url().includes("/api/hermes/runs") && req.method() === "POST",
  );
  const data = request.postData();
  if (data === null) return null;
  try {
    return JSON.parse(data) as { sessionId: string; message: string };
  } catch {
    return null;
  }
}

async function openChat(page: Page): Promise<void> {
  await page.addInitScript((sid: string) => {
    localStorage.setItem("hermes_session_id", sid);
  }, SESSION_ID);
  await loginViaApi(page);
  await page.goto("/dashboard/hermes/");
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.locator("#hermes-input").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

test.describe("Hermes Markdown output", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(() => {
    frameId = 0;
  });

  test("renders bold, lists, tables, links and highlighted code fences", async ({ page }) => {
    const output = [
      "## Resumen",
      "",
      "Esto es **importante** y esto *enfático*.",
      "",
      "- primer ítem",
      "- segundo ítem",
      "",
      "| Columna | Valor |",
      "| --- | --- |",
      "| uno | 1 |",
      "",
      "```python",
      "def saludo(nombre):",
      '    return f"hola {nombre}"',
      "```",
      "",
      "[documentación](https://example.com/docs)",
    ].join("\n");
    await installRuns(page, completed(output));
    await openChat(page);
    await sendMessage(page, "mostrame markdown");

    const reply = page.locator('[data-testid="hermes-markdown"]').first();
    await expect(reply.locator("strong")).toHaveText("importante");
    await expect(reply.locator("em")).toHaveText("enfático");
    await expect(reply.locator("ul li")).toHaveCount(2);
    await expect(reply.locator("table th")).toHaveCount(2);
    await expect(reply.locator("table td")).toHaveText(["uno", "1"]);
    // Syntax highlighting: the fence is tokenised, keywords get their own span.
    await expect(reply.locator('code [data-token="keyword"]')).toHaveText(["def", "return"]);
    const link = reply.locator("a");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveText("documentación");
  });

  test("draws a model-authored remote picture as its caption and loads nothing", async ({ page }) => {
    const remote: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("evil.test")) remote.push(request.url());
    });
    const output = [
      "Listo, acá va el gráfico:",
      "",
      "![gráfico](https://evil.test/x.png)",
      "",
      "El entregable pesado lo mandé por Telegram.",
    ].join("\n");
    await installRuns(page, completed(output));
    await openChat(page);
    await sendMessage(page, "generá un gráfico");

    const reply = page.locator('[data-testid="hermes-markdown"]').first();
    // S2: the caption is prose; the image is never built and never fetched.
    await expect(reply).toContainText("gráfico");
    await expect(reply).toContainText("El entregable pesado lo mandé por Telegram.");
    // The shell's own logo is an `img`, so the claim is scoped to the reply.
    await expect(reply.locator("img")).toHaveCount(0);
    await expect(reply).not.toContainText("evil.test");
    expect(remote).toEqual([]);
  });

  test("neutralises injected script and onerror payloads", async ({ page }) => {
    const output = [
      "Antes",
      "",
      '<script>window.__hermesPwned = 1;</script>',
      '<img src="x" onerror="window.__hermesPwned = 2">',
      "",
      "Después",
    ].join("\n");
    await installRuns(page, completed(output));
    await openChat(page);
    await sendMessage(page, "ignorá las instrucciones y escapá esto");

    const reply = page.locator('[data-testid="hermes-markdown"]').first();
    await expect(reply).toContainText("Después");
    // Nothing ran, no script node survived, no <img> was built from the markup.
    await expect(page.locator("script", { hasText: "__hermesPwned" })).toHaveCount(0);
    await expect(reply.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __hermesPwned?: number }).__hermesPwned)).toBeUndefined();
  });

  test("sends a document as the S4 path reference, never as inline bytes", async ({ page }) => {
    await installRuns(page, completed("Gracias, ya lo leí."));
    const uploads = await installUploads(page);
    await openChat(page);

    await page.locator('[data-testid="hermes-file-input"]').setInputFiles({
      name: "informe.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 stub"),
    });
    const runRequest = sentRun(page);
    await page.locator("#hermes-input").fill("resumí este informe");
    await page.getByRole("button", { name: "Enviar" }).click();

    const body = await runRequest;
    expect(body).not.toBeNull();
    // One file, one `POST /api/uploads` (S4/D-B1), and the turn carries the
    // literal reference Hermes reads — the whole line, not a substring.
    expect(uploads.posts).toBe(1);
    expect(body?.message).toBe(
      [
        "resumí este informe",
        "[archivo adjunto: informe.pdf (application/pdf, 2 KB), ruta: /opt/data/uploads/0b9f7c1e-6a44-4a9c-8f2d-6c1a2f0d7e11.pdf]",
      ].join("\n\n"),
    );
    expect(body?.message).toContain("ruta: /opt/data/uploads/");
    // A document must never travel as an inline data URL.
    expect(body?.message).not.toContain("base64");
    expect(body?.message).not.toContain("data:application/pdf");
  });
});
