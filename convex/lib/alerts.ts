/**
 * Urgent-note alerts: decision + message formatting (pure, unit-tested).
 *
 * A note is alert-worthy when the crew flagged it urgent on the phone, or the
 * AI rated it high/emergency. Each note alerts at most once (see
 * convex/alerts.ts for delivery, dedupe and rate limiting).
 */

export type AlertUrgency = "low" | "medium" | "high" | "emergency";

export type AlertableNote = {
  workerFlaggedUrgent?: boolean;
  urgency?: AlertUrgency;
  aiStatus: "pending" | "processing" | "completed" | "failed";
};

/** Why this note should alert, or null if it shouldn't. */
export function alertReason(note: AlertableNote): "worker_flag" | "ai_urgency" | null {
  if (note.workerFlaggedUrgent) return "worker_flag";
  // Only trust AI urgency once structuring finished (the capture-time default
  // is "medium", and a worker flag sets "high" before AI runs).
  if (
    note.aiStatus === "completed" &&
    (note.urgency === "high" || note.urgency === "emergency")
  ) {
    return "ai_urgency";
  }
  return null;
}

/** Wait this long for AI before alerting on a worker-flagged note anyway. */
export const WORKER_FLAG_FALLBACK_MS = 45_000;
/** Per-company cap so a bad day (or a bug) can't run up an SMS bill. */
export const MAX_ALERTS_PER_HOUR = 20;
export const ALERT_WINDOW_MS = 60 * 60 * 1000;

export function underRateLimit(
  recentAlertTimes: number[],
  now: number,
  limit = MAX_ALERTS_PER_HOUR,
): boolean {
  return recentAlertTimes.filter((t) => now - t < ALERT_WINDOW_MS).length < limit;
}

/**
 * Normalise a phone number to E.164 (what Twilio needs). Accepts common
 * North American formats ("(555) 123-4567", "555.123.4567", "1-555-…") and
 * explicit international numbers ("+44 20 …"). Returns null if invalid.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+15551234567" → "•••• 4567" for logs and the dashboard. */
export function maskRecipient(to: string): string {
  if (to.includes("@")) {
    const [user, domain] = to.split("@");
    return `${user.slice(0, 1)}•••@${domain}`;
  }
  return `•••• ${to.slice(-4)}`;
}

export type AlertContent = {
  companyName: string;
  crewName: string | null;
  jobTitle: string | null;
  urgency: AlertUrgency | undefined;
  workerFlaggedUrgent: boolean;
  aiTitle: string | null;
  aiSummary: string | null;
  transcript: string;
  siteAddress: string | null;
  recordedAt: number;
  noteUrl: string | null;
  isTest?: boolean;
};

const SMS_MAX = 320; // two SMS segments

function urgencyLabel(c: AlertContent) {
  if (c.urgency === "emergency") return "EMERGENCY";
  return "URGENT";
}

function clip(text: string, max: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function buildAlertMessage(c: AlertContent): {
  subject: string;
  text: string;
  sms: string;
  html: string;
} {
  const who = c.crewName ?? "Crew";
  const where = c.jobTitle ? ` · ${c.jobTitle}` : "";
  const headline = c.aiTitle || clip(c.transcript, 80) || "Field note";
  const body =
    c.aiSummary || clip(c.transcript, 600) || "(no transcript yet — audio is saved)";
  const flagged = c.workerFlaggedUrgent ? "Flagged urgent by the crew." : "";
  const prefix = c.isTest ? "[TEST] " : "";

  const subject = `${prefix}${urgencyLabel(c)}: ${headline} (${who}${where})`;

  const lines = [
    `${prefix}${urgencyLabel(c)} field note — ${c.companyName}`,
    `${who}${where}`,
    c.siteAddress ? `Site: ${c.siteAddress}` : null,
    "",
    headline,
    body,
    flagged || null,
    "",
    c.noteUrl ? `Open: ${c.noteUrl}` : null,
  ].filter((l) => l !== null);
  const text = lines.join("\n");

  // SMS: headline + summary squeezed to fit, link always kept intact.
  const smsHead = `${prefix}Echo ${urgencyLabel(c)} – ${who}${where}: `;
  const link = c.noteUrl ? ` ${c.noteUrl}` : "";
  const room = Math.max(40, SMS_MAX - smsHead.length - link.length);
  const sms = `${smsHead}${clip(c.aiSummary || headline, room)}${link}`;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p style="margin:0 0 4px;font-weight:700;color:${c.urgency === "emergency" ? "#b91c1c" : "#c2410c"}">${esc(prefix + urgencyLabel(c))} field note — ${esc(c.companyName)}</p>
<p style="margin:0 0 12px;color:#555">${esc(who + where)}${c.siteAddress ? ` · ${esc(c.siteAddress)}` : ""}</p>
<p style="margin:0 0 4px;font-weight:600">${esc(headline)}</p>
<p style="margin:0 0 12px">${esc(body)}</p>
${flagged ? `<p style="margin:0 0 12px;color:#555">${esc(flagged)}</p>` : ""}
${c.noteUrl ? `<p style="margin:0"><a href="${esc(c.noteUrl)}" style="display:inline-block;background:#10b981;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open the note</a></p>` : ""}
</div>`;

  return { subject, text, sms, html };
}
