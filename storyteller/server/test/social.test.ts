import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Server, makeServer, publish, writerWithStory } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await makeServer();
});
afterEach(() => server.close());

const HOUR = 60 * 60 * 1000;

async function setup() {
  const w = await writerWithStory(server);
  const ep = (await publish(w.c, w.chapterId, 'Pilot')).body.episode;
  const reader = server.client();
  await reader.register('reader');
  return { ...w, ep, reader };
}

describe('likes, follows and the feed', () => {
  it('counts likes once and tells the author', async () => {
    const { c, ep, reader } = await setup();
    expect((await reader.put(`/api/episodes/${ep.id}/like`)).body).toEqual({ liked: true, likes: 1 });
    expect((await reader.put(`/api/episodes/${ep.id}/like`)).body).toEqual({ liked: true, likes: 1 });
    expect((await server.client().get(`/api/episodes/${ep.id}`)).body.likes).toBe(1);
    const notes = (await c.get('/api/notifications')).body.items;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'like', actor: { username: 'reader' }, episode: { id: ep.id, number: 1 } });
    expect((await reader.del(`/api/episodes/${ep.id}/like`)).body).toEqual({ liked: false, likes: 0 });
    expect((await server.client().put(`/api/episodes/${ep.id}/like`)).status).toBe(401);
  });

  it('puts new episodes of followed stories and writers in the feed, and notifies once', async () => {
    const { c, storyId, chapterId, reader } = await setup();
    await reader.put(`/api/stories/${storyId}/follow`);
    await reader.put('/api/users/writer/follow');
    expect((await reader.put('/api/users/reader/follow')).status).toBe(422);
    server.clock.t += 1000;
    const ep2 = (await publish(c, chapterId, 'Second')).body.episode;
    const feed = (await reader.get('/api/feed')).body.items;
    expect(feed.map((f: { episode: { title: string } }) => f.episode.title)).toEqual(['Second', 'Pilot']);
    expect(feed[0].episode.number).toBe(2);
    const notes = (await reader.get('/api/notifications')).body.items;
    expect(notes.filter((n: { kind: string }) => n.kind === 'episode')).toHaveLength(1);
    expect((await reader.get('/api/me')).body.unreadNotifications).toBe(1);
    await reader.post('/api/notifications/read', {});
    expect((await reader.get('/api/me')).body.unreadNotifications).toBe(0);
    const story = (await reader.get(`/api/stories/${storyId}`)).body;
    expect(story.viewer).toMatchObject({ following: true, followingAuthor: true });
    expect((await c.get('/api/notifications')).body.items.some((n: { kind: string }) => n.kind === 'follow')).toBe(true);
    expect((await reader.get('/api/me/following')).body.writers.map((w: { username: string }) => w.username)).toEqual(['writer']);
    void ep2;
  });

  it('remembers where you got to', async () => {
    const { c, storyId, chapterId, ep, reader } = await setup();
    const ep2 = (await publish(c, chapterId, 'Second')).body.episode;
    await reader.put(`/api/episodes/${ep.id}/progress`);
    const reading = (await reader.get('/api/me/reading')).body.items;
    expect(reading[0]).toMatchObject({ story: { id: storyId }, current: { id: ep.id, number: 1 }, next: { id: ep2.id, number: 2 } });
    expect((await reader.get(`/api/stories/${storyId}`)).body.viewer.progress).toMatchObject({ id: ep.id });
  });

  it('shows a writer page with their published stories', async () => {
    const { storyId, reader } = await setup();
    const page = (await reader.get('/api/users/writer')).body;
    expect(page).toMatchObject({ username: 'writer', followers: 0, viewer: { isSelf: false } });
    expect(page.stories.map((s: { id: string }) => s.id)).toEqual([storyId]);
    expect((await reader.get('/api/users/nobody')).status).toBe(404);
  });
});

