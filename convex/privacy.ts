import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertSameCompany, requireCurrentUser, requireOwner } from "./lib/tenant";
import { DELETION_ORDER, TERMS_VERSION, deletionConfirmationMatches, type DeletionTable } from "./lib/privacy";

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
    const user = await requireOwner(ctx);
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
 * at once; the data is then removed in batches in the background.
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
    await ctx.db.patch(company._id, {
      deletionRequestedAt: Date.now(),
      notificationsEnabled: false,
      digestEnabled: false,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.privacy.deleteWorkspaceBatch, { companyId: company._id, step: 0 });
    return null;
  },
});

export const deleteWorkspaceBatch = internalMutation({
  args: { companyId: v.id("companies"), step: v.number() },
  handler: async (ctx, { companyId, step }) => {
    const company = await ctx.db.get(companyId);
    if (!company || !company.deletionRequestedAt) return null;

    if (step >= DELETION_ORDER.length) {
      await ctx.db.delete(companyId);
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
