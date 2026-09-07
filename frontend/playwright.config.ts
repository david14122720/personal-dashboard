import { defineConfig } from "@playwright/test";

/**
 * Smoke suite for the P6 dashboard.
 *
 * The specs run against a locally started backend that serves the static
 * export (`frontend/out`) same-origin and nests the API under `/api`:
 *
 *   1. Build the export:            npm run build            (in frontend/)
 *   2. Start the backend:           STATIC_DIR=$PWD/frontend/out \
 *                                   DATABASE_URL=... PORT=3000 SESSION_TTL_HOURS=24 \
 *                                   ./personal-dashboard-backend
 *   3. Run the live smoke:          E2E_SMOKE_LIVE=1 E2E_USER=... E2E_PASSWORD=... \
 *                                   npm run test:e2e
 *
 * Without `E2E_SMOKE_LIVE=1` every spec skips cleanly (exit 0, reported as
 * skipped) instead of failing against a backend that is not there. This is
 * deliberate: smoke tests must never fake-pass, and must never fail for
 * missing live infrastructure.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
