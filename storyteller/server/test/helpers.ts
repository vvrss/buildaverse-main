import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../app';
import type { Config } from '../config';
import type { Deps } from '../context';
import { Db } from '../db';
import { RateLimiter } from '../http/ratelimit';
import { MediaStore } from '../media/store';
import { bootstrapAdmin } from '../routes/auth';

/** A server with its own temporary data folder and a clock tests can move. */
export async function makeServer(overrides: Partial<Config> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'storyteller-test-'));
  const config: Config = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    ephemeral: true,
    publicOrigin: null,
    adminUsername: 'admin',
    adminPassword: 'admin-password-1',
    registrationOpen: true,
    trustProxy: false,
    rateLimits: false,
    minClient: '0.3.0',
    production: false,
    distDir: join(dataDir, 'no-app'),
    version: '9.9.9-test',
    quotaBytes: 250 * 1024 * 1024,
    ...overrides,
  };
  const clock = { t: Date.UTC(2026, 0, 1), now() { return this.t; } };
  const deps: Deps = { db: new Db(join(dataDir, 'test.db')), config, clock, limits: new RateLimiter(clock, config.rateLimits), media: new MediaStore(dataDir) };
  await bootstrapAdmin(deps);
  const app = createApp(deps);
  const close = () => {
    deps.limits.stop();
    deps.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { app, deps, clock, close, client: (slot?: string) => new Client(app, slot) };
}

export type Server = Awaited<ReturnType<typeof makeServer>>;

/** One device profile talking to the server: its slot header and its cookies. */
export class Client {
  readonly cookies = new Map<string, string>();
  constructor(
    private readonly app: ReturnType<typeof createApp>,
    readonly slot = randomBytes(8).toString('hex'),
  ) {}

  async raw(method: string, path: string, init: { body?: RequestInit['body']; headers?: Record<string, string>; noSlot?: boolean } = {}) {
    const headers: Record<string, string> = { ...init.headers };
    if (!init.noSlot) headers['x-storyteller-slot'] = this.slot;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.app.request(`http://test.local${path}`, { method, headers, body: init.body });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [name, value] = pair.split('=');
      if (attrs.some((a) => /max-age=0/i.test(a)) || value === '') this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }
    return res;
  }

  /** JSON request; returns status and parsed body. */
  async json<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.raw(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  }

  get = <T = any>(path: string) => this.json<T>('GET', path);
  post = <T = any>(path: string, body: unknown = {}) => this.json<T>('POST', path, body);
  put = <T = any>(path: string, body: unknown = {}) => this.json<T>('PUT', path, body);
  patch = <T = any>(path: string, body: unknown = {}) => this.json<T>('PATCH', path, body);
  del = <T = any>(path: string, body?: unknown) => this.json<T>('DELETE', path, body);

  async register(username: string, password = 'password-123') {
    const r = await this.post('/api/auth/register', { username, password, displayName: username[0].toUpperCase() + username.slice(1), color: '#e76f51' });
    if (r.status !== 201) throw new Error(`register ${username}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async login(username: string, password: string) {
    return this.post('/api/auth/login', { username, password });
  }

  async upload(ref: string, data: Buffer) {
    const res = await this.raw('PUT', `/api/images/${ref}`, { body: new Uint8Array(data), headers: { 'content-type': 'application/octet-stream' } });
    return { status: res.status, body: (await res.json()) as any };
  }
}

/** A small solid picture, distinct per color. */
export const png = (color: string, w = 64, h = 48) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

export const ref = (n: number) => n.toString(16).padStart(16, '0');

export const STORY_TEXT = (extra = '') => `---
title: Episode text
characters:
  ana: Ana  #e76f51
  tom: Tom  #2a9d8f
---

@ana: Did you hear that?
// note: keep this private
@tom: Stay still.
${extra}`;

/** Registers a writer with one story (first chapter) and returns ids. */
export async function writerWithStory(server: Server, username = 'writer') {
  const c = server.client();
  await c.register(username);
  const created = await c.post('/api/stories', { title: 'The Lighthouse', clientKey: `story-${username}`, genre: 'Mystery', tags: ['sea', 'storm'] });
  const story = created.body.story;
  return { c, storyId: story.id as string, chapterId: story.chapters[0].id as string };
}

export async function publish(c: Client, chapterId: string, title: string, text = STORY_TEXT(), extra: Record<string, unknown> = {}) {
  return c.post(`/api/chapters/${chapterId}/episodes`, { clientKey: `ep-${title}`, title, text, ...extra });
}
