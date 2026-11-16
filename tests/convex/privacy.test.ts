// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { hashPin } from "../../convex/lib/pin";
import { RECORDING_NOTICE_VERSION, TERMS_VERSION } from "../../convex/lib/privacy";
import { makeTest } from "./setup";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.ENTRY_TOKEN_SECRET = "test-entry-secret-please-32-bytes-long!!";
});
afterEach(() => vi.useRealTimers());

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const mk = async (name: string, owner: string, member: string | null, pin: string) => {
      const companyId = await ctx.db.insert("companies", { name, createdAt: 0, digestEnabled: true, notificationsEnabled: true });
      const ownerId = await ctx.db.insert("users", { clerkUserId: owner, companyId, name: `${name} owner`, email: `${owner}@x.com`, role: "owner", createdAt: 0 });
      if (member) await ctx.db.insert("users", { clerkUserId: member, companyId, name: "Pat", email: `${member}@x.com`, role: "member", createdAt: 0 });
      const crew = await ctx.db.insert("teamMembers", { companyId, name: "Luis", pinHash: await hashPin(companyId, pin), isActive: true, createdAt: 0 });
      await ctx.db.insert("fieldUploadQuota", { teamMemberId: crew, windowStartedAt: 0, count: 1 });
      const leadId = await ctx.db.insert("leads", {
        companyId, customerName: "Maria", phone: "555", serviceType: "roofing", description: "d", status: "new", urgency: "low", createdBy: ownerId, createdAt: 0, updatedAt: 0,
      });
      const jobId = await ctx.db.insert("jobs", { companyId, leadId, title: `${name} job`, status: "scheduled", createdBy: ownerId, createdAt: 0, updatedAt: 0 });
      const audio = await ctx.storage.store(new Blob(["audio"]));
      const photoFile = await ctx.storage.store(new Blob(["jpg"]));
      const noteId = await ctx.db.insert("voiceNotes", {
        companyId, teamMemberId: crew, jobId, status: "ready", rawTranscript: `${name} transcript`, recordedAt: 0, aiStatus: "completed",
        audioStorageId: audio, clientUploadId: "c1", createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("voiceNotePhotos", { companyId, voiceNoteId: noteId, storageId: photoFile, createdAt: 0 });
      await ctx.db.insert("alerts", { companyId, noteId, channel: "email", recipient: "o***@x.com", status: "sent", createdAt: 0 });
      await ctx.db.insert("materialOrders", { companyId, jobId, lines: [], covers: [], createdBy: ownerId, createdAt: 0 });
      await ctx.db.insert("customerUpdates", {
        companyId, jobId, noteId, sourceNoteIds: [noteId], status: "sent", createdBy: ownerId, createdAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("invites", { companyId, email: "new@x.com", role: "member", status: "pending", invitedBy: ownerId, createdAt: 0 });
      return { companyId, crew, noteId, audio, photoFile };
    };
    return { a: await mk("Acme Roofing", "owner", "member", "1234"), b: await mk("Other Co", "other", null, "1234") };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "owner" }), member: t.withIdentity({ subject: "member" }), other: t.withIdentity({ subject: "other" }) };
}

async function countFor(t: ReturnType<typeof makeTest>, companyId: Id<"companies">) {
  return await t.run(async (ctx) => {
    const n: Record<string, number> = {};
    for (const table of ["users", "teamMembers", "leads", "jobs", "voiceNotes", "voiceNotePhotos", "invites"] as const) {
      n[table] = (await ctx.db.query(table).withIndex("by_company", (q) => q.eq("companyId", companyId)).collect()).length;
    }
    n.alerts = (await ctx.db.query("alerts").withIndex("by_company_and_created", (q) => q.eq("companyId", companyId)).collect()).length;
    n.customerUpdates = (await ctx.db.query("customerUpdates").withIndex("by_company_and_created", (q) => q.eq("companyId", companyId)).collect()).length;
    n.materialOrders = (await ctx.db.query("materialOrders").withIndex("by_company_and_job", (q) => q.eq("companyId", companyId)).collect()).length;
    n.company = (await ctx.db.get(companyId)) ? 1 : 0;
    return n;
  });
}

