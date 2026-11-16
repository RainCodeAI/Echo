import { describe, expect, it } from "vitest";
import { UPLOAD_WINDOW_MS, takeUploadSlot } from "../convex/lib/uploadQuota";

describe("takeUploadSlot", () => {
  it("starts a window on first use and counts up", () => {
    const first = takeUploadSlot(null, 1000, 3);
    expect(first).toMatchObject({ allowed: true, next: { windowStartedAt: 1000, count: 1 } });
    const second = takeUploadSlot(first.next, 2000, 3);
    expect(second.next.count).toBe(2);
  });

  it("refuses at the limit and says when to retry", () => {
    const r = takeUploadSlot({ windowStartedAt: 0, count: 3 }, 10 * 60_000, 3);
    expect(r.allowed).toBe(false);
    expect(r.next.count).toBe(3);
    expect(r.retryInMs).toBe(UPLOAD_WINDOW_MS - 10 * 60_000);
  });

  it("resets once the window has passed", () => {
    const r = takeUploadSlot({ windowStartedAt: 0, count: 3 }, UPLOAD_WINDOW_MS, 3);
    expect(r).toMatchObject({ allowed: true, next: { windowStartedAt: UPLOAD_WINDOW_MS, count: 1 } });
  });
});
