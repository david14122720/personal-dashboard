import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";
test.use({ timezoneId: "America/Bogota" });
test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");
test("home 4 widgets exactos, links y telemetria intacta", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  // S-F + this change: exactly the 4 survivors — no pending-debts, no month-split cards, no active-subs.
  for (const n of ["Próximos pagos", "Tareas pendientes", "Próximos eventos", "Progreso de metas"]) await expect(page.getByText(n, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Suscripciones activas", { exact: true })).toHaveCount(0);
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
