import {
  dueItems,
  sendQueuedNote,
  type QueuedNote,
  type SendDeps,
} from "./queue";
import { QUEUE_STORE, idbDelete, idbGetAll, idbPut } from "./idb";

/**
 * Queue runner: persistence + scheduling around `sendQueuedNote`.
 * Framework-free so it can run (and be tested) without React.
 */

export type QueueStore = {
  getAll: () => Promise<QueuedNote[]>;
  put: (item: QueuedNote) => Promise<void>;
  delete: (clientUploadId: string) => Promise<void>;
  /** False when notes only live in memory (IndexedDB unavailable). */
  durable: boolean;
};

export const indexedDbStore: QueueStore = {
  getAll: () => idbGetAll<QueuedNote>(QUEUE_STORE),
  put: async (item) => {
    await idbPut(QUEUE_STORE, item);
  },
  delete: async (id) => {
    await idbDelete(QUEUE_STORE, id);
  },
  durable: true,
};

export function memoryStore(): QueueStore {
  const items = new Map<string, QueuedNote>();
  return {
    getAll: async () => [...items.values()],
    put: async (item) => {
      items.set(item.clientUploadId, item);
    },
    delete: async (id) => {
      items.delete(id);
    },
    durable: false,
  };
}

export type RunnerDeps = Omit<SendDeps, "save" | "now">;

export type QueueSnapshot = {
  items: QueuedNote[];
  /** clientUploadId → server note id, for notes sent during this page's life. */
  sent: Record<string, string>;
  running: boolean;
  durable: boolean;
};

type Listener = (snapshot: QueueSnapshot) => void;

type LockManagerLike = {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>,
  ) => Promise<void>;
};

function getLocks(): LockManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as Navigator & { locks?: LockManagerLike }).locks;
  return locks ?? null;
}

export function createQueueRunner(options: {
  store: QueueStore;
  deps: RunnerDeps;
  now?: () => number;
  /** Use Web Locks so only one tab sends at a time (default true). */
  useLocks?: boolean;
}) {
  let store = options.store;
  const deps = options.deps;
  const now = options.now ?? (() => Date.now());
  const useLocks = options.useLocks ?? true;

  let items: QueuedNote[] = [];
  const sent: Record<string, string> = {};
  let running = false;
  let rerun = false;
  const listeners = new Set<Listener>();

  const snapshot = (): QueueSnapshot => ({
    items: [...items].sort((a, b) => a.queuedAt - b.queuedAt),
    sent: { ...sent },
    running,
    durable: store.durable,
  });
  // Stable between changes, as useSyncExternalStore requires.
  let current = snapshot();
  const emit = () => {
    current = snapshot();
    listeners.forEach((l) => l(current));
  };

  async function refresh() {
    items = await store.getAll();
    emit();
  }

  async function save(item: QueuedNote) {
    await store.put(item);
    items = [...items.filter((i) => i.clientUploadId !== item.clientUploadId), item];
    emit();
  }

  async function processOnce(force: boolean) {
    items = await store.getAll();
    const t = now();

    // A member whose PIN was just re-entered unblocks their waiting notes.
    for (const item of items) {
      if (
        item.status === "needs_pin" &&
        deps.getToken(item.companyId, item.teamMemberId)
      ) {
        await save({ ...item, status: "pending", nextAttemptAt: t });
      }
    }
    if (force) {
      for (const item of items) {
        if (item.status === "pending" && item.nextAttemptAt > t) {
          await save({ ...item, nextAttemptAt: t });
        }
      }
    }

    for (const item of dueItems(items, now())) {
      const result = await sendQueuedNote(item, { ...deps, save, now });
      if (result.outcome === "sent") {
        await store.delete(item.clientUploadId);
        items = items.filter((i) => i.clientUploadId !== item.clientUploadId);
        sent[item.clientUploadId] = result.noteId;
        emit();
      } else if (result.outcome === "retry" && result.item.nextAttemptAt > now()) {
        // Connection is likely down: don't hammer the rest of the queue.
        break;
      }
    }
  }

  /** Send everything that's due. Safe to call often; runs are single-flight. */
  async function run(opts: { force?: boolean } = {}) {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    emit();
    try {
      const work = () => processOnce(!!opts.force);
      const locks = useLocks ? getLocks() : null;
      if (locks) {
        // Another tab holding the lock is already sending: skip this run.
        await locks.request("echo-field-queue", { ifAvailable: true }, async (lock) => {
          if (lock) await work();
        });
      } else {
        await work();
      }
    } catch {
      // Storage errors etc. — the next trigger retries; items are untouched.
    } finally {
      running = false;
      emit();
      if (rerun) {
        rerun = false;
        void run();
      }
    }
  }

  return {
    /**
     * Save a capture to the phone, then try to send it. Resolves once the note
     * is stored (durably when possible) — not when it reaches the server.
     */
    async enqueue(item: QueuedNote) {
      try {
        await store.put(item);
      } catch {
        // IndexedDB failed (private mode, quota): keep the note in memory so
        // this page can still send it, and say so in the UI.
        if (store.durable) {
          const fallback = memoryStore();
          for (const existing of items) await fallback.put(existing);
          store = fallback;
        }
        await store.put(item);
      }
      items = [...items.filter((i) => i.clientUploadId !== item.clientUploadId), item];
      emit();
      void run({ force: true });
    },
    run,
    refresh,
    /** Worker chose to throw away a note the server rejected. */
    async discard(clientUploadId: string) {
      await store.delete(clientUploadId);
      items = items.filter((i) => i.clientUploadId !== clientUploadId);
      emit();
    },
    /** Compatible with React's useSyncExternalStore. */
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => current,
  };
}

export type QueueRunner = ReturnType<typeof createQueueRunner>;

/** Reject if `promise` hasn't settled within `ms` (treated as a transient failure). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
