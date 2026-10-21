import { parseStory } from '../format/parser';
import { serializeStory } from '../format/serializer';
import { getPicture, putPicture } from '../images/media';
import { pictureVersion } from '../images/pictures';
import type { EpisodeDetail } from '../shared/api';
import { type PublishedLink, type StoryRecord, db } from '../store/db';
import { requireProfileId } from '../store/session';
import { createStory } from '../store/storyStore';

/**
 * The bridge between stories on this device and episodes online: which local
 * story is linked to which episode, and bringing an episode onto this device.
 */

/** FNV-1a hash of a text, to tell when a published story changed since. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export const changedSincePublished = (r: StoryRecord) => !!r.published && textHash(r.text) !== r.published.textHash;

export async function localCopyOf(episodeId: string): Promise<StoryRecord | undefined> {
  return (await db.listStories(requireProfileId())).find((s) => s.published?.episodeId === episodeId);
}

export async function linkStory(id: string, change: Partial<Pick<StoryRecord, 'published' | 'series' | 'publishKey'>>) {
  const r = await db.getStory(id);
  if (!r) return;
  const next: StoryRecord = { ...r, ...change };
  for (const k of Object.keys(change) as (keyof typeof change)[]) if (change[k] === undefined) delete next[k];
  await db.putStory(next);
}

export function linkFor(ep: EpisodeDetail, text: string): PublishedLink {
  return {
    episodeId: ep.id,
    storyId: ep.story.id,
    chapterId: ep.chapter.id,
    revision: ep.revision,
    number: ep.number,
    storyTitle: ep.story.title,
    textHash: textHash(text),
    at: Date.now(),
  };
}

/** "Edit this episode here": downloads its text and pictures into a new story on this device. */
export async function editHere(ep: EpisodeDetail): Promise<string> {
  const owner = requireProfileId();
  for (const [ref, m] of Object.entries(ep.media)) {
    if (await getPicture(owner, ref)) continue;
    const w = Math.max(...m.widths);
    const res = await fetch(`/media/${m.id}/${w}.webp`);
    if (!res.ok) continue;
    await putPicture({ ref, profileId: owner, blob: await res.blob(), width: m.w, height: m.h, createdAt: Date.now() });
  }
  pictureVersion.value += 1;
  const story = parseStory(ep.body).story;
  story.title = ep.title;
  const text = serializeStory(story);
  const id = await createStory(text);
  await linkStory(id, { published: linkFor(ep, text), series: { storyId: ep.story.id, title: ep.story.title, chapterId: ep.chapter.id } });
  return id;
}
