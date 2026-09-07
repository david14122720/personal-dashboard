import type { Page } from "@playwright/test";

/** True only when the smoke run targets a live backend. */
export const liveSmoke = process.env.E2E_SMOKE_LIVE === "1";

export function credentials(): { email?: string; password?: string } {
  return { email: process.env.E2E_USER, password: process.env.E2E_PASSWORD };
}

/**
 * Authenticate through the real API (`POST /api/login`) and seed the bearer
 * token exactly where the app keeps it (`dashboard-token` in localStorage),
 * mirroring `login()` in `lib/api/client.ts`.
 */
export async function loginViaApi(page: Page): Promise<void> {
  const { email, password } = credentials();
  if (!email || !password) {
    throw new Error("Set E2E_USER and E2E_PASSWORD to run the authenticated smoke specs.");
  }
  const res = await page.request.post("/api/login", { data: { email, password } });
  if (!res.ok()) {
    throw new Error(`Login API returned ${res.status()} for the smoke user.`);
  }
  const body = (await res.json()) as { token: string };
  await page.addInitScript((token: string) => {
    localStorage.setItem("dashboard-token", token);
  }, body.token);
}
