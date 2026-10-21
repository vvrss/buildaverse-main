import type { EpisodeRef, MediaInfo, MediaMap, StoryCard, UserSummary } from '../src/shared/api';
import { isModerator } from './auth/sessions';
import type { UserRow } from './context';
import type { Db } from './db';

/**
 * Shared reads. Visibility rules live here:
 *  - the public sees published stories and episodes that are not hidden and
 *    whose author is not suspended;
 *  - authors also see their own unpublished or hidden things;
 *  - moderators see everything.
 */

export interface StoryRow {
  id: string;
  author_id: number;
  client_key: string | null;
  title: string;
  description: string;
  genre: string;
  cover_ref: string | null;
  created_at: number;
  updated_at: number;
  last_published_at: number | null;
  hidden_at: number | null;
}

export interface ChapterRow {
  id: string;
  story_id: string;
  client_key: string | null;
  position: number;
  title: string;
  cover_ref: string | null;
  created_at: number;
}

export interface EpisodeRow {
  id: string;
  story_id: string;
  chapter_id: string;
  client_key: string;
  position: number;
  title: string;
  cover_ref: string | null;
  body: string;
  revision: number;
  words: number;
  published_at: number;
  updated_at: number;
  hidden_at: number | null;
}

interface BlobRow {
  id: string;
  width: number;
  height: number;
  widths: string;
  avif: number;
}

export const summary = (u: Pick<UserRow, 'username' | 'display_name' | 'color'>): UserSummary => ({
  username: u.username,
  displayName: u.display_name,
  color: u.color,
});

export const mediaInfo = (b: BlobRow): MediaInfo => ({ id: b.id, w: b.width, h: b.height, widths: JSON.parse(b.widths), avif: !!b.avif });

/** Maps an author's picture codes to the stored pictures. */
export function resolveRefs(db: Db, authorId: number, refs: string[]): MediaMap {
  const out: MediaMap = {};
  const unique = [...new Set(refs)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const rows = db.all<BlobRow & { ref: string }>(
      `SELECT u.ref, b.id, b.width, b.height, b.widths, b.avif FROM uploads u JOIN blobs b ON b.id = u.blob_id
        WHERE u.user_id = ? AND u.ref IN (${chunk.map(() => '?').join(',')})`,
      authorId,
      ...chunk,
    );
    for (const r of rows) out[r.ref] = mediaInfo(r);
  }
  return out;
}

export function coverOf(db: Db, authorId: number, ref: string | null): MediaInfo | null {
  return ref ? (resolveRefs(db, authorId, [ref])[ref] ?? null) : null;
}

/** An episode's own pictures, as linked when it was published. */
export function episodeMedia(db: Db, episodeId: string): MediaMap {
  const rows = db.all<BlobRow & { ref: string }>(
    `SELECT em.ref, b.id, b.width, b.height, b.widths, b.avif FROM episode_media em JOIN blobs b ON b.id = em.blob_id WHERE em.episode_id = ?`,
    episodeId,
  );
  const out: MediaMap = {};
  for (const r of rows) out[r.ref] = mediaInfo(r);
  return out;
}

export function canSeeStory(db: Db, story: StoryRow, viewer: UserRow | null): boolean {
  if (viewer && (viewer.id === story.author_id || isModerator(viewer))) return true;
  if (story.hidden_at || story.last_published_at === null) return false;
  const author = db.get<{ banned_at: number | null }>('SELECT banned_at FROM users WHERE id = ?', story.author_id);
  return !!author && !author.banned_at;
}

export function canSeeEpisode(db: Db, story: StoryRow, episode: EpisodeRow, viewer: UserRow | null): boolean {
  if (!canSeeStory(db, story, viewer)) return false;
  if (viewer && (viewer.id === story.author_id || isModerator(viewer))) return true;
  return !episode.hidden_at;
}

/** SQL condition for episodes the public can see (alias e). */
export const PUBLIC_EPISODE = 'e.hidden_at IS NULL';
/** SQL condition for stories the public can see (aliases s and a for the author). */
export const PUBLIC_STORY = 's.last_published_at IS NOT NULL AND s.hidden_at IS NULL AND a.banned_at IS NULL';

/** Episodes of a story in reading order, with their number, as this viewer may see them. */
export function episodeOrder(db: Db, story: StoryRow, viewer: UserRow | null): (EpisodeRef & { chapterId: string; hidden: boolean })[] {
  const privileged = !!viewer && (viewer.id === story.author_id || isModerator(viewer));
  const rows = db.all<{ id: string; title: string; chapter_id: string; hidden_at: number | null }>(
    `SELECT e.id, e.title, e.chapter_id, e.hidden_at FROM episodes e JOIN chapters c ON c.id = e.chapter_id
      WHERE e.story_id = ? ${privileged ? '' : `AND ${PUBLIC_EPISODE}`}
      ORDER BY c.position, e.position`,
    story.id,
  );
  return rows.map((r, i) => ({ id: r.id, title: r.title, number: i + 1, chapterId: r.chapter_id, hidden: !!r.hidden_at }));
}

export function storyTags(db: Db, storyId: string): string[] {
  return db.all<{ tag: string }>('SELECT tag FROM story_tags WHERE story_id = ? ORDER BY tag', storyId).map((r) => r.tag);
}

/** Builds cards for story rows (joined with their author as a_*). */
export function storyCards(db: Db, rows: (StoryRow & { a_username: string; a_display_name: string; a_color: string })[]): StoryCard[] {
  return rows.map((s) => {
    const counts = db.get<{ episodes: number; likes: number }>(
      `SELECT COUNT(*) AS episodes,
              COALESCE((SELECT COUNT(*) FROM episode_likes l JOIN episodes e2 ON e2.id = l.episode_id WHERE e2.story_id = ?), 0) AS likes
         FROM episodes e WHERE e.story_id = ? AND ${PUBLIC_EPISODE}`,
      s.id,
      s.id,
    )!;
    const followers = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM story_follows WHERE story_id = ?', s.id)!.n;
    const latest = db.get<{ id: string; title: string }>(
      `SELECT e.id, e.title FROM episodes e WHERE e.story_id = ? AND ${PUBLIC_EPISODE} ORDER BY e.published_at DESC, e.id DESC LIMIT 1`,
      s.id,
    );
    let latestRef: EpisodeRef | null = null;
    if (latest) {
      const n = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM episodes e JOIN chapters c ON c.id = e.chapter_id,
                (SELECT c2.position AS cp, e2.position AS ep FROM episodes e2 JOIN chapters c2 ON c2.id = e2.chapter_id WHERE e2.id = ?) t
          WHERE e.story_id = ? AND ${PUBLIC_EPISODE} AND (c.position < t.cp OR (c.position = t.cp AND e.position <= t.ep))`,
        latest.id,
        s.id,
      )!.n;
      latestRef = { id: latest.id, title: latest.title, number: n };
    }
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      genre: s.genre,
      tags: storyTags(db, s.id),
      author: { username: s.a_username, displayName: s.a_display_name, color: s.a_color },
      cover: coverOf(db, s.author_id, s.cover_ref),
      episodes: counts.episodes,
      followers,
      likes: counts.likes,
      lastPublishedAt: s.last_published_at,
      latest: latestRef,
      hidden: !!s.hidden_at,
    };
  });
}

export const STORY_WITH_AUTHOR = `SELECT s.*, a.username AS a_username, a.display_name AS a_display_name, a.color AS a_color
  FROM stories s JOIN users a ON a.id = s.author_id`;

/** Escapes a LIKE pattern. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
