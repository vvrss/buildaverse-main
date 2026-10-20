/**
 * Tells other open windows of the app (an installed PWA window plus a browser
 * tab, say) about changes, so a stale window never overwrites newer writing.
 */

export type SyncMessage =
  | { type: 'story-saved'; id: string; updatedAt: number }
  | { type: 'story-deleted'; id: string }
  | { type: 'profile-changed'; id: string }
  | { type: 'profile-deleted'; id: string };

type Listener = (msg: SyncMessage) => void;

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('storyteller');
    channel.onmessage = (e: MessageEvent<SyncMessage>) => {
      for (const l of listeners) l(e.data);
    };
  }
} catch {
  channel = null;
}

export function broadcast(msg: SyncMessage) {
  try {
    channel?.postMessage(msg);
  } catch {
    // Another window simply won't hear about it; saves still detect conflicts.
  }
}

export function onBroadcast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
