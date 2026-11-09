// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { buildFieldVerificationToken } from "../../convex/lib/fieldSession";
import { hashPin } from "../../convex/lib/pin";
import { MAX_UPLOADS_PER_WINDOW, UPLOAD_WINDOW_MS } from "../../convex/lib/uploadQuota";
import { classifyError } from "../../lib/offline/queue";
import { makeTest } from "./setup";

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

beforeEach(() => {
  process.env.ENTRY_TOKEN_SECRET = "test-entry-secret-please-32-bytes-long!!";
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

/** Two companies, each with an owner; A also has a member, crew and data. */
async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    const b = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    const ownerA = await ctx.db.insert("users", { clerkUserId: "owner-a", companyId: a, name: "OA", email: "oa@a.com", role: "owner", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "member-a", companyId: a, name: "MA", email: "ma@a.com", role: "member", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "owner-b", companyId: b, name: "OB", email: "ob@b.com", role: "owner", createdAt: 0 });
    const luis = await ctx.db.insert("teamMembers", { companyId: a, name: "Luis", pinHash: await hashPin(a, "1234"), isActive: true, createdAt: 0 });
    const ana = await ctx.db.insert("teamMembers", { companyId: a, name: "Ana", pinHash: await hashPin(a, "5678"), isActive: true, createdAt: 0 });
    const crewB = await ctx.db.insert("teamMembers", { companyId: b, name: "Bo", pinHash: await hashPin(b, "1234"), isActive: true, createdAt: 0 });
    const noteA = await ctx.db.insert("voiceNotes", { companyId: a, status: "ready", rawTranscript: "secret A note", recordedAt: 0, aiStatus: "completed", createdAt: 0, updatedAt: 0 });
    const leadA = await ctx.db.insert("leads", { companyId: a, customerName: "Ramirez", serviceType: "roofing", description: "", status: "new", urgency: "medium", createdBy: ownerA, createdAt: 0, updatedAt: 0 });
    const jobA = await ctx.db.insert("jobs", { companyId: a, title: "Reroof", status: "scheduled", createdBy: ownerA, createdAt: 0, updatedAt: 0 });
    return { a, b, luis, ana, crewB, noteA, leadA, jobA };
  });
  return {
    t,
    ...ids,
    ownerA: t.withIdentity({ subject: "owner-a" }),
    memberA: t.withIdentity({ subject: "member-a" }),
    ownerB: t.withIdentity({ subject: "owner-b" }),
  };
}

describe("PIN entry", () => {
  it("issues a token for a correct PIN", async () => {
    const { t, a } = await seed();
    const result = await t.mutation(api.teamMembers.verifyPin, { companyId: a, pin: "5678" });
    expect(result).toMatchObject({ ok: true, member: { name: "Ana" } });
  });

  it("locks out after 10 misses (even the right PIN), then escalates", async () => {
    const { t, a } = await seed();
    const fail10 = async () => {
      for (let i = 0; i < 10; i++) {
        await t.mutation(api.teamMembers.verifyPin, { companyId: a, pin: "0000" });
      }
    };
    await fail10();
    const locked = await t.mutation(api.teamMembers.verifyPin, { companyId: a, pin: "1234" });
    expect(locked).toMatchObject({ ok: false, error: expect.stringMatching(/Too many attempts/) });

    // First lockout lasts 1 minute.
    vi.setSystemTime(T0 + 61_000);
    await fail10();
    // Second consecutive lockout lasts 5 minutes: still locked after 2 minutes.
    vi.setSystemTime(T0 + 61_000 + 2 * 60_000);
    expect(await t.mutation(api.teamMembers.verifyPin, { companyId: a, pin: "1234" })).toMatchObject({ ok: false });
    vi.setSystemTime(T0 + 61_000 + 5 * 60_000 + 1_000);
    expect(await t.mutation(api.teamMembers.verifyPin, { companyId: a, pin: "1234" })).toMatchObject({ ok: true });
  });

  it("lockout on one company doesn't affect another", async () => {
    const { t, a, b } = await seed();
    for (let i = 0; i < 10; i++) await t.mutation(api.teamMembers.verifyPin, { companyId: a, pin: "0000" });
    expect(await t.mutation(api.teamMembers.verifyPin, { companyId: b, pin: "1234" })).toMatchObject({ ok: true });
  });
});

