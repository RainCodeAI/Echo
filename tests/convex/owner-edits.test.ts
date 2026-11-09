// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

// Scheduled AI runs must not fire for real during these tests.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const AI_RESULT = {
  title: "AI title",
  summary: "AI summary",
  materials: [{ name: "AI shingles", quantity: "3", unit: "bundles" }],
  actionItems: [{ title: "AI: order shingles", priority: "high" as const }],
  urgency: "low" as const,
  siteAddress: "AI address",
  timelineNotes: "AI timeline",
  suggestedJobUpdates: [],
  tags: ["ai_tag"],
  confidence: 0.9,
};

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    await ctx.db.insert("users", {
      clerkUserId: "owner-a", companyId, name: "Owner A", email: "a@acme.com", role: "owner", createdAt: 0,
    });
    const otherCompanyId = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    await ctx.db.insert("users", {
      clerkUserId: "owner-b", companyId: otherCompanyId, name: "Owner B", email: "b@other.com", role: "owner", createdAt: 0,
    });
    const noteId = await ctx.db.insert("voiceNotes", {
      companyId,
      status: "ready",
      rawTranscript: "need three bundles of shingles",
      transcriptSource: "whisper",
      recordedAt: 0,
      aiStatus: "completed",
      aiGenerationAttempts: 2,
      urgency: "medium",
      aiTitle: "Original",
      actionItems: [{ title: "Call customer" }, { title: "Order shingles" }],
      createdAt: 0,
      updatedAt: 0,
    });
    return { noteId };
  });
  return {
    t,
    noteId: ids.noteId as Id<"voiceNotes">,
    owner: t.withIdentity({ subject: "owner-a" }),
    otherTenant: t.withIdentity({ subject: "owner-b" }),
  };
}

const getNote = (t: ReturnType<typeof makeTest>, id: Id<"voiceNotes">) =>
  t.run((ctx) => ctx.db.get(id));

describe("updateAiFields", () => {
  it("saves owner corrections and protects them from AI re-runs", async () => {
    const { t, noteId, owner } = await seed();
    await owner.mutation(api.voiceNotes.updateAiFields, {
      noteId,
      title: "  Owner title ",
      materials: [{ name: "Drip edge", quantity: "4" }, { name: " " }],
    });

    let note = await getNote(t, noteId);
    expect(note?.aiTitle).toBe("Owner title");
    expect(note?.materials).toEqual([{ name: "Drip edge", quantity: "4" }]);
    expect(note?.ownerEditedFields).toEqual(["title", "materials"]);

    // AI runs again (e.g. retry): edited fields keep the owner's values.
    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId, ...AI_RESULT });
    note = await getNote(t, noteId);
    expect(note?.aiTitle).toBe("Owner title");
    expect(note?.materials).toEqual([{ name: "Drip edge", quantity: "4" }]);
    // Untouched fields take the new AI output.
    expect(note?.aiSummary).toBe("AI summary");
    expect(note?.siteAddress).toBe("AI address");
    expect(note?.aiStatus).toBe("completed");
  });

  it("cannot touch another company's note", async () => {
    const { noteId, otherTenant } = await seed();
    await expect(
      otherTenant.mutation(api.voiceNotes.updateAiFields, { noteId, title: "pwned" }),
    ).rejects.toThrow(/Not found/);
  });

  it("rejects an empty title", async () => {
    const { noteId, owner } = await seed();
    await expect(
      owner.mutation(api.voiceNotes.updateAiFields, { noteId, title: "   " }),
    ).rejects.toThrow(/Title/);
  });
});

