import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Echo database schema.
 *
 * Multi-tenant from day one: every operational record carries a `companyId`
 * so a workspace's data stays isolated. Indexes match the access patterns the
 * app actually uses (by company, by status, by crew, by lead/job, by upload id).
 *
 * String unions below mirror `types/index.ts`. Keep them in sync.
 */

// --- Reusable validators -----------------------------------------------------

/** Primary trade — shared vocabulary with SiteAssist where practical. */
export const serviceTypeValidator = v.union(
  v.literal("landscaping"),
  v.literal("roofing"),
  v.literal("hvac"),
  v.literal("plumbing"),
  v.literal("electrical"),
  v.literal("painting"),
  v.literal("fence_deck"),
  v.literal("concrete"),
  v.literal("pressure_washing"),
  v.literal("security_camera"),
  v.literal("general_contracting"),
  v.literal("other"),
);

export const userRoleValidator = v.union(
  v.literal("owner"),
  v.literal("member"),
);

export const leadStatusValidator = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("estimate_sent"),
  v.literal("scheduled"),
  v.literal("completed"),
  v.literal("archived"),
);

export const leadUrgencyValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("emergency"),
);

export const jobStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
);

/**
 * Lifecycle of a voice note as an operational object (owner review path).
 * Independent of AI processing state (`aiStatus`).
 */
export const voiceNoteStatusValidator = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("reviewed"),
  v.literal("archived"),
  v.literal("failed"),
);

/** AI enrichment lifecycle — note content is already durable when pending. */
export const voiceNoteAiStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
);

export const urgencyValidator = leadUrgencyValidator;

export const actionItemPriorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

/** Where the transcript text primarily came from. */
export const transcriptSourceValidator = v.union(
  v.literal("client"),
  v.literal("whisper"),
  v.literal("merged"),
  v.literal("manual"),
);

/** One line on the AI-extracted materials list. */
export const materialLineValidator = v.object({
  name: v.string(),
  quantity: v.optional(v.string()),
  unit: v.optional(v.string()),
  notes: v.optional(v.string()),
});

/** One AI-extracted or owner-edited action item. */
export const actionItemValidator = v.object({
  title: v.string(),
  assigneeHint: v.optional(v.string()),
  dueHint: v.optional(v.string()),
  priority: v.optional(actionItemPriorityValidator),
  completed: v.optional(v.boolean()),
});

/**
 * A suggested change for a linked job (proposal only until owner applies it).
 * `field` is an open string so the model can name job fields without a schema
 * change for every new suggestion type.
 */
export const suggestedJobUpdateValidator = v.object({
  field: v.string(),
  value: v.string(),
  rationale: v.optional(v.string()),
});

// --- Schema ------------------------------------------------------------------

