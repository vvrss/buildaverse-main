import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ModLogEntry, ModUser, Page, ReportDto, ReportReason } from '../../src/shared/api';
import { requireActiveUser, requireAdmin, requireModerator } from '../auth/sessions';
import type { AppEnv, Deps, UserRow } from '../context';
import { HttpError, forbidden, notFound } from '../http/errors';
import { DAY } from '../http/ratelimit';
import { limitParam, readJson } from '../http/validate';
import { logAction } from '../modlog';
import { type EpisodeRow, type StoryRow, canSeeEpisode, canSeeStory, likeEscape, summary } from '../queries';
import { cleanText, decodeCursor, encodeCursor } from '../util';
import { deleteAccount } from './auth';
import { loadEpisode } from './social';
import { loadStory, refreshPublished } from './stories';

const REASONS = ['spam', 'harassment', 'hate', 'sexual', 'violence', 'copyright', 'other'] as const satisfies readonly ReportReason[];
const KINDS = ['story', 'episode', 'comment', 'user'] as const;
type Kind = (typeof KINDS)[number];

const note = z
  .string()
  .transform((s) => cleanText(s, { multiline: true }))
  .pipe(z.string().max(500, 'Use at most 500 characters.'));

/** A JSON body that may be left out entirely (for PUT/DELETE toggles). */
async function optionalNote(c: Context<AppEnv>): Promise<string> {
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) return '';
  return (await readJson(c, z.object({ note: note.optional() }))).note ?? '';
}

function findUser(deps: Deps, username: string): UserRow {
  const u = deps.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username.toLowerCase());
  if (!u) throw notFound('That writer');
  return u;
}

/** Whether `actor` may act on `target`: nobody acts on the admin, only the admin acts on moderators. */
function requireAbove(actor: UserRow, target: UserRow) {
  if (actor.id === target.id) throw forbidden("You can't do that to your own account.");
  if (target.role === 'admin') throw forbidden('The administrator account cannot be changed here.');
  if (target.role === 'moderator' && actor.role !== 'admin') throw forbidden('Only the administrator can act on moderators.');
}

interface Target {
  label: string;
  link: string | null;
}

/** Describes a reported thing for the moderator; null when it no longer exists. */
function describe(deps: Deps, kind: Kind, id: string): Target | null {
  const { db } = deps;
  if (kind === 'story') {
    const s = db.get<{ title: string; username: string }>(
      'SELECT s.title, a.username FROM stories s JOIN users a ON a.id = s.author_id WHERE s.id = ?',
      id,
    );
    return s ? { label: `Story “${s.title}” by @${s.username}`, link: `#/c/s/${id}` } : null;
  }
  if (kind === 'episode') {
    const e = db.get<{ title: string; s_title: string; username: string }>(
      `SELECT e.title, s.title AS s_title, a.username FROM episodes e JOIN stories s ON s.id = e.story_id
         JOIN users a ON a.id = s.author_id WHERE e.id = ?`,
      id,
    );
    return e ? { label: `Episode “${e.title}” of “${e.s_title}” by @${e.username}`, link: `#/c/e/${id}` } : null;
  }
  if (kind === 'comment') {
    const m = db.get<{ body: string; episode_id: string; username: string | null }>(
      'SELECT m.body, m.episode_id, u.username FROM comments m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ? AND m.deleted_at IS NULL',
      Number(id) || 0,
    );
    if (!m) return null;
    const excerpt = m.body.length > 120 ? `${m.body.slice(0, 119)}…` : m.body;
    return { label: `Comment by @${m.username ?? 'deleted'}: “${excerpt}”`, link: `#/c/e/${m.episode_id}?comment=${id}` };
  }
  const u = db.get<{ username: string; display_name: string }>('SELECT username, display_name FROM users WHERE username = ?', id);
  return u ? { label: `Writer ${u.display_name} (@${u.username})`, link: `#/c/u/${u.username}` } : null;
}

/** Checks the reporter can see what they report, and returns its canonical id. */
function reportable(deps: Deps, kind: Kind, id: string, viewer: UserRow): string {
  if (kind === 'story') {
    const s = loadStory(deps, id);
    if (!canSeeStory(deps.db, s, viewer)) throw notFound('That story');
    return s.id;
  }
  if (kind === 'episode') {
    const { episode, story } = loadEpisode(deps, id);
    if (!canSeeEpisode(deps.db, story, episode, viewer)) throw notFound('That episode');
    return episode.id;
  }
  if (kind === 'comment') {
    const m = deps.db.get<{ id: number; episode_id: string; deleted_at: number | null }>(
      'SELECT id, episode_id, deleted_at FROM comments WHERE id = ?',
      Number(id) || 0,
    );
    if (!m || m.deleted_at) throw notFound('That comment');
    const { episode, story } = loadEpisode(deps, m.episode_id);
    if (!canSeeEpisode(deps.db, story, episode, viewer)) throw notFound('That comment');
    return String(m.id);
  }
  const u = findUser(deps, id);
  if (u.id === viewer.id) throw new HttpError(422, 'self_report', "You can't report yourself.");
  return u.username;
}

