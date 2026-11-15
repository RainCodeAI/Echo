import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCurrentUser } from "./lib/tenant";
import { leaveError, removalError, transferError, unassignUser } from "./lib/officeUsers";

/**
 * Office user management: remove a member, leave, transfer ownership.
 * See ARCHITECTURE §11i.
 */

const toActor = (u: Doc<"users">) => ({ id: u._id as string, role: u.role, companyId: u.companyId as string });
const toTarget = (u: Doc<"users"> | null) =>
  u ? { id: u._id as string, role: u.role, companyId: u.companyId as string } : null;

/**
 * Removing the users row is what ends access: the Clerk identity no longer
 * maps to this company. Their action items are unassigned in the background;
 * records they created keep their (now unresolvable) id and show no name.
 */
async function removeUser(ctx: MutationCtx, user: Doc<"users">) {
  await ctx.db.delete(user._id);
  await ctx.scheduler.runAfter(0, internal.officeUsers.unassignBatch, {
    companyId: user.companyId,
    userId: user._id,
    cursor: null,
  });
}

export const removeMember = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const actor = await requireCurrentUser(ctx);
    const target = await ctx.db.get(userId);
    const error = removalError(toActor(actor), toTarget(target));
    if (error) throw new Error(error);
    await removeUser(ctx, target!);
    return null;
  },
});

/** A member removes themselves from the workspace. */
export const leave = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireCurrentUser(ctx);
    const error = leaveError(toActor(actor));
    if (error) throw new Error(error);
    await removeUser(ctx, actor);
    return null;
  },
});

/** Make another office user the owner; the current owner becomes a member. */
export const transferOwnership = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const actor = await requireCurrentUser(ctx);
    const target = await ctx.db.get(userId);
    const error = transferError(toActor(actor), toTarget(target));
    if (error) throw new Error(error);
    await ctx.db.patch(target!._id, { role: "owner" });
    await ctx.db.patch(actor._id, { role: "member" });
    return null;
  },
});

const BATCH = 200;

export const unassignBatch = internalMutation({
  args: { companyId: v.id("companies"), userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { companyId, userId, cursor }) => {
    const page = await ctx.db
      .query("voiceNotes")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .paginate({ cursor, numItems: BATCH });
    for (const note of page.page) {
      const { items, changed } = unassignUser(note.actionItems, userId as Id<"users">);
      if (changed) await ctx.db.patch(note._id, { actionItems: items, updatedAt: Date.now() });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.officeUsers.unassignBatch, {
        companyId,
        userId,
        cursor: page.continueCursor,
      });
    }
    return null;
  },
});
