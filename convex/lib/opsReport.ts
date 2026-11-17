/**
 * Operator health report (pure, tested). `ops:health` gathers the numbers;
 * this turns them into a verdict, a list of things to look at, and the daily
 * ops email. Counts and ids only: never note content, transcripts or
 * customer details.
 */

export type CompanyHealth = {
  companyId: string;
  name: string;
  createdAt: number;
  /** Notes created in the window. */
  notes: number;
  /** Notes in the window whose AI failed (not counting budget skips). */
  aiFailed: number;
  /** Notes in the window whose AI was skipped by the budget. */
  aiSkippedBudget: number;
  /** Notes still pending/processing well past the AI timeout. */
  aiStuck: number;
  alertsSent: number;
  alertsFailed: number;
  /** Last digest status, if one ran in the window. */
  digestStatus: string | null;
  /** This month's AI spend vs budget. */
  aiSpentMicros: number;
  aiBudgetUsd: number;
  aiBudgetLevel: "ok" | "warning" | "exceeded";
  /** Most recent note ever (for "gone quiet"). */
  lastNoteAt: number | null;
  deletion: { scheduledFor: number | null; started: boolean } | null;
};

export type HealthInput = {
  now: number;
  windowMs: number;
  companies: CompanyHealth[];
  config: { ready: boolean; failing: { name: string; level: "required" | "recommended"; detail: string }[] };
};

export type Issue = {
  severity: "critical" | "warning" | "info";
  /** Stable key for grouping/tests, e.g. "ai_stuck". */
  kind: string;
  companyId?: string;
  text: string;
};

export type HealthReport = {
  status: "ok" | "attention" | "critical";
  generatedAt: string;
  windowHours: number;
  totals: {
    workspaces: number;
    activeWorkspaces: number;
    newWorkspaces: number;
    notes: number;
    aiFailed: number;
    aiStuck: number;
    alertsFailed: number;
    aiSpentMicrosThisMonth: number;
  };
  issues: Issue[];
};

