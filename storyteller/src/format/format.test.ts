import { describe, expect, it } from 'vitest';
import { extractStoryText, storyForAi } from './ai';
import { diffLines } from './diff';
import { storyRefs } from './images';
import { parseStory as legacyParse } from './legacy/parser';
import { serializeStory as legacySerialize } from './legacy/serializer';
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

describe('format edge cases from the review', () => {
  it('treats U+2028 and U+2029 as line breaks', () => {
    const { story, issues } = parseStory('@ana: Hello world > Rain.\n');
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(withoutIds(story).blocks).toEqual([
      { kind: 'line', speaker: 'ana', text: 'Hello' },
      { kind: 'narration', text: 'world' },
      { kind: 'narration', text: 'Rain.' },
    ]);
  });

  it('keeps Korean, Japanese and Hindi ids composed, so typed names match', async () => {
    const { slugify } = await import('./types');
    expect(slugify('민수')).toBe('민수'.normalize('NFC'));
    expect(slugify('ガク')).toBe('ガク');
    expect(slugify('सीता')).toBe('सीता');
    expect(slugify('Zoé')).toBe('zoe');
    const text = `---\ncharacters:\n  ${'민수'.normalize('NFD')}: 민수  #111111\n---\n@민수: 뭐?\n`;
    const { story, issues } = parseStory(text);
    expect(issues).toEqual([]);
    expect(story.characters).toHaveLength(1);
  });

  it('reads fences with a space or tildes', () => {
    expect(extractStoryText('Here:\n``` story\n@a: hi\n```\nbye').trim()).toBe('@a: hi');
    expect(extractStoryText('Here:\n~~~story\n@a: hi\n~~~\nbye').trim()).toBe('@a: hi');
  });
});

describe('diffLines on long stories', () => {
  it('stays line-by-line for a few edits in a long text', () => {
    const lines = Array.from({ length: 6000 }, (_, i) => `@a: line ${i}`);
    const edited = [...lines];
    edited[100] = '@a: changed';
    edited.splice(4000, 0, '> inserted');
    edited.splice(5000, 1);
    const d = diffLines(lines.join('\n'), edited.join('\n'));
    expect(d.truncated).toBe(false);
    expect(d.added).toBe(2);
    expect(d.removed).toBe(2);
    const rebuilt = d.ops.filter((o) => o.type !== 'del').map((o) => o.text);
    expect(rebuilt).toEqual(edited);
  });
});

describe('re-check fixes', () => {
  it('unwraps fences indented under a list item', () => {
    const reply =
      '1. **Revised story:**\n\n   ```story\n   ---\n   title: T\n   ---\n\n   @ana: Hi there.\n     Still Ana.\n   > The wind.\n   ```\n\n2. Let me know!';
    const text = extractStoryText(reply);
    const { story } = parseStory(text);
    expect(story.blocks.map((b) => b.text)).toEqual(['Hi there.\nStill Ana.', 'The wind.']);
    expect(text).not.toContain('Let me know');
  });

  it('diffs exactly like a brute-force LCS on random texts', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const lcs = (a: string[], b: string[]) => {
      const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
      for (let i = a.length - 1; i >= 0; i -= 1)
        for (let j = b.length - 1; j >= 0; j -= 1) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
      return t[0][0];
    };
    for (let round = 0; round < 300; round += 1) {
      const pick = () => Array.from({ length: 1 + Math.floor(rand() * 12) }, () => 'abcd'[Math.floor(rand() * 4)]);
      const a = pick();
      const b = pick();
      const d = diffLines(a.join('\n'), b.join('\n'));
      expect(d.ops.filter((o) => o.type !== 'add').map((o) => o.text)).toEqual(a);
      expect(d.ops.filter((o) => o.type !== 'del').map((o) => o.text)).toEqual(b);
      expect(d.ops.filter((o) => o.type === 'same').length).toBe(lcs(a, b));
    }
  });
});

describe('pictures in the format', () => {
  const TEXT = `---
title: With pictures
cover: img:0a1b2c3d4e5f6a7b
characters:
  ana: Ana Reyes  img:9c1d2e3f4a5b6c7d  #e76f51
  tom: Tom  #2a9d8f
---

![The lighthouse [at dusk]](img:3fa94c0d1b2e7a55)
@ana: Look.
![](img:1111222233334444)
`;

  it('reads cover, portraits and pictures, and writes them back unchanged', () => {
    const { story, issues } = parseStory(TEXT);
    expect(issues).toEqual([]);
    expect(story.cover).toBe('0a1b2c3d4e5f6a7b');
    expect(story.characters[0]).toMatchObject({ name: 'Ana Reyes', portrait: '9c1d2e3f4a5b6c7d', color: '#e76f51' });
    expect(story.characters[1].portrait).toBeUndefined();
    expect(story.blocks[0]).toMatchObject({ kind: 'image', ref: '3fa94c0d1b2e7a55', text: 'The lighthouse [at dusk]' });
    expect(story.blocks[2]).toMatchObject({ kind: 'image', ref: '1111222233334444', text: '' });
    const again = parseStory(serializeStory(story)).story;
    expect(serializeStory(again)).toBe(serializeStory(story));
    expect(storyRefs(story).sort()).toEqual(['0a1b2c3d4e5f6a7b', '1111222233334444', '3fa94c0d1b2e7a55', '9c1d2e3f4a5b6c7d']);
  });

  it('survives a trip through the version without pictures, both ways', () => {
    // The old app reads picture lines as narration and writes them back as "> ![…](img:…)".
    const old = legacySerialize(legacyParse(TEXT).story);
    expect(old).toContain('> ![The lighthouse [at dusk]](img:3fa94c0d1b2e7a55)');
    expect(old).toContain('img:9c1d2e3f4a5b6c7d');
    const back = parseStory(old).story;
    expect(serializeStory(back)).toBe(serializeStory(parseStory(TEXT).story));
    // And files from the old app still read the same in the new one.
    const plain = '---\ntitle: Old\ncharacters:\n  ana: Ana  #e76f51\n---\n\n@ana: Hi.\n> Rain.\n';
    expect(serializeStory(parseStory(plain).story)).toBe(legacySerialize(legacyParse(plain).story));
  });

  it('never loads pictures from the web', () => {
    const { story, issues } = parseStory('![x](https://example.com/a.png)\n');
    expect(story.blocks[0]).toMatchObject({ kind: 'narration', text: '![x](https://example.com/a.png)' });
    expect(issues[0].message).toMatch(/web/);
  });

  it('keeps one-line captions and no continuation after a picture', () => {
    const { story } = parseStory('![a](img:3fa94c0d1b2e7a55)\n  indented\n');
    expect(story.blocks.map((b) => b.kind)).toEqual(['image', 'narration']);
  });
});
