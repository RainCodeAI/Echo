import { describe, expect, it } from "vitest";
import {
  buildOrderList,
  formatOrderCsv,
  formatOrderText,
  lineKey,
  normalizeName,
  normalizeUnit,
  parseQuantity,
  sourceKey,
  type SourceNote,
} from "../convex/lib/orderList";

const note = (id: string, at: number, materials: SourceNote["materials"], crewName: string | null = "Luis"): SourceNote => ({
  noteId: id,
  recordedAt: at,
  noteTitle: `Note ${id}`,
  crewName,
  materials,
});

describe("normalization", () => {
  it("units", () => {
    expect(normalizeUnit("Bundles")).toBe("bundle");
    expect(normalizeUnit("bdl.")).toBe("bundle");
    expect(normalizeUnit("linear feet")).toBe("ft");
    expect(normalizeUnit("pcs")).toBe("each");
    expect(normalizeUnit("boxes")).toBe("box");
    expect(normalizeUnit("widgets")).toBe("widget");
    expect(normalizeUnit("  ")).toBeNull();
    expect(normalizeUnit(undefined)).toBeNull();
  });
  it("names merge on case, spacing, punctuation and a plural last word", () => {
    expect(normalizeName("Architectural  Shingles!")).toBe(normalizeName("architectural shingle"));
    expect(normalizeName("2x4s")).toBe("2x4");
    expect(normalizeName("drip edge flashing")).toBe("drip edge flashing");
    expect(normalizeName("glass")).toBe("glass");
    expect(normalizeName("batteries")).toBe("battery");
    expect(normalizeName("1-1/4\" roofing nails")).toBe('1-1/4" roofing nail');
    expect(lineKey("Shingles", "bundle")).toBe("shingle|bundle");
  });
});

describe("parseQuantity", () => {
  const val = (s: string) => parseQuantity(s).value;
  it("numbers, fractions, thousands", () => {
    expect(val("12")).toBe(12);
    expect(val("12.5")).toBe(12.5);
    expect(val("1/2")).toBe(0.5);
    expect(val("2 1/2")).toBe(2.5);
    expect(val("2-1/2")).toBe(2.5);
    expect(val("1,200")).toBe(1200);
    expect(val("1/0")).toBeNull();
  });
  it("words", () => {
    expect(val("three")).toBe(3);
    expect(val("a dozen")).toBe(12);
    expect(val("a box")).toBe(1);
    expect(val("half a")).toBe(0.5);
    expect(val("a few")).toBeNull();
    expect(val("a couple")).toBeNull();
    expect(val("enough for the porch")).toBeNull();
    expect(val("")).toBeNull();
  });
  it("approximate amounts and ranges order the upper end", () => {
    expect(parseQuantity("about 10")).toMatchObject({ value: 10, approximate: true });
    expect(parseQuantity("~4")).toMatchObject({ value: 4, approximate: true });
    expect(parseQuantity("10-12")).toMatchObject({ value: 12, approximate: true });
    expect(parseQuantity("10 to 12 bundles")).toMatchObject({ value: 12, approximate: true, rest: "bundles" });
    expect(parseQuantity("10+")).toMatchObject({ value: 10, approximate: true });
  });
  it("keeps the text after the number (a unit said inside the quantity)", () => {
    expect(parseQuantity("12 bundles")).toMatchObject({ value: 12, rest: "bundles" });
  });
});