/** An AI failure rate above this (with enough notes to matter) is flagged. */
export const AI_FAILURE_RATE_WARN = 0.2;
export const AI_FAILURE_MIN_NOTES = 5;
/** A workspace that recorded before but nothing for this long. */
export const QUIET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;
const money = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function evaluateHealth(input: HealthInput): HealthReport {
  const { now, windowMs, companies, config } = input;
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);

  for (const f of config.failing) {
    add({
      severity: f.level === "required" ? "critical" : "info",
      kind: "config",
      text: `Config: ${f.name}. ${f.detail}`,
    });
  }

  for (const c of companies) {
    const who = `${c.name} (${c.companyId})`;
    if (c.deletion) {
      add({
        severity: "info",
        kind: "deletion",
        companyId: c.companyId,
        text: c.deletion.started || !c.deletion.scheduledFor
          ? `${who}: being deleted now.`
          : `${who}: scheduled for deletion on ${new Date(c.deletion.scheduledFor).toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      });
      continue; // nothing else about it matters
    }
    if (c.aiStuck > 0) {
      add({
        severity: "critical",
        kind: "ai_stuck",
        companyId: c.companyId,
        text: `${who}: ${plural(c.aiStuck, "note")} stuck in AI processing. The owner can press Retry; check the Convex logs for crashed ai actions.`,
      });
    }
    if (c.aiFailed > 0) {
      const rate = c.notes ? c.aiFailed / c.notes : 1;
      const high = c.notes >= AI_FAILURE_MIN_NOTES && rate >= AI_FAILURE_RATE_WARN;
      add({
        severity: high ? "warning" : "info",
        kind: "ai_failed",
        companyId: c.companyId,
        text: `${who}: AI failed on ${c.aiFailed} of ${plural(c.notes, "note")}${high ? ` (${Math.round(rate * 100)}%)` : ""}.`,
      });
    }
    if (c.aiBudgetLevel !== "ok" || c.aiSkippedBudget > 0) {
      add({
        severity: c.aiBudgetLevel === "exceeded" ? "warning" : "info",
        kind: "ai_budget",
        companyId: c.companyId,
        text:
          `${who}: AI spend ${money(c.aiSpentMicros)} of $${c.aiBudgetUsd} this month` +
          (c.aiBudgetLevel === "exceeded" ? " (limit reached)" : c.aiBudgetLevel === "warning" ? " (near the limit)" : "") +
          (c.aiSkippedBudget ? `; ${plural(c.aiSkippedBudget, "note")} skipped AI.` : ".") +
          " Raise with ops:setAiBudget if it's legitimate.",
      });
    }
    if (c.alertsFailed > 0) {
      add({
        severity: "warning",
        kind: "alerts_failed",
        companyId: c.companyId,
        text: `${who}: ${plural(c.alertsFailed, "urgent alert")} failed to send (${c.alertsSent} sent).`,
      });
    }
    if (c.digestStatus?.startsWith("failed")) {
      add({ severity: "warning", kind: "digest_failed", companyId: c.companyId, text: `${who}: daily digest ${c.digestStatus.slice(0, 160)}` });
    }
    if (c.lastNoteAt && now - c.lastNoteAt > QUIET_AFTER_MS && c.notes === 0) {
      add({
        severity: "info",
        kind: "quiet",
        companyId: c.companyId,
        text: `${who}: no notes for ${Math.floor((now - c.lastNoteAt) / DAY)} days (was active before). Worth a check-in.`,
      });
    }
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  const live = companies.filter((c) => !c.deletion);
  const sum = (f: (c: CompanyHealth) => number) => live.reduce((n, c) => n + f(c), 0);
  return {
    status: issues.some((i) => i.severity === "critical")
      ? "critical"
      : issues.some((i) => i.severity === "warning")
        ? "attention"
        : "ok",
    generatedAt: new Date(now).toISOString(),
    windowHours: Math.round(windowMs / 3_600_000),
    totals: {
      workspaces: live.length,
      activeWorkspaces: live.filter((c) => c.notes > 0).length,
      newWorkspaces: live.filter((c) => c.createdAt > now - windowMs).length,
      notes: sum((c) => c.notes),
      aiFailed: sum((c) => c.aiFailed),
      aiStuck: sum((c) => c.aiStuck),
      alertsFailed: sum((c) => c.alertsFailed),
      aiSpentMicrosThisMonth: sum((c) => c.aiSpentMicros),
    },
    issues,
  };
}

const LABEL = { ok: "All good", attention: "Needs attention", critical: "Action needed" } as const;
const ICON = { critical: "[!!]", warning: "[!]", info: "[i]" } as const;

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The daily ops email. */
export function renderOpsEmail(r: HealthReport, deployment: string): { subject: string; text: string; html: string } {
  const t = r.totals;
  const date = r.generatedAt.slice(0, 10);
  const subject = `Echo ops ${date}: ${LABEL[r.status]}${r.issues.length ? ` (${plural(r.issues.length, "item")})` : ""}`;
  const stats: [string, string][] = [
    ["Workspaces", `${t.workspaces} (${t.activeWorkspaces} recorded, ${t.newWorkspaces} new)`],
    ["Notes", String(t.notes)],
    ["AI failed / stuck", `${t.aiFailed} / ${t.aiStuck}`],
    ["Alerts failed", String(t.alertsFailed)],
    ["AI spend this month", money(t.aiSpentMicrosThisMonth)],
  ];
  const text = [
    `Echo ops report: ${LABEL[r.status]}`,
    `Deployment: ${deployment}. Last ${r.windowHours}h, generated ${r.generatedAt}.`,
    "",
    ...stats.map(([k, v]) => `${k}: ${v}`),
    "",
    r.issues.length ? "To look at:" : "Nothing to look at.",
    ...r.issues.map((i) => `${ICON[i.severity]} ${i.text}`),
    "",
    "Full JSON: npx convex run ops:health --prod",
  ].join("\n");
  const color = { ok: "#15803d", attention: "#b45309", critical: "#b91c1c" }[r.status];
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px">
<h2 style="color:${color};margin:0 0 4px">${LABEL[r.status]}</h2>
<p style="color:#555;margin:0 0 12px">${esc(deployment)} · last ${r.windowHours}h · ${esc(r.generatedAt)}</p>
<table style="border-collapse:collapse;margin-bottom:12px">${stats
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`)
    .join("")}</table>
${
  r.issues.length
    ? `<ul style="padding-left:18px">${r.issues
        .map((i) => `<li style="margin:4px 0"><b>${i.severity}</b>: ${esc(i.text)}</li>`)
        .join("")}</ul>`
    : "<p>Nothing to look at.</p>"
}
<p style="color:#777;font-size:12px">Full JSON: <code>npx convex run ops:health --prod</code></p>
</div>`;
  return { subject, text, html };
}

/** OPS_EMAIL may list several addresses, comma- or space-separated. */
export function opsRecipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}
