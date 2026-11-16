import { describe, expect, it } from "vitest";
import { evaluateConfig } from "../convex/lib/configCheck";

const GOOD = {
  ENTRY_TOKEN_SECRET: "a".repeat(64),
  CLERK_JWT_ISSUER_DOMAIN: "https://echo.clerk.accounts.dev",
  OPENAI_API_KEY: "sk-proj-abc",
};

const byName = (r: ReturnType<typeof evaluateConfig>, name: string) =>
  r.checks.find((c) => c.name === name)!;

describe("evaluateConfig", () => {
  it("is ready with all required settings", () => {
    expect(evaluateConfig(GOOD).ready).toBe(true);
  });

  it("flags a missing or short entry secret as blocking", () => {
    expect(evaluateConfig({ ...GOOD, ENTRY_TOKEN_SECRET: undefined }).ready).toBe(false);
    const short = evaluateConfig({ ...GOOD, ENTRY_TOKEN_SECRET: "short" });
    expect(short.ready).toBe(false);
    expect(byName(short, "ENTRY_TOKEN_SECRET").detail).toMatch(/Too short/);
  });

  it("flags a missing OpenAI key and a non-https issuer", () => {
    expect(evaluateConfig({ ...GOOD, OPENAI_API_KEY: undefined }).ready).toBe(false);
    expect(
      evaluateConfig({ ...GOOD, CLERK_JWT_ISSUER_DOMAIN: "echo.clerk.dev" }).ready,
    ).toBe(false);
  });

  it("treats the kill switch as a warning, not a blocker", () => {
    const r = evaluateConfig({ ...GOOD, OPENAI_KILL_SWITCH: "1" });
    expect(r.ready).toBe(true);
    expect(byName(r, "OPENAI_KILL_SWITCH").ok).toBe(false);
  });

  it("warns (without blocking) when storage cleanup is switched off", () => {
    const r = evaluateConfig({ ...GOOD, STORAGE_CLEANUP_DISABLED: "1" });
    expect(r.ready).toBe(true);
    expect(byName(r, "STORAGE_CLEANUP_DISABLED").ok).toBe(false);
  });

  it("never echoes secret values", () => {
    const text = JSON.stringify(evaluateConfig(GOOD));
    expect(text).not.toContain(GOOD.ENTRY_TOKEN_SECRET);
    expect(text).not.toContain("sk-proj-abc");
  });
});
