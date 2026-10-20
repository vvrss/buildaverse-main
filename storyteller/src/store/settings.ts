import { effect, signal } from '@preact/signals';
import { db } from './db';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  textSize: 'small' | 'medium' | 'large';
  /** Draw the first character's bubbles on the right, like "you" in a chat. */
  leadOnRight: boolean;
  /** Enter switches to the speaker most likely to answer. */
  autoAlternate: boolean;
  /** Enter sends the line; when off, Enter adds a line break and Ctrl+Enter sends. */
  enterSends: boolean;
  haptics: boolean;
  showNotes: boolean;
  /** Swipe right (instead of left) moves to the next character. */
  invertSwipe: boolean;
  gestureSensitivity: 'strict' | 'normal' | 'relaxed';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  textSize: 'medium',
  leadOnRight: true,
  autoAlternate: true,
  enterSends: true,
  haptics: true,
  showNotes: true,
  invertSwipe: false,
  gestureSensitivity: 'normal',
};

export const GESTURE_THRESHOLDS: Record<Settings['gestureSensitivity'], number> = {
  strict: 0.84,
  normal: 0.78,
  relaxed: 0.72,
};

const TEXT_SCALE: Record<Settings['textSize'], number> = { small: 0.92, medium: 1, large: 1.12 };

export const settings = signal<Settings>(DEFAULT_SETTINGS);
let owner: string | null = null;

export async function loadSettings(profileId: string) {
  owner = profileId;
  const saved = await db.getSetting<Partial<Settings>>(profileId, 'settings', {});
  settings.value = { ...DEFAULT_SETTINGS, ...saved };
}

export function resetSettingsView() {
  owner = null;
  settings.value = DEFAULT_SETTINGS;
}

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  if (owner) void db.setSetting(owner, 'settings', settings.value);
}

export function haptic(ms = 6) {
  if (settings.value.haptics) navigator.vibrate?.(ms);
}

// Appearance. A host page (such as an embedding viewer) may set its own
// data-theme; "system" restores that instead of removing it.
if (typeof document !== 'undefined') {
  const root = document.documentElement;
  const hostTheme = root.getAttribute('data-theme');
  effect(() => {
    const { theme, textSize } = settings.value;
    if (theme === 'system') {
      if (hostTheme) root.setAttribute('data-theme', hostTheme);
      else root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    root.style.setProperty('--scale', String(TEXT_SCALE[textSize]));
  });
}
