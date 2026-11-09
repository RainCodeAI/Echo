import { describe, expect, it, vi } from "vitest";
import {
  alertReason,
  buildAlertMessage,
  maskRecipient,
  normalizePhone,
  underRateLimit,
  type AlertContent,
} from "../convex/lib/alerts";
import { sendEmail, sendSms } from "../convex/lib/alertProviders";

describe("alertReason", () => {
  it("alerts on a crew flag immediately, and on high/emergency once AI is done", () => {
    expect(alertReason({ workerFlaggedUrgent: true, aiStatus: "pending" })).toBe("worker_flag");
    expect(alertReason({ urgency: "emergency", aiStatus: "completed" })).toBe("ai_urgency");
    expect(alertReason({ urgency: "high", aiStatus: "completed" })).toBe("ai_urgency");
  });
  it("doesn't alert on medium/low, or on urgency set before AI ran", () => {
    expect(alertReason({ urgency: "medium", aiStatus: "completed" })).toBeNull();
    expect(alertReason({ urgency: "high", aiStatus: "pending" })).toBeNull();
    expect(alertReason({ urgency: "emergency", aiStatus: "failed" })).toBeNull();
  });
});

describe("normalizePhone / maskRecipient", () => {
  it("normalises North American and international numbers to E.164", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("1-555-123-4567")).toBe("+15551234567");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects junk", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("555-1234")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("masks phones and emails", () => {
    expect(maskRecipient("+15551234567")).toBe("•••• 4567");
    expect(maskRecipient("owner@acme.com")).toBe("o•••@acme.com");
  });
});

describe("underRateLimit", () => {
  it("counts only the last hour", () => {
    const now = 10 * 60 * 60 * 1000;
    const recent = Array.from({ length: 19 }, () => now - 60_000);
    expect(underRateLimit(recent, now)).toBe(true);
    expect(underRateLimit([...recent, now - 1000], now)).toBe(false);
    expect(underRateLimit([...recent, now - 2 * 60 * 60 * 1000], now)).toBe(true);
  });
});

const CONTENT: AlertContent = {
  companyName: "Acme Roofing",
  crewName: "Luis",
  jobTitle: "Ramirez reroof",
  urgency: "emergency",
  workerFlaggedUrgent: true,
  aiTitle: "Water through kitchen ceiling",
  aiSummary: "Active leak over the kitchen. Tarp needed today; customer is home.",
  transcript: "water is coming through the kitchen ceiling",
  siteAddress: "412 Oak St",
  recordedAt: 0,
  noteUrl: "https://echo.raincode.ai/dashboard/notes/abc123",
};

describe("buildAlertMessage", () => {
  it("leads with urgency, crew and job, and links to the note", () => {
    const m = buildAlertMessage(CONTENT);
    expect(m.subject).toBe("EMERGENCY: Water through kitchen ceiling (Luis · Ramirez reroof)");
    expect(m.text).toContain("Site: 412 Oak St");
    expect(m.text).toContain("Open: https://echo.raincode.ai/dashboard/notes/abc123");
    expect(m.sms.startsWith("Echo EMERGENCY – Luis · Ramirez reroof: Active leak")).toBe(true);
  });

  it("keeps SMS within two segments with the link intact", () => {
    const m = buildAlertMessage({ ...CONTENT, aiSummary: "word ".repeat(400) });
    expect(m.sms.length).toBeLessThanOrEqual(320);
    expect(m.sms.endsWith(CONTENT.noteUrl!)).toBe(true);
  });

  it("falls back to the transcript before AI has run", () => {
    const m = buildAlertMessage({ ...CONTENT, urgency: "high", aiTitle: null, aiSummary: null });
    expect(m.subject.startsWith("URGENT: water is coming through")).toBe(true);
    expect(m.text).toContain("Flagged urgent by the crew.");
  });

  it("escapes HTML and marks tests", () => {
    const m = buildAlertMessage({ ...CONTENT, aiTitle: "<script>x</script>", isTest: true });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject.startsWith("[TEST] ")).toBe(true);
  });
});

const EMAIL_ENV = { RESEND_API_KEY: "re_test", ALERT_FROM_EMAIL: "Echo <alerts@echo.app>" };
const SMS_ENV = { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550001111" };

describe("providers", () => {
  it("sends email through Resend's API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    const r = await sendEmail({ to: "o@a.com", subject: "S", text: "T", html: "<p>H</p>" }, EMAIL_ENV, fetchMock as never);
    expect(r).toEqual({ status: "sent", providerId: "em_1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Echo <alerts@echo.app>", to: ["o@a.com"], subject: "S", text: "T", html: "<p>H</p>",
    });
  });

  it("sends SMS through Twilio's API with basic auth and a form body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    const r = await sendSms({ to: "+15551234567", body: "Hi" }, SMS_ENV, fetchMock as never);
    expect(r).toEqual({ status: "sent", providerId: "SM1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("AC123:tok")}`);
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({ To: "+15551234567", From: "+15550001111", Body: "Hi" });
  });

  it("reports not_configured without calling out", async () => {
    const fetchMock = vi.fn();
    expect((await sendEmail({ to: "a@b.c", subject: "", text: "", html: "" }, {}, fetchMock as never)).status).toBe("not_configured");
    expect((await sendSms({ to: "+1", body: "" }, {}, fetchMock as never)).status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports HTTP and network failures with detail", async () => {
    const bad = vi.fn(async () => new Response("invalid number", { status: 400 }));
    expect(await sendSms({ to: "+1", body: "x" }, SMS_ENV, bad as never)).toEqual({
      status: "failed", detail: "HTTP 400: invalid number",
    });
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await sendEmail({ to: "a@b.c", subject: "", text: "", html: "" }, EMAIL_ENV, down as never)).toEqual({
      status: "failed", detail: "fetch failed",
    });
  });
});
