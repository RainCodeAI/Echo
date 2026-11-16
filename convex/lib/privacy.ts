/**
 * Privacy, consent and data-lifecycle constants (pure, shared by Convex and
 * the app). Bump a version when its text changes materially: owners re-accept
 * the terms, crews re-acknowledge the recording notice.
 */

export const TERMS_VERSION = "2026-11-15";
export const RECORDING_NOTICE_VERSION = "2026-11-15";

/** What a crew member acknowledges before their first recording. */
export function recordingNotice(companyName: string): string[] {
  return [
    `${companyName} uses Echo for job-site voice notes. What you record (your voice, any photos, and the job details you mention) is saved for ${companyName}'s office.`,
    "Recordings are transcribed and summarized by an AI service. The office can play them back, edit them, and delete them.",
    "Only record what's needed for the job. Before you record a customer or anyone else, ask them first: some states require everyone's permission.",
    "Don't record passwords, card numbers, or personal health details.",
  ];
}

/**
 * Tables holding a workspace's data, in deletion order. Field access goes
 * first (crew can't add anything mid-deletion); users and the company last.
 */
export const DELETION_ORDER = [
  "teamMembers",
  "invites",
  "pinAttempts",
  "voiceNotePhotos",
  "alerts",
  "customerUpdates",
  "materialOrders",
  "voiceNotes",
  "aiUsage",
  "jobs",
  "leads",
  "users",
] as const;
export type DeletionTable = (typeof DELETION_ORDER)[number];

/** The exact phrase an owner types to confirm deleting the workspace. */
export function deletionConfirmationMatches(typed: string, companyName: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) !== "" && norm(typed) === norm(companyName);
}
