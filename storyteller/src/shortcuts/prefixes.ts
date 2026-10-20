import { type Character, idKey } from '../format/types';

/**
 * Typed shortcuts in the composer. `@` opens character suggestions,
 * `/word` runs a command. Prefixes like `>` and `#` are handled when the
 * line is sent (see `compose`).
 */

export const COMMANDS: { cmd: string; action: string; help: string }[] = [
  { cmd: 'u', action: 'history.undo', help: 'undo' },
  { cmd: 'r', action: 'history.redo', help: 'redo' },
  { cmd: 'n', action: 'voice.narration', help: 'narration' },
  { cmd: 'h', action: 'voice.heading', help: 'heading' },
  { cmd: 'c', action: 'voice.note', help: 'note' },
  { cmd: 'b', action: 'nav.prev', help: 'back one line' },
  { cmd: 'f', action: 'nav.next', help: 'forward one line' },
  { cmd: 'e', action: 'nav.end', help: 'jump to end' },
  { cmd: 'd', action: 'line.delete', help: 'delete edited line' },
  { cmd: 'g', action: 'pad.toggle', help: 'gesture pad' },
];

export type PrefixState =
  | { type: 'none' }
  | { type: 'mention'; query: string; matches: Character[] }
  | { type: 'command'; query: string; matches: typeof COMMANDS }
  /** A complete command followed by a space: run it now. */
  | { type: 'run'; action: string }
  /** `@name ` typed for a known character: switch to it and strip the prefix. */
  | { type: 'switch'; speaker: string; rest: string };

export function readPrefix(draft: string, characters: Character[]): PrefixState {
  const mention = /^@([\p{L}\p{M}\p{N}_-]*)$/u.exec(draft);
  if (mention) {
    const q = idKey(mention[1]);
    const matches = characters
      .filter((c) => idKey(c.id).startsWith(q) || idKey(c.name).startsWith(q))
      // An exact id or name match comes first, so Enter picks it.
      .sort((a, b) => Number(idKey(b.id) === q || idKey(b.name) === q) - Number(idKey(a.id) === q || idKey(a.name) === q));
    return { type: 'mention', query: mention[1], matches };
  }

  // "@name " switches only on an exact id or name. Anything else stays text,
  // so sending it creates that character (e.g. "Al" next to an existing "Alice").
  const switchTo = /^@([\p{L}\p{M}\p{N}_-]+)[\s:]\s*(.*)$/su.exec(draft);
  if (switchTo) {
    const q = idKey(switchTo[1]);
    const target = characters.find((c) => idKey(c.id) === q) ?? characters.find((c) => idKey(c.name) === q);
    if (target) return { type: 'switch', speaker: target.id, rest: switchTo[2] };
    return { type: 'none' };
  }

  const command = /^\/(\w*)(\s?)$/.exec(draft);
  if (command) {
    const found = COMMANDS.find((c) => c.cmd === command[1]);
    if (found && command[2]) return { type: 'run', action: found.action };
    return { type: 'command', query: command[1], matches: COMMANDS.filter((c) => c.cmd.startsWith(command[1])) };
  }

  return { type: 'none' };
}
