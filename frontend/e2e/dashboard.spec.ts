import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";

test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");

test("dashboard home renders telemetry strip and charts container", async ({ page }) => {
  await loginViaApi(page);

  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByLabel("Telemetry strip", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Monthly flow", { exact: true })).toBeVisible();
});
