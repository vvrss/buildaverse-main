import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { textRefs } from '../format/images';
import { db } from '../store/db';
import { profileId, requireProfileId } from '../store/session';
import { type Crop, type PictureKind, compressPicture, formatBytes } from './compress';
import { type PictureRecord, deletePicture, getPicture, listPictures, putPicture } from './media';

/**
 * Pictures for the open profile: adding one (compressed, deduplicated by
 * its code), showing one (object URLs, cached), and cleaning up pictures no
 * story uses any more.
 */

/** Bumped whenever a picture is added, so placeholders for it can load. */
export const pictureVersion = signal(0);

export interface Added {
  ref: string;
  width: number;
  height: number;
  /** "2.4 MB → 180 KB" */
  savings: string;
}

export async function addPicture(file: Blob, kind: PictureKind, crop?: Crop): Promise<Added> {
  const owner = requireProfileId();
  const c = await compressPicture(file, kind, crop);
  // Identical pictures share one code, so adding the same one twice stores it once.
  if (!(await getPicture(owner, c.ref))) {
    await putPicture({ ref: c.ref, profileId: owner, blob: c.blob, width: c.width, height: c.height, createdAt: Date.now() });
  }
  pictureVersion.value += 1;
  return { ref: c.ref, width: c.width, height: c.height, savings: `${formatBytes(c.originalBytes)} → ${formatBytes(c.blob.size)}` };
}

interface Shown {
  url: string;
  width: number;
  height: number;
}

const urls = new Map<string, Shown>();
let urlOwner: string | null = null;

/** Forgets cached object URLs (on profile switch), so one profile never shows another's pictures. */
export function releasePictureUrls() {
  for (const s of urls.values()) URL.revokeObjectURL(s.url);
  urls.clear();
}

export async function pictureUrl(ref: string): Promise<Shown | null> {
  const owner = profileId.value;
  if (!owner) return null;
  if (urlOwner !== owner) {
    releasePictureUrls();
    urlOwner = owner;
  }
  const hit = urls.get(ref);
  if (hit) return hit;
  const record = await getPicture(owner, ref);
  if (!record || profileId.value !== owner) return null;
  const shown = { url: URL.createObjectURL(record.blob), width: record.width, height: record.height };
  urls.set(ref, shown);
  return shown;
}

/** The picture for a code: `undefined` while loading, `null` when this device doesn't have it. */
export function usePicture(ref: string | undefined): Shown | null | undefined {
  const version = pictureVersion.value;
  const [shown, setShown] = useState<Shown | null | undefined>(ref ? urls.get(ref) : null);
  useEffect(() => {
    if (!ref) {
      setShown(null);
      return;
    }
    let live = true;
    const cached = urls.get(ref);
    if (cached) setShown(cached);
    else {
      setShown(undefined);
      void pictureUrl(ref).then((s) => live && setShown(s));
    }
    return () => {
      live = false;
    };
  }, [ref, version]);
  return shown;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** data: URLs for these codes (for print, which opens in its own window). */
export async function pictureDataUrls(refs: string[]): Promise<Record<string, string>> {
  const owner = requireProfileId();
  const out: Record<string, string> = {};
  for (const ref of refs) {
    const p = await getPicture(owner, ref);
    if (p) out[ref] = await blobToDataUrl(p.blob);
  }
  return out;
}

export async function picturesOf(refs: string[]): Promise<PictureRecord[]> {
  const owner = requireProfileId();
  const out: PictureRecord[] = [];
  for (const ref of refs) {
    const p = await getPicture(owner, ref);
    if (p) out.push(p);
  }
  return out;
}

/** Pictures newer than this are kept even when unused: an undo or an unsaved line may still need them. */
const GRACE_MS = 24 * 60 * 60 * 1000;

/** Deletes this profile's pictures that no story, journal or draft refers to. */
export async function collectUnusedPictures(owner: string): Promise<number> {
  const used = new Set<string>();
  for (const s of await db.listStories(owner)) for (const r of textRefs(s.text)) used.add(r);
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('storyteller:')) for (const r of textRefs(localStorage.getItem(k) ?? '')) used.add(r);
    }
  } catch {
    // No localStorage: nothing extra to keep.
  }
  const now = Date.now();
  let removed = 0;
  for (const p of await listPictures(owner)) {
    if (used.has(p.ref) || now - p.createdAt < GRACE_MS) continue;
    await deletePicture(owner, p.ref);
    removed += 1;
  }
  return removed;
}

export async function picturesUsage(owner: string): Promise<{ count: number; bytes: number }> {
  const all = await listPictures(owner);
  return { count: all.length, bytes: all.reduce((n, p) => n + p.blob.size, 0) };
}
