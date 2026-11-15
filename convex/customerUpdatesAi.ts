"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import OpenAI from "openai";
import { sanitizeDraft } from "./lib/customerUpdate";
import { DEFAULT_STRUCTURE_MODEL, requestCustomerUpdate } from "./lib/openaiCalls";

/**
 * Writes one customer-update draft (scheduled by customerUpdates.requestDraft).
 * Uses the same OPENAI_API_KEY / OPENAI_MODEL / OPENAI_KILL_SWITCH settings as
 * note structuring.
 */
export const generate = internalAction({
  args: { updateId: v.id("customerUpdates") },
  handler: async (ctx, { updateId }) => {
    const context = await ctx.runQuery(internal.customerUpdates.draftContext, { updateId });
    if (!context) return;

    const fail = (error: string) => ctx.runMutation(internal.customerUpdates.failDraft, { updateId, error });
    const kill = process.env.OPENAI_KILL_SWITCH;
    if (kill === "1" || kill === "true") {
      await fail("AI drafting is paused right now. Write the update yourself, or try again later.");
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      await fail("AI isn't set up on this workspace (OPENAI_API_KEY is missing).");
      return;
    }
    if (context.notes.length === 0) {
      await fail("There's nothing in this job's notes to summarize yet.");
      return;
    }

    try {
      const model = process.env.OPENAI_MODEL || DEFAULT_STRUCTURE_MODEL;
      const raw = await requestCustomerUpdate(new OpenAI({ apiKey, maxRetries: 1 }), {
        ...context,
        model,
        onUsage: (usage) =>
          ctx.runMutation(internal.aiUsage.record, { companyId: context.companyId, kind: "customerUpdate", model, ...usage }),
      });
      const draft = sanitizeDraft(raw, context.companyName);
      await ctx.runMutation(internal.customerUpdates.saveDraft, { updateId, ...draft });
    } catch (err) {
      await fail(err instanceof Error ? err.message : "Couldn't write the draft. Try again.");
    }
  },
});
