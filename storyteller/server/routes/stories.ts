import { Hono } from 'hono';
import { z } from 'zod';
import { GENRES, type ChapterInfo, type EpisodeSummary, type MyStory, type Page, type StoryCard, type StoryDetail } from '../../src/shared/api';
import { isModerator, requireActiveUser } from '../auth/sessions';
import type { AppEnv, Deps, UserRow } from '../context';
import { HttpError, conflict, forbidden, notFound } from '../http/errors';
import { HOUR } from '../http/ratelimit';
import { limitParam, readJson } from '../http/validate';
import {
  type ChapterRow,
  type StoryRow,
  PUBLIC_EPISODE,
  PUBLIC_STORY,
  STORY_WITH_AUTHOR,
  canSeeStory,
  coverOf,
  episodeOrder,
  likeEscape,
  storyCards,
  storyTags,
} from '../queries';
import { cleanText, decodeCursor, encodeCursor, newId } from '../util';
import { logAction } from '../modlog';
import { REF_RE } from './images';

export const title = z
  .string()
  .transform((s) => cleanText(s))
  .pipe(z.string().min(1, 'Enter a title.').max(120, 'Use at most 120 characters.'));
const description = z
  .string()
  .transform((s) => cleanText(s, { multiline: true }))
  .pipe(z.string().max(1000, 'Use at most 1000 characters.'));
const genre = z.union([z.enum(GENRES), z.literal('')]);
const tag = z
  .string()
  .transform((s) => cleanText(s).toLowerCase().replace(/^#/, ''))
  .pipe(z.string().regex(/^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} -]{0,23}$/u, 'Tags are 1-24 letters, digits, spaces or -.'));
const tags = z.array(tag).max(8, 'Use at most 8 tags.').transform((t) => [...new Set(t)]);
const ref = z.string().regex(REF_RE);
const ids = z.array(z.string().regex(/^[0-9A-Za-z]{12}$/)).max(1000);
const clientKey = z.string().min(1).max(100);

export function loadStory(deps: Deps, id: string): StoryRow {
  const s = /^[0-9A-Za-z]{12}$/.test(id) ? deps.db.get<StoryRow>('SELECT * FROM stories WHERE id = ?', id) : undefined;
  if (!s) throw notFound('That story');
  return s;
}

export function loadChapter(deps: Deps, id: string): ChapterRow {
  const ch = /^[0-9A-Za-z]{12}$/.test(id) ? deps.db.get<ChapterRow>('SELECT * FROM chapters WHERE id = ?', id) : undefined;
  if (!ch) throw notFound('That chapter');
  return ch;
}

export function requireAuthor(user: UserRow, story: StoryRow) {
  if (story.author_id !== user.id) throw forbidden('Only the author can change this story.');
}

/** Picture codes must already be uploaded by the author. */
export function requireUploaded(deps: Deps, userId: number, refs: (string | null | undefined)[]) {
  const wanted = refs.filter((r): r is string => !!r);
  if (wanted.length === 0) return;
  const have = new Set(
    deps.db
      .all<{ ref: string }>(
        `SELECT ref FROM uploads WHERE user_id = ? AND ref IN (${wanted.map(() => '?').join(',')})`,
        userId,
        ...wanted,
      )
      .map((r) => r.ref),
  );
  const missing = wanted.filter((r) => !have.has(r));
  if (missing.length) throw new HttpError(422, 'missing_images', 'Upload these pictures first.', { refs: missing });
}

function setTags(deps: Deps, storyId: string, list: string[]) {
  deps.db.run('DELETE FROM story_tags WHERE story_id = ?', storyId);
  for (const t of list) deps.db.run('INSERT OR IGNORE INTO story_tags (story_id, tag) VALUES (?, ?)', storyId, t);
}

