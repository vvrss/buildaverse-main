import { signal } from '@preact/signals';

/**
 * Minimal IndexedDB wrapper. Falls back to memory (with `persistent` false)
 * when IndexedDB is unavailable, e.g. some private browsing modes.
 * Everything a person writes belongs to a profile, the app's on-device account.
 */

export interface ProfileRecord {
  id: string;
  name: string;
  color: string;
  /** Salted SHA-256 of the PIN. A privacy lock, not encryption. */
  pin?: { salt: string; hash: string };
  createdAt: number;
  lastUsedAt: number;
}

export interface StoryRecord {
  id: string;
  /** Missing on stories saved before profiles existed; claimed by the first profile. */
  profileId?: string;
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
  profileId?: string;
  /** Action id from the shortcut registry, e.g. "voice.set:ana". */
  action: string;
  samples: Point[][];
  createdAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

type StoreName = 'profiles' | 'stories' | 'gestures' | 'settings';
type RecordOf<S extends StoreName> = S extends 'profiles'
  ? ProfileRecord
  : S extends 'stories'
    ? StoryRecord
    : S extends 'gestures'
      ? GestureRecord
      : SettingRecord;

const DB_NAME = 'storyteller';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: Record<StoreName, Map<string, unknown>> = {
  profiles: new Map(),
  stories: new Map(),
  gestures: new Map(),
  settings: new Map(),
};
export let persistent = true;

/**
 * "blocked": another window still has the old database open, so the upgrade
 * waits (nothing falls back to memory). "stale": a newer version upgraded
 * the database from another window, so this one must reload.
 */
export const dbStatus = signal<'ok' | 'blocked' | 'stale'>('ok');

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('stories')) db.createObjectStore('stories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('gestures')) db.createObjectStore('gestures', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        dbStatus.value = 'ok';
        // Let a newer version in another window upgrade instead of blocking it.
        db.onversionchange = () => {
          db.close();
          dbStatus.value = 'stale';
          dbPromise = Promise.reject(new Error('The database was upgraded in another window. Reload.'));
          dbPromise.catch(() => {});
        };
        resolve(db);
      };
      req.onerror = () => {
        if (req.error?.name === 'VersionError') {
          // A newer build already upgraded the database: never write to memory instead.
          dbStatus.value = 'stale';
          reject(req.error);
          return;
        }
        persistent = false;
        resolve(null);
      };
      // Another window holds the old version open. Keep waiting; the request
      // completes as soon as that window closes or reloads.
      req.onblocked = () => {
        dbStatus.value = 'blocked';
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

const settingKey = (profileId: string, key: string) => `${profileId}:${key}`;

export const db = {
  listProfiles: async () => (await getAll('profiles')).sort((a, b) => b.lastUsedAt - a.lastUsedAt),
  getProfile: (id: string) => get('profiles', id),
  putProfile: (record: ProfileRecord) => put('profiles', record),

  /** Deletes a profile with everything it owns. */
  deleteProfile: async (id: string) => {
    for (const s of await getAll('stories')) if (s.profileId === id) await remove('stories', s.id);
    for (const g of await getAll('gestures')) if (g.profileId === id) await remove('gestures', g.id);
    for (const s of await getAll('settings')) if (s.key.startsWith(`${id}:`)) await remove('settings', s.key);
    await remove('profiles', id);
  },

  /** Gives records saved before profiles existed to `profileId`. */
  claimOrphans: async (profileId: string) => {
    for (const s of await getAll('stories')) if (!s.profileId) await put('stories', { ...s, profileId });
    for (const g of await getAll('gestures')) if (!g.profileId) await put('gestures', { ...g, profileId });
    const legacy = await get('settings', 'disabledBuiltins');
    if (legacy) {
      await put('settings', { key: settingKey(profileId, 'disabledBuiltins'), value: legacy.value });
      await remove('settings', 'disabledBuiltins');
    }
  },

  listStories: async (profileId: string) =>
    (await getAll('stories')).filter((s) => s.profileId === profileId).sort((a, b) => b.updatedAt - a.updatedAt),
  getStory: (id: string) => get('stories', id),
  putStory: (record: StoryRecord) => put('stories', record),
  deleteStory: (id: string) => remove('stories', id),

  listGestures: async (profileId: string) =>
    (await getAll('gestures')).filter((g) => g.profileId === profileId).sort((a, b) => a.createdAt - b.createdAt),
  putGesture: (record: GestureRecord) => put('gestures', record),
  deleteGesture: (id: string) => remove('gestures', id),

  /** Per-profile settings. */
  getSetting: async <T>(profileId: string, key: string, fallback: T): Promise<T> =>
    ((await get('settings', settingKey(profileId, key)))?.value as T | undefined) ?? fallback,
  setSetting: (profileId: string, key: string, value: unknown) =>
    put('settings', { key: settingKey(profileId, key), value }),

  /** Device-wide values such as the last used profile. */
  getGlobal: async <T>(key: string, fallback: T): Promise<T> =>
    ((await get('settings', `global:${key}`))?.value as T | undefined) ?? fallback,
  setGlobal: (key: string, value: unknown) => put('settings', { key: `global:${key}`, value }),

  ready: open,
};
