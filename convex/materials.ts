import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertSameCompany, requireCurrentUser } from "./lib/tenant";
import { buildOrderList, sourceKey, type SourceNote } from "./lib/orderList";

/**
 * Materials → order list: everything crews said they need for a job, merged
 * across its notes, minus what the office already marked as ordered.
 */

const NOTES_PER_JOB = 500;
const OVERVIEW_NOTE_SCAN = 500;
const MAX_LINES_PER_ORDER = 200;

const noteTitle = (n: Doc<"voiceNotes">) =>
  n.aiTitle?.trim() || n.rawTranscript.trim().slice(0, 60) || "Untitled note";

async function crewNames(ctx: QueryCtx, notes: Doc<"voiceNotes">[], companyId: Id<"companies">) {
  const names = new Map<string, string | null>();
  for (const n of notes) {
    if (!n.teamMemberId || names.has(n.teamMemberId)) continue;
    const m = await ctx.db.get(n.teamMemberId);
    names.set(n.teamMemberId, m && m.companyId === companyId ? m.name : null);
  }
  return names;
}

function toSources(notes: Doc<"voiceNotes">[], names: Map<string, string | null>): SourceNote[] {
  return notes.map((n) => ({
    noteId: n._id,
    recordedAt: n.recordedAt,
    noteTitle: noteTitle(n),
    crewName: n.teamMemberId ? (names.get(n.teamMemberId) ?? null) : null,
    materials: n.materials ?? [],
  }));
}

const hasMaterials = (n: Doc<"voiceNotes">) => n.status !== "archived" && (n.materials?.length ?? 0) > 0;

async function jobSources(ctx: QueryCtx, job: Doc<"jobs">) {
  const notes = (
    await ctx.db
      .query("voiceNotes")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .order("desc")
      .take(NOTES_PER_JOB)
  ).filter((n) => n.companyId === job.companyId && hasMaterials(n));
  return toSources(notes, await crewNames(ctx, notes, job.companyId));
}

async function jobOrders(ctx: QueryCtx, job: Doc<"jobs">) {
  return await ctx.db
    .query("materialOrders")
    .withIndex("by_company_and_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .order("desc")
    .collect();
}

const coveredBy = (orders: Doc<"materialOrders">[]) => new Set(orders.flatMap((o) => o.covers));

/** Jobs with materials mentioned in notes, and how much is still to order. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const recent = await ctx.db
      .query("voiceNotes")
      .withIndex("by_company_and_created", (q) => q.eq("companyId", user.companyId))
      .order("desc")
      .take(OVERVIEW_NOTE_SCAN);
    const withMaterials = recent.filter(hasMaterials);
    const unlinkedNotes = withMaterials.filter((n) => !n.jobId).length;

    const byJob = new Map<Id<"jobs">, Doc<"voiceNotes">[]>();
    for (const n of withMaterials) {
      if (!n.jobId) continue;
      byJob.set(n.jobId, [...(byJob.get(n.jobId) ?? []), n]);
    }

    const jobs = [];
    for (const [jobId, notes] of byJob) {
      const job = await ctx.db.get(jobId);
      if (!job || job.companyId !== user.companyId) continue;
      const orders = await jobOrders(ctx, job);
      const { toOrder, ordered } = buildOrderList(toSources(notes, new Map()), coveredBy(orders));
      jobs.push({
        jobId,
        title: job.title,
        status: job.status,
        address: job.address ?? null,
        toOrder: toOrder.length,
        ordered: ordered.length,
        noteCount: notes.length,
        lastNoteAt: Math.max(...notes.map((n) => n.recordedAt)),
      });
    }
    jobs.sort((a, b) => Number(b.toOrder > 0) - Number(a.toOrder > 0) || b.lastNoteAt - a.lastNoteAt);
    return { jobs, unlinkedNotes };
  },
});

/** One job's order list, what's already ordered, and the order history. */
export const forJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const job = assertSameCompany(await ctx.db.get(args.jobId), user.companyId);
    const company = await ctx.db.get(user.companyId);
    const orders = await jobOrders(ctx, job);
    const { toOrder, ordered } = buildOrderList(await jobSources(ctx, job), coveredBy(orders));

    const history = [];
    for (const o of orders) {
      const by = await ctx.db.get(o.createdBy);
      history.push({
        orderId: o._id,
        createdAt: o.createdAt,
        createdByName: by && by.companyId === user.companyId ? by.name : null,
        lines: o.lines,
      });
    }
    return {
      job: { id: job._id, title: job.title, status: job.status, address: job.address ?? null },
      companyName: company?.name ?? null,
      toOrder,
      ordered,
      history,
    };
  },
});

/**
 * Record that the office ordered these lines. The client sends what it showed
 * (key + quantity); if the list changed since, nothing is recorded.
 */
export const markOrdered = mutation({
  args: {
    jobId: v.id("jobs"),
    lines: v.array(v.object({ key: v.string(), quantityLabel: v.string() })),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const job = assertSameCompany(await ctx.db.get(args.jobId), user.companyId);
    if (args.lines.length === 0) throw new Error("Pick at least one item.");
    if (args.lines.length > MAX_LINES_PER_ORDER) throw new Error("Too many items in one order.");

    const orders = await jobOrders(ctx, job);
    const { toOrder } = buildOrderList(await jobSources(ctx, job), coveredBy(orders));
    const current = new Map(toOrder.map((l) => [l.key, l]));
    const picked = args.lines.map((want) => {
      const line = current.get(want.key);
      if (!line || line.quantityLabel !== want.quantityLabel) {
        throw new Error("The list just changed — check it and try again.");
      }
      return line;
    });
    const unique = [...new Map(picked.map((l) => [l.key, l])).values()];

    return await ctx.db.insert("materialOrders", {
      companyId: user.companyId,
      jobId: job._id,
      lines: unique.map((l) => ({ key: l.key, name: l.name, quantity: l.quantityLabel })),
      covers: unique.flatMap((l) => l.sources.map((s) => sourceKey(s.noteId, l.key))),
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

/** Take an order back: its lines return to the "to order" list. */
export const undoOrder = mutation({
  args: { orderId: v.id("materialOrders") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const order = assertSameCompany(await ctx.db.get(args.orderId), user.companyId);
    await ctx.db.delete(order._id);
    return null;
  },
});
