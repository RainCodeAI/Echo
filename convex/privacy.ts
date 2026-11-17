import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertSameCompany, getCurrentUser, requireCurrentUser, requireOwner } from "./lib/tenant";
import {
  DELETION_GRACE_MS,
  DELETION_ORDER,
  TERMS_VERSION,
  deletionConfirmationMatches,
  type DeletionTable,
} from "./lib/privacy";

/**
 * Privacy and data lifecycle: terms acceptance, permanent note deletion,
 * owner data export, and workspace deletion. See ARCHITECTURE §11g.
 */

// --- Terms ------------------------------------------------------------------

/** For the dashboard: does the owner still need to accept the current terms? */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const company = await ctx.db.get(user.companyId);
    return {
      isOwner: user.role === "owner",
      companyName: company?.name ?? "",
      termsVersion: TERMS_VERSION,
      termsAccepted: company?.termsVersion === TERMS_VERSION,
      termsAcceptedAt: company?.termsAcceptedAt ?? null,
    };
  },
});

export const acceptTerms = mutation({
  args: { version: v.string() },
  handler: async (ctx, args) => {
    const user = await requireOwner(ctx);
    if (args.version !== TERMS_VERSION) throw new Error("The terms were updated. Reload the page to read them.");
    await ctx.db.patch(user.companyId, {
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: Date.now(),
      termsAcceptedBy: user._id,
      updatedAt: Date.now(),
    });
    return null;
  },
});

// --- Deleting one note --------------------------------------------------------

async function deleteNoteData(ctx: MutationCtx, note: Doc<"voiceNotes">) {
  const photos = await ctx.db
    .query("voiceNotePhotos")
    .withIndex("by_note", (q) => q.eq("voiceNoteId", note._id))
    .collect();
  for (const p of photos) {
    await ctx.storage.delete(p.storageId).catch(() => undefined);
    await ctx.db.delete(p._id);
  }
  const alerts = await ctx.db
    .query("alerts")
    .withIndex("by_note", (q) => q.eq("noteId", note._id))
    .collect();
  for (const a of alerts) await ctx.db.delete(a._id);
  if (note.audioStorageId) await ctx.storage.delete(note.audioStorageId).catch(() => undefined);
  await ctx.db.delete(note._id);
}

/**
 * Permanently delete a note: its audio, photos, transcript and AI fields,
 * and its alert log. Owner only; archiving is the reversible option.
 */
export const deleteNote = mutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, args) => {
    const user = await requireOwner(ctx);
    const note = assertSameCompany(await ctx.db.get(args.noteId), user.companyId);
    await deleteNoteData(ctx, note);
    return null;
  },
});

// --- Export -------------------------------------------------------------------

const exportTable = v.union(
  v.literal("voiceNotes"),
  v.literal("voiceNotePhotos"),
  v.literal("leads"),
  v.literal("jobs"),
  v.literal("teamMembers"),
  v.literal("users"),
  v.literal("materialOrders"),
  v.literal("customerUpdates"),
  v.literal("alerts"),
);

const PAGE_SIZE = 200;

/** One page of one table for the owner's export (fields safe to hand out). */
export const exportPage = query({
  args: { table: exportTable, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    // Still allowed while deletion is pending, so the owner can take a copy.
    const user = await requireOwner(ctx, { allowPendingDeletion: true });
    const companyId = user.companyId;
    const opts = { cursor, numItems: PAGE_SIZE };
    const url = async (id: Id<"_storage"> | undefined) => (id ? await ctx.storage.getUrl(id) : null);

    switch (table) {
      case "voiceNotes": {
        const page = await ctx.db.query("voiceNotes").withIndex("by_company", (q) => q.eq("companyId", companyId)).paginate(opts);
        const rows = [];
        for (const { audioStorageId, clientUploadId: _c, aiStartedAt: _a, ...rest } of page.page) {
          rows.push({ ...rest, audioUrl: await url(audioStorageId) });
        }
        return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
      }
      case "voiceNotePhotos": {
        const page = await ctx.db.query("voiceNotePhotos").withIndex("by_company", (q) => q.eq("companyId", companyId)).paginate(opts);
        const rows = [];
        for (const { storageId, ...rest } of page.page) rows.push({ ...rest, url: await url(storageId) });
        return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
      }
      case "teamMembers": {
        const page = await ctx.db.query("teamMembers").withIndex("by_company", (q) => q.eq("companyId", companyId)).paginate(opts);
        // Never export PIN hashes.
        const rows = page.page.map(({ pinHash: _p, ...rest }) => rest);
        return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
      }
      case "users": {
        const page = await ctx.db.query("users").withIndex("by_company", (q) => q.eq("companyId", companyId)).paginate(opts);
        const rows = page.page.map(({ clerkUserId: _c, ...rest }) => rest);
        return { rows, isDone: page.isDone, continueCursor: page.continueCursor };
      }
      case "leads":
      case "jobs": {
        const page = await ctx.db.query(table).withIndex("by_company", (q) => q.eq("companyId", companyId)).paginate(opts);
        return { rows: page.page, isDone: page.isDone, continueCursor: page.continueCursor };
      }
      case "materialOrders": {
        const page = await ctx.db
          .query("materialOrders")
          .withIndex("by_company_and_job", (q) => q.eq("companyId", companyId))
          .paginate(opts);
        return { rows: page.page, isDone: page.isDone, continueCursor: page.continueCursor };
      }
      case "customerUpdates":
      case "alerts": {
        const page = await ctx.db
          .query(table)
          .withIndex("by_company_and_created", (q) => q.eq("companyId", companyId))
          .paginate(opts);
        return { rows: page.page, isDone: page.isDone, continueCursor: page.continueCursor };
      }
    }
  },
});

