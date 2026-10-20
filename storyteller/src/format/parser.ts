import {
  type Block,
  type Character,
  type ParseIssue,
  type ParseResult,
  type Story,
  ID_CHARS,
  idKey,
  newBlockId,
  nextColor,
} from './types';

const ID = `${ID_CHARS}+`;
const DIALOG = new RegExp(`^@(${ID})\\s*(?:\\(([^)]*)\\))?\\s*:\\s?(.*)$`, 'u');
const DIALOG_NO_COLON = new RegExp(`^@(${ID})\\s+(.*)$`, 'u');
const LOOSE_DIALOG = /^([\p{L}][\p{L}\p{M}\p{N} _.'-]{0,40}?)\s*(?:\(([^)]*)\))?\s*:\s+(.+)$/u;
const HEADER_KEY = new RegExp(`^(${ID})\\s*:\\s*(.*)$`, 'u');
const COLOR_TAIL = /^(.*?)\s*(#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8}))?$/i;

/**
 * Parses `.story` text. Never throws: anything odd is reported as an issue
 * with a 1-based line number, and the best reading of the line is kept so
 * pasted AI output is never silently dropped.
 */
export function parseStory(source: string): ParseResult {
  const lines = source
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/^\ufeff/, '')
    .split('\n');
  const issues: ParseIssue[] = [];
  const story: Story = { title: 'Untitled story', characters: [], meta: [], blocks: [] };

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && lines[i].trim() === '---') {
    i = parseHeader(lines, i, story, issues);
  }

  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const c of story.characters) {
    byId.set(idKey(c.id), c.id);
    byName.set(idKey(c.name), c.id);
  }

  const resolveSpeaker = (raw: string, lineNo: number): string => {
    const known = byId.get(idKey(raw)) ?? byName.get(idKey(raw));
    if (known) return known;
    const id = raw.normalize('NFC');
    const character: Character = { id, name: id, color: nextColor(story.characters) };
    story.characters.push(character);
    byId.set(idKey(id), id);
    issues.push({
      line: lineNo,
      severity: 'warning',
      message: `Unknown character @${raw}. It was added to the cast.`,
    });
    return id;
  };

  let last: Block | null = null;
  let prevBlank = true;

  for (; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const lineNo = i + 1;
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      prevBlank = true;
      continue;
    }

    if (/^\s/.test(rawLine) && last && !prevBlank && last.kind !== 'heading') {
      last.text = last.text ? `${last.text}\n${trimmed}` : trimmed;
      continue;
    }
    prevBlank = false;

    const block = parseBodyLine(trimmed, lineNo, issues, resolveSpeaker, byId, byName);
    story.blocks.push(block);
    last = block;
  }

  return { story, issues };
}

function parseBodyLine(
  line: string,
  lineNo: number,
  issues: ParseIssue[],
  resolveSpeaker: (raw: string, lineNo: number) => string,
  byId: Map<string, string>,
  byName: Map<string, string>,
): Block {
  const id = newBlockId();

  if (line.startsWith('//')) return { kind: 'note', id, text: line.slice(2).trim() };
  if (line.startsWith('>')) return { kind: 'narration', id, text: line.slice(1).trim() };
  if (line.startsWith('#')) return { kind: 'heading', id, text: line.replace(/^#+/, '').trim() };

  if (line.startsWith('@')) {
    const m = DIALOG.exec(line);
    if (m) {
      return dialog(id, resolveSpeaker(m[1], lineNo), m[2], m[3]);
    }
    const loose = DIALOG_NO_COLON.exec(line);
    if (loose) {
      issues.push({ line: lineNo, severity: 'warning', message: `Missing ":" after @${loose[1]}.` });
      return dialog(id, resolveSpeaker(loose[1], lineNo), undefined, loose[2]);
    }
  }

  // AI output often drops the "@": accept "Ana: text" when Ana is in the cast.
  const loose = LOOSE_DIALOG.exec(line);
  if (loose) {
    const key = idKey(loose[1].trim());
    const speaker = byId.get(key) ?? byName.get(key);
    if (speaker) {
      issues.push({
        line: lineNo,
        severity: 'warning',
        message: `Missing "@" before ${loose[1].trim()}. Read as @${speaker}.`,
      });
      return dialog(id, speaker, loose[2], loose[3]);
    }
  }

  issues.push({
    line: lineNo,
    severity: 'warning',
    message: 'Line has no marker (@, >, #, //). It was read as narration.',
  });
  return { kind: 'narration', id, text: line };
}

function dialog(id: string, speaker: string, direction: string | undefined, text: string): Block {
  const dir = direction?.trim();
  return dir
    ? { kind: 'line', id, speaker, direction: dir, text: text.trim() }
    : { kind: 'line', id, speaker, text: text.trim() };
}

/** Parses the `--- ... ---` header starting at `start`; returns the index after it. */
function parseHeader(lines: string[], start: number, story: Story, issues: ParseIssue[]): number {
  let end = -1;
  for (let j = start + 1; j < lines.length; j += 1) {
    if (lines[j].trim() === '---') {
      end = j;
      break;
    }
  }
  if (end === -1) {
    issues.push({
      line: start + 1,
      severity: 'error',
      message: 'Header starts with "---" but is never closed with another "---".',
    });
    // Best effort: the header runs until the first blank or body-looking line.
    end = start + 1;
    while (end < lines.length && lines[end].trim() !== '' && !/^\s*(@|>|#|\/\/)/.test(lines[end])) {
      end += 1;
    }
    readHeaderLines(lines, start + 1, end, story, issues);
    return end;
  }
  readHeaderLines(lines, start + 1, end, story, issues);
  return end + 1;
}

function readHeaderLines(
  lines: string[],
  from: number,
  to: number,
  story: Story,
  issues: ParseIssue[],
): void {
  let inCharacters = false;
  const seen = new Set<string>();

  for (let j = from; j < to; j += 1) {
    const raw = lines[j];
    if (raw.trim() === '') continue;
    const indented = /^\s/.test(raw);
    const text = raw.trim().replace(/^-\s+/, '');

    if (inCharacters && (indented || raw.trim().startsWith('-'))) {
      const m = HEADER_KEY.exec(text);
      if (!m) {
        issues.push({ line: j + 1, severity: 'warning', message: 'Expected "id: Name #color".' });
        continue;
      }
      const id = m[1];
      if (seen.has(idKey(id))) {
        issues.push({ line: j + 1, severity: 'warning', message: `Character @${id} is listed twice.` });
        continue;
      }
      seen.add(idKey(id));
      const [, name, color] = COLOR_TAIL.exec(m[2].trim()) ?? [];
      story.characters.push({
        id,
        name: name?.trim() || id,
        color: color?.toLowerCase() ?? nextColor(story.characters),
      });
      continue;
    }

    inCharacters = false;
    const m = HEADER_KEY.exec(text);
    if (!m) {
      issues.push({ line: j + 1, severity: 'warning', message: 'Header lines look like "key: value".' });
      continue;
    }
    const key = m[1].toLowerCase();
    if (key === 'title') story.title = m[2].trim() || story.title;
    else if (key === 'characters' || key === 'cast') inCharacters = true;
    else story.meta.push([m[1], m[2].trim()]);
  }
}
