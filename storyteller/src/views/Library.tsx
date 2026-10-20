import { useEffect, useState } from 'preact/hooks';
import { go, storyPath } from '../router';
import { type StoryRecord, db, persistent } from '../store/db';
import { createStory } from '../store/storyStore';
import { SAMPLE_STORY } from './sample';

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function Library() {
  const [stories, setStories] = useState<StoryRecord[] | null>(null);

  const refresh = () => db.listStories().then(setStories);
  useEffect(() => {
    void refresh();
  }, []);

  const create = async (text?: string) => {
    const id = await createStory(text);
    go(storyPath(id));
  };

  const importFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await create(await file.text());
  };

  const remove = async (s: StoryRecord) => {
    if (!confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    await db.deleteStory(s.id);
    void refresh();
  };

  return (
    <div class="page library">
      <header class="page-head">
        <h1>Storyteller</h1>
        <a class="link" href="#/shortcuts">Shortcuts & gestures</a>
      </header>
      {!persistent && (
        <p class="warn">This browser blocks local storage, so stories will be lost when you close the tab.</p>
      )}
      <div class="actions">
        <button type="button" class="primary" data-testid="new-story" onClick={() => create()}>
          + New story
        </button>
        <label class="button">
          Import .story
          <input type="file" accept=".story,.txt,text/plain" hidden onChange={importFile} />
        </label>
        <button type="button" onClick={() => create(SAMPLE_STORY)}>
          Open sample
        </button>
      </div>
      {stories && stories.length === 0 && <p class="muted">No stories yet. Start one, or open the sample to look around.</p>}
      <ul class="stories">
        {stories?.map((s) => (
          <li key={s.id}>
            <a href={`#${storyPath(s.id)}`}>
              <b>{s.title}</b>
              <span class="muted">
                {s.lines} {s.lines === 1 ? 'line' : 'lines'} · {ago(s.updatedAt)}
              </span>
            </a>
            <button type="button" class="ghost" aria-label={`Delete ${s.title}`} onClick={() => remove(s)}>
              🗑
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
