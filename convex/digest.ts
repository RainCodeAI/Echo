import {
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  DIGEST_PERIOD_MS,
  buildDigestEmail,
  computeDigestStats,
  isQuietDay,
  type DigestNote,
} from "./lib/digest";
import { deliverDigest, type DigestPayload } from "./lib/digestDelivery";

/**
 * Daily digest data + sending. Scheduling (timezone math) lives in the
 * "use node" runner, convex/digestRunner.ts, called by an hourly cron.
 */

const MAX_PERIOD_NOTES = 500;

async function digestEmailRecipient(ctx: QueryCtx, company: Doc<"companies">) {
  if (company.notificationEmail) return company.notificationEmail;
  const users = await ctx.db
    .query("users")
    .withIndex("by_company", (q) => q.eq("companyId", company._id))
    .collect();
  return users.find((u) => u.role === "owner" && u.email)?.email ?? null;
}

/** Companies with the digest switched on (the runner decides who's due). */
export const candidates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const companies = await ctx.db
      .query("companies")
      .withIndex("by_digest_enabled", (q) => q.eq("digestEnabled", true))
      .collect();
    return companies.map((c) => ({
      companyId: c._id,
      digestEnabled: true as const,
      digestHour: c.digestHour,
      timezone: c.timezone,
      lastDigestDateKey: c.lastDigestDateKey,
    }));
  },
});

/** Atomically claim today's digest. False if already claimed (or turned off). */
export const claim = internalMutation({
  args: { companyId: v.id("companies"), dateKey: v.string() },
  handler: async (ctx, { companyId, dateKey }) => {
    const company = await ctx.db.get(companyId);
    if (!company?.digestEnabled || company.lastDigestDateKey === dateKey) return false;
    await ctx.db.patch(companyId, { lastDigestDateKey: dateKey, lastDigestAt: Date.now() });
    return true;
  },
});

/** Build the digest for the 24 hours before `now`. */
export const payload = internalQuery({
  args: { companyId: v.id("companies"), now: v.number(), dateLabel: v.string() },
  handler: async (ctx, { companyId, now, dateLabel }): Promise<DigestPayload | null> => {
    const company = await ctx.db.get(companyId);
    if (!company) return null;

    const periodNotes = await ctx.db
      .query("voiceNotes")
      .withIndex("by_company_and_created", (q) =>
        q.eq("companyId", companyId).gt("createdAt", now - DIGEST_PERIOD_MS),
      )
      .order("desc")
      .take(MAX_PERIOD_NOTES);
    const [ready, processing] = await Promise.all(
      (["ready", "processing"] as const).map((status) =>
        ctx.db
          .query("voiceNotes")
          .withIndex("by_company_and_status", (q) =>
            q.eq("companyId", companyId).eq("status", status),
          )
          .take(1000),
      ),
    );

    const names = new Map<string, string | null>();
    const lookup = async (id: Id<"teamMembers"> | Id<"jobs"> | undefined) => {
      if (!id) return null;
      if (!names.has(id)) {
        const doc = await ctx.db.get(id);
        names.set(
          id,
          doc && doc.companyId === companyId
            ? "title" in doc
              ? doc.title
              : doc.name
            : null,
        );
      }
      return names.get(id) ?? null;
    };
    const notes: DigestNote[] = [];
    for (const n of periodNotes) {
      notes.push({
        _id: n._id,
        createdAt: n.createdAt,
        status: n.status,
        aiStatus: n.aiStatus,
        teamMemberId: n.teamMemberId,
        crewName: await lookup(n.teamMemberId),
        jobTitle: await lookup(n.jobId),
        aiTitle: n.aiTitle,
        rawTranscript: n.rawTranscript,
        urgency: n.urgency,
        workerFlaggedUrgent: n.workerFlaggedUrgent,
        materials: n.materials,
        actionItems: n.actionItems,
      });
    }

    const stats = computeDigestStats(notes, ready.length + processing.length);
    const appUrl = process.env.APP_URL?.replace(/\/$/, "") || null;
    return {
      companyName: company.name,
      recipient: await digestEmailRecipient(ctx, company),
      quiet: isQuietDay(stats),
      email: buildDigestEmail({ companyName: company.name, dateLabel, stats, appUrl }),
    };
  },
});

export const recordStatus = internalMutation({
  args: { companyId: v.id("companies"), status: v.string() },
  handler: async (ctx, { companyId, status }) => {
    await ctx.db.patch(companyId, { lastDigestStatus: status.slice(0, 300) });
  },
});

export const ownerCompany = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    if (!user) throw new Error("Not authenticated.");
    if (user.role !== "owner") throw new Error("Only the workspace owner can do that.");
    return user.companyId;
  },
});

/** Settings → "Send digest now": preview today's digest (owner only, even if quiet). */
export const sendNow = action({
  args: {},
  handler: async (ctx): Promise<{ status: string; subject: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const companyId: Id<"companies"> = await ctx.runQuery(internal.digest.ownerCompany, {
      clerkUserId: identity.subject,
    });
    const now = Date.now();
    const p: DigestPayload | null = await ctx.runQuery(internal.digest.payload, {
      companyId,
      now,
      dateLabel: new Date(now).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    });
    if (!p) throw new Error("Not found");
    const status = await deliverDigest(p, { force: true });
    return { status, subject: p.email.subject };
  },
});