describe("field session checks", () => {
  const submit = (s: Awaited<ReturnType<typeof seed>>, args: { companyId: typeof s.a; teamMemberId: typeof s.luis; verificationToken: string }) =>
    s.t.mutation(api.voiceNotes.createFromField, {
      ...args,
      rawTranscript: "hello from the field",
      clientUploadId: crypto.randomUUID(),
      recordedAt: Date.now(),
    });

  it("accepts a valid token", async () => {
    const s = await seed();
    const token = await buildFieldVerificationToken(s.a, s.luis);
    await expect(submit(s, { companyId: s.a, teamMemberId: s.luis, verificationToken: token })).resolves.toBeTruthy();
  });

  it("rejects Luis's token used to post as Ana", async () => {
    const s = await seed();
    const token = await buildFieldVerificationToken(s.a, s.luis);
    await expect(submit(s, { companyId: s.a, teamMemberId: s.ana, verificationToken: token })).rejects.toThrow(/Session expired or invalid/);
  });

  it("rejects company A's token used against company B", async () => {
    const s = await seed();
    const token = await buildFieldVerificationToken(s.a, s.luis);
    await expect(submit(s, { companyId: s.b, teamMemberId: s.crewB, verificationToken: token })).rejects.toThrow(/Session expired or invalid/);
  });

  it("rejects a forged signature and an expired token", async () => {
    const s = await seed();
    const forged = (await buildFieldVerificationToken(s.a, s.luis)).replace(/:[0-9a-f]+$/, ":deadbeef");
    await expect(submit(s, { companyId: s.a, teamMemberId: s.luis, verificationToken: forged })).rejects.toThrow(/Session expired or invalid/);
    const old = await buildFieldVerificationToken(s.a, s.luis, T0 - 13 * 60 * 60 * 1000);
    await expect(submit(s, { companyId: s.a, teamMemberId: s.luis, verificationToken: old })).rejects.toThrow(/Session expired or invalid/);
  });

  it("cuts off a deactivated crew member immediately, despite a fresh token", async () => {
    const s = await seed();
    const token = await buildFieldVerificationToken(s.a, s.luis);
    await s.ownerA.mutation(api.teamMembers.update, { memberId: s.luis, isActive: false });
    await expect(submit(s, { companyId: s.a, teamMemberId: s.luis, verificationToken: token })).rejects.toThrow(/inactive/);
  });
});

describe("field upload limit", () => {
  it("caps upload URLs per crew member per hour, then resets", async () => {
    const s = await seed();
    const auth = { companyId: s.a, teamMemberId: s.luis, verificationToken: await buildFieldVerificationToken(s.a, s.luis) };
    for (let i = 0; i < MAX_UPLOADS_PER_WINDOW; i++) {
      await s.t.mutation(api.voiceNotes.generateFieldUploadUrl, auth);
    }
    let error: unknown;
    try {
      await s.t.mutation(api.voiceNotes.generateFieldUploadUrl, auth);
    } catch (err) {
      error = err;
    }
    expect(String(error)).toMatch(/Too many uploads/);
    // The phone's queue must treat this as "retry later", never as fatal.
    expect(classifyError(error)).toBe("transient");

    // Another crew member is unaffected.
    const anaAuth = { companyId: s.a, teamMemberId: s.ana, verificationToken: await buildFieldVerificationToken(s.a, s.ana) };
    await expect(s.t.mutation(api.voiceNotes.generateFieldUploadUrl, anaAuth)).resolves.toBeTruthy();

    vi.setSystemTime(T0 + UPLOAD_WINDOW_MS + 1);
    const fresh = { ...auth, verificationToken: await buildFieldVerificationToken(s.a, s.luis) };
    await expect(s.t.mutation(api.voiceNotes.generateFieldUploadUrl, fresh)).resolves.toBeTruthy();
  });
});

describe("cross-company isolation", () => {
  it("another company can't read company A's notes", async () => {
    const s = await seed();
    expect(await s.ownerB.query(api.voiceNotes.get, { noteId: s.noteA })).toBeNull();
    const listB = await s.ownerB.query(api.voiceNotes.listForCompany, {});
    expect(JSON.stringify(listB)).not.toContain("secret A note");
    expect(await s.ownerA.query(api.voiceNotes.get, { noteId: s.noteA })).not.toBeNull();
  });

  it("another company can't modify company A's records", async () => {
    const s = await seed();
    await expect(s.ownerB.mutation(api.voiceNotes.markReviewed, { noteId: s.noteA })).rejects.toThrow(/Not found/);
    await expect(s.ownerB.mutation(api.voiceNotes.setLinks, { noteId: s.noteA, jobId: null })).rejects.toThrow(/Not found/);
    await expect(s.ownerB.mutation(api.leads.update, { leadId: s.leadA, customerName: "x" })).rejects.toThrow(/Not found/);
    await expect(s.ownerB.mutation(api.jobs.update, { jobId: s.jobA, title: "x" })).rejects.toThrow(/Not found/);
    await expect(s.ownerB.mutation(api.teamMembers.update, { memberId: s.luis, pin: "9999" })).rejects.toThrow(/Not found/);
  });

  it("company A can't link its note to company B's records", async () => {
    const s = await seed();
    const jobB = await s.t.run(async (ctx) => {
      const ownerB = (await ctx.db.query("users").collect()).find((u) => u.clerkUserId === "owner-b")!;
      return ctx.db.insert("jobs", { companyId: s.b, title: "B job", status: "scheduled", createdBy: ownerB._id, createdAt: 0, updatedAt: 0 });
    });
    await expect(s.ownerA.mutation(api.voiceNotes.setLinks, { noteId: s.noteA, jobId: jobB })).rejects.toThrow(/Not found/);
  });

  it("signed-out callers get nothing", async () => {
    const s = await seed();
    await expect(s.t.query(api.voiceNotes.listForCompany, {})).rejects.toThrow(/Not authenticated/);
  });
});

describe("owner-only actions", () => {
  it("members can't change company settings or invite people; owners can", async () => {
    const s = await seed();
    await expect(s.memberA.mutation(api.companies.update, { name: "Hijacked" })).rejects.toThrow(/Only the workspace owner/);
    await expect(s.memberA.mutation(api.invites.create, { email: "x@y.com" })).rejects.toThrow(/Only the workspace owner/);
    await expect(s.ownerA.mutation(api.companies.update, { name: "Acme Roofing" })).resolves.toBeTruthy();
    await expect(s.ownerA.mutation(api.invites.create, { email: "new@acme.com" })).resolves.toBeTruthy();
  });
});
