import { describe, expect, it } from "vitest";
import { computeSteps, isDefaultCompanyName, SAMPLE_NOTE } from "../convex/lib/onboarding";

describe("onboarding steps", () => {
  it("recognizes the auto-created workspace name", () => {
    expect(isDefaultCompanyName("Dana Smith's Company")).toBe(true);
    expect(isDefaultCompanyName("My Company")).toBe(true);
    expect(isDefaultCompanyName("  ")).toBe(true);
    expect(isDefaultCompanyName("Acme Roofing")).toBe(false);
  });

  it("starts at 0 of 4 and finishes when the required steps are done", () => {
    const fresh = computeSteps({ companyName: "Dana's Company", activeCrew: 0, crewNotes: 0, alertsOn: false });
    expect(fresh).toMatchObject({ requiredDone: 0, requiredTotal: 4, allRequiredDone: false });
    expect(fresh.steps.map((s) => s.id)).toEqual(["profile", "crew", "share", "firstNote", "alerts"]);

    const named = computeSteps({ companyName: "Acme Roofing", activeCrew: 0, crewNotes: 0, alertsOn: false });
    expect(named.steps[0].done).toBe(false); // trade still missing

    const done = computeSteps({ companyName: "Acme Roofing", primaryTrade: "roofing", activeCrew: 2, sharedAt: 1, crewNotes: 3, alertsOn: false });
    expect(done).toMatchObject({ requiredDone: 4, allRequiredDone: true });
    expect(done.steps.find((s) => s.id === "alerts")).toEqual({ id: "alerts", done: false, optional: true });
  });
});

describe("sample note", () => {
  it("is a Spanish memo with an English summary, materials and tasks", () => {
    expect(SAMPLE_NOTE.rawTranscript).toMatch(/tejas/);
    expect(SAMPLE_NOTE.aiSummary).toMatch(/north slope/);
    expect(SAMPLE_NOTE.materials.map((m) => m.name)).toEqual(["Architectural shingles", "OSB sheathing", "Roofing nails"]);
    expect(SAMPLE_NOTE.actionItems).toHaveLength(2);
    expect(SAMPLE_NOTE.tags).toContain("sample");
  });
});
