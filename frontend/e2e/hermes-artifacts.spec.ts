import { test, expect, type Route } from "@playwright/test";

/**
 * Hermes media cards (ODD `hermes-media-streaming-documentos`, S8).
 *
 * The chat turns and the signed media responses are stubbed at the network
 * boundary, so this spec exercises the real UI contract without a live Hermes
 * server or a real `/opt/data`. It runs against any server that serves the
 * dashboard (dev or the static export behind the Rust backend):
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 npx playwright test hermes-artifacts
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FILES = [
  { name: "ensayo-celula.docx", mime: DOCX, badge: "DOCX" },
  { name: "planilla.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", badge: "XLSX" },
  { name: "pitch.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", badge: "PPTX" },
  { name: "informe.pdf", mime: "application/pdf", badge: "PDF" },
  { name: "backup.zip", mime: "application/zip", badge: "ZIP" },
];

function envelope() {
  return {
    reply: ["Listo:", ...FILES.map((file) => `MEDIA:/opt/data/entregas/${file.name}`)].join("\n"),
    warnings: [],
    artifacts: FILES.map((file) => ({
      name: file.name,
      path: `/opt/data/entregas/${file.name}`,
      mime: file.mime,
      size: 2048,
      url: `/api/hermes/media?path=${encodeURIComponent(`/opt/data/entregas/${file.name}`)}&exp=1&sig=stub`,
    })),
  };
}

async function fulfillMedia(route: Route) {
  const url = new URL(route.request().url());
  const name = (url.searchParams.get("path") ?? "archivo").split("/").pop() ?? "archivo";
  const download = url.searchParams.get("download");
  await route.fulfill({
    status: 200,
    headers: {
      "content-type": DOCX,
      "accept-ranges": "bytes",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
    },
    body: "PK-stub",
  });
}

test.describe("Hermes media cards", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("dashboard-token", "e2e-stub");
      localStorage.setItem("hermes-session-id", "7f3c1d2e-1111-4aaa-9bbb-00000000e2e0");
    });
    await page.route("**/api/hermes", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(envelope()) }),
    );
    await page.route("**/api/hermes/media**", fulfillMedia);
  });

  test("renders one card per document and downloads with the real name", async ({ page }) => {
    await page.goto("/dashboard/hermes/");
    await page.locator("#hermes-input").fill("pasame los documentos");
    await page.getByRole("button", { name: "Enviar" }).click();

    const cards = page.locator('[data-testid="hermes-artifact"]');
    await expect(cards).toHaveCount(FILES.length);
    const badges = await page.locator('[data-testid="hermes-artifact-badge"]').allTextContents();
    for (const file of FILES) expect(badges).toContain(file.badge);

    const reply = page.locator('[data-testid="hermes-markdown"]').first();
    await expect(reply).not.toContainText("/opt/data");
    await expect(reply).not.toContainText("MEDIA:");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-testid="hermes-artifact-download"]').first().click(),
    ]);
    expect(download.suggestedFilename()).toBe("ensayo-celula.docx");
  });

  test("keeps a single scroll container and a pinned composer", async ({ page }) => {
    await page.goto("/dashboard/hermes/");
    const log = page.locator('[data-testid="hermes-log"]');
    await expect(log).toBeVisible();
    await expect(log).toHaveCSS("overflow-y", "auto");
    await expect(page.locator("form")).toHaveCSS("position", "sticky");

    await page.locator("#hermes-input").fill("hola");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.locator('[data-testid="hermes-artifact"]').first()).toBeVisible();

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
