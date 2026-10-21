import { Hono } from 'hono';
import { z } from 'zod';
import type { EpisodeDetail } from '../../src/shared/api';
import { isModerator, requireActiveUser } from '../auth/sessions';
import { preparePublish } from '../content/publish';
import type { AppEnv, Deps, UserRow } from '../context';
import { HttpError, conflict, forbidden, notFound } from '../http/errors';
import { HOUR } from '../http/ratelimit';
import { readJson } from '../http/validate';
import { logAction } from '../modlog';
import { notifyNewEpisode } from '../notify';
import { type EpisodeRow, type StoryRow, canSeeEpisode, coverOf, episodeMedia, episodeOrder, summary } from '../queries';
import { newId } from '../util';
import { REF_RE } from './images';
import { loadEpisode } from './social';
import { loadChapter, loadStory, refreshPublished, renumber, requireAuthor, requireUploaded, title } from './stories';

const MAX_EPISODES_PER_STORY = 2000;
const ref = z.string().regex(REF_RE);

/** Points an episode at the author's current copies of its pictures. */
function linkMedia(deps: Deps, episodeId: string, authorId: number, refs: string[]) {
  deps.db.run('DELETE FROM episode_media WHERE episode_id = ?', episodeId);
  for (let i = 0; i < refs.length; i += 200) {
    const chunk = refs.slice(i, i + 200);
    deps.db.run(
      `INSERT INTO episode_media (episode_id, ref, blob_id)
       SELECT ?, ref, blob_id FROM uploads WHERE user_id = ? AND ref IN (${chunk.map(() => '?').join(',')})`,
      episodeId,
      authorId,
      ...chunk,
    );
  }
}

export function episodeDetail(deps: Deps, story: StoryRow, e: EpisodeRow, viewer: UserRow | null): EpisodeDetail {
  const { db } = deps;
  const author = db.get<UserRow>('SELECT * FROM users WHERE id = ?', story.author_id)!;
  const order = episodeOrder(db, story, viewer);
  const at = order.findIndex((x) => x.id === e.id);
  const ref = (i: number) => (i >= 0 && i < order.length ? { id: order[i].id, title: order[i].title, number: order[i].number } : null);
  const chapter = loadChapter(deps, e.chapter_id);
  const counts = db.get<{ likes: number; comments: number }>(
    `SELECT (SELECT COUNT(*) FROM episode_likes WHERE episode_id = ?) AS likes,
            (SELECT COUNT(*) FROM comments WHERE episode_id = ? AND deleted_at IS NULL AND hidden_at IS NULL) AS comments`,
    e.id,
    e.id,
  )!;
  return {
    id: e.id,
    title: e.title,
    number: order[at]?.number ?? 0,
    body: e.body,
    revision: e.revision,
    words: e.words,
    publishedAt: e.published_at,
    updatedAt: e.updated_at,
    cover: coverOf(db, story.author_id, e.cover_ref),
    media: episodeMedia(db, e.id),
    story: {
      id: story.id,
      title: story.title,
      genre: story.genre,
      author: summary(author),
      cover: coverOf(db, story.author_id, story.cover_ref),
    },
    chapter: { id: chapter.id, title: chapter.title, position: chapter.position },
    prev: ref(at - 1),
    next: at >= 0 ? ref(at + 1) : null,
    likes: counts.likes,
    comments: counts.comments,
    hidden: !!e.hidden_at,
    viewer: {
      liked: !!viewer && !!db.get('SELECT 1 FROM episode_likes WHERE user_id = ? AND episode_id = ?', viewer.id, e.id),
      followingStory: !!viewer && !!db.get('SELECT 1 FROM story_follows WHERE user_id = ? AND story_id = ?', viewer.id, story.id),
      followingAuthor: !!viewer && !!db.get('SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?', viewer.id, story.author_id),
      isAuthor: !!viewer && viewer.id === story.author_id,
      canModerate: isModerator(viewer),
    },
  };
}

