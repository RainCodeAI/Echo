import { describe, expect, it } from "vitest";
import {
  MAX_OTHER,
  selectFieldJobs,
  type JobForSelection,
} from "../convex/lib/fieldJobs";
import {
  LAST_JOB_TTL_MS,
  lastPickedJob,
  loadJobList,
  rememberPickedJob,
  saveJobList,
} from "../lib/offline/job-cache";
import type { KeyValueStorage } from "../lib/offline/session";

const NOW = 1_800_000_000_000;
const H = 60 * 60 * 1000;
const job = (id: string, o: Partial<JobForSelection> = {}): JobForSelection => ({
  _id: id,
  title: id,
  status: "scheduled",
  ...o,
});

describe("selectFieldJobs", () => {
  it("puts in-progress and near-term scheduled jobs under Today", () => {
    const { today, other } = selectFieldJobs(
      [
        job("later-today", { scheduledFor: NOW + 3 * H }),
        job("running", { status: "in_progress", scheduledFor: NOW - 72 * H }),
        job("this-morning", { scheduledFor: NOW - 4 * H }),
        job("next-week", { scheduledFor: NOW + 7 * 24 * H }),
        job("undated"),
        job("done", { status: "completed", scheduledFor: NOW }),
        job("cancelled", { status: "cancelled", scheduledFor: NOW }),
        job("last-week", { scheduledFor: NOW - 7 * 24 * H }),
      ],
      NOW,
    );
    expect(today.map((j) => j.id)).toEqual(["running", "this-morning", "later-today"]);
    // Upcoming first, then undated, then overdue backlog. Closed jobs never shown.
    expect(other.map((j) => j.id)).toEqual(["next-week", "undated", "last-week"]);
  });

  it("returns crew-safe fields only", () => {
    const { today } = selectFieldJobs(
      [{ ...job("a", { scheduledFor: NOW, address: "12 Oak" }), notes: "gate code", leadId: "l1" } as JobForSelection],
      NOW,
    );
    expect(today[0]).toEqual({
      id: "a",
      title: "a",
      status: "scheduled",
      scheduledFor: NOW,
      address: "12 Oak",
    });
  });

  it("caps the Other list", () => {
    const many = Array.from({ length: MAX_OTHER + 10 }, (_, i) =>
      job(`j${i}`, { scheduledFor: NOW + (100 + i) * H }),
    );
    expect(selectFieldJobs(many, NOW).other).toHaveLength(MAX_OTHER);
  });
});

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("job cache", () => {
  it("round-trips the job list per company", () => {
    const s = memory();
    const list = { today: [{ id: "a", title: "A", status: "scheduled" as const, scheduledFor: NOW, address: null }], other: [] };
    saveJobList("c1", list, s, NOW);
    expect(loadJobList("c1", s)).toMatchObject(list);
    expect(loadJobList("c2", s)).toBeNull();
  });

  it("remembers the last job per member for one shift", () => {
    const s = memory();
    rememberPickedJob("c1", "m1", { id: "a", title: "A" }, s, NOW);
    expect(lastPickedJob("c1", "m1", s, NOW + H)).toEqual({ id: "a", title: "A" });
    expect(lastPickedJob("c1", "m2", s, NOW)).toBeNull();
    expect(lastPickedJob("c1", "m1", s, NOW + LAST_JOB_TTL_MS + 1)).toBeNull();
    rememberPickedJob("c1", "m1", null, s, NOW);
    expect(lastPickedJob("c1", "m1", s, NOW)).toBeNull();
  });

  it("tolerates missing or corrupt storage", () => {
    const s = memory();
    s.setItem("echo.jobs.c1", "{nope");
    expect(loadJobList("c1", s)).toBeNull();
    expect(loadJobList("c1", null)).toBeNull();
    expect(() => rememberPickedJob("c1", "m1", { id: "a", title: "A" }, null)).not.toThrow();
  });
});
