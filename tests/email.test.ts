import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "../convex/lib/email";

describe("normalizeEmail", () => {
  it("lowercases and trims so matching is case/whitespace-insensitive", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeEmail("ALREADY@lower.com")).toBe("already@lower.com");
  });
});

describe("isValidEmail", () => {
  it("accepts typical addresses", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("teammate@company.com")).toBe(true);
    expect(isValidEmail("  spaced@ok.com  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("@no-local.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});
