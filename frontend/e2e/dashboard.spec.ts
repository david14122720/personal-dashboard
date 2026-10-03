import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";

test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");

test("dashboard home renders telemetry strip and charts container", async ({ page }) => {
  await loginViaApi(page);

  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  // This change removed the patrimonio KPI: saldo total is the strip's only money figure.
  await expect(page.getByText("Saldo total").first()).toBeVisible();
  await expect(page.getByText("Patrimonio neto")).toHaveCount(0);
  await expect(page.getByLabel("Flujo mensual", { exact: true })).toBeVisible();
});
