/**
 * Minimal promise wrapper over IndexedDB for the offline capture queue.
 * Blobs (audio, photos) are stored natively — supported in every browser Echo
 * targets, including iOS Safari 14+.
 *
 * Stores:
 *  - `queue`  — QueuedNote, keyed by `clientUploadId`
 *  - `drafts` — in-progress capture per company+member, keyed by `key`
 */

const DB_NAME = "echo-field";
const DB_VERSION = 1;
export const QUEUE_STORE = "queue";
export const DRAFT_STORE = "drafts";

type StoreName = typeof QUEUE_STORE | typeof DRAFT_STORE;

let dbPromise: Promise<IDBDatabase> | null = null;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "clientUploadId" });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the schema: drop our handle so the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  // Don't cache a failure forever (e.g. private mode toggled).
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

/** Test hook: forget the cached connection. */
export function resetDbForTests() {
  dbPromise = null;
}

async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  // Listen for completion before awaiting the request, so a fast commit
  // can't slip past us. Writes only count once the transaction commits.
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
  const [result] = await Promise.all([promisify(run(tx.objectStore(store))), done]);
  return result;
}

export function idbPut<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return withStore(store, "readwrite", (s) => s.put(value));
}

export function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withStore(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return withStore(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}

export function idbDelete(store: StoreName, key: IDBValidKey): Promise<undefined> {
  return withStore(store, "readwrite", (s) => s.delete(key));
}
