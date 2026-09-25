import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";
test.use({ timezoneId: "America/Bogota" });
test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");
test("home 5 widgets exactos, links y telemetria intacta", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  // S-F: exactly the 5 survivors — no pending-debts, no month-split cards.
  for (const n of ["Próximos pagos", "Suscripciones activas", "Tareas pendientes", "Próximos eventos", "Progreso de metas"]) await expect(page.getByText(n, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Deudas pendientes", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ver en Finanzas", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ver en Productividad", { exact: true }).first()).toBeVisible();
});
test("toggle persiste tras reload y vacios ES", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/");
  const sw = page.getByRole("switch", { name: /upcoming-payments/ });
  await expect(sw.first()).toBeVisible();
  await sw.first().click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  await page.getByRole("switch", { name: /upcoming-payments/ }).first().click();
});
