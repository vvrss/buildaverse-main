import { describe, expect, it } from 'vitest';
import { extractStoryText, storyForAi } from './ai';
import { diffLines } from './diff';
import { parseStory } from './parser';
import { serializeStory } from './serializer';
import type { Story } from './types';

const SAMPLE = `---
title: The Lighthouse
characters:
  ana: Ana Reyes   #e76f51
  tom: Tom         #2a9d8f
mood: stormy
---

# Chapter 1: Storm

> The wind howled against the glass.

@ana: Did you hear that?
@tom (whispering): Stay still.
@ana: It's coming from below.
  It sounds like... knocking.

// note: Tom knows more than he says
`;

const withoutIds = (story: Story) => ({
  ...story,
  blocks: story.blocks.map(({ id: _id, ...rest }) => rest),
});

describe('parseStory', () => {
  it('reads header, characters and every block kind', () => {
    const { story, issues } = parseStory(SAMPLE);
    expect(issues).toEqual([]);
    expect(story.title).toBe('The Lighthouse');
    expect(story.characters).toEqual([
      { id: 'ana', name: 'Ana Reyes', color: '#e76f51' },
      { id: 'tom', name: 'Tom', color: '#2a9d8f' },
    ]);
    expect(story.meta).toEqual([['mood', 'stormy']]);
    expect(withoutIds(story).blocks).toEqual([
      { kind: 'heading', text: 'Chapter 1: Storm' },
      { kind: 'narration', text: 'The wind howled against the glass.' },
      { kind: 'line', speaker: 'ana', text: 'Did you hear that?' },
      { kind: 'line', speaker: 'tom', direction: 'whispering', text: 'Stay still.' },
      { kind: 'line', speaker: 'ana', text: "It's coming from below.\nIt sounds like... knocking." },
      { kind: 'note', text: 'note: Tom knows more than he says' },
    ]);
  });

  it('round-trips losslessly through the serializer', () => {
    const first = parseStory(SAMPLE).story;
    const text = serializeStory(first);
    const second = parseStory(text);
    expect(second.issues).toEqual([]);
    expect(withoutIds(second.story)).toEqual(withoutIds(first));
    // Serializing is stable: a second pass produces identical text.
    expect(serializeStory(second.story)).toBe(text);
  });

  it('round-trips awkward content', () => {
    const story: Story = {
      title: 'Odd: names & things',
      characters: [
        { id: 'agent-7', name: 'Agent #007', color: '#123456' },
        { id: 'zoé', name: 'Zoé', color: '#abcdef' },
      ],
      meta: [],
      blocks: [
        { kind: 'line', id: '1', speaker: 'agent-7', text: '' },
        { kind: 'line', id: '2', speaker: 'zoé', direction: 'sotto voce', text: 'a: b\n> not narration' },
        { kind: 'narration', id: '3', text: '> quoted' },
        { kind: 'heading', id: '4', text: '## Part two' },
        { kind: 'note', id: '5', text: 'two\nlines' },
      ],
    };
    const parsed = parseStory(serializeStory(story));
    expect(parsed.issues).toEqual([]);
    expect(withoutIds(parsed.story)).toEqual(withoutIds(story));
  });

  it('matches speakers case-insensitively', () => {
    const { story, issues } = parseStory(SAMPLE.replace('@tom (whispering)', '@TOM (whispering)'));
    expect(issues).toEqual([]);
    expect(story.blocks[3]).toMatchObject({ speaker: 'tom' });
  });

  it('adds unknown characters and reports the line', () => {
    const { story, issues } = parseStory(`${SAMPLE}@mira: Who's there?\n`);
    expect(story.characters.map((c) => c.id)).toEqual(['ana', 'tom', 'mira']);
    expect(issues).toEqual([
      { line: 19, severity: 'warning', message: 'Unknown character @mira. It was added to the cast.' },
    ]);
  });

  it('accepts "Name: text" for known characters, as AIs often write', () => {
    const { story, issues } = parseStory(`${SAMPLE}Ana Reyes: Hello?\nTom (calm): Hi.\n`);
    expect(withoutIds(story).blocks.slice(-2)).toEqual([
      { kind: 'line', speaker: 'ana', text: 'Hello?' },
      { kind: 'line', speaker: 'tom', direction: 'calm', text: 'Hi.' },
    ]);
    expect(issues.map((i) => i.line)).toEqual([19, 20]);
  });

  it('keeps unmarked lines as narration with a warning', () => {
    const { story, issues } = parseStory('Just some prose.\n');
    expect(withoutIds(story).blocks).toEqual([{ kind: 'narration', text: 'Just some prose.' }]);
    expect(issues[0]).toMatchObject({ line: 1, severity: 'warning' });
  });

  it('reports an unclosed header as an error but keeps going', () => {
    const { story, issues } = parseStory('---\ntitle: Oops\ncharacters:\n  a: A\n\n@a: hi\n');
    expect(issues[0]).toMatchObject({ line: 1, severity: 'error' });
    expect(story.title).toBe('Oops');
    expect(withoutIds(story).blocks).toEqual([{ kind: 'line', speaker: 'a', text: 'hi' }]);
  });

  it('handles Windows line endings and missing header', () => {
    const { story, issues } = parseStory('@x: one\r\n@y: two\r\n');
    expect(story.characters.map((c) => c.id)).toEqual(['x', 'y']);
    expect(story.blocks).toHaveLength(2);
    expect(issues).toHaveLength(2);
  });
});

describe('AI helpers', () => {
  it('extracts the story from a fenced reply', () => {
    const reply = `Sure! Here is the edit:\n\n${storyForAi(SAMPLE)}\nHope that helps.`;
    expect(extractStoryText(reply).trim()).toBe(SAMPLE.trim());
  });

  it('extracts from the first --- when there is no fence', () => {
    expect(extractStoryText(`Here you go\n${SAMPLE}`)).toBe(SAMPLE);
  });
});

describe('diffLines', () => {
  it('counts added and removed lines', () => {
    const d = diffLines('a\nb\nc\n', 'a\nx\nc\nd\n');
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.ops.map((o) => o.type)).toEqual(['same', 'del', 'add', 'same', 'add']);
  });
});
