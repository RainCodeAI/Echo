/**
 * Real-phone helpers for the crew page: mic error messages people can act
 * on, in-app browser detection, the screen wake lock, and the phone check.
 * Pure where possible (tested in tests/field-device.test.ts).
 */

/** Apps whose built-in browser often can't use the microphone. */
const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB/, "Facebook"],
  [/Instagram/, "Instagram"],
  [/Messenger/i, "Messenger"],
  [/WhatsApp/i, "WhatsApp"],
  [/Snapchat/i, "Snapchat"],
  [/LinkedInApp/i, "LinkedIn"],
  [/\bLine\//, "LINE"],
  [/TikTok|BytedanceWebview|musical_ly/i, "TikTok"],
  [/GSA\//, "the Google app"],
];

/** Name of the app whose built-in browser this is, or null. */
export function inAppBrowser(ua: string): string | null {
  for (const [re, name] of IN_APP) if (re.test(ua)) return name;
  return null;
}

export function isIos(ua: string): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
}

export function isAndroid(ua: string): boolean {
  return /Android/.test(ua);
}

/** What to open the link in, said the way crews would recognise it. */
export function preferredBrowser(ua: string): string {
  return isIos(ua) ? "Safari" : isAndroid(ua) ? "Chrome" : "your phone's browser";
}

/**
 * Turn a getUserMedia / MediaRecorder failure into a message that says what
 * to do on this phone.
 */
export function micErrorMessage(err: unknown, ua: string, secure = true): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  const app = inAppBrowser(ua);
  const browser = preferredBrowser(ua);
  if (!secure) return "Recording needs a secure (https://) link. Ask the office for the crew link.";
  if (app) {
    return `${app}'s built-in browser can't use the microphone. Open this page in ${browser}: tap ••• or the share button, then "Open in ${browser}".`;
  }
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return isIos(ua)
        ? "Microphone is blocked. Tap \"aA\" in the address bar → Website Settings → Microphone → Allow, then try again. If that's not there: Settings → Safari → Microphone → Allow."
        : isAndroid(ua)
          ? "Microphone is blocked. Tap the icon left of the address bar → Permissions → Microphone → Allow, then try again."
          : "Microphone is blocked. Allow it for this site in the browser's settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found. If headphones or a car is connected over Bluetooth, disconnect and try again.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is busy. Close other apps using it (calls, voice memos, camera) and try again.";
    case "NotSupportedError":
    case "TypeError":
      return `This browser can't record audio. Open the link in ${browser}, or type the note instead.`;
    default:
      return "Couldn't start the microphone. Try again, or type the note instead.";
  }
}

/** Why a recording ended early, in the crew's words. */
export type InterruptReason = "hidden" | "ended" | "error" | "max";

export function interruptMessage(reason: InterruptReason): string {
  switch (reason) {
    case "hidden":
      return "Recording stopped because the screen locked or you switched apps. What was recorded is kept below: submit it, then record another for the rest.";
    case "ended":
      return "Recording stopped: a call or another app took the microphone. What was recorded is kept below: submit it, then record another for the rest.";
    case "error":
      return "Recording stopped because of a microphone error. What was recorded is kept below: submit it, then record another for the rest.";
    case "max":
      return "Recordings stop at 10 minutes. Submit this one and record another to add more.";
  }
}

/** Minimal Screen Wake Lock wrapper: keeps the screen on while recording. */
type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

export async function acquireWakeLock(): Promise<WakeLockSentinelLike | null> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    return wl ? await wl.request("screen") : null;
  } catch {
    return null; // low battery mode, unsupported, not visible
  }
}

export type PhoneCheck = {
  label: string;
  ok: boolean | null; // null = unknown / not applicable
  detail: string;
};

