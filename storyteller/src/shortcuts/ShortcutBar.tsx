import { useEffect, useRef } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Signature, Undo2 } from 'lucide-preact';
import { haptic, settings } from '../store/settings';
import { HEADING, IMAGE, NARRATION, NOTE, voiceCycle } from '../store/logic';
import { tint } from '../ui/color';
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
  if (v === IMAGE) return 'Picture';
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
  const lastSwipe = useRef(0);

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
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.y0;
    if (!d.moved && dy < -SWIPE_UP_PX && Math.abs(dy) > Math.abs(e.clientX - d.x0) * 1.5) {
      d.moved = true;
      zone.current?.setPointerCapture(e.pointerId);
      gesturePadOpen.value = true;
      return;
    }
    if (Math.abs(dx) >= STEP_PX && Math.abs(dx) > Math.abs(dy) * 0.6) {
      // Capture only once it is really a swipe, so plain taps still click the chip.
      if (!d.moved) zone.current?.setPointerCapture(e.pointerId);
      // Swipe left = next, like flicking a carousel forward (unless reversed in Settings).
      const forward = settings.value.invertSwipe ? dx > 0 : dx < 0;
      stepVoice(forward ? 1 : -1);
      d.lastX = e.clientX;
      d.moved = true;
      haptic(4);
    }
  };

  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) lastSwipe.current = performance.now();
    // Taps are handled by each chip's click, which also serves keyboards and screen readers.
    if (d.moved) focusComposer();
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
        <ChevronLeft size={22} />
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
          <button
            type="button"
            key={v}
            class={`chip${v === current ? ' active' : ''}${v === NARRATION || v === HEADING || v === NOTE || v === IMAGE ? ' meta' : ''}`}
            data-voice={v}
            data-active={v === current ? 'true' : 'false'}
            style={colors.has(v) ? tint(colors.get(v)) : undefined}
            aria-pressed={v === current}
            onClick={() => {
              // A swipe that started on this chip is not also a tap.
              if (performance.now() - lastSwipe.current < 400) return;
              setVoice(v);
              focusComposer();
            }}
          >
            {voiceLabel(v, names)}
          </button>
        ))}
      </div>
      <button type="button" class="bar-btn" aria-label="Next line" disabled={!canForward} onClick={act('nav.next')}>
        <ChevronRight size={22} />
      </button>
      <button
        type="button"
        class="bar-btn"
        aria-label="Undo"
        disabled={!historyState.value.canUndo}
        onClick={act('history.undo')}
      >
        <Undo2 size={20} />
      </button>
      <button
        type="button"
        class={`bar-btn${gesturePadOpen.value ? ' on' : ''}`}
        aria-label="Gesture pad"
        aria-pressed={gesturePadOpen.value}
        onClick={act('pad.toggle')}
      >
        <Signature size={20} />
      </button>
    </div>
  );
}
