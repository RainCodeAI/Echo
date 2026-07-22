import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";

/**
 * Tenant + identity helpers shared across Convex functions.
 *
 * Every operational query/mutation should resolve the calling user (and their
 * company) through these helpers so authorization and tenant-scoping live in
 * exactly one place.
 *
 * Pattern matches SiteAssist `convex/lib/tenant.ts`.
 */

type AnyCtx = QueryCtx | MutationCtx;

/** Returns the signed-in user's `users` doc, or null if not provisioned yet. */
export async function getCurrentUser(
  ctx: AnyCtx,
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", identity.subject))
    .unique();
}

/**
 * Like {@link getCurrentUser} but throws when the request is unauthenticated
 * or the user record has not been provisioned. Use in any function that must
 * have a tenant context.
 */
export async function requireCurrentUser(
  ctx: AnyCtx,
): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) {
    throw new Error(
      "Not authenticated. Call the `users.store` mutation after sign-in.",
    );
  }
  return user;
}

/** Convenience: the company id the current user belongs to. */
export async function requireCompanyId(ctx: AnyCtx) {
  const user = await requireCurrentUser(ctx);
  return user.companyId;
}

/**
 * The owner of a company — used to attribute system-created records.
 * Prefers `role === "owner"` over the first row so attribution stays correct
 * if members are added later.
 */
export async function getCompanyOwner(
  ctx: AnyCtx,
  companyId: Doc<"companies">["_id"],
): Promise<Doc<"users">> {
  const users = await ctx.db
    .query("users")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .collect();
  const owner = users.find((u) => u.role === "owner") ?? users[0];
  if (!owner) {
    throw new Error("Company has no users to attribute the record to.");
  }
  return owner;
}

/**
 * Guard that a fetched document belongs to the caller's company. Returns the
 * doc if valid, throws otherwise. Prevents cross-tenant access via guessed ids.
 */
export function assertSameCompany<
  T extends { companyId: Doc<"companies">["_id"] },
>(doc: T | null, companyId: Doc<"companies">["_id"]): T {
  if (!doc || doc.companyId !== companyId) {
    throw new Error("Not found");
  }
  return doc;
}
