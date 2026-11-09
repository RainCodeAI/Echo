// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  delete process.env.STORAGE_CLEANUP_DISABLED;
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.STORAGE_CLEANUP_DISABLED;
});

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const store = (text: string) => ctx.storage.store(new Blob([text]));
    const audio = await store("audio");
    const photo = await store("photo");
    const orphan = await store("orphan");
    const companyId = await ctx.db.insert("companies", { name: "Acme", createdAt: 0 });
    const noteId = await ctx.db.insert("voiceNotes", {
      companyId, status: "ready", rawTranscript: "x", recordedAt: 0, aiStatus: "completed",
      audioStorageId: audio, createdAt: 0, updatedAt: 0,
    });
    await ctx.db.insert("voiceNotePhotos", { companyId, voiceNoteId: noteId, storageId: photo, createdAt: 0 });
    return { audio, photo, orphan };
  });
  // An orphan uploaded an hour later: inside the grace period for this run.
  vi.setSystemTime(T0 + HOUR);
  const recentOrphan = await t.run((ctx) => ctx.storage.store(new Blob(["recent"])));
  return { t, ...ids, recentOrphan, cutoff: T0 + 60_000 };
}

const exists = (t: ReturnType<typeof makeTest>, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);

describe("cleanupOrphanedUploads", () => {
  it("deletes only old, unreferenced files", async () => {
    const { t, audio, photo, orphan, recentOrphan, cutoff } = await seed();
    const result = await t.mutation(internal.storageCleanup.cleanupOrphanedUploads, { cutoff });
    expect(result).toMatchObject({ done: true, deleted: 1 });
    expect(await exists(t, orphan)).toBe(false);
    expect(await exists(t, audio)).toBe(true); // referenced by a note's audio
    expect(await exists(t, photo)).toBe(true); // referenced by a photo row
    expect(await exists(t, recentOrphan)).toBe(true); // inside the grace period
  });

  it("dry run reports without deleting", async () => {
    const { t, orphan, cutoff } = await seed();
    const result = await t.mutation(internal.storageCleanup.cleanupOrphanedUploads, {
      cutoff,
      dryRun: true,
    });
    expect(result).toMatchObject({ deleted: 1, dryRun: true });
    expect(await exists(t, orphan)).toBe(true);
  });

  it("uses a 24h grace period by default", async () => {
    const { t, orphan } = await seed();
    // Now = T0 + 1h: nothing is 24h old yet.
    await t.mutation(internal.storageCleanup.cleanupOrphanedUploads, {});
    expect(await exists(t, orphan)).toBe(true);
    vi.setSystemTime(T0 + 25 * HOUR);
    await t.mutation(internal.storageCleanup.cleanupOrphanedUploads, {});
    expect(await exists(t, orphan)).toBe(false);
  });

  it("can be switched off with STORAGE_CLEANUP_DISABLED=1", async () => {
    const { t, orphan, cutoff } = await seed();
    process.env.STORAGE_CLEANUP_DISABLED = "1";
    expect(
      await t.mutation(internal.storageCleanup.cleanupOrphanedUploads, { cutoff }),
    ).toEqual({ skipped: true });
    expect(await exists(t, orphan)).toBe(true);
  });

  it("continues across batches until every old orphan is gone", async () => {
    const t = makeTest();
    const ids = await t.run(async (ctx) => {
      const out: Id<"_storage">[] = [];
      for (let i = 0; i < 205; i++) out.push(await ctx.storage.store(new Blob([`f${i}`])));
      return out;
    });
    vi.setSystemTime(T0 + 25 * HOUR);
    const first = await t.mutation(internal.storageCleanup.cleanupOrphanedUploads, {});
    expect(first).toMatchObject({ done: false, deleted: 200 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of [ids[0], ids[204]]) expect(await exists(t, id)).toBe(false);
  });
});
