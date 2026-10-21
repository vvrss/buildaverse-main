import type { Block, Story } from '../format/types';

export type Pace = 'slow' | 'calm' | 'quick';

export const PACES: Pace[] = ['slow', 'calm', 'quick'];
export const PACE_LABEL: Record<Pace, string> = { slow: 'Slow', calm: 'Calm', quick: 'Quick' };
const WPM: Record<Pace, number> = { slow: 150, calm: 200, quick: 280 };

/** A saved pace, or the default when a backup or older version left something else. */
export const paceOf = (value: unknown): Pace => (PACES.includes(value as Pace) ? (value as Pace) : 'calm');

/** What the reader shows, one item at a time: everything but notes. */
export type ReadItem = Exclude<Block, { kind: 'note' }>;

export function readItems(story: Story): ReadItem[] {
  return story.blocks.filter((b): b is ReadItem => b.kind !== 'note');
}

// Han, kana and Thai are written without spaces: about two characters make a word.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu;

/** Roughly how many words a reader takes in, for any script. */
export function wordCount(text: string): number {
  const unspaced = text.match(UNSPACED)?.length ?? 0;
  const spaced = text.replace(UNSPACED, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return spaced + unspaced / 2;
}

/** How long a line stays lit before the next one, in milliseconds. */
export function holdFor(item: ReadItem, pace: Pace): number {
  const scale = WPM.calm / WPM[pace];
  if (item.kind === 'heading') return Math.round(1600 * Math.sqrt(scale));
  if (item.kind === 'image') return Math.round((3600 + wordCount(item.text) * 200) * Math.sqrt(scale));
  const ms = 900 + (wordCount(item.text) * 60000) / WPM[pace];
  return Math.round(Math.min(14000, Math.max(1500, ms)));
}
