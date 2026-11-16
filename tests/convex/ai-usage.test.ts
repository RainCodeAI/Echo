// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

const T0 = Date.UTC(2026, 10, 15, 18);
let requests: string[] = [];

const STRUCTURED = {
  title: "North slope", summary: "Tear-off done.", materials: [], actionItems: [], urgency: "medium",
  siteAddress: "", timelineNotes: "", suggestedJobUpdates: [], tags: [], confidence: 0.9,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.AI_MONTHLY_BUDGET_USD;
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      requests.push(url);
      const body = url.includes("/audio/transcriptions")
        ? { text: "Tear-off is done on the north slope, starting the underlayment." }
        : {
            id: "c", object: "chat.completion", created: 0, model: "gpt-4o-mini",
            usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 },
            choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content: JSON.stringify(STRUCTURED), refusal: null } }],
          };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_MONTHLY_BUDGET_USD;
});

async function seed(opts: { budget?: number } = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0, aiMonthlyBudgetUsd: opts.budget });
    await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana", email: "d@a.com", role: "owner", createdAt: 0 });
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "other", companyId: other, name: "Olly", email: "o@o.com", role: "owner", createdAt: 0 });
    await ctx.db.insert("aiUsage", {
      companyId: other, month: "2026-11", costMicros: 99_000_000, transcribeCalls: 9, structureCalls: 9, customerUpdateCalls: 0,
      audioSeconds: 0, inputTokens: 0, outputTokens: 0, skippedNotes: 0, updatedAt: 0,
    });
    return { companyId, other };
  });
  const addNote = (o: { urgent?: boolean } = {}) =>
    t.run(async (ctx) =>
      ctx.db.insert("voiceNotes", {
        companyId: ids.companyId, status: "ready", rawTranscript: "tear off done", recordedAt: T0, aiStatus: "pending",
        audioStorageId: await ctx.storage.store(new Blob(["fake audio"], { type: "audio/webm" })), audioMimeType: "audio/webm",
        audioDurationMs: 90_000, workerFlaggedUrgent: o.urgent, createdAt: T0, updatedAt: T0,
      }),
    );
  const spend = (micros: number) =>
    t.run(async (ctx) => {
      await ctx.db.insert("aiUsage", {
        companyId: ids.companyId, month: "2026-11", costMicros: micros, transcribeCalls: 0, structureCalls: 0, customerUpdateCalls: 0,
        audioSeconds: 0, inputTokens: 0, outputTokens: 0, skippedNotes: 0, updatedAt: 0,
      });
    });
  const usage = () =>
    t.run((ctx) =>
      ctx.db.query("aiUsage").withIndex("by_company_and_month", (q) => q.eq("companyId", ids.companyId).eq("month", "2026-11")).unique(),
    );
  return { t, ...ids, addNote, spend, usage, owner: t.withIdentity({ subject: "owner" }) };
}

const note = (t: ReturnType<typeof makeTest>, id: Id<"voiceNotes">) => t.run((ctx) => ctx.db.get(id));

describe("recording usage", () => {
  it("a processed note records transcription minutes and structuring tokens at their estimated cost", async () => {
    const s = await seed();
    const noteId = await s.addNote();
    await s.t.action(internal.ai.processNoteInternal, { noteId });
    expect((await note(s.t, noteId))?.aiStatus).toBe("completed");
    expect(await s.usage()).toMatchObject({
      transcribeCalls: 1, structureCalls: 1, customerUpdateCalls: 0, audioSeconds: 90, inputTokens: 1200, outputTokens: 300,
      // whisper 90s = 9,000 µ$; gpt-4o-mini 1,200 in + 300 out = 360 µ$
      costMicros: 9_360,
    });

    const summary = await s.owner.query(api.aiUsage.summary, {});
    expect(summary).toMatchObject({ month: "2026-11", level: "ok", spentMicros: 9_360, budgetUsd: 25, thisMonth: { notes: 1, audioMinutes: 2 } });
    expect(summary.history).toEqual([{ month: "2026-11", costMicros: 9_360, notes: 1 }]);
  });
});

