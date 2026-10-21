import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw } from 'lucide-preact';
import type { Character, Story } from '../format/types';
import { Picture, Portrait } from '../images/Picture';
import { settings, updateSettings } from '../store/settings';
import { safeColor } from '../ui/color';
import { PACES, PACE_LABEL, type ReadItem, holdFor, paceOf, readItems } from './pace';

/** Where the current line rests, as a share of the reader's height from the top. */
const ANCHOR = 0.3;
const GLIDE_MS = 1100;
const STAGGER_MS = 45;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** An element's distance from the top of the scroller's content, ignoring any transform on it. */
function topIn(el: HTMLElement, box: HTMLElement): number {
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== box) {
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return y;
}

/** How far an element is currently drawn from its place (mid-glide). */
function shiftOf(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
}

interface Api {
  restart: () => void;
}

interface Props {
  story: Story;
  /** The scrolling element the reader lives in; it must be positioned (`.ly-scroller`). */
  scroller: RefObject<HTMLElement>;
  /** Above the first line (title, author). Glides along with the lines. */
  head?: ComponentChildren;
  /** After the last line. Shown once the story has been read through. */
  foot?: ComponentChildren | ((api: Api) => ComponentChildren);
  /** Start moving through the lines by itself. */
  autoplay?: boolean;
}

function Item({
  item,
  index,
  state,
  speaker,
  showName,
  onTap,
}: {
  item: ReadItem;
  index: number;
  state: 'past' | 'now' | 'next';
  speaker?: Character;
  showName: boolean;
  onTap: (index: number) => void;
}) {
  const text = (t: string) => t.split('\n').map((l, i) => <span key={i}>{l || '…'}</span>);
  return (
    <div
      class={`ly-item ${item.kind} ${state}${showName ? ' first' : ''}`}
      data-glide
      data-i={index}
      style={`--k:${Math.min(index, 12)}`}
      aria-current={state === 'now' ? 'true' : undefined}
      onClick={() => onTap(index)}
    >
      {item.kind === 'heading' && <p class="ly-heading">{item.text || 'Untitled scene'}</p>}
      {item.kind === 'narration' && <p class="ly-text">{text(item.text)}</p>}
      {item.kind === 'image' && (
        <figure class="ly-figure">
          <Picture pictureRef={item.ref} alt={item.text} sizes="(max-width: 680px) 92vw, 640px" />
          {item.text && <figcaption>{item.text}</figcaption>}
        </figure>
      )}
      {item.kind === 'line' && (
        <>
          {showName && (
            <div class="ly-who">
              {speaker?.portrait ? (
                <Portrait name={speaker.name} color={speaker.color} portrait={speaker.portrait} size={22} />
              ) : (
                <span class="ly-dot" style={`--c:${safeColor(speaker?.color)}`} aria-hidden="true" />
              )}
              <span>{speaker?.name ?? item.speaker}</span>
              {item.direction && <i>{item.direction}</i>}
            </div>
          )}
          <p class="ly-text">{text(item.text)}</p>
        </>
      )}
    </div>
  );
}

/**
 * A story read like song lyrics: one line lit at a time, the rest dimmed, and
 * the whole page gliding up to the next line with a gentle cascade. It plays
 * at a reading pace, or follows taps, keys and scrolling.
 */
