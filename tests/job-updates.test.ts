import { describe, expect, it } from "vitest";
import {
  classifySuggestion,
  describeSuggestion,
  normalizeField,
  parseLocalDateTime,
  parseStatus,
  planApply,
  planUndo,
  type JobSnapshot,
} from "../convex/lib/jobUpdates";
import { buildStructureUserPrompt } from "../convex/lib/prompts";

const NOW = Date.UTC(2026, 10, 10, 15, 0);
const DAY = 86_400_000;
const JOB: JobSnapshot = { status: "scheduled", address: "12 Oak St", notes: "Gate code 4412" };
const opts = { now: NOW, noteLabel: "Field note 2026-11-10" };

describe("normalizeField / parseStatus / parseLocalDateTime", () => {
  it("maps field synonyms", () => {
    expect(normalizeField("Status")).toBe("status");
    expect(normalizeField("scheduled_date")).toBe("scheduledFor");
    expect(normalizeField("Site Address")).toBe("address");
    expect(normalizeField("job notes")).toBe("notes");
    expect(normalizeField("crew size")).toBeNull();
  });
  it("maps status synonyms", () => {
    expect(parseStatus("In progress")).toBe("in_progress");
    expect(parseStatus("in_progress")).toBe("in_progress");
    expect(parseStatus("done")).toBe("completed");
    expect(parseStatus("Canceled")).toBe("cancelled");
    expect(parseStatus("called off")).toBe("cancelled");
    expect(parseStatus("on hold")).toBeNull();
  });
  it("parses ISO-ish local dates, defaulting to 8am", () => {
    expect(parseLocalDateTime("2026-11-17")).toBe("2026-11-17T08:00");
    expect(parseLocalDateTime("2026-11-17T13:30")).toBe("2026-11-17T13:30");
    expect(parseLocalDateTime("2026-11-17 07:15")).toBe("2026-11-17T07:15");
    expect(parseLocalDateTime("next Tuesday")).toBeNull();
    expect(parseLocalDateTime("2026-13-01")).toBeNull();
  });
});

describe("classifySuggestion / describeSuggestion", () => {
  it("explains what can't be applied", () => {
    expect(classifySuggestion({ field: "crew size", value: "3" })).toMatchObject({ kind: "unsupported" });
    expect(classifySuggestion({ field: "status", value: "paused" })).toMatchObject({ kind: "unsupported" });
    expect(classifySuggestion({ field: "scheduledFor", value: "soon" })).toMatchObject({ kind: "unsupported" });
  });
  it("describes applicable changes", () => {
    expect(describeSuggestion({ field: "status", value: "in progress" })).toBe("Status → in progress");
    expect(describeSuggestion({ field: "scheduledFor", value: "2026-11-17" })).toBe("Reschedule → 2026-11-17 08:00");
  });
});

describe("planApply", () => {
  it("status", () => {
    expect(planApply({ field: "status", value: "started" }, JOB, opts)).toEqual({
      field: "status",
      patch: { status: "in_progress" },
      previous: '"scheduled"',
      applied: '"in_progress"',
    });
  });
  it("scheduledFor needs a confirmed, plausible instant", () => {
    const s = { field: "scheduledFor", value: "2026-11-17" };
    expect(() => planApply(s, JOB, opts)).toThrow(/Confirm the date/);
    expect(() => planApply(s, JOB, { ...opts, scheduledForMs: NOW + 400 * DAY })).toThrow(/too far/);
    expect(planApply(s, JOB, { ...opts, scheduledForMs: NOW + 7 * DAY })).toMatchObject({
      patch: { scheduledFor: NOW + 7 * DAY },
      previous: "null",
    });
  });
  it("notes are appended with their source, never overwritten", () => {
    const p = planApply({ field: "notes", value: "Dog in back yard" }, JOB, opts);
    expect(p.patch.notes).toBe("Gate code 4412\nField note 2026-11-10: Dog in back yard");
    expect(p.previous).toBe('"Gate code 4412"');
  });
  it("refuses unsupported suggestions", () => {
    expect(() => planApply({ field: "crew size", value: "3" }, JOB, opts)).toThrow(/can't change/);
  });
});

describe("planUndo", () => {
  it("restores the previous value while the job still holds the applied one", () => {
    const p = planApply({ field: "status", value: "done" }, JOB, opts);
    expect(planUndo(p, { ...JOB, status: "completed" })).toEqual({ status: "scheduled" });
  });
  it("clears a field that was empty before", () => {
    const p = planApply({ field: "scheduledFor", value: "2026-11-17" }, JOB, { ...opts, scheduledForMs: NOW + DAY });
    expect(planUndo(p, { ...JOB, scheduledFor: NOW + DAY })).toEqual({ scheduledFor: undefined });
  });
  it("refuses if the job changed since", () => {
    const p = planApply({ field: "status", value: "done" }, JOB, opts);
    expect(() => planUndo(p, { ...JOB, status: "cancelled" })).toThrow(/changed since/);
  });
  it("refuses tampered or missing history", () => {
    expect(() => planUndo({ field: "status", applied: '"completed"' }, { ...JOB, status: "completed" })).toThrow(/can't be undone/);
    expect(() =>
      planUndo({ field: "status", previous: '"bogus"', applied: '"completed"' }, { ...JOB, status: "completed" }),
    ).toThrow(/can't be undone/);
  });
});

describe("prompt recording date", () => {
  it("gives the model the recording date and weekday for relative dates", () => {
    const prompt = buildStructureUserPrompt({ companyName: "Acme", transcript: "come back next tuesday", recordedAt: NOW });
    expect(prompt).toContain("Recorded on: 2026-11-10 (Tuesday)");
  });
});
