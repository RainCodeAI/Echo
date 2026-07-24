import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCurrentUser, assertSameCompany } from "./lib/tenant";
import { requireFieldSession } from "./lib/fieldSession";
import {
  actionItemValidator,
  materialLineValidator,
  suggestedJobUpdateValidator,
  urgencyValidator,
  voiceNoteStatusValidator,
} from "./schema";

const MAX_TRANSCRIPT_CHARS = 20_000;
const MAX_OWNER_NOTE_CHARS = 4_000;
/** Hard cap on stored audio. Whisper also refuses files larger than 25 MB. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Owner-triggered AI retries are capped to avoid runaway cost on a bad note. */
const MAX_AI_ATTEMPTS = 5;
/** Photo attachment limits per note. */
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Reject nonsensical client clocks: recordedAt must be within this skew. */
const RECORDED_AT_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Field capture + owner read APIs for voice notes.
 * AI enrichment is scheduled later; create always saves raw capture first.
 */

/** Short-lived upload URL for field workers (PIN session required). */
export const generateFieldUploadUrl = mutation({
  args: {
    companyId: v.id("companies"),
    teamMemberId: v.id("teamMembers"),
    verificationToken: v.string(),
  },
  handler: async (ctx, args) => {
    await requireFieldSession(ctx, args);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Save-first field submit. Idempotent on `clientUploadId` within a company.
 * No Clerk auth — gated by field verification token from PIN verify.
 */
export const createFromField = mutation({
  args: {
    companyId: v.id("companies"),
    teamMemberId: v.id("teamMembers"),
    verificationToken: v.string(),
    rawTranscript: v.string(),
    clientUploadId: v.string(),
    audioStorageId: v.optional(v.id("_storage")),
    audioMimeType: v.optional(v.string()),
    audioDurationMs: v.optional(v.number()),
    workerFlaggedUrgent: v.optional(v.boolean()),
    recordedAt: v.number(),
    photos: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          mimeType: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const session = await requireFieldSession(ctx, {
      companyId: args.companyId,
      teamMemberId: args.teamMemberId,
      verificationToken: args.verificationToken,
    });

    const clientUploadId = args.clientUploadId.trim();
    if (!clientUploadId) {
      throw new Error("Missing upload id.");
    }

    const existing = await ctx.db
      .query("voiceNotes")
      .withIndex("by_client_upload_id", (q) =>
        q.eq("companyId", args.companyId).eq("clientUploadId", clientUploadId),
      )
      .unique();
    if (existing) {
      return existing._id;
    }

    const transcript = args.rawTranscript.trim().slice(0, MAX_TRANSCRIPT_CHARS);
    if (!transcript && !args.audioStorageId) {
      throw new Error("Record audio or add a short note before submitting.");
    }

    const now = Date.now();

    // Enforce the audio size cap server-side. The blob is already in storage,
    // so an oversized upload is deleted here rather than left orphaned.
    if (args.audioStorageId) {
      const meta = await ctx.db.system.get(args.audioStorageId);
      if (!meta) {
        throw new Error("Audio upload was not found. Please re-record.");
      }
      if (meta.size > MAX_AUDIO_BYTES) {
        await ctx.storage.delete(args.audioStorageId);
        throw new Error(
          `Recording is too large (max ${Math.round(
            MAX_AUDIO_BYTES / (1024 * 1024),
          )} MB). Record a shorter memo.`,
        );
      }
    }

    // Validate photo attachments before creating the note so nothing dangles.
    const photos = args.photos ?? [];
    if (photos.length > MAX_PHOTOS) {
      await Promise.all(photos.map((p) => ctx.storage.delete(p.storageId)));
      throw new Error(`Attach at most ${MAX_PHOTOS} photos.`);
    }
    for (const p of photos) {
      const meta = await ctx.db.system.get(p.storageId);
      if (!meta) {
        throw new Error("A photo upload was not found. Please re-attach.");
      }
      if (meta.size > MAX_PHOTO_BYTES) {
        await ctx.storage.delete(p.storageId);
        throw new Error(
          `A photo is too large (max ${Math.round(
            MAX_PHOTO_BYTES / (1024 * 1024),
          )} MB).`,
        );
      }
    }

    // Clamp a client-supplied recordedAt to a sane window around server time.
    const recordedAt =
      args.recordedAt &&
      Math.abs(now - args.recordedAt) <= RECORDED_AT_SKEW_MS
        ? args.recordedAt
        : now;

    const noteId = await ctx.db.insert("voiceNotes", {
      companyId: session.companyId,
      teamMemberId: session.teamMemberId,
      status: "ready",
      rawTranscript: transcript,
      transcriptSource: transcript ? "client" : undefined,
      audioStorageId: args.audioStorageId,
      audioMimeType: args.audioMimeType,
      audioDurationMs: args.audioDurationMs,
      clientUploadId,
      workerFlaggedUrgent: args.workerFlaggedUrgent ?? false,
      recordedAt,
      aiStatus: "pending",
      urgency: args.workerFlaggedUrgent ? "high" : "medium",
      createdAt: now,
      updatedAt: now,
    });

    if (photos.length > 0) {
      await Promise.all(
        photos.map((p, i) =>
          ctx.db.insert("voiceNotePhotos", {
            companyId: session.companyId,
            voiceNoteId: noteId,
            storageId: p.storageId,
            mimeType: p.mimeType,
            sortOrder: i,
            createdAt: now,
          }),
        ),
      );
    }

    // Save-first complete — enrich asynchronously (Whisper + structure).
    await ctx.scheduler.runAfter(0, internal.ai.processNoteInternal, {
      noteId,
    });

    return noteId;
  },
});

/**
 * Owner dashboard: recent notes for the signed-in company, with optional
 * filters. The most selective available index is used as the base; remaining
 * filters and free-text search are applied in memory over a bounded fetch
 * (fine at MVP scale — swap to the search indexes when note counts grow).
 */
export const listForCompany = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(voiceNoteStatusValidator),
    teamMemberId: v.optional(v.id("teamMembers")),
    urgentOnly: v.optional(v.boolean()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const limit = Math.min(args.limit ?? 50, 100);
    const FETCH_CAP = 200;

    let rows;
    if (args.status) {
      const status = args.status;
      rows = await ctx.db
        .query("voiceNotes")
        .withIndex("by_company_and_status", (q) =>
          q.eq("companyId", user.companyId).eq("status", status),
        )
        .order("desc")
        .take(FETCH_CAP);
    } else if (args.teamMemberId) {
      const teamMemberId = args.teamMemberId;
      rows = await ctx.db
        .query("voiceNotes")
        .withIndex("by_company_and_team_member", (q) =>
          q.eq("companyId", user.companyId).eq("teamMemberId", teamMemberId),
        )
        .order("desc")
        .take(FETCH_CAP);
    } else {
      rows = await ctx.db
        .query("voiceNotes")
        .withIndex("by_company_and_created", (q) =>
          q.eq("companyId", user.companyId),
        )
        .order("desc")
        .take(FETCH_CAP);
    }

    // Crew filter when the base index was chosen for status instead.
    if (args.teamMemberId && args.status) {
      rows = rows.filter((n) => n.teamMemberId === args.teamMemberId);
    }
    if (args.urgentOnly) {
      rows = rows.filter(
        (n) =>
          n.workerFlaggedUrgent ||
          n.urgency === "high" ||
          n.urgency === "emergency",
      );
    }
    const term = args.search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter((n) =>
        `${n.rawTranscript} ${n.aiSummary ?? ""} ${n.aiTitle ?? ""}`
          .toLowerCase()
          .includes(term),
      );
    }

    const notes = rows.slice(0, limit);

    const memberIds = [
      ...new Set(
        notes
          .map((n) => n.teamMemberId)
          .filter((id): id is NonNullable<typeof id> => !!id),
      ),
    ];
    const members = await Promise.all(memberIds.map((id) => ctx.db.get(id)));
    const memberNameById = new Map(
      members
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map((m) => [m._id, m.name] as const),
    );

    const leadIds = [
      ...new Set(
        notes
          .map((n) => n.leadId)
          .filter((id): id is NonNullable<typeof id> => !!id),
      ),
    ];
    const jobIds = [
      ...new Set(
        notes
          .map((n) => n.jobId)
          .filter((id): id is NonNullable<typeof id> => !!id),
      ),
    ];
    const [leads, jobs] = await Promise.all([
      Promise.all(leadIds.map((id) => ctx.db.get(id))),
      Promise.all(jobIds.map((id) => ctx.db.get(id))),
    ]);
    const leadNameById = new Map(
      leads
        .filter((l): l is NonNullable<typeof l> => !!l)
        .map((l) => [l._id, l.customerName] as const),
    );
    const jobTitleById = new Map(
      jobs
        .filter((j): j is NonNullable<typeof j> => !!j)
        .map((j) => [j._id, j.title] as const),
    );

    return notes.map((note) => ({
      ...note,
      crewName: note.teamMemberId
        ? (memberNameById.get(note.teamMemberId) ?? "Crew")
        : "Office",
      leadName: note.leadId ? (leadNameById.get(note.leadId) ?? null) : null,
      jobTitle: note.jobId ? (jobTitleById.get(note.jobId) ?? null) : null,
    }));
  },
});