// --- Deleting the workspace ----------------------------------------------------

const BATCH = 100;

async function batchFor(ctx: QueryCtx, table: DeletionTable, companyId: Id<"companies">) {
    switch (table) {
    case "teamMembers":
      return await ctx.db.query("teamMembers").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "invites":
      return await ctx.db.query("invites").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "pinAttempts":
      return await ctx.db.query("pinAttempts").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "voiceNotePhotos":
      return await ctx.db.query("voiceNotePhotos").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "voiceNotes":
      return await ctx.db.query("voiceNotes").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "jobs":
      return await ctx.db.query("jobs").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "leads":
      return await ctx.db.query("leads").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "users":
      return await ctx.db.query("users").withIndex("by_company", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "aiUsage":
      return await ctx.db.query("aiUsage").withIndex("by_company_and_month", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "alerts":
      return await ctx.db.query("alerts").withIndex("by_company_and_created", (q) => q.eq("companyId", companyId)).take(BATCH);
    case "customerUpdates":
      return await ctx.db
        .query("customerUpdates")
        .withIndex("by_company_and_created", (q) => q.eq("companyId", companyId))
        .take(BATCH);
    case "materialOrders":
      return await ctx.db
        .query("materialOrders")
        .withIndex("by_company_and_job", (q) => q.eq("companyId", companyId))
        .take(BATCH);
  }
}

/**
 * Delete the whole workspace (owner only, after typing its name). Access stops
 * at once for everyone; the data is removed after a grace period, during which
 * the owner can cancel (or still export) from the dashboard.
 */
export const deleteWorkspace = mutation({
  args: { confirmName: v.string() },
  handler: async (ctx, args) => {
    const user = await requireOwner(ctx);
    const company = await ctx.db.get(user.companyId);
    if (!company) throw new Error("Not found");
    if (!deletionConfirmationMatches(args.confirmName, company.name)) {
      throw new Error("Type the workspace name exactly to confirm.");
    }
    const scheduledFor = await scheduleDeletion(ctx, company, { requestedBy: user._id, graceMs: DELETION_GRACE_MS });
    return { scheduledFor };
  },
});

/**
 * Lock a workspace and schedule its purge after `graceMs` (also used by
 * `ops:scheduleWorkspaceDeletion` to re-apply deletions after a restore).
 */
export async function scheduleDeletion(
  ctx: MutationCtx,
  company: Doc<"companies">,
  opts: { requestedBy?: Id<"users">; graceMs: number },
) {
  if (company.deletionJobId) await ctx.scheduler.cancel(company.deletionJobId);
  const now = Date.now();
  const scheduledFor = now + opts.graceMs;
  const jobId = await ctx.scheduler.runAt(scheduledFor, internal.privacy.deleteWorkspaceBatch, {
    companyId: company._id,
    step: 0,
  });
  const alreadyLocked = !!company.deletionRequestedAt;
  await ctx.db.patch(company._id, {
    deletionRequestedAt: company.deletionRequestedAt ?? now,
    deletionRequestedBy: opts.requestedBy ?? company.deletionRequestedBy,
    deletionScheduledFor: scheduledFor,
    deletionJobId: jobId,
    deletionRestore: alreadyLocked
      ? company.deletionRestore
      : { notificationsEnabled: company.notificationsEnabled, digestEnabled: company.digestEnabled },
    notificationsEnabled: false,
    digestEnabled: false,
    updatedAt: now,
  });
  console.log(`[workspace-deletion-requested] companyId=${company._id} scheduledFor=${new Date(scheduledFor).toISOString()}`);
  return scheduledFor;
}

/**
 * For the dashboard shell: is the signed-in user's workspace waiting to be
 * deleted? Doesn't throw for a pending workspace (unlike everything else).
 */
export const pendingDeletion = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const company = await ctx.db.get(user.companyId);
    if (!company?.deletionRequestedAt) return null;
    const requestedBy = company.deletionRequestedBy ? await ctx.db.get(company.deletionRequestedBy) : null;
    return {
      companyName: company.name,
      isOwner: user.role === "owner",
      requestedAt: company.deletionRequestedAt,
      requestedByName: requestedBy?.name ?? null,
      scheduledFor: company.deletionScheduledFor ?? null,
      /** Data removal has begun: nothing to cancel any more. */
      started: !!company.deletionStartedAt || !company.deletionScheduledFor,
    };
  },
});

