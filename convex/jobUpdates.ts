import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCurrentUser, assertSameCompany } from "./lib/tenant";
import { planApply, planUndo } from "./lib/jobUpdates";

/**
 * One-click application of AI "suggested job updates" to the note's linked
 * job, with undo and dismiss. Suggestions are addressed by index plus their
 * field/value, so a list that changed since it was shown is refused.
 */

async function loadSuggestion(
  ctx: MutationCtx,
  args: { noteId: Id<"voiceNotes">; index: number; expectedField: string; expectedValue: string },
) {
  const user = await requireCurrentUser(ctx);
  const note = assertSameCompany(await ctx.db.get(args.noteId), user.companyId);
  const list = note.suggestedJobUpdates ?? [];
  const s = list[args.index];
  if (!s || s.field !== args.expectedField || s.value !== args.expectedValue) {
    throw new Error("This note's suggestions just changed — refresh and try again.");
  }
  return { user, note, list, s };
}

async function linkedJob(ctx: MutationCtx, note: Doc<"voiceNotes">, jobId?: Id<"jobs">) {
  const id = jobId ?? note.jobId;
  if (!id) throw new Error("Link this note to a job first.");
  return assertSameCompany(await ctx.db.get(id), note.companyId);
}

function noteLabel(note: Doc<"voiceNotes">) {
  const date = new Date(note.recordedAt).toISOString().slice(0, 10);
  return `Field note ${date}`;
}

const target = {
  noteId: v.id("voiceNotes"),
  index: v.number(),
  expectedField: v.string(),
  expectedValue: v.string(),
};

export const apply = mutation({
  args: { ...target, scheduledForMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user, note, list, s } = await loadSuggestion(ctx, args);
    if (s.appliedAt) throw new Error("Already applied.");
    const job = await linkedJob(ctx, note);
    const now = Date.now();
    const plan = planApply(s, job, {
      now,
      scheduledForMs: args.scheduledForMs,
      noteLabel: noteLabel(note),
    });
    await ctx.db.patch(job._id, { ...plan.patch, updatedAt: now });
    await ctx.db.patch(note._id, {
      suggestedJobUpdates: list.map((x, i) =>
        i === args.index
          ? {
              ...x,
              appliedAt: now,
              appliedBy: user._id,
              appliedJobId: job._id,
              previous: plan.previous,
              applied: plan.applied,
              dismissedAt: undefined,
            }
          : x,
      ),
      updatedAt: now,
    });
    return job._id;
  },
});

export const undo = mutation({
  args: target,
  handler: async (ctx, args) => {
    const { note, list, s } = await loadSuggestion(ctx, args);
    if (!s.appliedAt) throw new Error("Nothing to undo.");
    // Undo on the job it was applied to, even if the note was re-linked since.
    const job = await linkedJob(ctx, note, s.appliedJobId);
    const restore = planUndo(s, job);
    const now = Date.now();
    await ctx.db.patch(job._id, { ...restore, updatedAt: now });
    await ctx.db.patch(note._id, {
      suggestedJobUpdates: list.map((x, i) =>
        i === args.index
          ? { field: x.field, value: x.value, rationale: x.rationale }
          : x,
      ),
      updatedAt: now,
    });
    return job._id;
  },
});

export const dismiss = mutation({
  args: { ...target, dismissed: v.boolean() },
  handler: async (ctx, args) => {
    const { note, list, s } = await loadSuggestion(ctx, args);
    if (s.appliedAt) throw new Error("Undo it first — it's already applied.");
    await ctx.db.patch(note._id, {
      suggestedJobUpdates: list.map((x, i) =>
        i === args.index ? { ...x, dismissedAt: args.dismissed ? Date.now() : undefined } : x,
      ),
      updatedAt: Date.now(),
    });
    return note._id;
  },
});