describe("terms acceptance", () => {
  it("owner accepts the current version; members can't", async () => {
    const s = await seed();
    expect(await s.owner.query(api.privacy.status, {})).toMatchObject({ isOwner: true, termsAccepted: false, termsVersion: TERMS_VERSION });
    expect(await s.member.query(api.privacy.status, {})).toMatchObject({ isOwner: false, termsAccepted: false });
    await expect(s.member.mutation(api.privacy.acceptTerms, { version: TERMS_VERSION })).rejects.toThrow(/owner/);
    await expect(s.owner.mutation(api.privacy.acceptTerms, { version: "1999-01-01" })).rejects.toThrow(/updated/);
    await s.owner.mutation(api.privacy.acceptTerms, { version: TERMS_VERSION });
    expect(await s.member.query(api.privacy.status, {})).toMatchObject({ termsAccepted: true });
  });
});

describe("crew recording notice", () => {
  it("is required once per crew member and recorded with its version", async () => {
    const s = await seed();
    const first = await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.a.companyId, pin: "1234" });
    if (!first.ok) throw new Error("pin failed");
    expect(first.needsNotice).toBe(true);
    const session = { companyId: s.a.companyId, teamMemberId: first.member.id, verificationToken: first.verificationToken };
    expect(await s.t.query(api.teamMembers.noticeStatus, session)).toEqual({ needsNotice: true });

    await expect(s.t.mutation(api.teamMembers.acknowledgeNotice, { ...session, version: "old" })).rejects.toThrow(/updated/);
    await expect(
      s.t.mutation(api.teamMembers.acknowledgeNotice, { ...session, verificationToken: "forged", version: RECORDING_NOTICE_VERSION }),
    ).rejects.toThrow(/Session/);
    await s.t.mutation(api.teamMembers.acknowledgeNotice, { ...session, version: RECORDING_NOTICE_VERSION });

    const again = await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.a.companyId, pin: "1234" });
    expect(again.ok && again.needsNotice).toBe(false);
    expect(await s.t.query(api.teamMembers.noticeStatus, session)).toEqual({ needsNotice: false });
    expect(await s.t.query(api.teamMembers.noticeStatus, { ...session, verificationToken: "bad" })).toBeNull();
    const member = await s.t.run((ctx) => ctx.db.get(s.a.crew));
    expect(member).toMatchObject({ noticeVersion: RECORDING_NOTICE_VERSION, noticeAcceptedAt: expect.any(Number) });
  });
});

describe("deleteNote", () => {
  it("removes the note, its audio, photos and alert log; owner only, own company only", async () => {
    const s = await seed();
    await expect(s.member.mutation(api.privacy.deleteNote, { noteId: s.a.noteId })).rejects.toThrow(/owner/);
    await expect(s.other.mutation(api.privacy.deleteNote, { noteId: s.a.noteId })).rejects.toThrow(/Not found/);
    await s.owner.mutation(api.privacy.deleteNote, { noteId: s.a.noteId });
    const left = await s.t.run(async (ctx) => ({
      note: await ctx.db.get(s.a.noteId),
      audio: await ctx.storage.get(s.a.audio),
      photo: await ctx.storage.get(s.a.photoFile),
      photos: await ctx.db.query("voiceNotePhotos").withIndex("by_note", (q) => q.eq("voiceNoteId", s.a.noteId)).collect(),
      alerts: await ctx.db.query("alerts").withIndex("by_note", (q) => q.eq("noteId", s.a.noteId)).collect(),
      otherNote: await ctx.db.get(s.b.noteId),
    }));
    expect(left).toMatchObject({ note: null, audio: null, photo: null, photos: [], alerts: [] });
    expect(left.otherNote).not.toBeNull();
  });
});