export function Lyrics({ story, scroller, head, foot, autoplay = false }: Props) {
  const items = useMemo(() => readItems(story), [story]);
  const cast = useMemo(() => new Map(story.characters.map((c) => [c.id, c])), [story]);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const pace = paceOf(settings.value.readPace);
  const root = useRef<HTMLDivElement>(null);
  /** The scroll position this reader set last; any other is the reader's own scrolling. */
  const ownScroll = useRef(-1);
  const touched = useRef(new Set<HTMLElement>());
  const cleanup = useRef<ReturnType<typeof setTimeout>>();
  const last = items.length - 1;

  const itemAt = (i: number) => root.current?.querySelector<HTMLElement>(`[data-i="${i}"]`);
  const orderOf = (el: HTMLElement) => (el.dataset.i !== undefined ? Number(el.dataset.i) : el.classList.contains('ly-foot') ? items.length : -1);

  /** Scrolls so `target` rests at the anchor. The elements on screen glide there, the lower ones a little later. */
  const glideTo = (target: HTMLElement | null | undefined, animate = true) => {
    const box = scroller.current;
    if (!box || !target || !root.current) return;
    const max = box.scrollHeight - box.clientHeight;
    const to = Math.round(Math.max(0, Math.min(max, topIn(target, box) - box.clientHeight * ANCHOR)));
    const before = box.scrollTop;
    if (Math.abs(to - before) < 1) return;
    const span = Math.abs(to - before);
    const moving = animate && !reducedMotion() && span < box.clientHeight * 1.25;
    const lo = Math.min(before, to) - 40;
    const hi = Math.max(before, to) + box.clientHeight + 40;
    const shifted = moving
      ? [...root.current.querySelectorAll<HTMLElement>('[data-glide]')].filter((el) => {
          const top = topIn(el, box);
          return top < hi && top + el.offsetHeight > lo;
        })
      : [];
    const from = shifted.map(shiftOf);
    box.scrollTop = to;
    ownScroll.current = box.scrollTop;
    const delta = box.scrollTop - before;
    if (!shifted.length || !delta) return;
    // Put everything back where it was drawn, then let it settle into place.
    shifted.forEach((el, k) => {
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta + from[k]}px)`;
      touched.current.add(el);
    });
    void box.offsetHeight;
    const at = orderOf(target);
    for (const el of shifted) {
      const delay = Math.min(10, Math.max(0, orderOf(el) - at + 1)) * STAGGER_MS;
      el.style.transition = `transform ${GLIDE_MS}ms ${EASE} ${delay}ms, color 0.6s ease ${delay}ms`;
      el.style.transform = '';
    }
    clearTimeout(cleanup.current);
    cleanup.current = setTimeout(() => {
      for (const el of touched.current) el.style.transition = '';
      touched.current.clear();
    }, GLIDE_MS + 11 * STAGGER_MS);
  };

  const go = (i: number, animate = true) => {
    if (!items.length) return;
    const n = Math.max(0, Math.min(last, i));
    setEnded(false);
    setActive(n);
    glideTo(itemAt(n), animate);
  };

  const finish = () => {
    setPlaying(false);
    setEnded(true);
    glideTo(root.current?.querySelector<HTMLElement>('.ly-foot'));
  };

  const toggle = () => {
    if (playing) return setPlaying(false);
    if (ended) go(0);
    else glideTo(itemAt(active));
    setPlaying(true);
  };

  const tap = (i: number) => {
    if (i !== active) return go(i);
    if (i < last) go(i + 1);
    else finish();
  };

  // Playing: each line stays lit for as long as it takes to read, then the next.
  useEffect(() => {
    if (!playing || !items.length) return;
    const timer = setTimeout(() => (active >= last ? finish() : go(active + 1)), holdFor(items[active], pace));
    return () => clearTimeout(timer);
  }, [playing, active, pace, items]);

  useEffect(() => {
    if (!autoplay || !items.length) return;
    const timer = setTimeout(() => setPlaying(true), 900);
    return () => clearTimeout(timer);
  }, []);

  // Scrolling by hand pauses, and lights the line resting at the anchor.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let frame = 0;
    const onScroll = () => {
      if (Math.abs(box.scrollTop - ownScroll.current) <= 2) return;
      ownScroll.current = -1;
      setPlaying(false);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const lines = root.current?.querySelectorAll<HTMLElement>('[data-i]');
        if (!lines?.length) return;
        const y = box.scrollTop + box.clientHeight * ANCHOR + 1;
        let at = 0;
        if (box.scrollTop > 4) {
          for (const el of lines) {
            if (topIn(el, box) > y) break;
            at = Number(el.dataset.i);
          }
        }
        setActive(at);
        setEnded(false);
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items]);

  // Space plays and pauses; the arrow keys (or J and K) step through the lines.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !items.length) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.sheet-layer')) return;
      const box = scroller.current;
      const lines = root.current?.querySelector('.ly-lines');
      if (!box || !lines) return;
      // Only while the lines are on screen, not while reading the comments below.
      const r = lines.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (r.bottom < b.top + b.height * 0.4 || r.top > b.bottom - 60) return;
      if (e.key === ' ' && !t?.closest('button, a')) {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
        e.preventDefault();
        if (active < last) go(active + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault();
        go(active - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => () => clearTimeout(cleanup.current), []);

  const nextPace = () => updateSettings({ readPace: PACES[(PACES.indexOf(pace) + 1) % PACES.length] });
  const progress = items.length > 1 ? active / last : 1;

  return (
    <div class="ly" ref={root}>
      {head && (
        <div class="ly-head" data-glide>
          {head}
        </div>
      )}
      <div class="ly-lines" data-testid="reader-log">
        {items.length === 0 && <p class="ly-empty">Nothing to read yet.</p>}
        {items.map((item, i) => {
          const prev = items[i - 1];
          const showName = item.kind === 'line' && !(prev?.kind === 'line' && prev.speaker === item.speaker && !item.direction);
          return (
            <Item
              key={item.id}
              item={item}
              index={i}
              state={i < active ? 'past' : i === active ? 'now' : 'next'}
              speaker={item.kind === 'line' ? cast.get(item.speaker) : undefined}
              showName={showName}
              onTap={tap}
            />
          );
        })}
        {items.length > 0 && (
          <div class="ly-controls" role="toolbar" aria-label="Reading">
            <button type="button" class="ly-btn" aria-label="Previous line" disabled={active === 0} onClick={() => go(active - 1)}>
              <ChevronUp size={22} />
            </button>
            <button
              type="button"
              class="ly-btn play"
              aria-label={playing ? 'Pause' : ended ? 'Read again' : 'Play'}
              data-testid="ly-play"
              onClick={toggle}
            >
              {playing ? <Pause size={22} /> : ended ? <RotateCcw size={20} /> : <Play size={22} />}
            </button>
            <button type="button" class="ly-btn" aria-label="Next line" data-testid="ly-next" disabled={active >= last} onClick={() => go(active + 1)}>
              <ChevronDown size={22} />
            </button>
            <button type="button" class="ly-pace" aria-label={`Pace: ${PACE_LABEL[pace]}. Change pace.`} onClick={nextPace}>
              {PACE_LABEL[pace]}
            </button>
            <span class="ly-progress" style={`--p:${progress}`} aria-hidden="true" />
          </div>
        )}
      </div>
      {foot && (
        <div class="ly-foot" data-glide>
          {typeof foot === 'function' ? foot({ restart: () => (go(0), setPlaying(true)) }) : foot}
        </div>
      )}
    </div>
  );
}
