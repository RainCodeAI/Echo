import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser, requireOwner, assertSameCompany } from "./lib/tenant";
import { isValidEmail, normalizeEmail } from "./lib/email";

/**
 * Office (Clerk) invites. An owner invites by email; the invited person joins
 * the company automatically the first time they sign up with that email
 * (see `users.store`). No email is sent — the owner shares the app link
 * out-of-band. Managing invites is owner-only.
 */

/** Pending invites for the current company. Any office user may view. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId))
      .collect();

    return invites
      .filter((i) => i.status === "pending")
      .map((i) => ({
        id: i._id,
        email: i.email,
        role: i.role,
        createdAt: i.createdAt,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  },
});

/** Invite an office user by email (owner only). */
export const create = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const owner = await requireOwner(ctx);
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      throw new Error("Enter a valid email address.");
    }

    // Already an office user on this company?
    const companyUsers = await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", owner.companyId))
      .collect();
    if (companyUsers.some((u) => normalizeEmail(u.email) === normalized)) {
      throw new Error("That person is already on your team.");
    }

    // Existing pending invite for the same email + company?
    const pending = await ctx.db
      .query("invites")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", normalized).eq("status", "pending"),
      )
      .collect();
    if (pending.some((i) => i.companyId === owner.companyId)) {
      throw new Error("There's already a pending invite for that email.");
    }

    return await ctx.db.insert("invites", {
      companyId: owner.companyId,
      email: normalized,
      role: "member",
      status: "pending",
      invitedBy: owner._id,
      createdAt: Date.now(),
    });
  },
});

/** Revoke a pending invite (owner only). */
export const revoke = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const owner = await requireOwner(ctx);
    const invite = assertSameCompany(await ctx.db.get(inviteId), owner.companyId);
    if (invite.status === "pending") {
      await ctx.db.patch(inviteId, { status: "revoked" });
    }
    return inviteId;
  },
});
