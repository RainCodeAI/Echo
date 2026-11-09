/**
 * Daily digest: scheduling math, stats and email formatting (pure, tested).
 *
 * Each morning (company-local hour, default 7) the owner gets one email
 * summarising the last 24 hours. Quiet days send nothing.
 */

export const DEFAULT_DIGEST_HOUR = 7;
/** A digest missed at its hour (cron hiccup) still goes out within this many hours. */
export const DIGEST_CATCH_UP_HOURS = 3;
export const DIGEST_PERIOD_MS = 24 * 60 * 60 * 1000;
export const DIGEST_TIMEZONE_FALLBACK = "UTC";

/** Local hour (0–23) and calendar date ("YYYY-MM-DD") in `timeZone`. */
export function localTime(
  now: number,
  timeZone: string | undefined,
): { hour: number; dateKey: string; timeZone: string } {
  const tz = timeZone?.trim() || DIGEST_TIMEZONE_FALLBACK;
  let parts: Intl.DateTimeFormatPart[];
  let used = tz;
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
  } catch {
    used = DIGEST_TIMEZONE_FALLBACK; // invalid zone name in settings
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: used,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(now));
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    hour: Number(get("hour")) % 24,
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    timeZone: used,
  };
}

export type DigestSettings = {
  digestEnabled?: boolean;
  digestHour?: number;
  timezone?: string;
  lastDigestDateKey?: string;
};

/** Is today's digest due for this company right now? Returns the local date key if so. */
export function digestDueDateKey(company: DigestSettings, now: number): string | null {
  if (!company.digestEnabled) return null;
  const target = company.digestHour ?? DEFAULT_DIGEST_HOUR;
  const { hour, dateKey } = localTime(now, company.timezone);
  if (company.lastDigestDateKey === dateKey) return null;
  if (hour < target || hour >= target + DIGEST_CATCH_UP_HOURS) return null;
  return dateKey;
}

// --- Stats ---------------------------------------------------------------

type Urgency = "low" | "medium" | "high" | "emergency";

export type DigestNote = {
  _id: string;
  createdAt: number;
  status: "processing" | "ready" | "reviewed" | "archived" | "failed";
  aiStatus: "pending" | "processing" | "completed" | "failed";
  teamMemberId?: string;
  crewName: string | null;
  jobTitle: string | null;
  aiTitle?: string;
  rawTranscript: string;
  urgency?: Urgency;
  workerFlaggedUrgent?: boolean;
  materials?: { name: string; quantity?: string; unit?: string }[];
  actionItems?: { title: string; completed?: boolean }[];
};

const URGENCY_RANK: Record<string, number> = { emergency: 3, high: 2, medium: 1, low: 0 };

const isUrgent = (n: DigestNote) =>
  !!n.workerFlaggedUrgent || n.urgency === "high" || n.urgency === "emergency";

export type DigestStats = {
  notes: number;
  crews: number;
  needsReview: number;
  urgent: number;
  openActions: number;
  materialLines: number;
  aiFailed: number;
  attention: { id: string; title: string; crewName: string | null; jobTitle: string | null; urgent: boolean }[];
  /** Unreviewed notes not listed in `attention` (older, or beyond the top 5). */
  moreWaiting: number;
  materialsByJob: { job: string; items: string[] }[];
};

/**
 * `periodNotes`: notes created in the digest period.
 * `unreviewedCount`: all notes still waiting for review (any age).
 */
export function computeDigestStats(
  periodNotes: DigestNote[],
  unreviewedCount: number,
): DigestStats {
  const live = periodNotes.filter((n) => n.status !== "archived");
  const crews = new Set(live.map((n) => n.teamMemberId).filter(Boolean));
  const openActions = live.reduce(
    (sum, n) => sum + (n.actionItems ?? []).filter((a) => !a.completed).length,
    0,
  );

  const attention = live
    .filter((n) => n.status === "ready" || n.status === "processing")
    .sort(
      (a, b) =>
        Number(isUrgent(b)) - Number(isUrgent(a)) ||
        (URGENCY_RANK[b.urgency ?? "medium"] ?? 1) - (URGENCY_RANK[a.urgency ?? "medium"] ?? 1) ||
        b.createdAt - a.createdAt,
    )
    .slice(0, 5)
    .map((n) => ({
      id: n._id,
      title: n.aiTitle || n.rawTranscript.replace(/\s+/g, " ").trim().slice(0, 70) || "Field note",
      crewName: n.crewName,
      jobTitle: n.jobTitle,
      urgent: isUrgent(n),
    }));

  const byJob = new Map<string, string[]>();
  for (const n of live) {
    for (const m of n.materials ?? []) {
      const qty = [m.quantity, m.unit].filter(Boolean).join(" ");
      const job = n.jobTitle ?? "No job linked";
      const list = byJob.get(job) ?? [];
      list.push(qty ? `${m.name} (${qty})` : m.name);
      byJob.set(job, list);
    }
  }
  const materialsByJob = [...byJob.entries()]
    .sort((a, b) => (a[0] === "No job linked" ? 1 : b[0] === "No job linked" ? -1 : a[0].localeCompare(b[0])))
    .map(([job, items]) => ({ job, items: items.slice(0, 15) }));

  return {
    notes: live.length,
    crews: crews.size,
    needsReview: unreviewedCount,
    urgent: live.filter(isUrgent).length,
    openActions,
    materialLines: live.reduce((s, n) => s + (n.materials?.length ?? 0), 0),
    aiFailed: live.filter((n) => n.aiStatus === "failed").length,
    attention,
    moreWaiting: Math.max(0, unreviewedCount - attention.length),
    materialsByJob,
  };
}

