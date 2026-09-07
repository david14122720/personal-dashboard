import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";

test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");

test("finance page renders its heading", async ({ page }) => {
  await loginViaApi(page);

  await page.goto("/dashboard/finance/");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
});

test("productivity page renders its heading", async ({ page }) => {
  await loginViaApi(page);

  await page.goto("/dashboard/productivity/");
  await expect(page.getByRole("heading", { name: "Productivity" })).toBeVisible();
});
