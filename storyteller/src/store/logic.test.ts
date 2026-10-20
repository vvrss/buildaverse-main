import { describe, expect, it } from 'vitest';
import type { Block, Character } from '../format/types';
import { readPrefix } from '../shortcuts/prefixes';
import { HEADING, NARRATION, NOTE, compose, cycleVoice, voiceAfter } from './logic';

const cast: Character[] = [
  { id: 'ana', name: 'Ana', color: '#111111' },
  { id: 'tom', name: 'Tom', color: '#222222' },
  { id: 'mira', name: 'Mira', color: '#333333' },
];

const line = (speaker: string, text = '...'): Block => ({ kind: 'line', id: `${speaker}${text}`, speaker, text });
const narr = (text = '...'): Block => ({ kind: 'narration', id: `n${text}`, text });

describe('auto-alternate', () => {
  it('alternates between the two people in the current exchange', () => {
    const blocks = [line('mira'), line('tom'), line('ana')];
    // Mira -> Tom -> Ana is three-way; after Ana the last other speaker is Tom.
    expect(voiceAfter(blocks, 2, cast)).toBe('tom');
    expect(voiceAfter([...blocks, line('tom')], 3, cast)).toBe('ana');
  });

  it('falls back to cast order when nobody else has spoken in the scene', () => {
    expect(voiceAfter([line('ana')], 0, cast)).toBe('tom');
    expect(voiceAfter([line('mira')], 0, cast)).toBe('ana');
    const afterHeading: Block[] = [line('tom'), { kind: 'heading', id: 'h', text: 'II' }, line('mira')];
    expect(voiceAfter(afterHeading, 2, cast)).toBe('ana');
  });

  it('after narration, hands the turn to whoever answers the last line', () => {
    expect(voiceAfter([line('tom'), line('ana'), narr()], 2, cast)).toBe('tom');
  });

  it('after a heading, starts with narration', () => {
    expect(voiceAfter([{ kind: 'heading', id: 'h', text: 'I' }], 0, cast)).toBe(NARRATION);
  });

  it('cycles through characters then narration', () => {
    expect(cycleVoice('ana', cast, 1)).toBe('tom');
    expect(cycleVoice('mira', cast, 1)).toBe(NARRATION);
    expect(cycleVoice(NARRATION, cast, 1)).toBe('ana');
    expect(cycleVoice('ana', cast, -1)).toBe(NARRATION);
    expect(cycleVoice(HEADING, cast, 1)).toBe('ana');
  });
});

describe('compose', () => {
  it('writes the active voice', () => {
    expect(compose('Hello', 'ana', cast, 'x').block).toEqual({ kind: 'line', id: 'x', speaker: 'ana', text: 'Hello' });
    expect(compose('Rain.', NARRATION, cast, 'x').block).toEqual({ kind: 'narration', id: 'x', text: 'Rain.' });
  });

  it('lets prefixes override the voice', () => {
    expect(compose('@tom (quietly) Go.', 'ana', cast, 'x').block).toEqual({
      kind: 'line', id: 'x', speaker: 'tom', direction: 'quietly', text: 'Go.',
    });
    expect(compose('> Thunder.', 'ana', cast, 'x').block).toMatchObject({ kind: 'narration', text: 'Thunder.' });
    expect(compose('# Part II', 'ana', cast, 'x').block).toMatchObject({ kind: 'heading', text: 'Part II' });
    expect(compose('// fix later', 'ana', cast, 'x').block).toMatchObject({ kind: 'note', text: 'fix later' });
    expect(compose('#hashtag', 'ana', cast, 'x').block).toMatchObject({ kind: 'line', text: '#hashtag' });
  });

  it('creates a character for an unknown @name', () => {
    const { block, characters, voice } = compose('@leo Hi there', 'ana', cast, 'x');
    expect(characters.map((c) => c.id)).toEqual(['ana', 'tom', 'mira', 'leo']);
    expect(characters[3].name).toBe('Leo');
    expect(voice).toBe('leo');
    expect(block).toMatchObject({ speaker: 'leo', text: 'Hi there' });
  });

  it('returns no block for empty input', () => {
    expect(compose('   ', 'ana', cast).block).toBeNull();
    expect(compose('', NOTE, cast).block).toBeNull();
  });
});

describe('typed prefixes', () => {
  it('suggests characters after @', () => {
    const state = readPrefix('@m', cast);
    expect(state.type === 'mention' && state.matches.map((c) => c.id)).toEqual(['mira']);
  });

  it('switches speaker when a unique @prefix is followed by a space', () => {
    expect(readPrefix('@mi hello', cast)).toEqual({ type: 'switch', speaker: 'mira', rest: 'hello' });
    expect(readPrefix('@zed hello', cast)).toEqual({ type: 'none' });
  });

  it('runs /commands on space', () => {
    expect(readPrefix('/u ', cast)).toEqual({ type: 'run', action: 'history.undo' });
    expect(readPrefix('/u', cast)).toMatchObject({ type: 'command' });
  });
});
