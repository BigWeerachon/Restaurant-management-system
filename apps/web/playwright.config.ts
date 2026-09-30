import { defineConfig } from "@playwright/test";
import { API_ENV, API_PORT, IS_API, WEB_PORT } from "./e2e/support/env";

/**
 * Browser tests, run against a production build in one of two modes (`E2E_MODE`):
 *   demo — the app on its in-browser data, no server (what is on Vercel);
 *   api  — the app connected to the real API and a seeded Postgres.
 * The mode is baked into the web build (`NEXT_PUBLIC_*`), so the build comes first — see `scripts/e2e.sh`, which is
 * also what CI runs. Specs named `*.api.spec.ts` / `*.demo.spec.ts` run in that mode only; the rest run in both.
 * Files run in name order on one worker: in API mode they share one database, and each starts from what it needs.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: IS_API ? "**/*.demo.spec.ts" : "**/*.api.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }], ["github"]] : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    reducedMotion: "reduce",
    viewport: { width: 1280, height: 860 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // CI downloads Playwright's own Chromium; a machine that already has one points here.
    launchOptions: { executablePath: process.env.CHROME_PATH || undefined },
  },
  webServer: [
    ...(IS_API
      ? [
          {
            command: "node ../api/dist/server.js",
            url: `http://localhost:${API_PORT}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            env: { PORT: String(API_PORT), CORS_ORIGINS: `http://localhost:${WEB_PORT}`, ...API_ENV },
          },
        ]
      : []),
    {
      command: `pnpm exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
