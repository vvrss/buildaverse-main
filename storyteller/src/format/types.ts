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

/** Turns a display name into a speaker id usable after `@`. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .slice(0, 24);
  return slug || 'char';
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(Array.from(taken, (t) => t.toLowerCase()));
  if (!set.has(base.toLowerCase())) return base;
  let n = 2;
  while (set.has(`${base}${n}`.toLowerCase())) n += 1;
  return `${base}${n}`;
}

export function nextColor(characters: Character[]): string {
  const used = new Set(characters.map((c) => c.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[characters.length % PALETTE.length];
}

/** Multi-line text is stored trimmed per line, without empty lines. */
export function normalizeText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

export function emptyStory(title = 'Untitled story'): Story {
  return { title, characters: [], meta: [], blocks: [] };
}
