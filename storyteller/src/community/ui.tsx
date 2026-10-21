import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Flag, Heart, Link2, RefreshCw, Users, WifiOff } from 'lucide-preact';
import { cPath, go, shareUrl } from '../router';
import type { ReportReason, StoryCard, UserSummary } from '../shared/api';
import { currentProfile } from '../store/profile';
import { showToast } from '../store/storyStore';
import { Avatar } from '../ui/controls';
import { tint } from '../ui/color';
import { Sheet, closeSheet, showSheet } from '../ui/overlay';
import { copyText } from '../views/shared';
import { AccountSheet } from './AccountForms';
import { errorText, get, isOffline, me, post } from './api';
import { RemoteImage } from './media';

/** Loads `path` (null: nothing to load); reloads when `deps` change. Older answers never overwrite newer ones. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await get<T>(path);
      if (n === seq.current) setData(d);
    } catch (err) {
      if (n === seq.current) setError(err);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, setData, error, loading, reload: load };
}

export const readTime = (words: number) => `${Math.max(1, Math.round(words / 220))} min read`;

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

export function UserChip({ user, size = 28 }: { user: UserSummary; size?: number }) {
  return (
    <a class="user-chip" href={`#${cPath.user(user.username)}`}>
      <Avatar name={user.displayName} color={user.color} size={size} />
      <span>{user.displayName}</span>
    </a>
  );
}

/** A story in a list: cover (or the author's colors), title, author and counts. */
export function StoryCardView({ card }: { card: StoryCard }) {
  return (
    <li class="c-card">
      <a class="c-card-link" href={`#${cPath.story(card.id)}`}>
        <div class="c-cover" style={tint(card.author.color)}>
          {card.cover ? (
            <RemoteImage media={card.cover} alt="" sizes="(max-width: 640px) 46vw, 240px" />
          ) : (
            <span class="c-cover-initial" aria-hidden="true">
              {[...(card.title.trim() || '?')][0].toUpperCase()}
            </span>
          )}
          {card.hidden && <span class="badge attention">Hidden</span>}
        </div>
        <div class="c-card-body">
          <b class="c-card-title">{card.title}</b>
          <span class="muted small">
            {card.author.displayName}
            {card.genre && ` · ${card.genre}`}
          </span>
          <span class="c-stats muted small">
            <span>
              {card.episodes} {card.episodes === 1 ? 'episode' : 'episodes'}
            </span>
            {card.likes > 0 && (
              <span aria-label={`${card.likes} likes`}>
                <Heart size={12} /> {card.likes}
              </span>
            )}
            {card.followers > 0 && (
              <span aria-label={`${card.followers} followers`}>
                <Users size={12} /> {card.followers}
              </span>
            )}
          </span>
        </div>
      </a>
    </li>
  );
}

export function Empty({ icon, title, children }: { icon?: ComponentChildren; title: string; children?: ComponentChildren }) {
  return (
    <div class="c-empty">
      {icon}
      <b>{title}</b>
      {children && <p class="muted">{children}</p>}
    </div>
  );
}

/** An error with a way to try again; offline gets its own wording. */
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const offline = isOffline(error);
  return (
    <div class={`c-error${offline ? ' offline' : ''}`} role="alert">
      {offline ? <WifiOff size={22} /> : null}
      <p>{offline ? "You're offline. Stories you opened before may still show their pictures." : errorText(error)}</p>
      {retry && (
        <button type="button" class="btn" onClick={retry}>
          <RefreshCw size={16} /> Try again
        </button>
      )}
    </div>
  );
}

export function Loading() {
  return <div class="c-loading" aria-label="Loading" role="status" />;
}

/** Shares a link with the system sheet, or copies it. */
export async function shareLink(kind: 's' | 'e', id: string, title: string) {
  const url = shareUrl(kind, id);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  showToast((await copyText(url)) ? 'Link copied' : url);
}

export function ShareButton({ kind, id, title }: { kind: 's' | 'e'; id: string; title: string }) {
  return (
    <button type="button" class="btn" onClick={() => void shareLink(kind, id, title)}>
      <Link2 size={16} /> Share
    </button>
  );
}

/**
 * Liking, following, commenting and reporting need an account. Without one,
 * this opens the sign-in sheet (or, for visitors without a profile, says how
 * to join) and returns false.
 */
export function requireAccount(why: string): boolean {
  if (me.value) return true;
  if (!currentProfile.value) {
    showSheet(
      <Sheet title="Join in">
        <p class="confirm-message">{why} First set up Storyteller on this device: it takes a few seconds and needs no email.</p>
        <div class="sheet-actions">
          <button type="button" class="btn" onClick={() => closeSheet()}>
            Not now
          </button>
          <button
            type="button"
            class="btn primary"
            data-autofocus
            onClick={() => {
              closeSheet();
              rememberReturn();
              go('/');
            }}
          >
            Get started
          </button>
        </div>
      </Sheet>,
    );
    return false;
  }
  showSheet(<AccountSheet reason={why} />);
  return false;
}

const RETURN_KEY = 'storyteller:return';

/** Where to come back to after creating a profile (a shared link someone opened). */
export function rememberReturn() {
  try {
    sessionStorage.setItem(RETURN_KEY, location.hash.slice(1));
  } catch {
    // Without session storage, people land on Home instead.
  }
}

export function takeReturn(): string | null {
  try {
    const v = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return v && v.startsWith('/c') ? v : null;
  } catch {
    return null;
  }
}

const REASONS: [ReportReason, string][] = [
  ['spam', 'Spam or advertising'],
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate speech'],
  ['sexual', 'Sexual content'],
  ['violence', 'Threats or violence'],
  ['copyright', 'Someone else’s work'],
  ['other', 'Something else'],
];

function ReportSheet({ kind, id, what }: { kind: 'story' | 'episode' | 'comment' | 'user'; id: string; what: string }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await post('/reports', { targetKind: kind, targetId: id, reason, details });
      closeSheet();
      showToast('Thanks. A moderator will look at it.');
    } catch (err) {
      showToast(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Report ${what}`}>
      <div class="radio-list" role="radiogroup" aria-label="Reason">
        {REASONS.map(([r, label]) => (
          <label key={r} class="radio-row">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <textarea
        class="field"
        rows={3}
        maxLength={500}
        placeholder="Anything a moderator should know (optional)"
        value={details}
        onInput={(e) => setDetails((e.currentTarget as HTMLTextAreaElement).value)}
      />
      <div class="sheet-actions">
        <button type="button" class="btn" onClick={() => closeSheet()}>
          Cancel
        </button>
        <button type="button" class="btn primary" disabled={!reason || busy} onClick={send}>
          Send report
        </button>
      </div>
    </Sheet>
  );
}

export function reportThing(kind: 'story' | 'episode' | 'comment' | 'user', id: string, what: string) {
  if (!requireAccount('Sign in to report something.')) return;
  showSheet(<ReportSheet kind={kind} id={id} what={what} />);
}

export function ReportButton(props: { kind: 'story' | 'episode' | 'comment' | 'user'; id: string; what: string }) {
  return (
    <button type="button" class="link small muted-link" onClick={() => reportThing(props.kind, props.id, props.what)}>
      <Flag size={14} /> Report
    </button>
  );
}
