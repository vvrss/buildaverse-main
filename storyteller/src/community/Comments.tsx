import { useEffect, useState } from 'preact/hooks';
import { CornerDownRight, EyeOff, Heart, Pencil, Trash2 } from 'lucide-preact';
import type { CommentDto } from '../shared/api';
import { showToast } from '../store/storyStore';
import { Avatar } from '../ui/controls';
import { confirmAction } from '../ui/overlay';
import { ago } from '../views/shared';
import { cPath } from '../router';
import { del, errorText, me, patch, post, put } from './api';
import { usePaged } from './CommunityHome';
import { ErrorBox, ReportButton, requireAccount } from './ui';

function CommentBox({ placeholder, initial = '', submitLabel, onSubmit, onCancel, autoFocus }: {
  placeholder: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="comment-box"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          await onSubmit(text);
          setText('');
        } catch (err) {
          showToast(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        rows={2}
        maxLength={2000}
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        aria-label={placeholder}
        onFocus={() => !me.value && requireAccount('Sign in to join the conversation.')}
        onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        data-testid="comment-input"
      />
      <div class="comment-box-actions">
        {onCancel && (
          <button type="button" class="btn small" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" class="btn small primary" disabled={busy || !text.trim()} data-testid="comment-submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function Comment({ c, episodeId, highlight, onChange }: { c: CommentDto; episodeId: string; highlight: boolean; onChange: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'reply'>('view');
  const [liked, setLiked] = useState(c.viewer.liked);
  const [likes, setLikes] = useState(c.likes);
  const mod = me.value && (me.value.role === 'moderator' || me.value.role === 'admin');

  const like = async () => {
    if (!requireAccount('Sign in to like comments.')) return;
    try {
      const r = await (liked ? del : put)<{ liked: boolean; likes: number }>(`/comments/${c.id}/like`);
      setLiked(r.liked);
      setLikes(r.likes);
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const remove = async () => {
    const ok = await confirmAction({ title: 'Delete this comment?', message: <p>It can't be brought back.</p>, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await del(`/comments/${c.id}`);
      onChange();
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const hide = async () => {
    try {
      await (c.hidden ? del : put)(`/mod/comments/${c.id}/hidden`);
      onChange();
    } catch (err) {
      showToast(errorText(err));
    }
  };

  return (
    <div class={`comment${highlight ? ' highlight' : ''}${c.hidden ? ' hidden-item' : ''}`} id={`comment-${c.id}`}>
      {c.author ? <Avatar name={c.author.displayName} color={c.author.color} size={30} /> : <span class="avatar ghost" style="width:30px;height:30px" />}
      <div class="comment-main">
        <div class="comment-meta small">
          {c.author ? (
            <a href={`#${cPath.user(c.author.username)}`}>
              <b>{c.author.displayName}</b>
            </a>
          ) : (
            <span class="muted">Deleted</span>
          )}
          <span class="muted">
            {' '}
            · {ago(c.createdAt)}
            {c.editedAt && ' · edited'}
            {c.hidden && ' · hidden'}
          </span>
        </div>
        {mode === 'edit' ? (
          <CommentBox
            placeholder="Edit your comment"
            initial={c.body}
            submitLabel="Save"
            autoFocus
            onCancel={() => setMode('view')}
            onSubmit={async (text) => {
              await patch(`/comments/${c.id}`, { body: text });
              setMode('view');
              onChange();
            }}
          />
        ) : (
          <p class="comment-body">{c.deleted ? <i class="muted">This comment was deleted.</i> : c.body}</p>
        )}
        {!c.deleted && mode !== 'edit' && (
          <div class="comment-actions small">
            <button type="button" class={`link${liked ? ' on' : ''}`} aria-pressed={liked} onClick={like}>
              <Heart size={14} /> {likes > 0 ? likes : 'Like'}
            </button>
            <button type="button" class="link" onClick={() => requireAccount('Sign in to reply.') && setMode(mode === 'reply' ? 'view' : 'reply')}>
              <CornerDownRight size={14} /> Reply
            </button>
            {c.viewer.canEdit && (
              <button type="button" class="link" onClick={() => setMode('edit')}>
                <Pencil size={14} /> Edit
              </button>
            )}
            {c.viewer.canDelete && (
              <button type="button" class="link" onClick={remove}>
                <Trash2 size={14} /> Delete
              </button>
            )}
            {mod && (
              <button type="button" class="link" onClick={hide}>
                <EyeOff size={14} /> {c.hidden ? 'Unhide' : 'Hide'}
              </button>
            )}
            {c.author && me.value?.username !== c.author.username && <ReportButton kind="comment" id={String(c.id)} what="this comment" />}
          </div>
        )}
        {mode === 'reply' && (
          <CommentBox
            placeholder={`Reply to ${c.author?.displayName ?? 'this comment'}`}
            submitLabel="Reply"
            autoFocus
            onCancel={() => setMode('view')}
            onSubmit={async (text) => {
              await post(`/episodes/${episodeId}/comments`, { body: text, parentId: c.id });
              setMode('view');
              onChange();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Comments and one level of replies under an episode. */
export function Comments({ episodeId, focusId, onCount }: { episodeId: string; focusId: number | null; onCount: (delta: number) => void }) {
  const list = usePaged<CommentDto>(`/episodes/${episodeId}/comments`);

  useEffect(() => {
    if (!focusId || list.items.length === 0) return;
    document.getElementById(`comment-${focusId}`)?.scrollIntoView({ block: 'center' });
  }, [focusId, list.items.length]);

  return (
    <section class="comments" aria-label="Comments">
      <h2 class="section-title">Comments</h2>
      <CommentBox
        placeholder="Say something about this episode"
        submitLabel="Post"
        onSubmit={async (text) => {
          if (!requireAccount('Sign in to comment.')) return;
          await post(`/episodes/${episodeId}/comments`, { body: text });
          onCount(1);
          list.reload();
        }}
      />
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : null}
      {!list.loading && !list.error && list.items.length === 0 && <p class="muted small">No comments yet. Be the first.</p>}
      <ul class="comment-list">
        {list.items.map((c) => (
          <li key={c.id}>
            <Comment c={c} episodeId={episodeId} highlight={focusId === c.id} onChange={list.reload} />
            {c.replies.length > 0 && (
              <ul class="replies">
                {c.replies.map((r) => (
                  <li key={r.id}>
                    <Comment c={r} episodeId={episodeId} highlight={focusId === r.id} onChange={list.reload} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {list.next && (
        <button type="button" class="btn wide" disabled={list.loading} onClick={list.more}>
          Older comments
        </button>
      )}
    </section>
  );
}
