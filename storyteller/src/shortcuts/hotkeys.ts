/**
 * Desktop hotkeys for the composer. Returns the action id for a key event,
 * or null to let the browser handle it.
 *
 * Keyboards differ, so the rules are careful:
 *  - On a Mac, Option types characters (@, #, accents, whole letters on some
 *    layouts), so Option alone is never a shortcut there; Control+Option is.
 *  - Elsewhere, AltGr arrives as Ctrl+Alt and also types characters, so the
 *    Alt shortcuts require Alt without Ctrl, and only when the key is the
 *    plain letter or digit.
 *  - Undo and redo match the physical key (e.code), so they also work on
 *    Cyrillic, Greek or Hebrew layouts.
 *  - Nothing fires while an input method (IME) is composing text.
 */

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** True while an IME is composing; Safari reports the confirming Enter as keyCode 229. */
export const isComposing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;

/** The plain character for a physical key ("KeyN" -> "n", "Digit3" -> "3"). */
function codeChar(code: string): string | null {
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code);
  return m ? (m[1] ?? m[2]).toLowerCase() : null;
}

/** Whether the "Alt" shortcut modifier is held for this platform. */
function altShortcut(e: KeyboardEvent): boolean {
  if (e.metaKey) return false;
  if (isMac) return e.altKey && e.ctrlKey;
  if (!e.altKey || e.ctrlKey) return false;
  // Alt+key that types a different character is text, not a shortcut.
  const base = codeChar(e.code);
  return e.key.length !== 1 || base === null || e.key.toLowerCase() === base;
}

export interface HotkeyContext {
  /** True while the textarea has typing that native undo can take back. */
  draftDirty: boolean;
  suggestionsOpen: boolean;
  enterSends?: boolean;
}

export function hotkeyAction(e: KeyboardEvent, ctx: HotkeyContext): string | null {
  if (isComposing(e)) return null;
  const { draftDirty, suggestionsOpen, enterSends = true } = ctx;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;

  if (e.key === 'Enter') {
    if (suggestionsOpen && !e.shiftKey) return null;
    // With "Enter sends" off, Enter is a line break and Ctrl/Cmd+Enter sends.
    if (!enterSends) return mod ? (e.shiftKey ? 'line.commitSame' : 'line.commit') : null;
    if (altShortcut(e) || (e.altKey && !e.ctrlKey && !e.metaKey)) return 'line.insertBelow';
    return e.shiftKey ? 'line.commitSame' : 'line.commit';
  }
  if (e.key === 'Tab' && !mod && !e.altKey && !e.ctrlKey && !suggestionsOpen) {
    return e.shiftKey ? 'voice.prev' : 'voice.next';
  }
  if (e.key === 'Escape') return 'nav.end';

  if (mod && !e.altKey) {
    if (e.key === 'ArrowUp') return 'nav.prev';
    if (e.key === 'ArrowDown') return 'nav.next';
    const z = e.code === 'KeyZ' || e.key.toLowerCase() === 'z';
    const y = e.code === 'KeyY' || e.key.toLowerCase() === 'y';
    if (z && !draftDirty) return e.shiftKey ? 'history.redo' : 'history.undo';
    if (y && !draftDirty && !isMac) return 'history.redo';
    if (e.key === 'Backspace' && e.shiftKey) return 'line.delete';
  }

  if (altShortcut(e)) {
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) return `voice.pick:${Number(digit[1]) - 1}`;
    if (e.code === 'KeyN') return 'voice.narration';
    if (e.code === 'KeyH') return 'voice.heading';
    if (e.code === 'KeyC') return 'voice.note';
    if (e.code === 'KeyP') return 'block.picture';
    if (e.code === 'KeyG') return 'pad.toggle';
    if (e.key === 'ArrowUp') return 'line.moveUp';
    if (e.key === 'ArrowDown') return 'line.moveDown';
  }
  return null;
}

const ALT = isMac ? '⌃⌥' : 'Alt+';
const MOD = isMac ? '⌘' : 'Ctrl+';

export const HOTKEY_HELP: [string, string][] = [
  ['Enter', 'Send line, switch to the next speaker'],
  ['Shift+Enter', 'Send line, keep the same speaker'],
  [isMac ? '⌥Enter' : 'Alt+Enter', 'Insert a new line below the one being edited'],
  ['Tab / Shift+Tab', 'Next / previous character (after Esc, Tab leaves the text box)'],
  [`${ALT}1…9`, 'Pick character by number'],
  [`${ALT}N / ${ALT}H / ${ALT}C`, 'Narration / heading / note'],
  [`${ALT}P`, 'Add a picture'],
  [`${MOD}↑ / ${MOD}↓`, 'Previous / next line'],
  [`${ALT}↑ / ${ALT}↓`, 'Move the edited line'],
  [`${MOD}Z / ${MOD}Shift+Z`, 'Undo your typing, then story changes / redo'],
  [`${MOD}Shift+Backspace`, 'Delete the edited line'],
  ['Esc', 'Stop editing, jump to the end'],
  [`${ALT}G`, 'Gesture pad'],
];
