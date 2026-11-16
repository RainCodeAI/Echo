"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConvex } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isIndexedDbAvailable } from "@/lib/offline/idb";
import {
  createQueueRunner,
  indexedDbStore,
  memoryStore,
  withTimeout,
  type QueueRunner,
  type QueueSnapshot,
} from "@/lib/offline/runner";
import { getMemberToken } from "@/lib/offline/session";

/** Convex calls hang (queued) while offline; give up and retry later instead. */
const MUTATION_TIMEOUT_MS = 30_000;
/** Large audio on a weak signal needs longer. */
const UPLOAD_TIMEOUT_MS = 120_000;
/** Background retry cadence while the entry page is open. */
const TICK_MS = 20_000;

type FieldQueueContextValue = {
  runner: QueueRunner;
  snapshot: QueueSnapshot;
};

const FieldQueueContext = createContext<FieldQueueContextValue | null>(null);

async function uploadBlob(url: string, blob: Blob, contentType: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Upload failed (HTTP ${response.status}).`);
    }
    const json = (await response.json()) as { storageId: string };
    return json.storageId;
  } catch (err) {
    if (controller.signal.aborted) throw new Error("Upload timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Owns the offline capture queue for one company's field entry page and keeps
 * it moving: on load, when the phone comes back online, when the page becomes
 * visible again, and on a background timer.
 */
export function FieldQueueProvider({
  companyId,
  children,
}: {
  companyId: string;
  children: ReactNode;
}) {
  // The Convex client is stable for the app's lifetime, so the long-lived
  // runner can call it directly.
  const convex = useConvex();

  const [runner] = useState(() =>
    createQueueRunner({
      store: isIndexedDbAvailable() ? indexedDbStore : memoryStore(),
      deps: {
        getToken: (cid, memberId) => getMemberToken(cid, memberId),
        generateUploadUrl: (args) =>
          withTimeout(
            convex.mutation(api.voiceNotes.generateFieldUploadUrl, {
              companyId: args.companyId as Id<"companies">,
              teamMemberId: args.teamMemberId as Id<"teamMembers">,
              verificationToken: args.verificationToken,
            }),
            MUTATION_TIMEOUT_MS,
            "Upload URL request",
          ),
        uploadBlob,
        createNote: (args) =>
          withTimeout(
            convex.mutation(api.voiceNotes.createFromField, {
              ...args,
              companyId: args.companyId as Id<"companies">,
              teamMemberId: args.teamMemberId as Id<"teamMembers">,
              audioStorageId: args.audioStorageId as Id<"_storage"> | undefined,
              photos: args.photos?.map((p) => ({
                storageId: p.storageId as Id<"_storage">,
                mimeType: p.mimeType,
              })),
            }),
            MUTATION_TIMEOUT_MS,
            "Saving the note",
          ),
      },
    }),
  );

  const snapshot = useSyncExternalStore(
    runner.subscribe,
    runner.getSnapshot,
    runner.getSnapshot,
  );

  useEffect(() => {
    // Opening the page is a strong "try now" signal: ignore backoff so notes
    // queued in a closed tab go out immediately when the worker comes back.
    void runner.refresh().then(() => runner.run({ force: true }));

    const onOnline = () => void runner.run({ force: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") void runner.run();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => void runner.run(), TICK_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(tick);
    };
  }, [runner]);

  // Notes for other companies on this phone are left alone (and not shown).
  const scoped: QueueSnapshot = {
    ...snapshot,
    items: snapshot.items.filter((i) => i.companyId === companyId),
  };

  return (
    <FieldQueueContext.Provider value={{ runner, snapshot: scoped }}>
      {children}
    </FieldQueueContext.Provider>
  );
}

export function useFieldQueue(): FieldQueueContextValue {
  const value = useContext(FieldQueueContext);
  if (!value) {
    throw new Error("useFieldQueue must be used inside <FieldQueueProvider>.");
  }
  return value;
}

/** Ask the browser not to evict our storage under pressure (best effort). */
export function requestPersistentStorage() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* unsupported */
  }
}
