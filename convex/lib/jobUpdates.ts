/**
 * Turning the AI's "suggested job updates" into real job changes (pure, tested).
 *
 * The AI proposes `{ field, value, rationale }`. Only a few job fields can be
 * applied automatically; everything else stays a read-only suggestion. Every
 * applied change records the previous value so it can be undone — but only
 * while the job still holds the applied value (never clobber a later edit).
 */

export const APPLICABLE_FIELDS = ["status", "scheduledFor", "address", "notes"] as const;
export type ApplicableField = (typeof APPLICABLE_FIELDS)[number];

export type JobStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export type JobSnapshot = {
  status: JobStatus;
  scheduledFor?: number;
  address?: string;
  notes?: string;
};

const MAX_NOTES_CHARS = 4_000;
const DAY = 24 * 60 * 60 * 1000;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Map the AI's field name (any casing/synonym) to a field we can apply. */
export function normalizeField(field: string): ApplicableField | null {
  const f = squash(field);
  if (["status", "jobstatus", "state"].includes(f)) return "status";
  if (["scheduledfor", "schedule", "scheduled", "scheduleddate", "date", "startdate", "reschedule", "visitdate"].includes(f)) {
    return "scheduledFor";
  }
  if (["address", "siteaddress", "location", "site", "jobaddress"].includes(f)) return "address";
  if (["notes", "note", "jobnotes", "comment", "comments"].includes(f)) return "notes";
  return null;
}

/** Map a status value ("In progress", "done", "started") to a job status. */
export function parseStatus(value: string): JobStatus | null {
  const v = squash(value);
  if (["scheduled", "booked", "notstarted"].includes(v)) return "scheduled";
  if (["inprogress", "started", "underway", "ongoing", "active", "working", "begun"].includes(v)) return "in_progress";
  if (["completed", "complete", "done", "finished", "closed"].includes(v)) return "completed";
  if (["cancelled", "canceled", "cancel", "calledoff"].includes(v)) return "cancelled";
  return null;
}

/**
 * The local date/time the AI proposed, as a value for <input type="datetime-local">.
 * Accepts "YYYY-MM-DD" (defaults to 08:00) or "YYYY-MM-DDTHH:mm[...]".
 * The browser converts it to an instant in the owner's timezone, and the
 * owner can adjust it before applying.
 */
export function parseLocalDateTime(value: string): string | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = "08", mi = "00"] = m;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

export type ClassifiedSuggestion =
  | { kind: "status"; status: JobStatus }
  | { kind: "scheduledFor"; localDateTime: string }
  | { kind: "address"; address: string }
  | { kind: "notes"; text: string }
  | { kind: "unsupported"; reason: string };

export function classifySuggestion(s: { field: string; value: string }): ClassifiedSuggestion {
  const field = normalizeField(s.field);
  const value = s.value.trim();
  if (!field) return { kind: "unsupported", reason: `Echo can't change "${s.field}" automatically.` };
  if (!value) return { kind: "unsupported", reason: "No value suggested." };
  switch (field) {
    case "status": {
      const status = parseStatus(value);
      return status
        ? { kind: "status", status }
        : { kind: "unsupported", reason: `"${value}" isn't a job status.` };
    }
    case "scheduledFor": {
      const local = parseLocalDateTime(value);
      return local
        ? { kind: "scheduledFor", localDateTime: local }
        : { kind: "unsupported", reason: `"${value}" isn't a specific date — set it on the job instead.` };
    }
    case "address":
      return { kind: "address", address: value.slice(0, 500) };
    case "notes":
      return { kind: "notes", text: value };
  }
}

export type PlannedUpdate = {
  field: ApplicableField;
  patch: Partial<JobSnapshot>;
  /** JSON of the field's value before the change (for undo). */
  previous: string;
  /** JSON of the field's value after the change (undo only if still equal). */
  applied: string;
};

/**
 * Work out the job patch for a suggestion. `scheduledForMs` is the instant the
 * owner confirmed in the browser (required for date suggestions).
 */
export function planApply(
  s: { field: string; value: string },
  job: JobSnapshot,
  opts: { now: number; scheduledForMs?: number; noteLabel: string },
): PlannedUpdate {
  const c = classifySuggestion(s);
  switch (c.kind) {
    case "unsupported":
      throw new Error(c.reason);
    case "status":
      return {
        field: "status",
        patch: { status: c.status },
        previous: JSON.stringify(job.status),
        applied: JSON.stringify(c.status),
      };
    case "scheduledFor": {
      const ms = opts.scheduledForMs;
      if (ms === undefined || !Number.isFinite(ms)) {
        throw new Error("Confirm the date and time before applying.");
      }
      if (ms < opts.now - 30 * DAY || ms > opts.now + 366 * DAY) {
        throw new Error("That date is too far from today — check it and set it on the job instead.");
      }
      return {
        field: "scheduledFor",
        patch: { scheduledFor: ms },
        previous: JSON.stringify(job.scheduledFor ?? null),
        applied: JSON.stringify(ms),
      };
    }
    case "address":
      return {
        field: "address",
        patch: { address: c.address },
        previous: JSON.stringify(job.address ?? null),
        applied: JSON.stringify(c.address),
      };
    case "notes": {
      // Append, never overwrite, and say where it came from.
      const line = `${opts.noteLabel}: ${c.text}`;
      const next = (job.notes ? `${job.notes}\n${line}` : line).slice(0, MAX_NOTES_CHARS);
      return {
        field: "notes",
        patch: { notes: next },
        previous: JSON.stringify(job.notes ?? null),
        applied: JSON.stringify(next),
      };
    }
  }
}

/** Patch that restores the previous value, or an error if the job moved on. */
export function planUndo(
  applied: { field: string; previous?: string; applied?: string },
  job: JobSnapshot,
): Partial<JobSnapshot> {
  const field = normalizeField(applied.field);
  if (!field || applied.previous === undefined || applied.applied === undefined) {
    throw new Error("This change can't be undone.");
  }
  const current = JSON.stringify(job[field] ?? null);
  if (current !== applied.applied) {
    throw new Error("The job has changed since this was applied — edit the job directly instead.");
  }
  const previous = JSON.parse(applied.previous) as unknown;
  switch (field) {
    case "status":
      if (typeof previous === "string" && parseStatus(previous) === previous) {
        return { status: previous as JobStatus };
      }
      break;
    case "scheduledFor":
      if (previous === null || typeof previous === "number") {
        return { scheduledFor: previous ?? undefined };
      }
      break;
    case "address":
    case "notes":
      if (previous === null || typeof previous === "string") {
        return { [field]: previous ?? undefined };
      }
      break;
  }
  throw new Error("This change can't be undone.");
}

/** Human summary for the UI: "Status → In progress". */
export function describeSuggestion(s: { field: string; value: string }): string {
  const c = classifySuggestion(s);
  switch (c.kind) {
    case "status":
      return `Status → ${c.status.replace("_", " ")}`;
    case "scheduledFor":
      return `Reschedule → ${c.localDateTime.replace("T", " ")}`;
    case "address":
      return `Site address → ${c.address}`;
    case "notes":
      return `Add to job notes: “${c.text}”`;
    default:
      return `${s.field} → ${s.value}`;
  }
}
