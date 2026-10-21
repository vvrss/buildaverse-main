/**
 * In-memory model of a story. The `.story` text format (see FORMAT.md) is the
 * persisted source of truth; these types are what the editor works with.
 * Block ids are runtime-only and never written to text.
 */

export interface Character {
  id: string;
  name: string;
  color: string;
}

export type Block =
  | { kind: 'line'; id: string; speaker: string; direction?: string; text: string }
  | { kind: 'narration'; id: string; text: string }
  | { kind: 'heading'; id: string; text: string }
  | { kind: 'note'; id: string; text: string };

export type BlockKind = Block['kind'];

export interface Story {
  title: string;
  characters: Character[];
  /** Unknown header keys, preserved so AI or hand edits are not lost. */
  meta: [string, string][];
  blocks: Block[];
}

export interface ParseIssue {
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface ParseResult {
  story: Story;
  issues: ParseIssue[];
}

export const PALETTE = [
  '#e76f51',
  '#2a9d8f',
  '#8e5bd6',
  '#e9a23b',
  '#3a86ff',
  '#d6457a',
  '#43a047',
  '#6d6875',
];

let idCounter = 0;
export function newBlockId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Characters allowed in a speaker id (letters with their marks, digits, - and _). */
export const ID_CHARS = '[\\p{L}\\p{M}\\p{N}_-]';

/**
 * Turns a display name into a speaker id usable after `@`. Latin accents are
 * dropped (é -> e) but other scripts keep their marks, and the result is NFC
 * so it matches what keyboards and AIs type (민수, ガク, सीता).
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '');
  return [...slug].slice(0, 24).join('') || 'char';
}

/** Speaker ids compare case-insensitively and regardless of Unicode normalization. */
export const idKey = (id: string) => id.normalize('NFC').toLowerCase();
export const sameId = (a: string, b: string) => idKey(a) === idKey(b);

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(Array.from(taken, idKey));
  if (!set.has(idKey(base))) return base;
  let n = 2;
  while (set.has(idKey(`${base}${n}`))) n += 1;
  return `${base}${n}`;
}

export function nextColor(characters: Character[]): string {
  const used = new Set(characters.map((c) => c.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[characters.length % PALETTE.length];
}

/** Line breaks, including the Unicode line and paragraph separators some apps paste. */
export const LINE_BREAK = /\r\n?|[\n\u2028\u2029]/;

/** Multi-line text is stored trimmed per line, without empty lines. */
export function normalizeText(text: string): string {
  return text
    .split(LINE_BREAK)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

export function emptyStory(title = 'Untitled story'): Story {
  return { title, characters: [], meta: [], blocks: [] };
}
