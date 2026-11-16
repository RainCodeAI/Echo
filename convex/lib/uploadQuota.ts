/**
 * Upload-URL rate limit for field sessions (pure, unit-tested).
 *
 * A note needs at most 7 uploads (audio + 6 photos), and offline retries
 * re-request URLs, so the limit is generous: it only stops a leaked token or
 * a script from minting unlimited uploads. The client treats the error as
 * "retry later", so a worker who hits it loses nothing.
 */

export const UPLOAD_WINDOW_MS = 60 * 60 * 1000;
export const MAX_UPLOADS_PER_WINDOW = 120;

export type QuotaRecord = { windowStartedAt: number; count: number };

export function takeUploadSlot(
  record: QuotaRecord | null,
  now: number,
  limit = MAX_UPLOADS_PER_WINDOW,
): { allowed: boolean; next: QuotaRecord; retryInMs: number } {
  const fresh = !record || now - record.windowStartedAt >= UPLOAD_WINDOW_MS;
  const base: QuotaRecord = fresh ? { windowStartedAt: now, count: 0 } : record;
  if (base.count >= limit) {
    return {
      allowed: false,
      next: base,
      retryInMs: base.windowStartedAt + UPLOAD_WINDOW_MS - now,
    };
  }
  return { allowed: true, next: { ...base, count: base.count + 1 }, retryInMs: 0 };
}
