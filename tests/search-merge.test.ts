import { describe, expect, it } from "vitest";
import { mergeSearchHits, normalizeSearch } from "../convex/lib/search";
import { companyPinLength, isValidPin, memberPinLength } from "../convex/lib/pin";

describe("mergeSearchHits", () => {
  it("ranks notes matching in more fields first, then by best rank", () => {
    const a = { _id: "a" }, b = { _id: "b" }, c = { _id: "c" }, d = { _id: "d" };
    const title = [c, a];
    const summary = [b, a];
    const transcript = [d, b, a];
    expect(mergeSearchHits([title, summary, transcript]).map((x) => x._id)).toEqual(["a", "b", "c", "d"]);
  });
  it("normalizes terms", () => {
    expect(normalizeSearch("  soft   decking ")).toBe("soft decking");
    expect(normalizeSearch(undefined)).toBe("");
    expect(normalizeSearch("x".repeat(500))).toHaveLength(200);
  });
});

describe("PIN length (server)", () => {
  it("company and member lengths default to 4", () => {
    expect(companyPinLength(undefined)).toBe(4);
    expect(companyPinLength({ pinLength: 6 })).toBe(6);
    expect(companyPinLength({ pinLength: 5 })).toBe(4);
    expect(memberPinLength({})).toBe(4);
    expect(isValidPin("123456", 6)).toBe(true);
    expect(isValidPin("1234", 6)).toBe(false);
    expect(isValidPin("12345a", 6)).toBe(false);
  });
});