/**
 * Owner: single note (tenant-scoped). Returns null (not a thrown error) for a
 * missing or cross-tenant id so the UI can render a friendly "not found" state.
 */
export const get = query({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const user = await requireCurrentUser(ctx);
    const note = await ctx.db.get(noteId);
    if (!note || note.companyId !== user.companyId) {
      return null;
    }

    let crewName: string | null = null;
    if (note.teamMemberId) {
      const member = await ctx.db.get(note.teamMemberId);
      crewName = member?.name ?? null;
    }

    let audioUrl: string | null = null;
    if (note.audioStorageId) {
      audioUrl = await ctx.storage.getUrl(note.audioStorageId);
    }

    const photoRows = await ctx.db
      .query("voiceNotePhotos")
      .withIndex("by_note", (q) => q.eq("voiceNoteId", note._id))
      .collect();
    photoRows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const photos = await Promise.all(
      photoRows.map(async (p) => ({
        id: p._id,
        url: await ctx.storage.getUrl(p.storageId),
        mimeType: p.mimeType ?? null,
        caption: p.caption ?? null,
      })),
    );

    let leadName: string | null = null;
    if (note.leadId) {
      const lead = await ctx.db.get(note.leadId);
      if (lead && lead.companyId === user.companyId) {
        leadName = lead.customerName;
      }
    }
    let jobTitle: string | null = null;
    if (note.jobId) {
      const job = await ctx.db.get(note.jobId);
      if (job && job.companyId === user.companyId) {
        jobTitle = job.title;
      }
    }

    return { ...note, crewName, audioUrl, photos, leadName, jobTitle };
  },
});

