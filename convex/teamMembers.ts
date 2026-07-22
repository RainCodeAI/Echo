import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireCurrentUser, assertSameCompany } from "./lib/tenant";
import { hashPin, isValidPin, safeEqualHex } from "./lib/pin";
import { buildFieldVerificationToken } from "./lib/fieldSession";

/**
 * Crew roster + PIN verification for field entry.
 *
 * Owners manage members from the dashboard (Clerk auth).
 * Field workers call `verifyPin` without Clerk — returns a short-lived
 * verification payload the client will use when submitting notes (next pass).
 */

/** List active (and inactive) members for the owner's company — never returns pinHash. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId))
      .collect();

    return members
      .map(({ pinHash: _pinHash, ...safe }) => safe)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * Ensure no other active member on this company already uses the same PIN hash.
 * Inactive members can keep a colliding hash; only active PINs must be unique
 * so `verifyPin` never matches two people.
 */
async function assertPinAvailable(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  pinHash: string,
  exceptMemberId?: Id<"teamMembers">,
) {
  const members = await ctx.db
    .query("teamMembers")
    .withIndex("by_company_and_active", (q) =>
      q.eq("companyId", companyId).eq("isActive", true),
    )
    .collect();

  const collision = members.find(
    (m) => m._id !== exceptMemberId && safeEqualHex(m.pinHash, pinHash),
  );
  if (collision) {
    throw new Error(
      "That PIN is already used by another active crew member. Choose a different PIN.",
    );
  }
}

/** Create a crew member with a 4-digit PIN. */
export const create = mutation({
  args: {
    name: v.string(),
    pin: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required.");
    if (!isValidPin(args.pin)) {
      throw new Error("PIN must be exactly 4 digits.");
    }

    const now = Date.now();
    const pinHash = await hashPin(user.companyId, args.pin);
    await assertPinAvailable(ctx, user.companyId, pinHash);

    return await ctx.db.insert("teamMembers", {
      companyId: user.companyId,
      name,
      role: args.role?.trim() || undefined,
      pinHash,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update name/role/active or rotate PIN. */
export const update = mutation({
  args: {
    memberId: v.id("teamMembers"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    pin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const member = await ctx.db.get(args.memberId);
    assertSameCompany(member, user.companyId);

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Name is required.");
      patch.name = name;
    }
    if (args.role !== undefined) patch.role = args.role.trim() || undefined;
    if (args.isActive !== undefined) patch.isActive = args.isActive;

    const willBeActive =
      args.isActive !== undefined ? args.isActive : member!.isActive;

    if (args.pin !== undefined) {
      if (!isValidPin(args.pin)) {
        throw new Error("PIN must be exactly 4 digits.");
      }
      const pinHash = await hashPin(user.companyId, args.pin);
      if (willBeActive) {
        await assertPinAvailable(ctx, user.companyId, pinHash, args.memberId);
      }
      patch.pinHash = pinHash;
    } else if (args.isActive === true && !member!.isActive) {
      // Reactivating: existing PIN must not collide with another active member.
      await assertPinAvailable(
        ctx,
        user.companyId,
        member!.pinHash,
        args.memberId,
      );
    }

    await ctx.db.patch(args.memberId, patch);
    return args.memberId;
  },
});

// --- Server-side PIN brute-force throttle ------------------------------------

/** Failed attempts within a window before the company entry is locked. */
const MAX_FAILED_ATTEMPTS = 10;
/** How long entry is locked after hitting the limit. */
const LOCKOUT_MS = 60_000;
/** Idle window after which the failure counter resets on its own. */
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** Record one failed PIN attempt, locking the company entry at the threshold. */
async function recordPinFailure(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  now: number,
) {
  const record = await ctx.db
    .query("pinAttempts")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .unique();

  if (!record) {
    await ctx.db.insert("pinAttempts", {
      companyId,
      failedCount: 1,
      windowStartedAt: now,
      updatedAt: now,
    });
    return;
  }

  // Reset the counter if the previous window has gone stale.
  const staleWindow = now - record.windowStartedAt > ATTEMPT_WINDOW_MS;
  const failedCount = (staleWindow ? 0 : record.failedCount) + 1;

  const patch: Record<string, unknown> = {
    failedCount,
    windowStartedAt: staleWindow ? now : record.windowStartedAt,
    updatedAt: now,
  };
  if (failedCount >= MAX_FAILED_ATTEMPTS) {
    // Lock out and start a fresh window so the next burst is counted anew.
    patch.lockedUntil = now + LOCKOUT_MS;
    patch.failedCount = 0;
    patch.windowStartedAt = now;
  }
  await ctx.db.patch(record._id, patch);
}

/** Clear the failure counter after a successful verification. */
async function clearPinFailures(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  now: number,
) {
  const record = await ctx.db
    .query("pinAttempts")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .unique();
  if (!record) return;
  await ctx.db.patch(record._id, {
    failedCount: 0,
    lockedUntil: undefined,
    windowStartedAt: now,
    updatedAt: now,
  });
}

/**
 * Public PIN check for `/entry/[companyId]`.
 * Returns member identity on success (no pinHash). Rate-limited server-side —
 * the client lockout alone is bypassable by calling the API directly.
 */
export const verifyPin = mutation({
  args: {
    companyId: v.id("companies"),
    pin: v.string(),
  },
  handler: async (ctx, { companyId, pin }) => {
    const now = Date.now();

    const attempts = await ctx.db
      .query("pinAttempts")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .unique();
    if (attempts?.lockedUntil && attempts.lockedUntil > now) {
      const seconds = Math.ceil((attempts.lockedUntil - now) / 1000);
      return {
        ok: false as const,
        error: `Too many attempts. Try again in ${seconds}s.`,
      };
    }

    if (!isValidPin(pin)) {
      await recordPinFailure(ctx, companyId, now);
      return { ok: false as const, error: "PIN must be 4 digits." };
    }

    const company = await ctx.db.get(companyId);
    if (!company) {
      return { ok: false as const, error: "Company not found." };
    }

    const pinHash = await hashPin(companyId, pin);
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_company_and_active", (q) =>
        q.eq("companyId", companyId).eq("isActive", true),
      )
      .collect();

    const match = members.find((m) => safeEqualHex(m.pinHash, pinHash));
    if (!match) {
      await recordPinFailure(ctx, companyId, now);
      return { ok: false as const, error: "Incorrect PIN." };
    }

    await clearPinFailures(ctx, companyId, now);
    const verificationToken = await buildFieldVerificationToken(
      companyId,
      match._id,
      now,
    );

    return {
      ok: true as const,
      member: {
        id: match._id,
        name: match.name,
        role: match.role ?? null,
      },
      companyName: company.name,
      verificationToken,
    };
  },
});
