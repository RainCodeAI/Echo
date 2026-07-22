/**
 * Shared application types for Echo.
 *
 * These string-literal unions and interfaces are the single source of truth
 * for the app's domain vocabulary and are referenced from both the Convex
 * schema validators and the React UI. Keep in sync with `convex/schema.ts`.
 *
 * Full document shapes come from Convex-generated `Doc<>` / `Id<>` under
 * `convex/_generated` once `npx convex dev` has been run.
 */

// --- Service / org vocabulary ------------------------------------------------

export type ServiceType =
  | "landscaping"
  | "roofing"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "painting"
  | "fence_deck"
  | "concrete"
  | "pressure_washing"
  | "security_camera"
  | "general_contracting"
  | "other";

export type UserRole = "owner" | "member";

/** Field worker on a company roster (PIN entry — no Clerk account). */
export interface TeamMemberPublic {
  id: string;
  name: string;
  role?: string;
  isActive: boolean;
}

// --- Leads & jobs (lightweight link targets) ---------------------------------

export type LeadStatus =
  | "new"
  | "contacted"
  | "estimate_sent"
  | "scheduled"
  | "completed"
  | "archived";

export type Urgency = "low" | "medium" | "high" | "emergency";

/** @deprecated Prefer `Urgency` — alias kept for SiteAssist mental model. */
export type LeadUrgency = Urgency;

export type JobStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

// --- Voice notes -------------------------------------------------------------

/**
 * Operational lifecycle of a note (owner review path).
 * Independent of {@link VoiceNoteAiStatus}.
 */
export type VoiceNoteStatus =
  | "processing"
  | "ready"
  | "reviewed"
  | "archived"
  | "failed";

/** AI enrichment lifecycle — raw capture is already durable when pending. */
export type VoiceNoteAiStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type TranscriptSource = "client" | "whisper" | "merged" | "manual";

export type ActionItemPriority = "low" | "medium" | "high";

export interface MaterialLine {
  name: string;
  quantity?: string;
  unit?: string;
  notes?: string;
}

export interface ActionItem {
  title: string;
  assigneeHint?: string;
  dueHint?: string;
  priority?: ActionItemPriority;
  completed?: boolean;
}

/**
 * AI-proposed patch for a linked job. Applied only after owner confirmation.
 */
export interface SuggestedJobUpdate {
  field: string;
  value: string;
  rationale?: string;
}

/**
 * Shape returned by the AI voice-note structuring action.
 * Mirrors the planned `convex/ai.ts` + `voiceNotes.applyAiStructure` contract.
 */
export interface VoiceNoteAiStructure {
  title: string;
  summary: string;
  materials: MaterialLine[];
  actionItems: ActionItem[];
  urgency: Urgency;
  siteAddress?: string;
  timelineNotes?: string;
  suggestedJobUpdates: SuggestedJobUpdate[];
  tags: string[];
  confidence: number;
  generatedAt: number;
}

/** Client payload for creating a note after uploads complete. */
export interface VoiceNoteCreateInput {
  rawTranscript: string;
  audioStorageId?: string;
  audioMimeType?: string;
  audioDurationMs?: number;
  photoStorageIds?: string[];
  clientUploadId: string;
  leadId?: string;
  jobId?: string;
  workerFlaggedUrgent?: boolean;
  crewTag?: string;
  recordedAt: number;
}

/** Filters for the owner dashboard note list. */
export interface VoiceNoteListFilters {
  status?: VoiceNoteStatus | "all";
  aiStatus?: VoiceNoteAiStatus | "all";
  recordedBy?: string | "all";
  leadId?: string;
  jobId?: string;
  /** Inclusive start (ms since epoch). */
  fromRecordedAt?: number;
  /** Inclusive end (ms since epoch). */
  toRecordedAt?: number;
  search?: string;
}

/** Convenience type for company profile settings forms. */
export interface CompanyFormValues {
  name: string;
  primaryTrade: ServiceType;
  phone: string;
  email: string;
  timezone: string;
  notificationEmail: string;
}

/** Convenience type for lightweight lead create/edit forms. */
export interface LeadFormValues {
  customerName: string;
  phone: string;
  email: string;
  address: string;
  serviceType: ServiceType;
  description: string;
  status: LeadStatus;
  urgency: Urgency;
}

/** Convenience type for lightweight job create/edit forms. */
export interface JobFormValues {
  title: string;
  status: JobStatus;
  address: string;
  notes: string;
  scheduledFor?: number;
  leadId?: string;
}
