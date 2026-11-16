import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCurrentUser } from "./lib/tenant";
import {
  alertReason,
  buildAlertMessage,
  maskRecipient,
  underRateLimit,
  ALERT_WINDOW_MS,
  type AlertContent,
} from "./lib/alerts";
import { sendEmail, sendSms, type SendResult } from "./lib/alertProviders";

/**
 * Urgent-note alerts (email via Resend, SMS via Twilio).
 *
 * Triggers (scheduled from convex/voiceNotes.ts):
 *  - "ai_done":   AI finished and the note is worker-flagged or rated high/emergency
 *  - "ai_failed": AI failed on a worker-flagged note
 *  - "fallback":  45s after a worker-flagged submit, in case AI is slow
 * `claimNoteAlert` makes the first trigger win: one alert per note, ever.
 */

type Recipients = { email: string | null; phone: string | null };

type ClaimResult =
  | { send: false; why: string }
  | {
      send: true;
      companyId: Id<"companies">;
      recipients: Recipients;
      content: AlertContent;
    };

type ChannelResult = {
  channel: "email" | "sms";
  recipient: string;
  status: "sent" | "failed" | "not_configured";
  detail?: string;
  providerId?: string;
};

async function companyRecipients(
  ctx: QueryCtx | MutationCtx,
  company: Doc<"companies">,
): Promise<Recipients> {
  let email = company.notificationEmail ?? null;
  if (!email) {
    const users = await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", company._id))
      .collect();
    email = users.find((u) => u.role === "owner" && u.email)?.email ?? null;
  }
  return { email, phone: company.alertPhone ?? null };
}

function noteUrl(noteId: string): string | null {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base ? `${base}/dashboard/notes/${noteId}` : null;
}

export const claimNoteAlert = internalMutation({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }): Promise<ClaimResult> => {
    const note = await ctx.db.get(noteId);
    if (!note) return { send: false as const, why: "missing" };
    if (note.urgentAlertAt) return { send: false as const, why: "already_alerted" };
    if (!alertReason(note)) return { send: false as const, why: "not_urgent" };

    const company = await ctx.db.get(note.companyId);
    if (!company?.notificationsEnabled) {
      return { send: false as const, why: "alerts_off" };
    }

    const now = Date.now();
    // Claim first: from here on this note never alerts again.
    await ctx.db.patch(noteId, { urgentAlertAt: now });

    const recent = await ctx.db
      .query("alerts")
      .withIndex("by_company_and_created", (q) =>
        q.eq("companyId", note.companyId).gt("createdAt", now - ALERT_WINDOW_MS),
      )
      .collect();
    const alertedNotes = new Map<string, number>();
    for (const a of recent) {
      if (!a.isTest && a.noteId && (a.status === "sent" || a.status === "failed")) {
        alertedNotes.set(a.noteId, a.createdAt);
      }
    }
    const recipients = await companyRecipients(ctx, company);
    const log = async (channel: "email" | "sms", recipient: string, detail: string) =>
      ctx.db.insert("alerts", {
        companyId: note.companyId,
        noteId,
        channel,
        recipient,
        status: "skipped",
        detail,
        createdAt: now,
      });

    if (!underRateLimit([...alertedNotes.values()], now)) {
      await log("email", recipients.email ? maskRecipient(recipients.email) : "—", "Hourly alert limit reached.");
      return { send: false as const, why: "rate_limited" };
    }
    if (!recipients.email && !recipients.phone) {
      await log("email", "—", "No alert email or phone set in Settings.");
      return { send: false as const, why: "no_recipients" };
    }

    let crewName: string | null = null;
    if (note.teamMemberId) {
      crewName = (await ctx.db.get(note.teamMemberId))?.name ?? null;
    }
    let jobTitle: string | null = null;
    if (note.jobId) {
      const job = await ctx.db.get(note.jobId);
      if (job && job.companyId === note.companyId) jobTitle = job.title;
    }

    const content: AlertContent = {
      companyName: company.name,
      crewName,
      jobTitle,
      urgency: note.urgency,
      workerFlaggedUrgent: !!note.workerFlaggedUrgent,
      aiTitle: note.aiTitle ?? null,
      aiSummary: note.aiSummary ?? null,
      transcript: note.rawTranscript,
      siteAddress: note.siteAddress ?? null,
      recordedAt: note.recordedAt,
      noteUrl: null, // filled in by the action (reads APP_URL)
    };
    return { send: true as const, companyId: note.companyId, recipients, content };
  },
});

