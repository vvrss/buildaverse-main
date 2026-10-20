import { batch, computed, signal } from '@preact/signals';
import { PALETTE } from '../format/types';
import { go } from '../router';
import { loadGestures, resetGestures } from '../gestures/store';
import { type ProfileRecord, db } from './db';
import { checkPin, makePin } from './pin';
import { profileId } from './session';
import { loadSettings, resetSettingsView } from './settings';
import { closeStory } from './storyStore';

/**
 * Profiles are the app's accounts. They live on this device only; a backup
 * file moves one to another device.
 */

export const profiles = signal<ProfileRecord[]>([]);
export const currentProfile = signal<ProfileRecord | null>(null);
/** A profile that was picked but still needs its PIN. */
export const lockedProfile = signal<ProfileRecord | null>(null);
export const profilesReady = signal(false);

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

async function activate(p: ProfileRecord) {
  const updated = { ...p, lastUsedAt: Date.now() };
  await db.putProfile(updated);
  await db.setGlobal('lastProfile', p.id);
  await Promise.all([loadSettings(p.id), loadGestures(p.id)]);
  batch(() => {
    profileId.value = p.id;
    currentProfile.value = updated;
    lockedProfile.value = null;
  });
  await refresh();
}

/** On app start: resume the last profile, or ask for its PIN. */
export async function initProfiles() {
  await refresh();
  const lastId = await db.getGlobal<string | null>('lastProfile', null);
  const last = profiles.value.find((p) => p.id === lastId) ?? (profiles.value.length === 1 ? profiles.value[0] : undefined);
  const signedOut = await db.getGlobal<boolean>('signedOut', false);
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
  await db.setGlobal('signedOut', false);
  await activate(record);
  return record;
}

/** Picks a profile from the "Who's writing?" screen. */
export async function chooseProfile(p: ProfileRecord) {
  await db.setGlobal('signedOut', false);
  if (p.pin) lockedProfile.value = p;
  else await activate(p);
}

let failures = 0;
let blockedUntil = 0;

/** Returns an error message, or null when unlocked. */
export async function unlock(pin: string): Promise<string | null> {
  const p = lockedProfile.value;
  if (!p?.pin) return null;
  if (Date.now() < blockedUntil) {
    return `Too many tries. Wait ${Math.ceil((blockedUntil - Date.now()) / 1000)} seconds.`;
  }
  if (await checkPin(pin, p.pin)) {
    failures = 0;
    await activate(p);
    return null;
  }
  failures += 1;
  if (failures >= 5) {
    failures = 0;
    blockedUntil = Date.now() + 30_000;
    return 'Wrong PIN 5 times. Wait 30 seconds.';
  }
  return 'Wrong PIN. Try again.';
}

async function leave() {
  await closeStory();
  // The next profile starts on its own home screen, not on this one's last page.
  go('/', true);
  batch(() => {
    profileId.value = null;
    currentProfile.value = null;
  });
  resetSettingsView();
  resetGestures();
}

/** Locks the current profile; its PIN is needed to come back. */
export async function lockNow() {
  const p = currentProfile.value;
  if (!p?.pin) return;
  await leave();
  lockedProfile.value = p;
}

/** Back to the "Who's writing?" screen. */
export async function signOut() {
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
  const updated = { ...p, ...patch };
  currentProfile.value = updated;
  await db.putProfile(updated);
  await refresh();
}

export async function setPin(pin: string | null) {
  const p = currentProfile.value;
  if (!p) return;
  const updated: ProfileRecord = { ...p, pin: pin ? await makePin(pin) : undefined };
  currentProfile.value = updated;
  await db.putProfile(updated);
  await refresh();
}

export async function verifyCurrentPin(pin: string): Promise<boolean> {
  const p = currentProfile.value;
  return !p?.pin || checkPin(pin, p.pin);
}

/** Deletes the signed-in profile and all of its stories, gestures and settings. */
export async function deleteCurrentProfile() {
  const p = currentProfile.value;
  if (!p) return;
  await leave();
  await db.deleteProfile(p.id);
  await refresh();
  await db.setGlobal('signedOut', true);
}
