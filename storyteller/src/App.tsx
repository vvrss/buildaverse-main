import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BookOpen, ChevronLeft, Settings as SettingsIcon, Share, Signature } from 'lucide-preact';
import { ShortcutsPage } from './gestures/GestureSettings';
import { type Tab, go, route, storyPath } from './router';
import { trackVisualViewport } from './shortcuts/keyboardViewport';
import { currentProfile, hasProfiles, lockedProfile, profilesReady } from './store/profile';
import { dbStatus } from './store/db';
import { closeStory, openStory, saveState, setTitle, settleEdit, story, storyId, toast } from './store/storyStore';
import { profileId } from './store/session';
import { gesturePadOpen } from './store/ui';
import { Inert, ScreenBehindSheets, SheetHost, closeAllSheets, showSheet } from './ui/overlay';
import { AccountScreen } from './views/AccountScreen';
import { AiExchange } from './views/AiExchange';
import { CharactersPanel } from './views/CharactersPanel';
import { Editor } from './views/Editor';
import { ExportSheet } from './views/ExportSheet';
import { Home } from './views/Home';
import { LockScreen, ProfilePicker, Welcome } from './views/ProfileScreens';
import { SettingsScreen } from './views/SettingsScreen';
import { TextMode } from './views/TextMode';

// Sheets belong to the screen they were opened on. This runs synchronously on
// navigation, so a sheet opened right after a page change is never closed late.
let screenKey = '';
effect(() => {
  const r = route.value;
  const key = `${r.name}|${r.name === 'story' ? `${r.id}|${r.tab}` : ''}|${profileId.value ?? ''}`;
  if (key !== screenKey) {
    screenKey = key;
    closeAllSheets();
    // Leaving the Write tab: an open edit or typed line goes into the story
    // before Text, Cast or AI read it.
    if (r.name === 'story' && r.tab !== 'chat') settleEdit();
  }
});

/** Shown when another window holds or has upgraded the database. */
function DbNotice() {
  const status = dbStatus.value;
  if (status === 'ok') return null;
  return (
    <div class="db-notice" role="alertdialog" aria-live="assertive">
      <div class="db-notice-card">
        {status === 'blocked' ? (
          <>
            <h2>Finishing an update</h2>
            <p>Storyteller is open in another window or tab with an older version. Close it to continue. Nothing is lost.</p>
          </>
        ) : (
          <>
            <h2>Storyteller was updated</h2>
            <p>A newer version is running in another window. Reload to keep writing here.</p>
            <button type="button" class="btn primary" autoFocus onClick={() => location.reload()}>
              Reload
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const TABS: [Tab, string][] = [
  ['chat', 'Write'],
  ['text', 'Text'],
  ['cast', 'Cast'],
  ['ai', 'AI'],
];

function Toast() {
  const t = toast.value;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!t) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(timer);
  }, [t?.key]);
  if (!t) return null;
  return (
    <div class={`toast${visible ? ' show' : ''}`} role="status" aria-live="polite" data-testid="toast">
      {t.text}
    </div>
  );
}

function StoryScreen({ id, tab }: { id: string; tab: Tab }) {
  const [state, setState] = useState<'loading' | 'ready'>(storyId.value === id ? 'ready' : 'loading');

  useEffect(() => {
    let alive = true;
    openStory(id).then((ok) => {
      if (!alive) return;
      if (ok) setState('ready');
      else go('/', true);
    });
    return () => {
      alive = false;
      // However the story is left (in-app back, the phone's back, a link),
      // everything is saved and the gesture pad does not follow.
      gesturePadOpen.value = false;
      void closeStory(id);
    };
  }, [id]);

  useEffect(() => {
    if (tab !== 'chat') gesturePadOpen.value = false;
  }, [tab]);

  if (state === 'loading') return <div class="screen muted center">Opening…</div>;

  const back = async () => {
    await closeStory(id);
    // Unless the person already went somewhere else while it saved.
    const r = route.value;
    if (r.name === 'story' && r.id === id) go('/');
  };

  const saveTitle = saveState.value === 'saved' ? 'Saved on this device' : saveState.value === 'error' ? 'Saving failed' : 'Saving…';

  return (
    <>
      <header class="topbar">
        <div class="topbar-row">
          <button type="button" class="icon-btn" aria-label="Back to stories" onClick={back}>
            <ChevronLeft size={24} />
          </button>
          <input
            id="story-title"
            type="text"
            class="title"
            value={story.value.title}
            aria-label="Story title"
            onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
          />
          <span class={`save ${saveState.value}`} title={saveTitle} aria-label={saveTitle} role="img" />
          <button
            type="button"
            class="icon-btn"
            aria-label="Export story"
            onClick={() => showSheet(<ExportSheet story={story.value} />)}
          >
            <Share size={20} />
          </button>
        </div>
        <nav class="tabs" aria-label="Story views">
          {TABS.map(([t, label]) => (
            <a key={t} href={`#${storyPath(id, t)}`} class={t === tab ? 'active' : ''} aria-current={t === tab ? 'page' : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      {tab === 'chat' && <Editor />}
      {tab === 'text' && <TextMode />}
      {tab === 'cast' && <CharactersPanel />}
      {tab === 'ai' && <AiExchange />}
    </>
  );
}

const NAV = [
  { name: 'library', href: '#/', label: 'Stories', Icon: BookOpen },
  { name: 'shortcuts', href: '#/shortcuts', label: 'Gestures', Icon: Signature },
  { name: 'settings', href: '#/settings', label: 'Settings', Icon: SettingsIcon },
] as const;

function BottomNav({ active }: { active: string }) {
  return (
    <nav class="bottom-nav" aria-label="Main">
      {NAV.map(({ name, href, label, Icon }) => (
        <a key={name} href={href} class={active === name ? 'active' : ''} aria-current={active === name ? 'page' : undefined}>
          <Icon size={22} />
          <span>{label}</span>
        </a>
      ))}
    </nav>
  );
}

function Signed() {
  const r = route.value;
  if (r.name === 'story') return <StoryScreen key={r.id} id={r.id} tab={r.tab} />;
  const active = r.name === 'account' ? 'settings' : r.name;
  return (
    <>
      <main class="main" key={r.name}>
        {r.name === 'library' && <Home />}
        {r.name === 'shortcuts' && <ShortcutsPage />}
        {r.name === 'settings' && <SettingsScreen />}
        {r.name === 'account' && <AccountScreen />}
      </main>
      <BottomNav active={active} />
    </>
  );
}

export function App() {
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => (shell.current ? trackVisualViewport(shell.current) : undefined), []);

  let content;
  if (!profilesReady.value) content = <div class="screen" />;
  else if (lockedProfile.value) content = <LockScreen />;
  else if (!currentProfile.value) content = hasProfiles.value ? <ProfilePicker /> : <Welcome />;
  else content = <Signed />;

  return (
    <div class="shell" ref={shell}>
      {/* While the database is unusable, nothing behind the notice takes typing. */}
      <ScreenBehindSheets blocked={dbStatus.value !== 'ok'}>{content}</ScreenBehindSheets>
      <Inert on={dbStatus.value !== 'ok'}>
        <SheetHost />
      </Inert>
      <Toast />
      <DbNotice />
    </div>
  );
}
