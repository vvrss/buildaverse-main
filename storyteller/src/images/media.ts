/**
 * Pictures on this device, in their own IndexedDB database
 * ("storyteller-media"), so adding pictures never needs an upgrade of the
 * main database. Falls back to memory when IndexedDB is unavailable.
 * Each picture belongs to a profile and is keyed by its picture code.
 */

export interface PictureRecord {
  /** Picture code: the first 16 hex digits of the SHA-256 of `blob`. */
  ref: string;
  profileId: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

const DB_NAME = 'storyteller-media';
const STORE = 'pictures';
/** Per-profile keys: the same picture can belong to two profiles independently. */
const key = (profileId: string, ref: string) => `${profileId}:${ref}`;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, PictureRecord>();

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('profile', 'profileId');
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => {
        // Only a newer build would upgrade this database; keep waiting.
      };
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  const db = await open();
  return db ? db.transaction(STORE, mode).objectStore(STORE) : null;
}

export async function putPicture(p: PictureRecord): Promise<void> {
  const s = await store('readwrite');
  if (!s) {
    memory.set(key(p.profileId, p.ref), p);
    return;
  }
  await request(s.put({ ...p, key: key(p.profileId, p.ref) }));
}

export async function getPicture(profileId: string, ref: string): Promise<PictureRecord | undefined> {
  const s = await store('readonly');
  if (!s) return memory.get(key(profileId, ref));
  return (await request(s.get(key(profileId, ref)))) as PictureRecord | undefined;
}

export async function hasPicture(profileId: string, ref: string): Promise<boolean> {
  const s = await store('readonly');
  if (!s) return memory.has(key(profileId, ref));
  return (await request(s.count(key(profileId, ref)))) > 0;
}

export async function listPictures(profileId: string): Promise<PictureRecord[]> {
  const s = await store('readonly');
  if (!s) return [...memory.values()].filter((p) => p.profileId === profileId);
  return (await request(s.index('profile').getAll(profileId))) as PictureRecord[];
}

export async function deletePicture(profileId: string, ref: string): Promise<void> {
  const s = await store('readwrite');
  if (!s) {
    memory.delete(key(profileId, ref));
    return;
  }
  await request(s.delete(key(profileId, ref)));
}

export async function deleteProfilePictures(profileId: string): Promise<void> {
  for (const p of await listPictures(profileId)) await deletePicture(profileId, p.ref);
}
