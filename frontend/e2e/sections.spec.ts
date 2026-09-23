import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";

test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");

test("finance page renders its heading", async ({ page }) => {
  await loginViaApi(page);

  await page.goto("/dashboard/finance/");
  await expect(page.getByRole("heading", { name: "Finanzas" })).toBeVisible();
});

test("productivity page renders its heading", async ({ page }) => {
  await loginViaApi(page);

  await page.goto("/dashboard/productivity/");
  await expect(page.getByRole("heading", { name: "Productividad" })).toBeVisible();
});

// -- p9-finanzas PR-3 S5/S6 (live smoke only; skipped without E2E_SMOKE_LIVE=1) --
test("finance S5 escritura por dominio con montos manuales y selects por nombre", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/finance/");

  // S5: secciones de escritura visibles tras las F1 intactas.
  await expect(page.getByText("Suscripciones: crear y gestionar")).toBeVisible();

  // S5 subs: crear exige precio manual (string) y la fila cancela/reactiva solo con is_active.
  await expect(page.getByRole("button", { name: "Crear suscripción" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancelar|Reactivar/ }).first()).toBeVisible();

  // S5 savings: edición/borrado cableados a sus listas (botones Eliminar en edits).
  await expect(page.getByRole("button", { name: "Eliminar" }).first()).toBeVisible();

  // S5 debts: abono con guard amount<=pending + historial + editar metadata.
  await expect(page.getByText("Historial de abonos")).toBeVisible();

  // S5 cards/assets: crear tarjeta exige límite+corte+pago; valuar con fecha posterior.
  await expect(page.getByRole("button", { name: "Crear tarjeta" })).toBeVisible();
  await expect(page.getByText("Patrimonio neto")).toBeVisible();
});

test("finance S3b snapshot actual sin charts de flujo ni análisis", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/finance/");

  // S3b: cuentas con edición inline de saldo por tarjeta.
  await expect(page.getByRole("button", { name: /Editar saldo/ }).first()).toBeVisible();

  // S3b: sin PeriodSelector de finanzas, sin charts de flujo, sin análisis.
  await expect(page.getByText("Balance", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Gastos mensuales")).toHaveCount(0);
  await expect(page.getByText("Mes actual frente al anterior")).toHaveCount(0);
  await expect(page.getByText("Ingresos por fuente")).toHaveCount(0);
  await expect(page.getByText("Análisis personal, no asesoramiento financiero.")).toHaveCount(0);

  // S3b: bloques supervivientes siguen visibles.
  await expect(page.getByText("Cuentas").first()).toBeVisible();
  await expect(page.getByText("Patrimonio neto")).toBeVisible();
});
