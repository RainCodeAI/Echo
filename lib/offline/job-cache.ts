/**
 * On-device memory for the field "Which job?" picker:
 *  - the last job list the server returned (so the picker works offline and
 *    shows instantly while the live list loads), and
 *  - the job each crew member picked last (crews record several notes per
 *    job, so it's preselected — but only within the same shift).
 */
import type { KeyValueStorage } from "./session";

export type CachedFieldJob = {
  id: string;
  title: string;
  status: "scheduled" | "in_progress";
  scheduledFor: number | null;
  address: string | null;
};
export type FieldJobList = { today: CachedFieldJob[]; other: CachedFieldJob[] };
export type PickedJob = { id: string; title: string };

/** A remembered pick older than this (one shift) is not preselected. */
export const LAST_JOB_TTL_MS = 12 * 60 * 60 * 1000;

function storage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(s: KeyValueStorage | null, key: string): T | null {
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(s: KeyValueStorage | null, key: string, value: unknown) {
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / privacy mode */
  }
}

const listKey = (companyId: string) => `echo.jobs.${companyId}`;
const lastKey = (companyId: string, memberId: string) =>
  `echo.lastJob.${companyId}.${memberId}`;

export function saveJobList(
  companyId: string,
  list: FieldJobList,
  s = storage(),
  now = Date.now(),
) {
  writeJson(s, listKey(companyId), { savedAt: now, ...list });
}

export function loadJobList(
  companyId: string,
  s = storage(),
): (FieldJobList & { savedAt: number }) | null {
  const v = readJson<FieldJobList & { savedAt: number }>(s, listKey(companyId));
  return v && Array.isArray(v.today) && Array.isArray(v.other) ? v : null;
}

export function rememberPickedJob(
  companyId: string,
  memberId: string,
  job: PickedJob | null,
  s = storage(),
  now = Date.now(),
) {
  if (!s) return;
  if (!job) {
    try {
      s.removeItem(lastKey(companyId, memberId));
    } catch {
      /* ignore */
    }
    return;
  }
  writeJson(s, lastKey(companyId, memberId), { ...job, at: now });
}

export function lastPickedJob(
  companyId: string,
  memberId: string,
  s = storage(),
  now = Date.now(),
): PickedJob | null {
  const v = readJson<PickedJob & { at: number }>(s, lastKey(companyId, memberId));
  if (!v || typeof v.id !== "string" || now - v.at > LAST_JOB_TTL_MS) return null;
  return { id: v.id, title: v.title };
}
