/**
 * Offline capture queue — core logic (framework-free, unit-tested).
 *
 * A field note is written to the phone (IndexedDB) the moment the worker taps
 * Submit, then sent in the background. Nothing is removed from the phone until
 * the server has accepted the note, so dead zones, reloads, closed tabs and
 * expired sessions can delay a note but never lose it.
 *
 * Sending is idempotent end to end: blobs already uploaded are remembered on
 * the item (`audioStorageId`, `photoStorageIds`) so retries don't re-upload,
 * and `voiceNotes.createFromField` dedupes on `clientUploadId`, so a retry
 * after a lost response cannot create a duplicate note.
 */

export type QueueStatus =
  /** Waiting to send (new, or retrying after a transient failure). */
  | "pending"
  /** Currently being sent by this tab. */
  | "sending"
  /** Field session expired/invalid — needs that worker's PIN to continue. */
  | "needs_pin"
  /** Server rejected it for a reason a retry won't fix. Kept for the worker to see. */
  | "failed";

export type QueuedPhoto = {
  blob: Blob;
  mimeType?: string;
};

export type QueuedNote = {
  /** Idempotency key — also the IndexedDB key. */
  clientUploadId: string;
  companyId: string;
  teamMemberId: string;
  memberName: string;
  transcript: string;
  audio?: Blob;
  audioMimeType?: string;
  audioDurationMs?: number;
  photos: QueuedPhoto[];
  workerFlaggedUrgent: boolean;
  recordedAt: number;
  queuedAt: number;
  /** Job picked on the entry page (title kept for display while queued). */
  jobId?: string;
  jobTitle?: string;

  status: QueueStatus;
  attempts: number;
  /** Don't retry before this time (ms epoch). */
  nextAttemptAt: number;
  lastError?: string;

  /** Upload progress, persisted so retries skip finished uploads. */
  audioStorageId?: string;
  photoStorageIds: (string | null)[];
};

/** Everything the sender needs from the outside world (injected for tests). */
export type SendDeps = {
  /** Returns the current verification token for a member, or null if none/expired. */
  getToken: (companyId: string, teamMemberId: string) => string | null;
  generateUploadUrl: (args: {
    companyId: string;
    teamMemberId: string;
    verificationToken: string;
  }) => Promise<string>;
  /** POST a blob to a Convex upload URL; resolves to the storage id. */
  uploadBlob: (url: string, blob: Blob, contentType: string) => Promise<string>;
  createNote: (args: {
    companyId: string;
    teamMemberId: string;
    verificationToken: string;
    rawTranscript: string;
    clientUploadId: string;
    audioStorageId?: string;
    audioMimeType?: string;
    audioDurationMs?: number;
    workerFlaggedUrgent?: boolean;
    recordedAt: number;
    jobId?: string;
    photos?: { storageId: string; mimeType?: string }[];
  }) => Promise<string>;
  /** Persist an item's updated state (progress, status, errors). */
  save: (item: QueuedNote) => Promise<void>;
  now: () => number;
};

export type SendResult =
  | { outcome: "sent"; noteId: string }
  | { outcome: "retry"; item: QueuedNote }
  | { outcome: "needs_pin"; item: QueuedNote }
  | { outcome: "failed"; item: QueuedNote };

export type ErrorKind =
  /** Session expired/invalid or member deactivated: needs a fresh PIN. */
  | "auth"
  /** An uploaded blob is gone server-side: forget storage ids and re-upload. */
  | "missing_upload"
  /** Server validation the same payload will never pass. */
  | "fatal"
  /** Network, timeout, server hiccup: try again later. */
  | "transient";

/**
 * Classify an error from Convex / fetch. Convex surfaces server errors as
 * `Error` whose message contains the thrown text (prefixed with request ids),
 * so this matches on the messages thrown in convex/voiceNotes.ts and
 * convex/lib/fieldSession.ts. Unknown errors are treated as transient: an
 * unnecessary retry is cheap, a wrongly-abandoned note is not.
 */
export function classifyError(err: unknown): ErrorKind {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (
    /Session expired or invalid|Re-enter your PIN|inactive or not found/i.test(
      message,
    )
  ) {
    return "auth";
  }
  if (/upload was not found/i.test(message)) return "missing_upload";
  if (
    /too large|at most \d+ photos|Record audio or add a short note|Missing upload id|Company not found/i.test(
      message,
    )
  ) {
    return "fatal";
  }
  return "transient";
}

/** Short, worker-facing reason extracted from a Convex error message. */
export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  // Convex: "[CONVEX M(voiceNotes:createFromField)] [Request ID: x] Server Error\nUncaught Error: <msg>\n    at ..."
  const uncaught = message.match(/Uncaught Error: ([^\n]+)/);
  const text = (uncaught?.[1] ?? message).trim();
  if (!text || /Failed to fetch|NetworkError|Load failed|timed out/i.test(text)) {
    return "No connection — will retry automatically.";
  }
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

const BACKOFF_STEPS_MS = [5_000, 15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000];

