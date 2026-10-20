import { useEffect, useRef } from 'preact/hooks';
import { HEADING, NARRATION, NOTE, voiceCycle } from '../store/logic';
import { historyState, mode, setVoice, story, stepVoice, voice } from '../store/storyStore';
import { focusComposer, gesturePadOpen } from '../store/ui';
import { runAction } from './actions';

const STEP_PX = 44;
const SWIPE_UP_PX = 46;

const keepFocus = (e: Event) => e.preventDefault();

function voiceLabel(v: string, names: Map<string, string>): string {
  if (v === NARRATION) return 'Narration';
  if (v === HEADING) return 'Heading';
  if (v === NOTE) return 'Note';
  return names.get(v) ?? v;
}

/**
 * The strip that sits on top of the on-screen keyboard. Swipe the chips
 * left/right to change speaker (one step per ~44px, so a long swipe skips
 * several), swipe up to open the gesture pad, or tap a chip directly.
 */
export function ShortcutBar() {
  const zone = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x0: number; y0: number; lastX: number; moved: boolean; target: string | null } | null>(null);

  const characters = story.value.characters;
  const names = new Map(characters.map((c) => [c.id, c.name]));
  const colors = new Map(characters.map((c) => [c.id, c.color]));
  const cycle = voiceCycle(characters);
  const current = voice.value;
  const chips = cycle.includes(current) ? cycle : [...cycle, current];

  useEffect(() => {
    const el = zone.current;
    const chip = el?.querySelector<HTMLElement>('[data-active="true"]');
    if (!el || !chip) return;
    el.scrollTo({ left: chip.offsetLeft - el.clientWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' });
  }, [current, chips.length]);

  const onDown = (e: PointerEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-voice]')?.dataset.voice ?? null;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, moved: false, target };
    zone.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.y0;
    if (!d.moved && dy < -SWIPE_UP_PX && Math.abs(dy) > Math.abs(e.clientX - d.x0) * 1.5) {
      d.moved = true;
      gesturePadOpen.value = true;
      return;
    }
    if (Math.abs(dx) >= STEP_PX && Math.abs(dx) > Math.abs(dy) * 0.6) {
      // Swipe left = next, like flicking a carousel forward.
      stepVoice(dx < 0 ? 1 : -1);
      d.lastX = e.clientX;
      d.moved = true;
      navigator.vibrate?.(4);
    }
  };

  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const travel = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.moved && travel < 12 && d.target) setVoice(d.target);
    focusComposer();
  };

  const act = (id: string) => () => {
    runAction(id);
    focusComposer();
  };

  const m = mode.value;
  const len = story.value.blocks.length;
  const canBack = m.type === 'edit' ? m.index > 0 : m.at > 0;
  const canForward = m.type === 'edit' || m.at < len;

  return (
    <div class="bar" onMouseDown={keepFocus} role="toolbar" aria-label="Shortcuts">
      <button type="button" class="bar-btn" aria-label="Previous line" disabled={!canBack} onClick={act('nav.prev')}>
        ‹
      </button>
      <div
        class="chips"
        ref={zone}
        data-testid="voice-chips"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {chips.map((v) => (
          <span
            key={v}
            class={`chip${v === current ? ' active' : ''}${v === NARRATION || v === HEADING || v === NOTE ? ' meta' : ''}`}
            data-voice={v}
            data-active={v === current ? 'true' : 'false'}
            style={colors.has(v) ? { '--c': colors.get(v) } : undefined}
            role="button"
            aria-pressed={v === current}
          >
            {voiceLabel(v, names)}
          </span>
        ))}
      </div>
      <button type="button" class="bar-btn" aria-label="Next line" disabled={!canForward} onClick={act('nav.next')}>
        ›
      </button>
      <button
        type="button"
        class="bar-btn"
        aria-label="Undo"
        disabled={!historyState.value.canUndo}
        onClick={act('history.undo')}
      >
        ↶
      </button>
      <button
        type="button"
        class={`bar-btn${gesturePadOpen.value ? ' on' : ''}`}
        aria-label="Gesture pad"
        aria-pressed={gesturePadOpen.value}
        onClick={act('pad.toggle')}
      >
        ✍
      </button>
    </div>
  );
}
