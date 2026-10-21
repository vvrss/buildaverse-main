import type { ComponentChildren } from 'preact';
import { Globe, RefreshCw } from 'lucide-preact';
import { type Route, go } from '../router';
import { checkCommunity, community } from './api';
import { CommunityHome } from './CommunityHome';
import { Moderation } from './Moderation';
import { AuthorPage, Notifications } from './People';
import { Reader } from './Reader';
import { StoryPage } from './StoryPage';
import { rememberReturn } from './ui';

/** Explains why there is no Community, when there isn't one. */
function Gate({ children }: { children: ComponentChildren }) {
  const state = community.value;
  if (state === 'ready') return <>{children}</>;
  if (state === 'unknown' || state === 'checking') return <div class="screen"><div class="c-loading" role="status" aria-label="Connecting" /></div>;
  return (
    <div class="screen community">
      <header class="screen-head">
        <h1 class="display">Community</h1>
      </header>
      <div class="c-empty">
        <Globe size={30} />
        <b>{state === 'outdated' ? 'Update the app to use the Community' : "Community isn't set up here"}</b>
        <p class="muted">
          {state === 'outdated'
            ? 'The server needs a newer version of Storyteller. Reload the page to update.'
            : 'This copy of Storyteller has no server to share stories through. Everything else works: your stories, pictures and gestures stay on this device. To publish, run the Storyteller server (see DEPLOY.md).'}
        </p>
        <button type="button" class="btn" onClick={() => (state === 'outdated' ? location.reload() : void checkCommunity(true))}>
          <RefreshCw size={16} /> {state === 'outdated' ? 'Reload' : 'Try again'}
        </button>
      </div>
    </div>
  );
}

export function CommunityView({ r }: { r: Route }) {
  let page;
  if (r.name === 'community') page = <CommunityHome r={r} />;
  else if (r.name === 'c-story') page = <StoryPage key={r.id} id={r.id} />;
  else if (r.name === 'c-episode') page = <Reader key={r.id} id={r.id} comment={r.comment} />;
  else if (r.name === 'c-user') page = <AuthorPage key={r.username} username={r.username} />;
  else if (r.name === 'c-notifications') page = <Notifications />;
  else if (r.name === 'c-mod') page = <Moderation />;
  else return null;
  return <Gate>{page}</Gate>;
}

/** For visitors without a profile on this device: a shared link opens straight into reading. */
export function PublicShell({ r }: { r: Route }) {
  return (
    <div class="public-shell">
      <div class="public-bar">
        <span class="public-brand">
          <b>Storyteller</b>
          <span class="muted small">Stories told in dialog</span>
        </span>
        <button
          type="button"
          class="btn small primary"
          onClick={() => {
            rememberReturn();
            go('/');
          }}
          data-testid="write-your-own"
        >
          Write your own
        </button>
      </div>
      <main class="main">
        <CommunityView r={r} />
      </main>
    </div>
  );
}
