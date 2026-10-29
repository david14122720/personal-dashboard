import { test, expect, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Hermes Markdown, inline base64 pictures and document uploads
 * (ODD `hermes-markdown-media-uploads`, S2/S3/S4/S7/S8/S10.1-S10.6).
 *
 * The Runs transport is stubbed at the network boundary exactly like
 * `hermes-artifacts.spec.ts`: `POST /api/hermes/runs` answers `202`, the events
 * endpoint answers verbatim gateway frames (`data:` + `id:`, no `event:` line)
 * and `POST /api/hermes/upload` answers the Rust contract `{items:[…]}`. So the
 * real UI contract is exercised without a live Hermes server or `/opt/data`:
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test hermes-markdown
 *
 * Document download cards are covered by `hermes-artifacts.spec.ts`
 * (acceptance 2); this spec proves the inline image (acceptance 1), rich
 * Markdown (acceptance 5), XSS neutralisation (acceptance 6) and the document
 * upload reference (acceptance 4).
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const SESSION_ID = "7f3c1d2e-2222-4aaa-9bbb-00000000e2e1";
const RUN_1 = "run_e2e_md_1";

/** A 1×1 transparent PNG, small enough to be a real payload. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const DATA_URL = `data:image/png;base64,${PNG}`;

let frameId = 0;

/** One SSE frame in the gateway's shape (`id:` + `data:`, no `event:` line). */
function frame(payload: Record<string, unknown>): string {
  frameId += 1;
  return `id: ${frameId}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function delta(text: string): string {
  return frame({ event: "message.delta", delta: text });
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
    await route.fallback();
  });
}

/** Stub `POST /api/hermes/upload` with the Rust contract, signed URL included. */
async function installUpload(page: Page): Promise<void> {
  await page.route("**/api/hermes/upload", async (route) => {
    let names: string[] = [];
    const raw = route.request().postDataBuffer();
    if (raw) {
      // multipart/form-data: the filename appears in each part header.
      names = [...raw.toString("latin1").matchAll(/filename="([^"]+)"/g)].map((m) => m[1]);
    }
    const items = names.map((name) => {
      const path = `/opt/data/uploads/${name}`;
      return {
        name,
        path,
        url: `http://192.168.50.120:8055/api/hermes/media?path=${encodeURIComponent(path)}&exp=1&sig=stub`,
        size: 1024,
        mime: "application/pdf",
      };
    });
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
  });
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

test.describe("Hermes Markdown and media", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(() => {
    frameId = 0;
  });

  test("draws a completed base64 payload as a real inline picture", async ({ page }) => {
    const output = ["Listo, acá está la imagen:", "", `![prueba](${DATA_URL})`].join("\n");
    await installRuns(page, completed(output));
    await openChat(page);
    await sendMessage(page, "generá una imagen de prueba");

    const picture = page.locator('[data-testid="hermes-inline-image"]');
    await expect(picture).toHaveCount(1);
    await expect(picture).toHaveAttribute("src", DATA_URL);
    // The rounded/shadow framing the spec asks for, and the alt text survives.
    await expect(picture).toHaveClass(/rounded-lg/);
    await expect(picture).toHaveAttribute("alt", "prueba");
    // The raw payload must never leak into the prose.
    await expect(page.locator('[data-testid="hermes-markdown"]').first()).not.toContainText("base64");
  });

  test("hides a half-received payload instead of printing base64", async ({ page }) => {
    // Stream stops mid-payload: no closing paren, no terminal event (S4).
    const partial = `![prueba](${DATA_URL.slice(0, 40)}`;
    await installRuns(page, delta(partial));
    await openChat(page);
    await sendMessage(page, "generá una imagen de prueba");

    await expect(page.locator('[data-testid="hermes-pending-image"]')).toBeVisible();
    await expect(page.locator('[data-testid="hermes-inline-image"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="hermes-log"]')).not.toContainText("iVBORw0KGgo");
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

  test("uploads a document and names its LAN URL in the turn text", async ({ page }) => {
    await installRuns(page, completed("Gracias, ya lo leí."));
    await installUpload(page);
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
    // The reference is explicit and signed, so Hermes can fetch it with curl.
    expect(body?.message).toContain("resumí este informe");
    expect(body?.message).toContain("[archivo adjunto: http://192.168.50.120:8055/api/hermes/media?path=");
    expect(body?.message).toContain("%2Fopt%2Fdata%2Fuploads%2Finforme.pdf");
    // A document must never travel as an inline data URL.
    expect(body?.message).not.toContain("data:application/pdf");
  });
});
