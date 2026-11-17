import { describe, expect, it } from "vitest";
import { inAppBrowser, interruptMessage, micErrorMessage, phoneChecks } from "../lib/field-device";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const FB_IOS = `${IPHONE} [FBAN/FBIOS;FBAV/490.0]`;
const err = (name: string) => Object.assign(new Error(name), { name });

describe("inAppBrowser", () => {
  it("spots the usual in-app browsers and leaves real browsers alone", () => {
    expect(inAppBrowser(FB_IOS)).toBe("Facebook");
    expect(inAppBrowser(`${ANDROID} Instagram 300.0`)).toBe("Instagram");
    expect(inAppBrowser(IPHONE)).toBeNull();
    expect(inAppBrowser(ANDROID)).toBeNull();
  });
});

describe("micErrorMessage", () => {
  it("says how to unblock the mic on each phone", () => {
    expect(micErrorMessage(err("NotAllowedError"), IPHONE)).toMatch(/aA.*Website Settings.*Microphone/);
    expect(micErrorMessage(err("NotAllowedError"), ANDROID)).toMatch(/Permissions → Microphone/);
  });
  it("in-app browsers: open in Safari/Chrome, whatever the error", () => {
    expect(micErrorMessage(err("NotAllowedError"), FB_IOS)).toMatch(/Facebook's built-in browser.*Open in Safari/);
    expect(micErrorMessage(err("NotFoundError"), `${ANDROID} Instagram 300`)).toMatch(/Open in Chrome/);
  });
  it("busy, missing, unsupported, insecure, unknown", () => {
    expect(micErrorMessage(err("NotReadableError"), ANDROID)).toMatch(/busy/);
    expect(micErrorMessage(err("NotFoundError"), IPHONE)).toMatch(/No microphone found/);
    expect(micErrorMessage(err("NotSupportedError"), IPHONE)).toMatch(/Open the link in Safari/);
    expect(micErrorMessage(err("NotAllowedError"), IPHONE, false)).toMatch(/https/);
    expect(micErrorMessage("weird", IPHONE)).toMatch(/type the note instead/);
  });
  it("interruptions keep the recording and say what to do next", () => {
    for (const r of ["hidden", "ended", "error"] as const) expect(interruptMessage(r)).toMatch(/kept below.*record another/);
    expect(interruptMessage("max")).toMatch(/10 minutes/);
  });
});

describe("phoneChecks", () => {
  const base = {
    ua: IPHONE, secure: true, online: true, standalone: false, recorderMime: "audio/mp4", hasMediaDevices: true, speech: true,
    wakeLock: true, micPermission: "granted", persisted: false, quotaBytes: 2e9, usageBytes: 1e6, indexedDb: true, queued: 0,
  };
  const row = (rows: ReturnType<typeof phoneChecks>, label: string) => rows.find((r) => r.label === label)!;

  it("a healthy iPhone in Safari: warns only about 7-day cleanup", () => {
    const rows = phoneChecks(base);
    expect(rows.filter((r) => r.ok === false).map((r) => r.label)).toEqual(["Protected from cleanup"]);
    expect(row(rows, "Protected from cleanup").detail).toMatch(/7 days.*Home Screen/);
    expect(row(rows, "Audio format").detail).toBe("audio/mp4");
  });
  it("problems show up as problems", () => {
    const rows = phoneChecks({
      ...base, ua: FB_IOS, micPermission: "denied", indexedDb: false, online: false, queued: 2, quotaBytes: 60e6, usageBytes: 30e6, persisted: true,
    });
    expect(rows.filter((r) => r.ok === false).map((r) => r.label)).toEqual([
      "Browser", "Microphone", "Saving on this phone", "Space for recordings", "Signal",
    ]);
    expect(row(rows, "Waiting to send").detail).toBe("2 notes waiting.");
    expect(row(rows, "Browser").detail).toMatch(/Facebook.*Safari/);
  });
  it("unknowns are neither pass nor fail", () => {
    const rows = phoneChecks({ ...base, ua: ANDROID, micPermission: null, speech: false, wakeLock: false, persisted: null, quotaBytes: null, usageBytes: null });
    expect(row(rows, "Microphone").ok).toBeNull();
    expect(row(rows, "Live transcript").ok).toBeNull();
    expect(row(rows, "Keep screen on").ok).toBeNull();
    expect(rows.some((r) => r.label === "Space for recordings")).toBe(false);
  });
});
