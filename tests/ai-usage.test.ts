import { describe, expect, it } from "vitest";
import {
  budgetMessage,
  budgetState,
  chatCostMicros,
  DEFAULT_MONTHLY_BUDGET_USD,
  estimateAudioSeconds,
  monthKey,
  nextMonthStart,
  resolveBudgetUsd,
  transcribeCostMicros,
  usd,
} from "../convex/lib/aiUsage";
import { evaluateConfig } from "../convex/lib/configCheck";

describe("cost estimates", () => {
  it("chat tokens at the model's price, dated model names included", () => {
    // gpt-4o-mini: $0.15 / $0.60 per 1M tokens → 1,200 in + 300 out = 180 + 180 µ$
    expect(chatCostMicros("gpt-4o-mini", 1200, 300)).toBe(360);
    expect(chatCostMicros("gpt-4o-mini-2024-07-18", 1200, 300)).toBe(360);
    expect(chatCostMicros("gpt-4o", 1000, 1000)).toBe(12_500);
  });
  it("unknown models are priced high, never free", () => {
    expect(chatCostMicros("some-new-model", 1000, 1000)).toBe(12_500);
    expect(transcribeCostMicros("some-new-transcriber", 60)).toBe(6_000);
  });
  it("transcription per audio minute", () => {
    expect(transcribeCostMicros("whisper-1", 90)).toBe(9_000);
    expect(transcribeCostMicros("gpt-4o-mini-transcribe", 60)).toBe(3_000);
    expect(transcribeCostMicros("whisper-1", 1)).toBe(100); // 1s rounds up, never down to free
  });
  it("audio length: phone duration, else file size, else a minute", () => {
    expect(estimateAudioSeconds(42_300, 999_999)).toBe(43);
    expect(estimateAudioSeconds(undefined, 120_000)).toBe(30);
    expect(estimateAudioSeconds(0, undefined)).toBe(60);
    expect(estimateAudioSeconds(undefined, 1e9)).toBe(3600);
  });
});

describe("budget", () => {
  it("override beats env beats default; 0 is a real value (paused)", () => {
    expect(resolveBudgetUsd(undefined, undefined)).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(resolveBudgetUsd(undefined, "40")).toBe(40);
    expect(resolveBudgetUsd(undefined, "lots")).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(resolveBudgetUsd(10, "40")).toBe(10);
    expect(resolveBudgetUsd(0, "40")).toBe(0);
    expect(resolveBudgetUsd(-5, "40")).toBe(40);
  });
  it("warns at 80%, stops at 100%, and a zero budget is always exceeded", () => {
    expect(budgetState(19_999_999, 25).level).toBe("ok");
    expect(budgetState(20_000_000, 25).level).toBe("warning");
    expect(budgetState(25_000_000, 25).level).toBe("exceeded");
    expect(budgetState(0, 0).level).toBe("exceeded");
  });
  it("UTC months and the next reset", () => {
    expect(monthKey(Date.UTC(2026, 10, 30, 23, 59))).toBe("2026-11");
    expect(monthKey(Date.UTC(2026, 11, 31, 23))).toBe("2026-12");
    expect(new Date(nextMonthStart(Date.UTC(2026, 11, 15))).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("messages say what's saved and when AI resumes", () => {
    expect(budgetMessage(25, Date.UTC(2026, 10, 15))).toBe(
      "This month's AI limit ($25) is used up. The recording and phone transcript are saved; AI picks up again on Dec 1, or sooner if the limit is raised.",
    );
    expect(budgetMessage(0, Date.UTC(2026, 10, 15))).toMatch(/AI is paused for this workspace/);
    expect(usd(9_360)).toBe("$0.01");
    expect(usd(125_000_000)).toBe("$125");
  });
  it("config check reports the budget setting", () => {
    const base = { ENTRY_TOKEN_SECRET: "x".repeat(40), OPENAI_API_KEY: "sk-x", CLERK_JWT_ISSUER_DOMAIN: "https://a.clerk.accounts.dev", APP_URL: "https://e" };
    const item = (env: Record<string, string | undefined>) => evaluateConfig(env).checks.find((c) => c.name === "AI_MONTHLY_BUDGET_USD");
    expect(item(base)?.detail).toMatch(/default \$25/);
    expect(item({ ...base, AI_MONTHLY_BUDGET_USD: "40" })).toMatchObject({ ok: true, detail: expect.stringMatching(/\$40\/month/) });
    expect(item({ ...base, AI_MONTHLY_BUDGET_USD: "0" })).toMatchObject({ ok: false, detail: expect.stringMatching(/paused/) });
  });
});
