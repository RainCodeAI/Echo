import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser, requireOwner } from "./lib/tenant";
import { computeSteps, SAMPLE_NOTE } from "./lib/onboarding";

/**
 * Getting-started checklist for new workspaces, plus a sample note to
 * explore before any crew records. See ARCHITECTURE §11j.
 */

const NOTE_SCAN = 50;

export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const company = await ctx.db.get(user.companyId);
    if (!company) return null;
    const [crew, notes] = await Promise.all([
      ctx.db
        .query("teamMembers")
        .withIndex("by_company_and_active", (q) => q.eq("companyId", company._id).eq("isActive", true))
        .take(1),
      ctx.db
        .query("voiceNotes")
        .withIndex("by_company_and_created", (q) => q.eq("companyId", company._id))
        .order("desc")
        .take(NOTE_SCAN),
    ]);
    const sample = notes.find((n) => n.isSample);
    const result = computeSteps({
      companyName: company.name,
      primaryTrade: company.primaryTrade,
      activeCrew: crew.length,
      sharedAt: company.onboardingSharedAt,
      crewNotes: notes.filter((n) => !n.isSample && n.teamMemberId).length,
      alertsOn: !!company.notificationsEnabled,
    });
    return {
      ...result,
      isOwner: user.role === "owner",
      dismissed: !!company.onboardingDismissedAt,
      sampleNoteId: sample?._id ?? null,
    };
  },
});

/** The owner printed the poster or shared the crew link. */
export const markShared = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const company = await ctx.db.get(user.companyId);
    if (company && !company.onboardingSharedAt) {
      await ctx.db.patch(company._id, { onboardingSharedAt: Date.now() });
    }
    return null;
  },
});

export const setDismissed = mutation({
  args: { dismissed: v.boolean() },
  handler: async (ctx, { dismissed }) => {
    const user = await requireOwner(ctx);
    await ctx.db.patch(user.companyId, { onboardingDismissedAt: dismissed ? Date.now() : undefined });
    return null;
  },
});

/** Create (or return) the workspace's sample note. No AI is called. */
export const createSampleNote = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const existing = (
      await ctx.db
        .query("voiceNotes")
        .withIndex("by_company_and_created", (q) => q.eq("companyId", user.companyId))
        .order("desc")
        .take(NOTE_SCAN)
    ).find((n) => n.isSample);
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("voiceNotes", {
      companyId: user.companyId,
      recordedBy: user._id,
      isSample: true,
      status: "ready",
      rawTranscript: SAMPLE_NOTE.rawTranscript,
      transcriptSource: "manual",
      recordedAt: now,
      aiStatus: "completed",
      aiTitle: SAMPLE_NOTE.aiTitle,
      aiSummary: SAMPLE_NOTE.aiSummary,
      materials: SAMPLE_NOTE.materials,
      actionItems: SAMPLE_NOTE.actionItems,
      urgency: SAMPLE_NOTE.urgency,
      timelineNotes: SAMPLE_NOTE.timelineNotes,
      tags: SAMPLE_NOTE.tags,
      aiConfidence: 0.9,
      aiProcessedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});
