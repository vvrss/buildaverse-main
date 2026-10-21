import { useEffect, useMemo, useState } from 'preact/hooks';
import { BookPlus, Check, ChevronLeft, Copy, ExternalLink, Globe, PenLine, Share2, TriangleAlert } from 'lucide-preact';
import { storyRefs } from '../format/images';
import { parseStory } from '../format/parser';
import { serializeStory } from '../format/serializer';
import type { Story } from '../format/types';
import { cPath, go, shareUrl, storyPath } from '../router';
import { GENRES, type EpisodeDetail, type MyStory } from '../shared/api';
import { type StoryRecord, db } from '../store/db';
import { createStory, flushSave, showToast } from '../store/storyStore';
import { Group, Row, Switch } from '../ui/controls';
import { Sheet, closeSheet, showSheet } from '../ui/overlay';
import { copyText } from '../views/shared';
import { AccountForms } from './AccountForms';
import { ApiError, community, errorText, get, me, post, put } from './api';
import { changedSincePublished, linkFor, linkStory, textHash } from './local';
import { shareLink } from './ui';
import { uploadPictures } from './upload';

const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/** What publishing will leave out or send, shown before anything is sent. */
function summary(story: Story) {
  const notes = story.blocks.filter((b) => b.kind === 'note').length;
  const words = story.blocks
    .filter((b) => b.kind !== 'note')
    .reduce((n, b) => n + (b.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0);
  return { notes, words, lines: story.blocks.length - notes, pictures: storyRefs(story).length, privateKeys: story.meta.length };
}

function Notices({ story }: { story: Story }) {
  const s = summary(story);
  return (
    <ul class="publish-notices">
      <li>
        <Globe size={16} /> Published episodes are public: anyone with the link can read them.
      </li>
      <li>
        <Check size={16} /> {s.lines} lines, about {s.words} words{s.pictures ? `, ${s.pictures} ${s.pictures === 1 ? 'picture' : 'pictures'} (uploaded once, then reused)` : ''}.
      </li>
      {s.notes > 0 && (
        <li>
          <Check size={16} /> Your {s.notes} {s.notes === 1 ? 'note stays' : 'notes stay'} on this device.
        </li>
      )}
      {s.privateKeys > 0 && (
        <li>
          <Check size={16} /> Extra header lines (like "{story.meta[0][0]}") stay on this device.
        </li>
      )}
    </ul>
  );
}

/** "Write next episode": a new story on this device with the same cast and portraits, in the same series. */
async function writeNext(ep: EpisodeDetail, record: StoryRecord) {
  const cast = parseStory(record.text).story;
  const next: Story = { title: `${ep.story.title}: Episode ${ep.number + 1}`, cover: cast.cover, characters: cast.characters, meta: [], blocks: [] };
  const id = await createStory(serializeStory(next));
  await linkStory(id, { series: { storyId: ep.story.id, title: ep.story.title, chapterId: ep.chapter.id } });
  go(storyPath(id));
}

function Done({ ep, record, updated }: { ep: EpisodeDetail; record: StoryRecord; updated: boolean }) {
  const url = shareUrl('e', ep.id);
  const nextEpisode = () => void writeNext(ep, record);
  return (
    <div class="publish-done" data-testid="publish-done">
      <div class="done-mark">
        <Check size={34} />
      </div>
      <h2 class="display">{updated ? 'Episode updated' : `Episode ${ep.number} is live`}</h2>
      <p class="muted">
        “{ep.title}” in {ep.story.title}
      </p>
      <div class="share-url">
        <code>{url}</code>
        <button type="button" class="icon-btn" aria-label="Copy link" onClick={async () => showToast((await copyText(url)) ? 'Link copied' : url)}>
          <Copy size={18} />
        </button>
      </div>
      <div class="action-row">
        <button type="button" class="btn" onClick={() => void shareLink('e', ep.id, `${ep.story.title}: ${ep.title}`)}>
          <Share2 size={16} /> Share
        </button>
        <a class="btn" href={`#${cPath.episode(ep.id)}`}>
          <ExternalLink size={16} /> Read it
        </a>
        <button type="button" class="btn primary" onClick={nextEpisode} data-testid="write-next">
          <PenLine size={16} /> Write next episode
        </button>
      </div>
      <a class="link" href={`#${storyPath(record.id)}`}>
        Back to the story
      </a>
    </div>
  );
}

interface Progress {
  text: string;
}

function NewEpisode({ record, onDone }: { record: StoryRecord; onDone: (ep: EpisodeDetail) => void }) {
  const story = useMemo(() => parseStory(record.text).story, [record.text]);
  const [mine, setMine] = useState<MyStory[] | null>(null);
  const [target, setTarget] = useState<string>('new');
  const [title, setTitle] = useState(record.series?.title ?? story.title);
  const [genre, setGenre] = useState('');
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [useCover, setUseCover] = useState(!!story.cover);
  const [chapter, setChapter] = useState<string>('new');
  const [chapterTitle, setChapterTitle] = useState('Chapter 1');
  const [episodeTitle, setEpisodeTitle] = useState(story.title);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<{ items: MyStory[] }>('/me/stories').then(
      (r) => {
        setMine(r.items);
        const linked = r.items.find((s) => s.id === record.series?.storyId);
        if (linked) {
          setTarget(linked.id);
          const ch = linked.chapters.find((c) => c.id === record.series?.chapterId) ?? linked.chapters[linked.chapters.length - 1];
          setChapter(ch?.id ?? 'new');
        }
      },
      (err) => setError(errorText(err)),
    );
  }, []);

  const chosen = mine?.find((s) => s.id === target);
  useEffect(() => {
    if (!chosen) return;
    const last = chosen.chapters[chosen.chapters.length - 1];
    if (!chosen.chapters.some((c) => c.id === chapter)) setChapter(last?.id ?? 'new');
    setChapterTitle(`Chapter ${chosen.chapters.length + 1}`);
  }, [target, mine]);

  const publish = async () => {
    setError(null);
    try {
      // One key per publishing attempt of this story: retrying after a failure never duplicates anything.
      let key = record.publishKey;
      if (!key) {
        key = newKey();
        await linkStory(record.id, { publishKey: key });
      }
      const cover = target === 'new' && useCover ? story.cover : undefined;
      const refs = [...storyRefs(story), ...(cover ? [cover] : [])];
      if (refs.length) setProgress({ text: 'Checking pictures…' });
      await uploadPictures(refs, (done, total) => total && setProgress({ text: `Uploading pictures ${done}/${total}…` }));

      let storyId = target;
      let chapterId = chapter;
      if (target === 'new') {
        setProgress({ text: 'Creating the story…' });
        const created = await post<{ story: MyStory }>('/stories', {
          title,
          description,
          genre,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          coverRef: cover ?? null,
          clientKey: `${key}:story`,
          firstChapter: { title: chapterTitle || 'Chapter 1' },
        });
        storyId = created.story.id;
        chapterId = created.story.chapters[0].id;
      } else if (chapter === 'new') {
        setProgress({ text: 'Adding the chapter…' });
        chapterId = (await post<{ chapterId: string }>(`/stories/${storyId}/chapters`, { title: chapterTitle, clientKey: `${key}:chapter` })).chapterId;
      }
      setProgress({ text: 'Publishing…' });
      const r = await post<{ episode: EpisodeDetail }>(`/chapters/${chapterId}/episodes`, { clientKey: key, title: episodeTitle, text: record.text });
      await linkStory(record.id, {
        published: linkFor(r.episode, record.text),
        series: { storyId: r.episode.story.id, title: r.episode.story.title, chapterId: r.episode.chapter.id },
        publishKey: undefined,
      });
      onDone(r.episode);
    } catch (err) {
      setProgress(null);
      setError(err instanceof ApiError && err.data?.issues?.length ? `${err.message} Line ${err.data.issues[0].line}: ${err.data.issues[0].message}` : errorText(err));
    }
  };

  if (!mine && !error) return <div class="c-loading" role="status" aria-label="Loading" />;
  return (
    <form
      class="publish-form"
      onSubmit={(e) => {
        e.preventDefault();
        void publish();
      }}
    >
      <Group title="Story">
        <Row label="Publish in" htmlFor="pub-story">
          <select id="pub-story" value={target} onChange={(e) => setTarget((e.currentTarget as HTMLSelectElement).value)} data-testid="publish-target">
            <option value="new">A new story</option>
            {(mine ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </Row>
      </Group>
      {target === 'new' ? (
        <div class="account-form">
          <label class="form-field">
            <span class="form-label">Story title</span>
            <input required maxLength={120} value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} data-testid="publish-story-title" />
          </label>
          <label class="form-field">
            <span class="form-label">Genre</span>
            <select value={genre} onChange={(e) => setGenre((e.currentTarget as HTMLSelectElement).value)}>
              <option value="">None</option>
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label class="form-field">
            <span class="form-label">Tags (comma separated)</span>
            <input value={tags} placeholder="mystery, sea" onInput={(e) => setTags((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="form-field">
            <span class="form-label">Description</span>
            <textarea rows={3} maxLength={1000} value={description} onInput={(e) => setDescription((e.currentTarget as HTMLTextAreaElement).value)} />
          </label>
          {story.cover && (
            <Row label="Use this story's cover" htmlFor="pub-cover">
              <Switch id="pub-cover" label="Use this story's cover" checked={useCover} onChange={setUseCover} />
            </Row>
          )}
          <label class="form-field">
            <span class="form-label">First chapter</span>
            <input required maxLength={120} value={chapterTitle} onInput={(e) => setChapterTitle((e.currentTarget as HTMLInputElement).value)} />
          </label>
        </div>
      ) : (
        <div class="account-form">
          <label class="form-field">
            <span class="form-label">Chapter</span>
            <select value={chapter} onChange={(e) => setChapter((e.currentTarget as HTMLSelectElement).value)}>
              {chosen?.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({c.episodes.length} {c.episodes.length === 1 ? 'episode' : 'episodes'})
                </option>
              ))}
              <option value="new">A new chapter…</option>
            </select>
          </label>
          {chapter === 'new' && (
            <label class="form-field">
              <span class="form-label">New chapter title</span>
              <input required maxLength={120} value={chapterTitle} onInput={(e) => setChapterTitle((e.currentTarget as HTMLInputElement).value)} />
            </label>
          )}
        </div>
      )}
      <div class="account-form">
        <label class="form-field">
          <span class="form-label">Episode title</span>
          <input required maxLength={120} value={episodeTitle} onInput={(e) => setEpisodeTitle((e.currentTarget as HTMLInputElement).value)} data-testid="publish-episode-title" />
        </label>
      </div>
      <Notices story={story} />
      {error && (
        <p class="form-error" role="alert">
          <TriangleAlert size={16} /> {error}
        </p>
      )}
      <button type="submit" class="btn primary wide" disabled={!!progress} data-testid="publish-submit">
        {progress ? progress.text : error ? 'Try again' : 'Publish episode'}
      </button>
    </form>
  );
}

function ConflictSheet({ current, onReplace, onUseOnline, onKeepBoth }: {
  current: { revision: number; body: string; updatedAt: number };
  onReplace: () => void;
  onUseOnline: () => void;
  onKeepBoth: () => void;
}) {
  return (
    <Sheet title="Changed online">
      <p class="confirm-message">
        This episode was updated online ({new Date(current.updatedAt).toLocaleString()}) since your copy was published, maybe from another device.
      </p>
      <div class="group-card">
        <Row label="Replace the online version" hint="Readers get your copy" onClick={() => (closeSheet(), onReplace())} />
        <Row label="Use the online version here" hint="Your copy is replaced; your notes in it are lost" onClick={() => (closeSheet(), onUseOnline())} />
        <Row label="Keep both" hint="The online version is saved here as a separate story, then yours is published" onClick={() => (closeSheet(), onKeepBoth())} />
      </div>
    </Sheet>
  );
}

function UpdateEpisode({ record, onDone, onUnlink }: { record: StoryRecord; onDone: (ep: EpisodeDetail) => void; onUnlink: () => void }) {
  const link = record.published!;
  const story = useMemo(() => parseStory(record.text).story, [record.text]);
  const [online, setOnline] = useState<EpisodeDetail | null | 'gone'>(null);
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void get<EpisodeDetail>(`/episodes/${link.episodeId}`).then(
      (ep) => {
        setOnline(ep);
        setTitle(ep.title);
      },
      (err) => (err instanceof ApiError && err.status === 404 ? setOnline('gone') : setError(errorText(err))),
    );
  }, []);

  const send = async (baseRevision: number) => {
    setError(null);
    try {
      setProgress('Checking pictures…');
      await uploadPictures(storyRefs(story), (done, total) => total && setProgress(`Uploading pictures ${done}/${total}…`));
      setProgress('Updating…');
      const r = await put<{ episode: EpisodeDetail }>(`/episodes/${link.episodeId}`, { baseRevision, text: record.text, title });
      await linkStory(record.id, { published: linkFor(r.episode, record.text) });
      onDone(r.episode);
    } catch (err) {
      setProgress(null);
      const current = err instanceof ApiError && err.status === 409 ? err.data?.current : undefined;
      if (current) {
        showSheet(
          <ConflictSheet
            current={current}
            onReplace={() => void send(current.revision)}
            onUseOnline={async () => {
              const online = parseStory(current.body).story;
              await db.putStory({
                ...record,
                title: online.title,
                text: current.body,
                lines: online.blocks.length,
                updatedAt: Date.now(),
                published: { ...link, revision: current.revision, textHash: textHash(current.body) },
              });
              showToast('Your copy now matches the online version');
              go(storyPath(record.id));
            }}
            onKeepBoth={async () => {
              const s = parseStory(current.body).story;
              s.title = `${s.title} (online version)`;
              await createStory(serializeStory(s));
              void send(current.revision);
            }}
          />,
        );
        return;
      }
      setError(errorText(err));
    }
  };

  if (online === null && !error) return <div class="c-loading" role="status" aria-label="Loading" />;
  if (online === 'gone') {
    return (
      <div class="publish-form">
        <p>The episode this story was published as no longer exists online.</p>
        <button type="button" class="btn primary" onClick={onUnlink}>
          Publish it again as a new episode
        </button>
      </div>
    );
  }
  const changed = changedSincePublished(record);
  return (
    <form
      class="publish-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (online) void send(link.revision);
      }}
    >
      <p>
        Published as <b>#{link.number}</b> in <a href={`#${cPath.story(link.storyId)}`}>{link.storyTitle}</a>.{' '}
        {changed ? <span class="badge">Changed since</span> : <span class="muted">No changes since.</span>}
      </p>
      <div class="account-form">
        <label class="form-field">
          <span class="form-label">Episode title</span>
          <input required maxLength={120} value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <Notices story={story} />
      {error && (
        <p class="form-error" role="alert">
          <TriangleAlert size={16} /> {error}
        </p>
      )}
      <button type="submit" class="btn primary wide" disabled={!!progress || !online} data-testid="publish-update">
        {progress ?? 'Update the online episode'}
      </button>
      {online && (
        <button type="button" class="btn wide" onClick={() => void writeNext(online, record)} data-testid="write-next">
          <PenLine size={16} /> Write next episode
        </button>
      )}
      <button type="button" class="link" onClick={onUnlink}>
        <BookPlus size={15} /> Publish as a new episode instead
      </button>
    </form>
  );
}

