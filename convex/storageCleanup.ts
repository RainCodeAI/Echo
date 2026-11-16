import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Daily removal of uploaded files that no note references.
 *
 * Orphans come from abandoned field submits (upload succeeded, note never
 * created) and from uploads the server rejected (too large / too many) —
 * the field path deliberately never deletes files itself, because storage
 * ids there are client-supplied.
 *
 * Safety:
 *  - Only files older than ORPHAN_GRACE_MS are considered. A phone that
 *    uploaded and then lost signal for longer still recovers: the offline
 *    queue sees "upload was not found" and re-uploads from its own copy.
 *  - A file is kept if ANY table references it. Every table with a
 *    `_storage` field must be checked here (see the note in schema.ts).
 *  - `dryRun: true` reports what would be deleted without deleting:
 *      npx convex run storageCleanup:cleanupOrphanedUploads '{"dryRun":true}' --prod
 *  - Set STORAGE_CLEANUP_DISABLED=1 on the deployment to switch the cron off.
 */

export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

export const cleanupOrphanedUploads = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
    /** Files created at or before this time are eligible. Default: now − 24h. */
    cutoff: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    /** Running totals across continuation batches (for the final log line). */
    scanned: v.optional(v.number()),
    deleted: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (process.env.STORAGE_CLEANUP_DISABLED === "1") {
      return { skipped: true as const };
    }
    const cutoff = args.cutoff ?? Date.now() - ORPHAN_GRACE_MS;
    let scanned = args.scanned ?? 0;
    let deleted = args.deleted ?? 0;

    // `_storage` is ordered by creation time, oldest first.
    const page = await ctx.db.system
      .query("_storage")
      .paginate({ numItems: BATCH_SIZE, cursor: args.cursor ?? null });

    let reachedRecentFiles = false;
    for (const file of page.page) {
      if (file._creationTime > cutoff) {
        reachedRecentFiles = true; // everything after this is newer still
        break;
      }
      scanned++;
      const audioRef = await ctx.db
        .query("voiceNotes")
        .withIndex("by_audio_storage", (q) => q.eq("audioStorageId", file._id))
        .first();
      if (audioRef) continue;
      const photoRef = await ctx.db
        .query("voiceNotePhotos")
        .withIndex("by_storage", (q) => q.eq("storageId", file._id))
        .first();
      if (photoRef) continue;

      if (!args.dryRun) await ctx.storage.delete(file._id);
      deleted++;
    }

    const done = page.isDone || reachedRecentFiles;
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.storageCleanup.cleanupOrphanedUploads, {
        dryRun: args.dryRun,
        cutoff,
        cursor: page.continueCursor,
        scanned,
        deleted,
      });
    } else {
      console.log(
        `[storageCleanup] ${args.dryRun ? "DRY RUN — would delete" : "deleted"} ${deleted} orphaned file(s) of ${scanned} checked.`,
      );
    }
    return { done, scanned, deleted, dryRun: !!args.dryRun };
  },
});