function setHidden(deps: Deps, table: 'stories' | 'episodes' | 'comments', id: string | number, hidden: boolean) {
  return deps.db.run(`UPDATE ${table} SET hidden_at = ? WHERE id = ?`, hidden ? deps.clock.now() : null, id).changes > 0;
}

export function moderationRoutes() {
  const app = new Hono<AppEnv>();

  // ---------------------------------------------------------- reports

  /** Anyone signed in can report something; repeating a report is harmless. */
  app.post('/reports', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    deps.limits.hit('report', String(user.id), 30, DAY);
    const body = await readJson(
      c,
      z.object({
        targetKind: z.enum(KINDS),
        targetId: z.string().min(1).max(64),
        reason: z.enum(REASONS),
        details: note.default(''),
      }),
    );
    const id = reportable(deps, body.targetKind, body.targetId, user);
    deps.db.run(
      `INSERT INTO reports (reporter_id, target_kind, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (reporter_id, target_kind, target_id) WHERE resolved_at IS NULL
       DO UPDATE SET reason = excluded.reason, details = excluded.details`,
      user.id,
      body.targetKind,
      id,
      body.reason,
      body.details,
      deps.clock.now(),
    );
    return c.json({ ok: true }, 201);
  });

  /** Open reports, one row per reported thing, newest first. */
  app.get('/mod/reports', (c) => {
    const deps = c.var.deps;
    requireModerator(c);
    const limit = limitParam(c, 30, 50);
    const cursor = Number(decodeCursor(c.req.query('cursor'))?.[1] ?? 0) || 0;
    const groups = deps.db.all<{ target_kind: Kind; target_id: string; n: number; last_id: number }>(
      `SELECT target_kind, target_id, COUNT(*) AS n, MAX(id) AS last_id FROM reports WHERE resolved_at IS NULL
        GROUP BY target_kind, target_id ${cursor ? 'HAVING MAX(id) < ?' : ''} ORDER BY last_id DESC LIMIT ?`,
      ...(cursor ? [cursor] : []),
      limit + 1,
    );
    const page = groups.slice(0, limit);
    const items: ReportDto[] = page.map((g) => {
      const r = deps.db.get<{ reason: ReportReason; details: string; created_at: number; username: string | null; display_name: string | null; color: string | null }>(
        `SELECT r.reason, r.details, r.created_at, u.username, u.display_name, u.color
           FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.id = ?`,
        g.last_id,
      )!;
      const target = describe(deps, g.target_kind, g.target_id);
      return {
        id: g.last_id,
        targetKind: g.target_kind,
        targetId: g.target_id,
        targetLabel: target?.label ?? 'Already removed',
        targetLink: target?.link ?? null,
        reason: r.reason,
        details: r.details,
        reporter: r.username ? { username: r.username, displayName: r.display_name!, color: r.color! } : null,
        createdAt: r.created_at,
        count: g.n,
      };
    });
    const last = page[page.length - 1];
    const body: Page<ReportDto> = { items, next: groups.length > limit && last ? encodeCursor(0, last.last_id) : null };
    return c.json(body);
  });

  /** Closes every open report on one thing, after acting on it or deciding not to. */
  app.post('/mod/reports/resolve', async (c) => {
    const deps = c.var.deps;
    const mod = requireModerator(c);
    const body = await readJson(
      c,
      z.object({
        targetKind: z.enum(KINDS),
        targetId: z.string().min(1).max(64),
        resolution: z.enum(['dismissed', 'actioned']),
        note: note.default(''),
      }),
    );
    const now = deps.clock.now();
    const { changes } = deps.db.run(
      `UPDATE reports SET resolved_at = ?, resolved_by = ?, resolution = ?
        WHERE target_kind = ? AND target_id = ? AND resolved_at IS NULL`,
      now,
      mod.id,
      body.resolution,
      body.targetKind,
      body.targetId,
    );
    if (changes) logAction(deps, mod, `resolve:${body.resolution}`, body.targetKind, body.targetId, body.note);
    return c.json({ ok: true, resolved: changes });
  });

  // ----------------------------------------------------------- hiding

  for (const hidden of [true, false]) {
    const method = hidden ? 'put' : 'delete';
    const action = hidden ? 'hide' : 'unhide';

    app[method]('/mod/stories/:id/hidden', async (c) => {
      const deps = c.var.deps;
      const mod = requireModerator(c);
      const s: StoryRow = loadStory(deps, c.req.param('id'));
      const text = await optionalNote(c);
      deps.db.tx(() => {
        setHidden(deps, 'stories', s.id, hidden);
        logAction(deps, mod, action, 'story', s.id, text);
      });
      return c.json({ ok: true, hidden });
    });

    app[method]('/mod/episodes/:id/hidden', async (c) => {
      const deps = c.var.deps;
      const mod = requireModerator(c);
      const { episode }: { episode: EpisodeRow } = loadEpisode(deps, c.req.param('id'));
      const text = await optionalNote(c);
      deps.db.tx(() => {
        setHidden(deps, 'episodes', episode.id, hidden);
        refreshPublished(deps, episode.story_id);
        logAction(deps, mod, action, 'episode', episode.id, text);
      });
      return c.json({ ok: true, hidden });
    });

    app[method]('/mod/comments/:id/hidden', async (c) => {
      const deps = c.var.deps;
      const mod = requireModerator(c);
      const id = Number(c.req.param('id')) || 0;
      const text = await optionalNote(c);
      if (!deps.db.get('SELECT 1 FROM comments WHERE id = ? AND deleted_at IS NULL', id)) throw notFound('That comment');
      deps.db.tx(() => {
        setHidden(deps, 'comments', id, hidden);
        logAction(deps, mod, action, 'comment', id, text);
      });
      return c.json({ ok: true, hidden });
    });

    // --------------------------------------------------------- banning

    app[method]('/mod/users/:username/ban', async (c) => {
      const deps = c.var.deps;
      const mod = requireModerator(c);
      const target = findUser(deps, c.req.param('username'));
      requireAbove(mod, target);
      const text = await optionalNote(c);
      deps.db.tx(() => {
        deps.db.run('UPDATE users SET banned_at = ? WHERE id = ?', hidden ? deps.clock.now() : null, target.id);
        logAction(deps, mod, hidden ? 'ban' : 'unban', 'user', target.username, text);
      });
      return c.json({ ok: true, banned: hidden });
    });
  }

  /** Finds accounts, for the moderation screen. */
  app.get('/mod/users', (c) => {
    const deps = c.var.deps;
    requireModerator(c);
    const q = cleanText(c.req.query('q') ?? '').toLowerCase().slice(0, 40);
    const like = `%${likeEscape(q)}%`;
    const rows = deps.db.all<UserRow & { stories: number; comments: number }>(
      `SELECT u.*, (SELECT COUNT(*) FROM stories s WHERE s.author_id = u.id) AS stories,
              (SELECT COUNT(*) FROM comments m WHERE m.author_id = u.id AND m.deleted_at IS NULL) AS comments
         FROM users u
        WHERE ? = '' OR u.username LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\'
        ORDER BY u.banned_at IS NULL, u.created_at DESC LIMIT 50`,
      q,
      like,
      like,
    );
    const items: ModUser[] = rows.map((u) => ({
      ...summary(u),
      role: u.role,
      banned: !!u.banned_at,
      createdAt: u.created_at,
      stories: u.stories,
      comments: u.comments,
    }));
    return c.json({ items });
  });

  app.get('/mod/log', (c) => {
    const deps = c.var.deps;
    requireModerator(c);
    const limit = limitParam(c, 50, 100);
    const cursor = Number(decodeCursor(c.req.query('cursor'))?.[1] ?? 0) || 0;
    const rows = deps.db.all<{
      id: number;
      action: string;
      target_kind: string;
      target_id: string;
      note: string;
      created_at: number;
      username: string | null;
      display_name: string | null;
      color: string | null;
    }>(
      `SELECT l.*, u.username, u.display_name, u.color FROM mod_log l LEFT JOIN users u ON u.id = l.moderator_id
        ${cursor ? 'WHERE l.id < ?' : ''} ORDER BY l.id DESC LIMIT ?`,
      ...(cursor ? [cursor] : []),
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const items: ModLogEntry[] = page.map((r) => ({
      id: r.id,
      moderator: r.username ? { username: r.username, displayName: r.display_name!, color: r.color! } : null,
      action: r.action,
      targetKind: r.target_kind,
      targetId: r.target_id,
      note: r.note,
      createdAt: r.created_at,
    }));
    const last = page[page.length - 1];
    return c.json({ items, next: rows.length > limit && last ? encodeCursor(0, last.id) : null });
  });

  // ------------------------------------------------------------ admin

  app.put('/admin/users/:username/role', async (c) => {
    const deps = c.var.deps;
    const admin = requireAdmin(c);
    const target = findUser(deps, c.req.param('username'));
    requireAbove(admin, target);
    const { role } = await readJson(c, z.object({ role: z.enum(['user', 'moderator']) }));
    deps.db.tx(() => {
      deps.db.run('UPDATE users SET role = ? WHERE id = ?', role, target.id);
      logAction(deps, admin, `role:${role}`, 'user', target.username);
    });
    return c.json({ ok: true, role });
  });

  app.delete('/admin/users/:username', async (c) => {
    const deps = c.var.deps;
    const admin = requireAdmin(c);
    const target = findUser(deps, c.req.param('username'));
    requireAbove(admin, target);
    const text = await optionalNote(c);
    deps.db.tx(() => {
      deleteAccount(deps, target.id);
      logAction(deps, admin, 'delete', 'user', target.username, text);
    });
    return c.json({ ok: true });
  });

  return app;
}
