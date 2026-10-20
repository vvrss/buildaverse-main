import { describe, expect, it } from 'vitest';
import { hotkeyAction, isMac } from './hotkeys';

const key = (init: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, keyCode: 0, ...init }) as KeyboardEvent;
const ctx = { draftDirty: false, suggestionsOpen: false };

describe('hotkeys (non-Mac)', () => {
  it('runs in this test environment as non-Mac', () => {
    expect(isMac).toBe(false);
  });

  it('ignores keys while an IME is composing, including Safari keyCode 229', () => {
    expect(hotkeyAction(key({ key: 'Enter', isComposing: true }), ctx)).toBeNull();
    expect(hotkeyAction(key({ key: 'Enter', keyCode: 229 }), ctx)).toBeNull();
    expect(hotkeyAction(key({ key: 'Enter' }), ctx)).toBe('line.commit');
  });

  it('leaves AltGr (Ctrl+Alt) characters alone', () => {
    // German layout: AltGr+Q types "@".
    expect(hotkeyAction(key({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }), ctx)).toBeNull();
    expect(hotkeyAction(key({ key: 'n', code: 'KeyN', altKey: true }), ctx)).toBe('voice.narration');
  });

  it('does not take Alt+key when it types a different character', () => {
    expect(hotkeyAction(key({ key: 'ñ', code: 'KeyN', altKey: true }), ctx)).toBeNull();
    expect(hotkeyAction(key({ key: '2', code: 'Digit2', altKey: true }), ctx)).toBe('voice.pick:1');
  });

  it('matches undo and redo by physical key on any layout', () => {
    // Russian layout: the Z key types "я".
    expect(hotkeyAction(key({ key: 'я', code: 'KeyZ', ctrlKey: true }), ctx)).toBe('history.undo');
    expect(hotkeyAction(key({ key: 'Я', code: 'KeyZ', ctrlKey: true, shiftKey: true }), ctx)).toBe('history.redo');
    expect(hotkeyAction(key({ key: 'н', code: 'KeyY', ctrlKey: true }), ctx)).toBe('history.redo');
  });

  it('leaves Ctrl+Z to the text box while there is typing to undo', () => {
    expect(hotkeyAction(key({ key: 'z', code: 'KeyZ', ctrlKey: true }), { ...ctx, draftDirty: true })).toBeNull();
  });

  it('with "Enter sends" off, Enter is a line break and Ctrl+Enter sends', () => {
    const off = { ...ctx, enterSends: false };
    expect(hotkeyAction(key({ key: 'Enter' }), off)).toBeNull();
    expect(hotkeyAction(key({ key: 'Enter', ctrlKey: true }), off)).toBe('line.commit');
  });
});
