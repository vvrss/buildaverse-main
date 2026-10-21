import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectGarbage } from '../media/gc';
import { type Server, STORY_TEXT, makeServer, png, publish, ref, writerWithStory } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await makeServer();
});
afterEach(() => server.close());

const DAY = 24 * 60 * 60 * 1000;

describe('pictures', () => {
  it('re-encodes uploads upright, at several widths, without camera data', async () => {
    const c = server.client();
    await c.register('ana');
    const photo = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#d62828' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Make: 'TestCam' } } })
      .toBuffer();
    const up = await c.upload(ref(1), photo);
    expect(up.status).toBe(200);
    // 2400×1200 shot sideways is 1200×2400 upright.
    expect(up.body.media).toMatchObject({ w: 1200, h: 2400, widths: [160, 480, 960, 1200], avif: true });

    const res = await c.raw('GET', `/media/${up.body.media.id}/480.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    const served = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(served).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['webp', 480, 960, undefined]);
    expect(served.includes(Buffer.from('TestCam'))).toBe(false);

    const avif = await c.raw('GET', `/media/${up.body.media.id}/480.avif`);
    expect(avif.headers.get('content-type')).toBe('image/avif');
    expect((await c.raw('GET', `/media/${up.body.media.id}/500.webp`)).status).toBe(404);
  });

  it('refuses things that are not pictures, whatever they claim', async () => {
    const c = server.client();
    await c.register('ana');
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect((await c.upload(ref(2), html)).status).toBe(415);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await c.upload(ref(3), svg)).status).toBe(415);
    expect((await c.upload('not-a-ref', await png('#000'))).status).toBe(400);
    const anon = server.client();
    expect((await anon.upload(ref(4), await png('#000'))).status).toBe(401);
  });

  it('stores identical pictures once, while each writer only reaches their own codes', async () => {
    const a = server.client();
    await a.register('ana');
    const b = server.client();
    await b.register('tom');
    const same = await png('#2a9d8f');
    const ua = await a.upload(ref(10), same);
    const ub = await b.upload(ref(99), same);
    expect(ua.body.media.id).toBe(ub.body.media.id);
    expect(server.deps.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM blobs')!.n).toBe(1);
    expect((await a.post('/api/images/missing', { refs: [ref(10), ref(99)] })).body.missing).toEqual([ref(99)]);
    // Tom cannot publish with Ana's code.
    const { c, chapterId } = await writerWithStory(server, 'third');
    const r = await publish(c, chapterId, 'Uses another code', STORY_TEXT(`![x](img:${ref(10)})`));
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'missing_images', refs: [ref(10)] });
  });

  it('enforces the storage quota', async () => {
    const small = await makeServer({ quotaBytes: 1 });
    const c = small.client();
    await c.register('ana');
    const r = await c.upload(ref(1), await png('#123456'));
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('quota_exceeded');
    small.close();
  });

  it('cleans up pictures nothing uses, after a week', async () => {
    const { c, chapterId } = await writerWithStory(server);
    const kept = await c.upload(ref(1), await png('#111111'));
    const unused = await c.upload(ref(2), await png('#222222'));
    expect((await publish(c, chapterId, 'One', STORY_TEXT(`![kept](img:${ref(1)})`))).status).toBe(201);
    expect(collectGarbage(server.deps)).toEqual({ uploads: 0, blobs: 0 });
    server.clock.t += 8 * DAY;
    expect(collectGarbage(server.deps)).toEqual({ uploads: 1, blobs: 1 });
    expect((await c.raw('GET', `/media/${unused.body.media.id}/64.webp`)).status).toBe(404);
    expect((await c.raw('GET', `/media/${kept.body.media.id}/64.webp`)).status).toBe(200);
  });
});