describe("exportPage", () => {
  it("owner only, this company only, without PIN hashes or sign-in ids, with media links", async () => {
    const s = await seed();
    await expect(s.member.query(api.privacy.exportPage, { table: "voiceNotes", cursor: null })).rejects.toThrow(/owner/);

    const notes = await s.owner.query(api.privacy.exportPage, { table: "voiceNotes", cursor: null });
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0]).toMatchObject({ rawTranscript: "Acme Roofing transcript", audioUrl: expect.stringContaining("http") });
    expect(notes.rows[0]).not.toHaveProperty("audioStorageId");
    expect(notes.rows[0]).not.toHaveProperty("clientUploadId");

    const crew = await s.owner.query(api.privacy.exportPage, { table: "teamMembers", cursor: null });
    expect(crew.rows[0]).not.toHaveProperty("pinHash");
    const users = await s.owner.query(api.privacy.exportPage, { table: "users", cursor: null });
    expect(users.rows.map((u) => (u as { email?: string }).email).sort()).toEqual(["member@x.com", "owner@x.com"]);
    expect(users.rows[0]).not.toHaveProperty("clerkUserId");

    const all = [];
    for (const table of ["voiceNotes", "voiceNotePhotos", "leads", "jobs", "teamMembers", "users", "materialOrders", "customerUpdates", "alerts"] as const) {
      const page = await s.owner.query(api.privacy.exportPage, { table, cursor: null });
      expect(page.rows.length, table).toBeGreaterThan(0);
      all.push(...page.rows);
    }
    expect(JSON.stringify(all)).not.toContain("Other Co");
  });

  it("pages through large tables", async () => {
    const s = await seed();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 250; i++) {
        await ctx.db.insert("voiceNotes", { companyId: s.a.companyId, status: "ready", rawTranscript: `n${i}`, recordedAt: i, aiStatus: "completed", createdAt: i, updatedAt: i });
      }
    });
    const first = await s.owner.query(api.privacy.exportPage, { table: "voiceNotes", cursor: null });
    expect(first.isDone).toBe(false);
    const second = await s.owner.query(api.privacy.exportPage, { table: "voiceNotes", cursor: first.continueCursor });
    expect(second.isDone).toBe(true);
    expect(first.rows.length + second.rows.length).toBe(251);
  });
});

describe("deleteWorkspace", () => {
  it("needs the owner and the exact name", async () => {
    const s = await seed();
    await expect(s.member.mutation(api.privacy.deleteWorkspace, { confirmName: "Acme Roofing" })).rejects.toThrow(/owner/);
    await expect(s.owner.mutation(api.privacy.deleteWorkspace, { confirmName: "Acme" })).rejects.toThrow(/exactly/);
    expect((await countFor(s.t, s.a.companyId)).company).toBe(1);
  });

  it("locks everyone out at once, then removes every row and file; other workspaces untouched", async () => {
    const s = await seed();
    const before = await countFor(s.t, s.b.companyId);
    await s.owner.mutation(api.privacy.deleteWorkspace, { confirmName: "  acme roofing " });

    // Immediately: office, field and public entry page are all closed.
    await expect(s.owner.query(api.privacy.status, {})).rejects.toThrow(/deleted/);
    await expect(s.member.query(api.voiceNotes.listForCompany, {})).rejects.toThrow(/deleted/);
    expect(await s.t.query(api.companies.publicProfile, { companyId: s.a.companyId })).toBeNull();
    expect(await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.a.companyId, pin: "1234" })).toMatchObject({ ok: false });
    const company = await s.t.run((ctx) => ctx.db.get(s.a.companyId));
    expect(company).toMatchObject({ digestEnabled: false, notificationsEnabled: false });

    await s.t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await countFor(s.t, s.a.companyId)).toEqual({
      users: 0, teamMembers: 0, leads: 0, jobs: 0, voiceNotes: 0, voiceNotePhotos: 0, invites: 0,
      alerts: 0, customerUpdates: 0, materialOrders: 0, company: 0,
    });
    const leftovers = await s.t.run(async (ctx) => ({
      audio: await ctx.storage.get(s.a.audio),
      photo: await ctx.storage.get(s.a.photoFile),
      quota: await ctx.db.query("fieldUploadQuota").withIndex("by_member", (q) => q.eq("teamMemberId", s.a.crew)).collect(),
      pin: await ctx.db.query("pinAttempts").withIndex("by_company", (q) => q.eq("companyId", s.a.companyId)).collect(),
      otherAudio: (await ctx.storage.get(s.b.audio)) !== null,
    }));
    expect(leftovers).toMatchObject({ audio: null, photo: null, quota: [], pin: [] });
    expect(leftovers.otherAudio).toBe(true);
    expect(await countFor(s.t, s.b.companyId)).toEqual(before);

    // Signing in again starts a fresh, empty workspace.
    await s.owner.mutation(api.users.store, {});
    const fresh = await s.owner.query(api.privacy.status, {});
    expect(fresh).toMatchObject({ isOwner: true, termsAccepted: false });
  });

  it("works through more rows than one batch", async () => {
    const s = await seed();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 230; i++) {
        await ctx.db.insert("voiceNotes", { companyId: s.a.companyId, status: "ready", rawTranscript: "x", recordedAt: i, aiStatus: "completed", createdAt: i, updatedAt: i });
      }
    });
    await s.owner.mutation(api.privacy.deleteWorkspace, { confirmName: "Acme Roofing" });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await countFor(s.t, s.a.companyId)).voiceNotes).toBe(0);
  });
});
