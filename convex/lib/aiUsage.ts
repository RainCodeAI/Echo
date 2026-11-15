/**
 * Per-company AI usage and monthly budget (pure, tested).
 *
 * Costs are *estimates* from published per-token / per-minute prices, kept in
 * micro-dollars (1 USD = 1,000,000) so sums stay exact integers. Update
 * PRICES when OpenAI's pricing or our models change.
 */

export type AiKind = "transcribe" | "structure" | "customerUpdate";

/** USD per 1M tokens (chat) — input / output. */
const CHAT_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
};
/** Unknown chat model: assume a large model so we over- rather than under-estimate. */
const CHAT_FALLBACK = { input: 2.5, output: 10 };

/** USD per audio minute. */
const TRANSCRIBE_PRICES: Record<string, number> = {
  "whisper-1": 0.006,
  "gpt-4o-transcribe": 0.006,
  "gpt-4o-mini-transcribe": 0.003,
};
const TRANSCRIBE_FALLBACK = 0.006;

/** Default monthly budget per company when neither env nor override sets one. */
export const DEFAULT_MONTHLY_BUDGET_USD = 25;
/** Share of the budget at which owners are warned. */
export const WARNING_RATIO = 0.8;

const priceKey = (model: string) => {
  // "gpt-4o-mini-2024-07-18" → "gpt-4o-mini"
  const m = model.trim().toLowerCase();
  const keys = Object.keys({ ...CHAT_PRICES, ...TRANSCRIBE_PRICES }).sort((a, b) => b.length - a.length);
  return keys.find((k) => m === k || m.startsWith(`${k}-`)) ?? m;
};

/** Round up to whole micro-dollars, ignoring float noise (0.1 × 3 = 0.30000000000000004). */
const ceilMicros = (x: number) => Math.ceil(Math.round(x * 1000) / 1000);

export function chatCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const p = CHAT_PRICES[priceKey(model)] ?? CHAT_FALLBACK;
  // $/1M tokens × tokens = micro-dollars.
  return ceilMicros(Math.max(0, inputTokens) * p.input + Math.max(0, outputTokens) * p.output);
}

export function transcribeCostMicros(model: string, audioSeconds: number): number {
  const perMinute = TRANSCRIBE_PRICES[priceKey(model)] ?? TRANSCRIBE_FALLBACK;
  return ceilMicros((Math.max(0, audioSeconds) / 60) * perMinute * 1_000_000);
}

/**
 * Seconds of audio sent for transcription. Prefer the phone's reported
 * duration; otherwise estimate from the file size (~32 kbps voice).
 */
export function estimateAudioSeconds(durationMs: number | undefined, bytes: number | undefined): number {
  if (durationMs && durationMs > 0 && durationMs < 3_600_000) return Math.ceil(durationMs / 1000);
  if (bytes && bytes > 0) return Math.min(3600, Math.max(1, Math.ceil(bytes / 4000)));
  return 60;
}

/** Usage months are UTC calendar months: "2026-11". */
export function monthKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

/** First moment of the next UTC month (when a paused workspace resumes). */
export function nextMonthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/**
 * The company's budget in USD: its override if set (0 pauses AI for that
 * company), else the deployment default (env AI_MONTHLY_BUDGET_USD).
 */
export function resolveBudgetUsd(override: number | undefined, envValue: string | undefined): number {
  if (override !== undefined && Number.isFinite(override) && override >= 0) return override;
  const env = envValue === undefined ? NaN : Number(envValue);
  return Number.isFinite(env) && env >= 0 ? env : DEFAULT_MONTHLY_BUDGET_USD;
}

export type BudgetLevel = "ok" | "warning" | "exceeded";

export function budgetState(spentMicros: number, budgetUsd: number): { level: BudgetLevel; ratio: number } {
  const budgetMicros = budgetUsd * 1_000_000;
  if (budgetMicros <= 0) return { level: "exceeded", ratio: 1 };
  const ratio = spentMicros / budgetMicros;
  return { level: ratio >= 1 ? "exceeded" : ratio >= WARNING_RATIO ? "warning" : "ok", ratio };
}

export const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 2 : 0)}`;

/** What owners see when AI is skipped because of the budget. */
export function budgetMessage(budgetUsd: number, now: number): string {
  if (budgetUsd <= 0) {
    return "AI is paused for this workspace. The recording and phone transcript are saved. Contact support to turn it back on.";
  }
  const resume = new Date(nextMonthStart(now)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `This month's AI limit (${usd(budgetUsd * 1_000_000)}) is used up. The recording and phone transcript are saved; AI picks up again on ${resume}, or sooner if the limit is raised.`;
}
