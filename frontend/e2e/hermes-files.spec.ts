import { test, expect, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Acceptance for ODD `hermes-rutas-crudas` (S9, S11, S12).
 *
 * The Runs transport is stubbed at the boundary; **`/files/...` is not**. The
 * backend under test serves the two fixtures from its real allowlist, so these
 * assertions cover the whole path a user takes: reply text → path interceptor →
 * `/files/<absolute path>` artifact → embedded image or attachment download.
 *
 *   E2E_HERMES_LIVE=1 E2E_BASE_URL=http://localhost:3100 \
 *   E2E_FILES_ROOT=/tmp/e2e-hermes-media npx playwright test hermes-files
 */
const live = process.env.E2E_HERMES_LIVE === "1";

const ROOT = process.env.E2E_FILES_ROOT ?? "/tmp/e2e-hermes-media";
const SCRATCH = `${ROOT}/cache/scratch`;
const IMAGE_PATH = `${SCRATCH}/prueba_hermes.png`;
const DOCUMENT_PATH = `${SCRATCH}/prueba_hermes.docx`;

const SESSION_ID = "7f3c1d2e-2222-4aaa-9bbb-00000000e2e1";
const RUN_1 = "run_e2e_files";

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

async function installRuns(page: Page, output: string): Promise<void> {
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
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.locator("#hermes-input").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

test.describe("Hermes raw paths through /files", () => {
  test.skip(!live, "Set E2E_HERMES_LIVE=1 with a dashboard server to run.");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((sid: string) => {
      localStorage.setItem("hermes_session_id", sid);
    }, SESSION_ID);
    await loginViaApi(page);
  });

  test("embeds the generated image inline and drops its raw path from the prose", async ({ page }) => {
    const output = `Generé la imagen que pediste.\nMiralo: ${IMAGE_PATH}\n\nAvisame si querés otra.`;
    await installRuns(page, output);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "genera una imagen de prueba");
    const image = page.getByRole("img", { name: "prueba_hermes.png" });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", `/files${IMAGE_PATH}`);
    // The browser really decoded the bytes the Rust route streamed: a broken
    // link would leave naturalWidth at 0 and this assertion catches it.
    await expect
      .poll(async () => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    // Spec S11: the path is replaced, so the bubble keeps prose and no raw text.
    await expect(page.locator('[data-role="assistant"]').first()).not.toContainText(IMAGE_PATH);
    await expect(page.locator('[data-role="assistant"]').first()).toContainText("Avisame si querés otra.");

    await page.screenshot({ path: "test-results/files-image-embedded.png", fullPage: true });
  });

  test("turns the generated Word into a card that downloads with its real name", async ({ page }) => {
    const output = `Listo, el documento está en ${DOCUMENT_PATH}`;
    await installRuns(page, output);

    await page.goto("/dashboard/hermes/");
    await sendMessage(page, "genera un Word de prueba");
    const card = page.locator('[data-testid="hermes-artifact"]').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("prueba_hermes.docx");
    await expect(card.getByTestId("hermes-artifact-badge")).toHaveText("DOCX");

    // Documents use the "Descargar archivo" label; the test id keeps the
    // assertion stable if the copy changes.
    const link = card.getByTestId("hermes-artifact-download");
    await expect(link).toHaveAttribute(
      "href",
      `/files${DOCUMENT_PATH}?download=prueba_hermes.docx`,
    );

    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    expect(download.suggestedFilename()).toBe("prueba_hermes.docx");

    await page.screenshot({ path: "test-results/files-word-card.png", fullPage: true });
  });
});
