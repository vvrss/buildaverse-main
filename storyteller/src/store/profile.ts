import { batch, computed, signal } from '@preact/signals';
import { PALETTE } from '../format/types';
import { loadGestures, resetGestures } from '../gestures/store';
import { go } from '../router';
import { type ProfileRecord, db } from './db';
import { checkPin, makePin } from './pin';
import { profileId } from './session';
import { loadSettings, previewAppearance, resetSettingsView } from './settings';
import { deleteProfilePictures } from '../images/media';
import { post } from '../community/api';
import { collectUnusedPictures, releasePictureUrls } from '../images/pictures';
import { closeStory, forgetLocalCopies, recoverJournals, resetEditor, showToast } from './storyStore';
import { broadcast, onBroadcast } from './sync';
import { gesturePadOpen } from './ui';

/**
 * Profiles are the app's accounts on this device. A backup file moves one
 * to another device; a community account can be linked for publishing.
 */

export const profiles = signal<ProfileRecord[]>([]);
export const currentProfile = signal<ProfileRecord | null>(null);
/** A profile that was picked but still needs its PIN. */
export const lockedProfile = signal<ProfileRecord | null>(null);
export const profilesReady = signal(false);
/** Set by "Add a profile" so the picker opens straight on the new-profile form. */
export const startAddingProfile = signal(false);

export const hasProfiles = computed(() => profiles.value.length > 0);

export const PROFILE_COLORS = PALETTE;

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function refresh() {
  profiles.value = await db.listProfiles();
}

/**
 * Writes a change to the stored profile. The record is always re-read
 * first, so a window holding an old copy can never undo a PIN set elsewhere.
 */
async function writeProfile(id: string, change: (p: ProfileRecord) => ProfileRecord): Promise<ProfileRecord | null> {
  const fresh = await db.getProfile(id);
  if (!fresh) return null;
  const updated = change(fresh);
  await db.putProfile(updated);
  if (currentProfile.value?.id === id) currentProfile.value = updated;
  broadcast({ type: 'profile-changed', id });
  await refresh();
  return updated;
}

async function activate(p: ProfileRecord) {
  const updated = (await writeProfile(p.id, (fresh) => ({ ...fresh, lastUsedAt: Date.now() }))) ?? p;
  await db.setGlobal('lastProfile', p.id);
  await db.setGlobal('signedOut', false);
  await Promise.all([loadSettings(p.id), loadGestures(p.id), recoverJournals(p.id)]);
  // After journals are applied, so a recovered story keeps its pictures.
  void collectUnusedPictures(p.id).catch(() => {});
  batch(() => {
    profileId.value = p.id;
    currentProfile.value = updated;
    lockedProfile.value = null;
  });
}

/** On app start: resume the last profile, or ask for its PIN. */
export async function initProfiles() {
  await refresh();
  const lastId = await db.getGlobal<string | null>('lastProfile', null);
  const last = profiles.value.find((p) => p.id === lastId) ?? (profiles.value.length === 1 ? profiles.value[0] : undefined);
  const signedOut = await db.getGlobal<boolean>('signedOut', false);
  if (last) await previewAppearance(last.id);
  if (last && !signedOut) {
    if (last.pin) lockedProfile.value = last;
    else await activate(last);
  }
  profilesReady.value = true;
}

export async function createProfile(input: { name: string; color: string; pin?: string }) {
  const first = profiles.value.length === 0;
  const now = Date.now();
  const record: ProfileRecord = {
    id: newId(),
    name: input.name.trim() || 'Writer',
    color: input.color,
    pin: input.pin ? await makePin(input.pin) : undefined,
    createdAt: now,
    lastUsedAt: now,
  };
  await db.putProfile(record);
  if (first) await db.claimOrphans(record.id);
  startAddingProfile.value = false;
  await activate(record);
  return record;
}

/** Picks a profile from the "Who's writing?" screen. */
export async function chooseProfile(p: ProfileRecord) {
  // The tile may be stale: decide on the lock from the stored record.
  const fresh = (await db.getProfile(p.id)) ?? p;
  await previewAppearance(fresh.id);
  if (fresh.pin) lockedProfile.value = fresh;
  else await activate(fresh);
}

// ------------------------------------------------------------ PIN lockout

const MAX_TRIES = 5;
const BLOCK_MS = 30_000;

interface Lockout {
  failures: number;
  until: number;
}

/** Wrong-PIN counting, stored per profile so a reload does not reset it. */
async function checkWithLockout(p: ProfileRecord, pin: string): Promise<string | null> {
  if (!p.pin) return null;
  const key = `pinLock:${p.id}`;
  const state = await db.getGlobal<Lockout>(key, { failures: 0, until: 0 });
  if (Date.now() < state.until) {
    return `Too many tries. Wait ${Math.ceil((state.until - Date.now()) / 1000)} seconds.`;
  }
  if (await checkPin(pin, p.pin)) {
    if (state.failures) await db.setGlobal(key, { failures: 0, until: 0 });
    return null;
  }
  const failures = state.failures + 1;
  if (failures >= MAX_TRIES) {
    await db.setGlobal(key, { failures: 0, until: Date.now() + BLOCK_MS });
    return `Wrong PIN ${MAX_TRIES} times. Wait 30 seconds.`;
  }
  await db.setGlobal(key, { failures, until: 0 });
  return 'Wrong PIN. Try again.';
}

