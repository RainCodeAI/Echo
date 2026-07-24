import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser, assertSameCompany } from "./lib/tenant";
import { jobStatusValidator } from "./schema";

/**
 * Lightweight jobs — scheduled/active work a note can attach to. Company-scoped;
 * an optional `leadId` ties a job back to the lead it came from.
 */

const MAX_NOTES_CHARS = 4_000;

/** Owner list, newest first, with an optional status filter. */
export const list = query({
  args: {
    status: v.optional(jobStatusValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("jobs")
        .withIndex("by_company_and_status", (q) =>
          q.eq("companyId", user.companyId).eq("status", status),
        )
        .order("desc")
        .take(200);
    }
    return await ctx.db
      .query("jobs")
      .withIndex("by_company_and_created", (q) =>
        q.eq("companyId", user.companyId),
      )
      .order("desc")
      .take(200);
  },
});

/** Compact list for link pickers (id + label only). */
export const listForLink = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_and_created", (q) =>
        q.eq("companyId", user.companyId),
      )
      .order("desc")
      .take(200);
    return jobs.map((j) => ({
      id: j._id,
      label: j.title,
      status: j.status,
    }));
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    status: v.optional(jobStatusValidator),
    scheduledFor: v.optional(v.number()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    leadId: v.optional(v.id("leads")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const title = args.title.trim();
    if (!title) throw new Error("Job title is required.");

    // If linking to a lead, prove it belongs to the caller's company.
    if (args.leadId) {
      const lead = await ctx.db.get(args.leadId);
      assertSameCompany(lead, user.companyId);
    }

    const now = Date.now();
    return await ctx.db.insert("jobs", {
      companyId: user.companyId,
      title,
      status: args.status ?? "scheduled",
      scheduledFor: args.scheduledFor,
      address: args.address?.trim() || undefined,
      notes: args.notes?.trim().slice(0, MAX_NOTES_CHARS) || undefined,
      leadId: args.leadId,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    jobId: v.id("jobs"),
    title: v.optional(v.string()),
    status: v.optional(jobStatusValidator),
    scheduledFor: v.optional(v.number()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    leadId: v.optional(v.union(v.id("leads"), v.null())),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const job = await ctx.db.get(args.jobId);
    assertSameCompany(job, user.companyId);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("Job title is required.");
      patch.title = title;
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.scheduledFor !== undefined) patch.scheduledFor = args.scheduledFor;
    if (args.address !== undefined) {
      patch.address = args.address.trim() || undefined;
    }
    if (args.notes !== undefined) {
      patch.notes = args.notes.trim().slice(0, MAX_NOTES_CHARS) || undefined;
    }
    if (args.leadId !== undefined) {
      if (args.leadId === null) {
        patch.leadId = undefined;
      } else {
        const lead = await ctx.db.get(args.leadId);
        assertSameCompany(lead, user.companyId);
        patch.leadId = args.leadId;
      }
    }

    await ctx.db.patch(args.jobId, patch);
    return args.jobId;
  },
});
