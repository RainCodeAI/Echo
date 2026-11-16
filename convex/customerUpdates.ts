import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertSameCompany, requireCurrentUser } from "./lib/tenant";
import {
  DEFAULT_LOOKBACK_MS,
  DRAFTS_PER_HOUR,
  MAX_EMAIL_CHARS,
  MAX_SUBJECT_CHARS,
  MAX_TEXT_CHARS,
  selectNotes,
  type DraftContext,
} from "./lib/customerUpdate";

/**
 * Customer-update drafts: the AI writes a homeowner-friendly progress update
 * from a job's recent notes; the owner edits it and sends it from their own
 * phone or email. See ARCHITECTURE §11f.
 */

const HOUR = 60 * 60 * 1000;
/** A draft still "generating" after this is treated as failed. */
const GENERATING_TIMEOUT_MS = 3 * 60 * 1000;

const noteSummary = (n: Doc<"voiceNotes">) => (n.aiSummary?.trim() || n.rawTranscript.trim()).slice(0, 2_000);

async function jobUpdates(ctx: QueryCtx, job: Doc<"jobs">) {
  return await ctx.db
    .query("customerUpdates")
    .withIndex("by_company_and_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .order("desc")
    .take(50);
}

async function customerFor(ctx: QueryCtx, job: Doc<"jobs">, note: Doc<"voiceNotes"> | null) {
  const leadId = job.leadId ?? note?.leadId;
  if (!leadId) return null;
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.companyId !== job.companyId) return null;
  return { name: lead.customerName, phone: lead.phone ?? null, email: lead.email ?? null };
}

const lastSentAt = (updates: Doc<"customerUpdates">[]) =>
  Math.max(0, ...updates.filter((u) => u.status === "sent").map((u) => u.sentAt ?? 0));

/** Start an AI draft from this note (and the job's other recent notes). */
export const requestDraft = mutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, args): Promise<Id<"customerUpdates">> => {
    const user = await requireCurrentUser(ctx);
    const note = assertSameCompany(await ctx.db.get(args.noteId), user.companyId);
    if (!note.jobId) throw new Error("Link this note to a job first.");
    const job = assertSameCompany(await ctx.db.get(note.jobId), user.companyId);
    const now = Date.now();

    const updates = await jobUpdates(ctx, job);
    if (updates.some((u) => u.status === "generating" && now - u.createdAt < GENERATING_TIMEOUT_MS)) {
      throw new Error("A draft is already being written for this job.");
    }
    const recent = await ctx.db
      .query("customerUpdates")
      .withIndex("by_company_and_created", (q) => q.eq("companyId", user.companyId).gte("createdAt", now - HOUR))
      .take(DRAFTS_PER_HOUR);
    if (recent.length >= DRAFTS_PER_HOUR) {
      throw new Error("That's a lot of drafts this hour. Try again a bit later.");
    }

    // One open draft per job: starting over replaces the old one.
    for (const u of updates) {
      if (u.status === "draft" || u.status === "failed" || u.status === "generating") {
        await ctx.db.patch(u._id, { status: "discarded", updatedAt: now });
      }
    }

    const since = lastSentAt(updates) || now - DEFAULT_LOOKBACK_MS;
    const jobNotes = (
      await ctx.db
        .query("voiceNotes")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .order("desc")
        .take(50)
    ).filter((n) => n.companyId === user.companyId && n.status !== "archived" && noteSummary(n));
    const chosen = selectNotes(
      jobNotes.map((n) => ({ noteId: n._id, recordedAt: n.recordedAt })),
      { startNoteId: note._id, since },
    );
    if (!chosen.some((c) => c.noteId === note._id)) chosen.push({ noteId: note._id, recordedAt: note.recordedAt });

    const updateId = await ctx.db.insert("customerUpdates", {
      companyId: user.companyId,
      jobId: job._id,
      noteId: note._id,
      sourceNoteIds: chosen.map((c) => c.noteId as Id<"voiceNotes">),
      status: "generating",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.customerUpdatesAi.generate, { updateId });
    return updateId;
  },
});

/** What the note page shows: the job's customer and its current update. */
export const forNote = query({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const note = assertSameCompany(await ctx.db.get(args.noteId), user.companyId);
    if (!note.jobId) return { job: null, customer: null, current: null, lastSentAt: null };
    const job = await ctx.db.get(note.jobId);
    if (!job || job.companyId !== user.companyId) return { job: null, customer: null, current: null, lastSentAt: null };

    const updates = await jobUpdates(ctx, job);
    const latest = updates.find((u) => u.status !== "discarded") ?? null;
    const now = Date.now();
    const current = latest
      ? {
          id: latest._id,
          status:
            latest.status === "generating" && now - latest.createdAt > GENERATING_TIMEOUT_MS
              ? ("failed" as const)
              : latest.status,
          text: latest.text ?? "",
          emailSubject: latest.emailSubject ?? "",
          emailBody: latest.emailBody ?? "",
          error:
            latest.status === "generating" && now - latest.createdAt > GENERATING_TIMEOUT_MS
              ? "Writing the draft took too long. Try again."
              : (latest.error ?? null),
          sentVia: latest.sentVia ?? null,
          sentAt: latest.sentAt ?? null,
          noteCount: latest.sourceNoteIds.length,
          createdAt: latest.createdAt,
        }
      : null;
    const sent = lastSentAt(updates);
    return {
      job: { id: job._id, title: job.title },
      customer: await customerFor(ctx, job, note),
      current,
      lastSentAt: sent || null,
    };
  },
});

