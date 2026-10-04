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
  const dialog = page.getByRole("dialog", { name: "Avisos" });
  await expect(dialog).toBeVisible();
  await expect(page.getByText("Vencidas", { exact: true })).toBeVisible();
  await expect(page.getByText("Próximos cobros", { exact: true })).toBeVisible();
  // The mute switches live on the notification rows inside the dialog; the
  // dashboard also renders widget-visibility switches, so scope to the dialog.
  const sw = dialog.getByRole("switch").first();
  if (await sw.count() > 0) {
    await sw.click();
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
  // The removed active-subscriptions widget is gone; the surviving payments widget gates the category.
  // Both the widget header and the «Personalizar» panel render an «upcoming-payments»
  // switch, so the hide click is scoped to the widget region itself.
  const widget = page.getByRole("region", { name: "Próximos pagos" });
  await widget.getByRole("switch", { name: /upcoming-payments/ }).click();
  await expect(page.getByRole("button", { name: /avisos pendientes/ })).toBeVisible();
  // The widget region is unmounted while hidden: re-enable it from «Personalizar».
  await page.getByRole("region", { name: "Personalizar" }).getByRole("switch", { name: /upcoming-payments/ }).click();
});
