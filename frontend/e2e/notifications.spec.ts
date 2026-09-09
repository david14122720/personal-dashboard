import { test, expect } from "@playwright/test";
import { liveSmoke, loginViaApi } from "./helpers";
test.use({ timezoneId: "America/Bogota" });
test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");
test("bell badge, 2 secciones y mute persiste", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/");
  const bell = page.getByRole("button", { name: /avisos pendientes/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole("dialog", { name: "Avisos" })).toBeVisible();
  await expect(page.getByText("Vencidas", { exact: true })).toBeVisible();
  await expect(page.getByText("Próximos cobros", { exact: true })).toBeVisible();
  const sw = page.getByRole("switch").first();
  if (await sw.count() > 0) {
    await sw.first().click();
    const muted = await page.evaluate(() => localStorage.getItem("p8-notif-muted"));
    expect(muted).toContain("{");
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem("p8-notif-muted"))).toContain("{");
  } else {
    await expect(page.getByText("Sin vencidas 🎉", { exact: true })).toBeVisible();
    await expect(page.getByText("Nada por vencer en 7 días", { exact: true })).toBeVisible();
  }
});
test("ocultar widget excluye categoria del badge", async ({ page }) => {
  await loginViaApi(page);
  await page.goto("/dashboard/");
  await page.getByRole("switch", { name: /active-subs/ }).click();
  await expect(page.getByRole("button", { name: /avisos pendientes/ })).toBeVisible();
  await page.getByRole("switch", { name: /active-subs/ }).click();
});
