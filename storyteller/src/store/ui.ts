import { signal } from '@preact/signals';

export const gesturePadOpen = signal(false);

/** The composer textarea, so shortcuts can keep the keyboard up. */
export const composerRef: { current: HTMLTextAreaElement | null } = { current: null };

export function focusComposer() {
  const el = composerRef.current;
  if (el && document.activeElement !== el) el.focus({ preventScroll: true });
}
