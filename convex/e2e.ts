import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { hashPin } from "./lib/pin";

/**
 * Test-only helpers for the end-to-end suite (tests/e2e), which runs against
 * a throwaway local Convex backend in CI. Internal (not callable from the
 * browser) AND refused unless the deployment has E2E_SEED_ALLOWED=1, which
 * is never set in production.
 */
function assertAllowed() {
  if (process.env.E2E_SEED_ALLOWED !== "1") {
    throw new Error("E2E helpers are disabled on this deployment.");
  }
}

const E2E_PIN = "2468";

/** A fresh workspace with one crew member (PIN 2468) and one open job. */
export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    assertAllowed();
    const now = Date.now();
    const companyId = await ctx.db.insert("companies", {
      name: "E2E Roofing",
      primaryTrade: "roofing",
      timezone: "UTC",
      createdAt: now,
      updatedAt: now,
    });
    const ownerId = await ctx.db.insert("users", {
      clerkUserId: `e2e-owner-${now}`,
      companyId,
      name: "E2E Owner",
      email: "owner@e2e.invalid",
      role: "owner",
      createdAt: now,
    });
    await ctx.db.insert("teamMembers", {
      companyId,
      name: "Luis Garcia",
      pinHash: await hashPin(companyId, E2E_PIN),
      pinLength: 4,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("jobs", {
      companyId,
      title: "Ramirez reroof",
      status: "in_progress",
      address: "412 Oak St",
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    return { companyId, jobId, pin: E2E_PIN };
  },
});

/** What the suite asserts on: the workspace's notes, newest first. */
export const notes = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }) => {
    assertAllowed();
    const rows = await ctx.db
      .query("voiceNotes")
      .withIndex("by_company_and_created", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(20);
    return rows.map((n) => ({
      id: n._id,
      rawTranscript: n.rawTranscript,
      jobId: n.jobId ?? null,
      hasAudio: !!n.audioStorageId,
      audioMimeType: n.audioMimeType ?? null,
      teamMemberId: n.teamMemberId ?? null,
      status: n.status,
      aiStatus: n.aiStatus,
      aiErrorMessage: n.aiErrorMessage ?? null,
      clientUploadId: n.clientUploadId ?? null,
    }));
  },
});