type CheckEnv = {
  ua: string;
  secure: boolean;
  online: boolean;
  standalone: boolean;
  recorderMime: string | undefined;
  hasMediaDevices: boolean;
  speech: boolean;
  wakeLock: boolean;
  micPermission: string | null; // "granted" | "denied" | "prompt" | null
  persisted: boolean | null;
  quotaBytes: number | null;
  usageBytes: number | null;
  indexedDb: boolean;
  queued: number;
};

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** The rows of the crew page's "Phone check" (pure, tested). */
export function phoneChecks(e: CheckEnv): PhoneCheck[] {
  const app = inAppBrowser(e.ua);
  const browser = preferredBrowser(e.ua);
  const rows: PhoneCheck[] = [];
  rows.push({
    label: "Browser",
    ok: app ? false : true,
    detail: app ? `${app} in-app browser: open the link in ${browser}.` : isIos(e.ua) ? "Safari / iOS" : isAndroid(e.ua) ? "Android" : "Desktop or other",
  });
  rows.push({ label: "Secure link", ok: e.secure, detail: e.secure ? "https" : "Not https: recording won't work." });
  rows.push({
    label: "Microphone",
    ok: !e.hasMediaDevices ? false : e.micPermission === "denied" ? false : e.micPermission === "granted" ? true : null,
    detail: !e.hasMediaDevices
      ? "This browser can't record."
      : e.micPermission === "denied"
        ? "Blocked: allow it in the browser's site settings."
        : e.micPermission === "granted"
          ? "Allowed."
          : "Will ask the first time you record.",
  });
  rows.push({
    label: "Audio format",
    ok: e.recorderMime ? true : e.hasMediaDevices ? null : false,
    detail: e.recorderMime ?? "Browser default",
  });
  rows.push({
    label: "Live transcript",
    ok: e.speech ? true : null,
    detail: e.speech ? "Available." : "Not on this browser. Audio still records and the office transcribes it.",
  });
  rows.push({
    label: "Keep screen on",
    ok: e.wakeLock ? true : null,
    detail: e.wakeLock ? "Screen stays on while recording." : "Not supported: keep tapping the screen during long recordings so it doesn't lock.",
  });
  rows.push({
    label: "Saving on this phone",
    ok: e.indexedDb,
    detail: e.indexedDb ? "Available." : "Not available (private mode?): notes can't wait for signal.",
  });
  rows.push({
    label: "Protected from cleanup",
    ok: e.persisted,
    detail:
      e.persisted === true
        ? "Yes."
        : e.persisted === false
          ? isIos(e.ua) && !e.standalone
            ? "Safari may clear saved notes after 7 days without opening Echo. Add Echo to the Home Screen to be safe."
            : "The browser may clear saved notes if the phone runs low on space."
          : "Unknown.",
  });
  if (e.quotaBytes !== null && e.usageBytes !== null) {
    const free = e.quotaBytes - e.usageBytes;
    rows.push({
      label: "Space for recordings",
      ok: free > 50 * 1024 * 1024,
      detail: `${mb(Math.max(free, 0))} free for Echo (${mb(e.usageBytes)} used).`,
    });
  }
  rows.push({ label: "Signal", ok: e.online, detail: e.online ? "Online." : "Offline: notes will wait on this phone." });
  rows.push({
    label: "Waiting to send",
    ok: e.queued === 0 ? true : null,
    detail: e.queued === 0 ? "Nothing waiting." : `${e.queued} note${e.queued === 1 ? "" : "s"} waiting.`,
  });
  rows.push({
    label: "Home Screen app",
    ok: e.standalone ? true : null,
    detail: e.standalone ? "Opened from the Home Screen." : "Opened in the browser. Adding to the Home Screen is optional but recommended.",
  });
  return rows;
}

/** Gather the live values for `phoneChecks` (browser only). */
export async function gatherPhoneCheck(queued: number): Promise<CheckEnv> {
  const nav = navigator as Navigator & { standalone?: boolean };
  let micPermission: string | null = null;
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    micPermission = status?.state ?? null;
  } catch {
    /* Safari < 16 / Firefox */
  }
  let persisted: boolean | null = null;
  let quotaBytes: number | null = null;
  let usageBytes: number | null = null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? null;
    const est = await navigator.storage?.estimate?.();
    quotaBytes = est?.quota ?? null;
    usageBytes = est?.usage ?? null;
  } catch {
    /* unsupported */
  }
  const { pickRecorderMimeType, getSpeechRecognitionConstructor } = await import("@/lib/speech");
  return {
    ua: navigator.userAgent,
    secure: window.isSecureContext,
    online: navigator.onLine,
    standalone: window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true,
    recorderMime: pickRecorderMimeType(),
    hasMediaDevices: !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined",
    speech: !!getSpeechRecognitionConstructor(),
    wakeLock: "wakeLock" in navigator,
    micPermission,
    persisted,
    quotaBytes,
    usageBytes,
    indexedDb: typeof indexedDB !== "undefined",
    queued,
  };
}