export default defineSchema({
  /** A trades business / workspace. The tenant boundary. */
  companies: defineTable({
    name: v.string(),
    primaryTrade: v.optional(serviceTypeValidator),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    timezone: v.optional(v.string()),
    /** Where owners receive digests / urgent alerts (future). */
    notificationEmail: v.optional(v.string()),
    notificationsEnabled: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }),

  /** A person who signs in with Clerk (owners / office). Linked via `clerkUserId`. */
  users: defineTable({
    clerkUserId: v.string(),
    companyId: v.id("companies"),
    name: v.string(),
    email: v.string(),
    role: userRoleValidator,
    /** Optional display label for crew filters (e.g. "Crew A", "Foreman"). */
    crewLabel: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkUserId"])
    .index("by_company", ["companyId"]),

  /**
   * Field workers — no Clerk account. Authenticate on `/entry/[companyId]` with
   * a 4-digit PIN (Relay-style). PIN is stored as a hash, never plaintext.
   */
  teamMembers: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    role: v.optional(v.string()),
    /** SHA-256 hex of `${companyId}:${pin}` (see `convex/lib/pin.ts`). */
    pinHash: v.string(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_company", ["companyId"])
    .index("by_company_and_active", ["companyId", "isActive"]),

  /**
   * Lightweight lead — link target for field notes and future SiteAssist sync.
   * Not a full CRM surface in Echo MVP.
   */
  leads: defineTable({
    companyId: v.id("companies"),
    customerName: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    serviceType: serviceTypeValidator,
    description: v.string(),
    status: leadStatusValidator,
    urgency: leadUrgencyValidator,
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_company_and_status", ["companyId", "status"])
    .index("by_company_and_created", ["companyId", "createdAt"])
    .searchIndex("search_customer", {
      searchField: "customerName",
      filterFields: ["companyId", "status"],
    }),

  /**
   * Lightweight job — scheduled/active work a note can attach to.
   * `leadId` optional when the job did not originate from a lead in Echo.
   */
  jobs: defineTable({
    companyId: v.id("companies"),
    leadId: v.optional(v.id("leads")),
    title: v.string(),
    status: jobStatusValidator,
    scheduledFor: v.optional(v.number()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_company_and_status", ["companyId", "status"])
    .index("by_company_and_created", ["companyId", "createdAt"])
    .index("by_lead", ["leadId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["companyId", "status"],
    }),

  /**
   * Core field capture object: raw voice/transcript + AI structured fields.
   *
   * Persistence order: raw capture is always written first (`aiStatus: pending`).
   * AI enrichment is best-effort and never the sole home of the memo.
   */
  voiceNotes: defineTable({
    companyId: v.id("companies"),
    /**
     * Who captured the note. Field workers set `teamMemberId` (PIN entry).
     * Owners/office may set `recordedBy` when capturing from the dashboard.
     * At least one should be present.
     */
    recordedBy: v.optional(v.id("users")),
    teamMemberId: v.optional(v.id("teamMembers")),

    /** Optional links — set at capture or during owner review. */
    leadId: v.optional(v.id("leads")),
    jobId: v.optional(v.id("jobs")),

    /** Operational lifecycle (review path). */
    status: voiceNoteStatusValidator,

    // --- Raw capture -------------------------------------------------------
    /**
     * Best available transcript. May be empty briefly if only audio was sent
     * and server transcription has not completed yet.
     */
    rawTranscript: v.string(),
    transcriptSource: v.optional(transcriptSourceValidator),
    /** Convex file storage id for the audio blob. */
    audioStorageId: v.optional(v.id("_storage")),
    audioMimeType: v.optional(v.string()),
    audioDurationMs: v.optional(v.number()),
    /**
     * Client-generated idempotency key for offline retries / double-submit.
     * Unique enough within a company; lookups use `by_client_upload_id`.
     */
    clientUploadId: v.optional(v.string()),
    /** Worker tapped "urgent" at capture time (before AI). */
    workerFlaggedUrgent: v.optional(v.boolean()),
    /** Optional free-text crew tag if not using user.crewLabel alone. */
    crewTag: v.optional(v.string()),
    /** When the recording finished on device (may differ from createdAt). */
    recordedAt: v.number(),

    // --- AI structured output (nullable until completed) -------------------
    aiStatus: voiceNoteAiStatusValidator,
    aiTitle: v.optional(v.string()),
    aiSummary: v.optional(v.string()),
    materials: v.optional(v.array(materialLineValidator)),
    actionItems: v.optional(v.array(actionItemValidator)),
    urgency: v.optional(urgencyValidator),
    siteAddress: v.optional(v.string()),
    timelineNotes: v.optional(v.string()),
    suggestedJobUpdates: v.optional(v.array(suggestedJobUpdateValidator)),
    tags: v.optional(v.array(v.string())),
    aiConfidence: v.optional(v.number()),
    aiProcessedAt: v.optional(v.number()),
    aiGenerationAttempts: v.optional(v.number()),
    aiErrorMessage: v.optional(v.string()),

    // --- Owner review ------------------------------------------------------
    ownerNote: v.optional(v.string()),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_company_and_created", ["companyId", "createdAt"])
    .index("by_company_and_status", ["companyId", "status"])
    .index("by_company_and_ai_status", ["companyId", "aiStatus"])
    .index("by_company_and_recorded_by", ["companyId", "recordedBy"])
    .index("by_company_and_team_member", ["companyId", "teamMemberId"])
    .index("by_company_and_recorded_at", ["companyId", "recordedAt"])
    .index("by_lead", ["leadId"])
    .index("by_job", ["jobId"])
    .index("by_client_upload_id", ["companyId", "clientUploadId"])
    .searchIndex("search_transcript", {
      searchField: "rawTranscript",
      filterFields: ["companyId", "status"],
    })
    .searchIndex("search_summary", {
      searchField: "aiSummary",
      filterFields: ["companyId", "status"],
    }),

  /** Photos attached to a voice note (binaries in Convex file storage). */
  voiceNotePhotos: defineTable({
    companyId: v.id("companies"),
    voiceNoteId: v.id("voiceNotes"),
    storageId: v.id("_storage"),
    mimeType: v.optional(v.string()),
    caption: v.optional(v.string()),
    /** Client sort order within the note. */
    sortOrder: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_note", ["voiceNoteId"])
    .index("by_company", ["companyId"]),
});
