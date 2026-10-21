import { batch, signal } from '@preact/signals';
import { parseStory } from '../format/parser';
import { serializeStory } from '../format/serializer';
import { type Character, type Story, emptyStory, nextColor, slugify, uniqueId } from '../format/types';
import { go, storyPath } from '../router';
import { db } from './db';
import { History } from './history';
import { profileId, requireProfileId } from './session';
import { settings } from './settings';
import { broadcast, onBroadcast } from './sync';
import {
  HEADING,
  NARRATION,
  NOTE,
  type Voice,
  compose,
  countLines,
  cycleVoice,
  type Composed,
  draftOf,
  renameCharacterId,
  revoice,
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
/**
 * The unsent line waiting at the end of the story while the composer is
 * somewhere else (editing a line, or inserting mid-story). When the composer
 * is at the end, that line is simply the draft and this is null.
 */
let pendingNew: { draft: string; voice: Voice } | null = null;
/** A mid-story line written early (the page was hidden) and reopened, so Enter carries on inserting after it. */
let resumeInsertId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let toastKey = 0;
/** updatedAt of the open story as this window last read or wrote it. */
let knownUpdatedAt = 0;
/** Saves run one after another, so two flushes never race each other. */
let saveChain: Promise<void> = Promise.resolve();
/** Work that must reach the story before it is saved (e.g. Text mode's pending edit). */
const flushHooks = new Set<() => void>();

const snapshot = (): Snapshot => ({ story: story.value, mode: mode.value, voice: voice.value });

function isAtEnd(m: Mode = mode.value): boolean {
  return m.type === 'new' && m.at >= story.value.blocks.length;
}

/** The unsent line at the end of the story, wherever the composer is now. */
function endDraft(): { draft: string; voice: Voice } | null {
  return isAtEnd() ? { draft: draft.value, voice: voice.value } : pendingNew;
}

/** Text typed at a mid-story insertion point that isn't in the story yet. */
function hasMidDraft(): boolean {
  return mode.value.type === 'new' && !isAtEnd() && !!draft.value.trim();
}

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

export function registerFlushHook(fn: () => void): () => void {
  flushHooks.add(fn);
  return () => flushHooks.delete(fn);
}

function runFlushHooks() {
  for (const fn of [...flushHooks]) fn();
}

/** Brings everything typed so far into the story: pending hooks, an open edit, a mid-story draft. */
export function settleEdit() {
  runFlushHooks();
  batch(() => {
    saveEditIfChanged();
    flushInsertDraft();
  });
}

export function flushSave(): Promise<void> {
  const run = saveChain.then(doFlush);
  saveChain = run.catch(() => {});
  return run;
}

async function doFlush() {
  clearTimeout(saveTimer);
  const id = storyId.value;
  if (!id || saveState.value !== 'pending') return;
  const s = story.value;
  const text = serializeStory(s);
  try {
    const existing = await db.getStory(id);
    if (!existing) {
      // Deleted in another window. Never recreate it under its old id.
      const owner = profileId.value;
      if (!owner || !(await db.getProfile(owner))) {
        saveState.value = 'error';
        return;
      }
      await saveAsCopy(s, 'recovered');
      return;
    }
    if (existing.updatedAt > knownUpdatedAt && existing.text !== text) {
      // Another window saved a newer version: keep both instead of overwriting it.
      await saveAsCopy(s, 'conflict');
      return;
    }
    const now = Math.max(Date.now(), existing.updatedAt + 1);
    await db.putStory({ ...existing, title: s.title, text, lines: s.blocks.length, updatedAt: now });
    knownUpdatedAt = now;
    clearJournal(id);
    broadcast({ type: 'story-saved', id, updatedAt: now });
    if (story.value === s && storyId.value === id) saveState.value = 'saved';
  } catch {
    saveState.value = 'error';
  }
}

async function saveAsCopy(s: Story, reason: 'conflict' | 'recovered') {
  const oldId = storyId.value;
  const owner = requireProfileId();
  const id = newId();
  const now = Date.now();
  const title = `${s.title} (${reason === 'conflict' ? 'conflict copy' : 'recovered'})`;
  const copy = { ...s, title };
  await db.putStory({
    id,
    profileId: owner,
    title,
    text: serializeStory(copy),
    lines: copy.blocks.length,
    createdAt: now,
    updatedAt: now,
  });
  if (oldId) clearJournal(oldId);
  batch(() => {
    storyId.value = id;
    story.value = copy;
    saveState.value = 'saved';
  });
  knownUpdatedAt = now;
  go(storyPath(id), true);
  showToast(
    reason === 'conflict'
      ? 'This story changed in another window. Your version was saved as a copy.'
      : 'This story was deleted in another window. Your text was saved as a new story.',
  );
}

// ------------------------------------------------- crash journal and drafts
// IndexedDB writes started while the page is closing often never land, so
// the latest text also goes to localStorage synchronously when the page hides.

const JOURNAL = 'storyteller:journal:';
const DRAFT = 'storyteller:draft:';

function storageSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the IndexedDB save is still attempted.
  }
}

function storageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function storageRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}

interface Journal {
  id: string;
  profileId: string;
  text: string;
  at: number;
}

function clearJournal(id: string) {
  storageRemove(JOURNAL + id);
}

interface SavedDraft {
  draft: string;
  voice: Voice;
  profileId?: string;
}

function rememberDraft(id: string) {
  const unsent = endDraft();
  const owner = profileId.value;
  if (unsent && unsent.draft.trim() && owner) storageSet(DRAFT + id, { ...unsent, profileId: owner } satisfies SavedDraft);
  else storageRemove(DRAFT + id);
}

/** Removes the crash journals and unsent drafts a deleted profile left in this browser. */
export function forgetLocalCopies(owner: string, storyIds: string[] = []) {
  for (const id of storyIds) {
    storageRemove(JOURNAL + id);
    storageRemove(DRAFT + id);
  }
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(JOURNAL) || k.startsWith(DRAFT));
  } catch {
    return;
  }
  for (const key of keys) {
    if (storageGet<{ profileId?: string }>(key)?.profileId === owner) storageRemove(key);
  }
}

function writeJournal() {
  const id = storyId.value;
  const owner = profileId.value;
  if (!id || !owner) return;
  // A failed save is journaled too: the database may have been closed by an update in another window.
  if (saveState.value !== 'saved') {
    const entry: Journal = { id, profileId: owner, text: serializeStory(story.value), at: Date.now() };
    storageSet(JOURNAL + id, entry);
  }
  rememberDraft(id);
}

/** Applies journals left by a page that closed before its last save landed. */
export async function recoverJournals(owner: string) {
  let keys: string[] = [];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(JOURNAL));
  } catch {
    return;
  }
  for (const key of keys) {
    const j = storageGet<Journal>(key);
    if (!j || j.profileId !== owner) continue;
    const record = await db.getStory(j.id);
    if (record && record.profileId === owner && j.at > record.updatedAt && record.text !== j.text) {
      const parsed = parseStory(j.text).story;
      await db.putStory({ ...record, title: parsed.title, text: j.text, lines: parsed.blocks.length, updatedAt: j.at });
    }
    storageRemove(key);
  }
}

function onPageHide() {
  if (!storyId.value) return;
  runFlushHooks();
  batch(() => {
    saveEditIfChanged();
    // A half-typed mid-story line is written now so it can't be lost, then
    // reopened, so coming back and typing on continues the same line.
    const m = mode.value;
    const at = m.type === 'new' ? m.at : -1;
    if (flushInsertDraft()) {
      resumeInsertId = story.value.blocks[at]?.id ?? null;
      enterEdit(at);
    }
  });
  writeJournal();
  void flushSave();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onPageHide();
  });
  window.addEventListener('pagehide', onPageHide);
}

// Other windows: pick up their saves when this one has nothing unsaved.
onBroadcast((msg) => {
  const id = storyId.value;
  if (!id) return;
  if (msg.type === 'story-saved' && msg.id === id && msg.updatedAt > knownUpdatedAt) {
    // Text-tab typing becomes a pending save first, so the reload can never overwrite it.
    runFlushHooks();
    if (canReload()) void reloadOpenStory();
  } else if (msg.type === 'story-deleted' && msg.id === id && saveState.value === 'saved') {
    resetEditor();
    go('/', true);
    showToast('This story was deleted in another window.');
  }
});

