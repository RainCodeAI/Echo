// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Material = { name: string; quantity?: string; unit?: string; notes?: string };

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", { name: "Acme Roofing", createdAt: 0 });
    const ownerId = await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Dana", email: "d@a.com", role: "owner", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "office", companyId, name: "Pat", email: "p@a.com", role: "member", createdAt: 0 });
    const luis = await ctx.db.insert("teamMembers", { companyId, name: "Luis Garcia", pinHash: "x", isActive: true, createdAt: 0 });
    const job = await ctx.db.insert("jobs", {
      companyId, title: "Ramirez reroof", status: "in_progress", address: "12 Oak St", createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    const quietJob = await ctx.db.insert("jobs", {
      companyId, title: "Chen gutters", status: "scheduled", createdBy: ownerId, createdAt: 0, updatedAt: 0,
    });
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    const otherOwner = await ctx.db.insert("users", { clerkUserId: "other", companyId: other, name: "Olly", email: "o@o.com", role: "owner", createdAt: 0 });
    const otherJob = await ctx.db.insert("jobs", {
      companyId: other, title: "Other job", status: "scheduled", createdBy: otherOwner, createdAt: 0, updatedAt: 0,
    });
    return { companyId, job, quietJob, luis, other, otherJob };
  });
  const addNote = (opts: { jobId?: Id<"jobs">; materials: Material[]; at: number; status?: "ready" | "archived"; companyId?: Id<"companies"> }) =>
    t.run((ctx) =>
      ctx.db.insert("voiceNotes", {
        companyId: opts.companyId ?? ids.companyId,
        teamMemberId: opts.companyId ? undefined : ids.luis,
        status: opts.status ?? "ready",
        rawTranscript: "x",
        aiTitle: `Note at ${opts.at}`,
        recordedAt: opts.at,
        aiStatus: "completed",
        jobId: opts.jobId,
        materials: opts.materials,
        createdAt: opts.at,
        updatedAt: opts.at,
      }),
    );
  return { t, ...ids, addNote, owner: t.withIdentity({ subject: "owner" }), office: t.withIdentity({ subject: "office" }), otherOwner: t.withIdentity({ subject: "other" }) };
}

const pick = (lines: { key: string; quantityLabel: string }[]) => lines.map(({ key, quantityLabel }) => ({ key, quantityLabel }));

describe("forJob", () => {
  it("merges materials across the job's notes, skipping archived notes and other jobs", async () => {
    const s = await seed();
    await s.addNote({ jobId: s.job, at: 1, materials: [{ name: "Architectural shingles", quantity: "12", unit: "bundles", notes: "Charcoal" }] });
    await s.addNote({ jobId: s.job, at: 2, materials: [{ name: "architectural shingle", quantity: "3", unit: "bundle" }, { name: "Drip edge", quantity: "40", unit: "ft" }] });
    await s.addNote({ jobId: s.job, at: 3, status: "archived", materials: [{ name: "Architectural shingles", quantity: "99", unit: "bundles" }] });
    await s.addNote({ jobId: s.quietJob, at: 4, materials: [{ name: "Gutter", quantity: "60", unit: "ft" }] });
    await s.addNote({ jobId: s.otherJob, companyId: s.other, at: 5, materials: [{ name: "OTHER COMPANY ITEM", quantity: "1" }] });

    const r = await s.owner.query(api.materials.forJob, { jobId: s.job });
    expect(r.job).toMatchObject({ title: "Ramirez reroof", address: "12 Oak St" });
    expect(r.companyName).toBe("Acme Roofing");
    expect(r.toOrder.map((l) => [l.name, l.quantityLabel])).toEqual([
      ["Architectural shingles", "15 bundles"],
      ["Drip edge", "40 ft"],
    ]);
    expect(r.toOrder[0].sources.map((x) => x.crewName)).toEqual(["Luis Garcia", "Luis Garcia"]);
    expect(JSON.stringify(r)).not.toContain("OTHER COMPANY ITEM");
  });

  it("is tenant-scoped", async () => {
    const s = await seed();
    await expect(s.otherOwner.query(api.materials.forJob, { jobId: s.job })).rejects.toThrow(/Not found/);
    await expect(s.owner.query(api.materials.forJob, { jobId: s.otherJob })).rejects.toThrow(/Not found/);
  });
});

