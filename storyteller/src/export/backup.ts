import { parseStory } from '../format/parser';
import { loadGestures, setDisabledBuiltins } from '../gestures/store';
import { type GestureRecord, type Point, type StoryRecord, db } from '../store/db';
import { requireProfileId } from '../store/session';
import { DEFAULT_SETTINGS, type Settings, loadSettings, settings, updateSettings } from '../store/settings';

/**
 * Full backup: one JSON file with a profile's stories, gestures and settings.
 * Restoring adds to what is already there and never overwrites a story.
 */

export const BACKUP_FORMAT = 1;

export interface Backup {
  app: 'storyteller';
  format: number;
  exportedAt: string;
  profile: { name: string; color: string };
  settings: Settings;
  disabledBuiltins: string[];
  stories: { id: string; title: string; text: string; createdAt: number; updatedAt: number }[];
  gestures: { action: string; samples: Point[][]; createdAt: number }[];
}

export function buildBackup(input: {
  profile: { name: string; color: string };
  settings: Settings;
  disabledBuiltins: string[];
  stories: StoryRecord[];
  gestures: GestureRecord[];
}): Backup {
  return {
    app: 'storyteller',
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    profile: { name: input.profile.name, color: input.profile.color },
    settings: input.settings,
    disabledBuiltins: input.disabledBuiltins,
    stories: input.stories.map(({ id, title, text, createdAt, updatedAt }) => ({ id, title, text, createdAt, updatedAt })),
    gestures: input.gestures.map(({ action, samples, createdAt }) => ({ action, samples, createdAt })),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Validates a backup file; returns a readable error for anything else. */
export function parseBackup(text: string): { backup: Backup } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: 'This file is not a Storyteller backup (it is not valid JSON).' };
  }
  if (!isObj(data) || data.app !== 'storyteller') return { error: 'This file is not a Storyteller backup.' };
  if (typeof data.format !== 'number' || data.format > BACKUP_FORMAT) {
    return { error: 'This backup comes from a newer version of Storyteller. Update the app and try again.' };
  }
  if (!Array.isArray(data.stories)) return { error: 'The backup has no stories list.' };
  const stories = data.stories.filter(
    (s): s is Backup['stories'][number] => isObj(s) && typeof s.text === 'string' && typeof s.id === 'string',
  );
  // A gesture is kept only if every sample is a real stroke; one bad entry
  // would otherwise break the gesture pad and the Gestures page on every load.
  const isPoint = (p: unknown) => isObj(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
  const isStroke = (s: unknown) => Array.isArray(s) && s.length >= 2 && s.length <= 5000 && s.every(isPoint);
  const gestures = (Array.isArray(data.gestures) ? data.gestures : [])
    .filter(
      (g): g is Backup['gestures'][number] =>
        isObj(g) &&
        typeof g.action === 'string' &&
        g.action.length <= 200 &&
        Array.isArray(g.samples) &&
        g.samples.length > 0 &&
        g.samples.length <= 10 &&
        g.samples.every(isStroke),
    )
    .map((g) => ({
      action: g.action,
      samples: g.samples.map((s) => s.map((p) => ({ x: Number(p.x), y: Number(p.y) }))),
      createdAt: Number(g.createdAt) || Date.now(),
    }));
  const profile = isObj(data.profile) ? data.profile : {};
  return {
    backup: {
      app: 'storyteller',
      format: data.format,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
      profile: { name: String(profile.name ?? 'Writer'), color: String(profile.color ?? '#7c5cff') },
      settings: { ...DEFAULT_SETTINGS, ...(isObj(data.settings) ? (data.settings as Partial<Settings>) : {}) },
      disabledBuiltins: Array.isArray(data.disabledBuiltins) ? data.disabledBuiltins.map(String) : [],
      stories: stories.map((s) => ({
        id: s.id,
        title: typeof s.title === 'string' ? s.title : parseStory(s.text).story.title,
        text: s.text,
        createdAt: Number(s.createdAt) || Date.now(),
        updatedAt: Number(s.updatedAt) || Date.now(),
      })),
      gestures,
    },
  };
}

export interface RestorePlan {
  add: Backup['stories'];
  /** Same id and identical text: already here. */
  skip: number;
}

/** Which stories a restore adds. Changed copies of an existing story come in as new stories. */
export function planRestore(backup: Backup, existing: Pick<StoryRecord, 'id' | 'text'>[]): RestorePlan {
  const byId = new Map(existing.map((s) => [s.id, s.text]));
  const texts = new Set(existing.map((s) => s.text));
  const add: Backup['stories'] = [];
  let skip = 0;
  for (const s of backup.stories) {
    if (byId.get(s.id) === s.text || texts.has(s.text)) skip += 1;
    else add.push(s);
  }
  return { add, skip };
}

// ------------------------------------------------------------ with storage

export async function exportBackup(profile: { name: string; color: string }): Promise<Backup> {
  const id = requireProfileId();
  return buildBackup({
    profile,
    settings: settings.value,
    disabledBuiltins: await db.getSetting<string[]>(id, 'disabledBuiltins', []),
    stories: await db.listStories(id),
    gestures: await db.listGestures(id),
  });
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function restoreBackup(backup: Backup, options: { settings: boolean }) {
  const profile = requireProfileId();
  const plan = planRestore(backup, await db.listStories(profile));
  for (const s of plan.add) {
    // Story ids are global; a fresh id avoids clashing with any profile's copy.
    const owner = (await db.getStory(s.id))?.profileId;
    const id = owner ? newId() : s.id;
    await db.putStory({
      id,
      profileId: profile,
      title: s.title,
      text: s.text,
      lines: parseStory(s.text).story.blocks.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    });
  }

  const existing = new Set((await db.listGestures(profile)).map((g) => `${g.action}|${JSON.stringify(g.samples)}`));
  let gestures = 0;
  for (const g of backup.gestures) {
    if (existing.has(`${g.action}|${JSON.stringify(g.samples)}`)) continue;
    await db.putGesture({
      id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      profileId: profile,
      action: g.action,
      samples: g.samples,
      createdAt: g.createdAt,
    });
    gestures += 1;
  }

  if (options.settings) {
    updateSettings(backup.settings);
    await setDisabledBuiltins(backup.disabledBuiltins);
    await loadSettings(profile);
  }
  await loadGestures(profile);
  return { stories: plan.add.length, skipped: plan.skip, gestures };
}
