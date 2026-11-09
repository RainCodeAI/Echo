"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { digestDueDateKey, localTime } from "./lib/digest";
import { deliverDigest, type DigestPayload } from "./lib/digestDelivery";

/**
 * Hourly: send every daily digest that is due. Runs in Node so timezone
 * math has full ICU data. `now` is injectable for tests.
 */
export const runDueDigests = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ companyId: string; status: string }[]> => {
    const now = args.now ?? Date.now();
    const companies = await ctx.runQuery(internal.digest.candidates, {});
    const results: { companyId: string; status: string }[] = [];

    for (const c of companies) {
      const dateKey = digestDueDateKey(c, now);
      if (!dateKey) continue;
      const claimed: boolean = await ctx.runMutation(internal.digest.claim, {
        companyId: c.companyId,
        dateKey,
      });
      if (!claimed) continue;

      let status: string;
      try {
        const { timeZone } = localTime(now, c.timezone);
        const dateLabel = new Date(now).toLocaleDateString("en-US", {
          timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const p: DigestPayload | null = await ctx.runQuery(internal.digest.payload, {
          companyId: c.companyId,
          now,
          dateLabel,
        });
        status = p ? await deliverDigest(p, { force: false }) : "missing";
      } catch (err) {
        // One company's failure never blocks the others.
        status = `failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      await ctx.runMutation(internal.digest.recordStatus, { companyId: c.companyId, status });
      results.push({ companyId: c.companyId, status });
    }
    return results;
  },
});
