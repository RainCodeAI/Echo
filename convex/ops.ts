import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { evaluateConfig } from "./lib/configCheck";
import { checkBudget } from "./aiUsage";
import { restoreWorkspace, scheduleDeletion } from "./privacy";

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

/**
 * Workspaces waiting to be deleted (or being deleted), soonest first.
 *
 *   npx convex run ops:pendingDeletions --prod
 */
export const pendingDeletions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const companies = await ctx.db.query("companies").take(5_000);
    return companies
      .filter((c) => c.deletionRequestedAt)
      .map((c) => ({
        companyId: c._id,
        name: c.name,
        requestedAt: new Date(c.deletionRequestedAt!).toISOString(),
        scheduledFor: c.deletionScheduledFor ? new Date(c.deletionScheduledFor).toISOString() : null,
        started: !!c.deletionStartedAt || !c.deletionScheduledFor,
      }))
      .sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));
  },
});

/**
 * Restore a workspace during its grace period when the owner can't (e.g. they
 * lost access to their sign-in). Confirm the request came from the owner first.
 *
 *   npx convex run ops:cancelWorkspaceDeletion '{"companyId":"..."}' --prod
 */
export const cancelWorkspaceDeletion = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => ({ restored: await restoreWorkspace(ctx, companyId) }),
});

/**
 * Delete a workspace on the owner's behalf, or re-apply a deletion after a
 * backup restore (docs/BACKUP_RESTORE.md). `graceDays` defaults to 0: the
 * purge starts right away. Refuses if removal is already under way.
 *
 *   npx convex run ops:scheduleWorkspaceDeletion '{"companyId":"...","graceDays":0}' --prod
 */
export const scheduleWorkspaceDeletion = internalMutation({
  args: { companyId: v.id("companies"), graceDays: v.optional(v.number()) },
  handler: async (ctx, { companyId, graceDays }) => {
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Company not found (already deleted?).");
    if (company.deletionStartedAt) throw new Error("Data removal is already under way.");
    const days = graceDays ?? 0;
    if (!Number.isFinite(days) || days < 0 || days > 30) throw new Error("graceDays must be between 0 and 30.");
    const scheduledFor = await scheduleDeletion(ctx, company, { graceMs: days * 24 * 60 * 60 * 1000 });
    return { scheduledFor: new Date(scheduledFor).toISOString() };
  },
});
