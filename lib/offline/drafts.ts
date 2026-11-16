import { DRAFT_STORE, idbDelete, idbGet, idbPut } from "./idb";

/**
 * The capture a worker has recorded but not yet submitted. Saved to the phone
 * as soon as recording stops (and on every edit), so a reload, a crash or the
 * browser being killed in the background doesn't throw the recording away.
 */
export type FieldDraft = {
  key: string;
  clientUploadId: string;
  transcript: string;
  audio?: Blob;
  audioMimeType?: string;
  audioDurationMs?: number;
  photos: { blob: Blob; name: string; mimeType?: string }[];
  workerFlaggedUrgent: boolean;
  recordedAt: number;
  savedAt: number;
  jobId?: string;
  jobTitle?: string;
};

export function draftKey(companyId: string, teamMemberId: string) {
  return `${companyId}:${teamMemberId}`;
}

export async function saveDraft(draft: FieldDraft): Promise<boolean> {
  try {
    await idbPut(DRAFT_STORE, draft);
    return true;
  } catch {
    return false;
  }
}

export async function loadDraft(key: string): Promise<FieldDraft | null> {
  try {
    return (await idbGet<FieldDraft>(DRAFT_STORE, key)) ?? null;
  } catch {
    return null;
  }
}

export async function deleteDraft(key: string): Promise<void> {
  try {
    await idbDelete(DRAFT_STORE, key);
  } catch {
    /* best effort */
  }
}
