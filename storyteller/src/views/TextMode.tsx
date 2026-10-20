import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { parseStory } from '../format/parser';
import { serializeStory } from '../format/serializer';
import { replaceFromText, showToast, story } from '../store/storyStore';
import { safeFilename, saveFile } from '../export/files';
import { IssueList, copyText } from './shared';

/**
 * Raw `.story` editing. The textarea owns its text while you type, and the
 * parsed result flows into the story (undoably) after a short pause.
 */
export function TextMode() {
  const [text, setText] = useState(() => serializeStory(story.value));
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const issues = useMemo(() => parseStory(text).issues, [text]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onInput = (e: Event) => {
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => replaceFromText(value, 'textmode'), 500);
  };

  const goToLine = (line: number) => {
    const el = area.current;
    if (!el) return;
    const offset = text.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    el.focus();
    el.setSelectionRange(offset, offset);
  };

  return (
    <div class="page text-mode">
      <div class="actions">
        <button
          type="button"
          class="btn"
          onClick={async () => showToast((await copyText(text)) ? 'Copied .story text' : 'Copy failed: select and copy by hand')}
        >
          Copy
        </button>
        <button
          type="button"
          class="btn"
          onClick={async () => {
            const outcome = await saveFile(`${safeFilename(story.value.title)}.story`, text);
            if (outcome === 'failed') showToast("Couldn't save the file. Use Copy instead.");
          }}
        >
          Save .story file
        </button>
        <span class="muted small">Edits apply as you type. Undo works here too.</span>
      </div>
      <IssueList issues={issues} onPick={goToLine} />
      <textarea
        ref={area}
        class="raw"
        spellcheck={false}
        value={text}
        onInput={onInput}
        aria-label="Story text"
        data-testid="raw-text"
      />
    </div>
  );
}
