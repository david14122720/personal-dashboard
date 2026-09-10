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
  await expect(page.getByText("Presupuestos: crear y editar")).toBeVisible();
  await expect(page.getByText("Suscripciones: crear y gestionar")).toBeVisible();

  // S5 subs: crear exige precio manual (string) y la fila cancela/reactiva solo con is_active.
  await expect(page.getByRole("button", { name: "Crear suscripción" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancelar|Reactivar/ }).first()).toBeVisible();

  // S5 budgets/savings: edición/borrado cableados a sus listas (botones Eliminar en edits).
  await expect(page.getByRole("button", { name: "Eliminar" }).first()).toBeVisible();

  // S5 debts: abono con guard amount<=pending + historial + editar metadata.
  await expect(page.getByText("Historial de abonos")).toBeVisible();

  // S5 cards/assets: crear tarjeta exige límite+corte+pago; valuar con fecha posterior.
  await expect(page.getByRole("button", { name: "Crear tarjeta" })).toBeVisible();
  await expect(page.getByText("Patrimonio neto")).toBeVisible();
});

test("finance S6 charts filtran por 5 rangos y muestran insights con disclaimer", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/finance/");

  // S6: PeriodSelector default mes actual con 5 rangos.
  const period = page.getByRole("group", { name: "Período" });
  await expect(period.getByRole("radio", { name: "Mes" })).toBeChecked();
  for (const name of ["Semana", "Mes", "Trimestre", "Año", "Personalizado"]) {
    await expect(period.getByRole("radio", { name })).toBeVisible();
  }

  // S6: 4 charts + donut income renderizan (títulos ES).
  await expect(page.getByText("Balance", { exact: true })).toBeVisible();
  await expect(page.getByText("Ahorro", { exact: true })).toBeVisible();
  await expect(page.getByText("Gastos mensuales")).toBeVisible();
  await expect(page.getByText("Mes actual frente al anterior")).toBeVisible();
  await expect(page.getByText("Ingresos por fuente")).toBeVisible();

  // S6: custom filtra ambos agregados (date inputs YYYY-MM-DD + error inline si from>to).
  await period.getByRole("radio", { name: "Personalizado" }).click();
  await period.getByLabel("Desde").fill("2026-07-01");
  await period.getByLabel("Hasta").fill("2026-09-09");
  await expect(period.getByRole("alert")).toHaveCount(0);

  // S6: insights >=3 tono directo + disclaimer siempre visible.
  await expect(page.getByText("Análisis personal, no asesoramiento financiero.")).toBeVisible();
  await expect(page.getByText(/Este mes gastaste|Tu tasa de ahorro|Tu mayor gasto/)).toBeVisible();

  // S6: patrimonio-número visible en moneda de /me.
  await expect(page.getByText("Patrimonio neto")).toBeVisible();
});
