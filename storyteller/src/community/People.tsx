import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { Bell, BookOpen, Heart, MessageCircle, Reply, ShieldBan, ShieldCheck, Trash2, UserCheck, UserPlus } from 'lucide-preact';
import { cPath, go } from '../router';
import type { AuthorProfile, NotificationDto } from '../shared/api';
import { showToast } from '../store/storyStore';
import { Avatar } from '../ui/controls';
import { confirmAction } from '../ui/overlay';
import { ago } from '../views/shared';
import { del, errorText, me, post, put, refreshMe } from './api';
import { usePaged } from './CommunityHome';
import { CommunityPage } from './StoryPage';
import { Empty, ErrorBox, Loading, ReportButton, StoryCardView, plural, requireAccount, useApi } from './ui';

export function AuthorPage({ username }: { username: string }) {
  const { data: a, error, reload, setData } = useApi<AuthorProfile>(`/users/${username}`, [username]);
  if (error) return <CommunityPage><ErrorBox error={error} retry={reload} /></CommunityPage>;
  if (!a) return <CommunityPage><Loading /></CommunityPage>;
  const admin = me.value?.role === 'admin';

  const follow = async () => {
    if (!requireAccount('Sign in to follow writers.')) return;
    try {
      const r = await (a.viewer.following ? del : put)<{ following: boolean; followers: number }>(`/users/${a.username}/follow`);
      setData({ ...a, followers: r.followers, viewer: { ...a.viewer, following: r.following } });
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const ban = async () => {
    const ok = await confirmAction({
      title: a.banned ? `Lift the suspension of @${a.username}?` : `Suspend @${a.username}?`,
      message: a.banned ? <p>Their stories and comments become visible again.</p> : <p>They can still sign in and read, but can't publish, comment or like, and their stories and comments are hidden.</p>,
      confirmLabel: a.banned ? 'Lift suspension' : 'Suspend',
      danger: !a.banned,
    });
    if (!ok) return;
    try {
      await (a.banned ? del : put)(`/mod/users/${a.username}/ban`);
      void reload();
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const role = async (next: 'user' | 'moderator') => {
    try {
      await put(`/admin/users/${a.username}/role`, { role: next });
      showToast(next === 'moderator' ? `@${a.username} is now a moderator` : `@${a.username} is no longer a moderator`);
    } catch (err) {
      showToast(errorText(err));
    }
  };
  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete the account @${a.username}?`,
      message: <p>Everything they published is removed. This can't be undone.</p>,
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (!ok) return;
    try {
      await del(`/admin/users/${a.username}`);
      showToast('Account deleted');
      go(cPath.home(), true);
    } catch (err) {
      showToast(errorText(err));
    }
  };

  return (
    <CommunityPage>
      <div class="author-hero">
        <Avatar name={a.displayName} color={a.color} size={84} />
        <h1 class="display">{a.displayName}</h1>
        <p class="muted">@{a.username}{a.banned && ' · suspended'}</p>
        {a.bio && <p class="author-bio">{a.bio}</p>}
        <p class="muted small">
          {plural(a.followers, 'follower')} · following {a.following} · since {new Date(a.createdAt).toLocaleDateString()}
        </p>
        {!a.viewer.isSelf && (
          <button type="button" class={`btn${a.viewer.following ? ' on' : ''}`} aria-pressed={a.viewer.following} onClick={follow}>
            {a.viewer.following ? <UserCheck size={16} /> : <UserPlus size={16} />} {a.viewer.following ? 'Following' : 'Follow'}
          </button>
        )}
        {a.viewer.isSelf && (
          <a class="btn small" href="#/account">
            Edit your page
          </a>
        )}
      </div>
      <h2 class="section-title">Stories</h2>
      {a.stories.length === 0 ? (
        <Empty icon={<BookOpen size={26} />} title="No stories yet" />
      ) : (
        <ul class="c-cards">
          {a.stories.map((s) => (
            <StoryCardView key={s.id} card={s} />
          ))}
        </ul>
      )}
      <footer class="page-foot">
        {!a.viewer.isSelf && <ReportButton kind="user" id={a.username} what={`@${a.username}`} />}
        {a.viewer.canModerate && (
          <button type="button" class="link small" onClick={ban}>
            <ShieldBan size={14} /> {a.banned ? 'Lift suspension' : 'Suspend'}
          </button>
        )}
        {admin && a.viewer.canModerate && (
          <>
            <button type="button" class="link small" onClick={() => role('moderator')}>
              <ShieldCheck size={14} /> Make moderator
            </button>
            <button type="button" class="link small" onClick={() => role('user')}>
              Remove moderator
            </button>
            <button type="button" class="link small danger" onClick={remove}>
              <Trash2 size={14} /> Delete account
            </button>
          </>
        )}
      </footer>
    </CommunityPage>
  );
}

function describe(n: NotificationDto): { text: string; href: string; icon: ComponentChildren } {
  const who = n.actor?.displayName ?? 'Someone';
  const ep = n.episode ? `“${n.episode.title}”` : 'an episode';
  switch (n.kind) {
    case 'like':
      return { icon: <Heart size={18} />, text: `${who} liked ${ep}`, href: n.episode ? cPath.episode(n.episode.id) : cPath.home() };
    case 'comment':
      return {
        icon: <MessageCircle size={18} />,
        text: `${who} commented on ${ep}${n.comment ? `: “${n.comment.excerpt}”` : ''}`,
        href: n.episode ? cPath.episode(n.episode.id, n.comment?.id) : cPath.home(),
      };
    case 'reply':
      return {
        icon: <Reply size={18} />,
        text: `${who} replied to your comment${n.comment ? `: “${n.comment.excerpt}”` : ''}`,
        href: n.episode ? cPath.episode(n.episode.id, n.comment?.id) : cPath.home(),
      };
    case 'follow':
      return { icon: <UserPlus size={18} />, text: `${who} started following you`, href: n.actor ? cPath.user(n.actor.username) : cPath.home() };
    case 'episode':
      return {
        icon: <BookOpen size={18} />,
        text: `New in ${n.story ? `“${n.story.title}”` : 'a story you follow'}: #${n.episode?.number ?? ''} ${n.episode?.title ?? ''}`,
        href: n.episode ? cPath.episode(n.episode.id) : cPath.home(),
      };
  }
}

export function Notifications() {
  const list = usePaged<NotificationDto>(me.value ? '/notifications' : null);
  const newest = list.items[0]?.id;
  // Opening the list marks everything up to the newest one as read.
  useEffect(() => {
    if (!newest) return;
    void post('/notifications/read', { upTo: newest }).then(() => refreshMe());
  }, [newest]);
  if (!me.value) {
    return (
      <CommunityPage>
        <Empty icon={<Bell size={26} />} title="Sign in to see notifications" />
      </CommunityPage>
    );
  }
  return (
    <CommunityPage>
      <h1 class="display page-title">Notifications</h1>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : null}
      {!list.loading && list.items.length === 0 && (
        <Empty icon={<Bell size={26} />} title="Nothing yet">
          Likes, comments, replies, new followers and new episodes of stories you follow show up here.
        </Empty>
      )}
      <ul class="feed notifications">
        {list.items.map((n) => {
          const d = describe(n);
          return (
            <li key={n.id} class={n.read ? '' : 'unread'}>
              <a class="feed-item" href={`#${d.href}`}>
                <span class="note-icon">{d.icon}</span>
                <span class="feed-text">
                  <span>{d.text}</span>
                  <span class="muted small">{ago(n.createdAt)}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {list.next && (
        <button type="button" class="btn wide" onClick={list.more}>
          Older
        </button>
      )}
    </CommunityPage>
  );
}
