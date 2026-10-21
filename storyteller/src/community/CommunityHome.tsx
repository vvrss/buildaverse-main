import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Bell, BookOpenText, Compass, Rss, Search, ShieldCheck } from 'lucide-preact';
import { type CommunityTab, type Route, cPath, go } from '../router';
import { GENRES, type EpisodeRef, type EpisodeSummary, type Page, type StoryCard } from '../shared/api';
import { Avatar, Segmented } from '../ui/controls';
import { ago } from '../views/shared';
import { get, me } from './api';
import { Empty, ErrorBox, Loading, StoryCardView, requireAccount, useApi } from './ui';

type HomeRoute = Extract<Route, { name: 'community' }>;

/** A list that loads page by page ("Load more"). */
export function usePaged<T>(path: string | null) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const load = useCallback(
    async (cursor: string | null) => {
      if (!path) return;
      const n = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const sep = path.includes('?') ? '&' : '?';
        const page = await get<Page<T>>(`${path}${cursor ? `${sep}cursor=${encodeURIComponent(cursor)}` : ''}`);
        if (n !== seq.current) return;
        setItems((old) => (cursor ? [...old, ...page.items] : page.items));
        setNext(page.next);
      } catch (err) {
        if (n === seq.current) setError(err);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    },
    [path],
  );
  useEffect(() => {
    setItems([]);
    setNext(null);
    void load(null);
  }, [load]);
  return { items, next, loading, error, more: () => void load(next), reload: () => void load(null) };
}

function MoreButton({ next, loading, more }: { next: string | null; loading: boolean; more: () => void }) {
  if (!next) return null;
  return (
    <button type="button" class="btn wide" disabled={loading} onClick={more}>
      {loading ? 'Loading…' : 'Load more'}
    </button>
  );
}

function Discover({ r }: { r: HomeRoute }) {
  const params = new URLSearchParams();
  if (r.q) params.set('q', r.q);
  if (r.genre) params.set('genre', r.genre);
  if (r.tag) params.set('tag', r.tag);
  if (r.sort === 'popular') params.set('sort', 'popular');
  const list = usePaged<StoryCard>(`/stories?${params}`);
  const tags = useApi<{ items: { tag: string; stories: number }[] }>('/tags');
  const nav = (change: Partial<Record<'q' | 'genre' | 'tag' | 'sort', string>>) =>
    go(cPath.home('discover', { q: r.q, genre: r.genre, tag: r.tag, sort: r.sort === 'popular' ? 'popular' : '', ...change }), true);

  return (
    <>
      <div class="chip-row" role="group" aria-label="Genres and tags">
        <button type="button" class={`filter-chip${!r.genre && !r.tag ? ' on' : ''}`} onClick={() => nav({ genre: '', tag: '' })}>
          All
        </button>
        {GENRES.map((g) => (
          <button key={g} type="button" class={`filter-chip${r.genre === g ? ' on' : ''}`} onClick={() => nav({ genre: r.genre === g ? '' : g })}>
            {g}
          </button>
        ))}
        {(tags.data?.items.length ?? 0) > 0 && <span class="chip-gap" aria-hidden="true" />}
        {tags.data?.items.slice(0, 20).map((t) => (
          <button key={t.tag} type="button" class={`filter-chip tag${r.tag === t.tag ? ' on' : ''}`} onClick={() => nav({ tag: r.tag === t.tag ? '' : t.tag })}>
            #{t.tag}
          </button>
        ))}
      </div>
      <div class="c-toolbar">
        <span class="muted small">
          {r.q && `Results for “${r.q}”`}
          {r.tag && ` #${r.tag}`}
        </span>
        <Segmented
          label="Sort"
          value={r.sort}
          options={[
            ['recent', 'New'],
            ['popular', 'Popular'],
          ]}
          onChange={(sort) => nav({ sort: sort === 'popular' ? 'popular' : '' })}
        />
      </div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : null}
      {!list.error && list.items.length === 0 && !list.loading && (
        <Empty icon={<Compass size={28} />} title={r.q || r.genre || r.tag ? 'Nothing matches yet' : 'No stories yet'}>
          {r.q || r.genre || r.tag ? 'Try fewer filters.' : 'Be the first: open a story, then Export → Publish to Community.'}
        </Empty>
      )}
      <ul class="c-cards">
        {list.items.map((card) => (
          <StoryCardView key={card.id} card={card} />
        ))}
      </ul>
      {list.loading && list.items.length === 0 && <Loading />}
      <MoreButton {...list} />
    </>
  );
}

interface FeedItem {
  story: StoryCard;
  episode: EpisodeSummary;
}