export function episodeRoutes() {
  const app = new Hono<AppEnv>();

  /** Publishes an episode at the end of a chapter. Retrying with the same clientKey is safe. */
  app.post('/chapters/:id/episodes', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const chapter = loadChapter(deps, c.req.param('id'));
    const story = loadStory(deps, chapter.story_id);
    requireAuthor(user, story);
    const body = await readJson(
      c,
      z.object({
        clientKey: z.string().min(1).max(100),
        title,
        coverRef: ref.nullable().optional(),
        text: z.string(),
      }),
    );
    const existing = deps.db.get<EpisodeRow>('SELECT * FROM episodes WHERE story_id = ? AND client_key = ?', story.id, body.clientKey);
    if (existing) return c.json({ episode: episodeDetail(deps, story, existing, user), created: false });
    deps.limits.hit('publish', String(user.id), 60, HOUR);

    const prepared = preparePublish(body.text);
    requireUploaded(deps, user.id, [...prepared.refs, body.coverRef]);
    const count = deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM episodes WHERE story_id = ?', story.id)!.n;
    if (count >= MAX_EPISODES_PER_STORY) throw new HttpError(422, 'too_many', 'A story can have at most 2000 episodes.');

    const id = newId();
    const now = deps.clock.now();
    deps.db.tx(() => {
      const position = deps.db.get<{ n: number }>('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM episodes WHERE chapter_id = ?', chapter.id)!.n;
      deps.db.run(
        `INSERT INTO episodes (id, story_id, chapter_id, client_key, position, title, cover_ref, body, words, published_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        story.id,
        chapter.id,
        body.clientKey,
        position,
        body.title,
        body.coverRef ?? null,
        prepared.body,
        prepared.words,
        now,
        now,
      );
      linkMedia(deps, id, user.id, prepared.refs);
      deps.db.run('UPDATE stories SET updated_at = ? WHERE id = ?', now, story.id);
      refreshPublished(deps, story.id);
      if (!story.hidden_at) notifyNewEpisode(deps, user.id, story.id, id);
    });
    const episode = deps.db.get<EpisodeRow>('SELECT * FROM episodes WHERE id = ?', id)!;
    return c.json({ episode: episodeDetail(deps, loadStory(deps, story.id), episode, user), created: true }, 201);
  });

  app.get('/episodes/:id', (c) => {
    const deps = c.var.deps;
    const { episode, story } = loadEpisode(deps, c.req.param('id'));
    if (!canSeeEpisode(deps.db, story, episode, c.var.user)) throw notFound('That episode');
    return c.json(episodeDetail(deps, story, episode, c.var.user));
  });

  /**
   * Replaces an episode's text. `baseRevision` is the revision the author's
   * copy started from; anything else means it changed elsewhere (409, with
   * the current text so the app can offer to keep either or both).
   */
  app.put('/episodes/:id', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const { episode, story } = loadEpisode(deps, c.req.param('id'));
    requireAuthor(user, story);
    const body = await readJson(
      c,
      z.object({
        baseRevision: z.number().int().positive(),
        text: z.string(),
        title: title.optional(),
        coverRef: ref.nullable().optional(),
      }),
    );
    deps.limits.hit('publish', String(user.id), 60, HOUR);
    if (body.baseRevision !== episode.revision) {
      throw conflict('conflict', 'This episode changed since your copy was published.', {
        current: { revision: episode.revision, body: episode.body, updatedAt: episode.updated_at },
      });
    }
    const prepared = preparePublish(body.text);
    requireUploaded(deps, user.id, [...prepared.refs, body.coverRef]);
    const now = deps.clock.now();
    deps.db.tx(() => {
      const changed = deps.db.run(
        `UPDATE episodes SET body = ?, words = ?, revision = revision + 1, updated_at = ?,
           title = COALESCE(?, title), cover_ref = CASE WHEN ? THEN ? ELSE cover_ref END
         WHERE id = ? AND revision = ?`,
        prepared.body,
        prepared.words,
        now,
        body.title ?? null,
        body.coverRef !== undefined ? 1 : 0,
        body.coverRef ?? null,
        episode.id,
        body.baseRevision,
      ).changes;
      // Two saves racing: the second one sees the first one's revision.
      if (!changed) throw conflict('conflict', 'This episode changed since your copy was published.');
      linkMedia(deps, episode.id, user.id, prepared.refs);
      deps.db.run('UPDATE stories SET updated_at = ? WHERE id = ?', now, story.id);
    });
    const fresh = deps.db.get<EpisodeRow>('SELECT * FROM episodes WHERE id = ?', episode.id)!;
    return c.json({ episode: episodeDetail(deps, story, fresh, user) });
  });

  /** Renames, changes the cover or moves an episode to the end of another chapter of the same story. */
  app.patch('/episodes/:id', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const { episode, story } = loadEpisode(deps, c.req.param('id'));
    requireAuthor(user, story);
    const body = await readJson(
      c,
      z.object({ title: title.optional(), coverRef: ref.nullable().optional(), chapterId: z.string().optional() }),
    );
    if (body.coverRef) requireUploaded(deps, user.id, [body.coverRef]);
    deps.db.tx(() => {
      deps.db.run(
        'UPDATE episodes SET title = COALESCE(?, title), cover_ref = CASE WHEN ? THEN ? ELSE cover_ref END WHERE id = ?',
        body.title ?? null,
        body.coverRef !== undefined ? 1 : 0,
        body.coverRef ?? null,
        episode.id,
      );
      if (body.chapterId && body.chapterId !== episode.chapter_id) {
        const target = loadChapter(deps, body.chapterId);
        if (target.story_id !== story.id) throw forbidden('Episodes can only move within their story.');
        const position = deps.db.get<{ n: number }>('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM episodes WHERE chapter_id = ?', target.id)!.n;
        deps.db.run('UPDATE episodes SET chapter_id = ?, position = ? WHERE id = ?', target.id, position, episode.id);
        renumber(deps, 'episodes', 'chapter_id', episode.chapter_id);
      }
    });
    const fresh = deps.db.get<EpisodeRow>('SELECT * FROM episodes WHERE id = ?', episode.id)!;
    return c.json({ episode: episodeDetail(deps, story, fresh, user) });
  });

  app.delete('/episodes/:id', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const { episode, story } = loadEpisode(deps, c.req.param('id'));
    if (story.author_id !== user.id && !isModerator(user)) throw forbidden();
    deps.db.tx(() => {
      deps.db.run('DELETE FROM episodes WHERE id = ?', episode.id);
      renumber(deps, 'episodes', 'chapter_id', episode.chapter_id);
      refreshPublished(deps, story.id);
      if (story.author_id !== user.id) logAction(deps, user, 'delete', 'episode', episode.id, episode.title);
    });
    return c.json({ ok: true });
  });

  return app;
}
