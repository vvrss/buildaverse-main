import { useEffect, useMemo, useState } from 'preact/hooks';
import { BookOpen, ChevronLeft, ChevronRight, EyeOff, Heart, MessageCircle, PencilLine, Trash2 } from 'lucide-preact';
import { parseStory } from '../format/parser';
import { cPath, go, goBack, storyPath } from '../router';
import type { EpisodeDetail } from '../shared/api';
import { currentProfile } from '../store/profile';
import { settings } from '../store/settings';
import { showToast } from '../store/storyStore';
import { confirmAction } from '../ui/overlay';
import { StoryLog } from '../views/StoryLog';
import { ago } from '../views/shared';
import { del, errorText, me, put } from './api';
import { Comments } from './Comments';
import { editHere, localCopyOf } from './local';
import { RemotePictures } from './media';
import { ErrorBox, Loading, ReportButton, ShareButton, UserChip, readTime, requireAccount, useApi } from './ui';

function AuthorTools({ ep }: { ep: EpisodeDetail }) {
  const [local, setLocal] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!currentProfile.value) return;
    void localCopyOf(ep.id).then((r) => setLocal(r?.id ?? null));
  }, [ep.id]);
  if (!currentProfile.value || local === undefined) return null;
  return (
    <div class="author-tools">
      {local ? (
        <a class="btn small" href={`#${storyPath(local)}`}>
          <PencilLine size={15} /> Open your copy
        </a>
      ) : (
        <button
          type="button"
          class="btn small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const id = await editHere(ep);
              showToast('Episode copied to this device');
              go(storyPath(id));
            } catch (err) {
              showToast(errorText(err));
              setBusy(false);
            }
          }}
        >
          <PencilLine size={15} /> Edit this episode here
        </button>
      )}
      <span class="muted small">Revision {ep.revision} · updated {ago(ep.updatedAt)}</span>
    </div>
  );
}

export function Reader({ id, comment }: { id: string; comment: number | null }) {
  const { data: ep, error, reload, setData } = useApi<EpisodeDetail>(`/episodes/${id}`, [id]);
  const story = useMemo(() => (ep ? parseStory(ep.body).story : null), [ep?.body]);

  // Reading an episode moves your place in the story forward.
  useEffect(() => {
    if (ep && me.value) void put(`/episodes/${ep.id}/progress`).catch(() => {});
  }, [ep?.id, !!me.value]);

  useEffect(() => {
    if (!comment) window.scrollTo?.(0, 0);
  }, [id]);

  if (error) {
    return (
      <div class="screen c-page">
        <ErrorBox error={error} retry={reload} />
      </div>
    );
  }
  if (!ep || !story) {
    return (
      <div class="screen c-page">
        <Loading />
      </div>
    );
  }

  const like = async () => {
    if (!requireAccount('Sign in to like episodes.')) return;
    try {
      const r = await (ep.viewer.liked ? del : put)<{ liked: boolean; likes: number }>(`/episodes/${ep.id}/like`);
      setData({ ...ep, likes: r.likes, viewer: { ...ep.viewer, liked: r.liked } });
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const follow = async () => {
    if (!requireAccount('Sign in to follow this story.')) return;
    try {
      const r = await (ep.viewer.followingStory ? del : put)<{ following: boolean }>(`/stories/${ep.story.id}/follow`);
      setData({ ...ep, viewer: { ...ep.viewer, followingStory: r.following } });
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete “${ep.title}”?`,
      message: <p>The episode and its comments are removed from the Community. Copies on devices stay.</p>,
      confirmLabel: 'Delete episode',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/episodes/${ep.id}`);
      showToast('Episode deleted');
      go(cPath.story(ep.story.id), true);
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const toggleHidden = async () => {
    try {
      await (ep.hidden ? del : put)(`/mod/episodes/${ep.id}/hidden`);
      void reload();
    } catch (err) {
      showToast(errorText(err));
    }
  };

  return (
    <div class="screen c-page reader">
      <header class="topbar reader-bar">
        <div class="topbar-row">
          <button type="button" class="icon-btn" aria-label="Back" onClick={() => goBack(cPath.story(ep.story.id))}>
            <ChevronLeft size={24} />
          </button>
          <a class="title reader-story" href={`#${cPath.story(ep.story.id)}`}>
            {ep.story.title}
          </a>
          <ShareButton kind="e" id={ep.id} title={`${ep.story.title}: ${ep.title}`} />
        </div>
      </header>

      <article class="reader-body">
        <header class="episode-head">
          <p class="muted small">
            {ep.chapter.title} · Episode {ep.number}
          </p>
          <h1 class="display">{ep.title}</h1>
          {ep.hidden && <span class="badge attention">Hidden by a moderator</span>}
          <div class="episode-meta">
            <UserChip user={ep.story.author} />
            <span class="muted small">
              {readTime(ep.words)} · {ago(ep.publishedAt)}
            </span>
          </div>
        </header>

        <RemotePictures media={ep.media}>
          <div class="reader-log" data-testid="reader-log">
            <StoryLog story={story} leadOnRight={settings.value.leadOnRight} showNotes={false} />
          </div>
        </RemotePictures>

        <div class="reader-actions">
          <button type="button" class={`btn${ep.viewer.liked ? ' on' : ''}`} aria-pressed={ep.viewer.liked} onClick={like} data-testid="like">
            <Heart size={16} /> {ep.likes}
          </button>
          <a class="btn" href="#comments" onClick={(e) => (e.preventDefault(), document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' }))}>
            <MessageCircle size={16} /> {ep.comments}
          </a>
          {!ep.viewer.isAuthor && (
            <button type="button" class={`btn${ep.viewer.followingStory ? ' on' : ''}`} aria-pressed={ep.viewer.followingStory} onClick={follow}>
              <BookOpen size={16} /> {ep.viewer.followingStory ? 'Following' : 'Follow story'}
            </button>
          )}
        </div>

        <nav class="episode-nav" aria-label="Episodes">
          {ep.prev ? (
            <a class="btn" href={`#${cPath.episode(ep.prev.id)}`}>
              <ChevronLeft size={16} /> #{ep.prev.number} {ep.prev.title}
            </a>
          ) : (
            <span />
          )}
          {ep.next ? (
            <a class="btn primary" href={`#${cPath.episode(ep.next.id)}`} data-testid="next-episode">
              #{ep.next.number} {ep.next.title} <ChevronRight size={16} />
            </a>
          ) : (
            <span class="muted small">{ep.viewer.followingStory ? "You'll hear about the next episode." : 'Latest episode'}</span>
          )}
        </nav>

        {ep.viewer.isAuthor && <AuthorTools ep={ep} />}

        <div id="comments">
          <Comments episodeId={ep.id} focusId={comment} onCount={(d) => setData({ ...ep, comments: ep.comments + d })} />
        </div>

        <footer class="page-foot">
          {!ep.viewer.isAuthor && <ReportButton kind="episode" id={ep.id} what="this episode" />}
          {ep.viewer.canModerate && (
            <button type="button" class="link small" onClick={toggleHidden}>
              <EyeOff size={14} /> {ep.hidden ? 'Unhide episode' : 'Hide episode'}
            </button>
          )}
          {(ep.viewer.isAuthor || ep.viewer.canModerate) && (
            <button type="button" class="link small danger" onClick={remove}>
              <Trash2 size={14} /> Delete episode
            </button>
          )}
        </footer>
      </article>
    </div>
  );
}
