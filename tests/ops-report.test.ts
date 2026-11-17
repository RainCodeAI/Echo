import { describe, expect, it } from "vitest";
import { evaluateHealth, opsRecipients, renderOpsEmail, type CompanyHealth, type HealthInput } from "../convex/lib/opsReport";
import { evaluateConfig } from "../convex/lib/configCheck";

const NOW = Date.UTC(2026, 10, 17, 14, 23);
const DAY = 24 * 60 * 60 * 1000;

function co(over: Partial<CompanyHealth> = {}): CompanyHealth {
  return {
    companyId: "c1", name: "Acme Roofing", createdAt: NOW - 30 * DAY, notes: 10, aiFailed: 0, aiSkippedBudget: 0, aiStuck: 0,
    alertsSent: 1, alertsFailed: 0, digestStatus: "sent", aiSpentMicros: 1_200_000, aiBudgetUsd: 25, aiBudgetLevel: "ok",
    lastNoteAt: NOW - 3600_000, deletion: null, ...over,
  };
}
const input = (companies: CompanyHealth[], failing: HealthInput["config"]["failing"] = []): HealthInput => ({
  now: NOW, windowMs: DAY, companies, config: { ready: failing.every((f) => f.level !== "required"), failing },
});

describe("evaluateHealth", () => {
  it("is ok with healthy workspaces and sums the totals", () => {
    const r = evaluateHealth(input([co(), co({ companyId: "c2", name: "New Co", createdAt: NOW - 3600_000, notes: 0, lastNoteAt: null })]));
    expect(r.status).toBe("ok");
    expect(r.issues).toEqual([]);
    expect(r.totals).toMatchObject({ workspaces: 2, activeWorkspaces: 1, newWorkspaces: 1, notes: 10, aiSpentMicrosThisMonth: 2_400_000 });
    expect(r.windowHours).toBe(24);
  });

  it("stuck AI and missing required config are critical; sorted first", () => {
    const r = evaluateHealth(
      input([co({ aiStuck: 2, alertsFailed: 1 })], [{ name: "OPENAI_API_KEY", level: "required", detail: "Missing." }]),
    );
    expect(r.status).toBe("critical");
    expect(r.issues.map((i) => i.kind)).toEqual(["config", "ai_stuck", "alerts_failed"]);
    expect(r.issues[1].text).toContain("2 notes stuck");
  });

  it("flags a high AI failure rate as a warning, a low one as info", () => {
    expect(evaluateHealth(input([co({ notes: 10, aiFailed: 3 })])).issues[0]).toMatchObject({ kind: "ai_failed", severity: "warning" });
    expect(evaluateHealth(input([co({ notes: 10, aiFailed: 1 })])).issues[0]).toMatchObject({ kind: "ai_failed", severity: "info" });
    // Too few notes to call it a trend.
    expect(evaluateHealth(input([co({ notes: 2, aiFailed: 2 })])).issues[0]).toMatchObject({ severity: "info" });
  });

  it("budget: exceeded is a warning, near/skips are info", () => {
    const r = evaluateHealth(input([co({ aiBudgetLevel: "exceeded", aiSpentMicros: 25_000_000, aiSkippedBudget: 4 })]));
    expect(r.status).toBe("attention");
    expect(r.issues[0].text).toMatch(/\$25\.00 of \$25 this month \(limit reached\); 4 notes skipped AI/);
    expect(evaluateHealth(input([co({ aiBudgetLevel: "warning" })])).issues[0]).toMatchObject({ kind: "ai_budget", severity: "info" });
  });

  it("digest failures, quiet workspaces and deletions", () => {
    const r = evaluateHealth(
      input([
        co({ digestStatus: "failed: HTTP 500" }),
        co({ companyId: "c2", notes: 0, lastNoteAt: NOW - 10 * DAY, digestStatus: null }),
        co({ companyId: "c3", aiStuck: 5, deletion: { scheduledFor: NOW + 3 * DAY, started: false } }),
      ]),
    );
    expect(r.issues.map((i) => i.kind).sort()).toEqual(["deletion", "digest_failed", "quiet"]);
    expect(r.issues.find((i) => i.kind === "quiet")?.text).toContain("no notes for 10 days");
    expect(r.issues.find((i) => i.kind === "deletion")?.text).toMatch(/scheduled for deletion on 2026-11-20 14:23 UTC/);
    // A workspace being deleted doesn't count or raise its own problems.
    expect(r.totals.workspaces).toBe(2);
    expect(r.totals.aiStuck).toBe(0);
  });
});

describe("renderOpsEmail", () => {
  it("subject carries the verdict; body has totals and escapes names", () => {
    const r = evaluateHealth(input([co({ name: "<Bad & Co>", alertsFailed: 2 })]));
    const m = renderOpsEmail(r, "https://happy-otter-123.convex.cloud");
    expect(m.subject).toBe("Echo ops 2026-11-17: Needs attention (1 item)");
    expect(m.text).toContain("Notes: 10");
    expect(m.text).toContain("[!] <Bad & Co> (c1): 2 urgent alerts failed to send");
    expect(m.html).toContain("&lt;Bad &amp; Co&gt;");
    expect(m.html).not.toContain("<Bad");
    expect(renderOpsEmail(evaluateHealth(input([co()])), "d").subject).toBe("Echo ops 2026-11-17: All good");
  });
});

describe("opsRecipients / config", () => {
  it("parses a list and drops junk", () => {
    expect(opsRecipients(" a@x.com, b@y.io;nope  c@z.co ")).toEqual(["a@x.com", "b@y.io", "c@z.co"]);
    expect(opsRecipients(undefined)).toEqual([]);
  });
  it("config check reports OPS_EMAIL", () => {
    const find = (env: Record<string, string>) => evaluateConfig(env).checks.find((c) => c.name === "OPS_EMAIL")!;
    expect(find({})).toMatchObject({ ok: false, level: "recommended" });
    expect(find({ OPS_EMAIL: "a@x.com" }).detail).toMatch(/can't be sent/);
    expect(find({ OPS_EMAIL: "a@x.com", RESEND_API_KEY: "re", ALERT_FROM_EMAIL: "x@y.z" }).ok).toBe(true);
  });
});
