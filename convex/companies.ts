import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser } from "./lib/tenant";
import { serviceTypeValidator } from "./schema";

/**
 * Public profile for the field entry page — no auth required.
 * Only returns non-sensitive branding fields.
 */
export const publicProfile = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    const company = await ctx.db.get(companyId);
    if (!company) return null;
    return {
      _id: company._id,
      name: company.name,
      primaryTrade: company.primaryTrade ?? null,
    };
  },
});

/** Authenticated company for the signed-in owner's workspace. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return await ctx.db.get(user.companyId);
  },
});

/** Update company profile fields (owner dashboard settings). */
export const update = mutation({
  args: {
    name: v.optional(v.string()),
    primaryTrade: v.optional(serviceTypeValidator),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    timezone: v.optional(v.string()),
    notificationEmail: v.optional(v.string()),
    notificationsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const company = await ctx.db.get(user.companyId);
    if (!company) throw new Error("Not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim() || company.name;
    if (args.primaryTrade !== undefined) patch.primaryTrade = args.primaryTrade;
    if (args.phone !== undefined) patch.phone = args.phone.trim() || undefined;
    if (args.email !== undefined) patch.email = args.email.trim() || undefined;
    if (args.timezone !== undefined) {
      patch.timezone = args.timezone.trim() || undefined;
    }
    if (args.notificationEmail !== undefined) {
      patch.notificationEmail = args.notificationEmail.trim() || undefined;
    }
    if (args.notificationsEnabled !== undefined) {
      patch.notificationsEnabled = args.notificationsEnabled;
    }

    await ctx.db.patch(user.companyId, patch);
    return user.companyId;
  },
});
