import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { runAction } from '../shortcuts/actions';
import { hotkeyAction } from '../shortcuts/hotkeys';
import { readPrefix } from '../shortcuts/prefixes';
import { HEADING, NARRATION, NOTE, draftOf } from '../store/logic';
import { draft, mode, setVoice, story, voice } from '../store/storyStore';
import { composerRef } from '../store/ui';

function placeholderFor(v: string, name: string | undefined): string {
  if (v === NARRATION) return 'Narration…  (@name to speak)';
  if (v === HEADING) return 'Chapter or scene heading…';
  if (v === NOTE) return 'Note to self or to the AI…';
  return `${name ?? v} says…`;
}

export function Composer() {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState(0);

  const characters = story.value.characters;
  const current = characters.find((c) => c.id === voice.value);
  const prefix = readPrefix(draft.value, characters);
  const suggestions =
    prefix.type === 'mention'
      ? prefix.matches.map((c) => ({ key: c.id, label: c.name, hint: `@${c.id}`, color: c.color, pick: () => setVoice(c.id) }))
      : prefix.type === 'command'
        ? prefix.matches.map((c) => ({ key: c.cmd, label: `/${c.cmd}`, hint: c.help, color: undefined, pick: () => runAction(c.action) }))
        : [];
  const open = suggestions.length > 0;
  const active = Math.min(selected, Math.max(0, suggestions.length - 1));

  useLayoutEffect(() => {
    composerRef.current = textarea.current;
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  });

  const choose = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    draft.value = '';
    s.pick();
  };

  const onInput = (e: Event) => {
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    const state = readPrefix(value, characters);
    setSelected(0);
    if (state.type === 'switch') {
      setVoice(state.speaker);
      draft.value = state.rest;
    } else if (state.type === 'run') {
      draft.value = '';
      runAction(state.action);
    } else {
      draft.value = value;
    }
  };

  const isDirty = () => {
    const m = mode.value;
    if (m.type === 'new') return draft.value.length > 0;
    const block = story.value.blocks[m.index];
    return !!block && draft.value !== draftOf(block);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setSelected((active + step + suggestions.length) % suggestions.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        choose(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        draft.value = '';
        return;
      }
    }
    const action = hotkeyAction(e, isDirty(), open);
    if (action) {
      e.preventDefault();
      runAction(action);
    }
  };

  // Some mobile keyboards skip keydown for Enter; catch the line break here.
  const onBeforeInput = (e: InputEvent) => {
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') {
      e.preventDefault();
      if (open) choose(active);
      else runAction('line.commit');
    }
  };

  return (
    <div class="composer-wrap">
      {open && (
        <ul class="suggestions" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              role="option"
              aria-selected={i === active}
              class={i === active ? 'active' : ''}
              onClick={() => choose(i)}
            >
              {s.color && <span class="dot" style={`background:${s.color}`} />}
              <b>{s.label}</b> <span class="muted">{s.hint}</span>
            </li>
          ))}
        </ul>
      )}
      <div class="composer" style={current ? `--c:${current.color}` : undefined}>
        <textarea
          ref={textarea}
          rows={1}
          value={draft.value}
          placeholder={placeholderFor(voice.value, current?.name)}
          enterkeyhint="send"
          autoCapitalize="sentences"
          aria-label="Write the next line"
          data-testid="composer"
          onInput={onInput}
          onKeyDown={onKeyDown}
          onBeforeInput={onBeforeInput}
        />
        <button
          type="button"
          class="send"
          aria-label="Send line"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runAction('line.commit')}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
