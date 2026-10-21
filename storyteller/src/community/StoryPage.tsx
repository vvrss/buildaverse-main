import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronLeft,
  EyeOff,
  Heart,
  ImagePlus,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-preact';
import { chooseCover } from '../images/flows';
import { cPath, go, goBack } from '../router';
import { GENRES, type ChapterInfo, type StoryDetail } from '../shared/api';
import { showToast } from '../store/storyStore';
import { Sheet, closeSheet, confirmAction, showSheet } from '../ui/overlay';
import { ago } from '../views/shared';
import { del, errorText, patch, post, put } from './api';
import { RemoteImage } from './media';
import { uploadPictures } from './upload';
import { ErrorBox, Loading, ReportButton, ShareButton, UserChip, plural, readTime, requireAccount, useApi } from './ui';

function DetailsSheet({ story, onSaved }: { story: StoryDetail; onSaved: () => void }) {
  const [title, setTitle] = useState(story.title);
  const [description, setDescription] = useState(story.description);
  const [genre, setGenre] = useState(story.genre);
  const [tags, setTags] = useState(story.tags.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await patch(`/stories/${story.id}`, {
        title,
        description,
        genre,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      closeSheet();
      onSaved();
      showToast('Saved');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const cover = async () => {
    const ref = await chooseCover();
    if (!ref) return;
    try {
      await uploadPictures([ref]);
      await patch(`/stories/${story.id}`, { coverRef: ref });
      onSaved();
      showToast('Cover updated');
    } catch (err) {
      showToast(errorText(err));
    }
  };

  return (
    <Sheet title="Story details">
      <form class="account-form" onSubmit={save}>
        <label class="form-field">
          <span class="form-label">Title</span>
          <input required maxLength={120} value={title} onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="form-field">
          <span class="form-label">Description</span>
          <textarea rows={4} maxLength={1000} value={description} onInput={(e) => setDescription((e.currentTarget as HTMLTextAreaElement).value)} />
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
          <span class="form-label">Tags (comma separated, up to 8)</span>
          <input value={tags} placeholder="mystery, lighthouse, slow burn" onInput={(e) => setTags((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <button type="button" class="btn" onClick={cover}>
          <ImagePlus size={16} /> {story.cover ? 'Change cover' : 'Add a cover'}
        </button>
        {error && <p class="form-error">{error}</p>}
        <button type="submit" class="btn primary" disabled={busy}>
          Save
        </button>
      </form>
    </Sheet>
  );
}

function NameSheet({ title, label, initial, onSave }: { title: string; label: string; initial: string; onSave: (v: string) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title={title}>
      <form
        class="account-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onSave(value);
            closeSheet();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <label class="form-field">
          <span class="form-label">{label}</span>
          <input required maxLength={120} value={value} onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)} />
        </label>
        {error && <p class="form-error">{error}</p>}
        <button type="submit" class="btn primary">
          Save
        </button>
      </form>
    </Sheet>
  );
}

function ChapterBlock({ story, chapter, index, onChange }: { story: StoryDetail; chapter: ChapterInfo; index: number; onChange: () => void }) {
  const author = story.viewer.isAuthor;
  const run = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      onChange();
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const ids = story.chapters.map((c) => c.id);
  const moveChapter = (step: -1 | 1) => {
    const next = [...ids];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    return put(`/stories/${story.id}/chapter-order`, { ids: next });
  };
  const moveEpisode = (i: number, step: -1 | 1) => {
    const next = chapter.episodes.map((e) => e.id);
    [next[i], next[i + step]] = [next[i + step], next[i]];
    return put(`/chapters/${chapter.id}/episode-order`, { ids: next });
  };
  return (
    <section class="chapter">
      <header class="chapter-head">
        <h3>{chapter.title}</h3>
        {author && (
          <span class="row-actions">
            <button type="button" class="icon-btn small" aria-label={`Rename ${chapter.title}`} onClick={() =>
              showSheet(
                <NameSheet title="Rename chapter" label="Chapter title" initial={chapter.title} onSave={async (t) => {
                  await patch(`/chapters/${chapter.id}`, { title: t });
                  onChange();
                }} />,
              )
            }>
              <Pencil size={15} />
            </button>
            <button type="button" class="icon-btn small" aria-label="Move chapter up" disabled={index === 0} onClick={run(() => moveChapter(-1))}>
              <ArrowUp size={15} />
            </button>
            <button type="button" class="icon-btn small" aria-label="Move chapter down" disabled={index === ids.length - 1} onClick={run(() => moveChapter(1))}>
              <ArrowDown size={15} />
            </button>
            {chapter.episodes.length === 0 && story.chapters.length > 1 && (
              <button type="button" class="icon-btn small" aria-label={`Delete ${chapter.title}`} onClick={run(() => del(`/chapters/${chapter.id}`))}>
                <Trash2 size={15} />
              </button>
            )}
          </span>
        )}
      </header>
      {chapter.episodes.length === 0 && <p class="muted small">No episodes yet.</p>}
      <ol class="episode-list">
        {chapter.episodes.map((e, i) => (
          <li key={e.id} class={e.hidden ? 'hidden-item' : ''}>
            <a class="episode-row" href={`#${cPath.episode(e.id)}`}>
              <span class="ep-number">{e.number}</span>
              <span class="ep-text">
                <b>{e.title}</b>
                <span class="muted small">
                  {readTime(e.words)} · {ago(e.publishedAt)}
                  {e.hidden && ' · hidden'}
                </span>
              </span>
              <span class="ep-stats muted small">
                <span>
                  <Heart size={13} /> {e.likes}
                </span>
                <span>
                  <MessageCircle size={13} /> {e.comments}
                </span>
              </span>
            </a>
            {author && (
              <span class="row-actions">
                <button type="button" class="icon-btn small" aria-label={`Move ${e.title} up`} disabled={i === 0} onClick={run(() => moveEpisode(i, -1))}>
                  <ArrowUp size={15} />
                </button>
                <button type="button" class="icon-btn small" aria-label={`Move ${e.title} down`} disabled={i === chapter.episodes.length - 1} onClick={run(() => moveEpisode(i, 1))}>
                  <ArrowDown size={15} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StoryPage({ id }: { id: string }) {
  const { data: story, error, reload, setData } = useApi<StoryDetail>(`/stories/${id}`, [id]);
  if (error) return <Page><ErrorBox error={error} retry={reload} /></Page>;
  if (!story) return <Page><Loading /></Page>;

  const first = story.chapters.flatMap((c) => c.episodes)[0];
  const startAt = story.viewer.progress ?? first;
  const toggleFollow = async () => {
    if (!requireAccount('Sign in to follow this story.')) return;
    try {
      const r = await (story.viewer.following ? del : put)<{ following: boolean; followers: number }>(`/stories/${story.id}/follow`);
      setData({ ...story, followers: r.followers, viewer: { ...story.viewer, following: r.following } });
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const toggleAuthor = async () => {
    if (!requireAccount('Sign in to follow this writer.')) return;
    try {
      const r = await (story.viewer.followingAuthor ? del : put)<{ following: boolean }>(`/users/${story.author.username}/follow`);
      setData({ ...story, viewer: { ...story.viewer, followingAuthor: r.following } });
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const removeStory = async () => {
    const ok = await confirmAction({
      title: `Delete “${story.title}”?`,
      message: <p>Every chapter, episode, comment and like of it is removed from the Community. Copies on your devices stay.</p>,
      confirmLabel: 'Delete story',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/stories/${story.id}`);
      showToast('Story deleted');
      go(cPath.home(), true);
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const toggleHidden = async () => {
    try {
      await (story.hidden ? del : put)(`/mod/stories/${story.id}/hidden`);
      showToast(story.hidden ? 'Story visible again' : 'Story hidden');
      void reload();
    } catch (err) {
      showToast(errorText(err));
    }
  };

  return (
    <Page>
      <div class="story-hero">
        {story.cover && <RemoteImage media={story.cover} alt="" sizes="(max-width: 640px) 100vw, 640px" class="story-cover" />}
        <div class="story-hero-text">
          {story.hidden && <span class="badge attention">Hidden by a moderator</span>}
          <h1 class="display">{story.title}</h1>
          <UserChip user={story.author} />
          <p class="muted small">
            {[story.genre, plural(story.episodes, 'episode'), plural(story.followers, 'follower'), plural(story.likes, 'like')].filter(Boolean).join(' · ')}
          </p>
          {story.tags.length > 0 && (
            <div class="chip-row tags">
              {story.tags.map((t) => (
                <a key={t} class="filter-chip tag" href={`#${cPath.home('discover', { tag: t })}`}>
                  #{t}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
      {story.description && <p class="story-description">{story.description}</p>}
      <div class="action-row">
        {startAt && (
          <a class="btn primary" href={`#${cPath.episode(startAt.id)}`}>
            <Play size={16} /> {story.viewer.progress ? `Continue: #${startAt.number}` : 'Start reading'}
          </a>
        )}
        {!story.viewer.isAuthor && (
          <button type="button" class={`btn${story.viewer.following ? ' on' : ''}`} aria-pressed={story.viewer.following} onClick={toggleFollow}>
            <BookOpen size={16} /> {story.viewer.following ? 'Following' : 'Follow story'}
          </button>
        )}
        {!story.viewer.isAuthor && (
          <button type="button" class={`btn${story.viewer.followingAuthor ? ' on' : ''}`} aria-pressed={story.viewer.followingAuthor} onClick={toggleAuthor}>
            {story.viewer.followingAuthor ? <UserCheck size={16} /> : <UserPlus size={16} />} {story.viewer.followingAuthor ? 'Following writer' : 'Follow writer'}
          </button>
        )}
        <ShareButton kind="s" id={story.id} title={story.title} />
      </div>

      {story.viewer.isAuthor && (
        <div class="author-tools">
          <button type="button" class="btn small" onClick={() => showSheet(<DetailsSheet story={story} onSaved={() => void reload()} />)}>
            <Pencil size={15} /> Edit details
          </button>
          <button
            type="button"
            class="btn small"
            onClick={() =>
              showSheet(
                <NameSheet
                  title="New chapter"
                  label="Chapter title"
                  initial={`Chapter ${story.chapters.length + 1}`}
                  onSave={async (t) => {
                    await post(`/stories/${story.id}/chapters`, { title: t });
                    void reload();
                  }}
                />,
              )
            }
          >
            <Plus size={15} /> Add chapter
          </button>
          <button type="button" class="btn small danger" onClick={removeStory}>
            <Trash2 size={15} /> Delete story
          </button>
          <p class="muted small">To add an episode, open a story on this device and choose Export → Publish to Community.</p>
        </div>
      )}

      <div class="chapters">
        {story.chapters.map((ch, i) => (
          <ChapterBlock key={ch.id} story={story} chapter={ch} index={i} onChange={() => void reload()} />
        ))}
      </div>

      <footer class="page-foot">
        {!story.viewer.isAuthor && <ReportButton kind="story" id={story.id} what="this story" />}
        {story.viewer.canModerate && (
          <>
            <button type="button" class="link small" onClick={toggleHidden}>
              <EyeOff size={14} /> {story.hidden ? 'Unhide story' : 'Hide story'}
            </button>
            {!story.viewer.isAuthor && (
              <button type="button" class="link small danger" onClick={removeStory}>
                <Trash2 size={14} /> Delete story
              </button>
            )}
          </>
        )}
      </footer>
    </Page>
  );
}

function Page({ children }: { children: ComponentChildren }) {
  return (
    <div class="screen c-page">
      <header class="screen-head with-back">
        <button type="button" class="icon-btn" aria-label="Back" onClick={() => goBack(cPath.home())}>
          <ChevronLeft size={24} />
        </button>
      </header>
      {children}
    </div>
  );
}

export { Page as CommunityPage };
