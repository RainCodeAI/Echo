import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DRAFT_STORE,
  QUEUE_STORE,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  resetDbForTests,
} from "../lib/offline/idb";
import {
  clearActiveSession,
  getMemberToken,
  isTokenFresh,
  loadActiveSession,
  saveSession,
  tokenIssuedAt,
  type KeyValueStorage,
} from "../lib/offline/session";

describe("IndexedDB wrapper", () => {
  beforeEach(() => {
    resetDbForTests();
  });

  it("round-trips a queued note including audio and photo blobs", async () => {
    const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });
    await idbPut(QUEUE_STORE, {
      clientUploadId: "u-blob",
      audio,
      photos: [{ blob: new Blob(["jpg"], { type: "image/jpeg" }) }],
    });
    const back = await idbGet<{ audio: Blob; photos: { blob: Blob }[] }>(QUEUE_STORE, "u-blob");
    expect(back?.audio.size).toBe(4);
    expect(back?.audio.type).toBe("audio/webm");
    expect(await back?.photos[0].blob.text()).toBe("jpg");
  });

  it("lists and deletes", async () => {
    await idbPut(QUEUE_STORE, { clientUploadId: "a" });
    await idbPut(QUEUE_STORE, { clientUploadId: "b" });
    const ids = (await idbGetAll<{ clientUploadId: string }>(QUEUE_STORE)).map((i) => i.clientUploadId);
    expect(ids).toEqual(expect.arrayContaining(["a", "b"]));
    await idbDelete(QUEUE_STORE, "a");
    expect(await idbGet(QUEUE_STORE, "a")).toBeUndefined();
  });

  it("has a separate drafts store keyed by `key`", async () => {
    await idbPut(DRAFT_STORE, { key: "c1:m1", transcript: "draft" });
    expect(await idbGet<{ transcript: string }>(DRAFT_STORE, "c1:m1")).toMatchObject({
      transcript: "draft",
    });
  });
});

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const NOW = 1_800_000_000_000;
const token = (issuedAt: number, member = "m1") =>
  `echo-entry:c1:${member}:${issuedAt}:deadbeef`;

describe("field session persistence", () => {
  it("parses issue time and judges freshness with a safety margin", () => {
    expect(tokenIssuedAt(token(NOW))).toBe(NOW);
    expect(tokenIssuedAt("garbage")).toBeNull();
    expect(isTokenFresh(token(NOW - 60 * 60_000), NOW)).toBe(true);
    expect(isTokenFresh(token(NOW - 12 * 60 * 60_000 + 60_000), NOW)).toBe(false);
  });

  it("restores the active member after a reload", () => {
    const s = memoryStorage();
    saveSession("c1", { id: "m1", name: "Luis", verificationToken: token(NOW) }, s, NOW);
    expect(loadActiveSession("c1", s, NOW + 60_000)?.name).toBe("Luis");
    expect(loadActiveSession("other-company", s, NOW)).toBeNull();
  });

  it("does not restore an expired session", () => {
    const s = memoryStorage();
    saveSession("c1", { id: "m1", name: "Luis", verificationToken: token(NOW) }, s, NOW);
    expect(loadActiveSession("c1", s, NOW + 13 * 60 * 60_000)).toBeNull();
  });

  it("switch user stops auto-resume but keeps the token for queued notes", () => {
    const s = memoryStorage();
    saveSession("c1", { id: "m1", name: "Luis", verificationToken: token(NOW) }, s, NOW);
    clearActiveSession("c1", s);
    expect(loadActiveSession("c1", s, NOW)).toBeNull();
    expect(getMemberToken("c1", "m1", s, NOW)).toBe(token(NOW));
  });

  it("tracks tokens per member and prunes expired ones on save", () => {
    const s = memoryStorage();
    saveSession("c1", { id: "m1", name: "Luis", verificationToken: token(NOW - 13 * 60 * 60_000) }, s, NOW - 13 * 60 * 60_000);
    saveSession("c1", { id: "m2", name: "Ana", verificationToken: token(NOW, "m2") }, s, NOW);
    expect(getMemberToken("c1", "m2", s, NOW)).toBe(token(NOW, "m2"));
    expect(getMemberToken("c1", "m1", s, NOW)).toBeNull();
    expect(s.data.get("echo.field.c1")).not.toContain(":m1:");
  });

  it("survives corrupt storage and missing storage", () => {
    const s = memoryStorage();
    s.setItem("echo.field.c1", "{not json");
    expect(loadActiveSession("c1", s, NOW)).toBeNull();
    expect(loadActiveSession("c1", null, NOW)).toBeNull();
    expect(() => saveSession("c1", { id: "m1", name: "L", verificationToken: token(NOW) }, null)).not.toThrow();
  });
});
