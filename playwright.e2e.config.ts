import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: the real Next.js app against a real (local, throwaway)
 * Convex backend. Run in CI by .github/workflows/e2e.yml, which starts the
 * backend (scripts/e2e/start-convex.sh) and builds the app first.
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/e2e/.results",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  webServer: {
    command: "npx next start -p 3000 -H 127.0.0.1",
    // A static file: skips the Clerk middleware, which can stall on placeholder keys.
    url: "http://127.0.0.1:3000/manifest.webmanifest",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