describe("over budget", () => {
  it("skips AI without losing the note or counting an attempt, and still alerts an urgent note", async () => {
    const s = await seed({ budget: 1 });
    await s.spend(1_000_000);
    const noteId = await s.addNote({ urgent: true });
    await s.t.action(internal.ai.processNoteInternal, { noteId });

    expect(requests).toEqual([]);
    const n = await note(s.t, noteId);
    expect(n).toMatchObject({ aiStatus: "failed", rawTranscript: "tear off done" });
    expect(n?.aiErrorMessage).toMatch(/This month's AI limit \(\$1\.00\) is used up.*Dec 1/);
    expect(n?.aiGenerationAttempts ?? 0).toBe(0);
    expect((await s.usage())?.skippedNotes).toBe(1);
    const scheduled = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((f) => f.name)).toContain("alerts:sendUrgentAlert");

    await expect(s.owner.mutation(api.voiceNotes.requestAiRetry, { noteId })).rejects.toThrow(/AI limit/);
    expect((await s.owner.query(api.aiUsage.summary, {})).level).toBe("exceeded");
  });

  it("refuses customer-update drafts", async () => {
    const s = await seed({ budget: 1 });
    await s.spend(1_000_000);
    const noteId = await s.t.run(async (ctx) => {
      const user = (await ctx.db.query("users").first())!;
      const jobId = await ctx.db.insert("jobs", { companyId: s.companyId, title: "J", status: "scheduled", createdBy: user._id, createdAt: 0, updatedAt: 0 });
      return ctx.db.insert("voiceNotes", { companyId: s.companyId, jobId, status: "ready", rawTranscript: "x", aiSummary: "x", recordedAt: T0, aiStatus: "completed", createdAt: T0, updatedAt: T0 });
    });
    await expect(s.owner.mutation(api.customerUpdates.requestDraft, { noteId })).rejects.toThrow(/AI limit/);
  });

  it("warns from 80%, and a new month starts fresh", async () => {
    const s = await seed({ budget: 10 });
    await s.spend(8_000_000);
    expect((await s.owner.query(api.aiUsage.summary, {})).level).toBe("warning");
    vi.setSystemTime(Date.UTC(2026, 11, 1, 0, 1));
    expect(await s.owner.query(api.aiUsage.summary, {})).toMatchObject({ month: "2026-12", level: "ok", spentMicros: 0 });
  });

  it("budget 0 pauses AI for that company only, with its own message", async () => {
    const s = await seed({ budget: 0 });
    const noteId = await s.addNote();
    await s.t.action(internal.ai.processNoteInternal, { noteId });
    expect((await note(s.t, noteId))?.aiErrorMessage).toMatch(/AI is paused for this workspace/);
    expect(requests).toEqual([]);
  });
});

describe("budgets", () => {
  it("env default, ops override and reset", async () => {
    const s = await seed();
    process.env.AI_MONTHLY_BUDGET_USD = "40";
    expect((await s.owner.query(api.aiUsage.summary, {})).budgetUsd).toBe(40);
    await expect(s.t.mutation(internal.ops.setAiBudget, { companyId: s.companyId, monthlyUsd: -1 })).rejects.toThrow(/between 0 and 10000/);
    expect(await s.t.mutation(internal.ops.setAiBudget, { companyId: s.companyId, monthlyUsd: 75 })).toMatchObject({ budgetUsd: 75, allowed: true });
    expect((await s.owner.query(api.aiUsage.summary, {})).budgetUsd).toBe(75);
    await s.t.mutation(internal.ops.setAiBudget, { companyId: s.companyId, monthlyUsd: null });
    expect((await s.owner.query(api.aiUsage.summary, {})).budgetUsd).toBe(40);
  });

  it("each company sees only its own usage", async () => {
    const s = await seed();
    const summary = await s.owner.query(api.aiUsage.summary, {});
    expect(summary.spentMicros).toBe(0);
    expect(summary.history).toEqual([]);
  });

  it("workspace deletion removes usage rows", async () => {
    const s = await seed();
    await s.spend(5);
    await s.owner.mutation(api.privacy.deleteWorkspace, { confirmName: "Acme" });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.usage()).toBeNull();
  });
});
