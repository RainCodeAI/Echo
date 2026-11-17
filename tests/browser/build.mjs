/**
 * Builds the browser-test fixture pages: each fixtures/*.tsx becomes
 * .out/<name>.js (real app components + a fake Convex client), and the app's
 * Tailwind CSS is built once to .out/app.css. Run by the Playwright webServer.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, ".out");
const shims = join(here, "fixtures", "shims");
mkdirSync(out, { recursive: true });

const entries = readdirSync(join(here, "fixtures"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => join(here, "fixtures", f));

await build({
  entryPoints: entries,
  outdir: out,
  bundle: true,
  format: "iife",
  jsx: "automatic",
  tsconfig: join(root, "tsconfig.json"),
  alias: {
    "next/link": join(shims, "link.tsx"),
    "next/navigation": join(shims, "navigation.ts"),
    "next/image": join(shims, "image.tsx"),
    "@clerk/nextjs": join(shims, "clerk.ts"),
  },
  // Components read a few NEXT_PUBLIC_* values; give them an empty env.
  banner: { js: "var process = { env: { NODE_ENV: 'production' } };" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

execFileSync(
  join(root, "node_modules", ".bin", "tailwindcss"),
  ["-i", "app/globals.css", "-o", join(out, "app.css"), "--content", "./components/**/*.tsx,./app/**/*.tsx,./tests/browser/fixtures/**/*.tsx"],
  { cwd: root, stdio: "pipe" },
);
console.log(`built ${entries.length} fixture pages`);