/** Nothing here would be lost by swapping in another window's version. */
function canReload(): boolean {
  return saveState.value === 'saved' && !isEditDirty() && !hasMidDraft();
}

function isEditDirty(): boolean {
  const m = mode.value;
  if (m.type !== 'edit') return false;
  const block = story.value.blocks[m.index];
  return !!block && (draft.value !== draftOf(block) || voice.value !== voiceOf(block));
}

async function reloadOpenStory() {
  const id = storyId.value;
  if (!id) return;
  const record = await db.getStory(id);
  if (!record || storyId.value !== id || !canReload() || record.updatedAt <= knownUpdatedAt) return;
  const { story: s } = parseStory(record.text);
  knownUpdatedAt = record.updatedAt;
  batch(() => {
    const m = mode.value;
    const wasAtEnd = isAtEnd(m);
    story.value = s;
    history.clear();
    syncHistory();
    // The unsent end line stays the end line, below the other window's new lines.
    if (wasAtEnd) mode.value = { type: 'new', at: s.blocks.length };
    else if (m.type === 'edit' || m.at >= s.blocks.length) exitToNew(s.blocks.length);
  });
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function createStory(text?: string, title?: string): Promise<string> {
  const id = newId();
  const s = text ? parseStory(text).story : emptyStory();
  if (title) s.title = title;
  const now = Date.now();
  await db.putStory({
    id,
    profileId: requireProfileId(),
    title: s.title,
    text: serializeStory(s),
    lines: s.blocks.length,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function duplicateStory(id: string): Promise<string | null> {
  const record = await db.getStory(id);
  if (!record) return null;
  const { story: s } = parseStory(record.text);
  s.title = `${s.title} (copy)`;
  return createStory(serializeStory(s));
}

export async function renameStory(id: string, title: string) {
  const clean = title.trim();
  if (!clean) return;
  if (storyId.value === id) {
    setTitle(clean);
    await flushSave();
    return;
  }
  const record = await db.getStory(id);
  if (!record) return;
  const { story: s } = parseStory(record.text);
  s.title = clean;
  const now = Math.max(Date.now(), record.updatedAt + 1);
  await db.putStory({ ...record, title: clean, text: serializeStory(s), updatedAt: now });
  broadcast({ type: 'story-saved', id, updatedAt: now });
}

export async function deleteStory(id: string) {
  if (storyId.value === id) resetEditor();
  clearJournal(id);
  storageRemove(DRAFT + id);
  await db.deleteStory(id);
  broadcast({ type: 'story-deleted', id });
}

export async function openStory(id: string): Promise<boolean> {
  if (storyId.value === id) return true;
  await flushSave();
  const record = await db.getStory(id);
  if (!record || record.profileId !== requireProfileId()) return false;
  const journal = storageGet<Journal>(JOURNAL + id);
  const recovered = !!journal && journal.profileId === record.profileId && journal.at > record.updatedAt;
  const text = recovered ? journal.text : record.text;
  const { story: s } = parseStory(text);
  const saved = storageGet<SavedDraft>(DRAFT + id);
  const savedVoiceOk = !!saved && (saved.voice === NARRATION || s.characters.some((c) => c.id === saved.voice));
  batch(() => {
    storyId.value = id;
    story.value = s;
    history.clear();
    syncHistory();
    pendingNew = null;
    resumeInsertId = null;
    draft.value = saved?.draft ?? '';
    mode.value = { type: 'new', at: s.blocks.length };
    if (saved && savedVoiceOk) voice.value = saved.voice;
    else if (s.blocks.length) voice.value = voiceAfter(s.blocks, s.blocks.length - 1, s.characters);
    else voice.value = s.characters[0]?.id ?? NARRATION;
    saveState.value = recovered && text !== record.text ? 'pending' : 'saved';
  });
  knownUpdatedAt = record.updatedAt;
  if (saveState.value === 'pending') void flushSave();
  else clearJournal(id);
  return true;
}

/**
 * Saves everything (an open edit, Text-tab typing, the unsent draft) and
 * closes the story. With `onlyId`, does nothing unless that story is open.
 */
export async function closeStory(onlyId?: string) {
  const id = storyId.value;
  if (!id || (onlyId && id !== onlyId)) return;
  settleEdit();
  rememberDraft(id);
  await flushSave();
  if (storyId.value === id) resetEditor();
}

/** Clears all editor state, so nothing from one story or profile shows in the next. */
export function resetEditor() {
  clearTimeout(saveTimer);
  batch(() => {
    storyId.value = null;
    story.value = emptyStory();
    history.clear();
    syncHistory();
    pendingNew = null;
    resumeInsertId = null;
    draft.value = '';
    mode.value = { type: 'new', at: 0 };
    voice.value = NARRATION;
    saveState.value = 'saved';
  });
  knownUpdatedAt = 0;
}

// ---------------------------------------------------------------- composer

/** Enter: write the draft, then move on. `sameVoice` keeps the speaker (Shift+Enter). */
export function commit(sameVoice = false) {
  const m = mode.value;
  const s = story.value;
  const editing = m.type === 'edit' ? s.blocks[m.index] : undefined;

  // Stepping through lines with Enter without changing them adds no undo steps.
  if (editing && m.type === 'edit' && draft.value === draftOf(editing) && voice.value === voiceOf(editing)) {
    if (editing.id === resumeInsertId) {
      batch(() => continueInsert(m.index, s.blocks, voiceAfter(s.blocks, m.index, s.characters)));
    } else navNext(false);
    return;
  }

  const composed = editing ? composeEdit(editing, s) : compose(draft.value, voice.value, s.characters);

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
    const following =
      sameVoice || !settings.value.autoAlternate ? composed.voice : voiceAfter(blocks, index, composed.characters);
    if (m.type === 'edit') {
      if (editing?.id === resumeInsertId) continueInsert(index, blocks, following);
      else if (index + 1 < blocks.length) enterEdit(index + 1);
      else exitToNew(blocks.length, following);
    } else if (index + 1 >= blocks.length && pendingNew) {
      // An insert reached the end: bring back the line that was waiting there.
      exitToNew(blocks.length, following);
    } else {
      mode.value = { type: 'new', at: index + 1 };
      voice.value = following;
    }
  });
}

/** A reopened mid-story line was sent: carry on inserting after it, as before the page was hidden. */
function continueInsert(index: number, blocks: Story['blocks'], following: Voice) {
  resumeInsertId = null;
  if (index + 1 >= blocks.length) {
    exitToNew(blocks.length, following);
    return;
  }
  mode.value = { type: 'new', at: index + 1 };
  draft.value = '';
  voice.value = following;
}

/**
 * The block an edit produces. When only the speaker chip changed, the text is
 * kept as it is, even if it starts like a prefix ("@tom is late").
 */
function composeEdit(block: Story['blocks'][number], s: Story): Composed {
  if (draft.value === draftOf(block) && voice.value !== voiceOf(block)) {
    return { block: revoice(block, voice.value, s.characters), characters: s.characters, voice: voice.value };
  }
  return compose(draft.value, voice.value, s.characters, block.id);
}

/** Applies a pending edit when navigating away from a block. */
function saveEditIfChanged() {
  const m = mode.value;
  if (m.type !== 'edit') return;
  const s = story.value;
  const block = s.blocks[m.index];
  if (!block || (draft.value === draftOf(block) && voice.value === voiceOf(block))) return;
  const composed = composeEdit(block, s);
  if (!composed.block) return;
  const blocks = [...s.blocks];
  blocks[m.index] = composed.block;
  setStory({ ...s, characters: composed.characters, blocks });
}

/**
 * Text typed at an insertion point in the middle of the story is written as
 * a line when you move away, just like an edited line. Returns how many
 * blocks were inserted (0 or 1) so callers can shift indices.
 */
function flushInsertDraft(): number {
  const m = mode.value;
  const s = story.value;
  if (m.type !== 'new' || m.at >= s.blocks.length || !draft.value.trim()) return 0;
  const composed = compose(draft.value, voice.value, s.characters);
  if (!composed.block) return 0;
  const blocks = [...s.blocks];
  blocks.splice(m.at, 0, composed.block);
  batch(() => {
    setStory({ ...s, characters: composed.characters, blocks });
    draft.value = '';
    mode.value = { type: 'new', at: m.at + 1 };
  });
  return 1;
}

export function enterEdit(index: number) {
  const block = story.value.blocks[index];
  if (!block) return;
  batch(() => {
    // Only the line waiting at the end of the story is kept aside; a draft at
    // a middle insertion point was already written by flushInsertDraft.
    if (isAtEnd()) pendingNew = { draft: draft.value, voice: voice.value };
    mode.value = { type: 'edit', index };
    draft.value = draftOf(block);
    voice.value = voiceOf(block);
  });
}

/** Opens a line for editing from a tap, keeping any change to the current one. */
export function selectLine(index: number) {
  batch(() => {
    saveEditIfChanged();
    const m = mode.value;
    const at = m.type === 'new' ? m.at : -1;
    // The line being inserted is written first; lines after it move down by one.
    const inserted = flushInsertDraft();
    enterEdit(index + (inserted && index >= at ? 1 : 0));
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
    flushInsertDraft();
    const m = mode.value;
    const target = m.type === 'edit' ? m.index - 1 : m.at - 1;
    if (target >= 0) enterEdit(target);
  });
}

export function navNext(save = true) {
  batch(() => {
    if (save) {
      saveEditIfChanged();
      flushInsertDraft();
    }
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
    flushInsertDraft();
    const len = story.value.blocks.length;
    if (mode.value.type === 'edit' || pendingNew) exitToNew(len);
    else mode.value = { type: 'new', at: len };
  });
}

export function insertBelow() {
  const m = mode.value;
  if (m.type !== 'edit') return;
  batch(() => {
    saveEditIfChanged();
    const s = story.value;
    // Below the last line is the end of the story, where the unsent line waits.
    if (m.index + 1 >= s.blocks.length) {
      exitToNew(s.blocks.length);
      return;
    }
    // pendingNew (the unsent line at the end) stays put and comes back at the end.
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
    // The unsent end line survives undo and redo, wherever the composer goes.
    const end = endDraft();
    const kept = end && end.draft.trim() ? end : null;
    story.value = snap.story;
    resumeInsertId = null;
    const len = snap.story.blocks.length;
    const m = snap.mode;
    if (m.type === 'edit' && m.index < len) {
      pendingNew = kept;
      mode.value = m;
      draft.value = draftOf(snap.story.blocks[m.index]);
      voice.value = voiceOf(snap.story.blocks[m.index]);
    } else if (m.type === 'new' && m.at < len) {
      pendingNew = kept;
      mode.value = m;
      draft.value = '';
      voice.value = snap.voice;
    } else {
      pendingNew = null;
      mode.value = { type: 'new', at: len };
      draft.value = kept?.draft ?? '';
      voice.value = kept?.voice ?? snap.voice;
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
  if (!/^[\p{L}\p{M}\p{N}_-]+$/u.test(next)) return 'Use letters, numbers, - or _ only.';
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
  const fallback = s.characters.find((c) => c.id !== id)?.id ?? NARRATION;
  batch(() => {
    setStory({ ...s, characters: s.characters.filter((c) => c.id !== id) });
    if (voice.value === id) voice.value = fallback;
    if (pendingNew?.voice === id) pendingNew = { ...pendingNew, voice: fallback };
  });
  return true;
}

// -------------------------------------------------------------- whole text

export function setTitle(title: string) {
  // Text-tab typing is applied first, or its debounced apply would bring the old title back.
  runFlushHooks();
  setStory({ ...story.value, title }, 'title');
}

/**
 * Replaces the story from `.story` text (Text mode, Paste from AI). The
 * unsent line in the composer is kept. Returns the story that was applied.
 */
export function replaceFromText(text: string, coalesceKey?: string): Story {
  const { story: parsed } = parseStory(text);
  batch(() => {
    const m = mode.value;
    const wasAtEnd = m.type === 'new' && m.at >= story.value.blocks.length;
    setStory(parsed, coalesceKey);
    if (m.type === 'edit') exitToNew(parsed.blocks.length);
    else mode.value = { type: 'new', at: wasAtEnd ? parsed.blocks.length : Math.min(m.at, parsed.blocks.length) };
    const known = (v: Voice) => v === NARRATION || v === HEADING || v === NOTE || parsed.characters.some((c) => c.id === v);
    if (!known(voice.value)) voice.value = parsed.characters[0]?.id ?? NARRATION;
    if (pendingNew && !known(pendingNew.voice)) pendingNew = { ...pendingNew, voice: voice.value };
  });
  return parsed;
}
