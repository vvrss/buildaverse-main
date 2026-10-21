import { useEffect, useMemo, useState } from 'preact/hooks';
import { BookOpen, Copy, FileUp, MoreHorizontal, PenLine, Plus, Search, Share, Trash2, Type } from 'lucide-preact';
import { parseStory } from '../format/parser';
import type { Block, Story } from '../format/types';
import { go, storyPath } from '../router';
import { type StoryRecord, db, persistent } from '../store/db';
import { currentProfile } from '../store/profile';
import { createStory, deleteStory, duplicateStory, flushSave, renameStory, showToast } from '../store/storyStore';
import { onBroadcast } from '../store/sync';
import { Picture } from '../images/Picture';
import { Avatar, FilePicker, Row } from '../ui/controls';
import { Sheet, closeSheet, confirmAction, showSheet } from '../ui/overlay';
import { ExportSheet } from './ExportSheet';
import { SAMPLE_STORY } from './sample';

interface Card {
  record: StoryRecord;
  story: Story;
  preview: Block[];
}

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Writing late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The cover is a miniature of the story's opening exchange. */
function Cover({ card }: { card: Card }) {
  const { story, preview } = card;
  const colors = story.characters.map((c) => c.color);
  const a = colors[0] ?? '#8e5bd6';
  const b = colors[1] ?? colors[0] ?? '#3a86ff';
  const lead = story.characters[0]?.id;
  const color = (id: string) => story.characters.find((c) => c.id === id)?.color ?? '#888';
  if (story.cover) {
    return (
      <div class="cover photo" aria-hidden="true">
        <Picture pictureRef={story.cover} alt="" class="cover-photo" sizes="(max-width: 640px) 92vw, 300px" />
      </div>
    );
  }
  return (
    <div class="cover" style={`--a:${a};--b:${b}`} aria-hidden="true">
      {preview.length === 0 && <span class="cover-empty">Nothing written yet</span>}
      {preview.map((blk) =>
        blk.kind === 'line' ? (
          <span key={blk.id} class={`cover-bubble${blk.speaker === lead ? ' right' : ''}`} style={`--c:${color(blk.speaker)}`}>
            {blk.text.split('\n')[0]}
          </span>
        ) : (
          <span key={blk.id} class="cover-narr">
            {blk.text.split('\n')[0]}
          </span>
        ),
      )}
    </div>
  );
}

function RenameSheet({ card, onDone }: { card: Card; onDone: () => void }) {
  const [title, setTitle] = useState(card.story.title);
  return (
    <Sheet title="Rename story">
      <form
        class="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await renameStory(card.record.id, title);
          closeSheet();
          onDone();
        }}
      >
        <input id="rename-title" type="text" value={title} data-autofocus onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)} />
        <button type="submit" class="btn primary" disabled={!title.trim()}>
          Save
        </button>
      </form>
    </Sheet>
  );
}

function StoryMenu({ card, onChange }: { card: Card; onChange: () => void }) {
  const { record, story } = card;
  const act = (fn: () => void | Promise<void>) => async () => {
    closeSheet();
    await fn();
  };
  return (
    <Sheet title={story.title}>
      <div class="group-card">
        <Row icon={<BookOpen size={20} />} label="Open" onClick={act(() => go(storyPath(record.id)))} />
        <Row icon={<Type size={20} />} label="Rename" onClick={act(() => void showSheet(<RenameSheet card={card} onDone={onChange} />))} />
        <Row
          icon={<Copy size={20} />}
          label="Duplicate"
          onClick={act(async () => {
            await duplicateStory(record.id);
            showToast('Copy created');
            onChange();
          })}
        />
        <Row icon={<Share size={20} />} label="Export…" onClick={act(() => void showSheet(<ExportSheet story={story} />))} />
        <Row
          icon={<Trash2 size={20} />}
          label="Delete"
          danger
          onClick={act(async () => {
            const ok = await confirmAction({
              title: 'Delete this story?',
              message: (
                <p>
                  “{story.title}” and its {record.lines} {record.lines === 1 ? 'line' : 'lines'} will be removed from this device.
                  Export it first if you want a copy.
                </p>
              ),
              confirmLabel: 'Delete story',
              danger: true,
            });
            if (!ok) return;
            await deleteStory(record.id);
            showToast('Story deleted');
            onChange();
          })}
        />
      </div>
    </Sheet>
  );
}

