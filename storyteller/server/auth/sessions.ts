import { randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Deps, UserRow } from '../context';
import { HttpError, forbidden, unauthorized } from '../http/errors';
import { sha256 } from '../util';

/**
 * Sessions are per device profile. Several on-device profiles share one
 * browser (and one cookie jar), so each sends its own slot id in
 * X-Storyteller-Slot and gets its own cookie, st_<slot>. The custom header
 * also protects against CSRF: other sites cannot send it without a CORS
 * preflight, which this server never approves.
 */

export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;
export const SLOT_RE = /^[0-9a-f]{16}$/;

const cookieName = (slot: string) => `st_${slot}`;

export function createSession(deps: Deps, userId: number): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  const hash = sha256(token);
  const now = deps.clock.now();
  deps.db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', hash, userId, now, now + SESSION_MS);
  return { token, hash };
}

export function setSessionCookie(c: Context<AppEnv>, slot: string, token: string) {
  const { config } = c.var.deps;
  setCookie(c, cookieName(slot), token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api',
    maxAge: SESSION_MS / 1000,
    secure: config.publicOrigin?.startsWith('https:') ?? false,
  });
}

export function clearSessionCookie(c: Context<AppEnv>, slot: string) {
  deleteCookie(c, cookieName(slot), { path: '/api' });
}

export function revokeSession(deps: Deps, hash: string) {
  deps.db.run('DELETE FROM sessions WHERE token_hash = ?', hash);
}

export function revokeOtherSessions(deps: Deps, userId: number, keepHash: string | null) {
  deps.db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?', userId, keepHash);
}

/** Reads the slot and session for every /api request. */
export function sessionMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deps = c.var.deps;
    const rawSlot = c.req.header('x-storyteller-slot') ?? null;
    const slot = rawSlot && SLOT_RE.test(rawSlot) ? rawSlot : null;
    c.set('slot', slot);
    c.set('user', null);
    c.set('sessionHash', null);
    if (slot) {
      const token = getCookie(c, cookieName(slot));
      if (token && token.length <= 100) {
        const hash = sha256(token);
        const now = deps.clock.now();
        const row = deps.db.get<UserRow & { expires_at: number }>(
          `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
          hash,
        );
        if (row && row.expires_at > now) {
          if (row.expires_at - now < RENEW_BELOW_MS) {
            deps.db.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', now + SESSION_MS, hash);
            setSessionCookie(c, slot, token);
          }
          const { expires_at: _expires, ...user } = row;
          c.set('user', user);
          c.set('sessionHash', hash);
        } else if (row) {
          revokeSession(deps, hash);
        }
      }
    }
    await next();
  };
}

export function requireUser(c: Context<AppEnv>): UserRow {
  const user = c.var.user;
  if (!user) throw unauthorized();
  return user;
}

/** Signed in and not banned: needed for anything that writes. */
export function requireActiveUser(c: Context<AppEnv>): UserRow {
  const user = requireUser(c);
  if (user.banned_at) throw new HttpError(403, 'banned', 'This account was suspended by a moderator.');
  return user;
}

export const isModerator = (user: UserRow | null) => !!user && (user.role === 'moderator' || user.role === 'admin');

export function requireModerator(c: Context<AppEnv>): UserRow {
  const user = requireActiveUser(c);
  if (!isModerator(user)) throw forbidden('Only moderators can do that.');
  return user;
}

export function requireAdmin(c: Context<AppEnv>): UserRow {
  const user = requireActiveUser(c);
  if (user.role !== 'admin') throw forbidden('Only the administrator can do that.');
  return user;
}
