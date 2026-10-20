/**
 * Minimal IndexedDB wrapper. Falls back to memory (with `persistent` false)
 * when IndexedDB is unavailable, e.g. some private browsing modes.
 */

export interface StoryRecord {
  id: string;
  title: string;
  /** The story in `.story` format: the source of truth. */
  text: string;
  lines: number;
  createdAt: number;
  updatedAt: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface GestureRecord {
  id: string;
  /** Action id from the shortcut registry, e.g. "voice.set:ana". */
  action: string;
  samples: Point[][];
  createdAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

type StoreName = 'stories' | 'gestures' | 'settings';
type RecordOf<S extends StoreName> = S extends 'stories'
  ? StoryRecord
  : S extends 'gestures'
    ? GestureRecord
    : SettingRecord;

const DB_NAME = 'storyteller';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: Record<StoreName, Map<string, unknown>> = {
  stories: new Map(),
  gestures: new Map(),
  settings: new Map(),
};
export let persistent = true;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('stories')) db.createObjectStore('stories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('gestures')) db.createObjectStore('gestures', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        persistent = false;
        resolve(null);
      };
    } catch {
      persistent = false;
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

const keyOf = (store: StoreName, value: unknown) =>
  (value as Record<string, string>)[store === 'settings' ? 'key' : 'id'];

async function getAll<S extends StoreName>(store: S): Promise<RecordOf<S>[]> {
  const db = await open();
  if (!db) return [...memory[store].values()] as RecordOf<S>[];
  return request(db.transaction(store).objectStore(store).getAll()) as Promise<RecordOf<S>[]>;
}

async function get<S extends StoreName>(store: S, key: string): Promise<RecordOf<S> | undefined> {
  const db = await open();
  if (!db) return memory[store].get(key) as RecordOf<S> | undefined;
  return request(db.transaction(store).objectStore(store).get(key)) as Promise<RecordOf<S> | undefined>;
}

async function put<S extends StoreName>(store: S, value: RecordOf<S>): Promise<void> {
  const db = await open();
  if (!db) {
    memory[store].set(keyOf(store, value), value);
    return;
  }
  await request(db.transaction(store, 'readwrite').objectStore(store).put(value));
}

async function remove(store: StoreName, key: string): Promise<void> {
  const db = await open();
  if (!db) {
    memory[store].delete(key);
    return;
  }
  await request(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export const db = {
  listStories: async () => (await getAll('stories')).sort((a, b) => b.updatedAt - a.updatedAt),
  getStory: (id: string) => get('stories', id),
  putStory: (record: StoryRecord) => put('stories', record),
  deleteStory: (id: string) => remove('stories', id),

  listGestures: async () => (await getAll('gestures')).sort((a, b) => a.createdAt - b.createdAt),
  putGesture: (record: GestureRecord) => put('gestures', record),
  deleteGesture: (id: string) => remove('gestures', id),

  getSetting: async <T>(key: string, fallback: T): Promise<T> =>
    ((await get('settings', key))?.value as T | undefined) ?? fallback,
  setSetting: (key: string, value: unknown) => put('settings', { key, value }),

  ready: open,
};
