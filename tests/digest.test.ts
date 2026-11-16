import { describe, expect, it } from "vitest";
import {
  buildDigestEmail,
  computeDigestStats,
  digestDueDateKey,
  isQuietDay,
  localTime,
  type DigestNote,
} from "../convex/lib/digest";

const H = 60 * 60 * 1000;

describe("localTime", () => {
  it("follows daylight saving", () => {
    // 11:30 UTC is 7:30 in New York in July (EDT) and 6:30 in November (EST).
    expect(localTime(Date.UTC(2026, 6, 15, 11, 30), "America/New_York").hour).toBe(7);
    expect(localTime(Date.UTC(2026, 10, 15, 11, 30), "America/New_York").hour).toBe(6);
  });
  it("rolls the date in far-east zones and falls back to UTC for bad names", () => {
    expect(localTime(Date.UTC(2026, 10, 9, 23, 30), "Asia/Tokyo").dateKey).toBe("2026-11-10");
    expect(localTime(Date.UTC(2026, 10, 9, 5, 0), "Not/AZone")).toEqual({
      hour: 5,
      dateKey: "2026-11-09",
      timeZone: "UTC",
    });
  });
});

describe("digestDueDateKey", () => {
  const ny = { digestEnabled: true, timezone: "America/New_York", digestHour: 7 };
  const at = (localHourEST: number) => Date.UTC(2026, 10, 9, localHourEST + 5, 10); // EST = UTC-5

  it("is due from the chosen hour, for a short catch-up window", () => {
    expect(digestDueDateKey(ny, at(6))).toBeNull();
    expect(digestDueDateKey(ny, at(7))).toBe("2026-11-09");
    expect(digestDueDateKey(ny, at(9))).toBe("2026-11-09");
    expect(digestDueDateKey(ny, at(10))).toBeNull(); // too late to be a "morning" digest
  });
  it("sends once per local day, and never when disabled", () => {
    expect(digestDueDateKey({ ...ny, lastDigestDateKey: "2026-11-09" }, at(7))).toBeNull();
    expect(digestDueDateKey({ ...ny, lastDigestDateKey: "2026-11-08" }, at(7))).toBe("2026-11-09");
    expect(digestDueDateKey({ ...ny, digestEnabled: false }, at(7))).toBeNull();
  });
  it("defaults to 7am", () => {
    expect(digestDueDateKey({ digestEnabled: true, timezone: "UTC" }, Date.UTC(2026, 10, 9, 7, 5))).toBe("2026-11-09");
  });
});

const NOW = Date.UTC(2026, 10, 9, 12, 0);
const note = (o: Partial<DigestNote>): DigestNote => ({
  _id: "n",
  createdAt: NOW - H,
  status: "ready",
  aiStatus: "completed",
  crewName: "Luis",
  jobTitle: null,
  rawTranscript: "note",
  ...o,
});

describe("computeDigestStats", () => {
  const notes = [
    note({ _id: "a", teamMemberId: "m1", aiTitle: "Gutters loose", jobTitle: "Chen gutters", materials: [{ name: "Gutter spikes", quantity: "20" }], actionItems: [{ title: "x" }, { title: "y", completed: true }] }),
    note({ _id: "b", teamMemberId: "m2", aiTitle: "Water in kitchen", urgency: "emergency", jobTitle: "Ramirez reroof", materials: [{ name: "Tarp", quantity: "1", unit: "roll" }] }),
    note({ _id: "c", teamMemberId: "m1", status: "reviewed", aiStatus: "failed", materials: [{ name: "Caulk" }] }),
    note({ _id: "d", teamMemberId: "m3", status: "archived", materials: [{ name: "ignored" }] }),
  ];
  const s = computeDigestStats(notes, 4);

  it("counts live notes, crews, urgent, actions, materials and AI failures", () => {
    expect(s).toMatchObject({ notes: 3, crews: 2, needsReview: 4, urgent: 1, openActions: 1, materialLines: 3, aiFailed: 1 });
  });
  it("lists notes needing attention, urgent first, reviewed ones excluded", () => {
    expect(s.attention.map((a) => a.id)).toEqual(["b", "a"]);
    expect(s.attention[0]).toMatchObject({ title: "Water in kitchen", urgent: true });
  });
  it("groups materials by job, unlinked last, archived excluded", () => {
    expect(s.materialsByJob).toEqual([
      { job: "Chen gutters", items: ["Gutter spikes (20)"] },
      { job: "Ramirez reroof", items: ["Tarp (1 roll)"] },
      { job: "No job linked", items: ["Caulk"] },
    ]);
  });
  it("counts unreviewed notes the list doesn't show", () => {
    // 4 unreviewed overall, 2 listed (a, b) → 2 more waiting.
    expect(s.moreWaiting).toBe(2);
    const email = buildDigestEmail({ companyName: "Acme", dateLabel: "Mon", stats: s, appUrl: null });
    expect(email.text).toContain("…and 2 more waiting for review.");
    const onlyOld = buildDigestEmail({ companyName: "Acme", dateLabel: "Mon", stats: computeDigestStats([], 3), appUrl: null });
    expect(onlyOld.text).toContain("3 older notes still waiting for review.");
  });

  it("detects quiet days", () => {
    expect(isQuietDay(computeDigestStats([], 0))).toBe(true);
    expect(isQuietDay(computeDigestStats([], 2))).toBe(false);
  });
});

describe("buildDigestEmail", () => {
  const stats = computeDigestStats(
    [note({ _id: "b", teamMemberId: "m2", aiTitle: "Water <in> kitchen", urgency: "emergency", jobTitle: "Ramirez", materials: [{ name: "Tarp" }] })],
    1,
  );
  const email = buildDigestEmail({ companyName: "Acme", dateLabel: "Mon, Nov 9", stats, appUrl: "https://echo.example.com" });

  it("summarises in the subject with correct plurals", () => {
    expect(email.subject).toBe("Acme — Mon, Nov 9: 1 note, from 1 crew member, 1 needs you, 1 urgent, 1 material requested");
  });
  it("links each note needing attention and lists materials", () => {
    expect(email.text).toContain("- [URGENT] Water <in> kitchen (Luis · Ramirez)");
    expect(email.text).toContain("https://echo.example.com/dashboard/notes/b");
    expect(email.text).toContain("Ramirez: Tarp");
  });
  it("escapes HTML", () => {
    expect(email.html).toContain("Water &lt;in&gt; kitchen");
    expect(email.html).not.toContain("<in>");
  });
});