export function myStory(deps: Deps, s: StoryRow): MyStory {
  const chapters = deps.db.all<ChapterRow>('SELECT * FROM chapters WHERE story_id = ? ORDER BY position', s.id);
  const order = episodeOrder(deps.db, s, { id: s.author_id } as UserRow);
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    genre: s.genre,
    tags: storyTags(deps.db, s.id),
    coverRef: s.cover_ref,
    lastPublishedAt: s.last_published_at,
    chapters: chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      position: ch.position,
      coverRef: ch.cover_ref,
      episodes: order.filter((e) => e.chapterId === ch.id).map(({ id, title: t, number }) => ({ id, title: t, number })),
    })),
  };
}

function renumber(deps: Deps, table: 'chapters' | 'episodes', parentCol: string, parentId: string) {
  const rows = deps.db.all<{ id: string }>(`SELECT id FROM ${table} WHERE ${parentCol} = ? ORDER BY position, id`, parentId);
  rows.forEach((r, i) => deps.db.run(`UPDATE ${table} SET position = ? WHERE id = ?`, i + 1, r.id));
}

export function storyDetail(deps: Deps, s: StoryRow, viewer: UserRow | null): StoryDetail {
  const { db } = deps;
  const author = db.get<UserRow>('SELECT * FROM users WHERE id = ?', s.author_id)!;
  const [card] = storyCards(db, [{ ...s, a_username: author.username, a_display_name: author.display_name, a_color: author.color }]);
  const order = episodeOrder(db, s, viewer);
  const numbers = new Map(order.map((e) => [e.id, e.number]));
  const privileged = !!viewer && (viewer.id === s.author_id || isModerator(viewer));
  const chapters: ChapterInfo[] = db
    .all<ChapterRow>('SELECT * FROM chapters WHERE story_id = ? ORDER BY position', s.id)
    .map((ch) => {
      const eps = db.all<{
        id: string;
        title: string;
        cover_ref: string | null;
        published_at: number;
        updated_at: number;
        words: number;
        hidden_at: number | null;
        likes: number;
        comments: number;
      }>(
        `SELECT e.id, e.title, e.cover_ref, e.published_at, e.updated_at, e.words, e.hidden_at,
                (SELECT COUNT(*) FROM episode_likes l WHERE l.episode_id = e.id) AS likes,
                (SELECT COUNT(*) FROM comments m WHERE m.episode_id = e.id AND m.deleted_at IS NULL AND m.hidden_at IS NULL) AS comments
           FROM episodes e WHERE e.chapter_id = ? ${privileged ? '' : `AND ${PUBLIC_EPISODE}`} ORDER BY e.position`,
        ch.id,
      );
      const episodes: EpisodeSummary[] = eps.map((e) => ({
        id: e.id,
        title: e.title,
        number: numbers.get(e.id) ?? 0,
        cover: coverOf(db, s.author_id, e.cover_ref),
        publishedAt: e.published_at,
        updatedAt: e.updated_at,
        words: e.words,
        likes: e.likes,
        comments: e.comments,
        hidden: !!e.hidden_at,
      }));
      return { id: ch.id, title: ch.title, position: ch.position, cover: coverOf(db, s.author_id, ch.cover_ref), episodes };
    })
    .filter((ch) => privileged || ch.episodes.length > 0);
  let progress = null;
  if (viewer) {
    const p = db.get<{ episode_id: string }>('SELECT episode_id FROM reading_progress WHERE user_id = ? AND story_id = ?', viewer.id, s.id);
    const hit = p && order.find((e) => e.id === p.episode_id);
    if (hit) progress = { id: hit.id, title: hit.title, number: hit.number };
  }
  return {
    ...card,
    chapters,
    viewer: {
      following: !!viewer && !!db.get('SELECT 1 FROM story_follows WHERE user_id = ? AND story_id = ?', viewer.id, s.id),
      followingAuthor:
        !!viewer && !!db.get('SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?', viewer.id, s.author_id),
      isAuthor: !!viewer && viewer.id === s.author_id,
      canModerate: isModerator(viewer),
      progress,
    },
  };
}