/** Dashboard pulse counts for the overview page. */
export const dashboardStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const notes = await ctx.db
      .query("voiceNotes")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId))
      .collect();

    const crew = await ctx.db
      .query("teamMembers")
      .withIndex("by_company_and_active", (q) =>
        q.eq("companyId", user.companyId).eq("isActive", true),
      )
      .collect();

    let ready = 0;
    let reviewed = 0;
    let archived = 0;
    let urgent = 0;
    let aiPending = 0;
    let aiFailed = 0;

    for (const n of notes) {
      if (n.status === "ready" || n.status === "processing") ready++;
      if (n.status === "reviewed") reviewed++;
      if (n.status === "archived") archived++;
      if (n.workerFlaggedUrgent || n.urgency === "high" || n.urgency === "emergency") {
        urgent++;
      }
      if (n.aiStatus === "pending" || n.aiStatus === "processing") aiPending++;
      if (n.aiStatus === "failed") aiFailed++;
    }

    return {
      totalNotes: notes.length,
      needsReview: ready,
      reviewed,
      archived,
      urgent,
      aiPending,
      aiFailed,
      activeCrew: crew.length,
    };
  },
});

async function requireOwnedNote(ctx: MutationCtx, noteId: Id<"voiceNotes">) {
  const user = await requireCurrentUser(ctx);
  const note = assertSameCompany(await ctx.db.get(noteId), user.companyId);
  return { user, note };
}

/** Mark a note reviewed (owner action). */
export const markReviewed = mutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const { user, note } = await requireOwnedNote(ctx, noteId);
    if (note.status === "archived") {
      throw new Error("Unarchive the note before marking it reviewed.");
    }
    const now = Date.now();
    await ctx.db.patch(noteId, {
      status: "reviewed",
      reviewedBy: user._id,
      reviewedAt: now,
      updatedAt: now,
    });
    return noteId;
  },
});

