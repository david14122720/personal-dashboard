import { test, expect } from "@playwright/test";
import { liveSmoke } from "./helpers";

test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");

for (const route of ["/dashboard/", "/dashboard/finance/", "/dashboard/productivity/"]) {
  test(`unauthenticated visit to ${route} guards back to login`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login\/?/);
    await expect(page.locator("#login-heading")).toBeVisible();
  });
}
