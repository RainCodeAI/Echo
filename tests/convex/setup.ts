/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../../convex/schema";

/** Every Convex module, loaded lazily by convex-test. */
export const modules = import.meta.glob("../../convex/**/*.*s");

export function makeTest() {
  return convexTest(schema, modules);
}