async function loadUpdate(ctx: QueryCtx, updateId: Id<"customerUpdates">) {
  const user = await requireCurrentUser(ctx);
  return { user, update: assertSameCompany(await ctx.db.get(updateId), user.companyId) };
}

/** Owner edits to the draft before sending. */
export const updateDraft = mutation({
  args: {
    updateId: v.id("customerUpdates"),
    text: v.optional(v.string()),
    emailSubject: v.optional(v.string()),
    emailBody: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { update } = await loadUpdate(ctx, args.updateId);
    if (update.status !== "draft") throw new Error("This update can't be edited any more.");
    await ctx.db.patch(update._id, {
      ...(args.text !== undefined ? { text: args.text.slice(0, MAX_TEXT_CHARS) } : {}),
      ...(args.emailSubject !== undefined
        ? { emailSubject: args.emailSubject.replace(/\n/g, " ").slice(0, MAX_SUBJECT_CHARS) }
        : {}),
      ...(args.emailBody !== undefined ? { emailBody: args.emailBody.slice(0, MAX_EMAIL_CHARS) } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** The owner sent it (from their phone/email app). Records it; sends nothing. */
export const markSent = mutation({
  args: {
    updateId: v.id("customerUpdates"),
    via: v.union(v.literal("text"), v.literal("email"), v.literal("other")),
  },
  handler: async (ctx, args) => {
    const { user, update } = await loadUpdate(ctx, args.updateId);
    if (update.status === "sent") return null;
    if (update.status !== "draft") throw new Error("Only a finished draft can be marked as sent.");
    const now = Date.now();
    await ctx.db.patch(update._id, { status: "sent", sentVia: args.via, sentAt: now, sentBy: user._id, updatedAt: now });
    return null;
  },
});

/** "I didn't actually send it": back to a draft. */
export const undoSent = mutation({
  args: { updateId: v.id("customerUpdates") },
  handler: async (ctx, args) => {
    const { update } = await loadUpdate(ctx, args.updateId);
    if (update.status !== "sent") throw new Error("This update isn't marked as sent.");
    await ctx.db.patch(update._id, {
      status: "draft",
      sentVia: undefined,
      sentAt: undefined,
      sentBy: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const discard = mutation({
  args: { updateId: v.id("customerUpdates") },
  handler: async (ctx, args) => {
    const { update } = await loadUpdate(ctx, args.updateId);
    if (update.status === "sent") throw new Error("Already sent. Undo that first.");
    await ctx.db.patch(update._id, { status: "discarded", updatedAt: Date.now() });
    return null;
  },
});

// --- Internal: used by the AI action -------------------------------------

export const draftContext = internalQuery({
  args: { updateId: v.id("customerUpdates") },
  handler: async (ctx, args): Promise<DraftContext | null> => {
    const update = await ctx.db.get(args.updateId);
    if (!update || update.status !== "generating") return null;
    const [company, job, startNote] = await Promise.all([
      ctx.db.get(update.companyId),
      ctx.db.get(update.jobId),
      ctx.db.get(update.noteId),
    ]);
    if (!company || !job || job.companyId !== update.companyId) return null;
    const notes = [];
    for (const id of update.sourceNoteIds) {
      const n = await ctx.db.get(id);
      if (!n || n.companyId !== update.companyId) continue;
      notes.push({
        noteId: n._id,
        recordedAt: n.recordedAt,
        summary: noteSummary(n),
        timelineNotes: n.timelineNotes,
      });
    }
    const customer = await customerFor(ctx, job, startNote);
    return {
      companyName: company.name,
      customerName: customer?.name ?? null,
      jobTitle: job.title,
      address: job.address ?? null,
      notes: notes.sort((a, b) => a.recordedAt - b.recordedAt),
      timeZone: company.timezone,
    };
  },
});

export const saveDraft = internalMutation({
  args: {
    updateId: v.id("customerUpdates"),
    text: v.string(),
    emailSubject: v.string(),
    emailBody: v.string(),
  },
  handler: async (ctx, args) => {
    const update = await ctx.db.get(args.updateId);
    // Discarded or replaced while the AI was writing: drop the result.
    if (!update || update.status !== "generating") return null;
    await ctx.db.patch(update._id, {
      status: "draft",
      text: args.text,
      emailSubject: args.emailSubject,
      emailBody: args.emailBody,
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const failDraft = internalMutation({
  args: { updateId: v.id("customerUpdates"), error: v.string() },
  handler: async (ctx, args) => {
    const update = await ctx.db.get(args.updateId);
    if (!update || update.status !== "generating") return null;
    await ctx.db.patch(update._id, { status: "failed", error: args.error.slice(0, 300), updatedAt: Date.now() });
    return null;
  },
});
