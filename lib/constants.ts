/**
 * Shared UI-facing constants for Echo.
 * Canonical string values stay in sync with `convex/schema.ts` and `types/`.
 */

import type {
  JobStatus,
  LeadStatus,
  ServiceType,
  Urgency,
  VoiceNoteAiStatus,
  VoiceNoteStatus,
} from "@/types";

export const APP_NAME = "Echo";
export const APP_TAGLINE = "Voice-first field notes for the trades";
export const APP_DESCRIPTION =
  "Workers speak on the job site. Echo turns voice memos into structured notes, materials, action items, and timelines for owners.";

/** Default production-style origin (override with NEXT_PUBLIC_APP_URL). */
export const DEFAULT_APP_URL = "https://echo.raincode.ai";

export const SERVICE_TYPES: { value: ServiceType; label: string }[] = [
  { value: "landscaping", label: "Landscaping" },
  { value: "roofing", label: "Roofing" },
  { value: "hvac", label: "HVAC" },
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "painting", label: "Painting" },
  { value: "fence_deck", label: "Fence & Deck" },
  { value: "concrete", label: "Concrete" },
  { value: "pressure_washing", label: "Pressure Washing" },
  { value: "security_camera", label: "Security & Camera Installation" },
  { value: "general_contracting", label: "General Contracting" },
  { value: "other", label: "Other" },
];

export const SERVICE_TYPE_MAP = Object.fromEntries(
  SERVICE_TYPES.map((s) => [s.value, s]),
) as Record<ServiceType, (typeof SERVICE_TYPES)[number]>;

export const URGENCIES: {
  value: Urgency;
  label: string;
  badgeClass: string;
}[] = [
  { value: "low", label: "Low", badgeClass: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  { value: "medium", label: "Medium", badgeClass: "bg-amber-100 text-amber-700 ring-amber-600/20" },
  { value: "high", label: "High", badgeClass: "bg-orange-100 text-orange-700 ring-orange-600/20" },
  { value: "emergency", label: "Emergency", badgeClass: "bg-red-100 text-red-700 ring-red-600/20" },
];

export const URGENCY_MAP = Object.fromEntries(
  URGENCIES.map((u) => [u.value, u]),
) as Record<Urgency, (typeof URGENCIES)[number]>;

export const VOICE_NOTE_STATUSES: {
  value: VoiceNoteStatus;
  label: string;
  badgeClass: string;
}[] = [
  { value: "processing", label: "Processing", badgeClass: "bg-sky-100 text-sky-700 ring-sky-600/20" },
  { value: "ready", label: "Ready", badgeClass: "bg-emerald-100 text-emerald-700 ring-emerald-600/20" },
  { value: "reviewed", label: "Reviewed", badgeClass: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  { value: "archived", label: "Archived", badgeClass: "bg-slate-100 text-slate-500 ring-slate-400/20" },
  { value: "failed", label: "Failed", badgeClass: "bg-red-100 text-red-700 ring-red-600/20" },
];

export const VOICE_NOTE_STATUS_MAP = Object.fromEntries(
  VOICE_NOTE_STATUSES.map((s) => [s.value, s]),
) as Record<VoiceNoteStatus, (typeof VOICE_NOTE_STATUSES)[number]>;

export const AI_STATUSES: {
  value: VoiceNoteAiStatus;
  label: string;
  badgeClass: string;
}[] = [
  { value: "pending", label: "AI pending", badgeClass: "bg-slate-100 text-slate-600 ring-slate-500/20" },
  { value: "processing", label: "AI running", badgeClass: "bg-sky-100 text-sky-700 ring-sky-600/20" },
  { value: "completed", label: "AI ready", badgeClass: "bg-emerald-100 text-emerald-700 ring-emerald-600/20" },
  { value: "failed", label: "AI failed", badgeClass: "bg-red-100 text-red-700 ring-red-600/20" },
];

export const AI_STATUS_MAP = Object.fromEntries(
  AI_STATUSES.map((s) => [s.value, s]),
) as Record<VoiceNoteAiStatus, (typeof AI_STATUSES)[number]>;

export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "estimate_sent", label: "Estimate sent" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

export const JOB_STATUSES: { value: JobStatus; label: string }[] = [
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
