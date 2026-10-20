import { useEffect, useRef, useState } from 'preact/hooks';
import { ShortcutsPage } from './gestures/GestureSettings';
import { type Tab, go, route, storyPath } from './router';
import { trackVisualViewport } from './shortcuts/keyboardViewport';
import { closeStory, openStory, saveState, setTitle, story, storyId, toast } from './store/storyStore';
import { gesturePadOpen } from './store/ui';
import { AiExchange } from './views/AiExchange';
import { CharactersPanel } from './views/CharactersPanel';
import { Editor } from './views/Editor';
import { Library } from './views/Library';
import { TextMode } from './views/TextMode';

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
    const timer = setTimeout(() => setVisible(false), 1600);
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
    };
  }, [id]);

  useEffect(() => {
    if (tab !== 'chat') gesturePadOpen.value = false;
  }, [tab]);

  if (state === 'loading') return <div class="page muted">Loading…</div>;

  const back = async () => {
    await closeStory();
    go('/');
  };

  return (
    <>
      <header class="topbar">
        <button type="button" class="ghost" aria-label="Back to library" onClick={back}>
          ←
        </button>
        <input
          class="title"
          value={story.value.title}
          aria-label="Story title"
          onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
        />
        <span class={`save ${saveState.value}`} title={saveState.value === 'saved' ? 'Saved on this device' : saveState.value === 'error' ? 'Saving failed' : 'Saving…'} />
        <nav class="tabs">
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

export function App() {
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => (shell.current ? trackVisualViewport(shell.current) : undefined), []);

  const r = route.value;
  return (
    <div class="shell" ref={shell}>
      {r.name === 'library' && <Library />}
      {r.name === 'shortcuts' && <ShortcutsPage />}
      {r.name === 'story' && <StoryScreen key={r.id} id={r.id} tab={r.tab} />}
      <Toast />
    </div>
  );
}
