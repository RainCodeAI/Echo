import { defineConfig } from "vitest/config";

/**
 * Vitest config for Echo.
 *
 * Tests target pure logic (crypto helpers, token sign/verify, AI sanitize) and
 * run in a Node environment — no jsdom needed. Convex functions themselves are
 * not exercised here; these guard the framework-independent building blocks.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
