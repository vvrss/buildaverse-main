/**
 * Desktop hotkeys for the composer. Returns the action id for a key event,
 * or null to let the browser handle it. `draftDirty` keeps Ctrl+Z as native
 * text undo while there is unsent typing.
 */
export function hotkeyAction(
  e: KeyboardEvent,
  draftDirty: boolean,
  suggestionsOpen: boolean,
  enterSends = true,
): string | null {
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Enter' && !e.isComposing) {
    if (suggestionsOpen && !e.shiftKey) return null;
    // With "Enter sends" off, Enter is a line break and Ctrl/Cmd+Enter sends.
    if (!enterSends) return mod ? (e.shiftKey ? 'line.commitSame' : 'line.commit') : null;
    if (e.altKey) return 'line.insertBelow';
    return e.shiftKey ? 'line.commitSame' : 'line.commit';
  }
  if (e.key === 'Tab' && !mod && !e.altKey && !suggestionsOpen) return e.shiftKey ? 'voice.prev' : 'voice.next';
  if (e.key === 'Escape') return 'nav.end';

  if (mod && !e.altKey) {
    if (e.key === 'ArrowUp') return 'nav.prev';
    if (e.key === 'ArrowDown') return 'nav.next';
    const k = e.key.toLowerCase();
    if (k === 'z' && !draftDirty) return e.shiftKey ? 'history.redo' : 'history.undo';
    if (k === 'y' && !draftDirty) return 'history.redo';
    if (k === 'backspace' && e.shiftKey) return 'line.delete';
  }

  if (e.altKey && !mod) {
    // e.code, because Alt+digit types symbols on macOS.
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) return `voice.pick:${Number(digit[1]) - 1}`;
    if (e.code === 'KeyN') return 'voice.narration';
    if (e.code === 'KeyH') return 'voice.heading';
    if (e.code === 'KeyC') return 'voice.note';
    if (e.code === 'KeyG') return 'pad.toggle';
    if (e.key === 'ArrowUp') return 'line.moveUp';
    if (e.key === 'ArrowDown') return 'line.moveDown';
  }
  return null;
}

export const HOTKEY_HELP: [string, string][] = [
  ['Enter', 'Send line, switch to the next speaker'],
  ['Shift+Enter', 'Send line, keep the same speaker'],
  ['Alt+Enter', 'Insert a new line below the one being edited'],
  ['Tab / Shift+Tab', 'Next / previous character'],
  ['Alt+1…9', 'Pick character by number'],
  ['Alt+N / Alt+H / Alt+C', 'Narration / heading / note'],
  ['Ctrl+↑ / Ctrl+↓', 'Previous / next line'],
  ['Alt+↑ / Alt+↓', 'Move the edited line'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+Shift+Backspace', 'Delete the edited line'],
  ['Esc', 'Stop editing, jump to the end'],
  ['Alt+G', 'Gesture pad'],
];
