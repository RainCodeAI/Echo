import { devices, expect, type APIRequestContext, type Page } from "@playwright/test";

/** One named check; soft so a spec reports every failing check, not just the first. */
export function check(name: string, ok: boolean, detail = "") {
  expect.soft(ok, detail ? `${name} (${detail})` : name).toBe(true);
}

/** Collect uncaught page errors; assert none at the end of a spec. */
export function watchErrors(page: Page, errors: string[]) {
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}

/** The last fake-Convex call a fixture page recorded. */
export const lastCall = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls: { name: string; args: Record<string, unknown> }[] }).__calls.at(-1));
export const allCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calls: { name: string; args: Record<string, unknown> }[] }).__calls);

/** Horizontal overflow in CSS px (0 = fits). */
export const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Mock backend state for the crew-page fixture. */
export type FieldState = {
  uploads: Record<string, { bytes: number; type: string }>;
  notes: { clientUploadId: string; rawTranscript: string; audioStorageId?: string; jobId?: string }[];
  createCalls: { clientUploadId: string; rawTranscript: string; audioStorageId?: string; jobId?: string; mode: string }[];
  mode: "ok" | "expired" | "lose-response";
  noticeAcked: boolean;
  ackCalls: { teamMemberId: string; verificationToken: string; version: string }[];
  pinAttempts: string[];
  jobsDown: boolean;
};
export const fieldState = async (request: APIRequestContext): Promise<FieldState> => (await request.get("/__state")).json();
export const setFieldState = (request: APIRequestContext, patch: Partial<FieldState>) => request.post("/__state", { data: patch });
export const resetFieldState = (request: APIRequestContext) => request.post("/__reset");

/** Poll until `fn` is true (or time out); returns whether it became true. */
export async function eventually(fn: () => Promise<boolean>, ms = 10_000, step = 250) {
  for (let t = 0; t < ms; t += step) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

/**
 * iPhone 13 viewport, touch and user agent — in Chromium (the device preset
 * would otherwise pick WebKit, which these tests don't install).
 */
export const iPhone = (() => {
  const { defaultBrowserType: _webkit, ...rest } = devices["iPhone 13"];
  return { ...rest, browserName: "chromium" as const };
})();

/** A value a fixture page or shim stored on `window` (e.g. __pushed, __signedOut). */
export const windowValue = <T = unknown>(page: Page, key: string) =>
  page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;
