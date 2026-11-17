import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { convexRun, type Seed } from "./convex";

/** Seed a fresh workspace on the local backend; specs read it from .seed.json. */
export default function globalSetup() {
  const seed = convexRun<Seed>("e2e:seed");
  writeFileSync(join(__dirname, ".seed.json"), JSON.stringify(seed));
  console.log(`E2E workspace ${seed.companyId}`);
}
