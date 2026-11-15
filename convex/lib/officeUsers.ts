/**
 * Office user management rules (pure, tested). A workspace has exactly one
 * owner; members can be removed by the owner or leave on their own; the
 * owner hands over the role before leaving.
 */

export type Role = "owner" | "member";
export type Actor = { id: string; role: Role; companyId: string };
export type Target = { id: string; role: Role; companyId: string } | null;

/** Why `actor` can't remove `target`, or null if they can. */
export function removalError(actor: Actor, target: Target): string | null {
  if (!target || target.companyId !== actor.companyId) return "Not found";
  if (actor.role !== "owner") return "Only the workspace owner can remove people.";
  if (target.id === actor.id) return "You can't remove yourself. Transfer ownership first, then leave.";
  if (target.role === "owner") return "The owner can't be removed.";
  return null;
}

export function leaveError(actor: Actor): string | null {
  return actor.role === "owner"
    ? "Owners can't leave their own workspace. Make someone else the owner first, or delete the workspace."
    : null;
}

export function transferError(actor: Actor, target: Target): string | null {
  if (!target || target.companyId !== actor.companyId) return "Not found";
  if (actor.role !== "owner") return "Only the workspace owner can transfer ownership.";
  if (target.id === actor.id) return "You're already the owner.";
  return null;
}

type Assignable = { assignee?: { kind: "member" | "user"; id: string } };

/** Unassign a removed office user's action items. */
export function unassignUser<T extends Assignable>(items: T[] | undefined, userId: string): { items: T[]; changed: boolean } {
  let changed = false;
  const next = (items ?? []).map((item) => {
    if (item.assignee?.kind === "user" && item.assignee.id === userId) {
      changed = true;
      const { assignee: _drop, ...rest } = item;
      return rest as T;
    }
    return item;
  });
  return { items: next, changed };
}