/** Returns an error message, or null when unlocked. */
export async function unlock(pin: string): Promise<string | null> {
  const locked = lockedProfile.value;
  if (!locked) return null;
  const fresh = (await db.getProfile(locked.id)) ?? locked;
  const error = await checkWithLockout(fresh, pin);
  if (error) return error;
  await activate(fresh);
  return null;
}

/** Checks the signed-in profile's PIN before changing or removing it. */
export async function verifyCurrentPin(pin: string): Promise<string | null> {
  const p = currentProfile.value;
  if (!p) return 'Not signed in.';
  const fresh = (await db.getProfile(p.id)) ?? p;
  return checkWithLockout(fresh, pin);
}

// ------------------------------------------------------------- leaving

async function leave({ discard = false } = {}) {
  gesturePadOpen.value = false;
  // Saves and clears the editor, so nothing from this profile shows in the next.
  // A profile deleted elsewhere has nothing left to save into.
  if (discard) resetEditor();
  else await closeStory();
  // The next profile starts on its own home screen, not on this one's last page.
  go('/', true);
  batch(() => {
    profileId.value = null;
    currentProfile.value = null;
  });
  resetSettingsView();
  resetGestures();
  releasePictureUrls();
}

/** Locks the current profile; its PIN is needed to come back. */
export async function lockNow() {
  const p = currentProfile.value;
  if (!p?.pin) return;
  await leave();
  await previewAppearance(p.id);
  lockedProfile.value = p;
}

/** Back to the "Who's writing?" screen. */
export async function signOut(opts: { addProfile?: boolean } = {}) {
  // Set before leaving, so the picker opens straight on the form.
  startAddingProfile.value = !!opts.addProfile;
  await leave();
  lockedProfile.value = null;
  await db.setGlobal('signedOut', true);
}

export function cancelUnlock() {
  lockedProfile.value = null;
}

export async function updateProfile(patch: Partial<Pick<ProfileRecord, 'name' | 'color'>>) {
  const p = currentProfile.value;
  if (!p) return;
  currentProfile.value = { ...p, ...patch };
  await writeProfile(p.id, (fresh) => ({ ...fresh, ...patch }));
}

export async function setPin(pin: string | null) {
  const p = currentProfile.value;
  if (!p) return;
  const next = pin ? await makePin(pin) : undefined;
  await writeProfile(p.id, (fresh) => ({ ...fresh, pin: next }));
}

/** Merges extra fields (such as the linked community account) into the profile. */
export async function patchProfile(change: (p: ProfileRecord) => ProfileRecord) {
  const p = currentProfile.value;
  if (!p) return null;
  return writeProfile(p.id, change);
}

/** Deletes the signed-in profile and all of its stories, gestures and settings. */
export async function deleteCurrentProfile() {
  const p = currentProfile.value;
  if (!p) return;
  const storyIds = (await db.listStories(p.id)).map((s) => s.id);
  // A linked Community account stays, but this device's session for it ends.
  if (p.account) await post('/auth/logout').catch(() => {});
  await leave();
  await db.deleteProfile(p.id);
  forgetLocalCopies(p.id, storyIds);
  await deleteProfilePictures(p.id).catch(() => {});
  await db.setGlobal(`pinLock:${p.id}`, { failures: 0, until: 0 });
  broadcast({ type: 'profile-deleted', id: p.id });
  await refresh();
  await db.setGlobal('signedOut', true);
}

// Other windows: keep the profile list, PIN and name in step.
onBroadcast((msg) => {
  if (msg.type === 'profile-changed') {
    void (async () => {
      await refresh();
      const cur = currentProfile.value;
      if (cur?.id === msg.id) {
        const fresh = await db.getProfile(msg.id);
        if (fresh) currentProfile.value = fresh;
      }
      const locked = lockedProfile.value;
      if (locked?.id === msg.id) {
        const fresh = await db.getProfile(msg.id);
        lockedProfile.value = fresh?.pin ? fresh : null;
        if (fresh && !fresh.pin) await activate(fresh);
      }
    })();
  } else if (msg.type === 'profile-deleted') {
    void (async () => {
      if (currentProfile.value?.id === msg.id || lockedProfile.value?.id === msg.id) {
        await leave({ discard: true });
        lockedProfile.value = null;
        showToast('This profile was deleted in another window.');
      }
      forgetLocalCopies(msg.id);
      await refresh();
    })();
  }
});
