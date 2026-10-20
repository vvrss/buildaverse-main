import type { Character } from '../format/types';
import { HEADING, NARRATION, NOTE } from '../store/logic';
import * as s from '../store/storyStore';
import { gesturePadOpen } from '../store/ui';

/**
 * One registry for every shortcut. Hotkeys, typed commands, the keyboard bar,
 * swipes and drawn gestures all trigger actions by id, so a gesture can be
 * bound to anything a key can do.
 */

interface ActionDef {
  label: string;
  run: () => void;
}

const fixed: Record<string, ActionDef> = {
  'voice.next': { label: 'Next character', run: () => s.stepVoice(1) },
  'voice.prev': { label: 'Previous character', run: () => s.stepVoice(-1) },
  'voice.narration': { label: 'Narration', run: () => s.setVoice(NARRATION) },
  'voice.heading': { label: 'Heading', run: () => s.setVoice(HEADING) },
  'voice.note': { label: 'Note', run: () => s.setVoice(NOTE) },
  'nav.prev': { label: 'Previous line', run: s.navPrev },
  'nav.next': { label: 'Next line', run: () => s.navNext() },
  'nav.end': { label: 'Jump to end', run: s.navEnd },
  'history.undo': { label: 'Undo', run: s.undo },
  'history.redo': { label: 'Redo', run: s.redo },
  'line.commit': { label: 'Send line', run: () => s.commit(false) },
  'line.commitSame': { label: 'Send, keep speaker', run: () => s.commit(true) },
  'line.insertBelow': { label: 'Insert below', run: s.insertBelow },
  'line.delete': { label: 'Delete line', run: s.deleteCurrent },
  'line.moveUp': { label: 'Move line up', run: () => s.moveCurrent(-1) },
  'line.moveDown': { label: 'Move line down', run: () => s.moveCurrent(1) },
  'pad.toggle': { label: 'Gesture pad', run: () => (gesturePadOpen.value = !gesturePadOpen.value) },
};

function resolve(id: string): ActionDef | null {
  if (fixed[id]) return fixed[id];
  const set = /^voice\.set:(.+)$/.exec(id);
  if (set) {
    const c = s.story.value.characters.find((ch) => ch.id === set[1]);
    return c ? { label: c.name, run: () => s.setVoice(c.id) } : null;
  }
  const pick = /^voice\.pick:(\d+)$/.exec(id);
  if (pick) {
    const n = Number(pick[1]);
    const c = s.story.value.characters[n];
    return { label: c ? c.name : `Character ${n + 1}`, run: () => s.pickCharacter(n) };
  }
  return null;
}

/** Runs an action; returns its label (for feedback) or null when unknown. */
export function runAction(id: string): string | null {
  const def = resolve(id);
  if (!def) return null;
  def.run();
  return def.label;
}

export function describeAction(id: string): string {
  return resolve(id)?.label ?? id.replace(/^voice\.set:/, '@');
}

/** Actions offered when binding a custom gesture. */
export function bindableActions(characters: Character[]): { id: string; label: string }[] {
  return [
    ...characters.map((c) => ({ id: `voice.set:${c.id}`, label: `Switch to ${c.name}` })),
    ...Array.from({ length: 9 }, (_, n) => ({ id: `voice.pick:${n}`, label: `Character #${n + 1} (any story)` })),
    ...Object.entries(fixed).map(([id, def]) => ({ id, label: def.label })),
  ];
}
