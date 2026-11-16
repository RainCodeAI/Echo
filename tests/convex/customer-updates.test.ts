// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

const T0 = Date.UTC(2026, 10, 15, 18);
const DAY = 86_400_000;
let requests: { url: string; body: string }[] = [];
let modelReply: unknown = { text: "Hi Maria, tear-off is done. – Acme Roofing", emailSubject: "Roof update", emailBody: "Hi Maria,\nTear-off is done.\nAcme Roofing" };

function completion(content: string) {
  return {
    id: "c", object: "chat.completion", created: 0, model: "gpt-4o-mini",
    choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content, refusal: null } }],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  process.env.OPENAI_API_KEY = "sk-test";
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url instanceof Request ? url.url : url), body: String(init?.body ?? "") });
      return new Response(JSON.stringify(completion(JSON.stringify(modelReply))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_KILL_SWITCH;
});

async function seed(opts: { withLead?: boolean } = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme Roofing", timezone: "America/Los_Angeles", createdAt: 0 });
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana", email: "d@a.com", role: "owner", createdAt: 0 });
    const leadId = opts.withLead === false
      ? undefined
      : await ctx.db.insert("leads", {
          companyId, customerName: "Maria Ramirez", phone: "(555) 010-2000", email: "maria@example.com",
          serviceType: "roofing", description: "Reroof", status: "scheduled", urgency: "medium", createdBy: ownerId, createdAt: 0, updatedAt: 0,
        });
    const jobId = await ctx.db.insert("jobs", {
      companyId, leadId, title: "Ramirez reroof", status: "in_progress", address: "12 Oak St", createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "other", companyId: other, name: "Olly", email: "o@o.com", role: "owner", createdAt: 0 });
    return { companyId, ownerId, jobId };
  });
  const addNote = (o: { at: number; summary: string; jobId?: Id<"jobs"> | null; ownerNote?: string; status?: "ready" | "archived" }) =>
    t.run((ctx) =>
      ctx.db.insert("voiceNotes", {
        companyId: ids.companyId, status: o.status ?? "ready", rawTranscript: "raw crew talk", aiSummary: o.summary,
        ownerNote: o.ownerNote, recordedAt: o.at, aiStatus: "completed",
        jobId: o.jobId === null ? undefined : (o.jobId ?? ids.jobId), createdAt: o.at, updatedAt: o.at,
      }),
    );
  return { t, ...ids, addNote, owner: t.withIdentity({ subject: "owner" }), other: t.withIdentity({ subject: "other" }) };
}

const promptOf = (i = 0) => JSON.parse(requests[i].body).messages[1].content as string;

describe("draft → edit → send", () => {
  it("drafts from the job's recent notes, leaving out archived notes and internal fields", async () => {
    const s = await seed();
    await s.addNote({ at: T0 - 10 * DAY, summary: "OLD NOTE before the lookback" });
    await s.addNote({ at: T0 - 2 * DAY, summary: "Tear-off done on the north slope." });
    await s.addNote({ at: T0 - DAY, summary: "ARCHIVED NOTE", status: "archived" });
    const noteId = await s.addNote({ at: T0 - 3600_000, summary: "Found soft decking near the chimney.", ownerNote: "OWNER PRIVATE: charge extra" });

    const updateId = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current?.status).toBe("generating");

    await s.t.action(internal.customerUpdatesAi.generate, { updateId });
    const prompt = promptOf();
    expect(requests[0].url).toContain("/chat/completions");
    expect(prompt).toContain("Customer: Maria");
    expect(prompt).toContain("Tear-off done on the north slope.");
    expect(prompt).toContain("Found soft decking near the chimney.");
    for (const leaked of ["OLD NOTE", "ARCHIVED NOTE", "OWNER PRIVATE", "raw crew talk", "555", "maria@"]) {
      expect(prompt).not.toContain(leaked);
    }

    const view = await s.owner.query(api.customerUpdates.forNote, { noteId });
    expect(view.customer).toEqual({ name: "Maria Ramirez", phone: "(555) 010-2000", email: "maria@example.com" });
    expect(view.current).toMatchObject({ status: "draft", text: "Hi Maria, tear-off is done. - Acme Roofing", emailSubject: "Roof update", noteCount: 2 });

    await s.owner.mutation(api.customerUpdates.updateDraft, { updateId, text: "Hi Maria, tear-off is done and we found some soft decking." });
    await s.owner.mutation(api.customerUpdates.markSent, { updateId, via: "text" });
    const sent = await s.owner.query(api.customerUpdates.forNote, { noteId });
    expect(sent.current).toMatchObject({ status: "sent", sentVia: "text", text: "Hi Maria, tear-off is done and we found some soft decking." });
    expect(sent.lastSentAt).toBeGreaterThanOrEqual(T0);
    await expect(s.owner.mutation(api.customerUpdates.updateDraft, { updateId, text: "x" })).rejects.toThrow(/can't be edited/);

    await s.owner.mutation(api.customerUpdates.undoSent, { updateId });
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current).toMatchObject({ status: "draft", sentAt: null });
  });

  it("the next update covers only notes since the last one sent", async () => {
    const s = await seed();
    const first = await s.addNote({ at: T0 - 2 * DAY, summary: "Tear-off done." });
    const u1 = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId: first });
    await s.t.action(internal.customerUpdatesAi.generate, { updateId: u1 });
    await s.owner.mutation(api.customerUpdates.markSent, { updateId: u1, via: "email" });

    vi.setSystemTime(T0 + DAY);
    const second = await s.addNote({ at: T0 + DAY - 3600_000, summary: "Shingles are on." });
    const u2 = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId: second });
    await s.t.action(internal.customerUpdatesAi.generate, { updateId: u2 });
    expect(promptOf(1)).toContain("Shingles are on.");
    expect(promptOf(1)).not.toContain("Tear-off done.");
  });

  it("drafts with a neutral greeting when the job has no customer on file", async () => {
    const s = await seed({ withLead: false });
    const noteId = await s.addNote({ at: T0 - 3600_000, summary: "Gutters cleaned." });
    const updateId = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    await s.t.action(internal.customerUpdatesAi.generate, { updateId });
    expect(promptOf()).toContain('Customer: (no name on file');
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).customer).toBeNull();
  });
});

