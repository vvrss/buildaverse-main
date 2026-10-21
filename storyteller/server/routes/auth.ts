import { Hono } from 'hono';
import { z } from 'zod';
import type { Me } from '../../src/shared/api';
import { PASSWORD_RULES, burnTime, hashPassword, verifyPassword } from '../auth/password';
import {
  clearSessionCookie,
  createSession,
  requireActiveUser,
  requireUser,
  revokeOtherSessions,
  revokeSession,
  setSessionCookie,
} from '../auth/sessions';
import type { AppEnv, Deps, UserRow } from '../context';
import { HttpError, badRequest, conflict, forbidden } from '../http/errors';
import { HOUR, MINUTE } from '../http/ratelimit';
import { readJson } from '../http/validate';
import { cleanText } from '../util';

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const RESERVED = new Set(['me', 'admin', 'api', 'deleted', 'storyteller', 'moderator', 'root', 'system', 'support', 'help']);

export const username = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.string().regex(USERNAME_RE, 'Use 3-24 letters, digits or _.'));
const displayName = z
  .string()
  .transform((s) => cleanText(s))
  .pipe(z.string().min(1, 'Enter a name.').max(40, 'Use at most 40 characters.'));
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a color.').transform((s) => s.toLowerCase());
const password = z
  .string()
  .min(PASSWORD_RULES.min, `Use at least ${PASSWORD_RULES.min} characters.`)
  .max(PASSWORD_RULES.max, 'That password is too long.');

export function meOf(deps: Deps, user: UserRow): Me {
  const unread = deps.db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL',
    user.id,
  )!.n;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    color: user.color,
    bio: user.bio,
    role: user.role,
    createdAt: user.created_at,
    unreadNotifications: unread,
  };
}

/** Deletes an account. Comments others replied to stay as "deleted" so threads keep their shape. */
export function deleteAccount(deps: Deps, userId: number) {
  deps.db.tx(() => {
    const now = deps.clock.now();
    deps.db.run(
      `UPDATE comments SET body = '', deleted_at = ?
        WHERE author_id = ? AND EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = comments.id)`,
      now,
      userId,
    );
    deps.db.run(
      'DELETE FROM comments WHERE author_id = ? AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = comments.id)',
      userId,
    );
    deps.db.run('DELETE FROM users WHERE id = ?', userId);
  });
}