/** Re-open a reviewed note back to ready. */
export const markReady = mutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const { note } = await requireOwnedNote(ctx, noteId);
    if (note.status === "archived") {
      throw new Error("Unarchive the note first.");
    }
    await ctx.db.patch(noteId, {
      status: "ready",
      reviewedBy: undefined,
      reviewedAt: undefined,
      updatedAt: Date.now(),
    });
    return noteId;
  },
});

/** Archive / soft-close a note. */
export const archive = mutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    await requireOwnedNote(ctx, noteId);
    await ctx.db.patch(noteId, {
      status: "archived",
      updatedAt: Date.now(),
    });
    return noteId;
  },
});

/** Restore an archived note to ready. */
export const unarchive = mutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    await requireOwnedNote(ctx, noteId);
    await ctx.db.patch(noteId, {
      status: "ready",
      reviewedBy: undefined,
      reviewedAt: undefined,
      updatedAt: Date.now(),
    });
    return noteId;
  },
});

/** Owner free-text note on a voice memo. */
export const setOwnerNote = mutation({
  args: {
    noteId: v.id("voiceNotes"),
    ownerNote: v.string(),
  },
  handler: async (ctx, { noteId, ownerNote }) => {
    await requireOwnedNote(ctx, noteId);
    const trimmed = ownerNote.trim().slice(0, MAX_OWNER_NOTE_CHARS);
    await ctx.db.patch(noteId, {
      ownerNote: trimmed || undefined,
      updatedAt: Date.now(),
    });
    return noteId;
  },
});

/** Set operational urgency (owner override). */
export const setUrgency = mutation({
  args: {
    noteId: v.id("voiceNotes"),
    urgency: urgencyValidator,
  },
  handler: async (ctx, { noteId, urgency }) => {
    await requireOwnedNote(ctx, noteId);
    await ctx.db.patch(noteId, {
      urgency,
      updatedAt: Date.now(),
    });
    return noteId;
  },
});

/** Toggle worker-style urgent flag from the owner desk. */
export const setWorkerFlaggedUrgent = mutation({
  args: {
    noteId: v.id("voiceNotes"),
    workerFlaggedUrgent: v.boolean(),
  },
  handler: async (ctx, { noteId, workerFlaggedUrgent }) => {
    await requireOwnedNote(ctx, noteId);
    await ctx.db.patch(noteId, {
      workerFlaggedUrgent,
      updatedAt: Date.now(),
    });
    return noteId;
  },
});

/**
 * Save all owner-review fields in one write (owner note + urgency + urgent
 * flag). Replaces three separate mutations that raced on `updatedAt`.
 */
export const updateReview = mutation({
  args: {
    noteId: v.id("voiceNotes"),
    ownerNote: v.optional(v.string()),
    urgency: v.optional(urgencyValidator),
    workerFlaggedUrgent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOwnedNote(ctx, args.noteId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.ownerNote !== undefined) {
      const trimmed = args.ownerNote.trim().slice(0, MAX_OWNER_NOTE_CHARS);
      patch.ownerNote = trimmed || undefined;
    }
    if (args.urgency !== undefined) patch.urgency = args.urgency;
    if (args.workerFlaggedUrgent !== undefined) {
      patch.workerFlaggedUrgent = args.workerFlaggedUrgent;
    }
    await ctx.db.patch(args.noteId, patch);
    return args.noteId;
  },
});

/**
 * Link (or unlink) a note to a lead and/or job. Pass an id to set, `null` to
 * clear, or omit to leave unchanged. Linked docs must be in the same company.
 */
export const setLinks = mutation({
  args: {
    noteId: v.id("voiceNotes"),
    leadId: v.optional(v.union(v.id("leads"), v.null())),
    jobId: v.optional(v.union(v.id("jobs"), v.null())),
  },
  handler: async (ctx, args) => {
    const { user } = await requireOwnedNote(ctx, args.noteId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.leadId !== undefined) {
      if (args.leadId === null) {
        patch.leadId = undefined;
      } else {
        const lead = await ctx.db.get(args.leadId);
        assertSameCompany(lead, user.companyId);
        patch.leadId = args.leadId;
      }
    }
    if (args.jobId !== undefined) {
      if (args.jobId === null) {
        patch.jobId = undefined;
      } else {
        const job = await ctx.db.get(args.jobId);
        assertSameCompany(job, user.companyId);
        patch.jobId = args.jobId;
      }
    }

    await ctx.db.patch(args.noteId, patch);
    return args.noteId;
  },
});

