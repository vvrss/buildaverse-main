import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { SendHorizontal } from 'lucide-preact';
import { runAction } from '../shortcuts/actions';
import { hotkeyAction, isComposing } from '../shortcuts/hotkeys';
import { readPrefix } from '../shortcuts/prefixes';
import { HEADING, NARRATION, NOTE } from '../store/logic';
import { draft, mode, setVoice, story, voice } from '../store/storyStore';
import { settings } from '../store/settings';
import { composerRef } from '../store/ui';
import { tint } from '../ui/color';

function placeholderFor(v: string, name: string | undefined): string {
  if (v === NARRATION) return 'Narration…  (@name to speak)';
  if (v === HEADING) return 'Chapter or scene heading…';
  if (v === NOTE) return 'Note to self or to the AI…';
  return `${name ?? v} says…`;
}

export function Composer() {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState(0);
  /**
   * How many of your own edits the textarea's native undo can take back. It
   * resets whenever the app changes the text itself (sending, moving between
   * lines), because the browser's undo history is gone then.
   */
  const typed = useRef(0);
  const lastTyped = useRef<string | null>(null);
  /** The text as the app last set it: undoing back to it means nothing of yours is left to undo. */
  const baseline = useRef('');
  /** After Esc with nothing left to do, Tab moves focus on instead of switching speaker. */
  const releaseTab = useRef(false);
  const composedAt = useRef(0);

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

  const syncTyped = () => {
    if (lastTyped.current !== draft.value) {
      typed.current = 0;
      lastTyped.current = draft.value;
      baseline.current = draft.value;
    }
  };

  const onInput = (e: Event) => {
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    const input = e as InputEvent;
    syncTyped();
    // Browsers merge a run of typing into one native undo step, so counting
    // input events overshoots: back at the app's own text, nothing is left.
    if (input.inputType === 'historyUndo') typed.current = value === baseline.current ? 0 : Math.max(1, typed.current - 1);
    else typed.current += 1;
    lastTyped.current = value;
    releaseTab.current = false;
    setSelected(0);
    if (input.isComposing) {
      draft.value = value;
      return;
    }
    const state = readPrefix(value, characters);
    // A line being edited may start with its own marker, so it is never
    // rewritten; slash commands like /d still run.
    if (mode.value.type === 'edit' && state.type !== 'run') {
      draft.value = value;
      return;
    }
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

  /** Native undo still has typing to take back. */
  const isDirty = () => {
    syncTyped();
    return typed.current > 0;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys during IME composition (and Safari's confirming Enter) belong to the IME.
    if (isComposing(e) || (e.key === 'Enter' && performance.now() - composedAt.current < 60)) return;
    // Any other key ends "Tab leaves the text box" after an Esc.
    if (e.key !== 'Tab' && e.key !== 'Shift' && e.key !== 'Escape') releaseTab.current = false;
    if (e.key === 'Tab' && releaseTab.current && !open) return;
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
    const m = mode.value;
    if (e.key === 'Escape' && m.type === 'new' && m.at >= story.value.blocks.length) {
      // Nothing to stop: let Tab move focus normally from now on.
      releaseTab.current = true;
      return;
    }
    const action = hotkeyAction(e, { draftDirty: isDirty(), suggestionsOpen: open, enterSends: settings.value.enterSends });
    if (action) {
      e.preventDefault();
      runAction(action);
    }
  };

  const onCompositionEnd = (e: Event) => {
    composedAt.current = performance.now();
    // Now that the text is final, apply typed prefixes like "@ana ".
    onInput(e);
  };
  // Preact would register onCompositionEnd as a "CompositionEnd" event, which
  // never fires, so this one is attached by hand (always the latest handler).
  const compositionEnd = useRef(onCompositionEnd);
  compositionEnd.current = onCompositionEnd;
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    const listener = (e: Event) => compositionEnd.current(e);
    el.addEventListener('compositionend', listener);
    return () => el.removeEventListener('compositionend', listener);
  }, []);

  // Some mobile keyboards skip keydown for Enter; catch the line break here.
  const onBeforeInput = (e: InputEvent) => {
    if (e.isComposing) return;
    if (!settings.value.enterSends && !open) return;
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
      <div class="composer" style={current ? tint(current.color) : undefined}>
        <textarea
          ref={textarea}
          rows={1}
          value={draft.value}
          placeholder={placeholderFor(voice.value, current?.name)}
          enterkeyhint={settings.value.enterSends ? 'send' : 'enter'}
          autoCapitalize="sentences"
          aria-label="Write the next line"
          data-testid="composer"
          onInput={onInput}
          onKeyDown={onKeyDown}
          onBeforeInput={onBeforeInput}
          onFocus={() => (releaseTab.current = false)}
        />
        <button
          type="button"
          class="send"
          aria-label="Send line"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runAction('line.commit')}
        >
          <SendHorizontal size={20} />
        </button>
      </div>
    </div>
  );
}
