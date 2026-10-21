import { effect } from '@preact/signals';
import type { Me } from '../shared/api';
import { currentProfile, patchProfile } from '../store/profile';
import { isCommunityRoute, route } from '../router';
import { profileId } from '../store/session';
import { community, del, me, patch, post, refreshMe } from './api';

/** Remembers the account on the profile, so it can be shown before the server answers. */
async function remember(m: Me | null) {
  await patchProfile((p) => {
    const { account: _old, ...rest } = p;
    return m ? { ...rest, account: { username: m.username, displayName: m.displayName } } : rest;
  });
}

export async function signIn(username: string, password: string): Promise<Me> {
  const m = await post<Me>('/auth/login', { username, password });
  me.value = m;
  await remember(m);
  return m;
}

export async function createAccount(input: { username: string; password: string; displayName: string; color: string }): Promise<Me> {
  const m = await post<Me>('/auth/register', input);
  me.value = m;
  await remember(m);
  return m;
}

export async function signOutAccount() {
  try {
    await post('/auth/logout');
  } finally {
    me.value = null;
    await remember(null);
  }
}

export async function changePassword(current: string, next: string) {
  await post('/me/password', { current, next });
}

export async function deleteAccount(password: string) {
  await del('/me', { password });
  me.value = null;
  await remember(null);
}

export async function updateAccount(change: { displayName?: string; bio?: string; color?: string }) {
  const m = await patch<Me>('/me', change);
  me.value = m;
  await remember(m);
  return m;
}

// Whenever the profile changes (or the server becomes reachable), read its account again.
let lastPid: string | null = null;
effect(() => {
  const pid = profileId.value;
  const ready = community.value === 'ready';
  if (pid !== lastPid) {
    lastPid = pid;
    me.value = undefined;
  }
  if (!pid) {
    me.value = null;
    return;
  }
  if (ready && me.value === undefined) {
    void refreshMe().then((m) => {
      // The server says signed out while the profile remembers an account: forget it.
      if (m === null && currentProfile.value?.account) void remember(null);
    });
  }
});

// Unread notifications stay fresh: on every Community page, and every minute while the app is open.
let lastRefresh = 0;
const freshen = (minGap: number) => {
  // peek(): reading the account must not make the route effect depend on it.
  if (!me.peek() || Date.now() - lastRefresh < minGap) return;
  lastRefresh = Date.now();
  void refreshMe();
};
effect(() => {
  if (isCommunityRoute(route.value)) freshen(500);
});
if (typeof document !== 'undefined') {
  setInterval(() => {
    if (document.visibilityState === 'visible') freshen(30_000);
  }, 60_000);
}
