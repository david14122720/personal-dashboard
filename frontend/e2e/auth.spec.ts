import { test, expect } from "@playwright/test";
import { liveSmoke, credentials } from "./helpers";

test.skip(!liveSmoke, "Set E2E_SMOKE_LIVE=1 with a live backend to run smoke specs.");

test("login with valid credentials redirects to the dashboard", async ({ page }) => {
  const { email, password } = credentials();
  test.skip(!email || !password, "Set E2E_USER and E2E_PASSWORD to run the login smoke.");

  await page.goto("/login/");
  await page.getByLabel("Correo electrónico").fill(email as string);
  await page.getByLabel("Contraseña").fill(password as string);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL(/\/dashboard\/?$/);
  await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();

  const token = await page.evaluate(() => localStorage.getItem("dashboard-token"));
  expect(token, "bearer token persisted in localStorage").toBeTruthy();
});
