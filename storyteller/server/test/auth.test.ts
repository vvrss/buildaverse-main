import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, type Server, makeServer } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await makeServer();
});
afterEach(() => server.close());

describe('accounts', () => {
  it('registers, signs in and out, and reads /me', async () => {
    const c = server.client();
    const me = await c.register('mira');
    expect(me).toMatchObject({ username: 'mira', displayName: 'Mira', role: 'user', unreadNotifications: 0 });
    expect((await c.get('/api/me')).body.username).toBe('mira');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/me')).status).toBe(401);
    expect((await c.login('MIRA ', 'password-123')).status).toBe(200);
    expect((await c.get('/api/me')).body.username).toBe('mira');
    expect((await c.login('mira', 'wrong-password')).status).toBe(401);
  });

  it('refuses taken, reserved and badly formed usernames, and short passwords', async () => {
    const c = server.client();
    await c.register('mira');
    const again = await server.client().post('/api/auth/register', { username: 'Mira', password: 'password-123', displayName: 'M', color: '#000000' });
    expect(again.status).toBe(409);
    expect(again.body.error.fields.username).toBeTruthy();
    for (const username of ['admin', 'me', 'a', 'bad name!']) {
      const r = await server.client().post('/api/auth/register', { username, password: 'password-123', displayName: 'X', color: '#000000' });
      expect(r.status, username).toBeGreaterThanOrEqual(400);
    }
    const short = await server.client().post('/api/auth/register', { username: 'shorty', password: 'abc', displayName: 'X', color: '#000000' });
    expect(short.status).toBe(400);
    expect(short.body.error.fields.password).toMatch(/at least/);
  });

  it('keeps one session per device profile, even in one browser', async () => {
    const first = server.client();
    await first.register('ana');
    // A second profile in the same browser: same cookie jar, its own slot.
    const second = new Client(server.app);
    for (const [k, v] of first.cookies) second.cookies.set(k, v);
    expect((await second.get('/api/me')).status).toBe(401);
    await second.register('tom');
    expect((await first.get('/api/me')).body.username).toBe('ana');
    expect((await second.get('/api/me')).body.username).toBe('tom');
  });

  it('protects writes: the slot header is required and other sites are refused', async () => {
    const c = server.client();
    await c.register('ana');
    const noSlot = await c.raw('POST', '/api/stories', { noSlot: true, headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(noSlot.status).toBe(403);
    expect(((await noSlot.json()) as { error: { code: string } }).error.code).toBe('missing_slot');
    const cross = await c.json('POST', '/api/stories', { title: 'x', clientKey: 'k' }, { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    expect(cross.body.error.code).toBe('bad_origin');
    const same = await c.json('POST', '/api/stories', { title: 'x', clientKey: 'k' }, { origin: 'http://test.local' });
    expect(same.status).toBe(201);
  });

  it('asks outdated apps to update', async () => {
    const r = await server.client().json('GET', '/api/health', undefined, { 'x-storyteller-client': '0.1.0' });
    expect(r.status).toBe(426);
    const ok = await server.client().json('GET', '/api/health', undefined, { 'x-storyteller-client': '0.4.0' });
    expect(ok.body).toEqual({ ok: true, version: '9.9.9-test', registrationOpen: true });
  });

  it('changing the password signs out other devices; deleting the account needs it too', async () => {
    const a = server.client();
    await a.register('ana');
    const b = server.client();
    await b.login('ana', 'password-123');
    expect((await a.post('/api/me/password', { current: 'nope', next: 'new-password-1' })).status).toBe(400);
    expect((await a.post('/api/me/password', { current: 'password-123', next: 'new-password-1' })).status).toBe(200);
    expect((await b.get('/api/me')).status).toBe(401);
    expect((await a.get('/api/me')).status).toBe(200);
    expect((await a.del('/api/me', { password: 'password-123' })).status).toBe(400);
    expect((await a.del('/api/me', { password: 'new-password-1' })).status).toBe(200);
    expect((await a.login('ana', 'new-password-1')).status).toBe(401);
  });

  it('creates the administrator from the environment, and the name cannot be registered', async () => {
    const admin = server.client();
    expect((await admin.login('admin', 'admin-password-1')).body.role).toBe('admin');
    const r = await server.client().post('/api/auth/register', { username: 'admin', password: 'password-123', displayName: 'A', color: '#000000' });
    expect(r.status).toBe(409);
    expect((await admin.del('/api/me', { password: 'admin-password-1' })).status).toBe(403);
  });

  it('can close registration', async () => {
    const closed = await makeServer({ registrationOpen: false });
    const r = await closed.client().post('/api/auth/register', { username: 'late', password: 'password-123', displayName: 'L', color: '#000000' });
    expect(r.status).toBe(403);
    closed.close();
  });

  it('rate-limits password guessing', async () => {
    const limited = await makeServer({ rateLimits: true });
    const c = limited.client();
    await c.register('ana');
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) codes.push((await c.login('ana', `guess-${i}-xx`)).status);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    limited.close();
  });

  it('renews sessions that are getting old and expires dead ones', async () => {
    const c = server.client();
    await c.register('ana');
    server.clock.t += 20 * 24 * 60 * 60 * 1000;
    const renewed = await c.get('/api/me');
    expect(renewed.status).toBe(200);
    expect(renewed.headers.getSetCookie().join()).toMatch(/st_/);
    server.clock.t += 31 * 24 * 60 * 60 * 1000;
    expect((await c.get('/api/me')).status).toBe(401);
  });

  it('answers unknown API routes with JSON 404', async () => {
    const r = await server.client().get('/api/nothing-here');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });
});
