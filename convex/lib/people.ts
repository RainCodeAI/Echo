import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { AssigneeRef, Person } from "./tasks";

/** Everyone an action item can be assigned to: active crew + office users. */
export async function loadPeople(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
): Promise<Person[]> {
  const [crew, users] = await Promise.all([
    ctx.db
      .query("teamMembers")
      .withIndex("by_company_and_active", (q) => q.eq("companyId", companyId).eq("isActive", true))
      .collect(),
    ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect(),
  ]);
  return [
    ...crew.map((m) => ({ kind: "member" as const, id: m._id as string, name: m.name })),
    ...users.map((u) => ({ kind: "user" as const, id: u._id as string, name: u.name })),
  ];
}

/** True if `ref` is a person in this company (inactive crew allowed: history). */
export async function assigneeBelongsTo(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
  ref: AssigneeRef,
): Promise<boolean> {
  const id = ctx.db.normalizeId(ref.kind === "member" ? "teamMembers" : "users", ref.id);
  if (!id) return false;
  const doc = await ctx.db.get(id);
  return !!doc && doc.companyId === companyId;
}
