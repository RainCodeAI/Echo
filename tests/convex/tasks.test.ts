// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

beforeEach(() => {
  vi.useFakeTimers(); // keep scheduled alerts/AI from running
});
afterEach(() => vi.useRealTimers());

const AI = { title: "t", summary: "s", materials: [], suggestedJobUpdates: [], tags: [], confidence: 0.9, urgency: "medium" as const };

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    const danaId = await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana Owner", email: "d@a.com", role: "owner", createdAt: 0 });
    const luis = await ctx.db.insert("teamMembers", { companyId, name: "Luis Garcia", pinHash: "x", isActive: true, createdAt: 0 });
    await ctx.db.insert("teamMembers", { companyId, name: "Chris Lee", pinHash: "x", isActive: true, createdAt: 0 });
    await ctx.db.insert("teamMembers", { companyId, name: "Chris Park", pinHash: "x", isActive: true, createdAt: 0 });
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "other", companyId: other, name: "Olly", email: "o@o.com", role: "owner", createdAt: 0 });
    const outsider = await ctx.db.insert("teamMembers", { companyId: other, name: "Luis Outsider", pinHash: "x", isActive: true, createdAt: 0 });
    const noteId = await ctx.db.insert("voiceNotes", {
      companyId, teamMemberId: luis, status: "ready", rawTranscript: "x", recordedAt: 0,
      aiStatus: "processing", createdAt: 1000, updatedAt: 0,
    });
    await ctx.db.insert("voiceNotes", {
      companyId: other, status: "ready", rawTranscript: "x", recordedAt: 0, aiStatus: "completed",
      actionItems: [{ title: "OTHER COMPANY TASK" }], createdAt: 2000, updatedAt: 0,
    });
    return { companyId, danaId, luis, outsider, noteId };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "owner" }), otherOwner: t.withIdentity({ subject: "other" }) };
}

const items = (t: ReturnType<typeof makeTest>, id: Id<"voiceNotes">) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.actionItems ?? []);

describe("auto-assignment from AI hints", () => {
  it("assigns unambiguous names and leaves the rest unassigned", async () => {
    const s = await seed();
    await s.t.mutation(internal.voiceNotes.applyAiStructure, {
      noteId: s.noteId,
      ...AI,
      actionItems: [
        { title: "Order shingles", assigneeHint: "Luis" },
        { title: "Call customer", assigneeHint: "office" },
        { title: "Check flashing", assigneeHint: "Chris" },
        { title: "Send quote", assigneeHint: "dana" },
      ],
    });
    const got = await items(s.t, s.noteId);
    expect(got.map((a) => a.assignee ?? null)).toEqual([
      { kind: "member", id: s.luis },
      null,
      null,
      { kind: "user", id: s.danaId },
    ]);
  });

  it("never assigns to someone in another company", async () => {
    const s = await seed();
    await s.t.mutation(internal.voiceNotes.applyAiStructure, {
      noteId: s.noteId, ...AI, actionItems: [{ title: "x", assigneeHint: "Luis Outsider" }],
    });
    expect((await items(s.t, s.noteId))[0].assignee).toBeUndefined();
  });
});

