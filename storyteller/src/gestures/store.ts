import { computed, signal } from '@preact/signals';
import { type GestureRecord, type Point, db } from '../store/db';
import { profileId, requireProfileId } from '../store/session';
import { BUILTIN_GESTURES, strokesOf } from './defaults';
import { makeTemplates } from './recognizer';

export const customGestures = signal<GestureRecord[]>([]);
export const disabledBuiltins = signal<string[]>([]);

const builtinTemplates = new Map(BUILTIN_GESTURES.map((g) => [g.id, makeTemplates(g.action, strokesOf(g))]));

/** Every active template; the pad matches strokes against these. */
export const templates = computed(() => [
  ...BUILTIN_GESTURES.filter((g) => !disabledBuiltins.value.includes(g.id)).flatMap(
    (g) => builtinTemplates.get(g.id) ?? [],
  ),
  ...customGestures.value.flatMap((g) => makeTemplates(g.action, g.samples)),
]);

export async function loadGestures(profile: string) {
  customGestures.value = await db.listGestures(profile);
  disabledBuiltins.value = await db.getSetting<string[]>(profile, 'disabledBuiltins', []);
}

export function resetGestures() {
  customGestures.value = [];
  disabledBuiltins.value = [];
}

export async function saveGesture(action: string, samples: Point[][], createdAt = Date.now()) {
  const record: GestureRecord = {
    id: `g${createdAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    profileId: requireProfileId(),
    action,
    samples: samples.map((s) => s.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))),
    createdAt,
  };
  await db.putGesture(record);
  customGestures.value = [...customGestures.value, record];
}

export async function removeGesture(id: string) {
  await db.deleteGesture(id);
  customGestures.value = customGestures.value.filter((g) => g.id !== id);
}

export async function setDisabledBuiltins(next: string[]) {
  disabledBuiltins.value = next;
  if (profileId.value) await db.setSetting(profileId.value, 'disabledBuiltins', next);
}

export async function toggleBuiltin(id: string) {
  const list = disabledBuiltins.value;
  await setDisabledBuiltins(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
}
