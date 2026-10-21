import { signal } from '@preact/signals';

export type Tab = 'chat' | 'text' | 'cast' | 'ai' | 'read';
export type CommunityTab = 'discover' | 'following' | 'reading';
export type Route =
  | { name: 'library' }
  | { name: 'story'; id: string; tab: Tab }
  | { name: 'publish'; id: string }
  | { name: 'shortcuts' }
  | { name: 'settings' }
  | { name: 'account' }
  | { name: 'community'; tab: CommunityTab; q: string; genre: string; tag: string; sort: 'recent' | 'popular' }
  | { name: 'c-story'; id: string }
  | { name: 'c-episode'; id: string; comment: number | null }
  | { name: 'c-user'; username: string }
  | { name: 'c-notifications' }
  | { name: 'c-mod' };

const TABS: Tab[] = ['chat', 'text', 'cast', 'ai', 'read'];
const COMMUNITY_TABS: CommunityTab[] = ['discover', 'following', 'reading'];

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  const q = new URLSearchParams(query);
  if (parts[0] === 's' && parts[1]) {
    if (parts[2] === 'publish') return { name: 'publish', id: parts[1] };
    const tab = TABS.includes(parts[2] as Tab) ? (parts[2] as Tab) : 'chat';
    return { name: 'story', id: parts[1], tab };
  }
  if (parts[0] === 'c') {
    if (parts[1] === 's' && parts[2]) return { name: 'c-story', id: parts[2] };
    if (parts[1] === 'e' && parts[2]) return { name: 'c-episode', id: parts[2], comment: Number(q.get('comment')) || null };
    if (parts[1] === 'u' && parts[2]) return { name: 'c-user', username: parts[2].toLowerCase() };
    if (parts[1] === 'notifications') return { name: 'c-notifications' };
    if (parts[1] === 'mod') return { name: 'c-mod' };
    const tab = COMMUNITY_TABS.includes(parts[1] as CommunityTab) ? (parts[1] as CommunityTab) : 'discover';
    return {
      name: 'community',
      tab,
      q: q.get('q') ?? '',
      genre: q.get('genre') ?? '',
      tag: q.get('tag') ?? '',
      sort: q.get('sort') === 'popular' ? 'popular' : 'recent',
    };
  }
  if (parts[0] === 'shortcuts') return { name: 'shortcuts' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'account') return { name: 'account' };
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

/** Community pages. */
export const cPath = {
  home: (tab: CommunityTab = 'discover', params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return `/c${tab === 'discover' ? '' : `/${tab}`}${qs ? `?${qs}` : ''}`;
  },
  story: (id: string) => `/c/s/${encodeURIComponent(id)}`,
  episode: (id: string, comment?: number) => `/c/e/${encodeURIComponent(id)}${comment ? `?comment=${comment}` : ''}`,
  user: (username: string) => `/c/u/${encodeURIComponent(username)}`,
  notifications: () => '/c/notifications',
  mod: () => '/c/mod',
};

export const isCommunityRoute = (r: Route) => r.name === 'community' || r.name.startsWith('c-');

/** The address to share: the server's link-preview page, which sends people on to the app. */
export const shareUrl = (kind: 's' | 'e', id: string) => `${location.origin}/${kind}/${encodeURIComponent(id)}`;

/** Whether this tab has moved between app pages, so Back can go back instead of leaving the app. */
let steps = 0;
window.addEventListener('hashchange', () => {
  steps += 1;
});

export function goBack(fallback: string) {
  if (steps > 0) history.back();
  else go(fallback, true);
}