describe("setActionItemAssignee / setActionItemCompleted", () => {
  async function withItems() {
    const s = await seed();
    await s.t.mutation(internal.voiceNotes.applyAiStructure, {
      noteId: s.noteId, ...AI, actionItems: [{ title: "Order shingles" }, { title: "Call customer" }],
    });
    return s;
  }

  it("assigns, unassigns, and the assignment survives an AI re-run", async () => {
    const s = await withItems();
    await s.owner.mutation(api.voiceNotes.setActionItemAssignee, {
      noteId: s.noteId, index: 1, expectedTitle: "Call customer", assignee: { kind: "user", id: s.danaId },
    });
    expect((await items(s.t, s.noteId))[1].assignee).toEqual({ kind: "user", id: s.danaId });

    await s.t.mutation(internal.voiceNotes.applyAiStructure, {
      noteId: s.noteId, ...AI, actionItems: [{ title: "Something else entirely" }],
    });
    expect((await items(s.t, s.noteId))[1]).toMatchObject({ title: "Call customer", assignee: { kind: "user", id: s.danaId } });

    await s.owner.mutation(api.voiceNotes.setActionItemAssignee, {
      noteId: s.noteId, index: 1, expectedTitle: "Call customer", assignee: null,
    });
    expect((await items(s.t, s.noteId))[1].assignee).toBeUndefined();
  });

  it("rejects people from another company and other companies' owners", async () => {
    const s = await withItems();
    await expect(
      s.owner.mutation(api.voiceNotes.setActionItemAssignee, {
        noteId: s.noteId, index: 0, assignee: { kind: "member", id: s.outsider },
      }),
    ).rejects.toThrow(/Not found/);
    await expect(
      s.owner.mutation(api.voiceNotes.setActionItemAssignee, {
        noteId: s.noteId, index: 0, assignee: { kind: "member", id: "not-an-id" },
      }),
    ).rejects.toThrow(/Not found/);
    await expect(
      s.otherOwner.mutation(api.voiceNotes.setActionItemAssignee, {
        noteId: s.noteId, index: 0, assignee: null,
      }),
    ).rejects.toThrow(/Not found/);
  });

  it("refuses to act on an item that changed since it was shown", async () => {
    const s = await withItems();
    await expect(
      s.owner.mutation(api.voiceNotes.setActionItemCompleted, {
        noteId: s.noteId, index: 0, completed: true, expectedTitle: "Call customer",
      }),
    ).rejects.toThrow(/just changed/);
    await expect(
      s.owner.mutation(api.voiceNotes.setActionItemAssignee, {
        noteId: s.noteId, index: 0, expectedTitle: "Call customer", assignee: null,
      }),
    ).rejects.toThrow(/just changed/);
    expect((await items(s.t, s.noteId))[0].completed).toBeUndefined();
  });

  it("records when an item was completed, and clears it when reopened", async () => {
    const s = await withItems();
    await s.owner.mutation(api.voiceNotes.setActionItemCompleted, {
      noteId: s.noteId, index: 0, completed: true, expectedTitle: "Order shingles",
    });
    expect((await items(s.t, s.noteId))[0].completedAt).toBeTypeOf("number");
    await s.owner.mutation(api.voiceNotes.setActionItemCompleted, {
      noteId: s.noteId, index: 0, completed: false, expectedTitle: "Order shingles",
    });
    const reopened = (await items(s.t, s.noteId))[0];
    expect(reopened.completed).toBeUndefined();
    expect(reopened.completedAt).toBeUndefined();
  });

  it("an owner edit to the list keeps assignments", async () => {
    const s = await withItems();
    await s.owner.mutation(api.voiceNotes.setActionItemAssignee, {
      noteId: s.noteId, index: 0, expectedTitle: "Order shingles", assignee: { kind: "member", id: s.luis },
    });
    const current = await items(s.t, s.noteId);
    await s.owner.mutation(api.voiceNotes.updateAiFields, {
      noteId: s.noteId,
      actionItems: [{ ...current[0], title: "Order shingles (3 bundles)" }, current[1]],
    });
    expect((await items(s.t, s.noteId))[0]).toMatchObject({ title: "Order shingles (3 bundles)", assignee: { kind: "member", id: s.luis } });
  });
});

describe("tasks queries", () => {
  it("lists only this company's open items, with filters and a summary", async () => {
    const s = await seed();
    await s.t.mutation(internal.voiceNotes.applyAiStructure, {
      noteId: s.noteId, ...AI,
      actionItems: [
        { title: "Order shingles", assigneeHint: "Luis", priority: "high" },
        { title: "Call customer" },
      ],
    });
    const all = await s.owner.query(api.tasks.list, {});
    expect(all.map((x) => x.title)).toEqual(["Order shingles", "Call customer"]);
    expect(JSON.stringify(all)).not.toContain("OTHER COMPANY TASK");
    expect(all[0]).toMatchObject({ crewName: "Luis Garcia", noteId: s.noteId, index: 0 });

    expect((await s.owner.query(api.tasks.list, { filter: { kind: "unassigned" } })).map((x) => x.title)).toEqual(["Call customer"]);
    expect(
      (await s.owner.query(api.tasks.list, { filter: { kind: "person", ref: { kind: "member", id: s.luis } } })).map((x) => x.title),
    ).toEqual(["Order shingles"]);

    expect(await s.owner.query(api.tasks.summary, {})).toEqual({ open: 2, high: 1, unassigned: 1 });
    const people = await s.owner.query(api.tasks.people, {});
    expect(people.map((p) => p.name)).not.toContain("Luis Outsider");
  });
});
