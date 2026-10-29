import { test, expect } from "@playwright/test";

import { loginViaApi } from "./helpers";

/**
 * Hermes full-stack smoke (ODD `hermes-runs-aprobaciones`, S5/S6/S7/S8/S12).
 *
 * Unlike `hermes-streaming.spec.ts`, nothing is stubbed here: the browser talks
 * to the real Rust proxy, which talks to the real hermes-agent gateway. It
 * therefore needs a served dashboard plus the gateway and must never run in CI:
 *
 *   STATIC_DIR=$PWD/frontend/out DATABASE_URL=... PORT=3100 \
 *     HERMES_API_URL=... HERMES_API_KEY=... ./personal-dashboard-backend
 *
 *   E2E_HERMES_REAL=1 E2E_BASE_URL=http://localhost:3100 \
 *     E2E_USER=... E2E_PASSWORD=... npx playwright test hermes-live
 *
 * The approval test deliberately parks a `rm -rf` on a path that does not
 * exist and answers "Denegar", so nothing is ever deleted.
 */
const real = process.env.E2E_HERMES_REAL === "1";

/** A real agent turn is minutes long at worst; the default 30 s is not enough. */
const RUN_BUDGET = 150_000;

test.describe("Hermes live runs", () => {
  test.skip(
    !real,
    "Set E2E_HERMES_REAL=1 with the backend serving the export and the real gateway.",
  );
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    await loginViaApi(page);
  });

  test("streams a real run and re-engages it after a refresh", async ({ page }) => {
    await page.goto("/dashboard/hermes/");
    await page
      .locator("#hermes-input")
      .fill("Ejecuta exactamente en la terminal: sleep 12; echo listo-final");
    await page.getByRole("button", { name: "Enviar" }).click();

    // The run starts immediately and the clock counts while it works (S6).
    const clock = page.getByTestId("hermes-elapsed");
    await expect(clock).toBeVisible({ timeout: 30_000 });
    await expect(clock).toContainText("⏱️");
    // Reload only once the run is registered: a refresh inside the ~200 ms
    // window between the click and `POST /runs` answering has no run id yet,
    // which is a documented limit (D9), not the scenario under test.
    await page.waitForFunction(() => localStorage.getItem("pd-hermes-run") !== null, undefined, {
      timeout: 30_000,
    });

    // Refresh in the middle of the run (S5). Two things must survive: the
    // conversation, and the turn itself — either re-subscribed while it is
    // still live, or recovered from the stored run if it finished while the
    // tab was reloading. Losing the answer is the failure this asserts against.
    await page.reload();
    await expect(page.locator('[data-role="user"]').last()).toContainText("sleep 12", {
      timeout: 30_000,
    });

    const answer = page.locator('[data-role="assistant"]').last();
    await expect(answer).toContainText("listo-final", { timeout: RUN_BUDGET });
    await expect(page.getByTestId("hermes-elapsed")).toHaveCount(0, { timeout: RUN_BUDGET });
  });

  test("parks a dangerous command and denies it from the card", async ({ page }) => {
    await page.goto("/dashboard/hermes/");
    await page
      .locator("#hermes-input")
      .fill("Ejecuta exactamente: rm -rf /tmp/hermes-e2e-probe-dir");
    await page.getByRole("button", { name: "Enviar" }).click();

    // A gated command parks the run and surfaces the card (S7).
    const card = page.getByTestId("hermes-approval");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText("rm -rf /tmp/hermes-e2e-probe-dir");
    await expect(card.getByRole("button", { name: "Aprobar" })).toBeVisible();

    await card.getByRole("button", { name: "Denegar" }).click();
    await expect(page.getByTestId("hermes-approval-resolved")).toContainText("Denegado", {
      timeout: 20_000,
    });

    // The gateway resumes the run on its own after the decision (S8).
    await expect(page.getByTestId("hermes-elapsed")).toHaveCount(0, { timeout: RUN_BUDGET });
    await expect(page.locator('[data-role="assistant"]').last()).not.toBeEmpty();
  });

  test("queues a second message while the run is active", async ({ page }) => {
    await page.goto("/dashboard/hermes/");
    await page
      .locator("#hermes-input")
      .fill("Ejecuta exactamente en la terminal: sleep 10; echo primero");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("hermes-elapsed")).toBeVisible({ timeout: 30_000 });

    await page.locator("#hermes-input").fill("segundo mensaje en cola");
    await page.getByRole("button", { name: "Enviar" }).click();

    // The composer stays usable and the second turn waits its turn (S12).
    const queued = page.locator('[data-queued="true"]');
    await expect(queued).toHaveCount(1, { timeout: 15_000 });
    await expect(queued).toContainText("En cola ⏳");

    // Once the first run settles, the queued turn goes out on its own.
    await expect(queued).toHaveCount(0, { timeout: RUN_BUDGET });
    await expect(page.locator('[data-role="user"]').last()).toContainText("segundo mensaje en cola");
  });
});