export function authRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/auth/register', async (c) => {
    const deps = c.var.deps;
    const slot = c.var.slot;
    if (!slot) throw new HttpError(403, 'missing_slot', 'Requests that change data must come from the app.');
    deps.limits.hit('register', c.var.ip, 5, HOUR);
    if (!deps.config.registrationOpen) throw forbidden('New accounts are not being accepted right now.');
    const body = await readJson(c, z.object({ username, password, displayName, color }));
    if (RESERVED.has(body.username) || body.username === deps.config.adminUsername) {
      throw conflict('username_taken', 'That username is taken.', { fields: { username: 'That username is taken.' } });
    }
    if (deps.db.get('SELECT 1 FROM users WHERE username = ?', body.username)) {
      throw conflict('username_taken', 'That username is taken.', { fields: { username: 'That username is taken.' } });
    }
    const hash = await hashPassword(body.password);
    const now = deps.clock.now();
    const { lastInsertRowid } = deps.db.run(
      'INSERT INTO users (username, display_name, color, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      body.username,
      body.displayName,
      body.color,
      hash,
      now,
    );
    const user = deps.db.get<UserRow>('SELECT * FROM users WHERE id = ?', lastInsertRowid)!;
    const { token } = createSession(deps, user.id);
    setSessionCookie(c, slot, token);
    return c.json(meOf(deps, user), 201);
  });

  app.post('/auth/login', async (c) => {
    const deps = c.var.deps;
    const slot = c.var.slot;
    if (!slot) throw new HttpError(403, 'missing_slot', 'Requests that change data must come from the app.');
    const body = await readJson(c, z.object({ username: z.string().max(100), password: z.string().max(PASSWORD_RULES.max) }));
    const name = body.username.trim().toLowerCase();
    deps.limits.hit('login-ip', c.var.ip, 10, 15 * MINUTE);
    deps.limits.hit('login-user', name, 10, 15 * MINUTE);
    const user = deps.db.get<UserRow>('SELECT * FROM users WHERE username = ?', name);
    if (!user) {
      await burnTime(body.password);
      throw new HttpError(401, 'bad_credentials', 'That username and password don’t match.');
    }
    if (!(await verifyPassword(body.password, user.password_hash))) {
      throw new HttpError(401, 'bad_credentials', 'That username and password don’t match.');
    }
    // A new token every time; any older session in this slot is replaced.
    if (c.var.sessionHash) revokeSession(deps, c.var.sessionHash);
    const { token } = createSession(deps, user.id);
    setSessionCookie(c, slot, token);
    return c.json(meOf(deps, user));
  });

  app.post('/auth/logout', (c) => {
    if (c.var.sessionHash) revokeSession(c.var.deps, c.var.sessionHash);
    if (c.var.slot) clearSessionCookie(c, c.var.slot);
    return c.json({ ok: true });
  });

  app.get('/me', (c) => c.json(meOf(c.var.deps, requireUser(c))));

  app.patch('/me', async (c) => {
    const deps = c.var.deps;
    const user = requireActiveUser(c);
    const body = await readJson(
      c,
      z.object({
        displayName: displayName.optional(),
        color: color.optional(),
        bio: z
          .string()
          .transform((s) => cleanText(s, { multiline: true }))
          .pipe(z.string().max(300, 'Use at most 300 characters.'))
          .optional(),
      }),
    );
    deps.db.run(
      'UPDATE users SET display_name = COALESCE(?, display_name), color = COALESCE(?, color), bio = COALESCE(?, bio) WHERE id = ?',
      body.displayName ?? null,
      body.color ?? null,
      body.bio ?? null,
      user.id,
    );
    return c.json(meOf(deps, deps.db.get<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!));
  });

  app.post('/me/password', async (c) => {
    const deps = c.var.deps;
    const user = requireUser(c);
    deps.limits.hit('password', String(user.id), 10, HOUR);
    const body = await readJson(c, z.object({ current: z.string().max(PASSWORD_RULES.max), next: password }));
    if (!(await verifyPassword(body.current, user.password_hash))) {
      throw badRequest('Your current password is not right.', { fields: { current: 'Not right.' } });
    }
    deps.db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(body.next), user.id);
    revokeOtherSessions(deps, user.id, c.var.sessionHash);
    return c.json({ ok: true });
  });

  app.delete('/me', async (c) => {
    const deps = c.var.deps;
    const user = requireUser(c);
    const body = await readJson(c, z.object({ password: z.string().max(PASSWORD_RULES.max) }));
    if (!(await verifyPassword(body.password, user.password_hash))) {
      throw badRequest('That password is not right.', { fields: { password: 'Not right.' } });
    }
    if (user.role === 'admin') throw forbidden('The administrator account is set by the server and cannot be deleted here.');
    deleteAccount(deps, user.id);
    if (c.var.slot) clearSessionCookie(c, c.var.slot);
    return c.json({ ok: true });
  });

  return app;
}

/** Creates or updates the administrator from ADMIN_USERNAME/ADMIN_PASSWORD at startup. */
export async function bootstrapAdmin(deps: Deps) {
  const { adminUsername, adminPassword } = deps.config;
  if (!adminUsername || !adminPassword) return;
  const existing = deps.db.get<UserRow>('SELECT * FROM users WHERE username = ?', adminUsername);
  if (!existing) {
    deps.db.run(
      `INSERT INTO users (username, display_name, color, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)`,
      adminUsername,
      'Admin',
      '#5b3df5',
      await hashPassword(adminPassword),
      deps.clock.now(),
    );
    return;
  }
  const same = await verifyPassword(adminPassword, existing.password_hash);
  deps.db.run(
    `UPDATE users SET role = 'admin', banned_at = NULL, password_hash = COALESCE(?, password_hash) WHERE id = ?`,
    same ? null : await hashPassword(adminPassword),
    existing.id,
  );
}
