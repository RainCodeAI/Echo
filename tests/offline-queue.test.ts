import { describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  classifyError,
  createQueuedNote,
  dueItems,
  friendlyError,
  sendQueuedNote,
  type QueuedNote,
  type SendDeps,
} from "../lib/offline/queue";
import { createQueueRunner, memoryStore, withTimeout } from "../lib/offline/runner";

const NOW = 1_800_000_000_000;

function note(overrides: Partial<QueuedNote> = {}): QueuedNote {
  return {
    ...createQueuedNote({
      clientUploadId: "upload-1",
      companyId: "c1",
      teamMemberId: "m1",
      memberName: "Luis",
      transcript: "  two bundles of shingles  ",
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
      audioMimeType: "audio/webm",
      audioDurationMs: 4000,
      photos: [
        { blob: new Blob([new Uint8Array([9])], { type: "image/jpeg" }), mimeType: "image/jpeg" },
        { blob: new Blob([new Uint8Array([8])], { type: "image/png" }), mimeType: "image/png" },
      ],
      workerFlaggedUrgent: true,
      recordedAt: NOW - 60_000,
      now: NOW,
    }),
    ...overrides,
  };
}

/** Convex wraps server errors like this on the client. */
function convexError(msg: string) {
  return new Error(
    `[CONVEX M(voiceNotes:createFromField)] [Request ID: abc] Server Error\nUncaught Error: ${msg}\n    at handler (../convex/voiceNotes.ts:99:11)`,
  );
}

function fakeDeps(overrides: Partial<SendDeps> = {}) {
  let uploads = 0;
  const saved: QueuedNote[] = [];
  const deps: SendDeps = {
    getToken: () => "token-1",
    generateUploadUrl: vi.fn(async () => `https://upload/${uploads}`),
    uploadBlob: vi.fn(async () => `storage-${++uploads}`),
    createNote: vi.fn(async () => "note-123"),
    save: async (item) => {
      saved.push(item);
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, saved };
}

describe("createQueuedNote", () => {
  it("trims the transcript, drops empty audio and starts pending", () => {
    const n = createQueuedNote({
      clientUploadId: "u",
      companyId: "c",
      teamMemberId: "m",
      memberName: "A",
      transcript: "  hi  ",
      audio: new Blob([]),
      photos: [],
      workerFlaggedUrgent: false,
      recordedAt: 0,
      now: NOW,
    });
    expect(n.transcript).toBe("hi");
    expect(n.audio).toBeUndefined();
    expect(n.status).toBe("pending");
    expect(n.recordedAt).toBe(NOW);
  });
});

describe("classifyError / friendlyError", () => {
  it("recognises expired sessions and deactivated members as auth", () => {
    expect(classifyError(convexError("Session expired or invalid. Re-enter your PIN."))).toBe("auth");
    expect(classifyError(convexError("Crew member is inactive or not found. Ask your owner."))).toBe("auth");
  });

  it("recognises validation the same payload can never pass", () => {
    expect(classifyError(convexError("Recording is too large (max 25 MB)."))).toBe("fatal");
    expect(classifyError(convexError("Attach at most 6 photos."))).toBe("fatal");
  });

  it("asks for a re-upload when a blob vanished server-side", () => {
    expect(classifyError(convexError("Audio upload was not found. Please re-record."))).toBe("missing_upload");
  });

  it("treats network failures and unknown errors as transient", () => {
    expect(classifyError(new TypeError("Failed to fetch"))).toBe("transient");
    expect(classifyError(new Error("something odd"))).toBe("transient");
    expect(classifyError("weird")).toBe("transient");
  });

  it("extracts the server message and simplifies network errors", () => {
    expect(friendlyError(convexError("Attach at most 6 photos."))).toBe("Attach at most 6 photos.");
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/No connection/);
    expect(friendlyError(new Error("createNote timed out"))).toMatch(/No connection/);
  });
});

describe("backoffMs / dueItems", () => {
  it("backs off and caps at five minutes", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(4)).toBe(60_000);
    expect(backoffMs(99)).toBe(5 * 60_000);
  });

  it("returns pending/sending items whose time has come, oldest first", () => {
    const items = [
      note({ clientUploadId: "b", queuedAt: 2 }),
      note({ clientUploadId: "a", queuedAt: 1, status: "sending" }),
      note({ clientUploadId: "later", nextAttemptAt: NOW + 1 }),
      note({ clientUploadId: "pin", status: "needs_pin" }),
      note({ clientUploadId: "bad", status: "failed" }),
    ];
    expect(dueItems(items, NOW).map((i) => i.clientUploadId)).toEqual(["a", "b"]);
  });
});

