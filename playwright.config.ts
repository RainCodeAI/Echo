import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests: real app components rendered in fixture pages with a fake
 * Convex client (tests/browser). No Convex deployment or Clerk needed.
 * Run: npm run test:browser
 */
const PORT = Number(process.env.BROWSER_TEST_PORT ?? 4700);

export default defineConfig({
  testDir: "tests/browser/specs",
  outputDir: "tests/browser/.results",
  // The crew-page specs share one mock backend, so run specs one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "node tests/browser/build.mjs && node tests/browser/server.mjs",
    url: `http://127.0.0.1:${PORT}/__state`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
