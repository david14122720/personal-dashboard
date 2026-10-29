import { test, expect, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Hermes media cards on the Runs contract (ODD `hermes-runs-aprobaciones`, S11 + S14).
 *
 * The Runs transport and the media-signing round-trip are stubbed at the
 * network boundary:
 * - `POST /api/hermes/runs` → `202 {runId, sessionId, createdAt}`
 * - `GET /api/hermes/runs/{id}/events` → verbatim gateway frames (`data:` +
 *   `id:` + `: keepalive`, no `event:` line), ending in `run.completed`
 *   whose `output` still mentions `/opt/data/...`, `/tmp/...` or `MEDIA:...`
 * - `POST /api/hermes/media/sign` → `200 {items: [{name, url, mime, size, path}]}`
 *   with same-origin signed `/api/hermes/media?...&sig=...` URLs
 * - `GET /api/hermes/media?...` → bytes with `Accept-Ranges: bytes` and a
 *   `Content-Disposition` honouring `download=` (attachment) vs inline.
 *
 * So this spec exercises the real UI contract — reply → sign → download card
 * or native player — without a live Hermes server or a real `/opt/data`:
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test hermes-artifacts
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const SESSION_ID = "7f3c1d2e-1111-4aaa-9bbb-00000000e2e0";
const RUN_1 = "run_e2e_1";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILES = [
  { name: "ensayo-celula.docx", mime: DOCX, badge: "DOCX" },
  { name: "planilla.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", badge: "XLSX" },
  { name: "pitch.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", badge: "PPTX" },
  { name: "informe.pdf", mime: "application/pdf", badge: "PDF" },
  { name: "backup.zip", mime: "application/zip", badge: "ZIP" },
];

function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "docx":
      return DOCX;
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "pdf":
      return "application/pdf";
    case "zip":
      return "application/zip";
    case "mp4":
      return "video/mp4";
    case "mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
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

  await page.route("**/api/hermes/media**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith("/sign") && req.method() === "POST") {
      let paths: unknown = [];
      try {
        paths = (JSON.parse(req.postData() ?? "{}") as { paths?: unknown }).paths ?? [];
      } catch {
        paths = [];
      }
      const items = (Array.isArray(paths) ? paths : [])
        .filter((item): item is string => typeof item === "string")
        .map((item) => {
          const name = item.split("/").pop() ?? "archivo";
          return {
            name,
            url: `/api/hermes/media?path=${encodeURIComponent(item)}&exp=1&sig=stub`,
            mime: mimeOf(name),
            size: 2048,
            path: item,
          };
        });
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      return;
    }
    const name = (url.searchParams.get("path") ?? "archivo").split("/").pop() ?? "archivo";
    const download = url.searchParams.get("download");
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": mimeOf(name),
        "accept-ranges": "bytes",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      },
      body: "PK-stub",
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

    // Signed cards replace the raw paths: nothing leaks as prose.
    const reply = page.locator('[data-testid="hermes-markdown"]').first();
    await expect(reply).not.toContainText("/opt/data");
    await expect(reply).not.toContainText("MEDIA:");

    // The download goes through the signed media URL with `download=` so the
    // proxy answers `Content-Disposition: attachment` with the real filename.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-testid="hermes-artifact-download"]').first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("ensayo-celula.docx");
  });

  test("plays /tmp video and /opt/data audio from signed URLs", async ({ page }) => {
    await installHermes(page, "Listo, material listo:\nMEDIA:/tmp/clip.mp4\n/opt/data/musica.mp3");

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "pasame el material");

    const video = page.locator('video[src*="/api/hermes/media"]');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("src", /path=%2Ftmp%2Fclip\.mp4/);
    await expect(video).toHaveAttribute("src", /sig=stub/);

    const audio = page.locator('audio[src*="/api/hermes/media"]');
    await expect(audio).toBeVisible();
    await expect(audio).toHaveAttribute("src", /sig=stub/);

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
