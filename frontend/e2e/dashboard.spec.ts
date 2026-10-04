import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";

test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");

test("dashboard home renders telemetry strip and chart disclosures", async ({ page }) => {
  await loginViaApi(page);

  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // This change removed the patrimonio KPI: saldo total is the strip's only money figure.
  await expect(page.getByText("Saldo total").first()).toBeVisible();
  await expect(page.getByText("Patrimonio neto")).toHaveCount(0);
  // Flujo mensual retired: the home now exposes the two collapsible chart disclosures.
  await expect(page.getByRole("button", { name: "Gastos vs. ingresos" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gastos por categoría" })).toBeVisible();
  await expect(page.getByLabel("Flujo mensual", { exact: true })).toHaveCount(0);
});