/** Delay before the next automatic retry after `attempts` failures (capped at 5 min). */
export function backoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), BACKOFF_STEPS_MS.length - 1);
  return BACKOFF_STEPS_MS[index];
}

/** Items that should be attempted now, oldest first. */
export function dueItems(items: QueuedNote[], now: number): QueuedNote[] {
  return items
    .filter(
      (i) =>
        (i.status === "pending" || i.status === "sending") &&
        i.nextAttemptAt <= now,
    )
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

/**
 * Try to send one queued note. Never throws; always returns the outcome and
 * persists intermediate progress through `deps.save`.
 *
 * `force` ignores backoff (worker tapped "Send now" / connectivity returned).
 */
export async function sendQueuedNote(
  original: QueuedNote,
  deps: SendDeps,
): Promise<SendResult> {
  let item: QueuedNote = { ...original, status: "sending" };

  const token = deps.getToken(item.companyId, item.teamMemberId);
  if (!token) {
    item = {
      ...item,
      status: "needs_pin",
      lastError: `Waiting for ${item.memberName} to enter their PIN.`,
    };
    await deps.save(item);
    return { outcome: "needs_pin", item };
  }
  const auth = {
    companyId: item.companyId,
    teamMemberId: item.teamMemberId,
    verificationToken: token,
  };

  try {
    await deps.save(item);

    if (item.audio && item.audio.size > 0 && !item.audioStorageId) {
      const url = await deps.generateUploadUrl(auth);
      const storageId = await deps.uploadBlob(
        url,
        item.audio,
        item.audioMimeType || item.audio.type || "audio/webm",
      );
      item = { ...item, audioStorageId: storageId };
      await deps.save(item);
    }

    const photoIds = [...item.photoStorageIds];
    for (let i = 0; i < item.photos.length; i++) {
      if (photoIds[i]) continue;
      const photo = item.photos[i];
      const url = await deps.generateUploadUrl(auth);
      photoIds[i] = await deps.uploadBlob(
        url,
        photo.blob,
        photo.mimeType || photo.blob.type || "image/jpeg",
      );
      item = { ...item, photoStorageIds: [...photoIds] };
      await deps.save(item);
    }

    const noteId = await deps.createNote({
      ...auth,
      rawTranscript: item.transcript,
      clientUploadId: item.clientUploadId,
      audioStorageId: item.audioStorageId,
      audioMimeType: item.audioStorageId ? item.audioMimeType : undefined,
      audioDurationMs: item.audioDurationMs,
      workerFlaggedUrgent: item.workerFlaggedUrgent,
      recordedAt: item.recordedAt,
      jobId: item.jobId,
      photos: item.photos.length
        ? item.photos.map((p, i) => ({
            storageId: photoIds[i] as string,
            mimeType: p.mimeType,
          }))
        : undefined,
    });
    return { outcome: "sent", noteId };
  } catch (err) {
    const attempts = item.attempts + 1;
    const kind = classifyError(err);
    const lastError = friendlyError(err);

    if (kind === "auth") {
      item = { ...item, attempts, status: "needs_pin", lastError };
      await deps.save(item);
      return { outcome: "needs_pin", item };
    }
    if (kind === "fatal") {
      item = { ...item, attempts, status: "failed", lastError };
      await deps.save(item);
      return { outcome: "failed", item };
    }
    if (kind === "missing_upload") {
      // Re-upload everything on the next try, right away.
      item = {
        ...item,
        attempts,
        status: "pending",
        lastError,
        audioStorageId: undefined,
        photoStorageIds: item.photos.map(() => null),
        nextAttemptAt: deps.now(),
      };
      await deps.save(item);
      return { outcome: "retry", item };
    }
    item = {
      ...item,
      attempts,
      status: "pending",
      lastError,
      nextAttemptAt: deps.now() + backoffMs(attempts),
    };
    await deps.save(item);
    return { outcome: "retry", item };
  }
}

/** Build a new queue item from a finished capture. */
export function createQueuedNote(input: {
  clientUploadId: string;
  companyId: string;
  teamMemberId: string;
  memberName: string;
  transcript: string;
  audio?: Blob | null;
  audioMimeType?: string;
  audioDurationMs?: number;
  photos: QueuedPhoto[];
  workerFlaggedUrgent: boolean;
  recordedAt: number;
  jobId?: string;
  jobTitle?: string;
  now: number;
}): QueuedNote {
  return {
    clientUploadId: input.clientUploadId,
    companyId: input.companyId,
    teamMemberId: input.teamMemberId,
    memberName: input.memberName,
    transcript: input.transcript.trim(),
    audio: input.audio && input.audio.size > 0 ? input.audio : undefined,
    audioMimeType: input.audioMimeType,
    audioDurationMs: input.audioDurationMs || undefined,
    photos: input.photos,
    workerFlaggedUrgent: input.workerFlaggedUrgent,
    recordedAt: input.recordedAt || input.now,
    queuedAt: input.now,
    jobId: input.jobId || undefined,
    jobTitle: input.jobId ? input.jobTitle : undefined,
    status: "pending",
    attempts: 0,
    nextAttemptAt: input.now,
    photoStorageIds: input.photos.map(() => null),
  };
}
