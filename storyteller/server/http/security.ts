import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { compareVersions } from '../config';
import type { AppEnv } from '../context';
import { HttpError } from './errors';

/** The client's address, for rate limits only (never stored). */
export function clientIp(c: Context<AppEnv>): string {
  if (c.var.deps.config.trustProxy) {
    const fly = c.req.header('fly-client-ip');
    if (fly) return fly;
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',').map((s) => s.trim()).filter(Boolean).pop() ?? 'unknown';
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'local';
  }
}

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Inline styles: the app sets CSS variables per element, and the print frame uses a <style> block.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Headers on every response. */
export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'same-origin');
    h.set('X-Frame-Options', 'DENY');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    if (c.var.deps.config.publicOrigin?.startsWith('https:')) {
      h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    if ((h.get('Content-Type') ?? '').startsWith('text/html') && !h.has('Content-Security-Policy')) {
      h.set('Content-Security-Policy', CSP);
    }
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * For /api: no caching, the client-version gate, and CSRF protection on
 * every write (the slot header plus an Origin check).
 */
export function apiGuards(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('ip', clientIp(c));
    const { config, limits } = c.var.deps;
    limits.hit('global', c.var.ip, 600, 60_000);

    const client = c.req.header('x-storyteller-client');
    if (client && /^\d+\.\d+\.\d+$/.test(client) && compareVersions(client, config.minClient) < 0) {
      throw new HttpError(426, 'client_outdated', 'This version of Storyteller is too old for the server. Update the app.');
    }

    if (!SAFE.has(c.req.method)) {
      if (!c.req.header('x-storyteller-slot')) {
        throw new HttpError(403, 'missing_slot', 'Requests that change data must come from the app.');
      }
      const origin = c.req.header('origin');
      if (origin) {
        const allowed = config.publicOrigin ?? new URL(c.req.url).origin;
        if (origin !== allowed) throw new HttpError(403, 'bad_origin', 'Requests from other sites are not allowed.');
      }
    }
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  };
}
