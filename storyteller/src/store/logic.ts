import {
  type Block,
  type Character,
  type Story,
  newBlockId,
  nextColor,
  normalizeText,
  sameId,
  slugify,
  uniqueId,
} from '../format/types';

/**
 * Who the composer writes as: a speaker id, or one of the non-dialog kinds.
 * Narration is part of the swipe cycle; headings and notes come from
 * prefixes, buttons or gestures.
 */
export type Voice = string;
export const NARRATION = '>';
export const HEADING = '#';
export const NOTE = '//';
/** Editing a picture's caption. Never part of the swipe cycle. */
export const IMAGE = '!';

export const isSpeaker = (v: Voice) => v !== NARRATION && v !== HEADING && v !== NOTE && v !== IMAGE;

/** Order used by swipes, Tab and the chip bar. */
export function voiceCycle(characters: Character[]): Voice[] {
  return [...characters.map((c) => c.id), NARRATION];
}

export function cycleVoice(current: Voice, characters: Character[], step: number): Voice {
  const cycle = voiceCycle(characters);
  const at = cycle.indexOf(current);
  if (at === -1) return cycle[step > 0 ? 0 : cycle.length - 1];
  return cycle[(((at + step) % cycle.length) + cycle.length) % cycle.length];
}

/**
 * The speaker most likely to talk after `justSpoke`, whose line sits at
 * `index`: the other half of the current exchange, looking back within the
 * scene; otherwise the next character in cast order.
 */
export function nextSpeaker(
  blocks: Block[],
  index: number,
  justSpoke: string,
  characters: Character[],
): Voice {
  for (let i = index - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.kind === 'heading') break;
    if (b.kind === 'line' && b.speaker !== justSpoke) return b.speaker;
  }
  if (characters.length >= 2) {
    const at = characters.findIndex((c) => c.id === justSpoke);
    return characters[(at + 1) % characters.length].id;
  }
  return justSpoke;
}

/** Voice to switch to after the block at `index` was written with Enter. */
export function voiceAfter(blocks: Block[], index: number, characters: Character[]): Voice {
  const block = blocks[index];
  if (!block) return characters[0]?.id ?? NARRATION;
  if (block.kind === 'line') return nextSpeaker(blocks, index, block.speaker, characters);
  if (block.kind === 'heading') return NARRATION;
  for (let i = index - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.kind === 'heading') break;
    if (b.kind === 'line') return nextSpeaker(blocks, i, b.speaker, characters);
  }
  return characters[0]?.id ?? NARRATION;
}

export function voiceOf(block: Block): Voice {
  switch (block.kind) {
    case 'line':
      return block.speaker;
    case 'narration':
      return NARRATION;
    case 'heading':
      return HEADING;
    case 'note':
      return NOTE;
  }
}

/** Text that `compose` would read as a prefix (speaker, kind or picture). */
const PREFIX_LIKE = /^(@[\p{L}\p{M}\p{N}_-]|\/\/|>|#+\s|!\[)/u;

/**
 * Text shown in the composer when a block is opened for editing. Text that
 * itself starts like a prefix gets the block's own marker in front, so
 * sending it back can never change the block's kind or speaker.
 */
export function draftOf(block: Block): string {
  switch (block.kind) {
    case 'line':
      if (block.direction) return `(${block.direction}) ${block.text}`;
      if (block.text.startsWith('(')) return `() ${block.text}`;
      return PREFIX_LIKE.test(block.text) ? `@${block.speaker}: ${block.text}` : block.text;
    case 'narration':
      return PREFIX_LIKE.test(block.text) ? `> ${block.text}` : block.text;
    case 'note':
      return PREFIX_LIKE.test(block.text) ? `// ${block.text}` : block.text;
    case 'heading':
      return PREFIX_LIKE.test(block.text) ? `# ${block.text}` : block.text;
  }
}

export interface Composed {
  block: Block | null;
  /** Characters created on the fly by typing an unknown `@name`. */
  characters: Character[];
  /** Voice after applying any prefix. */
  voice: Voice;
}

/**
 * Turns composer text plus the active voice into a block. Leading prefixes
 * override the voice: `@id`, `>`, `#`, `//`, and `(direction)` for dialog.
 */
export function compose(draft: string, voice: Voice, characters: Character[], id = newBlockId()): Composed {
  let text = draft.trim();
  let v = voice;
  let cast = characters;

  const at = /^@([\p{L}\p{M}\p{N}_-]+)\s*:?\s*/u.exec(text);
  if (at) {
    const known = cast.find((c) => sameId(c.id, at[1]));
    if (known) v = known.id;
    else {
      const name = at[1].charAt(0).toUpperCase() + at[1].slice(1);
      const created = { id: uniqueId(slugify(at[1]), cast.map((c) => c.id)), name, color: nextColor(cast) };
      cast = [...cast, created];
      v = created.id;
    }
    text = text.slice(at[0].length);
  } else if (text.startsWith('//')) {
    v = NOTE;
    text = text.slice(2);
  } else if (text.startsWith('>')) {
    v = NARRATION;
    text = text.slice(1);
  } else if (/^#+\s/.test(text)) {
    v = HEADING;
    text = text.replace(/^#+/, '');
  }

  let direction: string | undefined;
  // "(whispering) text" or, as in the file format, "(whispering): text".
  const dir = /^\s*\(([^)]*)\)\s*:?\s*/.exec(text);
  if (dir && isSpeaker(v)) {
    direction = dir[1].trim() || undefined;
    text = text.slice(dir[0].length);
  }

  text = normalizeText(text);
  if (!text && !direction) return { block: null, characters: cast, voice: v };

  let block: Block;
  if (v === NARRATION) block = { kind: 'narration', id, text };
  else if (v === HEADING) block = { kind: 'heading', id, text: text.replace(/\n/g, ' ') };
  else if (v === NOTE) block = { kind: 'note', id, text };
  else if (!cast.some((c) => c.id === v)) block = { kind: 'narration', id, text };
  else block = direction ? { kind: 'line', id, speaker: v, direction, text } : { kind: 'line', id, speaker: v, text };
  return { block, characters: cast, voice: v };
}

export function renameCharacterId(story: Story, from: string, to: string): Story {
  return {
    ...story,
    characters: story.characters.map((c) => (c.id === from ? { ...c, id: to } : c)),
    blocks: story.blocks.map((b) => (b.kind === 'line' && b.speaker === from ? { ...b, speaker: to } : b)),
  };
}

export function countLines(story: Story, speaker: string): number {
  return story.blocks.filter((b) => b.kind === 'line' && b.speaker === speaker).length;
}
