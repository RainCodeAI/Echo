import { describe, expect, it } from "vitest";
import { leaveError, removalError, transferError, unassignUser } from "../convex/lib/officeUsers";

const owner = { id: "u1", role: "owner" as const, companyId: "c1" };
const member = { id: "u2", role: "member" as const, companyId: "c1" };
const outsider = { id: "u9", role: "member" as const, companyId: "c2" };

describe("rules", () => {
  it("only the owner removes, never themselves or the owner, never across companies", () => {
    expect(removalError(owner, member)).toBeNull();
    expect(removalError(member, owner)).toMatch(/Only the workspace owner/);
    expect(removalError(owner, owner)).toMatch(/can't remove yourself/);
    expect(removalError(owner, outsider)).toBe("Not found");
    expect(removalError(owner, null)).toBe("Not found");
  });
  it("members can leave; the owner hands over first", () => {
    expect(leaveError(member)).toBeNull();
    expect(leaveError(owner)).toMatch(/Make someone else the owner first/);
  });
  it("transfer: owner only, to someone else in the workspace", () => {
    expect(transferError(owner, member)).toBeNull();
    expect(transferError(member, owner)).toMatch(/Only the workspace owner/);
    expect(transferError(owner, owner)).toMatch(/already the owner/);
    expect(transferError(owner, outsider)).toBe("Not found");
  });
});

describe("unassignUser", () => {
  it("clears only that office user's assignments", () => {
    const items = [
      { title: "a", assignee: { kind: "user" as const, id: "u2" } },
      { title: "b", assignee: { kind: "member" as const, id: "u2" } },
      { title: "c", assignee: { kind: "user" as const, id: "u3" } },
      { title: "d" },
    ];
    const r = unassignUser(items, "u2");
    expect(r.changed).toBe(true);
    expect(r.items).toEqual([{ title: "a" }, items[1], items[2], items[3]]);
    expect(unassignUser(items.slice(1), "u2").changed).toBe(false);
    expect(unassignUser(undefined, "u2")).toEqual({ items: [], changed: false });
  });
});
