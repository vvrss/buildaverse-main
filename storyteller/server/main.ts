import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { hashPassword } from './auth/password';
import { loadConfig } from './config';
import type { Deps } from './context';
import { Db } from './db';
import { RateLimiter } from './http/ratelimit';
import { collectGarbage } from './media/gc';
import { MediaStore } from './media/store';
import { bootstrapAdmin } from './routes/auth';
import { systemClock } from './util';

declare const __APP_VERSION__: string | undefined;

/**
 * Entry point. `node dist-server/main.js` serves; the other commands are for
 * the operator:
 *   gc                         remove pictures nothing uses
 *   reset-password <username>  set a new password (NEW_PASSWORD, or a random one is printed)
 *   backup <file>              write a consistent copy of the database
 */
const here = dirname(fileURLToPath(import.meta.url));
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
const GC_EVERY_MS = 6 * 60 * 60 * 1000;

function open(): Deps {
  const config = loadConfig(process.env, { distDir: resolve(here, '../dist'), version });
  if (config.production && !config.publicOrigin) {
    throw new Error('Set PUBLIC_ORIGIN (for example https://stories.example.com) in production.');
  }
  mkdirSync(config.dataDir, { recursive: true });
  const db = new Db(join(config.dataDir, 'storyteller.db'));
  return { db, config, clock: systemClock, limits: new RateLimiter(systemClock, config.rateLimits), media: new MediaStore(config.dataDir) };
}

async function main() {
  const [command = 'serve', ...args] = process.argv.slice(2);
  const deps = open();

  if (command === 'gc') {
    const r = collectGarbage(deps);
    console.log(`Removed ${r.uploads} unused picture codes and ${r.blobs} stored pictures.`);
    return finish(deps);
  }
  if (command === 'reset-password') {
    const name = (args[0] ?? '').toLowerCase();
    const user = deps.db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', name);
    if (!user) throw new Error(`No account named "${name}".`);
    const given = process.env.NEW_PASSWORD;
    const password = given && given.length >= 8 ? given : randomBytes(9).toString('base64url');
    const hash = await hashPassword(password);
    deps.db.tx(() => {
      deps.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
      deps.db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    });
    console.log(given ? `Password for @${name} changed. They are signed out everywhere.` : `New password for @${name}: ${password}`);
    return finish(deps);
  }
  if (command === 'backup') {
    const file = resolve(args[0] ?? `storyteller-${new Date().toISOString().slice(0, 10)}.db`);
    deps.db.raw.prepare('VACUUM INTO ?').run(file);
    console.log(`Database copied to ${file}. Copy ${join(deps.config.dataDir, 'media')} too for the pictures.`);
    return finish(deps);
  }
  if (command !== 'serve') throw new Error(`Unknown command "${command}". Use serve, gc, reset-password or backup.`);

  await bootstrapAdmin(deps);
  const app = createApp(deps);
  const server = serve({ fetch: app.fetch, port: deps.config.port, hostname: deps.config.host }, (info) => {
    console.log(`Storyteller ${version} on http://${info.address}:${info.port} (data in ${deps.config.dataDir})`);
  });
  const gc = setInterval(() => {
    try {
      collectGarbage(deps);
    } catch (err) {
      console.error('[gc]', err);
    }
  }, GC_EVERY_MS);
  gc.unref();

  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    clearInterval(gc);
    server.close(() => {
      finish(deps);
      process.exit(0);
    });
    setTimeout(() => {
      finish(deps);
      process.exit(0);
    }, 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

function finish(deps: Deps) {
  deps.limits.stop();
  try {
    deps.db.close();
  } catch {
    // Already closed.
  }
  if (deps.config.ephemeral) rmSync(deps.config.dataDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
