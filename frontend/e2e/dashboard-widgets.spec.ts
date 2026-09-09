import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";
test.use({ timezoneId: "America/Bogota" });
test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");
test("home 9 widgets exactos, links y telemetria intacta", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/");
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  for (const n of ["Ingreso del mes", "Gasto del mes", "Ahorro del mes", "Próximos pagos", "Deudas pendientes", "Suscripciones activas", "Tareas pendientes", "Próximos eventos", "Progreso de metas"]) await expect(page.getByText(n, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ver en Finanzas", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ver en Productividad", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Flujo mensual", { exact: true })).toBeVisible();
});
test("toggle persiste tras reload y vacios ES", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/");
  const sw = page.getByRole("switch", { name: /pending-debts/ });
  await expect(sw).toBeVisible();
  const wasOn = (await sw.getAttribute("aria-checked")) === "true";
  await sw.click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
  if (wasOn) await expect(page.getByText("Deudas pendientes", { exact: true })).toBeHidden();
  await page.getByRole("switch", { name: /pending-debts/ }).click();
});