export function PublishScreen({ id }: { id: string }) {
  const [record, setRecord] = useState<StoryRecord | null | undefined>(undefined);
  const [done, setDone] = useState<{ ep: EpisodeDetail; updated: boolean } | null>(null);
  const load = async () => {
    await flushSave();
    setRecord((await db.getStory(id)) ?? null);
  };
  useEffect(() => {
    void load();
  }, [id]);

  let body;
  if (community.value !== 'ready') {
    body = (
      <p class="muted">
        {community.value === 'outdated'
          ? 'This version of the app is too old for the Community server. Reload to update.'
          : community.value === 'unavailable'
            ? "Community isn't set up here: this copy of the app has no server to publish to. Your story stays safe on this device."
            : 'Connecting to the Community…'}
      </p>
    );
  } else if (record === undefined) body = <div class="c-loading" role="status" aria-label="Loading" />;
  else if (record === null) body = <p>That story isn't on this device.</p>;
  else if (!me.value) body = <AccountForms reason="Publishing needs a Community account. Readers see your name and username." />;
  else if (done) body = <Done ep={done.ep} record={record} updated={done.updated} />;
  else if (record.published) {
    body = (
      <UpdateEpisode
        record={record}
        onDone={(ep) => {
          setDone({ ep, updated: true });
          void load();
        }}
        onUnlink={async () => {
          await linkStory(record.id, { published: undefined, publishKey: undefined });
          void load();
        }}
      />
    );
  } else {
    body = (
      <NewEpisode
        record={record}
        onDone={(ep) => {
          setDone({ ep, updated: false });
          void load();
        }}
      />
    );
  }

  return (
    <div class="screen publish">
      <header class="screen-head with-back">
        <a class="icon-btn" href={`#${storyPath(id)}`} aria-label="Back to the story">
          <ChevronLeft size={24} />
        </a>
        <h1 class="display">{record?.published && !done ? 'Update episode' : 'Publish'}</h1>
      </header>
      {record && !done && (
        <p class="muted small publish-what">
          “{record.title}” · {record.lines} {record.lines === 1 ? 'line' : 'lines'}
        </p>
      )}
      {body}
    </div>
  );
}
