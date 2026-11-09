// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { buildFieldVerificationToken } from "../../convex/lib/fieldSession";
import { WORKER_FLAG_FALLBACK_MS } from "../../convex/lib/alerts";
import { makeTest } from "./setup";

const T0 = Date.UTC(2026, 10, 1, 15, 0, 0);
const ENV = {
  ENTRY_TOKEN_SECRET: "test-entry-secret-please-32-bytes-long!!",
  RESEND_API_KEY: "re_test",
  ALERT_FROM_EMAIL: "Echo <alerts@echo.app>",
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_FROM_NUMBER: "+15550001111",
  APP_URL: "https://echo.example.com",
};

let sent: { url: string; body: string }[] = [];

beforeEach(() => {
  Object.assign(process.env, ENV);
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: String(init.body) });
      const id = url.includes("twilio") ? { sid: "SM1" } : { id: "em_1" };
      return new Response(JSON.stringify(id), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of Object.keys(ENV)) if (k !== "ENTRY_TOKEN_SECRET") delete process.env[k];
});

async function seed(opts: { enabled?: boolean; phone?: string | null; email?: string | null } = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", {
      name: "Acme Roofing",
      createdAt: 0,
      notificationsEnabled: opts.enabled ?? true,
      alertPhone: opts.phone === undefined ? "+15551234567" : (opts.phone ?? undefined),
      notificationEmail: opts.email === undefined ? "alerts@acme.com" : (opts.email ?? undefined),
    });
    await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "Owner", email: "owner@acme.com", role: "owner", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "member", companyId, name: "Mem", email: "m@acme.com", role: "member", createdAt: 0 });
    const memberId = await ctx.db.insert("teamMembers", { companyId, name: "Luis", pinHash: "x", isActive: true, createdAt: 0 });
    const other = await ctx.db.insert("companies", { name: "Other", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "other", companyId: other, name: "O", email: "o@o.com", role: "owner", createdAt: 0 });
    return { companyId, memberId };
  });
  return { t, ...ids };
}

async function urgentNote(t: ReturnType<typeof makeTest>, companyId: Id<"companies">, memberId: Id<"teamMembers">, extra = {}) {
  return t.run((ctx) =>
    ctx.db.insert("voiceNotes", {
      companyId,
      teamMemberId: memberId,
      status: "ready",
      rawTranscript: "water is coming through the kitchen ceiling",
      recordedAt: T0,
      aiStatus: "completed",
      aiTitle: "Water through kitchen ceiling",
      aiSummary: "Active leak over the kitchen; tarp needed today.",
      urgency: "emergency",
      workerFlaggedUrgent: true,
      createdAt: T0,
      updatedAt: T0,
      ...extra,
    }),
  );
}

const scheduled = (t: ReturnType<typeof makeTest>) =>
  t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

describe("alert triggers", () => {
  it("a worker-flagged submit schedules a 45s fallback alert; an unflagged one doesn't", async () => {
    const { t, companyId, memberId } = await seed();
    const token = await buildFieldVerificationToken(companyId, memberId);
    const base = { companyId, teamMemberId: memberId, verificationToken: token, rawTranscript: "roof caved in over the garage", recordedAt: T0 };
    await t.mutation(api.voiceNotes.createFromField, { ...base, clientUploadId: "u1", workerFlaggedUrgent: true });
    await t.mutation(api.voiceNotes.createFromField, { ...base, clientUploadId: "u2" });
    const alerts = (await scheduled(t)).filter((s) => s.name === "alerts:sendUrgentAlert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].args[0]).toMatchObject({ trigger: "fallback" });
    expect(alerts[0].scheduledTime).toBe(T0 + WORKER_FLAG_FALLBACK_MS);
  });

  it("AI rating a note emergency triggers an alert; medium doesn't", async () => {
    const { t, companyId, memberId } = await seed();
    const base = { title: "t", summary: "s", materials: [], actionItems: [], suggestedJobUpdates: [], tags: [], confidence: 0.9 };
    const hot = await urgentNote(t, companyId, memberId, { workerFlaggedUrgent: false, aiStatus: "processing" });
    const calm = await urgentNote(t, companyId, memberId, { workerFlaggedUrgent: false, aiStatus: "processing", urgency: "medium" });
    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId: hot, ...base, urgency: "emergency" });
    await t.mutation(internal.voiceNotes.applyAiStructure, { noteId: calm, ...base, urgency: "medium" });
    const alerts = (await scheduled(t)).filter((s) => s.name === "alerts:sendUrgentAlert");
    expect(alerts.map((a) => a.args[0])).toEqual([{ noteId: hot, trigger: "ai_done" }]);
  });

  it("AI failing on a worker-flagged note still alerts", async () => {
    const { t, companyId, memberId } = await seed();
    const noteId = await urgentNote(t, companyId, memberId, { aiStatus: "processing" });
    await t.mutation(internal.voiceNotes.applyAiFailure, { noteId, error: "boom" });
    const alerts = (await scheduled(t)).filter((s) => s.name === "alerts:sendUrgentAlert");
    expect(alerts.map((a) => a.args[0])).toEqual([{ noteId, trigger: "ai_failed" }]);
  });
});

