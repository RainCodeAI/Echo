/**
 * Customer-update drafts (pure, tested).
 *
 * The AI turns a job's recent field notes into a short, homeowner-friendly
 * update. The owner reviews and edits it, then sends it from their own phone
 * or email: Echo never messages a customer by itself.
 */

/** Drafts per company per hour (each one is an OpenAI call). */
export const DRAFTS_PER_HOUR = 20;
/** Notes considered for one update. */
export const MAX_NOTES = 8;
/** Without a previous update, look back this far. */
export const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export const MAX_TEXT_CHARS = 640;
export const MAX_SUBJECT_CHARS = 120;
export const MAX_EMAIL_CHARS = 4_000;

export type DraftNote = {
  noteId: string;
  recordedAt: number;
  summary: string;
  timelineNotes?: string;
};

export type DraftContext = {
  companyName: string;
  customerName: string | null;
  jobTitle: string;
  address: string | null;
  notes: DraftNote[];
  /** IANA zone for dates in the prompt; UTC when unknown. */
  timeZone?: string;
};

export type CustomerDraft = {
  text: string;
  emailSubject: string;
  emailBody: string;
};

/** "Maria Ramirez" → "Maria"; "The Ramirez Family" → null (use a neutral greeting). */
export function firstName(customerName: string | null | undefined): string | null {
  const first = customerName?.trim().split(/\s+/)[0];
  if (!first || /^(the|mr|mrs|ms|dr)\.?$/i.test(first) || first.length < 2) return null;
  return first.replace(/[^\p{L}'-]/gu, "") || null;
}

/**
 * Which notes the update covers: this job's notes since the last update that
 * was sent (or the last week), newest last, always including the note the
 * owner started from.
 */
export function selectNotes<T extends { noteId: string; recordedAt: number }>(
  notes: T[],
  opts: { startNoteId: string; since: number },
): T[] {
  const start = notes.find((n) => n.noteId === opts.startNoteId);
  const recent = notes
    .filter((n) => n.recordedAt > opts.since && n.noteId !== opts.startNoteId)
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, start ? MAX_NOTES - 1 : MAX_NOTES);
  return [...recent, ...(start ? [start] : [])].sort((a, b) => a.recordedAt - b.recordedAt);
}

export const CUSTOMER_UPDATE_SYSTEM_PROMPT = [
  "You write short progress updates from a trades business (roofing, HVAC, landscaping, plumbing, etc.) to their customer, usually a homeowner.",
  "You are given the office's summaries of crew field notes. Write the update the owner would send.",
  "Rules:",
  "- Warm, plain, professional. No jargon the customer wouldn't know; explain briefly if needed.",
  "- Only state what the notes support. Never invent work, dates, times, findings or promises.",
  "- Leave out anything internal: prices, costs, margins, payments, crew mistakes or blame, crew names, staffing, other customers, internal disagreements, profanity, and the office's private notes.",
  "- If the notes mention a problem found on site (damage, rot, a leak), say so calmly and factually and say the owner will follow up about next steps. Do not quote prices or diagnose beyond the notes.",
  "- Mention the next step or next visit only if the notes give one.",
  "- Safety incidents or injuries: do not mention them; they are handled by the owner directly.",
  "- No links, no emojis, no placeholders like [Name]. Sign as the company name.",
  "- Write in English.",
  "Return JSON with: text (an SMS, at most 480 characters), emailSubject (at most 80 characters), emailBody (a slightly fuller email, 2 short paragraphs at most, greeting and sign-off included).",
].join("\n");

export const CUSTOMER_UPDATE_JSON_SCHEMA = {
  name: "customer_update",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["text", "emailSubject", "emailBody"],
    properties: {
      text: { type: "string" },
      emailSubject: { type: "string" },
      emailBody: { type: "string" },
    },
  },
} as const;

function dateLabel(ms: number, timeZone?: string) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  try {
    return new Date(ms).toLocaleDateString("en-US", { ...opts, timeZone: timeZone || "UTC" });
  } catch {
    return new Date(ms).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildCustomerUpdatePrompt(ctx: DraftContext): string {
  const name = firstName(ctx.customerName);
  const lines = [
    `Company: ${ctx.companyName}`,
    `Customer: ${name ?? "(no name on file: use a neutral greeting like \"Hi there\")"}`,
    `Job: ${ctx.jobTitle}`,
  ];
  if (ctx.address) lines.push(`Site: ${ctx.address}`);
  lines.push("", "Field notes (oldest first):");
  for (const n of ctx.notes) {
    lines.push(`- ${dateLabel(n.recordedAt, ctx.timeZone)}: ${clip(n.summary.trim(), 1_200)}`);
    if (n.timelineNotes?.trim()) lines.push(`  Timing: ${clip(n.timelineNotes.trim(), 300)}`);
  }
  return lines.join("\n");
}

/** Bracketed placeholders the model sometimes leaves ("[Your Name]"). */
const PLACEHOLDER = /\[(?:your |customer'?s? |company )?(?:name|company|phone|number|date)[^\]]*\]/gi;

function cleanText(s: unknown, max: number, companyName: string): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/\r\n?/g, "\n")
    .replace(PLACEHOLDER, companyName)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/**
 * Typographic punctuation (– — ’ “ …) isn't in the GSM SMS alphabet, so one
 * curly quote turns a message into Unicode and can triple the number of texts.
 */
export function plainPunctuation(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

/** Validate and tidy the model's JSON; throws if nothing usable came back. */
export function sanitizeDraft(raw: unknown, companyName: string): CustomerDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const draft = {
    text: plainPunctuation(cleanText(r.text, MAX_TEXT_CHARS, companyName)),
    emailSubject: cleanText(r.emailSubject, MAX_SUBJECT_CHARS, companyName).replace(/\n/g, " "),
    emailBody: cleanText(r.emailBody, MAX_EMAIL_CHARS, companyName),
  };
  if (!draft.text && !draft.emailBody) throw new Error("The AI didn't return a usable draft. Try again.");
  if (!draft.text) draft.text = plainPunctuation(clip(draft.emailBody.replace(/\s+/g, " "), MAX_TEXT_CHARS));
  if (!draft.emailBody) draft.emailBody = draft.text;
  if (!draft.emailSubject) draft.emailSubject = "Update on your project";
  return draft;
}

/** How many SMS segments a message takes (GSM-7 vs. Unicode). */
export function smsSegments(text: string): number {
  if (!text) return 0;
  const gsm = /^[\n\r -~£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€^{}\\[\]~|]*$/.test(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const len = [...text].length;
  return len <= single ? 1 : Math.ceil(len / multi);
}

/** Opens the owner's messaging app with the text filled in. */
export function smsHref(phone: string, body: string): string {
  const to = phone.replace(/[^\d+]/g, "");
  // "?&body=" works on both iOS and Android.
  return `sms:${to}?&body=${encodeURIComponent(body)}`;
}

export function mailtoHref(email: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