describe("markOrdered / undoOrder", () => {
  it("moves ordered lines off the list, records history, and undo brings them back", async () => {
    const s = await seed();
    await s.addNote({ jobId: s.job, at: 1, materials: [{ name: "Shingles", quantity: "12", unit: "bundles" }, { name: "Drip edge", quantity: "40", unit: "ft" }] });
    const before = await s.owner.query(api.materials.forJob, { jobId: s.job });
    const shingles = before.toOrder.filter((l) => l.name === "Shingles");

    // Office users can place orders too.
    const orderId = await s.office.mutation(api.materials.markOrdered, { jobId: s.job, lines: pick(shingles) });
    const after = await s.owner.query(api.materials.forJob, { jobId: s.job });
    expect(after.toOrder.map((l) => l.name)).toEqual(["Drip edge"]);
    expect(after.ordered.map((l) => [l.name, l.quantityLabel])).toEqual([["Shingles", "12 bundles"]]);
    expect(after.history).toMatchObject([{ orderId, createdByName: "Pat", lines: [{ name: "Shingles", quantity: "12 bundles" }] }]);

    await s.owner.mutation(api.materials.undoOrder, { orderId });
    const undone = await s.owner.query(api.materials.forJob, { jobId: s.job });
    expect(undone.toOrder.map((l) => l.name)).toEqual(["Drip edge", "Shingles"]);
    expect(undone.history).toEqual([]);
  });

  it("a later note asking for more of an ordered item shows up again", async () => {
    const s = await seed();
    await s.addNote({ jobId: s.job, at: 1, materials: [{ name: "Shingles", quantity: "12", unit: "bundles" }] });
    const first = await s.owner.query(api.materials.forJob, { jobId: s.job });
    await s.owner.mutation(api.materials.markOrdered, { jobId: s.job, lines: pick(first.toOrder) });
    await s.addNote({ jobId: s.job, at: 2, materials: [{ name: "shingles", quantity: "3", unit: "bundles" }] });
    const r = await s.owner.query(api.materials.forJob, { jobId: s.job });
    expect(r.toOrder.map((l) => l.quantityLabel)).toEqual(["3 bundles"]);
    expect(r.ordered.map((l) => l.quantityLabel)).toEqual(["12 bundles"]);
  });

  it("refuses when the list changed since it was shown", async () => {
    const s = await seed();
    await s.addNote({ jobId: s.job, at: 1, materials: [{ name: "Shingles", quantity: "12", unit: "bundles" }] });
    const shown = await s.owner.query(api.materials.forJob, { jobId: s.job });
    await s.addNote({ jobId: s.job, at: 2, materials: [{ name: "Shingles", quantity: "3", unit: "bundles" }] });
    await expect(s.owner.mutation(api.materials.markOrdered, { jobId: s.job, lines: pick(shown.toOrder) })).rejects.toThrow(/just changed/);
    await expect(
      s.owner.mutation(api.materials.markOrdered, { jobId: s.job, lines: [{ key: "nails|box", quantityLabel: "2 boxes" }] }),
    ).rejects.toThrow(/just changed/);
    await expect(s.owner.mutation(api.materials.markOrdered, { jobId: s.job, lines: [] })).rejects.toThrow(/at least one/);
    const r = await s.owner.query(api.materials.forJob, { jobId: s.job });
    expect(r.history).toEqual([]);
  });

  it("other companies can't order against or undo this company's orders", async () => {
    const s = await seed();
    await s.addNote({ jobId: s.job, at: 1, materials: [{ name: "Shingles", quantity: "12", unit: "bundles" }] });
    const shown = await s.owner.query(api.materials.forJob, { jobId: s.job });
    await expect(s.otherOwner.mutation(api.materials.markOrdered, { jobId: s.job, lines: pick(shown.toOrder) })).rejects.toThrow(/Not found/);
    const orderId = await s.owner.mutation(api.materials.markOrdered, { jobId: s.job, lines: pick(shown.toOrder) });
    await expect(s.otherOwner.mutation(api.materials.undoOrder, { orderId })).rejects.toThrow(/Not found/);
    expect((await s.owner.query(api.materials.forJob, { jobId: s.job })).history).toHaveLength(1);
  });
});

describe("overview", () => {
  it("lists jobs with materials (to-order first) and counts unlinked notes", async () => {
    const s = await seed();
    await s.addNote({ jobId: s.job, at: 1, materials: [{ name: "Shingles", quantity: "12", unit: "bundles" }] });
    await s.addNote({ jobId: s.quietJob, at: 5, materials: [{ name: "Gutter", quantity: "60", unit: "ft" }] });
    await s.addNote({ at: 6, materials: [{ name: "Caulk", quantity: "2", unit: "tubes" }] });
    await s.addNote({ at: 7, status: "archived", materials: [{ name: "Caulk", quantity: "2", unit: "tubes" }] });
    await s.addNote({ jobId: s.otherJob, companyId: s.other, at: 8, materials: [{ name: "x", quantity: "1" }] });

    const quiet = await s.owner.query(api.materials.forJob, { jobId: s.quietJob });
    await s.owner.mutation(api.materials.markOrdered, { jobId: s.quietJob, lines: pick(quiet.toOrder) });

    const r = await s.owner.query(api.materials.overview, {});
    expect(r.unlinkedNotes).toBe(1);
    expect(r.jobs.map((j) => [j.title, j.toOrder, j.ordered, j.noteCount])).toEqual([
      ["Ramirez reroof", 1, 0, 1],
      ["Chen gutters", 0, 1, 1],
    ]);
  });
});
