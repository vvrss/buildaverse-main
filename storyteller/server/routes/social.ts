import { Hono } from 'hono';
import { z } from 'zod';
import type { CommentDto, EpisodeSummary, NotificationDto, Page, StoryCard } from '../../src/shared/api';
import { isModerator, requireActiveUser, requireUser } from '../auth/sessions';
import type { AppEnv, Deps, UserRow } from '../context';
import { HttpError, forbidden, notFound } from '../http/errors';
import { DAY, MINUTE } from '../http/ratelimit';
import { limitParam, readJson } from '../http/validate';
import { notify } from '../notify';
import {
  type EpisodeRow,
  type StoryRow,
  PUBLIC_EPISODE,
  PUBLIC_STORY,
  STORY_WITH_AUTHOR,
  canSeeEpisode,
  canSeeStory,
  coverOf,
  episodeOrder,
  storyCards,
  summary,
} from '../queries';
import { cleanText, decodeCursor, encodeCursor } from '../util';
import { loadStory } from './stories';

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function loadEpisode(deps: Deps, id: string): { episode: EpisodeRow; story: StoryRow } {
  const episode = /^[0-9A-Za-z]{12}$/.test(id) ? deps.db.get<EpisodeRow>('SELECT * FROM episodes WHERE id = ?', id) : undefined;
  if (!episode) throw notFound('That episode');
  return { episode, story: loadStory(deps, episode.story_id) };
}

function visibleEpisode(deps: Deps, id: string, viewer: UserRow | null) {
  const found = loadEpisode(deps, id);
  if (!canSeeEpisode(deps.db, found.story, found.episode, viewer)) throw notFound('That episode');
  return found;
}

interface CommentRow {
  id: number;
  episode_id: string;
  author_id: number | null;
  parent_id: number | null;
  body: string;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
  hidden_at: number | null;
  username: string | null;
  display_name: string | null;
  color: string | null;
  author_banned: number | null;
  likes: number;
  liked: number;
}

const COMMENT_SELECT = `SELECT m.*, u.username, u.display_name, u.color, u.banned_at AS author_banned,
    (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = m.id) AS likes,
    EXISTS (SELECT 1 FROM comment_likes cl WHERE cl.comment_id = m.id AND cl.user_id = ?) AS liked
  FROM comments m LEFT JOIN users u ON u.id = m.author_id`;

function commentDto(row: CommentRow, viewer: UserRow | null, episodeAuthorId: number, now: number): CommentDto {
  const mine = !!viewer && viewer.id === row.author_id;
  const mod = isModerator(viewer);
  const removed = !!row.deleted_at;
  // Comments hidden by a moderator, or by a suspended writer, show to their
  // author and moderators only, marked as hidden.
  const hidden = !!row.hidden_at || !!row.author_banned;
  const showBody = !removed && (!hidden || mine || mod);
  return {
    id: row.id,
    author: removed || !row.username ? null : { username: row.username, displayName: row.display_name!, color: row.color! },
    body: showBody ? row.body : '',
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deleted: removed,
    hidden,
    likes: row.likes,
    viewer: {
      liked: !!row.liked,
      canEdit: mine && !removed && now - row.created_at < EDIT_WINDOW_MS,
      canDelete: !removed && (mine || mod || (!!viewer && viewer.id === episodeAuthorId)),
    },
    replies: [],
  };
}