/** Generic status patch (kept narrow for future filters). */
export const setStatus = mutation({
  args: {
    noteId: v.id("voiceNotes"),
    status: voiceNoteStatusValidator,
  },
  handler: async (ctx, { noteId, status }) => {
    const { user } = await requireOwnedNote(ctx, noteId);
    const now = Date.now();
    const patch: Record<string, unknown> = { status, updatedAt: now };
    if (status === "reviewed") {
      patch.reviewedBy = user._id;
      patch.reviewedAt = now;
    }
    if (status === "ready") {
      patch.reviewedBy = undefined;
      patch.reviewedAt = undefined;
    }
    await ctx.db.patch(noteId, patch);
    return noteId;
  },
});

/**
 * Owner-triggered AI retry (Whisper + structure). Safe to call anytime;
 * processNoteInternal is idempotent enough for re-runs.
 */
export const requestAiRetry = mutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const { note } = await requireOwnedNote(ctx, noteId);
    if (note.aiStatus === "processing") {
      throw new Error("AI is already running on this note — give it a moment.");
    }
    if ((note.aiGenerationAttempts ?? 0) >= MAX_AI_ATTEMPTS) {
      throw new Error(
        "This note has hit the AI retry limit. Edit the transcript before retrying.",
      );
    }
    await ctx.db.patch(noteId, {
      aiStatus: "pending",
      aiErrorMessage: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.ai.processNoteInternal, {
      noteId,
    });
    return noteId;
  },
});

// --- Internal helpers for the AI action --------------------------------------

export const getInternal = internalQuery({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const note = await ctx.db.get(noteId);
    if (!note) return null;

    let crewName: string | null = null;
    if (note.teamMemberId) {
      const member = await ctx.db.get(note.teamMemberId);
      crewName = member?.name ?? null;
    }

    const company = await ctx.db.get(note.companyId);

    return {
      note,
      crewName,
      companyName: company?.name ?? "Company",
      primaryTrade: company?.primaryTrade ?? null,
    };
  },
});

export const markAiProcessing = internalMutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const note = await ctx.db.get(noteId);
    if (!note) return;
    const attempts = (note.aiGenerationAttempts ?? 0) + 1;
    await ctx.db.patch(noteId, {
      aiStatus: "processing",
      aiGenerationAttempts: attempts,
      aiErrorMessage: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const applyTranscript = internalMutation({
  args: {
    noteId: v.id("voiceNotes"),
    rawTranscript: v.string(),
    transcriptSource: v.union(
      v.literal("client"),
      v.literal("whisper"),
      v.literal("merged"),
      v.literal("manual"),
    ),
  },
  handler: async (ctx, { noteId, rawTranscript, transcriptSource }) => {
    const note = await ctx.db.get(noteId);
    if (!note) return;
    await ctx.db.patch(noteId, {
      rawTranscript: rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS),
      transcriptSource,
      updatedAt: Date.now(),
    });
  },
});

export const applyAiStructure = internalMutation({
  args: {
    noteId: v.id("voiceNotes"),
    title: v.string(),
    summary: v.string(),
    materials: v.array(materialLineValidator),
    actionItems: v.array(actionItemValidator),
    urgency: urgencyValidator,
    siteAddress: v.optional(v.string()),
    timelineNotes: v.optional(v.string()),
    suggestedJobUpdates: v.array(suggestedJobUpdateValidator),
    tags: v.array(v.string()),
    confidence: v.number(),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) return;

    const now = Date.now();
    await ctx.db.patch(args.noteId, {
      aiStatus: "completed",
      aiTitle: args.title,
      aiSummary: args.summary,
      materials: args.materials,
      actionItems: args.actionItems,
      urgency: args.urgency,
      siteAddress: args.siteAddress,
      timelineNotes: args.timelineNotes,
      suggestedJobUpdates: args.suggestedJobUpdates,
      tags: args.tags,
      aiConfidence: args.confidence,
      aiProcessedAt: now,
      aiErrorMessage: undefined,
      updatedAt: now,
    });
  },
});

export const applyAiFailure = internalMutation({
  args: {
    noteId: v.id("voiceNotes"),
    error: v.string(),
  },
  handler: async (ctx, { noteId, error }) => {
    const note = await ctx.db.get(noteId);
    if (!note) return;
    await ctx.db.patch(noteId, {
      aiStatus: "failed",
      aiErrorMessage: error.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});
