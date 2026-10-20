import { batch, signal } from '@preact/signals';
import { parseStory } from '../format/parser';
import { serializeStory } from '../format/serializer';
import { type Character, type Story, emptyStory, nextColor, slugify, uniqueId } from '../format/types';
import { db } from './db';
import { History } from './history';
import {
  NARRATION,
  type Voice,
  compose,
  countLines,
  cycleVoice,
  draftOf,
  renameCharacterId,
  voiceAfter,
  voiceOf,
} from './logic';

/**
 * Where the composer writes: a new block inserted at `at`, or an existing
 * block being edited. Back/forward navigation moves between these.
 */
export type Mode = { type: 'new'; at: number } | { type: 'edit'; index: number };

interface Snapshot {
  story: Story;
  mode: Mode;
  voice: Voice;
}

export const storyId = signal<string | null>(null);
export const story = signal<Story>(emptyStory());
export const mode = signal<Mode>({ type: 'new', at: 0 });
export const voice = signal<Voice>(NARRATION);
export const draft = signal('');
export const toast = signal<{ text: string; key: number } | null>(null);
export const saveState = signal<'saved' | 'pending' | 'error'>('saved');
export const historyState = signal({ canUndo: false, canRedo: false });

const history = new History<Snapshot>();
let pendingNew: { draft: string; voice: Voice } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastKey = 0;

const snapshot = (): Snapshot => ({ story: story.value, mode: mode.value, voice: voice.value });

function syncHistory() {
  historyState.value = { canUndo: history.canUndo, canRedo: history.canRedo };
}

export function showToast(text: string) {
  toastKey += 1;
  toast.value = { text, key: toastKey };
}

/** Every story change goes through here so it is undoable and autosaved. */
export function setStory(next: Story, coalesceKey?: string) {
  if (next === story.value) return;
  history.push(snapshot(), coalesceKey);
  story.value = next;
  syncHistory();
  scheduleSave();
}

function scheduleSave() {
  saveState.value = 'pending';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 400);
}