export function storyRoutes() {
  const app = new Hono<AppEnv>();

  /** Discover: published stories, newest first or most followed, with filters. */
  app.get('/stories', (c) => {
    const { db } = c.var.deps;
    const limit = limitParam(c);
    const sort = c.req.query('sort') === 'popular' ? 'popular' : 'recent';
    const where: string[] = [PUBLIC_STORY];
    const params: (string | number)[] = [];
    const g = c.req.query('genre');
    if (g && (GENRES as readonly string[]).includes(g)) {
      where.push('s.genre = ?');
      params.push(g);
    }
    const t = c.req.query('tag');
    if (t) {
      where.push('EXISTS (SELECT 1 FROM story_tags st WHERE st.story_id = s.id AND st.tag = ?)');
      params.push(cleanText(t).toLowerCase().replace(/^#/, ''));
    }
    const q = cleanText(c.req.query('q') ?? '').slice(0, 80);
    if (q) {
      const like = `%${likeEscape(q.toLowerCase())}%`;
      where.push(
        `(lower(s.title) LIKE ? ESCAPE '\\' OR lower(s.description) LIKE ? ESCAPE '\\'
          OR lower(a.display_name) LIKE ? ESCAPE '\\' OR a.username LIKE ? ESCAPE '\\'
          OR EXISTS (SELECT 1 FROM story_tags st WHERE st.story_id = s.id AND st.tag LIKE ? ESCAPE '\\'))`,
      );
      params.push(like, like, like, like, like);
    }
    let rows;
    let next: string | null = null;
    if (sort === 'recent') {
      const cursor = decodeCursor(c.req.query('cursor'));
      if (cursor) {
        where.push('(s.last_published_at, s.id) < (?, ?)');
        params.push(cursor[0], String(cursor[1]));
      }
      rows = db.all<StoryRow & { a_username: string; a_display_name: string; a_color: string }>(
        `${STORY_WITH_AUTHOR} WHERE ${where.join(' AND ')} ORDER BY s.last_published_at DESC, s.id DESC LIMIT ?`,
        ...params,
        limit + 1,
      );
      if (rows.length > limit) {
        rows = rows.slice(0, limit);
        const last = rows[rows.length - 1];
        next = encodeCursor(last.last_published_at ?? 0, last.id);
      }
    } else {
      const offset = Math.max(0, Number(decodeCursor(c.req.query('cursor'))?.[1] ?? 0) || 0);
      rows = db.all<StoryRow & { a_username: string; a_display_name: string; a_color: string }>(
        `${STORY_WITH_AUTHOR} WHERE ${where.join(' AND ')}
          ORDER BY (SELECT COUNT(*) FROM story_follows f WHERE f.story_id = s.id) DESC, s.last_published_at DESC, s.id DESC
          LIMIT ? OFFSET ?`,
        ...params,
        limit + 1,
        offset,
      );
      if (rows.length > limit) {
        rows = rows.slice(0, limit);
        next = encodeCursor(0, offset + limit);
      }
    }
    const page: Page<StoryCard> = { items: storyCards(db, rows), next };
    return c.json(page);
  });

  /** Tags in use, most used first, for browsing. */
  app.get('/tags', (c) => {
    const rows = c.var.deps.db.all<{ tag: string; n: number }>(
      `SELECT st.tag, COUNT(*) AS n FROM story_tags st JOIN stories s ON s.id = st.story_id JOIN users a ON a.id = s.author_id
        WHERE ${PUBLIC_STORY} GROUP BY st.tag ORDER BY n DESC, st.tag LIMIT 50`,
    );
    return c.json({ items: rows.map((r) => ({ tag: r.tag, stories: r.n })) });
  });

  app.get('/me/stories', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const rows = deps.db.all<StoryRow>('SELECT * FROM stories WHERE author_id = ? ORDER BY updated_at DESC', user.id);
    return c.json({ items: rows.map((s) => myStory(deps, s)) });
  });

  app.post('/stories', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    deps.limits.hit('create-story', String(user.id), 30, HOUR);
    const body = await readJson(
      c,
      z.object({
        title,
        description: description.default(''),
        genre: genre.default(''),
        tags: tags.default([]),
        coverRef: ref.nullable().optional(),
        clientKey,
        firstChapter: z.object({ title: title.default('Chapter 1') }).default({ title: 'Chapter 1' }),
      }),
    );
    const existing = deps.db.get<StoryRow>('SELECT * FROM stories WHERE author_id = ? AND client_key = ?', user.id, body.clientKey);
    if (existing) return c.json({ story: myStory(deps, existing) });
    requireUploaded(deps, user.id, [body.coverRef]);
    const id = newId();
    const now = deps.clock.now();
    deps.db.tx(() => {
      deps.db.run(
        `INSERT INTO stories (id, author_id, client_key, title, description, genre, cover_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        user.id,
        body.clientKey,
        body.title,
        body.description,
        body.genre,
        body.coverRef ?? null,
        now,
        now,
      );
      setTags(deps, id, body.tags);
      deps.db.run(
        'INSERT INTO chapters (id, story_id, client_key, position, title, created_at) VALUES (?, ?, ?, 1, ?, ?)',
        newId(),
        id,
        `${body.clientKey}:1`,
        body.firstChapter.title,
        now,
      );
    });
    return c.json({ story: myStory(deps, loadStory(deps, id)) }, 201);
  });

  app.get('/stories/:id', (c) => {
    const deps = c.var.deps;
    const s = loadStory(deps, c.req.param('id'));
    if (!canSeeStory(deps.db, s, c.var.user)) throw notFound('That story');
    return c.json(storyDetail(deps, s, c.var.user));
  });

  app.patch('/stories/:id', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const s = loadStory(deps, c.req.param('id'));
    requireAuthor(user, s);
    const body = await readJson(
      c,
      z.object({
        title: title.optional(),
        description: description.optional(),
        genre: genre.optional(),
        tags: tags.optional(),
        coverRef: ref.nullable().optional(),
      }),
    );
    if (body.coverRef) requireUploaded(deps, user.id, [body.coverRef]);
    deps.db.tx(() => {
      deps.db.run(
        `UPDATE stories SET title = COALESCE(?, title), description = COALESCE(?, description), genre = COALESCE(?, genre),
           cover_ref = CASE WHEN ? THEN ? ELSE cover_ref END, updated_at = ? WHERE id = ?`,
        body.title ?? null,
        body.description ?? null,
        body.genre ?? null,
        body.coverRef !== undefined ? 1 : 0,
        body.coverRef ?? null,
        deps.clock.now(),
        s.id,
      );
      if (body.tags) setTags(deps, s.id, body.tags);
    });
    return c.json({ story: myStory(deps, loadStory(deps, s.id)) });
  });

  app.delete('/stories/:id', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const s = loadStory(deps, c.req.param('id'));
    if (s.author_id !== user.id && !isModerator(user)) throw forbidden();
    deps.db.tx(() => {
      deps.db.run('DELETE FROM stories WHERE id = ?', s.id);
      if (s.author_id !== user.id) logAction(deps, user, 'delete', 'story', s.id, s.title);
    });
    return c.json({ ok: true });
  });

  app.post('/stories/:id/chapters', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const s = loadStory(deps, c.req.param('id'));
    requireAuthor(user, s);
    const body = await readJson(c, z.object({ title, clientKey: clientKey.optional(), coverRef: ref.nullable().optional() }));
    if (body.clientKey) {
      const existing = deps.db.get<ChapterRow>('SELECT * FROM chapters WHERE story_id = ? AND client_key = ?', s.id, body.clientKey);
      if (existing) return c.json({ story: myStory(deps, s), chapterId: existing.id });
    }
    requireUploaded(deps, user.id, [body.coverRef]);
    const count = deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chapters WHERE story_id = ?', s.id)!.n;
    if (count >= 200) throw new HttpError(422, 'too_many', 'A story can have at most 200 chapters.');
    const id = newId();
    deps.db.run(
      'INSERT INTO chapters (id, story_id, client_key, position, title, cover_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      s.id,
      body.clientKey ?? null,
      count + 1,
      body.title,
      body.coverRef ?? null,
      deps.clock.now(),
    );
    return c.json({ story: myStory(deps, s), chapterId: id }, 201);
  });

  app.patch('/chapters/:id', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const ch = loadChapter(deps, c.req.param('id'));
    const s = loadStory(deps, ch.story_id);
    requireAuthor(user, s);
    const body = await readJson(c, z.object({ title: title.optional(), coverRef: ref.nullable().optional() }));
    if (body.coverRef) requireUploaded(deps, user.id, [body.coverRef]);
    deps.db.run(
      'UPDATE chapters SET title = COALESCE(?, title), cover_ref = CASE WHEN ? THEN ? ELSE cover_ref END WHERE id = ?',
      body.title ?? null,
      body.coverRef !== undefined ? 1 : 0,
      body.coverRef ?? null,
      ch.id,
    );
    return c.json({ story: myStory(deps, s) });
  });

  app.delete('/chapters/:id', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const ch = loadChapter(deps, c.req.param('id'));
    const s = loadStory(deps, ch.story_id);
    if (s.author_id !== user.id && !isModerator(user)) throw forbidden();
    const chapters = deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM chapters WHERE story_id = ?', s.id)!.n;
    if (chapters <= 1) throw conflict('last_chapter', 'A story needs at least one chapter.');
    const episodes = deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM episodes WHERE chapter_id = ?', ch.id)!.n;
    if (episodes > 0 && !isModerator(user)) {
      throw conflict('chapter_not_empty', 'Move or delete the episodes in this chapter first.');
    }
    deps.db.tx(() => {
      deps.db.run('DELETE FROM chapters WHERE id = ?', ch.id);
      renumber(deps, 'chapters', 'story_id', s.id);
      refreshPublished(deps, s.id);
    });
    return c.json({ story: myStory(deps, s) });
  });

  app.put('/stories/:id/chapter-order', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const s = loadStory(deps, c.req.param('id'));
    requireAuthor(user, s);
    const body = await readJson(c, z.object({ ids }));
    const current = deps.db.all<{ id: string }>('SELECT id FROM chapters WHERE story_id = ?', s.id).map((r) => r.id);
    if (!samePermutation(current, body.ids)) throw conflict('stale_order', 'The chapters changed. Reload and try again.');
    deps.db.tx(() => body.ids.forEach((id, i) => deps.db.run('UPDATE chapters SET position = ? WHERE id = ?', i + 1, id)));
    return c.json({ story: myStory(deps, s) });
  });

  app.put('/chapters/:id/episode-order', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const ch = loadChapter(deps, c.req.param('id'));
    const s = loadStory(deps, ch.story_id);
    requireAuthor(user, s);
    const body = await readJson(c, z.object({ ids }));
    const current = deps.db.all<{ id: string }>('SELECT id FROM episodes WHERE chapter_id = ?', ch.id).map((r) => r.id);
    if (!samePermutation(current, body.ids)) throw conflict('stale_order', 'The episodes changed. Reload and try again.');
    deps.db.tx(() => body.ids.forEach((id, i) => deps.db.run('UPDATE episodes SET position = ? WHERE id = ?', i + 1, id)));
    return c.json({ story: myStory(deps, s) });
  });

  return app;
}

function samePermutation(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(b).size === b.length && b.every((id) => a.includes(id));
}

/** Keeps stories.last_published_at in step with its newest visible episode. */
export function refreshPublished(deps: Deps, storyId: string) {
  deps.db.run(
    `UPDATE stories SET last_published_at = (SELECT MAX(published_at) FROM episodes e WHERE e.story_id = stories.id AND ${PUBLIC_EPISODE})
      WHERE id = ?`,
    storyId,
  );
}

export { renumber };
