import type { Block, Story } from '../format/types';

/**
 * Readable exports: a Markdown script for sharing and pasting into documents,
 * and a print-ready HTML page laid out like a play script.
 */

export interface ScriptOptions {
  notes?: boolean;
}

const names = (story: Story) => new Map(story.characters.map((c) => [c.id, c.name]));

/** Escapes Markdown syntax inside user text, so it reads exactly as written. */
export function mdEscape(text: string): string {
  return text.replace(/[\\`*_[\]<>|~]/g, '\\$&');
}

/** Escapes one line, including markers that only mean something at the start of a line. */
function mdLine(line: string): string {
  return mdEscape(line).replace(/^(\s*)([#>+=-]|\d+[.)])/, '$1\\$2');
}

const mdText = (text: string) => text.split('\n').map(mdLine).join('  \n');

export function toScript(story: Story, { notes = false }: ScriptOptions = {}): string {
  const who = names(story);
  const cast = story.characters.map((c) => mdEscape(c.name)).join(', ');
  const out: string[] = [`# ${mdEscape(story.title)}`, ''];
  if (cast) out.push(`*Cast: ${cast}*`, '');

  for (const b of story.blocks) {
    const text = mdText(b.text);
    switch (b.kind) {
      case 'heading':
        out.push('', `## ${mdEscape(b.text)}`, '');
        break;
      case 'narration':
        out.push(`*${text}*`, '');
        break;
      case 'note':
        if (notes) out.push(`> Note: ${text}`, '');
        break;
      case 'line': {
        const name = mdEscape((who.get(b.speaker) ?? b.speaker).toUpperCase());
        const dir = b.direction ? ` *(${mdEscape(b.direction)})*` : '';
        out.push(`**${name}**${dir}: ${text}`, '');
      }
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const paragraphs = (text: string) => text.split('\n').map(esc).join('<br>');

function blockHtml(b: Block, who: Map<string, string>, notes: boolean): string {
  switch (b.kind) {
    case 'heading':
      return `<h2>${esc(b.text)}</h2>`;
    case 'narration':
      return `<p class="action">${paragraphs(b.text)}</p>`;
    case 'note':
      return notes ? `<p class="note">${paragraphs(b.text)}</p>` : '';
    case 'line': {
      const name = esc((who.get(b.speaker) ?? b.speaker).toUpperCase());
      const dir = b.direction ? `<div class="paren">(${esc(b.direction)})</div>` : '';
      return `<div class="cue"><div class="name">${name}</div>${dir}<p>${paragraphs(b.text)}</p></div>`;
    }
  }
}

/** A standalone HTML document, styled for paper (A4 or Letter). */
export function toPrintableHtml(story: Story, { notes = false }: ScriptOptions = {}): string {
  const who = names(story);
  const cast = story.characters.map((c) => `<li>${esc(c.name)}</li>`).join('');
  const body = story.blocks.map((b) => blockHtml(b, who, notes)).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(story.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { margin: 22mm 20mm; }
  body { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1.45; color: #111; background: #fff; max-width: 42em; margin: 2em auto; padding: 0 1em; }
  .title { text-align: center; padding: 18vh 0 10vh; page-break-after: always; }
  .title h1 { font-size: 22pt; margin: 0 0 1.5em; text-transform: uppercase; letter-spacing: .06em; }
  .title ul { list-style: none; padding: 0; margin: 0; }
  .title li { margin: .2em 0; }
  .title small { display: block; margin-top: 3em; color: #555; }
  h2 { font-size: 12pt; text-transform: uppercase; margin: 2.2em 0 1em; break-after: avoid; }
  .action { margin: 0 0 1em; }
  .cue { margin: 0 0 1em; break-inside: avoid; }
  .name { margin-left: 16em; }
  .paren { margin-left: 12em; }
  .cue p { margin: 0 6em 0 8em; }
  .note { border-left: 2px solid #999; padding-left: .8em; color: #555; font-style: italic; }
  @media (max-width: 600px) { .name { margin-left: 30%; } .paren { margin-left: 22%; } .cue p { margin: 0 4% 0 12%; } }
</style></head>
<body>
<section class="title"><h1>${esc(story.title)}</h1>${cast ? `<ul>${cast}</ul>` : ''}<small>Written with Storyteller</small></section>
${body}
</body></html>
`;
}
