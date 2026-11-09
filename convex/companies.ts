import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser, requireOwner } from "./lib/tenant";
import { normalizePhone } from "./lib/alerts";
import { isValidEmail } from "./lib/email";
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

/** Update company profile fields (owner only). */
export const update = mutation({
  args: {
    name: v.optional(v.string()),
    primaryTrade: v.optional(serviceTypeValidator),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    timezone: v.optional(v.string()),
    notificationEmail: v.optional(v.string()),
    alertPhone: v.optional(v.string()),
    notificationsEnabled: v.optional(v.boolean()),
    digestEnabled: v.optional(v.boolean()),
    digestHour: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Owner-only per the role matrix in ARCHITECTURE.md (members: "Limited").
    const user = await requireOwner(ctx);
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
      const email = args.notificationEmail.trim();
      if (email && !isValidEmail(email)) {
        throw new Error("Enter a valid alert email address.");
      }
      patch.notificationEmail = email || undefined;
    }
    if (args.alertPhone !== undefined) {
      if (!args.alertPhone.trim()) {
        patch.alertPhone = undefined;
      } else {
        const phone = normalizePhone(args.alertPhone);
        if (!phone) {
          throw new Error(
            "Enter a valid mobile number, e.g. (555) 123-4567 or +44 20 7946 0958.",
          );
        }
        patch.alertPhone = phone;
      }
    }
    if (args.notificationsEnabled !== undefined) {
      patch.notificationsEnabled = args.notificationsEnabled;
    }
    if (args.digestEnabled !== undefined) {
      patch.digestEnabled = args.digestEnabled;
    }
    if (args.digestHour !== undefined) {
      if (!Number.isInteger(args.digestHour) || args.digestHour < 0 || args.digestHour > 23) {
        throw new Error("Digest time must be a whole hour between 0 and 23.");
      }
      patch.digestHour = args.digestHour;
    }

    await ctx.db.patch(user.companyId, patch);
    return user.companyId;
  },
});
