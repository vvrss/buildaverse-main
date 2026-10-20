import { signal } from '@preact/signals';

export type Tab = 'chat' | 'text' | 'cast' | 'ai';
export type Route =
  | { name: 'library' }
  | { name: 'story'; id: string; tab: Tab }
  | { name: 'shortcuts' };

const TABS: Tab[] = ['chat', 'text', 'cast', 'ai'];

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 's' && parts[1]) {
    const tab = TABS.includes(parts[2] as Tab) ? (parts[2] as Tab) : 'chat';
    return { name: 'story', id: decodeURIComponent(parts[1]), tab };
  }
  if (parts[0] === 'shortcuts') return { name: 'shortcuts' };
  return { name: 'library' };
}

export const route = signal<Route>(parse(location.hash));
window.addEventListener('hashchange', () => {
  route.value = parse(location.hash);
});

export function go(path: string, replace = false) {
  const hash = `#${path}`;
  if (replace) {
    history.replaceState(null, '', hash);
    route.value = parse(hash);
  } else {
    location.hash = hash;
  }
}

export const storyPath = (id: string, tab: Tab = 'chat') =>
  `/s/${encodeURIComponent(id)}${tab === 'chat' ? '' : `/${tab}`}`;