/** Owner changes their mind during the grace period: everything comes back. */
export const cancelDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireOwner(ctx, { allowPendingDeletion: true });
    await restoreWorkspace(ctx, user.companyId);
    return null;
  },
});

/**
 * Undo a pending deletion (also used by `ops:cancelWorkspaceDeletion`).
 * Refuses once data removal has started.
 */
export async function restoreWorkspace(ctx: MutationCtx, companyId: Id<"companies">) {
  const company = await ctx.db.get(companyId);
  if (!company) throw new Error("Not found");
  if (!company.deletionRequestedAt) return false;
  if (company.deletionStartedAt || !company.deletionScheduledFor) {
    throw new Error("Data removal has already started; this workspace can't be restored.");
  }
  if (company.deletionJobId) await ctx.scheduler.cancel(company.deletionJobId);
  await ctx.db.patch(company._id, {
    deletionRequestedAt: undefined,
    deletionRequestedBy: undefined,
    deletionScheduledFor: undefined,
    deletionJobId: undefined,
    deletionRestore: undefined,
    notificationsEnabled: company.deletionRestore?.notificationsEnabled,
    digestEnabled: company.deletionRestore?.digestEnabled,
    updatedAt: Date.now(),
  });
  console.log(`[workspace-deletion-cancelled] companyId=${companyId}`);
  return true;
}

export const deleteWorkspaceBatch = internalMutation({
  args: { companyId: v.id("companies"), step: v.number() },
  handler: async (ctx, { companyId, step }) => {
    const company = await ctx.db.get(companyId);
    if (!company || !company.deletionRequestedAt) return null; // cancelled
    if (step === 0 && !company.deletionStartedAt) {
      // A stale run (e.g. a cancel raced the timer and a new request followed)
      // must not start the purge early.
      if (company.deletionScheduledFor && company.deletionScheduledFor > Date.now()) return null;
      await ctx.db.patch(companyId, { deletionStartedAt: Date.now(), deletionJobId: undefined });
    }

    if (step >= DELETION_ORDER.length) {
      await ctx.db.delete(companyId);
      // Kept in the logs (not the database) so it survives a backup restore:
      // see docs/BACKUP_RESTORE.md, "Deletions after the backup".
      console.log(`[workspace-deleted] companyId=${companyId} requestedAt=${new Date(company.deletionRequestedAt).toISOString()}`);
      return null;
    }
    const table = DELETION_ORDER[step];
    const rows = await batchFor(ctx, table, companyId);
    for (const row of rows) {
      if (table === "voiceNotes") {
        const note = row as Doc<"voiceNotes">;
        if (note.audioStorageId) await ctx.storage.delete(note.audioStorageId).catch(() => undefined);
      } else if (table === "voiceNotePhotos") {
        await ctx.storage.delete((row as Doc<"voiceNotePhotos">).storageId).catch(() => undefined);
      } else if (table === "teamMembers") {
        const quotas = await ctx.db
          .query("fieldUploadQuota")
          .withIndex("by_member", (q) => q.eq("teamMemberId", row._id as Id<"teamMembers">))
          .collect();
        for (const q of quotas) await ctx.db.delete(q._id);
      }
      await ctx.db.delete(row._id);
    }
    // Full batch: maybe more in this table. Otherwise move to the next one.
    const next = rows.length === BATCH ? step : step + 1;
    await ctx.scheduler.runAfter(0, internal.privacy.deleteWorkspaceBatch, { companyId, step: next });
    return null;
  },
});