export async function flushSave() {
  clearTimeout(saveTimer);
  const id = storyId.value;
  if (!id || saveState.value !== 'pending') return;
  const s = story.value;
  try {
    const existing = await db.getStory(id);
    await db.putStory({
      id,
      title: s.title,
      text: serializeStory(s),
      lines: s.blocks.length,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    if (story.value === s) saveState.value = 'saved';
  } catch {
    saveState.value = 'error';
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function createStory(text?: string): Promise<string> {
  const id = newId();
  const s = text ? parseStory(text).story : emptyStory();
  const now = Date.now();
  await db.putStory({ id, title: s.title, text: serializeStory(s), lines: s.blocks.length, createdAt: now, updatedAt: now });
  return id;
}

export async function openStory(id: string): Promise<boolean> {
  if (storyId.value === id) return true;
  await flushSave();
  const record = await db.getStory(id);
  if (!record) return false;
  const { story: s } = parseStory(record.text);
  batch(() => {
    storyId.value = id;
    story.value = s;
    history.clear();
    syncHistory();
    pendingNew = null;
    draft.value = '';
    mode.value = { type: 'new', at: s.blocks.length };
    voice.value = s.blocks.length ? voiceAfter(s.blocks, s.blocks.length - 1, s.characters) : (s.characters[0]?.id ?? NARRATION);
    saveState.value = 'saved';
  });
  return true;
}

export async function closeStory() {
  await flushSave();
  storyId.value = null;
}

// ---------------------------------------------------------------- composer

/** Enter: write the draft, then move on. `sameVoice` keeps the speaker (Shift+Enter). */
export function commit(sameVoice = false) {
  const m = mode.value;
  const s = story.value;
  const editing = m.type === 'edit' ? s.blocks[m.index] : undefined;
  const composed = compose(draft.value, voice.value, s.characters, editing?.id);

  if (!composed.block) {
    batch(() => {
      if (composed.characters !== s.characters) setStory({ ...s, characters: composed.characters });
      voice.value = composed.voice;
      draft.value = '';
      if (m.type === 'edit') navNext(false);
    });
    return;
  }

  const blocks = [...s.blocks];
  const index = m.type === 'edit' ? m.index : m.at;
  if (m.type === 'edit') blocks[index] = composed.block;
  else blocks.splice(index, 0, composed.block);

  batch(() => {
    setStory({ ...s, characters: composed.characters, blocks });
    draft.value = '';
    const following = sameVoice ? composed.voice : voiceAfter(blocks, index, composed.characters);
    if (m.type === 'edit') {
      if (index + 1 < blocks.length) enterEdit(index + 1);
      else exitToNew(blocks.length, following);
    } else {
      mode.value = { type: 'new', at: index + 1 };
      voice.value = following;
    }
  });
}

/** Applies a pending edit when navigating away from a block. */
function saveEditIfChanged() {
  const m = mode.value;
  if (m.type !== 'edit') return;
  const s = story.value;
  const block = s.blocks[m.index];
  if (!block || (draft.value === draftOf(block) && voice.value === voiceOf(block))) return;
  const composed = compose(draft.value, voice.value, s.characters, block.id);
  if (!composed.block) return;
  const blocks = [...s.blocks];
  blocks[m.index] = composed.block;
  setStory({ ...s, characters: composed.characters, blocks });
}

export function enterEdit(index: number) {
  const block = story.value.blocks[index];
  if (!block) return;
  batch(() => {
    if (mode.value.type === 'new') pendingNew = { draft: draft.value, voice: voice.value };
    mode.value = { type: 'edit', index };
    draft.value = draftOf(block);
    voice.value = voiceOf(block);
  });
}

function exitToNew(at: number, fallbackVoice?: Voice) {
  const s = story.value;
  batch(() => {
    mode.value = { type: 'new', at };
    draft.value = pendingNew?.draft ?? '';
    voice.value =
      pendingNew?.voice ??
      fallbackVoice ??
      (at > 0 ? voiceAfter(s.blocks, at - 1, s.characters) : (s.characters[0]?.id ?? NARRATION));
    pendingNew = null;
  });
}

export function navPrev() {
  batch(() => {
    saveEditIfChanged();
    const m = mode.value;
    const target = m.type === 'edit' ? m.index - 1 : m.at - 1;
    if (target >= 0) enterEdit(target);
  });
}

export function navNext(save = true) {
  batch(() => {
    if (save) saveEditIfChanged();
    const m = mode.value;
    const len = story.value.blocks.length;
    if (m.type === 'edit') {
      if (m.index + 1 < len) enterEdit(m.index + 1);
      else exitToNew(len);
    } else if (m.at < len) {
      enterEdit(m.at);
    }
  });
}

export function navEnd() {
  batch(() => {
    saveEditIfChanged();
    if (mode.value.type === 'edit') exitToNew(story.value.blocks.length);
    else mode.value = { type: 'new', at: story.value.blocks.length };
  });
}

export function insertBelow() {
  const m = mode.value;
  if (m.type !== 'edit') return;
  batch(() => {
    saveEditIfChanged();
    const s = story.value;
    pendingNew = null;
    mode.value = { type: 'new', at: m.index + 1 };
    draft.value = '';
    voice.value = voiceAfter(s.blocks, m.index, s.characters);
  });
}

export function deleteCurrent() {
  const m = mode.value;
  if (m.type !== 'edit') return;
  const s = story.value;
  const blocks = s.blocks.filter((_, i) => i !== m.index);
  batch(() => {
    setStory({ ...s, blocks });
    if (m.index < blocks.length) {
      mode.value = { type: 'edit', index: m.index };
      draft.value = draftOf(blocks[m.index]);
      voice.value = voiceOf(blocks[m.index]);
    } else {
      exitToNew(blocks.length);
    }
  });
  showToast('Line deleted');
}

export function moveCurrent(step: -1 | 1) {
  const m = mode.value;
  if (m.type !== 'edit') return;
  const target = m.index + step;
  const s = story.value;
  if (target < 0 || target >= s.blocks.length) return;
  batch(() => {
    saveEditIfChanged();
    const blocks = [...story.value.blocks];
    [blocks[m.index], blocks[target]] = [blocks[target], blocks[m.index]];
    setStory({ ...story.value, blocks });
    mode.value = { type: 'edit', index: target };
  });
}

// ------------------------------------------------------------------ voices

export function setVoice(v: Voice) {
  voice.value = v;
}

export function stepVoice(step: number) {
  voice.value = cycleVoice(voice.value, story.value.characters, step);
}

export function pickCharacter(n: number) {
  const c = story.value.characters[n];
  if (c) voice.value = c.id;
}

// ----------------------------------------------------------------- history

function restore(snap: Snapshot) {
  batch(() => {
    story.value = snap.story;
    voice.value = snap.voice;
    const len = snap.story.blocks.length;
    const m = snap.mode;
    if (m.type === 'edit' && m.index < len) {
      mode.value = m;
      draft.value = draftOf(snap.story.blocks[m.index]);
    } else {
      if (mode.value.type === 'edit') draft.value = pendingNew?.draft ?? '';
      pendingNew = null;
      mode.value = { type: 'new', at: Math.min(m.type === 'new' ? m.at : len, len) };
    }
    syncHistory();
    scheduleSave();
  });
}

export function undo() {
  const prev = history.undo(snapshot());
  if (prev) restore(prev);
  else showToast('Nothing to undo');
}

export function redo() {
  const next = history.redo(snapshot());
  if (next) restore(next);
  else showToast('Nothing to redo');
}

// -------------------------------------------------------------- characters

export function addCharacter(name: string): Character | null {
  const s = story.value;
  const clean = name.trim();
  if (!clean) return null;
  const character = {
    id: uniqueId(slugify(clean), s.characters.map((c) => c.id)),
    name: clean,
    color: nextColor(s.characters),
  };
  setStory({ ...s, characters: [...s.characters, character] });
  return character;
}

export function updateCharacter(id: string, patch: Partial<Omit<Character, 'id'>>) {
  const s = story.value;
  setStory(
    { ...s, characters: s.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
    `char:${id}:${Object.keys(patch).join()}`,
  );
}

/** Returns an error message, or null when the id was changed. */
export function changeCharacterId(from: string, to: string): string | null {
  const s = story.value;
  const next = to.trim();
  if (next === from) return null;
  if (!/^[\p{L}\p{N}_-]+$/u.test(next)) return 'Use letters, numbers, - or _ only.';
  if (s.characters.some((c) => c.id.toLowerCase() === next.toLowerCase() && c.id !== from)) {
    return `@${next} is already used.`;
  }
  batch(() => {
    setStory(renameCharacterId(s, from, next));
    if (voice.value === from) voice.value = next;
    if (pendingNew?.voice === from) pendingNew.voice = next;
  });
  return null;
}

export function moveCharacter(id: string, step: -1 | 1) {
  const s = story.value;
  const at = s.characters.findIndex((c) => c.id === id);
  const target = at + step;
  if (at < 0 || target < 0 || target >= s.characters.length) return;
  const characters = [...s.characters];
  [characters[at], characters[target]] = [characters[target], characters[at]];
  setStory({ ...s, characters });
}

export function deleteCharacter(id: string): boolean {
  const s = story.value;
  if (countLines(s, id) > 0) return false;
  batch(() => {
    setStory({ ...s, characters: s.characters.filter((c) => c.id !== id) });
    if (voice.value === id) voice.value = s.characters.find((c) => c.id !== id)?.id ?? NARRATION;
  });
  return true;
}

// -------------------------------------------------------------- whole text

export function setTitle(title: string) {
  setStory({ ...story.value, title }, 'title');
}

/** Replaces the story from `.story` text (Text mode, Paste from AI). */
export function replaceFromText(text: string, coalesceKey?: string) {
  const { story: parsed } = parseStory(text);
  batch(() => {
    setStory(parsed, coalesceKey);
    pendingNew = null;
    draft.value = '';
    mode.value = { type: 'new', at: parsed.blocks.length };
    if (!parsed.characters.some((c) => c.id === voice.value) && voice.value !== NARRATION) {
      voice.value = parsed.characters[0]?.id ?? NARRATION;
    }
  });
}
