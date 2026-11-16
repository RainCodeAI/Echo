// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const SUGGESTIONS = [
  { field: "status", value: "in_progress", rationale: "crew started tear-off" },
  { field: "notes", value: "Dog in back yard" },
  { field: "scheduledFor", value: "2026-11-17" },
  { field: "crew size", value: "3" },
];

async function seed(opts: { linked?: boolean } = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "O", email: "o@a.com", role: "owner", createdAt: 0 });
    const jobId = await ctx.db.insert("jobs", {
      companyId, title: "Ramirez reroof", status: "scheduled", address: "12 Oak St", notes: "Gate code 4412",
      createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    const otherJob = await ctx.db.insert("jobs", {
      companyId, title: "Chen gutters", status: "scheduled", createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    const noteId = await ctx.db.insert("voiceNotes", {
      companyId, status: "ready", rawTranscript: "x", recordedAt: Date.UTC(2026, 10, 10), aiStatus: "completed",
      jobId: opts.linked === false ? undefined : jobId, suggestedJobUpdates: SUGGESTIONS, createdAt: 0, updatedAt: 0,
    });
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "other", companyId: other, name: "X", email: "x@x.com", role: "owner", createdAt: 0 });
    return { jobId, otherJob, noteId };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "owner" }), other: t.withIdentity({ subject: "other" }) };
}

const target = (noteId: Id<"voiceNotes">, i: number) => ({
  noteId, index: i, expectedField: SUGGESTIONS[i].field, expectedValue: SUGGESTIONS[i].value,
});
const job = (t: ReturnType<typeof makeTest>, id: Id<"jobs">) => t.run((ctx) => ctx.db.get(id));
const suggestions = async (t: ReturnType<typeof makeTest>, id: Id<"voiceNotes">) =>
  (await t.run((ctx) => ctx.db.get(id)))?.suggestedJobUpdates ?? [];

describe("apply / undo", () => {
  it("applies a status change and undoes it", async () => {
    const s = await seed();
    await s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 0));
    expect((await job(s.t, s.jobId))?.status).toBe("in_progress");
    expect((await suggestions(s.t, s.noteId))[0]).toMatchObject({ appliedJobId: s.jobId, previous: '"scheduled"' });

    await expect(s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 0))).rejects.toThrow(/Already applied/);

    await s.owner.mutation(api.jobUpdates.undo, target(s.noteId, 0));
    expect((await job(s.t, s.jobId))?.status).toBe("scheduled");
    expect((await suggestions(s.t, s.noteId))[0].appliedAt).toBeUndefined();
  });

  it("won't undo over a later change to the job", async () => {
    const s = await seed();
    await s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 0));
    await s.owner.mutation(api.jobs.update, { jobId: s.jobId, status: "completed" });
    await expect(s.owner.mutation(api.jobUpdates.undo, target(s.noteId, 0))).rejects.toThrow(/changed since/);
    expect((await job(s.t, s.jobId))?.status).toBe("completed");
  });

  it("appends to job notes and restores them on undo", async () => {
    const s = await seed();
    await s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 1));
    expect((await job(s.t, s.jobId))?.notes).toBe("Gate code 4412\nField note 2026-11-10: Dog in back yard");
    await s.owner.mutation(api.jobUpdates.undo, target(s.noteId, 1));
    expect((await job(s.t, s.jobId))?.notes).toBe("Gate code 4412");
  });

  it("reschedules only with a confirmed date", async () => {
    const s = await seed();
    await expect(s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 2))).rejects.toThrow(/Confirm the date/);
    const when = Date.now() + 7 * 86_400_000;
    await s.owner.mutation(api.jobUpdates.apply, { ...target(s.noteId, 2), scheduledForMs: when });
    expect((await job(s.t, s.jobId))?.scheduledFor).toBe(when);
  });

  it("refuses unsupported fields, unlinked notes, stale lists and other companies", async () => {
    const s = await seed();
    await expect(s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 3))).rejects.toThrow(/can't change/);
    await expect(
      s.owner.mutation(api.jobUpdates.apply, { ...target(s.noteId, 0), expectedValue: "completed" }),
    ).rejects.toThrow(/just changed/);
    await expect(s.other.mutation(api.jobUpdates.apply, target(s.noteId, 0))).rejects.toThrow(/Not found/);
    expect((await job(s.t, s.jobId))?.status).toBe("scheduled");

    const unlinked = await seed({ linked: false });
    await expect(unlinked.owner.mutation(api.jobUpdates.apply, target(unlinked.noteId, 0))).rejects.toThrow(/Link this note to a job/);
  });

  it("undo targets the job it was applied to, even after the note is re-linked", async () => {
    const s = await seed();
    await s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 0));
    await s.owner.mutation(api.voiceNotes.setLinks, { noteId: s.noteId, jobId: s.otherJob });
    await s.owner.mutation(api.jobUpdates.undo, target(s.noteId, 0));
    expect((await job(s.t, s.jobId))?.status).toBe("scheduled");
    expect((await job(s.t, s.otherJob))?.status).toBe("scheduled");
  });
});

describe("dismiss and AI re-runs", () => {
  it("dismisses and restores; can't dismiss an applied suggestion", async () => {
    const s = await seed();
    await s.owner.mutation(api.jobUpdates.dismiss, { ...target(s.noteId, 1), dismissed: true });
    expect((await suggestions(s.t, s.noteId))[1].dismissedAt).toBeTypeOf("number");
    await s.owner.mutation(api.jobUpdates.dismiss, { ...target(s.noteId, 1), dismissed: false });
    expect((await suggestions(s.t, s.noteId))[1].dismissedAt).toBeUndefined();

    await s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 0));
    await expect(s.owner.mutation(api.jobUpdates.dismiss, { ...target(s.noteId, 0), dismissed: true })).rejects.toThrow(/Undo it first/);
  });

  it("an AI re-run keeps applied/dismissed suggestions and doesn't re-propose them", async () => {
    const s = await seed();
    await s.owner.mutation(api.jobUpdates.apply, target(s.noteId, 0));
    await s.owner.mutation(api.jobUpdates.dismiss, { ...target(s.noteId, 1), dismissed: true });
    await s.t.mutation(internal.voiceNotes.applyAiStructure, {
      noteId: s.noteId, title: "t", summary: "s", materials: [], actionItems: [], urgency: "medium", tags: [], confidence: 1,
      suggestedJobUpdates: [
        { field: "status", value: "in_progress" }, // already applied
        { field: "notes", value: "Dog in back yard" }, // already dismissed
        { field: "address", value: "14 Oak St" }, // new
      ],
    });
    const after = await suggestions(s.t, s.noteId);
    expect(after.map((x) => [x.field, x.value, !!x.appliedAt, !!x.dismissedAt])).toEqual([
      ["status", "in_progress", true, false],
      ["notes", "Dog in back yard", false, true],
      ["address", "14 Oak St", false, false],
    ]);
  });
});
