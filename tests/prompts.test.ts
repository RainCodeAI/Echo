import { describe, expect, it } from "vitest";
import {
  buildStructureUserPrompt,
  sanitizeStructuredNote,
  type StructuredNoteModel,
} from "../convex/lib/prompts";

/** A messy model response covering every branch the sanitizer must clean. */
function messyModel(): StructuredNoteModel {
  return {
    title: "  Roof leak  ",
    summary: "  Water coming in over the kitchen  ",
    materials: [
      { name: " Shingles ", quantity: " 3 ", unit: " bundle ", notes: "" },
      { name: "   ", quantity: "", unit: "", notes: "" }, // dropped: blank name
    ],
    actionItems: [
      {
        title: " Tarp the roof ",
        assigneeHint: "",
        dueHint: " today ",
        priority: "high",
      },
      { title: "  ", assigneeHint: "", dueHint: "", priority: "low" }, // dropped
    ],
    urgency: "high",
    siteAddress: "   ",
    timelineNotes: "",
    suggestedJobUpdates: [
      { field: " status ", value: " in_progress ", rationale: "" },
      { field: "", value: "x", rationale: "" }, // dropped: missing field
    ],
    tags: [" safety ", "", "  "],
    confidence: 1.5,
  };
}

describe("sanitizeStructuredNote", () => {
  it("trims title and summary", () => {
    const r = sanitizeStructuredNote(messyModel());
    expect(r.title).toBe("Roof leak");
    expect(r.summary).toBe("Water coming in over the kitchen");
  });

  it("drops blank materials and blanks empty fields to undefined", () => {
    const r = sanitizeStructuredNote(messyModel());
    expect(r.materials).toHaveLength(1);
    expect(r.materials[0]).toEqual({
      name: "Shingles",
      quantity: "3",
      unit: "bundle",
      notes: undefined,
    });
  });

  it("drops blank action items and empties missing hints", () => {
    const r = sanitizeStructuredNote(messyModel());
    expect(r.actionItems).toHaveLength(1);
    expect(r.actionItems[0].title).toBe("Tarp the roof");
    expect(r.actionItems[0].assigneeHint).toBeUndefined();
    expect(r.actionItems[0].dueHint).toBe("today");
  });

  it("drops suggested job updates missing field or value", () => {
    const r = sanitizeStructuredNote(messyModel());
    expect(r.suggestedJobUpdates).toHaveLength(1);
    expect(r.suggestedJobUpdates[0]).toEqual({
      field: "status",
      value: "in_progress",
      rationale: undefined,
    });
  });

  it("trims and filters out blank tags", () => {
    expect(sanitizeStructuredNote(messyModel()).tags).toEqual(["safety"]);
  });

  it("blanks whitespace-only siteAddress to undefined", () => {
    expect(sanitizeStructuredNote(messyModel()).siteAddress).toBeUndefined();
  });

  it("clamps confidence into [0, 1]", () => {
    expect(sanitizeStructuredNote({ ...messyModel(), confidence: 1.5 }).confidence).toBe(1);
    expect(sanitizeStructuredNote({ ...messyModel(), confidence: -0.2 }).confidence).toBe(0);
    expect(sanitizeStructuredNote({ ...messyModel(), confidence: 0.42 }).confidence).toBe(0.42);
  });

  it("falls back to defaults when title/summary are blank", () => {
    const r = sanitizeStructuredNote({
      ...messyModel(),
      title: "   ",
      summary: "",
    });
    expect(r.title).toBe("Field note");
    expect(r.summary).toBe("No summary generated.");
  });
});

describe("buildStructureUserPrompt", () => {
  it("includes device notes only when provided", () => {
    const base = {
      companyName: "Acme Roofing",
      transcript: "Need two bundles of shingles for the north slope.",
    };
    expect(buildStructureUserPrompt(base)).not.toContain("on-device notes");
    const withDevice = buildStructureUserPrompt({
      ...base,
      deviceNotes: "customer is Ramirez, gate code 4412",
    });
    expect(withDevice).toContain("Worker's on-device notes:");
    expect(withDevice).toContain("gate code 4412");
  });

  it("ignores whitespace-only device notes", () => {
    const prompt = buildStructureUserPrompt({
      companyName: "Acme",
      transcript: "hello world, this is a note",
      deviceNotes: "   ",
    });
    expect(prompt).not.toContain("on-device notes");
  });
});
