import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getCurrentUser, requireCurrentUser } from "./lib/tenant";
import { normalizeEmail } from "./lib/email";

/**
 * User + workspace provisioning.
 *
 * Clerk owns authentication for owners/office; Convex owns user/company rows.
 * Field workers are `teamMembers` (PIN) and never go through this module.
 */

/** The signed-in user joined with their company. `null` until provisioned. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const company = await ctx.db.get(user.companyId);
    if (!company) return { ...user, company: null };
    return { ...user, company };
  },
});

/**
 * Idempotently provision the current Clerk user. Safe to call on every app
 * load. Creates a personal company on first sign-in.
 */
export const store = mutation({
  args: { name: v.optional(v.string()), email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Called `users.store` without authentication.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
      .unique();

    const name =
      args.name?.trim() ||
      identity.name ||
      identity.nickname ||
      identity.email ||
      "New user";
    const email = identity.email ?? args.email ?? "";

    if (existing) {
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    const now = Date.now();

    // If this brand-new user was invited (verified email matches a pending
    // invite), join that company as a member instead of creating a personal
    // one. Intercepting here avoids ever having to migrate an existing user.
    const normalizedEmail = normalizeEmail(email);
    const invite = normalizedEmail
      ? await ctx.db
          .query("invites")
          .withIndex("by_email_and_status", (q) =>
            q.eq("email", normalizedEmail).eq("status", "pending"),
          )
          .first()
      : null;

    if (invite) {
      const userId = await ctx.db.insert("users", {
        clerkUserId: identity.subject,
        companyId: invite.companyId,
        name,
        email,
        role: invite.role,
        createdAt: now,
      });
      await ctx.db.patch(invite._id, {
        status: "accepted",
        acceptedAt: now,
        acceptedByUserId: userId,
      });
      return userId;
    }

    const companyId = await ctx.db.insert("companies", {
      name: name ? `${name}'s Company` : "My Company",
      createdAt: now,
      updatedAt: now,
    });

    return await ctx.db.insert("users", {
      clerkUserId: identity.subject,
      companyId,
      name,
      email,
      role: "owner",
      createdAt: now,
    });
  },
});

/** Office roster (Clerk users) for the current company. */
export const listForCompany = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const users = await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId))
      .collect();

    return users
      .map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        isSelf: u._id === user._id,
      }))
      .sort((a, b) => {
        // Owners first, then alphabetical by name.
        if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  },
});
