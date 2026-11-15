// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { makeTest } from "./setup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    const owner = await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana", email: "dana@a.com", role: "owner", createdAt: 0 });
    const pat = await ctx.db.insert("users", { clerkUserId: "pat", companyId, name: "Pat", email: "pat@a.com", role: "member", createdAt: 0 });
    const sam = await ctx.db.insert("users", { clerkUserId: "sam", companyId, name: "Sam", email: "sam@a.com", role: "member", createdAt: 0 });
    const luis = await ctx.db.insert("teamMembers", { companyId, name: "Luis", pinHash: "x", isActive: true, createdAt: 0 });
    // 250 notes, so unassigning has to page through more than one batch.
    for (let i = 0; i < 250; i++) {
      await ctx.db.insert("voiceNotes", {
        companyId, status: "ready", rawTranscript: "x", recordedAt: i, aiStatus: "completed", createdAt: i, updatedAt: i,
        actionItems: [
          { title: `call ${i}`, assignee: { kind: "user", id: pat } },
          { title: `order ${i}`, assignee: { kind: "user", id: sam } },
          { title: `tarp ${i}`, assignee: { kind: "member", id: luis } },
        ],
      });
    }
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    const olly = await ctx.db.insert("users", { clerkUserId: "olly", companyId: other, name: "Olly", email: "o@o.com", role: "owner", createdAt: 0 });
    return { companyId, owner, pat, sam, luis, olly };
  });
  const as = (subject: string) => t.withIdentity({ subject, email: `${subject}@a.com`, emailVerified: true });
  return { t, ...ids, dana: as("owner"), patC: as("pat"), samC: as("sam"), ollyC: as("olly") };
}

describe("removeMember", () => {
  it("ends their access and unassigns their open action items across all notes", async () => {
    const s = await seed();
    await s.dana.mutation(api.officeUsers.removeMember, { userId: s.pat });
    await expect(s.patC.query(api.voiceNotes.listForCompany, {})).rejects.toThrow(/Not authenticated/);
    expect((await s.dana.query(api.users.listForCompany, {})).map((u) => u.name)).toEqual(["Dana", "Sam"]);

    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const assignees = await s.t.run(async (ctx) =>
      (await ctx.db.query("voiceNotes").collect()).flatMap((n) => (n.actionItems ?? []).map((a) => a.assignee?.id ?? null)),
    );
    expect(assignees.filter((a) => a === s.pat)).toHaveLength(0);
    expect(assignees.filter((a) => a === null)).toHaveLength(250);
    expect(assignees.filter((a) => a === s.sam)).toHaveLength(250);
    expect(assignees.filter((a) => a === s.luis)).toHaveLength(250);
    expect((await s.dana.query(api.tasks.list, { filter: { kind: "unassigned" } })).length).toBeGreaterThan(0);
  });

  it("refuses members, the owner themself, and other companies", async () => {
    const s = await seed();
    await expect(s.patC.mutation(api.officeUsers.removeMember, { userId: s.sam })).rejects.toThrow(/Only the workspace owner/);
    await expect(s.dana.mutation(api.officeUsers.removeMember, { userId: s.owner })).rejects.toThrow(/can't remove yourself/);
    await expect(s.ollyC.mutation(api.officeUsers.removeMember, { userId: s.pat })).rejects.toThrow(/Not found/);
    await expect(s.dana.mutation(api.officeUsers.removeMember, { userId: s.olly })).rejects.toThrow(/Not found/);
    expect(await s.dana.query(api.users.listForCompany, {})).toHaveLength(3);
  });

  it("a removed person can be invited back", async () => {
    const s = await seed();
    await s.dana.mutation(api.officeUsers.removeMember, { userId: s.pat });
    await s.dana.mutation(api.invites.create, { email: "pat@a.com" });
    await s.patC.mutation(api.users.store, {});
    expect((await s.patC.query(api.users.current, {}))?.companyId).toBe(s.companyId);
  });
});

describe("leave", () => {
  it("members can leave; the owner can't", async () => {
    const s = await seed();
    await s.samC.mutation(api.officeUsers.leave, {});
    await expect(s.samC.query(api.voiceNotes.listForCompany, {})).rejects.toThrow(/Not authenticated/);
    await expect(s.dana.mutation(api.officeUsers.leave, {})).rejects.toThrow(/Make someone else the owner first/);
    expect((await s.dana.query(api.users.listForCompany, {})).map((u) => u.name)).toEqual(["Dana", "Pat"]);
  });
});

describe("transferOwnership", () => {
  it("swaps roles; owner-only powers move with it", async () => {
    const s = await seed();
    await expect(s.patC.mutation(api.officeUsers.transferOwnership, { userId: s.pat })).rejects.toThrow(/Only the workspace owner/);
    await expect(s.dana.mutation(api.officeUsers.transferOwnership, { userId: s.olly })).rejects.toThrow(/Not found/);
    await s.dana.mutation(api.officeUsers.transferOwnership, { userId: s.pat });

    const roles = Object.fromEntries((await s.dana.query(api.users.listForCompany, {})).map((u) => [u.name, u.role]));
    expect(roles).toEqual({ Pat: "owner", Dana: "member", Sam: "member" });
    await expect(s.dana.mutation(api.invites.create, { email: "x@a.com" })).rejects.toThrow(/owner/);
    await s.patC.mutation(api.invites.create, { email: "x@a.com" });
    // The new owner can now remove the previous one, who can also leave.
    await s.dana.mutation(api.officeUsers.leave, {});
    expect((await s.patC.query(api.users.listForCompany, {})).map((u) => u.name)).toEqual(["Pat", "Sam"]);
  });
});
