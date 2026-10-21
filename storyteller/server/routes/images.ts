import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { requireActiveUser } from '../auth/sessions';
import type { AppEnv } from '../context';
import { HttpError, badRequest } from '../http/errors';
import { HOUR } from '../http/ratelimit';
import { readJson } from '../http/validate';
import { JobQueue, MAX_UPLOAD_BYTES, processImage } from '../media/process';
import { BLOB_RE } from '../media/store';
import { mediaInfo } from '../queries';
import { sha256 } from '../util';

export const REF_RE = /^[0-9a-f]{16}$/;
const MIN_FREE_BYTES = 512 * 1024 * 1024;

export function imageRoutes() {
  const app = new Hono<AppEnv>();
  const jobs = new JobQueue();

  /** Which of these picture codes the server doesn't have for you yet. */
  app.post('/images/missing', async (c) => {
    const user = requireActiveUser(c);
    const { refs } = await readJson(c, z.object({ refs: z.array(z.string().regex(REF_RE)).max(200) }));
    if (refs.length === 0) return c.json({ missing: [] });
    const have = new Set(
      c.var.deps.db
        .all<{ ref: string }>(
          `SELECT ref FROM uploads WHERE user_id = ? AND ref IN (${refs.map(() => '?').join(',')})`,
          user.id,
          ...refs,
        )
        .map((r) => r.ref),
    );
    return c.json({ missing: [...new Set(refs)].filter((r) => !have.has(r)) });
  });

  /** Uploads one picture under your picture code. Repeating it is harmless. */
  app.put(
    '/images/:ref',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: () => {
        throw new HttpError(413, 'image_too_large', 'Pictures can be at most 8 MB.');
      },
    }),
    async (c) => {
      const deps = c.var.deps;
      const user = requireActiveUser(c);
      const ref = c.req.param('ref');
      if (!REF_RE.test(ref)) throw badRequest('Bad picture code.');
      deps.limits.hit('upload', String(user.id), 120, HOUR);

      const buf = Buffer.from(await c.req.arrayBuffer());
      if (buf.length === 0) throw badRequest('The picture is empty.');
      const blob = sha256(buf);
      const now = deps.clock.now();

      let row = deps.db.get<{ id: string; width: number; height: number; widths: string; bytes: number }>(
        'SELECT * FROM blobs WHERE id = ?',
        blob,
      );
      if (!row) {
        const used = deps.db.get<{ n: number }>(
          `SELECT COALESCE(SUM(b.bytes), 0) AS n FROM blobs b WHERE b.id IN (SELECT blob_id FROM uploads WHERE user_id = ?)`,
          user.id,
        )!.n;
        if (used + buf.length > deps.config.quotaBytes) {
          throw new HttpError(413, 'quota_exceeded', 'You have used all your picture storage. Remove pictures from unpublished drafts or delete old episodes.');
        }
        if (deps.media.freeBytes() < MIN_FREE_BYTES) {
          throw new HttpError(507, 'disk_full', 'The server is out of space for pictures right now.');
        }
        const processed = await jobs.run(() => processImage(buf));
        deps.media.write(blob, processed.variants);
        const bytes = processed.variants.reduce((sum, v) => sum + v.data.length, 0);
        deps.db.run(
          'INSERT OR IGNORE INTO blobs (id, width, height, widths, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          blob,
          processed.width,
          processed.height,
          JSON.stringify(processed.widths),
          bytes,
          now,
        );
        row = deps.db.get('SELECT * FROM blobs WHERE id = ?', blob)!;
      }
      deps.db.run(
        `INSERT INTO uploads (user_id, ref, blob_id, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, ref) DO UPDATE SET blob_id = excluded.blob_id, created_at = excluded.created_at`,
        user.id,
        ref,
        blob,
        now,
      );
      return c.json({ ref, media: mediaInfo(row) });
    },
  );

  return app;
}

/** GET /media/<blob>/<width>.webp: processed pictures, cached forever. */
export function mediaRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/media/:blob/:file', async (c) => {
    const deps = c.var.deps;
    const blob = c.req.param('blob');
    const m = /^(\d{2,4})\.webp$/.exec(c.req.param('file'));
    if (!BLOB_RE.test(blob) || !m) return c.notFound();
    const width = Number(m[1]);
    const row = deps.db.get<{ widths: string }>('SELECT widths FROM blobs WHERE id = ?', blob);
    if (!row || !(JSON.parse(row.widths) as number[]).includes(width)) return c.notFound();
    let data: Buffer;
    try {
      data = await deps.media.read(blob, width);
    } catch {
      return c.notFound();
    }
    c.header('Content-Type', 'image/webp');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    return c.body(new Uint8Array(data));
  });
  return app;
}
