import { test, expect, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Hermes artifact cards on the Runs contract (ODD `hermes-runs-aprobaciones`,
 * S11 + S14; retargeted for `hermes-rutas-crudas` S9/S11).
 *
 * The Runs transport and the file server are stubbed at the network boundary:
 * - `POST /api/hermes/runs` → `202 {runId, sessionId, createdAt}`
 * - `GET /api/hermes/runs/{id}/events` → verbatim gateway frames (`data:` +
 *   `id:` + `: keepalive`, no `event:` line), ending in `run.completed`
 *   whose `output` still mentions `/opt/data/...`, `/tmp/...` or `MEDIA:...`
 * - `**\/files/**` → real bytes with the extension's MIME type and a
 *   `Content-Disposition` honouring `download=` (attachment) vs inline, for
 *   both the settle-time `HEAD` probe and the `GET` the card clicks issue.
 *
 * Scanned paths now become `/files/<absolute path>` cards, so nothing here
 * touches `/api/hermes/media`. The image and `.docx` acceptance lives in
 * `hermes-files.spec.ts`; this spec covers the multi-document set and the
 * native players:
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test hermes-artifacts
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const SESSION_ID = "7f3c1d2e-1111-4aaa-9bbb-00000000e2e0";
const RUN_1 = "run_e2e_1";

const FILES = [
  { name: "planilla.xlsx", badge: "XLSX" },
  { name: "pitch.pptx", badge: "PPTX" },
  { name: "informe.pdf", badge: "PDF" },
  { name: "backup.zip", badge: "ZIP" },
];

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
};

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Real bytes per family, so the browser gets a sniffable payload instead of a
 * JSON string. Players use `preload="none"`, so these are only read if a test
 * asks the element to load.
 */
function bytesFor(extension: string): Buffer {
  switch (extension) {
    case "png":
      return Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
    case "pdf":
      return Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64)]);
    case "mp4":
      // A minimal `ftyp` box: enough for a media element to accept the source.
      return Buffer.concat([
        Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex"),
        Buffer.alloc(64),
      ]);
    case "mp3":
      return Buffer.concat([Buffer.from("49443303000000000000", "hex"), Buffer.alloc(64)]);
    default:
      // Office documents and archives are ZIP containers.
      return Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.alloc(64)]);
  }
}

function completedFrame(output: string): string {
  return `data: ${JSON.stringify({
    event: "run.completed",
    output,
    usage: {},
    completed: true,
    partial: false,
    interrupted: false,
  })}\n\n`;
}

async function installHermes(page: Page, output: string): Promise<void> {
  await page.route("**/api/hermes/runs**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith("/events")) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: completedFrame(output),
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

  // The stable file server (spec S9/S10). `HEAD` answers the settle-time
  // existence probe; `GET` answers the download the card triggers.
  await page.route("**/files/**", async (route) => {
    const url = new URL(route.request().url());
    const name = decodeURIComponent(url.pathname.split("/").pop() ?? "archivo");
    const extension = extensionOf(name);
    // `download=<name>` is the parameter `downloadUrl()` appends, and the Rust
    // route turns it into `Content-Disposition: attachment; filename="…"`.
    const download = url.searchParams.get("download");
    const disposition = download
      ? `attachment; filename="${download}"`
      : `inline; filename="${name}"`;
    const body = bytesFor(extension);
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": MIME[extension] ?? "application/octet-stream",
        "content-length": String(body.length),
        "accept-ranges": "bytes",
        "content-disposition": disposition,
      },
      // A HEAD answer carries the headers only, exactly like the Rust route.
      body: route.request().method() === "HEAD" ? undefined : body,
    });
  });
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.locator("#hermes-input").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

test.describe("Hermes media cards", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(async ({ page }) => {
    // A real session: the shell fetches `/api/me` on mount and a fake token
    // would bounce every test to `/login/`.
    await page.addInitScript((sid: string) => {
      localStorage.setItem("hermes_session_id", sid);
    }, SESSION_ID);
    await loginViaApi(page);
  });

  test("renders one card per document and downloads with the real name", async ({ page }) => {
    const output = ["Listo:", ...FILES.map((file) => `MEDIA:/opt/data/entregas/${file.name}`)].join(
      "\n",
    );
    await installHermes(page, output);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "pasame los documentos");

    const cards = page.locator('[data-testid="hermes-artifact"]');
    await expect(cards).toHaveCount(FILES.length);
    const badges = await page.locator('[data-testid="hermes-artifact-badge"]').allTextContents();
    for (const file of FILES) expect(badges).toContain(file.badge);

    // Every `Ver` link points at the stable file server, not at the media route.
    const openLinks = await page
      .locator(
        '[data-testid="hermes-artifact"] a:not([data-testid="hermes-artifact-download"])',
      )
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    expect(openLinks).toEqual(FILES.map((file) => `/files/opt/data/entregas/${file.name}`));

    // Cards replace the raw paths: nothing leaks as prose.
    const reply = page.locator('[data-testid="hermes-markdown"]').first();
    await expect(reply).not.toContainText("/opt/data");
    await expect(reply).not.toContainText("MEDIA:");

    // The download goes through `/files` with `download=` so the server answers
    // `Content-Disposition: attachment` with the real filename.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-testid="hermes-artifact-download"]').first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("planilla.xlsx");
  });

  test("plays /tmp video and /opt/data audio from /files URLs", async ({ page }) => {
    await installHermes(page, "Listo, material listo:\nMEDIA:/tmp/clip.mp4\n/opt/data/musica.mp3");

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "pasame el material");

    const video = page.locator('video[src*="/files/"]');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("src", "/files/tmp/clip.mp4");

    const audio = page.locator('audio[src*="/files/"]');
    await expect(audio).toBeVisible();
    await expect(audio).toHaveAttribute("src", "/files/opt/data/musica.mp3");

    await expect(page.locator('[data-testid="hermes-artifact-download"]')).toHaveCount(2);
    const reply = page.locator('[data-testid="hermes-markdown"]').first();
    await expect(reply).not.toContainText("/tmp/");
    await expect(reply).not.toContainText("/opt/data");
    await expect(reply).not.toContainText("MEDIA:");
  });

  test("keeps a single scroll container and a pinned composer", async ({ page }) => {
    const long = Array.from({ length: 30 }, (_, index) => `Línea ${index + 1} del informe.`).join(
      "\n",
    );
    await installHermes(page, `${long}\nMEDIA:/opt/data/entregas/informe.pdf`);

    await page.goto("/dashboard/hermes/");
    const log = page.locator('[data-testid="hermes-log"]');
    await expect(log).toBeVisible();
    await expect(log).toHaveCSS("overflow-y", "auto");
    await expect(page.locator("form")).toHaveCSS("position", "sticky");

    await sendMessage(page, "pasame el informe largo");
    await expect(page.locator('[data-testid="hermes-artifact"]').first()).toBeVisible();
    await expect(page.getByText("Línea 30 del informe.")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const bubbles = [...document.querySelectorAll('[data-role="assistant"], [data-role="user"]')];
      return {
        doc: document.scrollingElement
          ? document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight
          : 0,
        bubbles: bubbles.map((node) => getComputedStyle(node).overflowY),
      };
    });
    expect(metrics.doc).toBeLessThanOrEqual(1);
    expect(metrics.bubbles.some((value) => value === "auto" || value === "scroll")).toBe(false);
  });
});
