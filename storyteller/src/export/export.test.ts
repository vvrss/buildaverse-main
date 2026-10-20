import { describe, expect, it } from 'vitest';
import { parseStory } from '../format/parser';
import { DEFAULT_SETTINGS } from '../store/settings';
import { buildBackup, parseBackup, planRestore } from './backup';
import { toPrintableHtml, toScript } from './script';

const STORY = parseStory(`---
title: The Lighthouse
characters:
  ana: Ana Reyes  #e76f51
  tom: Tom  #2a9d8f
---

# Chapter 1

> Wind. <Rain>.

@ana: Did you hear that?
@tom (whispering): Stay still.
  Don't move.
// secret
`).story;

describe('script export', () => {
  it('writes readable Markdown and leaves notes out by default', () => {
    expect(toScript(STORY)).toBe(
      [
        '# The Lighthouse',
        '',
        '*Cast: Ana Reyes, Tom*',
        '',
        '## Chapter 1',
        '',
        '*Wind. <Rain>.*',
        '',
        '**ANA REYES**: Did you hear that?',
        '',
        "**TOM** *(whispering)*: Stay still.  \nDon't move.",
        '',
      ].join('\n'),
    );
    expect(toScript(STORY, { notes: true })).toContain('> Note: secret');
  });

  it('escapes HTML in the printable page', () => {
    const html = toPrintableHtml(STORY);
    expect(html).toContain('Wind. &lt;Rain&gt;.');
    expect(html).toContain('<div class="name">TOM</div><div class="paren">(whispering)</div>');
    expect(html).not.toContain('secret');
  });
});

describe('backup', () => {
  const record = (id: string, text: string) => ({ id, profileId: 'p', title: 't', text, lines: 1, createdAt: 1, updatedAt: 2 });
  const backup = buildBackup({
    profile: { name: 'Ana', color: '#e76f51' },
    settings: { ...DEFAULT_SETTINGS, theme: 'dark' },
    disabledBuiltins: ['z'],
    stories: [record('a', 'one'), record('b', 'two')],
    gestures: [{ id: 'g1', profileId: 'p', action: 'nav.prev', samples: [[{ x: 1, y: 2 }]], createdAt: 3 }],
  });

  it('round-trips through JSON', () => {
    const parsed = parseBackup(JSON.stringify(backup));
    expect('backup' in parsed && parsed.backup).toEqual(backup);
  });

  it('rejects other files with a clear message', () => {
    expect(parseBackup('hello')).toEqual({ error: 'This file is not a Storyteller backup (it is not valid JSON).' });
    expect(parseBackup('{"app":"other"}')).toEqual({ error: 'This file is not a Storyteller backup.' });
    expect(parseBackup('{"app":"storyteller","format":99,"stories":[]}')).toMatchObject({ error: expect.stringContaining('newer') });
  });

  it('fills in missing settings with defaults', () => {
    const parsed = parseBackup('{"app":"storyteller","format":1,"stories":[{"id":"x","text":"@a: hi"}]}');
    expect('backup' in parsed && parsed.backup.settings).toEqual(DEFAULT_SETTINGS);
    expect('backup' in parsed && parsed.backup.stories[0].title).toBe('Untitled story');
  });

  it('skips stories that are already here and adds changed ones as new', () => {
    const plan = planRestore(backup, [{ id: 'a', text: 'one' }, { id: 'b', text: 'two, edited' }]);
    expect(plan.skip).toBe(1);
    expect(plan.add.map((s) => s.id)).toEqual(['b']);
  });
});
