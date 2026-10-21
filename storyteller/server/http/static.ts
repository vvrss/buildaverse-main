import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

interface Entry {
  body: Buffer;
  type: string;
  cache: string;
}

/**
 * Serves the built app from a manifest made at startup: only files that
 * exist in dist/ are served, by exact path, so no request can reach anything
 * else on disk. Hash routing means no SPA fallback is needed.
 */
export function staticFiles(distDir: string): MiddlewareHandler<AppEnv> {
  const files = new Map<string, Entry>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const path = `/${relative(distDir, full).split(sep).join('/')}`;
        const ext = extname(name).toLowerCase();
        const immutable = path.startsWith('/assets/');
        const revalidate = path === '/index.html' || path === '/sw.js' || path.endsWith('.webmanifest') || path === '/registerSW.js';
        files.set(path, {
          body: readFileSync(full),
          type: TYPES[ext] ?? 'application/octet-stream',
          cache: immutable ? 'public, max-age=31536000, immutable' : revalidate ? 'no-cache' : 'public, max-age=86400',
        });
      }
    }
  };
  if (existsSync(distDir)) walk(distDir);

  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    const path = c.req.path === '/' ? '/index.html' : c.req.path;
    const entry = files.get(path);
    if (!entry) return next();
    c.header('Content-Type', entry.type);
    c.header('Cache-Control', entry.cache);
    if (path === '/sw.js') c.header('Service-Worker-Allowed', '/');
    if (c.req.method === 'HEAD') return c.body(null);
    return c.body(new Uint8Array(entry.body));
  };
}

/** The built index.html, for share pages to borrow nothing but the app name. */
export function hasApp(distDir: string): boolean {
  return existsSync(join(distDir, 'index.html'));
}
