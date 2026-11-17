import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { evaluateConfig } from "./lib/configCheck";
import { checkBudget } from "./aiUsage";
import { restoreWorkspace, scheduleDeletion } from "./privacy";
import { AI_STALE_MS } from "./voiceNotes";
import { sendEmail } from "./lib/alertProviders";
import { evaluateHealth, opsRecipients, renderOpsEmail, type CompanyHealth, type HealthReport } from "./lib/opsReport";

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

// --- Health report ------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const BUDGET_SKIP = /AI limit|AI is paused/i;

/**
 * Snapshot of every workspace over the last `windowHours` (default 24):
 * notes, AI failures and stuck runs, alert/digest failures, AI spend, pending
 * deletions and config problems. Counts and ids only.
 *
 *   npx convex run ops:health --prod
 *   npx convex run ops:health '{"windowHours":168}' --prod
 */
export const health = internalQuery({
  args: { windowHours: v.optional(v.number()) },
  handler: async (ctx, { windowHours }): Promise<HealthReport> => {
    const now = Date.now();
    const windowMs = Math.min(Math.max(windowHours ?? 24, 1), 24 * 31) * HOUR;
    const since = now - windowMs;
    const companies: CompanyHealth[] = [];

    for (const c of await ctx.db.query("companies").take(2_000)) {
      const notes = await ctx.db
        .query("voiceNotes")
        .withIndex("by_company_and_created", (q) => q.eq("companyId", c._id).gte("createdAt", since))
        .take(5_000);
      let stuck = 0;
      for (const status of ["pending", "processing"] as const) {
        const open = await ctx.db
          .query("voiceNotes")
          .withIndex("by_company_and_ai_status", (q) => q.eq("companyId", c._id).eq("aiStatus", status))
          .take(500);
        stuck += open.filter((n) => (n.aiStartedAt ?? n.createdAt) < now - AI_STALE_MS).length;
      }
      const last = await ctx.db
        .query("voiceNotes")
        .withIndex("by_company_and_created", (q) => q.eq("companyId", c._id))
        .order("desc")
        .first();
      const alerts = (
        await ctx.db
          .query("alerts")
          .withIndex("by_company_and_created", (q) => q.eq("companyId", c._id).gte("createdAt", since))
          .take(2_000)
      ).filter((a) => !a.isTest);
      const budget = await checkBudget(ctx, c._id, now);
      const failed = notes.filter((n) => n.aiStatus === "failed");
      const skipped = failed.filter((n) => BUDGET_SKIP.test(n.aiErrorMessage ?? "")).length;

      companies.push({
        companyId: c._id,
        name: c.name,
        createdAt: c.createdAt,
        notes: notes.length,
        aiFailed: failed.length - skipped,
        aiSkippedBudget: skipped,
        aiStuck: stuck,
        alertsSent: alerts.filter((a) => a.status === "sent").length,
        alertsFailed: alerts.filter((a) => a.status === "failed").length,
        digestStatus: c.lastDigestAt && c.lastDigestAt >= since ? (c.lastDigestStatus ?? null) : null,
        aiSpentMicros: budget.spentMicros,
        aiBudgetUsd: budget.budgetUsd,
        aiBudgetLevel: budget.level,
        lastNoteAt: last?.createdAt ?? null,
        deletion: c.deletionRequestedAt
          ? { scheduledFor: c.deletionScheduledFor ?? null, started: !!c.deletionStartedAt || !c.deletionScheduledFor }
          : null,
      });
    }

    const config = evaluateConfig(process.env);
    return evaluateHealth({
      now,
      windowMs,
      companies,
      config: {
        ready: config.ready,
        failing: config.checks.filter((c) => !c.ok).map(({ name, level, detail }) => ({ name, level, detail })),
      },
    });
  },
});

/**
 * Daily ops email to OPS_EMAIL (cron in convex/crons.ts). Sent every day,
 * even when all is well: if it stops arriving, that's a signal too. Also
 * logs a one-line `[ops-health]` summary for log streams.
 *
 *   npx convex run ops:sendDailyReport --prod     (send one now)
 */
export const sendDailyReport = internalAction({
  args: {},
  handler: async (ctx): Promise<{ status: HealthReport["status"]; sent: number; detail?: string }> => {
    const report: HealthReport = await ctx.runQuery(internal.ops.health, {});
    const t = report.totals;
    console.log(
      `[ops-health] status=${report.status} issues=${report.issues.length} workspaces=${t.workspaces} notes=${t.notes} ` +
        `aiFailed=${t.aiFailed} aiStuck=${t.aiStuck} alertsFailed=${t.alertsFailed}`,
    );
    const to = opsRecipients(process.env.OPS_EMAIL);
    if (to.length === 0) return { status: report.status, sent: 0, detail: "OPS_EMAIL not set." };

    const deployment = process.env.CONVEX_CLOUD_URL ?? "unknown deployment";
    const msg = renderOpsEmail(report, deployment);
    let sent = 0;
    const errors: string[] = [];
    for (const addr of to) {
      const res = await sendEmail({ to: addr, ...msg }, process.env);
      if (res.status === "sent") sent++;
      else errors.push(`${res.status}: ${res.detail}`);
    }
    if (errors.length) console.error(`[ops-health] email: ${errors.join(" | ")}`);
    return { status: report.status, sent, detail: errors[0] };
  },
});
