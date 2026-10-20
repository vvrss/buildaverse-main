import { signal } from '@preact/signals';

/** Install and update state for the "App" section in Settings. */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installPrompt = signal<InstallPromptEvent | null>(null);
export const updateReady = signal(false);
let applyUpdate: (() => void) | null = null;

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.value = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt.value = null;
  });
}

export async function install(): Promise<boolean> {
  const p = installPrompt.value;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  installPrompt.value = null;
  return outcome === 'accepted';
}

export function setUpdateHandler(fn: () => void) {
  applyUpdate = fn;
  updateReady.value = true;
}

export function reloadToUpdate() {
  applyUpdate?.();
}