describe("guards", () => {
  it("needs a linked job; one draft at a time; starting over replaces the open draft", async () => {
    const s = await seed();
    const unlinked = await s.addNote({ at: T0, summary: "x", jobId: null });
    await expect(s.owner.mutation(api.customerUpdates.requestDraft, { noteId: unlinked })).rejects.toThrow(/Link this note to a job/);
    expect(await s.owner.query(api.customerUpdates.forNote, { noteId: unlinked })).toMatchObject({ job: null, current: null });

    const noteId = await s.addNote({ at: T0, summary: "Tear-off done." });
    const u1 = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    await expect(s.owner.mutation(api.customerUpdates.requestDraft, { noteId })).rejects.toThrow(/already being written/);
    await s.t.action(internal.customerUpdatesAi.generate, { updateId: u1 });

    const u2 = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    expect((await s.t.run((ctx) => ctx.db.get(u1)))?.status).toBe("discarded");
    // A late result for the replaced draft is dropped.
    await s.t.mutation(internal.customerUpdates.saveDraft, { updateId: u1, text: "LATE", emailSubject: "s", emailBody: "b" });
    expect((await s.t.run((ctx) => ctx.db.get(u1)))?.status).toBe("discarded");
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current?.id).toBe(u2);
  });

  it("a stuck draft shows as failed and can be restarted", async () => {
    const s = await seed();
    const noteId = await s.addNote({ at: T0, summary: "x" });
    await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    vi.setSystemTime(T0 + 4 * 60_000);
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current).toMatchObject({ status: "failed", error: expect.stringMatching(/too long/) });
    await expect(s.owner.mutation(api.customerUpdates.requestDraft, { noteId })).resolves.toBeTruthy();
  });

  it("caps drafts per hour", async () => {
    const s = await seed();
    const noteId = await s.addNote({ at: T0, summary: "x" });
    for (let i = 0; i < 20; i++) {
      const id = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
      await s.t.mutation(internal.customerUpdates.failDraft, { updateId: id, error: "e" });
    }
    await expect(s.owner.mutation(api.customerUpdates.requestDraft, { noteId })).rejects.toThrow(/a lot of drafts/);
  });

  it("records a clear failure when AI is off, and nothing is sent anywhere", async () => {
    const s = await seed();
    const noteId = await s.addNote({ at: T0, summary: "x" });
    delete process.env.OPENAI_API_KEY;
    const updateId = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    await s.t.action(internal.customerUpdatesAi.generate, { updateId });
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current).toMatchObject({ status: "failed", error: expect.stringMatching(/OPENAI_API_KEY/) });
    expect(requests).toEqual([]);
  });

  it("an unusable model reply fails the draft", async () => {
    const s = await seed();
    const noteId = await s.addNote({ at: T0, summary: "x" });
    modelReply = { text: "", emailSubject: "", emailBody: "" };
    const updateId = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    await s.t.action(internal.customerUpdatesAi.generate, { updateId });
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current).toMatchObject({ status: "failed", error: expect.stringMatching(/usable/) });
    modelReply = { text: "Hi Maria, tear-off is done. – Acme Roofing", emailSubject: "Roof update", emailBody: "Hi Maria,\nTear-off is done.\nAcme Roofing" };
  });

  it("other companies can't read, draft, edit, send or discard", async () => {
    const s = await seed();
    const noteId = await s.addNote({ at: T0, summary: "x" });
    const updateId = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    await s.t.action(internal.customerUpdatesAi.generate, { updateId });
    await expect(s.other.query(api.customerUpdates.forNote, { noteId })).rejects.toThrow(/Not found/);
    await expect(s.other.mutation(api.customerUpdates.requestDraft, { noteId })).rejects.toThrow(/Not found/);
    await expect(s.other.mutation(api.customerUpdates.updateDraft, { updateId, text: "x" })).rejects.toThrow(/Not found/);
    await expect(s.other.mutation(api.customerUpdates.markSent, { updateId, via: "text" })).rejects.toThrow(/Not found/);
    await expect(s.other.mutation(api.customerUpdates.discard, { updateId })).rejects.toThrow(/Not found/);
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current?.status).toBe("draft");
  });

  it("discard; can't discard a sent update without undoing it", async () => {
    const s = await seed();
    const noteId = await s.addNote({ at: T0, summary: "x" });
    const updateId = await s.owner.mutation(api.customerUpdates.requestDraft, { noteId });
    await s.t.action(internal.customerUpdatesAi.generate, { updateId });
    await s.owner.mutation(api.customerUpdates.markSent, { updateId, via: "other" });
    await expect(s.owner.mutation(api.customerUpdates.discard, { updateId })).rejects.toThrow(/Undo that first/);
    await s.owner.mutation(api.customerUpdates.undoSent, { updateId });
    await s.owner.mutation(api.customerUpdates.discard, { updateId });
    expect((await s.owner.query(api.customerUpdates.forNote, { noteId })).current).toBeNull();
  });
});