describe('comments', () => {
  it('threads replies one level deep and notifies the right people', async () => {
    const { c, ep, reader } = await setup();
    const top = (await reader.post(`/api/episodes/${ep.id}/comments`, { body: 'Great start!' })).body;
    const reply = (await c.post(`/api/episodes/${ep.id}/comments`, { body: 'Thank you', parentId: top.id })).body;
    // A reply to a reply joins the same thread.
    await reader.post(`/api/episodes/${ep.id}/comments`, { body: 'You are welcome', parentId: reply.id });
    const list = (await server.client().get(`/api/episodes/${ep.id}/comments`)).body.items;
    expect(list).toHaveLength(1);
    expect(list[0].replies.map((r: { body: string }) => r.body)).toEqual(['Thank you', 'You are welcome']);
    const readerNotes = (await reader.get('/api/notifications')).body.items.map((n: { kind: string }) => n.kind);
    expect(readerNotes).toEqual(['reply']);
    const writerNotes = (await c.get('/api/notifications')).body.items.map((n: { kind: string }) => n.kind);
    expect(writerNotes).toEqual(['reply', 'comment']);
    expect((await server.client().get(`/api/episodes/${ep.id}`)).body.comments).toBe(3);
  });

  it('can be edited for a day, liked, and deleted (kept as "deleted" when it has replies)', async () => {
    const { c, ep, reader } = await setup();
    const top = (await reader.post(`/api/episodes/${ep.id}/comments`, { body: 'Frist!' })).body;
    expect(top.viewer).toMatchObject({ canEdit: true, canDelete: true });
    const edited = await reader.patch(`/api/comments/${top.id}`, { body: 'First!' });
    expect(edited.body).toMatchObject({ body: 'First!' });
    expect(edited.body.editedAt).toBeTruthy();
    expect((await c.patch(`/api/comments/${top.id}`, { body: 'Not yours' })).status).toBe(403);
    expect((await c.put(`/api/comments/${top.id}/like`)).body).toEqual({ liked: true, likes: 1 });
    await c.post(`/api/episodes/${ep.id}/comments`, { body: 'A reply', parentId: top.id });
    server.clock.t += 25 * HOUR;
    expect((await reader.patch(`/api/comments/${top.id}`, { body: 'Too late' })).status).toBe(403);
    // The episode's author may remove comments on it.
    expect((await c.del(`/api/comments/${top.id}`)).status).toBe(200);
    const list = (await server.client().get(`/api/episodes/${ep.id}/comments`)).body.items;
    expect(list[0]).toMatchObject({ deleted: true, body: '', author: null });
    expect(list[0].replies).toHaveLength(1);
  });

  it('rejects empty or huge comments, and comments on episodes you cannot see', async () => {
    const { ep, reader } = await setup();
    expect((await reader.post(`/api/episodes/${ep.id}/comments`, { body: '   ' })).status).toBe(400);
    expect((await reader.post(`/api/episodes/${ep.id}/comments`, { body: 'x'.repeat(2001) })).status).toBe(400);
    expect((await reader.post('/api/episodes/AAAAAAAAAAAA/comments', { body: 'hi' })).status).toBe(404);
  });
});

