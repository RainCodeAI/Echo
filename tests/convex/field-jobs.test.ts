// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { buildFieldVerificationToken } from "../../convex/lib/fieldSession";
import { makeTest } from "./setup";

beforeEach(() => {
  process.env.ENTRY_TOKEN_SECRET = "test-entry-secret-please-32-bytes-long!!";
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] }); // don't run scheduled AI
});
afterEach(() => vi.useRealTimers());

async function seed() {
  const t = makeTest();
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    const ownerId = await ctx.db.insert("users", {
      clerkUserId: "owner", companyId, name: "O", email: "o@a.com", role: "owner", createdAt: 0,
    });
    const memberId = await ctx.db.insert("teamMembers", {
      companyId, name: "Luis", pinHash: "x", isActive: true, createdAt: 0,
    });
    const leadId = await ctx.db.insert("leads", {
      companyId, customerName: "Ramirez", phone: "555-0100", serviceType: "roofing",
      description: "", status: "scheduled", urgency: "medium", createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    const todayJob = await ctx.db.insert("jobs", {
      companyId, leadId, title: "Ramirez reroof", status: "scheduled", scheduledFor: now + 2 * 3600_000,
      address: "412 Oak St", notes: "gate code 4412", createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("jobs", {
      companyId, title: "Old finished job", status: "completed", createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    const otherCompany = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    const otherOwner = await ctx.db.insert("users", {
      clerkUserId: "other", companyId: otherCompany, name: "B", email: "b@b.com", role: "owner", createdAt: 0,
    });
    const foreignJob = await ctx.db.insert("jobs", {
      companyId: otherCompany, title: "Someone else's job", status: "in_progress", createdBy: otherOwner, createdAt: 0, updatedAt: 0,
    });
    return { companyId, memberId, leadId, todayJob, foreignJob };
  });
  const token = await buildFieldVerificationToken(ids.companyId, ids.memberId);
  return { t, ...ids, token };
}

describe("jobs.listForField", () => {
  it("returns this company's open jobs with crew-safe fields only", async () => {
    const { t, companyId, memberId, token, todayJob } = await seed();
    const result = await t.query(api.jobs.listForField, {
      companyId, teamMemberId: memberId, verificationToken: token,
    });
    expect(result?.today.map((j) => j.id)).toEqual([todayJob]);
    expect(result?.other).toEqual([]); // completed + foreign jobs excluded
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("gate code");
    expect(serialized).not.toContain("555-0100");
    expect(serialized).not.toContain("Someone else");
  });

  it("returns null (not an error) for a bad session", async () => {
    const { t, companyId, memberId } = await seed();
    const result = await t.query(api.jobs.listForField, {
      companyId, teamMemberId: memberId, verificationToken: "echo-entry:x:y:1:bad",
    });
    expect(result).toBeNull();
  });
});

describe("voiceNotes.createFromField with a job", () => {
  async function submit(s: Awaited<ReturnType<typeof seed>>, jobId?: Id<"jobs">, id = "u1") {
    const noteId = await s.t.mutation(api.voiceNotes.createFromField, {
      companyId: s.companyId,
      teamMemberId: s.memberId,
      verificationToken: s.token,
      rawTranscript: "north valley leak, need shingles",
      clientUploadId: id,
      recordedAt: Date.now(),
      jobId,
    });
    return s.t.run((ctx) => ctx.db.get(noteId));
  }

  it("links the job and the job's lead", async () => {
    const s = await seed();
    const note = await submit(s, s.todayJob);
    expect(note?.jobId).toBe(s.todayJob);
    expect(note?.leadId).toBe(s.leadId);
  });

  it("saves the note unlinked when the job belongs to another company", async () => {
    const s = await seed();
    const note = await submit(s, s.foreignJob as Id<"jobs">);
    expect(note).not.toBeNull();
    expect(note?.jobId).toBeUndefined();
    expect(note?.leadId).toBeUndefined();
  });

  it("saves the note unlinked when the job was deleted", async () => {
    const s = await seed();
    await s.t.run((ctx) => ctx.db.delete(s.todayJob));
    const note = await submit(s, s.todayJob);
    expect(note?.rawTranscript).toContain("north valley");
    expect(note?.jobId).toBeUndefined();
  });
});