export function socialRoutes() {
  const app = new Hono<AppEnv>();

  // ------------------------------------------------------------ likes

  app.put('/episodes/:id/like', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const { episode, story } = visibleEpisode(deps, c.req.param('id'), user);
    const r = deps.db.run(
      'INSERT OR IGNORE INTO episode_likes (user_id, episode_id, created_at) VALUES (?, ?, ?)',
      user.id,
      episode.id,
      deps.clock.now(),
    );
    if (r.changes) notify(deps, story.author_id, 'like', { actorId: user.id, storyId: story.id, episodeId: episode.id });
    return c.json(likeState(deps, episode.id, user.id));
  });

  app.delete('/episodes/:id/like', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const { episode } = visibleEpisode(deps, c.req.param('id'), user);
    deps.db.run('DELETE FROM episode_likes WHERE user_id = ? AND episode_id = ?', user.id, episode.id);
    return c.json(likeState(deps, episode.id, user.id));
  });

  // ---------------------------------------------------------- follows

  app.put('/stories/:id/follow', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const s = loadStory(deps, c.req.param('id'));
    if (!canSeeStory(deps.db, s, user)) throw notFound('That story');
    deps.db.run('INSERT OR IGNORE INTO story_follows (user_id, story_id, created_at) VALUES (?, ?, ?)', user.id, s.id, deps.clock.now());
    return c.json(storyFollowState(deps, s.id, user.id));
  });

  app.delete('/stories/:id/follow', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const s = loadStory(deps, c.req.param('id'));
    deps.db.run('DELETE FROM story_follows WHERE user_id = ? AND story_id = ?', user.id, s.id);
    return c.json(storyFollowState(deps, s.id, user.id));
  });

  app.put('/users/:username/follow', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const target = deps.db.get<UserRow>('SELECT * FROM users WHERE username = ?', c.req.param('username').toLowerCase());
    if (!target || target.banned_at) throw notFound('That writer');
    if (target.id === user.id) throw new HttpError(422, 'self_follow', "You can't follow yourself.");
    const r = deps.db.run(
      'INSERT OR IGNORE INTO user_follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)',
      user.id,
      target.id,
      deps.clock.now(),
    );
    if (r.changes) notify(deps, target.id, 'follow', { actorId: user.id });
    return c.json(userFollowState(deps, target.id, user.id));
  });

  app.delete('/users/:username/follow', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const target = deps.db.get<UserRow>('SELECT * FROM users WHERE username = ?', c.req.param('username').toLowerCase());
    if (!target) throw notFound('That writer');
    deps.db.run('DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?', user.id, target.id);
    return c.json(userFollowState(deps, target.id, user.id));
  });

  // ------------------------------------------------------------- feed

  /** New episodes from followed stories and followed writers, newest first. */
  app.get('/feed', (c) => {
    const deps = c.var.deps;
    const user = requireUser(c);
    const limit = limitParam(c);
    const cursor = decodeCursor(c.req.query('cursor'));
    const rows = deps.db.all<EpisodeRow & { a_username: string }>(
      `SELECT e.*, a.username AS a_username FROM episodes e
         JOIN stories s ON s.id = e.story_id JOIN users a ON a.id = s.author_id
        WHERE ${PUBLIC_EPISODE} AND ${PUBLIC_STORY}
          AND (EXISTS (SELECT 1 FROM story_follows f WHERE f.user_id = ? AND f.story_id = s.id)
               OR EXISTS (SELECT 1 FROM user_follows uf WHERE uf.follower_id = ? AND uf.followee_id = s.author_id))
          ${cursor ? 'AND (e.published_at, e.id) < (?, ?)' : ''}
        ORDER BY e.published_at DESC, e.id DESC LIMIT ?`,
      user.id,
      user.id,
      ...(cursor ? [cursor[0], String(cursor[1])] : []),
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const items = page.map((e) => feedItem(deps, e, user));
    const last = page[page.length - 1];
    return c.json({ items, next: rows.length > limit && last ? encodeCursor(last.published_at, last.id) : null });
  });

  /** Stories you were reading, most recent first, with where you got to. */
  app.get('/me/reading', (c) => {
    const deps = c.var.deps;
    const user = requireUser(c);
    const rows = deps.db.all<StoryRow & { a_username: string; a_display_name: string; a_color: string; episode_id: string }>(
      `${STORY_WITH_AUTHOR} JOIN reading_progress p ON p.story_id = s.id AND p.user_id = ?
        WHERE ${PUBLIC_STORY} ORDER BY p.updated_at DESC LIMIT 30`,
      user.id,
    );
    const cards = storyCards(deps.db, rows);
    const items = rows.map((s, i) => {
      const order = episodeOrder(deps.db, s, user);
      const at = order.findIndex((e) => e.id === s.episode_id);
      return {
        story: cards[i],
        current: at >= 0 ? { id: order[at].id, title: order[at].title, number: order[at].number } : null,
        next: at >= 0 && at + 1 < order.length ? { id: order[at + 1].id, title: order[at + 1].title, number: order[at + 1].number } : null,
      };
    });
    return c.json({ items });
  });

  app.put('/episodes/:id/progress', (c) => {
    const deps = c.var.deps;
    const user = requireUser(c);
    const { episode, story } = visibleEpisode(deps, c.req.param('id'), user);
    deps.db.run(
      `INSERT INTO reading_progress (user_id, story_id, episode_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, story_id) DO UPDATE SET episode_id = excluded.episode_id, updated_at = excluded.updated_at`,
      user.id,
      story.id,
      episode.id,
      deps.clock.now(),
    );
    return c.json({ ok: true });
  });

  // --------------------------------------------------------- comments

  app.get('/episodes/:id/comments', (c) => {
    const deps = c.var.deps;
    const viewer = c.var.user;
    const { episode, story } = visibleEpisode(deps, c.req.param('id'), viewer);
    const limit = limitParam(c, 30, 50);
    const cursor = Number(decodeCursor(c.req.query('cursor'))?.[1] ?? 0) || 0;
    const now = deps.clock.now();
    const vid = viewer?.id ?? -1;
    const tops = deps.db.all<CommentRow>(
      `${COMMENT_SELECT} WHERE m.episode_id = ? AND m.parent_id IS NULL ${cursor ? 'AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT ?`,
      vid,
      episode.id,
      ...(cursor ? [cursor] : []),
      limit + 1,
    );
    const page = tops.slice(0, limit);
    const items: CommentDto[] = page.map((t) => {
      const dto = commentDto(t, viewer, story.author_id, now);
      dto.replies = deps.db
        .all<CommentRow>(`${COMMENT_SELECT} WHERE m.parent_id = ? ORDER BY m.id LIMIT 200`, vid, t.id)
        .map((r) => commentDto(r, viewer, story.author_id, now));
      return dto;
    });
    const last = page[page.length - 1];
    const body: Page<CommentDto> = { items, next: tops.length > limit && last ? encodeCursor(0, last.id) : null };
    return c.json(body);
  });

  app.post('/episodes/:id/comments', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const { episode, story } = visibleEpisode(deps, c.req.param('id'), user);
    deps.limits.hit('comment-min', String(user.id), 10, MINUTE);
    deps.limits.hit('comment-day', String(user.id), 200, DAY);
    const body = await readJson(
      c,
      z.object({
        body: z
          .string()
          .transform((s) => cleanText(s, { multiline: true }))
          .pipe(z.string().min(1, 'Write something first.').max(2000, 'Comments can be at most 2000 characters.')),
        parentId: z.number().int().positive().nullable().optional(),
      }),
    );
    let parentId: number | null = null;
    let parentAuthor: number | null = null;
    if (body.parentId) {
      const parent = deps.db.get<{ id: number; parent_id: number | null; episode_id: string; author_id: number | null; deleted_at: number | null }>(
        'SELECT id, parent_id, episode_id, author_id, deleted_at FROM comments WHERE id = ?',
        body.parentId,
      );
      if (!parent || parent.episode_id !== episode.id) throw notFound('That comment');
      // One level of replies: a reply to a reply joins the same thread.
      parentId = parent.parent_id ?? parent.id;
      parentAuthor = parent.author_id;
    }
    const now = deps.clock.now();
    const { lastInsertRowid } = deps.db.run(
      'INSERT INTO comments (episode_id, author_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
      episode.id,
      user.id,
      parentId,
      body.body,
      now,
    );
    if (parentAuthor) notify(deps, parentAuthor, 'reply', { actorId: user.id, storyId: story.id, episodeId: episode.id, commentId: lastInsertRowid });
    if (story.author_id !== parentAuthor) {
      notify(deps, story.author_id, 'comment', { actorId: user.id, storyId: story.id, episodeId: episode.id, commentId: lastInsertRowid });
    }
    const row = deps.db.get<CommentRow>(`${COMMENT_SELECT} WHERE m.id = ?`, user.id, lastInsertRowid)!;
    return c.json(commentDto(row, user, story.author_id, now), 201);
  });

  app.patch('/comments/:id', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const row = deps.db.get<CommentRow>(`${COMMENT_SELECT} WHERE m.id = ?`, user.id, Number(c.req.param('id')) || 0);
    if (!row || row.deleted_at) throw notFound('That comment');
    if (row.author_id !== user.id) throw forbidden('You can only edit your own comments.');
    const now = deps.clock.now();
    if (now - row.created_at >= EDIT_WINDOW_MS) throw forbidden('Comments can be edited for 24 hours.');
    const body = await readJson(
      c,
      z.object({
        body: z
          .string()
          .transform((s) => cleanText(s, { multiline: true }))
          .pipe(z.string().min(1, 'Write something first.').max(2000, 'Comments can be at most 2000 characters.')),
      }),
    );
    deps.db.run('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?', body.body, now, row.id);
    const { story } = loadEpisode(deps, row.episode_id);
    const fresh = deps.db.get<CommentRow>(`${COMMENT_SELECT} WHERE m.id = ?`, user.id, row.id)!;
    return c.json(commentDto(fresh, user, story.author_id, now));
  });

  app.delete('/comments/:id', (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const row = deps.db.get<{ id: number; author_id: number | null; episode_id: string; deleted_at: number | null }>(
      'SELECT id, author_id, episode_id, deleted_at FROM comments WHERE id = ?',
      Number(c.req.param('id')) || 0,
    );
    if (!row || row.deleted_at) throw notFound('That comment');
    const { story } = loadEpisode(deps, row.episode_id);
    // The commenter, the episode's author and moderators can remove a comment.
    if (row.author_id !== user.id && story.author_id !== user.id && !isModerator(user)) throw forbidden();
    const hasReplies = !!deps.db.get('SELECT 1 FROM comments WHERE parent_id = ?', row.id);
    if (hasReplies) deps.db.run("UPDATE comments SET body = '', deleted_at = ? WHERE id = ?", deps.clock.now(), row.id);
    else deps.db.run('DELETE FROM comments WHERE id = ?', row.id);
    return c.json({ ok: true });
  });

  app.put('/comments/:id/like', (c) => toggleCommentLike(c.var.deps, requireActiveUser(c), Number(c.req.param('id')) || 0, true, c));
  app.delete('/comments/:id/like', (c) => toggleCommentLike(c.var.deps, requireActiveUser(c), Number(c.req.param('id')) || 0, false, c));

  // ---------------------------------------------------- notifications

  app.get('/notifications', (c) => {
    const deps = c.var.deps;
    const user = requireUser(c);
    const limit = limitParam(c, 30, 50);
    const cursor = Number(decodeCursor(c.req.query('cursor'))?.[1] ?? 0) || 0;
    const rows = deps.db.all<{
      id: number;
      kind: NotificationDto['kind'];
      created_at: number;
      read_at: number | null;
      a_username: string | null;
      a_display_name: string | null;
      a_color: string | null;
      story_id: string | null;
      s_title: string | null;
      episode_id: string | null;
      e_title: string | null;
      comment_id: number | null;
      c_body: string | null;
    }>(
      `SELECT n.id, n.kind, n.created_at, n.read_at, a.username AS a_username, a.display_name AS a_display_name, a.color AS a_color,
              n.story_id, s.title AS s_title, n.episode_id, e.title AS e_title, n.comment_id, m.body AS c_body
         FROM notifications n
         LEFT JOIN users a ON a.id = n.actor_id
         LEFT JOIN stories s ON s.id = n.story_id
         LEFT JOIN episodes e ON e.id = n.episode_id
         LEFT JOIN comments m ON m.id = n.comment_id
        WHERE n.user_id = ? ${cursor ? 'AND n.id < ?' : ''}
        ORDER BY n.id DESC LIMIT ?`,
      user.id,
      ...(cursor ? [cursor] : []),
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const numbers = new Map<string, number>();
    const numberOf = (storyId: string, episodeId: string) => {
      const key = `${storyId}:${episodeId}`;
      if (!numbers.has(key)) {
        const story = deps.db.get<StoryRow>('SELECT * FROM stories WHERE id = ?', storyId);
        const hit = story ? episodeOrder(deps.db, story, user).find((e) => e.id === episodeId) : undefined;
        numbers.set(key, hit?.number ?? 0);
      }
      return numbers.get(key)!;
    };
    const items: NotificationDto[] = page.map((r) => ({
      id: r.id,
      kind: r.kind,
      actor: r.a_username ? { username: r.a_username, displayName: r.a_display_name!, color: r.a_color! } : null,
      story: r.story_id && r.s_title ? { id: r.story_id, title: r.s_title } : null,
      episode: r.episode_id && r.e_title && r.story_id ? { id: r.episode_id, title: r.e_title, number: numberOf(r.story_id, r.episode_id) } : null,
      comment: r.comment_id && r.c_body ? { id: r.comment_id, excerpt: r.c_body.slice(0, 140) } : null,
      createdAt: r.created_at,
      read: !!r.read_at,
    }));
    const last = page[page.length - 1];
    return c.json({ items, next: rows.length > limit && last ? encodeCursor(0, last.id) : null });
  });

  app.post('/notifications/read', async (c) => {
    const deps = c.var.deps;
    const user = requireUser(c);
    const body = await readJson(c, z.object({ upTo: z.number().int().positive().optional() }));
    deps.db.run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL ${body.upTo ? 'AND id <= ?' : ''}`,
      deps.clock.now(),
      user.id,
      ...(body.upTo ? [body.upTo] : []),
    );
    return c.json({ ok: true });
  });

  return app;
}

function likeState(deps: Deps, episodeId: string, userId: number) {
  return {
    liked: !!deps.db.get('SELECT 1 FROM episode_likes WHERE user_id = ? AND episode_id = ?', userId, episodeId),
    likes: deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM episode_likes WHERE episode_id = ?', episodeId)!.n,
  };
}

function storyFollowState(deps: Deps, storyId: string, userId: number) {
  return {
    following: !!deps.db.get('SELECT 1 FROM story_follows WHERE user_id = ? AND story_id = ?', userId, storyId),
    followers: deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM story_follows WHERE story_id = ?', storyId)!.n,
  };
}

function userFollowState(deps: Deps, targetId: number, userId: number) {
  return {
    following: !!deps.db.get('SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?', userId, targetId),
    followers: deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_follows WHERE followee_id = ?', targetId)!.n,
  };
}

function toggleCommentLike(deps: Deps, user: UserRow, id: number, on: boolean, c: { json: (v: unknown) => Response }) {
  const row = deps.db.get<{ id: number; episode_id: string; deleted_at: number | null }>('SELECT id, episode_id, deleted_at FROM comments WHERE id = ?', id);
  if (!row || row.deleted_at) throw notFound('That comment');
  visibleEpisode(deps, row.episode_id, user);
  if (on) deps.db.run('INSERT OR IGNORE INTO comment_likes (user_id, comment_id, created_at) VALUES (?, ?, ?)', user.id, id, deps.clock.now());
  else deps.db.run('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?', user.id, id);
  return c.json({
    liked: on,
    likes: deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', id)!.n,
  });
}

function feedItem(deps: Deps, e: EpisodeRow, viewer: UserRow): { story: StoryCard; episode: EpisodeSummary } {
  const s = deps.db.get<StoryRow & { a_username: string; a_display_name: string; a_color: string }>(
    `${STORY_WITH_AUTHOR} WHERE s.id = ?`,
    e.story_id,
  )!;
  const [story] = storyCards(deps.db, [s]);
  const number = episodeOrder(deps.db, s, viewer).find((x) => x.id === e.id)?.number ?? 0;
  const counts = deps.db.get<{ likes: number; comments: number }>(
    `SELECT (SELECT COUNT(*) FROM episode_likes WHERE episode_id = ?) AS likes,
            (SELECT COUNT(*) FROM comments WHERE episode_id = ? AND deleted_at IS NULL AND hidden_at IS NULL) AS comments`,
    e.id,
    e.id,
  )!;
  return {
    story,
    episode: {
      id: e.id,
      title: e.title,
      number,
      cover: coverOf(deps.db, s.author_id, e.cover_ref),
      publishedAt: e.published_at,
      updatedAt: e.updated_at,
      words: e.words,
      likes: counts.likes,
      comments: counts.comments,
      hidden: !!e.hidden_at,
    },
  };
}

export { summary };