describe("sendQueuedNote", () => {
  it("uploads audio + photos, then creates the note with every field", async () => {
    const { deps } = fakeDeps();
    const result = await sendQueuedNote(note(), deps);

    expect(result).toEqual({ outcome: "sent", noteId: "note-123" });
    expect(deps.uploadBlob).toHaveBeenCalledTimes(3);
    expect(deps.createNote).toHaveBeenCalledWith({
      companyId: "c1",
      teamMemberId: "m1",
      verificationToken: "token-1",
      rawTranscript: "two bundles of shingles",
      clientUploadId: "upload-1",
      audioStorageId: "storage-1",
      audioMimeType: "audio/webm",
      audioDurationMs: 4000,
      workerFlaggedUrgent: true,
      recordedAt: NOW - 60_000,
      photos: [
        { storageId: "storage-2", mimeType: "image/jpeg" },
        { storageId: "storage-3", mimeType: "image/png" },
      ],
    });
  });

  it("does not re-upload blobs that a previous attempt already uploaded", async () => {
    const { deps } = fakeDeps();
    await sendQueuedNote(
      note({ audioStorageId: "old-audio", photoStorageIds: ["old-photo", null] }),
      deps,
    );
    expect(deps.uploadBlob).toHaveBeenCalledTimes(1); // only the 2nd photo
    const args = vi.mocked(deps.createNote).mock.calls[0][0];
    expect(args.audioStorageId).toBe("old-audio");
    expect(args.photos?.[0].storageId).toBe("old-photo");
  });

  it("persists upload progress so a crash mid-send resumes, not restarts", async () => {
    const { deps, saved } = fakeDeps({
      createNote: vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    const result = await sendQueuedNote(note(), deps);
    expect(result.outcome).toBe("retry");
    const last = saved.at(-1)!;
    expect(last.audioStorageId).toBe("storage-1");
    expect(last.photoStorageIds).toEqual(["storage-2", "storage-3"]);
    expect(last.status).toBe("pending");
    expect(last.attempts).toBe(1);
    expect(last.nextAttemptAt).toBe(NOW + 5_000);
    expect(last.lastError).toMatch(/No connection/);
  });

  it("waits for a PIN when there is no token, without calling the server", async () => {
    const { deps } = fakeDeps({ getToken: () => null });
    const result = await sendQueuedNote(note(), deps);
    expect(result.outcome).toBe("needs_pin");
    expect(deps.generateUploadUrl).not.toHaveBeenCalled();
    expect(result.outcome === "needs_pin" && result.item.lastError).toMatch(/Luis/);
  });

  it("moves to needs_pin when the server rejects the session", async () => {
    const { deps } = fakeDeps({
      createNote: vi.fn(async () => {
        throw convexError("Session expired or invalid. Re-enter your PIN.");
      }),
    });
    expect((await sendQueuedNote(note(), deps)).outcome).toBe("needs_pin");
  });

  it("marks validation failures as failed (kept, not deleted)", async () => {
    const { deps, saved } = fakeDeps({
      createNote: vi.fn(async () => {
        throw convexError("Recording is too large (max 25 MB). Record a shorter memo.");
      }),
    });
    const result = await sendQueuedNote(note(), deps);
    expect(result.outcome).toBe("failed");
    expect(saved.at(-1)?.status).toBe("failed");
    expect(saved.at(-1)?.lastError).toMatch(/too large/);
  });

  it("forgets storage ids and retries immediately when an upload went missing", async () => {
    const { deps } = fakeDeps({
      createNote: vi.fn(async () => {
        throw convexError("Audio upload was not found. Please re-record.");
      }),
    });
    const result = await sendQueuedNote(note(), deps);
    expect(result.outcome).toBe("retry");
    if (result.outcome !== "retry") return;
    expect(result.item.audioStorageId).toBeUndefined();
    expect(result.item.photoStorageIds).toEqual([null, null]);
    expect(result.item.nextAttemptAt).toBe(NOW);
  });

  it("sends a transcript-only note without uploads", async () => {
    const { deps } = fakeDeps();
    await sendQueuedNote(note({ audio: undefined, photos: [], photoStorageIds: [] }), deps);
    expect(deps.uploadBlob).not.toHaveBeenCalled();
    const args = vi.mocked(deps.createNote).mock.calls[0][0];
    expect(args.audioStorageId).toBeUndefined();
    expect(args.audioMimeType).toBeUndefined();
    expect(args.photos).toBeUndefined();
  });
});

describe("queue runner", () => {
  function runner(overrides: Partial<SendDeps> = {}) {
    const { deps } = fakeDeps(overrides);
    let t = NOW;
    const store = memoryStore();
    const r = createQueueRunner({
      store,
      deps,
      now: () => t,
      useLocks: false,
    });
    return { r, deps, store, advance: (ms: number) => (t += ms) };
  }

  async function settle(r: ReturnType<typeof runner>["r"]) {
    for (let i = 0; i < 20 && r.getSnapshot().running; i++) {
      await new Promise((res) => setTimeout(res, 0));
    }
  }

  it("enqueue stores the note, sends it, then removes it and records the id", async () => {
    const { r, store } = runner();
    await r.enqueue(note());
    await settle(r);
    expect(await store.getAll()).toEqual([]);
    expect(r.getSnapshot().sent).toEqual({ "upload-1": "note-123" });
  });

  it("keeps the note while offline and sends it once the connection returns", async () => {
    let online = false;
    const { r, store, advance } = runner({
      uploadBlob: vi.fn(async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return "storage-x";
      }),
    });
    await r.enqueue(note());
    await settle(r);
    const [kept] = await store.getAll();
    expect(kept.status).toBe("pending");
    expect(kept.attempts).toBe(1);

    // Not due yet: a normal run does nothing.
    online = true;
    await r.run();
    expect(await store.getAll()).toHaveLength(1);

    // Backoff elapsed → sent.
    advance(5_000);
    await r.run();
    expect(await store.getAll()).toHaveLength(0);
  });

  it("force-sends immediately (Send now / back online) despite backoff", async () => {
    let online = false;
    const { r, store } = runner({
      createNote: vi.fn(async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return "note-9";
      }),
    });
    await r.enqueue(note());
    await settle(r);
    online = true;
    await r.run({ force: true });
    expect(await store.getAll()).toHaveLength(0);
    expect(r.getSnapshot().sent["upload-1"]).toBe("note-9");
  });

  it("stops after a transient failure instead of hammering the rest", async () => {
    const createNote = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { r, store } = runner({ createNote });
    await store.put(note({ clientUploadId: "a", queuedAt: 1, audio: undefined, photos: [], photoStorageIds: [] }));
    await store.put(note({ clientUploadId: "b", queuedAt: 2, audio: undefined, photos: [], photoStorageIds: [] }));
    await r.run();
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("unblocks needs_pin notes once that member's token is available", async () => {
    let token: string | null = null;
    const { r, store } = runner({ getToken: () => token });
    await r.enqueue(note());
    await settle(r);
    expect((await store.getAll())[0].status).toBe("needs_pin");

    token = "fresh-token";
    await r.run();
    expect(await store.getAll()).toHaveLength(0);
  });

  it("falls back to memory when durable storage fails, and says so", async () => {
    const { deps } = fakeDeps({ getToken: () => null });
    const broken = {
      ...memoryStore(),
      durable: true,
      put: async () => {
        throw new Error("QuotaExceededError");
      },
    };
    const r = createQueueRunner({ store: broken, deps, useLocks: false });
    await r.enqueue(note());
    const snap = r.getSnapshot();
    expect(snap.durable).toBe(false);
    expect(snap.items).toHaveLength(1);
  });

  it("discard removes a rejected note", async () => {
    const { r, store } = runner({
      createNote: vi.fn(async () => {
        throw convexError("Attach at most 6 photos.");
      }),
    });
    await r.enqueue(note());
    await settle(r);
    expect((await store.getAll())[0].status).toBe("failed");
    await r.discard("upload-1");
    expect(await store.getAll()).toHaveLength(0);
  });
});

describe("withTimeout", () => {
  it("rejects slow promises and passes fast ones through", async () => {
    await expect(withTimeout(new Promise(() => {}), 10, "upload")).rejects.toThrow(
      "upload timed out",
    );
    await expect(withTimeout(Promise.resolve(7), 10, "x")).resolves.toBe(7);
  });
});