describe("urgency overrides (regression: AI retry clobbered owner urgency)", () => {
  it("an owner-changed urgency survives an AI re-run", async () => {
    const { t, noteId, owner } = await seed();
    await owner.mutation(api.voiceNotes.updateReview, { noteId, urgency: "emergency" });
    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId, ...AI_RESULT });
    expect((await getNote(t, noteId))?.urgency).toBe("emergency");
  });

  it("saving the review form with urgency unchanged does not freeze it", async () => {
    const { t, noteId, owner } = await seed();
    await owner.mutation(api.voiceNotes.updateReview, {
      noteId,
      urgency: "medium", // same as current
      ownerNote: "called the customer",
    });
    expect((await getNote(t, noteId))?.ownerEditedFields ?? []).not.toContain("urgency");
    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId, ...AI_RESULT });
    expect((await getNote(t, noteId))?.urgency).toBe("low");
  });
});

describe("updateTranscript", () => {
  it("stores a manual transcript and resets the AI retry budget", async () => {
    const { t, noteId, owner } = await seed();
    await owner.mutation(api.voiceNotes.updateTranscript, {
      noteId,
      rawTranscript: "  need FOUR bundles of shingles  ",
    });
    const note = await getNote(t, noteId);
    expect(note?.rawTranscript).toBe("need FOUR bundles of shingles");
    expect(note?.transcriptSource).toBe("manual");
    expect(note?.aiGenerationAttempts).toBe(0);
    expect(note?.aiStatus).toBe("completed"); // no re-run requested
  });

  it("can re-run AI right away, and refuses while a run is in flight", async () => {
    const { t, noteId, owner } = await seed();
    await owner.mutation(api.voiceNotes.updateTranscript, {
      noteId,
      rawTranscript: "corrected text here",
      rerunAi: true,
    });
    expect((await getNote(t, noteId))?.aiStatus).toBe("pending");
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.map((s) => s.name)).toContain("ai:processNoteInternal");

    await expect(
      owner.mutation(api.voiceNotes.updateTranscript, {
        noteId,
        rawTranscript: "again",
        rerunAi: true,
      }),
    ).rejects.toThrow(/already running/);
  });

  it("rejects an empty transcript", async () => {
    const { noteId, owner } = await seed();
    await expect(
      owner.mutation(api.voiceNotes.updateTranscript, { noteId, rawTranscript: "  " }),
    ).rejects.toThrow(/empty/);
  });
});

describe("requestAiRetry", () => {
  it("keeps owner edits by default and clears them when asked", async () => {
    const { t, noteId, owner } = await seed();
    await owner.mutation(api.voiceNotes.updateAiFields, { noteId, title: "Owner title" });

    await owner.mutation(api.voiceNotes.requestAiRetry, { noteId });
    expect((await getNote(t, noteId))?.ownerEditedFields).toEqual(["title"]);

    // Simulate the run finishing, then ask for a retry that overwrites edits.
    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId, ...AI_RESULT });
    await owner.mutation(api.voiceNotes.requestAiRetry, { noteId, overwriteOwnerEdits: true });
    expect((await getNote(t, noteId))?.ownerEditedFields).toBeUndefined();
    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId, ...AI_RESULT });
    expect((await getNote(t, noteId))?.aiTitle).toBe("AI title");
  });
});

describe("setActionItemCompleted", () => {
  it("ticks one item and protects the list", async () => {
    const { t, noteId, owner } = await seed();
    await owner.mutation(api.voiceNotes.setActionItemCompleted, { noteId, index: 1, completed: true });
    const note = await getNote(t, noteId);
    expect(note?.actionItems?.[1].completed).toBe(true);
    expect(note?.actionItems?.[0].completed).toBeUndefined();
    expect(note?.ownerEditedFields).toContain("actionItems");

    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId, ...AI_RESULT });
    expect((await getNote(t, noteId))?.actionItems?.[1].completed).toBe(true);
  });

  it("rejects an out-of-range index", async () => {
    const { noteId, owner } = await seed();
    await expect(
      owner.mutation(api.voiceNotes.setActionItemCompleted, { noteId, index: 5, completed: true }),
    ).rejects.toThrow(/no longer exists/);
  });
});
