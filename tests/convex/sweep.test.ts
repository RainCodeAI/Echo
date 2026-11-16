// @vitest-environment edge-runtime
/** Regression tests for issues found in the November bug sweep. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { hashPin } from "../../convex/lib/pin";
import { makeTest } from "./setup";

let fetches: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  process.env.ENTRY_TOKEN_SECRET = "test-entry-secret-please-32-bytes-long!!";
  process.env.OPENAI_API_KEY = "sk-test";
  fetches = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
    fetches.push(String(u instanceof Request ? u.url : u));
    return new Response("{}", { status: 500 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete process.env.OPENAI_API_KEY;
});

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0, notificationsEnabled: true });
    await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana", email: "d@a.com", role: "owner", createdAt: 0 });
    const luis = await ctx.db.insert("teamMembers", { companyId, name: "Luis", pinHash: await hashPin(companyId, "1234"), isActive: true, createdAt: 0 });
    return { companyId, luis };
  });
  const signIn = async (pin: string) => {
    const r = await t.mutation(api.teamMembers.verifyPin, { companyId: ids.companyId, pin });
    if (!r.ok) throw new Error(r.error);
    return { companyId: ids.companyId, teamMemberId: r.member.id, verificationToken: r.verificationToken };
  };
  return { t, ...ids, signIn, owner: t.withIdentity({ subject: "owner" }) };
}

describe("F2: crew sessions end when their PIN stops being valid", () => {
  it("switching the company to 6-digit PINs signs out 4-digit sessions", async () => {
    const s = await seed();
    const session = await s.signIn("1234");
    await s.t.mutation(api.voiceNotes.generateFieldUploadUrl, session);
    vi.advanceTimersByTime(1000);
    await s.owner.mutation(api.companies.setPinLength, { length: 6 });
    await expect(s.t.mutation(api.voiceNotes.generateFieldUploadUrl, session)).rejects.toThrow(/PIN/);
  });

  it("resetting a crew member's PIN signs out their existing sessions; the new PIN works", async () => {
    const s = await seed();
    const old = await s.signIn("1234");
    vi.advanceTimersByTime(1000);
    await s.owner.mutation(api.teamMembers.update, { memberId: s.luis, pin: "8642" });
    await expect(s.t.mutation(api.voiceNotes.generateFieldUploadUrl, old)).rejects.toThrow(/PIN/);
    vi.advanceTimersByTime(1000);
    const fresh = await s.signIn("8642");
    await expect(s.t.mutation(api.voiceNotes.generateFieldUploadUrl, fresh)).resolves.toBeTruthy();
  });

  it("editing a name or role doesn't sign anyone out", async () => {
    const s = await seed();
    const session = await s.signIn("1234");
    vi.advanceTimersByTime(1000);
    await s.owner.mutation(api.teamMembers.update, { memberId: s.luis, name: "Luis G", role: "Foreman" });
    await expect(s.t.mutation(api.voiceNotes.generateFieldUploadUrl, session)).resolves.toBeTruthy();
  });
});

describe("F3: nothing runs or reappears for a workspace being deleted", () => {
  it("queued AI work does nothing and leaves no usage/alert rows behind", async () => {
    const s = await seed();
    const noteId = await s.t.run((ctx) =>
      ctx.db.insert("voiceNotes", {
        companyId: s.companyId, teamMemberId: s.luis, status: "ready", rawTranscript: "tarp the roof leak now please", recordedAt: 0,
        aiStatus: "pending", workerFlaggedUrgent: true, createdAt: 0, updatedAt: 0,
      }),
    );
    await s.owner.mutation(api.privacy.deleteWorkspace, { confirmName: "Acme" });
    // The AI run that was queued before deletion fires now.
    await s.t.action(internal.ai.processNoteInternal, { noteId });
    expect(fetches).toEqual([]);
    // A usage record or alert result arriving late must not recreate rows.
    await s.t.mutation(internal.aiUsage.record, { companyId: s.companyId, kind: "structure", model: "gpt-4o-mini", inputTokens: 10, outputTokens: 10 });
    await s.t.mutation(internal.alerts.recordResults, { companyId: s.companyId, noteId, results: [{ channel: "email", recipient: "d***@a.com", status: "sent" }] });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const leftovers = await s.t.run(async (ctx) => ({
      company: await ctx.db.get(s.companyId),
      usage: await ctx.db.query("aiUsage").collect(),
      alerts: await ctx.db.query("alerts").collect(),
      notes: await ctx.db.query("voiceNotes").collect(),
    }));
    expect(leftovers).toEqual({ company: null, usage: [], alerts: [], notes: [] });
  });
});

describe("F1: owner actions respect a workspace being deleted", () => {
  it("send test alert / send digest now refuse once deletion has started", async () => {
    const s = await seed();
    await s.owner.mutation(api.privacy.deleteWorkspace, { confirmName: "Acme" });
    await expect(s.owner.action(api.alerts.sendTestAlert, {})).rejects.toThrow(/deleted/);
    await expect(s.owner.action(api.digest.sendNow, {})).rejects.toThrow(/deleted/);
  });
});
