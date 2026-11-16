// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { hashPin } from "../../convex/lib/pin";
import { makeTest } from "./setup";

beforeEach(() => {
  vi.useFakeTimers();
  process.env.ENTRY_TOKEN_SECRET = "test-entry-secret-please-32-bytes-long!!";
});
afterEach(() => vi.useRealTimers());

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana", email: "d@a.com", role: "owner", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "pat", companyId, name: "Pat", email: "p@a.com", role: "member", createdAt: 0 });
    const luis = await ctx.db.insert("teamMembers", { companyId, name: "Luis", pinHash: await hashPin(companyId, "1234"), isActive: true, createdAt: 0 });
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "olly", companyId: other, name: "Olly", email: "o@o.com", role: "owner", createdAt: 0 });
    return { companyId, luis, other };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "owner" }), member: t.withIdentity({ subject: "pat" }), olly: t.withIdentity({ subject: "olly" }) };
}

describe("6-digit PINs", () => {
  it("switching retires 4-digit PINs until reset; new PINs must be 6 digits", async () => {
    const s = await seed();
    expect(await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.companyId, pin: "1234" })).toMatchObject({ ok: true });
    await expect(s.member.mutation(api.companies.setPinLength, { length: 6 })).rejects.toThrow(/owner/);
    expect(await s.owner.mutation(api.companies.setPinLength, { length: 6 })).toEqual({ needNewPin: 1 });

    expect(await s.t.query(api.companies.publicProfile, { companyId: s.companyId })).toMatchObject({ pinLength: 6 });
    expect(await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.companyId, pin: "1234" })).toMatchObject({ ok: false, error: "PIN must be 6 digits." });
    expect((await s.owner.query(api.teamMembers.list, {}))[0]).toMatchObject({ name: "Luis", needsNewPin: true });

    await expect(s.owner.mutation(api.teamMembers.update, { memberId: s.luis, pin: "5678" })).rejects.toThrow(/exactly 6 digits/);
    await expect(s.owner.mutation(api.teamMembers.create, { name: "Ana", pin: "4321" })).rejects.toThrow(/exactly 6 digits/);
    await s.owner.mutation(api.teamMembers.update, { memberId: s.luis, pin: "246810" });
    await s.owner.mutation(api.teamMembers.create, { name: "Ana", pin: "135799" });
    expect((await s.owner.query(api.teamMembers.list, {})).map((m) => [m.name, m.needsNewPin])).toEqual([["Ana", false], ["Luis", false]]);

    const ok = await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.companyId, pin: "246810" });
    expect(ok).toMatchObject({ ok: true, member: { name: "Luis" } });
  });

  it("padded versions of an old 4-digit PIN don't get in on a 6-digit company", async () => {
    const s = await seed();
    await s.owner.mutation(api.companies.setPinLength, { length: 6 });
    // Same hash input as the old PIN padded/truncated never matches.
    for (const pin of ["123400", "001234", "1234"]) {
      expect((await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.companyId, pin })).ok).toBe(false);
    }
  });

  it("switching back to 4 flags the 6-digit members instead", async () => {
    const s = await seed();
    await s.owner.mutation(api.companies.setPinLength, { length: 6 });
    await s.owner.mutation(api.teamMembers.update, { memberId: s.luis, pin: "246810" });
    expect(await s.owner.mutation(api.companies.setPinLength, { length: 4 })).toEqual({ needNewPin: 1 });
    expect((await s.t.mutation(api.teamMembers.verifyPin, { companyId: s.companyId, pin: "2468" })).ok).toBe(false);
  });
});

describe("full-history search", () => {
  async function withNotes() {
    const s = await seed();
    await s.t.run(async (ctx) => {
      // The match is the OLDEST note, behind 250 newer ones (the old search only scanned the newest 200).
      await ctx.db.insert("voiceNotes", {
        companyId: s.companyId, teamMemberId: s.luis, status: "reviewed", rawTranscript: "found soft decking by the chimney",
        aiSummary: "Rotted decking near chimney.", aiTitle: "Chimney decking", recordedAt: 1, aiStatus: "completed", createdAt: 1, updatedAt: 1,
      });
      for (let i = 0; i < 250; i++) {
        await ctx.db.insert("voiceNotes", { companyId: s.companyId, status: "ready", rawTranscript: `gutter cleanout ${i}`, recordedAt: 10 + i, aiStatus: "completed", createdAt: 10 + i, updatedAt: 10 + i });
      }
      await ctx.db.insert("voiceNotes", {
        companyId: s.companyId, status: "ready", rawTranscript: "customer asked about the chimney cap", recordedAt: 999, aiStatus: "completed", createdAt: 999, updatedAt: 999,
      });
      await ctx.db.insert("voiceNotes", {
        companyId: s.other, status: "ready", rawTranscript: "OTHER COMPANY chimney", recordedAt: 5, aiStatus: "completed", createdAt: 5, updatedAt: 5,
      });
    });
    return s;
  }

  it("finds old notes, ranks multi-field matches first, stays in the company", async () => {
    const s = await withNotes();
    const hits = await s.owner.query(api.voiceNotes.listForCompany, { search: "chimney" });
    expect(hits.map((h) => h.rawTranscript)).toEqual(["found soft decking by the chimney", "customer asked about the chimney cap"]);
    expect(hits[0]).toMatchObject({ crewName: "Luis" });
    expect(JSON.stringify(hits)).not.toContain("OTHER COMPANY");
    expect((await s.olly.query(api.voiceNotes.listForCompany, { search: "chimney" })).map((h) => h.rawTranscript)).toEqual(["OTHER COMPANY chimney"]);
  });

  it("combines with status and crew filters", async () => {
    const s = await withNotes();
    expect((await s.owner.query(api.voiceNotes.listForCompany, { search: "chimney", status: "ready" })).map((h) => h.rawTranscript)).toEqual([
      "customer asked about the chimney cap",
    ]);
    expect((await s.owner.query(api.voiceNotes.listForCompany, { search: "chimney", teamMemberId: s.luis })).map((h) => h.aiTitle)).toEqual([
      "Chimney decking",
    ]);
    expect(await s.owner.query(api.voiceNotes.listForCompany, { search: "skylight" })).toEqual([]);
  });
});
