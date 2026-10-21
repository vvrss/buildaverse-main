import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Server, STORY_TEXT, makeServer, png, publish, ref, writerWithStory } from './helpers';

let server: Server;
beforeEach(async () => {
  server = await makeServer();
});
afterEach(() => server.close());

describe('stories, chapters and episodes', () => {
  it('creates a story once per client key, with a first chapter, hidden until it has an episode', async () => {
    const { c, storyId, chapterId } = await writerWithStory(server);
    const again = await c.post('/api/stories', { title: 'Another title', clientKey: 'story-writer' });
    expect(again.status).toBe(200);
    expect(again.body.story.id).toBe(storyId);
    expect(again.body.story.chapters).toHaveLength(1);
    const reader = server.client();
    expect((await reader.get(`/api/stories/${storyId}`)).status).toBe(404);
    expect((await reader.get('/api/stories')).body.items).toEqual([]);
    expect((await publish(c, chapterId, 'Pilot')).status).toBe(201);
    expect((await reader.get(`/api/stories/${storyId}`)).status).toBe(200);
    expect((await reader.get('/api/stories')).body.items.map((s: { id: string }) => s.id)).toEqual([storyId]);
  });

  it('publishes without notes or private header keys, and a retry does not duplicate', async () => {
    const { c, chapterId } = await writerWithStory(server);
    const text = STORY_TEXT().replace('---\n\n', 'secret: do not share\n---\n\n');
    const first = await publish(c, chapterId, 'Pilot', text);
    expect(first.status).toBe(201);
    const body: string = first.body.episode.body;
    expect(body).not.toContain('keep this private');
    expect(body).not.toContain('secret');
    expect(body).toContain('@ana: Did you hear that?');
    expect(first.body.episode).toMatchObject({ number: 1, revision: 1, words: 6 });
    const retry = await publish(c, chapterId, 'Pilot', text);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ created: false, episode: { id: first.body.episode.id } });
  });

  it('needs pictures uploaded first and links them to the episode', async () => {
    const { c, chapterId } = await writerWithStory(server);
    const text = STORY_TEXT(`![The stairs](img:${ref(7)})`).replace('ana: Ana  #e76f51', `ana: Ana  img:${ref(8)}  #e76f51`);
    const missing = await publish(c, chapterId, 'Pics', text);
    expect(missing.status).toBe(422);
    expect(missing.body.error.refs.sort()).toEqual([ref(7), ref(8)]);
    await c.upload(ref(7), await png('#777777'));
    await c.upload(ref(8), await png('#888888', 40, 40));
    const ok = await publish(c, chapterId, 'Pics', text);
    expect(ok.status).toBe(201);
    expect(Object.keys(ok.body.episode.media).sort()).toEqual([ref(7), ref(8)]);
    const reader = await server.client().get(`/api/episodes/${ok.body.episode.id}`);
    expect(reader.body.media[ref(7)]).toMatchObject({ w: 64, h: 48 });
  });

  it('rejects broken text with line numbers, and empty episodes', async () => {
    const { c, chapterId } = await writerWithStory(server);
    const broken = await publish(c, chapterId, 'Broken', '---\ntitle: x\n@ana: no end of header\n');
    expect(broken.status).toBe(422);
    expect(broken.body.error.issues[0]).toMatchObject({ line: 1 });
    const empty = await publish(c, chapterId, 'Empty', '---\ntitle: x\n---\n\n// only a note\n');
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('empty_episode');
  });

  it('updates by revision and reports a conflict with the current text', async () => {
    const { c, chapterId } = await writerWithStory(server);
    const ep = (await publish(c, chapterId, 'Pilot')).body.episode;
    const v2 = await c.put(`/api/episodes/${ep.id}`, { baseRevision: 1, text: STORY_TEXT('@ana: A new line.') });
    expect(v2.status).toBe(200);
    expect(v2.body.episode.revision).toBe(2);
    const stale = await c.put(`/api/episodes/${ep.id}`, { baseRevision: 1, text: STORY_TEXT('@tom: From an old copy.') });
    expect(stale.status).toBe(409);
    expect(stale.body.error.current).toMatchObject({ revision: 2 });
    expect(stale.body.error.current.body).toContain('A new line.');
    // "Replace online": send again against the current revision.
    expect((await c.put(`/api/episodes/${ep.id}`, { baseRevision: 2, text: STORY_TEXT('@tom: From an old copy.') })).status).toBe(200);
  });

  it('only lets the author change things; moderators can remove them', async () => {
    const { c, storyId, chapterId } = await writerWithStory(server);
    const ep = (await publish(c, chapterId, 'Pilot')).body.episode;
    const other = server.client();
    await other.register('other');
    expect((await other.put(`/api/episodes/${ep.id}`, { baseRevision: 1, text: STORY_TEXT() })).status).toBe(403);
    expect((await other.patch(`/api/stories/${storyId}`, { title: 'Mine now' })).status).toBe(403);
    expect((await other.del(`/api/episodes/${ep.id}`)).status).toBe(403);
    const admin = server.client();
    await admin.login('admin', 'admin-password-1');
    expect((await admin.del(`/api/episodes/${ep.id}`)).status).toBe(200);
    expect((await admin.get('/api/mod/log')).body.items[0]).toMatchObject({ action: 'delete', targetKind: 'episode' });
  });

  it('numbers episodes across chapters, with previous and next, reordering and moving', async () => {
    const { c, storyId, chapterId } = await writerWithStory(server);
    const e1 = (await publish(c, chapterId, 'One')).body.episode;
    const e2 = (await publish(c, chapterId, 'Two')).body.episode;
    const ch2 = (await c.post(`/api/stories/${storyId}/chapters`, { title: 'Chapter 2', clientKey: 'ch2' })).body.chapterId;
    const e3 = (await publish(c, ch2, 'Three')).body.episode;
    expect(e3.number).toBe(3);
    const mid = (await server.client().get(`/api/episodes/${e2.id}`)).body;
    expect([mid.prev.id, mid.next.id, mid.number]).toEqual([e1.id, e3.id, 2]);

    await c.put(`/api/chapters/${chapterId}/episode-order`, { ids: [e2.id, e1.id] });
    expect((await server.client().get(`/api/episodes/${e1.id}`)).body.number).toBe(2);
    expect((await c.put(`/api/chapters/${chapterId}/episode-order`, { ids: [e1.id] })).status).toBe(409);

    await c.patch(`/api/episodes/${e1.id}`, { chapterId: ch2 });
    const story = (await server.client().get(`/api/stories/${storyId}`)).body;
    expect(story.chapters.map((ch: { episodes: { title: string }[] }) => ch.episodes.map((e) => e.title))).toEqual([['Two'], ['Three', 'One']]);

    expect((await c.del(`/api/chapters/${ch2}`)).status).toBe(409);
    await c.put(`/api/stories/${storyId}/chapter-order`, { ids: [ch2, chapterId] });
    expect((await server.client().get(`/api/episodes/${e3.id}`)).body.number).toBe(1);
  });

  it('finds stories by genre, tag and words, newest or most followed first', async () => {
    const a = await writerWithStory(server, 'alice');
    await publish(a.c, a.chapterId, 'A1');
    const b = server.client();
    await b.register('bob');
    const bs = (await b.post('/api/stories', { title: 'Space Opera', clientKey: 'b', genre: 'Sci-fi', tags: ['stars'] })).body.story;
    server.clock.t += 1000;
    await publish(b, bs.chapters[0].id, 'B1');
    const reader = server.client();
    const ids = async (q: string) => (await reader.get(`/api/stories${q}`)).body.items.map((s: { title: string }) => s.title);
    expect(await ids('')).toEqual(['Space Opera', 'The Lighthouse']);
    expect(await ids('?genre=Mystery')).toEqual(['The Lighthouse']);
    expect(await ids('?tag=stars')).toEqual(['Space Opera']);
    expect(await ids('?q=lighth')).toEqual(['The Lighthouse']);
    expect(await ids('?q=alice')).toEqual(['The Lighthouse']);
    expect(await ids('?q=%25')).toEqual([]);
    await reader.register('fan');
    await reader.put(`/api/stories/${a.storyId}/follow`);
    expect(await ids('?sort=popular')).toEqual(['The Lighthouse', 'Space Opera']);
    expect((await reader.get('/api/tags')).body.items.map((t: { tag: string }) => t.tag).sort()).toEqual(['sea', 'stars', 'storm']);
    const page = await reader.get('/api/stories?limit=1');
    expect(page.body.items).toHaveLength(1);
    expect((await reader.get(`/api/stories?limit=1&cursor=${page.body.next}`)).body.items[0].title).toBe('The Lighthouse');
  });

  it("lists the author's own stories for the publish screen", async () => {
    const { c, chapterId } = await writerWithStory(server);
    await publish(c, chapterId, 'Pilot');
    const mine = (await c.get('/api/me/stories')).body.items;
    expect(mine[0]).toMatchObject({ title: 'The Lighthouse', tags: ['sea', 'storm'], chapters: [{ title: 'Chapter 1', episodes: [{ title: 'Pilot', number: 1 }] }] });
  });
});
