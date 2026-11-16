import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { evaluateConfig } from "./lib/configCheck";
import { checkBudget } from "./aiUsage";

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

/**
 * Set one company's monthly AI budget (USD). `null` = use the deployment
 * default (AI_MONTHLY_BUDGET_USD); 0 pauses AI for that company.
 *
 *   npx convex run ops:setAiBudget '{"companyId":"...","monthlyUsd":50}' --prod
 */
export const setAiBudget = internalMutation({
  args: { companyId: v.id("companies"), monthlyUsd: v.union(v.number(), v.null()) },
  handler: async (ctx, { companyId, monthlyUsd }) => {
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Company not found.");
    if (monthlyUsd !== null && (!Number.isFinite(monthlyUsd) || monthlyUsd < 0 || monthlyUsd > 10_000)) {
      throw new Error("monthlyUsd must be between 0 and 10000, or null for the default.");
    }
    await ctx.db.patch(companyId, { aiMonthlyBudgetUsd: monthlyUsd ?? undefined, updatedAt: Date.now() });
    return await checkBudget(ctx, companyId);
  },
});

/** This month's AI usage for one company (or check before raising a budget). */
export const aiUsageFor = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => checkBudget(ctx, companyId),
});