describe("sendUrgentAlert", () => {
  it("emails and texts the owner with the summary and a link, and logs both", async () => {
    const { t, companyId, memberId } = await seed();
    const noteId = await urgentNote(t, companyId, memberId);
    expect(await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "ai_done" })).toBe("sent");

    const email = sent.find((s) => s.url.includes("resend"))!;
    const sms = sent.find((s) => s.url.includes("twilio"))!;
    expect(JSON.parse(email.body)).toMatchObject({ to: ["alerts@acme.com"], subject: "EMERGENCY: Water through kitchen ceiling (Luis)" });
    const smsBody = new URLSearchParams(sms.body).get("Body")!;
    expect(smsBody).toContain("Active leak over the kitchen");
    expect(smsBody).toContain(`https://echo.example.com/dashboard/notes/${noteId}`);
    expect(new URLSearchParams(sms.body).get("To")).toBe("+15551234567");

    const owner = t.withIdentity({ subject: "owner" });
    const log = await owner.query(api.alerts.listForNote, { noteId });
    expect(log.map((l) => [l.channel, l.status, l.recipient]).sort()).toEqual([
      ["email", "sent", "a•••@acme.com"],
      ["sms", "sent", "•••• 4567"],
    ]);
  });

  it("alerts once per note, whichever trigger comes first", async () => {
    const { t, companyId, memberId } = await seed();
    const noteId = await urgentNote(t, companyId, memberId);
    await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "ai_done" });
    expect(await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "fallback" })).toBe("already_alerted");
    expect(sent).toHaveLength(2); // one email + one SMS, total
  });

  it("does nothing while alerts are switched off", async () => {
    const { t, companyId, memberId } = await seed({ enabled: false });
    const noteId = await urgentNote(t, companyId, memberId);
    expect(await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "ai_done" })).toBe("alerts_off");
    expect(sent).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(noteId)))?.urgentAlertAt).toBeUndefined();
  });

  it("falls back to the owner's email when no alert email is set", async () => {
    const { t, companyId, memberId } = await seed({ email: null, phone: null });
    const noteId = await urgentNote(t, companyId, memberId);
    await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "ai_done" });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].body).to).toEqual(["owner@acme.com"]);
  });

  it("stops after 20 alerted notes an hour, and logs the skip", async () => {
    const { t, companyId, memberId } = await seed();
    for (let i = 0; i < 20; i++) {
      const id = await urgentNote(t, companyId, memberId);
      await t.action(internal.alerts.sendUrgentAlert, { noteId: id, trigger: "ai_done" });
    }
    sent = [];
    const noteId = await urgentNote(t, companyId, memberId);
    expect(await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "ai_done" })).toBe("rate_limited");
    expect(sent).toHaveLength(0);
    const owner = t.withIdentity({ subject: "owner" });
    expect((await owner.query(api.alerts.listForNote, { noteId }))[0]).toMatchObject({ status: "skipped", detail: "Hourly alert limit reached." });
  });

  it("logs not_configured when provider keys are missing", async () => {
    const { t, companyId, memberId } = await seed();
    delete process.env.TWILIO_AUTH_TOKEN;
    const noteId = await urgentNote(t, companyId, memberId);
    await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "ai_done" });
    const owner = t.withIdentity({ subject: "owner" });
    const sms = (await owner.query(api.alerts.listForNote, { noteId })).find((l) => l.channel === "sms");
    expect(sms?.status).toBe("not_configured");
    expect(sent.every((s) => !s.url.includes("twilio"))).toBe(true);
  });

  it("another company can't read a note's alert log", async () => {
    const { t, companyId, memberId } = await seed();
    const noteId = await urgentNote(t, companyId, memberId);
    await t.action(internal.alerts.sendUrgentAlert, { noteId, trigger: "ai_done" });
    expect(await t.withIdentity({ subject: "other" }).query(api.alerts.listForNote, { noteId })).toEqual([]);
  });
});

describe("sendTestAlert", () => {
  it("is owner-only and works even while alerts are off", async () => {
    const { t } = await seed({ enabled: false });
    await expect(t.withIdentity({ subject: "member" }).action(api.alerts.sendTestAlert, {})).rejects.toThrow(/Only the workspace owner/);
    const results = await t.withIdentity({ subject: "owner" }).action(api.alerts.sendTestAlert, {});
    expect(results.map((r) => [r.channel, r.status]).sort()).toEqual([["email", "sent"], ["sms", "sent"]]);
    expect(JSON.parse(sent.find((s) => s.url.includes("resend"))!.body).subject.startsWith("[TEST] ")).toBe(true);
  });
});

describe("company alert settings", () => {
  it("normalises the alert phone and rejects bad input", async () => {
    const { t, companyId } = await seed();
    const owner = t.withIdentity({ subject: "owner" });
    await owner.mutation(api.companies.update, { alertPhone: "(555) 987-6543" });
    expect((await t.run((ctx) => ctx.db.get(companyId)))?.alertPhone).toBe("+15559876543");
    await expect(owner.mutation(api.companies.update, { alertPhone: "12345" })).rejects.toThrow(/valid mobile/);
    await expect(owner.mutation(api.companies.update, { notificationEmail: "nope" })).rejects.toThrow(/valid alert email/);
    await owner.mutation(api.companies.update, { alertPhone: "" });
    expect((await t.run((ctx) => ctx.db.get(companyId)))?.alertPhone).toBeUndefined();
  });
});