export const recordResults = internalMutation({
  args: {
    companyId: v.id("companies"),
    noteId: v.optional(v.id("voiceNotes")),
    isTest: v.optional(v.boolean()),
    results: v.array(
      v.object({
        channel: v.union(v.literal("email"), v.literal("sms")),
        recipient: v.string(),
        status: v.union(v.literal("sent"), v.literal("failed"), v.literal("not_configured")),
        detail: v.optional(v.string()),
        providerId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { companyId, noteId, isTest, results }) => {
    const now = Date.now();
    for (const r of results) {
      await ctx.db.insert("alerts", { companyId, noteId, isTest, createdAt: now, ...r });
    }
  },
});

async function deliver(
  recipients: Recipients,
  content: AlertContent,
): Promise<ChannelResult[]> {
  const env = process.env;
  const msg = buildAlertMessage(content);
  const jobs: Promise<{ channel: "email" | "sms"; recipient: string; result: SendResult }>[] = [];
  if (recipients.email) {
    const to = recipients.email;
    jobs.push(
      sendEmail({ to, subject: msg.subject, text: msg.text, html: msg.html }, env).then(
        (result) => ({ channel: "email" as const, recipient: maskRecipient(to), result }),
      ),
    );
  }
  if (recipients.phone) {
    const to = recipients.phone;
    jobs.push(
      sendSms({ to, body: msg.sms }, env).then((result) => ({
        channel: "sms" as const,
        recipient: maskRecipient(to),
        result,
      })),
    );
  }
  const settled = await Promise.all(jobs);
  return settled.map(({ channel, recipient, result }) => ({
    channel,
    recipient,
    status: result.status,
    detail: result.status === "sent" ? undefined : result.detail,
    providerId: result.status === "sent" ? result.providerId : undefined,
  }));
}

export const sendUrgentAlert = internalAction({
  args: {
    noteId: v.id("voiceNotes"),
    trigger: v.union(v.literal("ai_done"), v.literal("ai_failed"), v.literal("fallback")),
  },
  handler: async (ctx, { noteId }): Promise<string> => {
    const claim: ClaimResult = await ctx.runMutation(internal.alerts.claimNoteAlert, {
      noteId,
    });
    if (!claim.send) return claim.why;
    const results = await deliver(claim.recipients, {
      ...claim.content,
      noteUrl: noteUrl(noteId),
    });
    await ctx.runMutation(internal.alerts.recordResults, {
      companyId: claim.companyId,
      noteId,
      results,
    });
    return "sent";
  },
});

export const testAlertContext = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    if (!user) throw new Error("Not authenticated.");
    if (user.role !== "owner") throw new Error("Only the workspace owner can do that.");
    const company = await ctx.db.get(user.companyId);
    if (!company) throw new Error("Not found");
    return {
      companyId: company._id,
      companyName: company.name,
      recipients: await companyRecipients(ctx, company),
    };
  },
});

/**
 * Settings → "Send test alert" (owner only). Sends to the saved recipients,
 * whether or not alerts are switched on, and reports per-channel results.
 */
export const sendTestAlert = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    { channel: "email" | "sms"; recipient: string; status: string; detail: string | null }[]
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");
    const info: {
      companyId: Id<"companies">;
      companyName: string;
      recipients: Recipients;
    } = await ctx.runQuery(internal.alerts.testAlertContext, {
      clerkUserId: identity.subject,
    });
    if (!info.recipients.email && !info.recipients.phone) {
      throw new Error("Add an alert email or mobile number first, then save.");
    }
    const base = process.env.APP_URL?.replace(/\/$/, "");
    const results = await deliver(info.recipients, {
      companyName: info.companyName,
      crewName: "Test crew member",
      jobTitle: "Sample job",
      urgency: "high",
      workerFlaggedUrgent: true,
      aiTitle: "This is a test alert",
      aiSummary:
        "If you're reading this, urgent field notes will reach you here. No action needed.",
      transcript: "",
      siteAddress: null,
      recordedAt: Date.now(),
      noteUrl: base ? `${base}/dashboard/notes` : null,
      isTest: true,
    });
    await ctx.runMutation(internal.alerts.recordResults, {
      companyId: info.companyId as Id<"companies">,
      isTest: true,
      results,
    });
    return results.map(({ channel, recipient, status, detail }) => ({
      channel,
      recipient,
      status,
      detail: detail ?? null,
    }));
  },
});

/** Alert history for one note (dashboard), tenant-checked. */
export const listForNote = query({
  args: { noteId: v.id("voiceNotes") },
  handler: async (ctx, { noteId }) => {
    const user = await requireCurrentUser(ctx);
    const note = await ctx.db.get(noteId);
    if (!note || note.companyId !== user.companyId) return [];
    const rows = await ctx.db
      .query("alerts")
      .withIndex("by_note", (q) => q.eq("noteId", noteId))
      .collect();
    return rows.map((r) => ({
      id: r._id,
      channel: r.channel,
      recipient: r.recipient,
      status: r.status,
      detail: r.detail ?? null,
      createdAt: r.createdAt,
    }));
  },
});
