import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * convex/_generated/api.d.ts is maintained by hand in this repo between real
 * codegen runs (codegen needs a deployment). This keeps it in step with the
 * actual modules, the way `npx convex dev` would.
 */
const convexDir = join(__dirname, "..", "convex");
const NOT_MODULES = new Set(["schema.ts", "auth.config.ts"]);

function moduleFiles(): string[] {
  const top = readdirSync(convexDir).filter((f) => f.endsWith(".ts") && !NOT_MODULES.has(f));
  const lib = readdirSync(join(convexDir, "lib"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `lib/${f}`);
  return [...top, ...lib].map((f) => f.replace(/\.ts$/, "")).sort();
}

describe("generated API types", () => {
  it("import every Convex module and nothing else", () => {
    const api = readFileSync(join(convexDir, "_generated", "api.d.ts"), "utf8");
    const imported = [...api.matchAll(/^import type \* as \w+ from "\.\.\/(.+)\.js";$/gm)].map((m) => m[1]).sort();
    const listed = [...api.matchAll(/^ {2}"?([\w/]+)"?: typeof \w+;$/gm)].map((m) => m[1]).sort();
    expect(imported).toEqual(moduleFiles());
    expect(listed).toEqual(moduleFiles());
  });
});
