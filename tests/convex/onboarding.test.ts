// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeTest } from "./setup";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 16, 15));
});
afterEach(() => vi.useRealTimers());

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Dana's Company", createdAt: 0, timezone: "UTC", digestEnabled: true, digestHour: 15 });
    await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana", email: "d@a.com", role: "owner", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "pat", companyId, name: "Pat", email: "p@a.com", role: "member", createdAt: 0 });
    return { companyId };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "owner" }), member: t.withIdentity({ subject: "pat" }) };
}

const done = async (s: Awaited<ReturnType<typeof seed>>) =>
  Object.fromEntries((await s.owner.query(api.onboarding.status, {}))!.steps.map((x) => [x.id, x.done]));

describe("checklist", () => {
  it("follows real setup: profile, crew, sharing, first crew note, alerts", async () => {
    const s = await seed();
    expect(await done(s)).toEqual({ profile: false, crew: false, share: false, firstNote: false, alerts: false });

    await s.owner.mutation(api.companies.update, { name: "Acme Roofing", primaryTrade: "roofing" });
    await s.owner.mutation(api.teamMembers.create, { name: "Luis", pin: "4821" });
    await s.owner.mutation(api.onboarding.markShared, {});
    // The sample note doesn't count as the first real note.
    await s.owner.mutation(api.onboarding.createSampleNote, {});
    expect(await done(s)).toEqual({ profile: true, crew: true, share: true, firstNote: false, alerts: false });

    await s.t.run(async (ctx) => {
      const crew = (await ctx.db.query("teamMembers").first())!;
      await ctx.db.insert("voiceNotes", { companyId: s.companyId, teamMemberId: crew._id, status: "ready", rawTranscript: "x", recordedAt: 1, aiStatus: "pending", createdAt: 1, updatedAt: 1 });
    });
    const status = (await s.owner.query(api.onboarding.status, {}))!;
    expect(status).toMatchObject({ requiredDone: 4, allRequiredDone: true, isOwner: true, dismissed: false });
  });

  it("owner hides and reopens it; members can't change it", async () => {
    const s = await seed();
    await expect(s.member.mutation(api.onboarding.setDismissed, { dismissed: true })).rejects.toThrow(/owner/);
    await expect(s.member.mutation(api.onboarding.markShared, {})).rejects.toThrow(/owner/);
    expect((await s.member.query(api.onboarding.status, {}))?.isOwner).toBe(false);
    await s.owner.mutation(api.onboarding.setDismissed, { dismissed: true });
    expect((await s.owner.query(api.onboarding.status, {}))?.dismissed).toBe(true);
    await s.owner.mutation(api.onboarding.setDismissed, { dismissed: false });
    expect((await s.owner.query(api.onboarding.status, {}))?.dismissed).toBe(false);
  });
});

describe("sample note", () => {
  it("creates one structured note without calling AI, and returns the same one again", async () => {
    const s = await seed();
    await expect(s.member.mutation(api.onboarding.createSampleNote, {})).rejects.toThrow(/owner/);
    const id = await s.owner.mutation(api.onboarding.createSampleNote, {});
    expect(await s.owner.mutation(api.onboarding.createSampleNote, {})).toBe(id);
    const note = await s.owner.query(api.voiceNotes.get, { noteId: id });
    expect(note).toMatchObject({ isSample: true, aiStatus: "completed", aiTitle: expect.stringMatching(/tear-off/i) });
    expect(note?.materials).toHaveLength(3);
    const scheduled = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);
    expect((await s.owner.query(api.onboarding.status, {}))?.sampleNoteId).toBe(id);

    await s.owner.mutation(api.privacy.deleteNote, { noteId: id });
    expect((await s.owner.query(api.onboarding.status, {}))?.sampleNoteId).toBeNull();
  });

  it("is left out of the daily digest", async () => {
    const s = await seed();
    await s.owner.mutation(api.onboarding.createSampleNote, {});
    const payload = await s.t.query(internal.digest.payload, { companyId: s.companyId, now: Date.now(), dateLabel: "Mon, Nov 16" });
    // With only the sample, the day is "quiet" (nothing sent).
    expect(payload?.quiet).toBe(true);
  });
});
