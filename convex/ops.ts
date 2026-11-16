import { internalQuery } from "./_generated/server";
import { evaluateConfig } from "./lib/configCheck";

/**
 * Operator-only diagnostics. Internal functions cannot be called from the
 * browser — only via the Convex CLI/dashboard by someone with deploy access.
 *
 *   npx convex run ops:checkConfig --prod
 */
export const checkConfig = internalQuery({
  args: {},
  handler: async () => evaluateConfig(process.env),
});
