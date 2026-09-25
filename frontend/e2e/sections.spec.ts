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

// -- S-F (live smoke only; skipped without E2E_SMOKE_LIVE=1): surviving shells --
test("finance surviving shells: subs rows with Pay, movements, chart, assets", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/finance/");

  // Surviving write shells after the savings/debts removal.
  await expect(page.getByText("Suscripciones: crear y gestionar")).toBeVisible();
  await expect(page.getByText("Activos y patrimonio")).toBeVisible();

  // S5 subs: rows cancel/reactivate plus Pay (create lives in Settings).
  await expect(page.getByRole("button", { name: /Cancelar|Reactivar/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar" }).first()).toBeVisible();

  // Movements history + two-series chart read GET /movements.
  await expect(page.getByRole("region", { name: "Movimientos" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Gastos e ingresos por categoría" })).toBeVisible();

  // S-F: no Savings and no Debts section, control or placeholder remains.
  await expect(page.getByRole("region", { name: "Deudas" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Ahorros" })).toHaveCount(0);
  await expect(page.getByText("Historial de abonos")).toHaveCount(0);

  // La sección Tarjetas fue eliminada de Finanzas: solo queda patrimonio-número.
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
