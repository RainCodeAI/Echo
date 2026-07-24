import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser, assertSameCompany } from "./lib/tenant";
import {
  leadStatusValidator,
  leadUrgencyValidator,
  serviceTypeValidator,
} from "./schema";

/**
 * Lightweight leads — link targets for field notes (not a full CRM surface).
 * Every row is company-scoped; all reads/writes go through the tenant helpers.
 */

const MAX_DESCRIPTION_CHARS = 4_000;

/** Owner list, newest first, with an optional status filter. */
export const list = query({
  args: {
    status: v.optional(leadStatusValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    if (args.status) {
      const status = args.status;
      return await ctx.db
        .query("leads")
        .withIndex("by_company_and_status", (q) =>
          q.eq("companyId", user.companyId).eq("status", status),
        )
        .order("desc")
        .take(200);
    }
    return await ctx.db
      .query("leads")
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
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_company_and_created", (q) =>
        q.eq("companyId", user.companyId),
      )
      .order("desc")
      .take(200);
    return leads.map((l) => ({
      id: l._id,
      label: l.customerName,
      status: l.status,
    }));
  },
});

export const create = mutation({
  args: {
    customerName: v.string(),
    serviceType: serviceTypeValidator,
    description: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    status: v.optional(leadStatusValidator),
    urgency: v.optional(leadUrgencyValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const customerName = args.customerName.trim();
    if (!customerName) throw new Error("Customer name is required.");

    const now = Date.now();
    return await ctx.db.insert("leads", {
      companyId: user.companyId,
      customerName,
      serviceType: args.serviceType,
      description: args.description.trim().slice(0, MAX_DESCRIPTION_CHARS),
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      address: args.address?.trim() || undefined,
      status: args.status ?? "new",
      urgency: args.urgency ?? "medium",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    leadId: v.id("leads"),
    customerName: v.optional(v.string()),
    serviceType: v.optional(serviceTypeValidator),
    description: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    status: v.optional(leadStatusValidator),
    urgency: v.optional(leadUrgencyValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const lead = await ctx.db.get(args.leadId);
    assertSameCompany(lead, user.companyId);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.customerName !== undefined) {
      const name = args.customerName.trim();
      if (!name) throw new Error("Customer name is required.");
      patch.customerName = name;
    }
    if (args.serviceType !== undefined) patch.serviceType = args.serviceType;
    if (args.description !== undefined) {
      patch.description = args.description.trim().slice(0, MAX_DESCRIPTION_CHARS);
    }
    if (args.phone !== undefined) patch.phone = args.phone.trim() || undefined;
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.address !== undefined) {
      patch.address = args.address.trim() || undefined;
    }
    if (args.status !== undefined) patch.status = args.status;
    if (args.urgency !== undefined) patch.urgency = args.urgency;

    await ctx.db.patch(args.leadId, patch);
    return args.leadId;
  },
});
