import { describe, expect, it } from 'vitest';
import { parseStory } from '../format/parser';
import { contrast, readerBackground } from '../ui/color';
import { holdFor, paceOf, readItems, wordCount } from './pace';

describe('reading pace', () => {
  it('counts words in spaced and unspaced scripts', () => {
    expect(wordCount('Did you hear that?')).toBe(4);
    expect(wordCount('  ')).toBe(0);
    // About two characters per word where words aren't separated by spaces.
    expect(wordCount('你听到了吗')).toBe(2.5);
    expect(wordCount('聞こえた？ Yes.')).toBe(3);
    // Korean puts spaces between words.
    expect(wordCount('들었어 그거')).toBe(2);
  });

  it('keeps longer lines lit for longer, within bounds', () => {
    const line = (text: string) => ({ kind: 'line' as const, id: 'x', speaker: 'a', text });
    const short = holdFor(line('Hi.'), 'calm');
    const long = holdFor(line('It is coming from below, and it sounds like somebody knocking on the floor.'), 'calm');
    expect(short).toBe(1500);
    expect(long).toBeGreaterThan(short);
    expect(holdFor(line('word '.repeat(500)), 'calm')).toBe(14000);
  });

  it('moves faster at a quicker pace', () => {
    const item = { kind: 'narration' as const, id: 'x', text: 'The wind howled against the glass all night long.' };
    expect(holdFor(item, 'slow')).toBeGreaterThan(holdFor(item, 'calm'));
    expect(holdFor(item, 'calm')).toBeGreaterThan(holdFor(item, 'quick'));
    expect(holdFor({ kind: 'heading', id: 'h', text: 'Chapter 2' }, 'calm')).toBe(1600);
  });

  it('falls back to calm for an unknown saved pace', () => {
    expect(paceOf('quick')).toBe('quick');
    expect(paceOf('fast')).toBe('calm');
    expect(paceOf(undefined)).toBe('calm');
  });

  it('reads everything but notes', () => {
    const { story } = parseStory('---\ntitle: T\ncharacters:\n  a: Ana  #e76f51\n---\n\n# One\n> Wind.\n@a: Hello.\n// a private note\n');
    expect(readItems(story).map((b) => b.kind)).toEqual(['heading', 'narration', 'line']);
  });
});

describe('reader background', () => {
  it('keeps the hue but is always dark enough for white text', () => {
    for (const color of ['#e76f51', '#2a9d8f', '#e9a23b', '#ffffff', '#000000', '#ffeb3b', '#8e5bd6', undefined, 'not a color']) {
      const bg = readerBackground(color);
      expect(bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrast(bg, '#ffffff')).toBeGreaterThanOrEqual(5.6);
    }
  });

  it('calms bright colors down', () => {
    const bg = readerBackground('#ff0000');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(r - Math.min(g, b)).toBeLessThan(140);
  });
});
