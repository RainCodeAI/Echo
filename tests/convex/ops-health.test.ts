// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { makeTest } from "./setup";

const NOW = Date.UTC(2026, 10, 17, 14, 23);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const ENV = { RESEND_API_KEY: "re_test", ALERT_FROM_EMAIL: "Echo <ops@echo.app>", OPS_EMAIL: "me@raincode.test, two@raincode.test" };
let sent: { to: string[]; subject: string; text: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.ENTRY_TOKEN_SECRET = "test-entry-secret-please-32-bytes-long!!";
  Object.assign(process.env, ENV);
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

async function seed() {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("companies", { name: "Acme Roofing", createdAt: NOW - 60 * DAY });
    const quiet = await ctx.db.insert("companies", { name: "Quiet Co", createdAt: NOW - 60 * DAY });
    const note = (companyId: typeof a, over: Record<string, unknown>) =>
      ctx.db.insert("voiceNotes", {
        companyId, status: "ready", rawTranscript: "secret transcript text", recordedAt: NOW, aiStatus: "completed",
        createdAt: NOW - 2 * 3600_000, updatedAt: NOW, ...over,
      });
    await note(a, {});
    await note(a, { aiStatus: "failed", aiErrorMessage: "OpenAI 500" });
    await note(a, { aiStatus: "failed", aiErrorMessage: "This month's AI limit ($25) is used up." });
    await note(a, { aiStatus: "processing", aiStartedAt: NOW - 30 * MIN, createdAt: NOW - 30 * MIN });
    await note(a, { aiStatus: "pending", aiStartedAt: NOW - 2 * MIN, createdAt: NOW - 2 * MIN }); // not stuck yet
    await note(a, { createdAt: NOW - 3 * DAY }); // outside the window
    await note(quiet, { createdAt: NOW - 9 * DAY });
    await ctx.db.insert("alerts", { companyId: a, channel: "sms", recipient: "***", status: "failed", detail: "HTTP 400", createdAt: NOW - 3600_000 });
    await ctx.db.insert("alerts", { companyId: a, channel: "email", recipient: "***", status: "failed", isTest: true, createdAt: NOW - 3600_000 });
    await ctx.db.insert("alerts", { companyId: a, channel: "email", recipient: "***", status: "sent", createdAt: NOW - 3600_000 });
    return { a, quiet };
  });
  return { t, ...ids };
}

describe("ops:health", () => {
  it("counts the window per workspace, ignoring test alerts and budget skips", async () => {
    const { t, a } = await seed();
    const r = await t.query(internal.ops.health, {});
    expect(r.totals).toMatchObject({ workspaces: 2, activeWorkspaces: 1, notes: 5, aiFailed: 1, aiStuck: 1, alertsFailed: 1 });
    const kinds = r.issues.map((i) => `${i.kind}:${i.companyId ?? ""}`);
    expect(kinds).toContain(`ai_stuck:${a}`);
    expect(kinds).toContain(`alerts_failed:${a}`);
    expect(kinds).toContain(`ai_budget:${a}`); // the skipped note
    expect(r.issues.some((i) => i.kind === "quiet" && i.text.includes("Quiet Co"))).toBe(true);
    expect(r.status).toBe("critical");
    expect(JSON.stringify(r)).not.toContain("secret transcript");

    const week = await t.query(internal.ops.health, { windowHours: 168 });
    expect(week.totals.notes).toBe(6); // + the 3-day-old note
  });

  it("shows pending deletions and leaves them out of the totals", async () => {
    const { t, a } = await seed();
    await t.run((ctx) => ctx.db.patch(a, { deletionRequestedAt: NOW, deletionScheduledFor: NOW + 7 * DAY }));
    const r = await t.query(internal.ops.health, {});
    expect(r.issues.find((i) => i.companyId === a)).toMatchObject({ kind: "deletion" });
    expect(r.totals).toMatchObject({ workspaces: 1, notes: 0, aiStuck: 0 });
  });
});

describe("ops:sendDailyReport", () => {
  it("emails each OPS_EMAIL address the report", async () => {
    const { t } = await seed();
    const out = await t.action(internal.ops.sendDailyReport, {});
    expect(out).toMatchObject({ status: "critical", sent: 2 });
    expect(sent.map((m) => m.to[0])).toEqual(["me@raincode.test", "two@raincode.test"]);
    expect(sent[0].subject).toMatch(/^Echo ops 2026-11-17: Action needed \(\d+ items\)$/);
    expect(sent[0].text).toContain("stuck in AI processing");
    expect(sent[0].text).not.toContain("secret transcript");
  });

  it("does nothing without OPS_EMAIL (but still reports)", async () => {
    delete process.env.OPS_EMAIL;
    const { t } = await seed();
    expect(await t.action(internal.ops.sendDailyReport, {})).toMatchObject({ sent: 0, detail: "OPS_EMAIL not set." });
    expect(sent).toEqual([]);
  });
});
