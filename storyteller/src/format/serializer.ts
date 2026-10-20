import type { Block, Story } from './types';

const oneLine = (s: string) => s.replace(/\s*[\n\u2028\u2029]\s*/g, ' ').trim();

function withContinuation(prefix: string, text: string): string {
  const [first = '', ...rest] = text.split('\n');
  const head = first ? `${prefix} ${first}` : prefix;
  return [head, ...rest.map((l) => `  ${l}`)].join('\n');
}

export function serializeBlock(block: Block): string {
  switch (block.kind) {
    case 'line': {
      const dir = block.direction ? ` (${oneLine(block.direction).replace(/[()]/g, '')})` : '';
      return withContinuation(`@${block.speaker}${dir}:`, block.text);
    }
    case 'narration':
      return withContinuation('>', block.text);
    case 'note':
      return withContinuation('//', block.text);
    case 'heading':
      return `# ${oneLine(block.text)}`.trimEnd();
  }
}

/** Writes a story as `.story` text. `parseStory(serializeStory(s))` yields `s` again. */
export function serializeStory(story: Story): string {
  const out: string[] = ['---', `title: ${oneLine(story.title) || 'Untitled story'}`];
  if (story.characters.length > 0) {
    out.push('characters:');
    const width = Math.max(...story.characters.map((c) => c.id.length));
    for (const c of story.characters) {
      out.push(`  ${`${c.id}:`.padEnd(width + 1)} ${oneLine(c.name) || c.id}  ${c.color}`);
    }
  }
  for (const [key, value] of story.meta) out.push(`${key}: ${oneLine(value)}`);
  out.push('---', '');

  story.blocks.forEach((block, index) => {
    if (block.kind === 'heading') {
      if (index > 0 && out[out.length - 1] !== '') out.push('');
      out.push(serializeBlock(block), '');
    } else {
      out.push(serializeBlock(block));
    }
  });

  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return `${out.join('\n')}\n`;
}