function Following() {
  const list = usePaged<FeedItem>(me.value ? '/feed' : null);
  if (!me.value) return <SignInHint what="see new episodes from the stories and writers you follow" />;
  return (
    <>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : null}
      {!list.error && !list.loading && list.items.length === 0 && (
        <Empty icon={<Rss size={28} />} title="Nothing here yet">
          Follow a story or a writer, and their new episodes show up here.
        </Empty>
      )}
      <ul class="feed">
        {list.items.map(({ story, episode }) => (
          <li key={episode.id}>
            <a class="feed-item" href={`#${cPath.episode(episode.id)}`}>
              <Avatar name={story.author.displayName} color={story.author.color} size={36} />
              <span class="feed-text">
                <b>
                  #{episode.number} {episode.title}
                </b>
                <span class="muted small">
                  {story.title} · {story.author.displayName} · {ago(episode.publishedAt)}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {list.loading && list.items.length === 0 && <Loading />}
      <MoreButton {...list} />
    </>
  );
}

function Reading() {
  const list = useApi<{ items: { story: StoryCard; current: EpisodeRef | null; next: EpisodeRef | null }[] }>(me.value ? '/me/reading' : null);
  if (!me.value) return <SignInHint what="keep your place in every story you read" />;
  if (list.error) return <ErrorBox error={list.error} retry={list.reload} />;
  if (!list.data) return <Loading />;
  if (list.data.items.length === 0) {
    return (
      <Empty icon={<BookOpenText size={28} />} title="Nothing in progress">
        Stories you start reading are kept here, so you can continue where you left off.
      </Empty>
    );
  }
  return (
    <ul class="feed">
      {list.data.items.map(({ story, current, next }) => {
        const target = next ?? current;
        return (
          <li key={story.id}>
            <a class="feed-item" href={`#${target ? cPath.episode(target.id) : cPath.story(story.id)}`}>
              <Avatar name={story.author.displayName} color={story.author.color} size={36} />
              <span class="feed-text">
                <b>{story.title}</b>
                <span class="muted small">
                  {next ? `Up next: #${next.number} ${next.title}` : current ? `Read up to #${current.number} · all caught up` : 'Start reading'}
                </span>
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function SignInHint({ what }: { what: string }) {
  return (
    <Empty title="Sign in to the Community">
      Sign in to {what}.{' '}
      <button type="button" class="link" onClick={() => requireAccount(`Sign in to ${what}.`)}>
        Sign in or create an account
      </button>
    </Empty>
  );
}

const TABS: [CommunityTab, string][] = [
  ['discover', 'Discover'],
  ['following', 'Following'],
  ['reading', 'Reading'],
];

export function CommunityHome({ r }: { r: HomeRoute }) {
  const [q, setQ] = useState(r.q);
  useEffect(() => setQ(r.q), [r.q]);
  const m = me.value;
  return (
    <div class="screen community">
      <header class="screen-head c-head">
        <h1 class="display">Community</h1>
        <div class="c-head-actions">
          {m && (m.role === 'moderator' || m.role === 'admin') && (
            <a class="icon-btn" href={`#${cPath.mod()}`} aria-label="Moderation">
              <ShieldCheck size={22} />
            </a>
          )}
          {m && (
            <a class="icon-btn badge-host" href={`#${cPath.notifications()}`} aria-label={`Notifications${m.unreadNotifications ? `, ${m.unreadNotifications} new` : ''}`}>
              <Bell size={22} />
              {m.unreadNotifications > 0 && <span class="count-badge">{m.unreadNotifications > 99 ? '99+' : m.unreadNotifications}</span>}
            </a>
          )}
          {m ? (
            <a href={`#${cPath.user(m.username)}`} aria-label="Your writer page">
              <Avatar name={m.displayName} color={m.color} size={32} />
            </a>
          ) : (
            <button type="button" class="btn small" onClick={() => requireAccount('Sign in to follow, like and comment.')}>
              Sign in
            </button>
          )}
        </div>
      </header>
      <form
        class="search c-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(cPath.home('discover', { q: q.trim(), genre: r.genre, tag: r.tag, sort: r.sort === 'popular' ? 'popular' : '' }));
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input type="search" placeholder="Search stories, writers, tags" aria-label="Search the Community" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      </form>
      <nav class="tabs c-tabs" aria-label="Community">
        {TABS.map(([tab, label]) => (
          <a key={tab} href={`#${cPath.home(tab)}`} class={r.tab === tab ? 'active' : ''} aria-current={r.tab === tab ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <div class="c-body">
        {r.tab === 'discover' && <Discover r={r} />}
        {r.tab === 'following' && <Following />}
        {r.tab === 'reading' && <Reading />}
      </div>
    </div>
  );
}
