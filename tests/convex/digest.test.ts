// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { makeTest } from "./setup";

const H = 60 * 60 * 1000;
/** 7:20am in New York (EST, UTC-5) on Mon 9 Nov 2026. */
const NY_7AM = Date.UTC(2026, 10, 9, 12, 20);

let emails: { to: string[]; subject: string; text: string }[] = [];

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.ALERT_FROM_EMAIL = "Echo <alerts@echo.app>";
  process.env.APP_URL = "https://echo.example.com";
  vi.useFakeTimers();
  vi.setSystemTime(NY_7AM);
  emails = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      emails.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "em" }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const k of ["RESEND_API_KEY", "ALERT_FROM_EMAIL", "APP_URL"]) delete process.env[k];
});

async function seed(opts: { enabled?: boolean; withNotes?: boolean } = {}) {
  const t = makeTest();
  const ids = await t.run(async (ctx) => {
    const companyId = await ctx.db.insert("companies", {
      name: "Acme Roofing",
      createdAt: 0,
      timezone: "America/New_York",
      digestEnabled: opts.enabled ?? true,
      digestHour: 7,
    });
    await ctx.db.insert("users", { clerkUserId: "owner", companyId, name: "O", email: "owner@acme.com", role: "owner", createdAt: 0 });
    await ctx.db.insert("users", { clerkUserId: "member", companyId, name: "M", email: "m@acme.com", role: "member", createdAt: 0 });
    const luis = await ctx.db.insert("teamMembers", { companyId, name: "Luis", pinHash: "x", isActive: true, createdAt: 0 });
    const ana = await ctx.db.insert("teamMembers", { companyId, name: "Ana", pinHash: "x", isActive: true, createdAt: 0 });
    const other = await ctx.db.insert("companies", { name: "Other Co", createdAt: 0, timezone: "America/New_York", digestEnabled: true });
    await ctx.db.insert("users", { clerkUserId: "other", companyId: other, name: "X", email: "x@other.com", role: "owner", createdAt: 0 });
    const base = { status: "ready" as const, aiStatus: "completed" as const, recordedAt: 0, updatedAt: 0 };
    if (opts.withNotes ?? true) {
      await ctx.db.insert("voiceNotes", { ...base, companyId, teamMemberId: luis, rawTranscript: "a", aiTitle: "Water in kitchen", urgency: "emergency", materials: [{ name: "Tarp" }], createdAt: NY_7AM - 2 * H });
      await ctx.db.insert("voiceNotes", { ...base, companyId, teamMemberId: ana, rawTranscript: "b", aiTitle: "Gutters loose", createdAt: NY_7AM - 5 * H });
      // Older than 24h: not in the period's counts (but still awaiting review).
      await ctx.db.insert("voiceNotes", { ...base, companyId, teamMemberId: ana, rawTranscript: "c", aiTitle: "Old note", createdAt: NY_7AM - 30 * H });
      // Another company's note must never leak into Acme's digest.
      await ctx.db.insert("voiceNotes", { ...base, companyId: other, rawTranscript: "secret", aiTitle: "OTHER COMPANY SECRET", createdAt: NY_7AM - H });
    }
    return { companyId, other };
  });
  return { t, ...ids };
}

const run = (t: ReturnType<typeof makeTest>, now: number) =>
  t.action(internal.digestRunner.runDueDigests, { now });

const company = (t: ReturnType<typeof makeTest>, id: Id<"companies">) =>
  t.run((ctx) => ctx.db.get(id));

describe("runDueDigests", () => {
  it("sends Acme's digest at 7am New York time with the right contents", async () => {
    const { t, companyId } = await seed();
    const results = await run(t, NY_7AM);
    expect(results.find((r) => r.companyId === companyId)?.status).toBe("sent");
    const acme = emails.find((e) => e.to[0] === "owner@acme.com")!;
    expect(acme.subject).toBe(
      "Acme Roofing — Mon, Nov 9: 2 notes, from 2 crew members, 3 need you, 1 urgent, 1 material requested",
    );
    expect(acme.text).toContain("[URGENT] Water in kitchen (Luis)");
    expect(acme.text).not.toContain("OTHER COMPANY SECRET");
    expect(acme.text).not.toContain("Old note"); // outside the 24h period
    const c = await company(t, companyId);
    expect(c).toMatchObject({ lastDigestDateKey: "2026-11-09", lastDigestStatus: "sent" });
  });

  it("sends at most once a day, and again the next morning", async () => {
    const { t } = await seed();
    await run(t, NY_7AM);
    await run(t, NY_7AM + H); // 8:20, still in the catch-up window
    expect(emails.filter((e) => e.to[0] === "owner@acme.com")).toHaveLength(1);
    vi.setSystemTime(NY_7AM + 24 * H);
    await run(t, NY_7AM + 24 * H);
    expect(emails.filter((e) => e.to[0] === "owner@acme.com")).toHaveLength(2);
  });

  it("does nothing before the hour or after the catch-up window", async () => {
    const { t } = await seed();
    await run(t, NY_7AM - H); // 6:20
    await run(t, NY_7AM + 4 * H); // 11:20
    expect(emails.filter((e) => e.to[0] === "owner@acme.com")).toHaveLength(0);
  });

  it("skips the email on a quiet day but still marks the day done", async () => {
    const { t, companyId } = await seed({ withNotes: false });
    const results = await run(t, NY_7AM);
    expect(results.find((r) => r.companyId === companyId)?.status).toBe("quiet");
    expect(emails.filter((e) => e.to[0] === "owner@acme.com")).toHaveLength(0);
    expect((await company(t, companyId))?.lastDigestDateKey).toBe("2026-11-09");
  });

  it("ignores companies with the digest switched off", async () => {
    const { t, companyId } = await seed({ enabled: false });
    const results = await run(t, NY_7AM);
    expect(results.map((r) => r.companyId)).not.toContain(companyId);
  });

  it("records not_configured when email isn't set up", async () => {
    delete process.env.RESEND_API_KEY;
    const { t, companyId } = await seed();
    await run(t, NY_7AM);
    expect((await company(t, companyId))?.lastDigestStatus).toBe("not_configured");
    expect(emails).toHaveLength(0);
  });
});

describe("digest.sendNow and settings", () => {
  it("is owner-only and sends even on a quiet day", async () => {
    const { t } = await seed({ withNotes: false });
    await expect(t.withIdentity({ subject: "member" }).action(api.digest.sendNow, {})).rejects.toThrow(/Only the workspace owner/);
    const r = await t.withIdentity({ subject: "owner" }).action(api.digest.sendNow, {});
    expect(r.status).toBe("sent");
    expect(emails[0].to).toEqual(["owner@acme.com"]);
  });

  it("validates the digest hour", async () => {
    const { t, companyId } = await seed();
    const owner = t.withIdentity({ subject: "owner" });
    await owner.mutation(api.companies.update, { digestEnabled: true, digestHour: 6 });
    expect((await company(t, companyId))?.digestHour).toBe(6);
    await expect(owner.mutation(api.companies.update, { digestHour: 24 })).rejects.toThrow(/whole hour/);
    await expect(owner.mutation(api.companies.update, { digestHour: 6.5 })).rejects.toThrow(/whole hour/);
  });
});
