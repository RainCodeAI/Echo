import { describe, expect, it } from "vitest";
import { generatePin, isValidPin, normalizePin } from "../lib/pin";

describe("generatePin", () => {
  it("always returns exactly four digits", () => {
    for (let i = 0; i < 500; i++) {
      expect(generatePin()).toMatch(/^\d{4}$/);
    }
  });

  it("can produce leading-zero pins (full 0000-9999 range)", () => {
    // Regression guard: the old generator (1000 + x % 9000) never produced
    // 0xxx pins. Odds of zero leading-zero pins in 2000 draws are ~0.
    let sawLeadingZero = false;
    for (let i = 0; i < 2000 && !sawLeadingZero; i++) {
      if (generatePin().startsWith("0")) sawLeadingZero = true;
    }
    expect(sawLeadingZero).toBe(true);
  });
});

describe("normalizePin", () => {
  it("strips non-digits and caps at four characters", () => {
    expect(normalizePin("12ab34")).toBe("1234");
    expect(normalizePin("123456")).toBe("1234");
    expect(normalizePin("  9 9  ")).toBe("99");
    expect(normalizePin("")).toBe("");
  });
});

describe("isValidPin (client)", () => {
  it("matches the four-digit rule", () => {
    expect(isValidPin("0000")).toBe(true);
    expect(isValidPin("42")).toBe(false);
    expect(isValidPin("abcd")).toBe(false);
  });
});