describe('moderation', () => {
  async function mod() {
    const admin = server.client();
    await admin.login('admin', 'admin-password-1');
    return admin;
  }

  it('turns reports into a queue that moderators resolve by hiding', async () => {
    const { storyId, ep, reader } = await setup();
    const other = server.client();
    await other.register('other');
    expect((await reader.post('/api/reports', { targetKind: 'episode', targetId: ep.id, reason: 'spam' })).status).toBe(201);
    // Reporting twice is harmless; two people count twice.
    await reader.post('/api/reports', { targetKind: 'episode', targetId: ep.id, reason: 'spam', details: 'ads' });
    await other.post('/api/reports', { targetKind: 'episode', targetId: ep.id, reason: 'harassment' });
    expect((await reader.get('/api/mod/reports')).status).toBe(403);
    const admin = await mod();
    const queue = (await admin.get('/api/mod/reports')).body.items;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ targetKind: 'episode', targetId: ep.id, count: 2, targetLink: `#/c/e/${ep.id}` });

    expect((await admin.put(`/api/mod/episodes/${ep.id}/hidden`)).status).toBe(200);
    expect((await server.client().get(`/api/episodes/${ep.id}`)).status).toBe(404);
    // The story had only that episode, so it drops out of Discover too.
    expect((await server.client().get('/api/stories')).body.items).toEqual([]);
    expect((await admin.post('/api/mod/reports/resolve', { targetKind: 'episode', targetId: ep.id, resolution: 'actioned' })).body.resolved).toBe(2);
    expect((await admin.get('/api/mod/reports')).body.items).toEqual([]);
    await admin.del(`/api/mod/episodes/${ep.id}/hidden`);
    expect((await server.client().get(`/api/stories/${storyId}`)).status).toBe(200);
    const log = (await admin.get('/api/mod/log')).body.items.map((l: { action: string }) => l.action);
    expect(log).toEqual(['unhide', 'resolve:actioned', 'hide']);
  });

  it('suspends writers: they can read but not write, and their stories and comments disappear', async () => {
    const { c, storyId, ep, reader } = await setup();
    await c.post(`/api/episodes/${ep.id}/comments`, { body: 'Author note' });
    const admin = await mod();
    expect((await admin.put('/api/mod/users/writer/ban')).body.banned).toBe(true);
    expect((await c.get('/api/me')).status).toBe(200);
    expect((await c.post('/api/stories', { title: 'x', clientKey: 'y' })).status).toBe(403);
    expect((await reader.get(`/api/stories/${storyId}`)).status).toBe(404);
    expect((await reader.get('/api/users/writer')).status).toBe(404);
    await admin.del('/api/mod/users/writer/ban');
    const comments = (await reader.get(`/api/episodes/${ep.id}/comments`)).body.items;
    expect(comments[0].hidden).toBe(false);
  });

  it('keeps roles in order: only the admin appoints moderators, nobody acts on the admin', async () => {
    const { reader } = await setup();
    const admin = await mod();
    expect((await admin.put('/api/admin/users/reader/role', { role: 'moderator' })).status).toBe(200);
    expect((await reader.put('/api/mod/users/admin/ban')).status).toBe(403);
    expect((await reader.put('/api/admin/users/writer/role', { role: 'moderator' })).status).toBe(403);
    expect((await reader.put('/api/mod/users/writer/ban')).status).toBe(200);
    expect((await reader.get('/api/mod/users?q=writ')).body.items[0]).toMatchObject({ username: 'writer', banned: true, stories: 1 });
    expect((await admin.del('/api/admin/users/writer')).status).toBe(200);
    expect((await admin.get('/api/users/writer')).status).toBe(404);
  });
});

describe('link previews', () => {
  it('serve Open Graph tags, escaped, and send people on to the app', async () => {
    const { c, storyId, ep } = await setup();
    await c.patch(`/api/stories/${storyId}`, { title: 'Storm <"&"> night', description: 'A <b>bold</b> tale' });
    const res = await server.client().raw('GET', `/s/${storyId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Storm &lt;&quot;&amp;&quot;&gt; night">');
    expect(html).toContain('content="A &lt;b&gt;bold&lt;/b&gt; tale"');
    expect(html).toContain(`url=/#/c/s/${storyId}`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    const epHtml = await (await server.client().raw('GET', `/e/${ep.id}`)).text();
    expect(epHtml).toContain('Ana: Did you hear that? Tom: Stay still.');
    expect(epHtml).not.toContain('keep this private');
    expect((await server.client().raw('GET', '/e/AAAAAAAAAAAA')).status).toBe(404);
  });
});
