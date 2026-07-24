import { describe, expect, it } from "vitest";
import { hashPin, isValidPin, safeEqualHex } from "../convex/lib/pin";

describe("hashPin", () => {
  it("is deterministic for the same company + pin", async () => {
    const a = await hashPin("company_1", "1234");
    const b = await hashPin("company_1", "1234");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across companies for the same pin (company-scoped salt)", async () => {
    const a = await hashPin("company_1", "1234");
    const b = await hashPin("company_2", "1234");
    expect(a).not.toBe(b);
  });

  it("differs across pins in the same company", async () => {
    const a = await hashPin("company_1", "1234");
    const b = await hashPin("company_1", "1235");
    expect(a).not.toBe(b);
  });
});

describe("safeEqualHex", () => {
  it("is true for identical strings", () => {
    expect(safeEqualHex("abcd1234", "abcd1234")).toBe(true);
  });

  it("is false for a single-character difference", () => {
    expect(safeEqualHex("abcd1234", "abcd1235")).toBe(false);
  });

  it("is false for differing lengths", () => {
    expect(safeEqualHex("abc", "abcd")).toBe(false);
  });
});

describe("isValidPin (server)", () => {
  it("accepts exactly four digits, including leading zeros", () => {
    expect(isValidPin("0007")).toBe(true);
    expect(isValidPin("9999")).toBe(true);
  });

  it("rejects anything that is not four digits", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
  });
});
