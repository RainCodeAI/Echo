import { describe, expect, it } from "vitest";
import {
  LIMITS,
  markEdited,
  mergeAiStructure,
  normalizeOwnerEdits,
  type AiStructurePatch,
} from "../convex/lib/noteEdits";

const AI: AiStructurePatch = {
  aiTitle: "AI title",
  aiSummary: "AI summary",
  materials: [{ name: "Shingles" }],
  actionItems: [{ title: "Order shingles" }],
  urgency: "medium",
  siteAddress: "12 Oak St",
  timelineNotes: "Tuesday",
  tags: ["materials_needed"],
};

describe("mergeAiStructure", () => {
  it("passes every AI field through when nothing was edited", () => {
    expect(mergeAiStructure(AI, undefined)).toEqual(AI);
  });

  it("drops exactly the fields the owner edited", () => {
    const merged = mergeAiStructure(AI, ["urgency", "materials", "title"]);
    expect(merged).not.toHaveProperty("urgency");
    expect(merged).not.toHaveProperty("materials");
    expect(merged).not.toHaveProperty("aiTitle");
    expect(merged.aiSummary).toBe("AI summary");
    expect(merged.actionItems).toEqual(AI.actionItems);
  });

  it("ignores unknown field names", () => {
    expect(mergeAiStructure(AI, ["bogus"])).toEqual(AI);
  });
});

describe("markEdited", () => {
  it("adds without duplicates in a stable order", () => {
    expect(markEdited(["tags"], ["urgency", "tags", "title"])).toEqual([
      "title",
      "urgency",
      "tags",
    ]);
    expect(markEdited(undefined, [])).toEqual([]);
  });
});

describe("normalizeOwnerEdits", () => {
  it("trims, drops blank rows and reports changed fields", () => {
    const { patch, fields } = normalizeOwnerEdits({
      title: "  Roof leak  ",
      materials: [
        { name: " Drip edge ", quantity: " 3 ", unit: "", notes: " " },
        { name: "   " },
      ],
      actionItems: [{ title: "Call customer", completed: true }, { title: "" }],
    });
    expect(fields).toEqual(["title", "materials", "actionItems"]);
    expect(patch.aiTitle).toBe("Roof leak");
    expect(patch.materials).toEqual([
      { name: "Drip edge", quantity: "3", unit: undefined, notes: undefined },
    ]);
    expect(patch.actionItems).toEqual([
      { title: "Call customer", assigneeHint: undefined, dueHint: undefined, priority: undefined, completed: true },
    ]);
  });

  it("lets the owner clear optional text fields", () => {
    const { patch, fields } = normalizeOwnerEdits({ siteAddress: "  ", summary: "" });
    expect(fields).toEqual(["summary", "siteAddress"]);
    expect(patch.siteAddress).toBeUndefined();
    expect(patch.aiSummary).toBe("");
  });

  it("rejects an empty title and oversized lists", () => {
    expect(() => normalizeOwnerEdits({ title: "  " })).toThrow(/Title/);
    expect(() =>
      normalizeOwnerEdits({
        materials: Array.from({ length: LIMITS.materials + 1 }, () => ({ name: "x" })),
      }),
    ).toThrow(/At most/);
  });

  it("normalises tags: lowercase, underscores, unique, capped", () => {
    const { patch } = normalizeOwnerEdits({
      tags: ["Change Order", "change order", "  ", "SAFETY", ...Array.from({ length: 30 }, (_, i) => `t${i}`)],
    });
    expect(patch.tags?.slice(0, 2)).toEqual(["change_order", "safety"]);
    expect(patch.tags).toHaveLength(LIMITS.tags);
  });

  it("returns nothing when no fields were passed", () => {
    expect(normalizeOwnerEdits({})).toEqual({ patch: {}, fields: [] });
  });
});
