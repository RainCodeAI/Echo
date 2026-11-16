import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCurrentUser } from "./lib/tenant";
import {
  budgetMessage,
  budgetState,
  chatCostMicros,
  monthKey,
  resolveBudgetUsd,
  transcribeCostMicros,
  type BudgetLevel,
} from "./lib/aiUsage";

/**
 * Per-company AI usage (estimated cost per UTC month) and the monthly budget
 * that caps it. See ARCHITECTURE §11h.
 */

async function monthRow(ctx: QueryCtx, companyId: Id<"companies">, month: string) {
  return await ctx.db
    .query("aiUsage")
    .withIndex("by_company_and_month", (q) => q.eq("companyId", companyId).eq("month", month))
    .unique();
}

export type BudgetCheck = {
  allowed: boolean;
  level: BudgetLevel;
  spentMicros: number;
  budgetUsd: number;
  message: string | null;
};

export async function checkBudget(ctx: QueryCtx, companyId: Id<"companies">, now = Date.now()): Promise<BudgetCheck> {
  const company = await ctx.db.get(companyId);
  const budgetUsd = resolveBudgetUsd(company?.aiMonthlyBudgetUsd, process.env.AI_MONTHLY_BUDGET_USD);
  const spentMicros = (await monthRow(ctx, companyId, monthKey(now)))?.costMicros ?? 0;
  const { level } = budgetState(spentMicros, budgetUsd);
  const allowed = level !== "exceeded";
  return { allowed, level, spentMicros, budgetUsd, message: allowed ? null : budgetMessage(budgetUsd, now) };
}

/** For mutations that would start paid AI work (retry, customer draft). */
export async function assertAiBudget(ctx: QueryCtx, companyId: Id<"companies">) {
  const check = await checkBudget(ctx, companyId);
  if (!check.allowed) throw new Error(check.message ?? "AI limit reached.");
}

export const check = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }): Promise<BudgetCheck> => checkBudget(ctx, companyId),
});

const EMPTY = {
  costMicros: 0,
  transcribeCalls: 0,
  structureCalls: 0,
  customerUpdateCalls: 0,
  audioSeconds: 0,
  inputTokens: 0,
  outputTokens: 0,
  skippedNotes: 0,
};

async function bump(ctx: MutationCtx, companyId: Id<"companies">, delta: Partial<typeof EMPTY>) {
  const now = Date.now();
  const month = monthKey(now);
  const row = await monthRow(ctx, companyId, month);
  const base: typeof EMPTY = row ?? EMPTY;
  const next = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof typeof EMPTY)[]) next[k] = (base[k] ?? 0) + (delta[k] ?? 0);
  if (row) await ctx.db.patch(row._id, { ...next, updatedAt: now });
  else await ctx.db.insert("aiUsage", { companyId, month, ...next, updatedAt: now });
}

/** Record one AI call's usage (called by the AI actions after each request). */
export const record = internalMutation({
  args: {
    companyId: v.id("companies"),
    kind: v.union(v.literal("transcribe"), v.literal("structure"), v.literal("customerUpdate")),
    model: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    audioSeconds: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const input = Math.max(0, Math.round(a.inputTokens ?? 0));
    const output = Math.max(0, Math.round(a.outputTokens ?? 0));
    const seconds = Math.max(0, Math.round(a.audioSeconds ?? 0));
    await bump(ctx, a.companyId, {
      costMicros: a.kind === "transcribe" ? transcribeCostMicros(a.model, seconds) : chatCostMicros(a.model, input, output),
      transcribeCalls: a.kind === "transcribe" ? 1 : 0,
      structureCalls: a.kind === "structure" ? 1 : 0,
      customerUpdateCalls: a.kind === "customerUpdate" ? 1 : 0,
      audioSeconds: seconds,
      inputTokens: input,
      outputTokens: output,
    });
    return null;
  },
});

export const recordSkipped = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    await bump(ctx, companyId, { skippedNotes: 1 });
    return null;
  },
});

/** Settings / dashboard: this month's usage against the budget, plus history. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const now = Date.now();
    const budget = await checkBudget(ctx, user.companyId, now);
    const rows = await ctx.db
      .query("aiUsage")
      .withIndex("by_company_and_month", (q) => q.eq("companyId", user.companyId))
      .order("desc")
      .take(6);
    const current: Doc<"aiUsage"> | undefined = rows.find((r) => r.month === monthKey(now));
    return {
      month: monthKey(now),
      level: budget.level,
      spentMicros: budget.spentMicros,
      budgetUsd: budget.budgetUsd,
      message: budget.message,
      thisMonth: {
        notes: current?.structureCalls ?? 0,
        audioMinutes: Math.round((current?.audioSeconds ?? 0) / 60),
        customerUpdates: current?.customerUpdateCalls ?? 0,
        skippedNotes: current?.skippedNotes ?? 0,
      },
      history: rows.map((r) => ({ month: r.month, costMicros: r.costMicros, notes: r.structureCalls })),
    };
  },
});
