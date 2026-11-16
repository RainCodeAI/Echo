import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireCurrentUser } from "./lib/tenant";
import { flattenTasks, type TaskFilter, type TaskNote } from "./lib/tasks";
import { loadPeople } from "./lib/people";
import { assigneeValidator } from "./schema";

/**
 * Tasks page: open action items across this company's recent notes.
 * Scans the newest notes (bounded) — action items live inside notes.
 */
const NOTE_SCAN_LIMIT = 500;
const RECENTLY_DONE_MS = 7 * 24 * 60 * 60 * 1000;

export const list = query({
  args: {
    /** "all" | "unassigned" | a person. */
    filter: v.optional(
      v.union(
        v.object({ kind: v.literal("all") }),
        v.object({ kind: v.literal("unassigned") }),
        v.object({ kind: v.literal("person"), ref: assigneeValidator }),
      ),
    ),
    includeRecentlyDone: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const notes = await ctx.db
      .query("voiceNotes")
      .withIndex("by_company_and_created", (q) => q.eq("companyId", user.companyId))
      .order("desc")
      .take(NOTE_SCAN_LIMIT);

    const withItems = notes.filter((n) => (n.actionItems?.length ?? 0) > 0);
    const names = new Map<string, string | null>();
    const nameOf = async (id: Id<"teamMembers"> | Id<"jobs"> | undefined) => {
      if (!id) return null;
      if (!names.has(id)) {
        const doc = await ctx.db.get(id);
        names.set(
          id,
          doc && doc.companyId === user.companyId ? ("title" in doc ? doc.title : doc.name) : null,
        );
      }
      return names.get(id) ?? null;
    };
    const taskNotes: TaskNote[] = [];
    for (const n of withItems) {
      taskNotes.push({
        _id: n._id,
        createdAt: n.createdAt,
        status: n.status,
        aiTitle: n.aiTitle,
        rawTranscript: n.rawTranscript,
        jobTitle: await nameOf(n.jobId),
        crewName: await nameOf(n.teamMemberId),
        actionItems: n.actionItems,
      });
    }
    return flattenTasks(taskNotes, {
      filter: (args.filter ?? { kind: "all" }) as TaskFilter,
      includeCompletedSince: args.includeRecentlyDone ? Date.now() - RECENTLY_DONE_MS : undefined,
    });
  },
});

/** People an action item can be assigned to (for pickers). */
export const people = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return loadPeople(ctx, user.companyId);
  },
});

/** Dashboard card: open action items, high priority, unassigned. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const notes = await ctx.db
      .query("voiceNotes")
      .withIndex("by_company_and_created", (q) => q.eq("companyId", user.companyId))
      .order("desc")
      .take(NOTE_SCAN_LIMIT);
    let open = 0;
    let high = 0;
    let unassigned = 0;
    for (const n of notes) {
      if (n.status === "archived") continue;
      for (const a of n.actionItems ?? []) {
        if (a.completed) continue;
        open++;
        if (a.priority === "high") high++;
        if (!a.assignee) unassigned++;
      }
    }
    return { open, high, unassigned };
  },
});