describe("buildOrderList", () => {
  const notes = [
    note("n1", 100, [
      { name: "Architectural shingles", quantity: "12", unit: "bundles", notes: "Charcoal" },
      { name: "Roofing nails", quantity: "a few", unit: "boxes" },
      { name: "Drip edge", quantity: "about 40", unit: "ft" },
    ]),
    note("n2", 200, [
      { name: "architectural shingle", quantity: "3 bundles", notes: "charcoal" },
      { name: "Roofing nails", quantity: "2", unit: "box" },
      { name: "Ice and water shield" },
      { name: "  " },
    ], "Ana"),
  ];

  it("merges the same item and unit across notes and adds up numbers", () => {
    const { toOrder, ordered } = buildOrderList(notes);
    expect(ordered).toEqual([]);
    const byName = Object.fromEntries(toOrder.map((l) => [l.name, l]));
    expect(Object.keys(byName)).toEqual(["Architectural shingles", "Drip edge", "Ice and water shield", "Roofing nails"]);
    expect(byName["Architectural shingles"]).toMatchObject({ total: 15, unit: "bundle", notes: ["Charcoal"], quantityLabel: "15 bundles" });
    expect(byName["Architectural shingles"].sources.map((s) => [s.noteId, s.crewName, s.quantityText])).toEqual([
      ["n1", "Luis", "12"],
      ["n2", "Ana", "3 bundles"],
    ]);
    expect(byName["Roofing nails"].quantityLabel).toBe("2 boxes + a few");
    expect(byName["Drip edge"].quantityLabel).toBe("~40 ft");
    expect(byName["Ice and water shield"].quantityLabel).toBe("qty not given");
  });

  it("keeps different units apart", () => {
    const { toOrder } = buildOrderList([
      note("a", 1, [{ name: "Gutter", quantity: "40", unit: "ft" }]),
      note("b", 2, [{ name: "Gutters", quantity: "2", unit: "sticks" }]),
    ]);
    expect(toOrder.map((l) => l.quantityLabel)).toEqual(["40 ft", "2 sticks"]);
  });

  it("moves ordered lines out, but a later note asking for more shows up again", () => {
    const key = lineKey("architectural shingle", "bundle");
    const covered = new Set([sourceKey("n1", key), sourceKey("n2", key)]);
    const first = buildOrderList(notes, covered);
    expect(first.toOrder.map((l) => l.name)).not.toContain("Architectural shingles");
    expect(first.ordered.map((l) => [l.name, l.quantityLabel])).toEqual([["Architectural shingles", "15 bundles"]]);

    const later = buildOrderList([...notes, note("n3", 300, [{ name: "Architectural Shingles", quantity: "2", unit: "bundle" }])], covered);
    expect(later.toOrder.find((l) => l.key === key)?.quantityLabel).toBe("2 bundles");
  });
});

describe("export", () => {
  const { toOrder } = buildOrderList([
    note("n1", 1, [
      { name: "Architectural shingles", quantity: "15", unit: "bundles", notes: "Charcoal" },
      { name: "=HYPERLINK(\"http://x\")", quantity: "1" },
      { name: "Trim, white", quantity: "4", unit: "sticks" },
    ]),
  ]);

  it("formats a message for the supply house", () => {
    const text = formatOrderText(
      { jobTitle: "Ramirez reroof", address: "12 Oak St", companyName: "Acme Roofing", date: "Nov 15, 2026" },
      toOrder,
    );
    expect(text).toBe(
      [
        "Materials order: Ramirez reroof",
        "Site: 12 Oak St",
        "From Acme Roofing · Nov 15, 2026",
        "",
        "- =HYPERLINK(\"http://x\"): 1",
        "- Architectural shingles: 15 bundles (Charcoal)",
        "- Trim, white: 4 sticks",
      ].join("\n"),
    );
  });

  it("CSV quotes commas and quotes, and neutralizes formulas", () => {
    const csv = formatOrderCsv(toOrder).split("\r\n");
    expect(csv[0]).toBe("Item,Quantity,Unit,Other quantities,Notes,From notes");
    expect(csv[1]).toBe(`"'=HYPERLINK(""http://x"")",1,,,,1`);
    expect(csv[2]).toBe("Architectural shingles,15,bundle,,Charcoal,1");
    expect(csv[3]).toBe(`"Trim, white",4,stick,,,1`);
  });
});
