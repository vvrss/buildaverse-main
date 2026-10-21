import { Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ArrowDown, ArrowDownToLine, ArrowUp, ListPlus, Trash2, X } from 'lucide-preact';
import { GesturePad } from '../gestures/GesturePad';
import { ShortcutBar } from '../shortcuts/ShortcutBar';
import {
  deleteCurrent,
  selectLine,
  insertBelow,
  mode,
  moveCurrent,
  navEnd,
  story,
} from '../store/storyStore';
import { settings } from '../store/settings';
import { focusComposer } from '../store/ui';
import { Composer } from './Composer';
import { LineView } from './LineView';

const keepFocus = (e: Event) => e.preventDefault();

function EditBanner() {
  const m = mode.value;
  const len = story.value.blocks.length;
  if (m.type === 'new' && m.at >= len) return null;
  const run = (fn: () => void) => () => {
    fn();
    focusComposer();
  };
  if (m.type === 'new') {
    return (
      <div class="banner" onMouseDown={keepFocus}>
        <span class="banner-label">{m.at === 0 ? 'Inserting at the start' : `Inserting after line ${m.at}`}</span>
        <button type="button" aria-label="Jump to end" onClick={run(navEnd)}>
          <ArrowDownToLine size={16} /> <span class="banner-text">Jump to end</span>
        </button>
      </div>
    );
  }
  return (
    <div class="banner editing" onMouseDown={keepFocus}>
      <span class="banner-label">
        Editing line {m.index + 1}/{len}
      </span>
      <div class="banner-actions">
        <button type="button" aria-label="Move up" onClick={run(() => moveCurrent(-1))} disabled={m.index === 0}>
          <ArrowUp size={16} />
        </button>
        <button type="button" aria-label="Move down" onClick={run(() => moveCurrent(1))} disabled={m.index >= len - 1}>
          <ArrowDown size={16} />
        </button>
        <button type="button" aria-label="Below" onClick={run(insertBelow)}>
          <ListPlus size={16} /> <span class="banner-text">Below</span>
        </button>
        <button type="button" class="danger" aria-label="Delete" onClick={run(deleteCurrent)}>
          <Trash2 size={16} /> <span class="banner-text">Delete</span>
        </button>
        <button type="button" aria-label="Stop editing" onClick={run(navEnd)}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function EmptyHint() {
  const hasCast = story.value.characters.length > 0;
  return (
    <div class="empty">
      <h2>Start writing</h2>
      {!hasCast && (
        <p>
          Type <code>@ana Hello!</code> to create Ana and give her the first line. Do the same for the next character.
        </p>
      )}
      <ul>
        <li><b>Enter</b> sends and switches to the other speaker automatically.</li>
        <li><b>Swipe the chips</b> above the keyboard to change who speaks. Swipe up for the gesture pad.</li>
        <li>Start a line with <code>&gt;</code> for narration, <code># </code> for a heading, <code>//</code> for a note, <code>(whispering)</code> for a direction.</li>
        <li><code>/</code> shows commands. <b>‹ ›</b> step back and forth through lines.</li>
      </ul>
    </div>
  );
}

export function Editor() {
  const log = useRef<HTMLDivElement>(null);
  const s = story.value;
  const m = mode.value;
  const castById = new Map(s.characters.map((c) => [c.id, c]));
  const lead = settings.value.leadOnRight ? s.characters[0]?.id : undefined;
  const showNotes = settings.value.showNotes;

  // Keep the line being edited, or the insertion point, in view.
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    if (m.type === 'new' && m.at >= s.blocks.length) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const index = m.type === 'edit' ? m.index : m.at - 1;
    el.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [m, s.blocks.length]);

  const select = (index: number) => {
    selectLine(index);
    focusComposer();
  };

  return (
    <>
      <div class="stage">
        <div class="log" ref={log} data-testid="log">
          {s.blocks.length === 0 && <EmptyHint />}
          {s.blocks.map((block, i) => {
            if (block.kind === 'note' && !showNotes && !(m.type === 'edit' && m.index === i)) return null;
            const prev = s.blocks[i - 1];
            const showName =
              block.kind === 'line' && !(prev?.kind === 'line' && prev.speaker === block.speaker && !block.direction);
            return (
              <Fragment key={block.id}>
                <LineView
                  block={block}
                  index={i}
                  character={block.kind === 'line' ? castById.get(block.speaker) : undefined}
                  isLead={block.kind === 'line' && block.speaker === lead}
                  showName={showName}
                  selected={m.type === 'edit' && m.index === i}
                  onSelect={select}
                />
                {m.type === 'new' && m.at === i + 1 && m.at < s.blocks.length && (
                  <div class="insert-caret" aria-hidden="true" />
                )}
              </Fragment>
            );
          })}
        </div>
        <GesturePad />
      </div>
      <div class="dock">
        <EditBanner />
        <Composer />
        <ShortcutBar />
      </div>
    </>
  );
}
