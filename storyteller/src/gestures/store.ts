import { computed, signal } from '@preact/signals';
import { type GestureRecord, type Point, db } from '../store/db';
import { BUILTIN_GESTURES } from './defaults';
import { makeTemplates } from './recognizer';

export const customGestures = signal<GestureRecord[]>([]);
export const disabledBuiltins = signal<string[]>([]);

const builtinTemplates = new Map(BUILTIN_GESTURES.map((g) => [g.id, makeTemplates(g.action, [g.stroke])]));

/** Every active template; the pad matches strokes against these. */
export const templates = computed(() => [
  ...BUILTIN_GESTURES.filter((g) => !disabledBuiltins.value.includes(g.id)).flatMap(
    (g) => builtinTemplates.get(g.id) ?? [],
  ),
  ...customGestures.value.flatMap((g) => makeTemplates(g.action, g.samples)),
]);

export async function loadGestures() {
  customGestures.value = await db.listGestures();
  disabledBuiltins.value = await db.getSetting<string[]>('disabledBuiltins', []);
}

export async function saveGesture(action: string, samples: Point[][]) {
  const record: GestureRecord = {
    id: `g${Date.now().toString(36)}`,
    action,
    samples: samples.map((s) => s.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))),
    createdAt: Date.now(),
  };
  await db.putGesture(record);
  customGestures.value = [...customGestures.value, record];
}

export async function removeGesture(id: string) {
  await db.deleteGesture(id);
  customGestures.value = customGestures.value.filter((g) => g.id !== id);
}

export async function toggleBuiltin(id: string) {
  const list = disabledBuiltins.value;
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  disabledBuiltins.value = next;
  await db.setSetting('disabledBuiltins', next);
}
