/**
 * Which jobs a field worker sees in the "Which job?" picker (pure, tested).
 *
 * "Today" deliberately uses a generous window around *now* instead of a
 * calendar day: the company timezone is optional, crews start early and run
 * late, and picking from a slightly-too-long list beats not finding the job.
 *  - Today: every in-progress job, plus scheduled jobs from 18h ago to 30h ahead.
 *  - Other open jobs: remaining scheduled / in-progress jobs (capped), so a
 *    job booked for next week — or not dated at all — is still pickable.
 * Only crew-safe fields are returned: no customer phone/email.
 */

export const TODAY_LOOKBACK_MS = 18 * 60 * 60 * 1000;
export const TODAY_LOOKAHEAD_MS = 30 * 60 * 60 * 1000;
export const MAX_TODAY = 25;
export const MAX_OTHER = 40;

export type JobForSelection = {
  _id: string;
  title: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  scheduledFor?: number;
  address?: string;
};

export type FieldJob = {
  id: string;
  title: string;
  status: "scheduled" | "in_progress";
  scheduledFor: number | null;
  address: string | null;
};

function toFieldJob(job: JobForSelection): FieldJob {
  return {
    id: job._id,
    title: job.title,
    status: job.status as FieldJob["status"],
    scheduledFor: job.scheduledFor ?? null,
    address: job.address ?? null,
  };
}

export function selectFieldJobs(
  jobs: JobForSelection[],
  now: number,
): { today: FieldJob[]; other: FieldJob[] } {
  const open = jobs.filter(
    (j) => j.status === "scheduled" || j.status === "in_progress",
  );

  const isToday = (j: JobForSelection) =>
    j.status === "in_progress" ||
    (j.scheduledFor !== undefined &&
      j.scheduledFor >= now - TODAY_LOOKBACK_MS &&
      j.scheduledFor <= now + TODAY_LOOKAHEAD_MS);

  // In progress first, then soonest scheduled time; undated last.
  const byRelevance = (a: JobForSelection, b: JobForSelection) => {
    if (a.status !== b.status) return a.status === "in_progress" ? -1 : 1;
    const ta = a.scheduledFor ?? Number.POSITIVE_INFINITY;
    const tb = b.scheduledFor ?? Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  };

  const today = open.filter(isToday).sort(byRelevance);
  const todayIds = new Set(today.map((j) => j._id));

  // Other: upcoming soonest first, then undated, then the overdue backlog.
  const other = open
    .filter((j) => !todayIds.has(j._id))
    .sort((a, b) => {
      const rank = (j: JobForSelection) =>
        j.scheduledFor === undefined ? 1 : j.scheduledFor >= now ? 0 : 2;
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0);
      if (ra === 2) return (b.scheduledFor ?? 0) - (a.scheduledFor ?? 0);
      return a.title.localeCompare(b.title);
    });

  return {
    today: today.slice(0, MAX_TODAY).map(toFieldJob),
    other: other.slice(0, MAX_OTHER).map(toFieldJob),
  };
}