export function Home() {
  const profile = currentProfile.value!;
  const [records, setRecords] = useState<StoryRecord[] | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');

  // Waits for the story you just left to finish saving, so its card is current.
  const refresh = () =>
    flushSave()
      .then(() => db.listStories(profile.id))
      .then(setRecords);
  useEffect(() => {
    void refresh();
    // Stories saved or deleted in another window show up here too.
    return onBroadcast((msg) => {
      if (msg.type === 'story-saved' || msg.type === 'story-deleted') void refresh();
    });
  }, [profile.id]);

  const cards = useMemo<Card[]>(
    () =>
      (records ?? []).map((record) => {
        const story = parseStory(record.text).story;
        const preview = story.blocks.filter((b) => b.kind === 'line' || b.kind === 'narration').slice(0, 3);
        return { record, story, preview };
      }),
    [records],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? cards.filter((c) => c.story.title.toLowerCase().includes(q) || c.record.text.toLowerCase().includes(q))
      : cards;
    return sort === 'title' ? [...list].sort((x, y) => x.story.title.localeCompare(y.story.title)) : list;
  }, [cards, query, sort]);

  const create = async (text?: string) => {
    const id = await createStory(text);
    go(storyPath(id));
  };

  const importFile = async (file: File) => {
    if (/^(image|audio|video)\//.test(file.type) || file.size > 5 * 1024 * 1024) {
      showToast("That file isn't a story. Pick a .story or text file.");
      return;
    }
    const text = await file.text();
    // Binary files decode with NUL or replacement characters.
    if (/[\u0000\ufffd]/.test(text.slice(0, 4096))) {
      showToast("That file isn't a story. Pick a .story or text file.");
      return;
    }
    if (/^\s*<(!doctype|html|\?xml|svg)\b/i.test(text)) {
      showToast("That's a web page, not a story. Pick a .story or text file.");
      return;
    }
    if (text.trimStart().startsWith('{')) {
      showToast('That looks like a backup. Restore it from Settings → Data.');
      return;
    }
    await create(text);
  };

  return (
    <div class="screen home">
      <header class="home-head">
        <div>
          <p class="eyebrow">{greeting()},</p>
          <h1 class="display">{profile.name}</h1>
        </div>
        <a class="avatar-link" href="#/account" aria-label="Your profile">
          <Avatar name={profile.name} color={profile.color} size={44} />
        </a>
      </header>

      {!persistent && (
        <p class="notice warn">This browser blocks storage, so stories are lost when you close the tab. Export anything you want to keep.</p>
      )}

      {cards.length > 0 && (
        <div class="toolbar">
          <label class="search">
            <Search size={18} aria-hidden="true" />
            <input
              id="story-search"
              type="search"
              placeholder="Search stories and lines"
              value={query}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button
            type="button"
            class="chip-btn"
            onClick={() => setSort(sort === 'recent' ? 'title' : 'recent')}
            aria-label={`Sorted by ${sort === 'recent' ? 'most recent' : 'title'}. Change sort.`}
          >
            {sort === 'recent' ? 'Recent' : 'A–Z'}
          </button>
          <FilePicker class="chip-btn" accept=".story,.txt,text/plain" onPick={importFile} label="Import a .story file" testId="import-input">
            <FileUp size={16} />
          </FilePicker>
        </div>
      )}

      {records && cards.length === 0 && (
        <div class="empty-home">
          <div class="welcome-art small" aria-hidden="true">
            <div class="mini-bubble right" style="--c:var(--accent)">
              Once upon a time…
            </div>
            <div class="mini-bubble" style="--c:#2a9d8f">
              Go on.
            </div>
          </div>
          <h2>Your stories live here</h2>
          <p class="muted">Start a new one, or open the sample to see how writing in dialog feels.</p>
          <div class="button-row">
            <button type="button" class="btn primary" onClick={() => create()} data-testid="new-story">
              <PenLine size={18} /> New story
            </button>
            <button type="button" class="btn" onClick={() => create(SAMPLE_STORY)}>
              Open sample
            </button>
            <FilePicker accept=".story,.txt,text/plain" onPick={importFile} testId="import-input">
              <FileUp size={18} /> Import
            </FilePicker>
          </div>
        </div>
      )}

      {query && visible.length === 0 && <p class="muted center">No stories match “{query}”.</p>}

      <ul class="cards">
        {visible.map((card) => (
          <li key={card.record.id} class="card">
            <a href={`#${storyPath(card.record.id)}`} class="card-link">
              <Cover card={card} />
              <div class="card-body">
                <b class="card-title">{card.story.title}</b>
                <span class="card-meta">
                  {card.record.lines} {card.record.lines === 1 ? 'line' : 'lines'} · {ago(card.record.updatedAt)}
                </span>
              </div>
            </a>
            <div class="card-foot">
              <span class="cast-stack">
                {card.story.characters.slice(0, 4).map((c) => (
                  <Avatar key={c.id} name={c.name} color={c.color} size={24} />
                ))}
                {card.story.characters.length > 4 && <span class="more">+{card.story.characters.length - 4}</span>}
              </span>
              <button
                type="button"
                class="icon-btn"
                aria-label={`More for ${card.story.title}`}
                onClick={() => showSheet(<StoryMenu card={card} onChange={refresh} />)}
              >
                <MoreHorizontal size={20} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {cards.length > 0 && (
        <button type="button" class="fab" onClick={() => create()} data-testid="new-story">
          <Plus size={22} /> New story
        </button>
      )}
    </div>
  );
}