/** Nothing new and nothing waiting: skip the email. */
export function isQuietDay(stats: DigestStats): boolean {
  return stats.notes === 0 && stats.needsReview === 0;
}

// --- Formatting --------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildDigestEmail(input: {
  companyName: string;
  dateLabel: string;
  stats: DigestStats;
  appUrl: string | null;
}): { subject: string; text: string; html: string } {
  const { stats: s, appUrl } = input;
  const noteLink = (id: string) => (appUrl ? `${appUrl}/dashboard/notes/${id}` : null);
  const headline = [
    plural(s.notes, "note"),
    `from ${plural(s.crews, "crew member")}`,
    s.needsReview ? `${s.needsReview} need${s.needsReview === 1 ? "s" : ""} you` : null,
    s.urgent ? `${s.urgent} urgent` : null,
    s.materialLines ? `${plural(s.materialLines, "material")} requested` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const subject = `${input.companyName} — ${input.dateLabel}: ${headline}`;

  const lines: string[] = [
    `${input.companyName} · last 24 hours`,
    headline,
    s.openActions ? `${plural(s.openActions, "open action item")}.` : "",
    s.aiFailed ? `${plural(s.aiFailed, "note")} couldn't be processed by AI. Open to retry.` : "",
    "",
  ];
  if (s.attention.length) {
    lines.push("Needs your attention:");
    for (const a of s.attention) {
      const meta = [a.crewName, a.jobTitle].filter(Boolean).join(" · ");
      lines.push(`- ${a.urgent ? "[URGENT] " : ""}${a.title}${meta ? ` (${meta})` : ""}`);
      const link = noteLink(a.id);
      if (link) lines.push(`  ${link}`);
    }
    if (s.moreWaiting) lines.push(`…and ${s.moreWaiting} more waiting for review.`);
    lines.push("");
  } else if (s.moreWaiting) {
    lines.push(`${plural(s.moreWaiting, "older note")} still waiting for review.`, "");
  }
  if (s.materialsByJob.length) {
    lines.push("Materials requested:");
    for (const g of s.materialsByJob) {
      lines.push(`${g.job}: ${g.items.join(", ")}`);
    }
    lines.push("");
  }
  if (appUrl) lines.push(`All notes: ${appUrl}/dashboard/notes`);
  const text = lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").trim();

  const esc = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const tile = (n: number, label: string, tone = "#111") =>
    `<td style="padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;text-align:center"><div style="font-size:22px;font-weight:700;color:${tone}">${n}</div><div style="font-size:12px;color:#6b7280">${esc(label)}</div></td>`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:600px">
<p style="margin:0;color:#6b7280">${esc(input.companyName)} · last 24 hours</p>
<h2 style="margin:4px 0 12px;font-size:18px">${esc(headline)}</h2>
<table style="border-collapse:separate;border-spacing:6px;margin:0 0 12px"><tr>
${tile(s.notes, "notes")}${tile(s.needsReview, "need you", s.needsReview ? "#c2410c" : "#111")}${tile(s.urgent, "urgent", s.urgent ? "#b91c1c" : "#111")}${tile(s.openActions, "open actions")}
</tr></table>
${s.aiFailed ? `<p style="margin:0 0 12px;color:#b91c1c">${esc(`${plural(s.aiFailed, "note")} couldn't be processed by AI. Open to retry.`)}</p>` : ""}
${
  s.attention.length
    ? `<h3 style="margin:16px 0 6px;font-size:15px">Needs your attention</h3><ul style="margin:0;padding-left:18px">${s.attention
        .map((a) => {
          const meta = [a.crewName, a.jobTitle].filter(Boolean).join(" · ");
          const link = noteLink(a.id);
          const title = link ? `<a href="${esc(link)}">${esc(a.title)}</a>` : esc(a.title);
          return `<li>${a.urgent ? '<strong style="color:#b91c1c">URGENT</strong> ' : ""}${title}${meta ? ` <span style="color:#6b7280">(${esc(meta)})</span>` : ""}</li>`;
        })
        .join("")}</ul>${s.moreWaiting ? `<p style="margin:4px 0 0;color:#6b7280">…and ${s.moreWaiting} more waiting for review.</p>` : ""}`
    : s.moreWaiting
      ? `<p style="margin:16px 0 0">${esc(`${plural(s.moreWaiting, "older note")} still waiting for review.`)}</p>`
      : ""
}
${
  s.materialsByJob.length
    ? `<h3 style="margin:16px 0 6px;font-size:15px">Materials requested</h3>${s.materialsByJob
        .map((g) => `<p style="margin:0 0 6px"><strong>${esc(g.job)}:</strong> ${esc(g.items.join(", "))}</p>`)
        .join("")}`
    : ""
}
${appUrl ? `<p style="margin:16px 0 0"><a href="${esc(appUrl)}/dashboard/notes" style="display:inline-block;background:#10b981;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open all notes</a></p>` : ""}
</div>`;

  return { subject, text, html };
}
