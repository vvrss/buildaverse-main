import { useEffect, useRef } from 'preact/hooks';
import type { Point } from '../store/db';
import { MIN_STROKE_LENGTH, pathLength } from './recognizer';

interface Props {
  onStroke: (points: Point[]) => void;
  onTap?: () => void;
  class?: string;
  label?: string;
}

/**
 * A surface you draw a single stroke on with a finger, pen or mouse.
 * It never takes focus, so the composer keeps the on-screen keyboard open.
 */
export function StrokeCanvas({ onStroke, onTap, class: className, label }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const points = useRef<Point[]>([]);
  const pointer = useRef<number | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.max(1, Math.round(el.clientWidth * dpr));
      el.height = Math.max(1, Math.round(el.clientHeight * dpr));
      const ctx = el.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(fade.current);
    };
  }, []);

  const pos = (e: PointerEvent): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const ctx = () => canvas.current?.getContext('2d') ?? null;

  const clear = () => {
    const c = canvas.current;
    const g = ctx();
    if (c && g) g.clearRect(0, 0, c.width, c.height);
  };

  const onDown = (e: PointerEvent) => {
    if (pointer.current !== null) return;
    pointer.current = e.pointerId;
    canvas.current?.setPointerCapture(e.pointerId);
    clearTimeout(fade.current);
    clear();
    points.current = [pos(e)];
    const g = ctx();
    if (g) {
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = getComputedStyle(canvas.current!).getPropertyValue('--accent').trim() || '#7c5cff';
    }
  };

  const onMove = (e: PointerEvent) => {
    if (pointer.current !== e.pointerId) return;
    const prev = points.current[points.current.length - 1];
    const next = pos(e);
    points.current.push(next);
    const g = ctx();
    if (g) {
      g.beginPath();
      g.moveTo(prev.x, prev.y);
      g.lineTo(next.x, next.y);
      g.stroke();
    }
  };

  const onUp = (e: PointerEvent) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    const stroke = points.current;
    points.current = [];
    fade.current = setTimeout(clear, 350);
    if (pathLength(stroke) < MIN_STROKE_LENGTH) onTap?.();
    else onStroke(stroke);
  };

  return (
    <canvas
      ref={canvas}
      class={className}
      aria-label={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
    />
  );
}

/** Small SVG preview of a stroke. */
export function StrokeThumb({ points, size = 44 }: { points: Point[]; size?: number }) {
  if (points.length < 2) return <svg width={size} height={size} />;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
  const pad = 6;
  const k = (size - pad * 2) / span;
  const d = points.map((p) => `${(pad + (p.x - minX) * k).toFixed(1)},${(pad + (p.y - minY) * k).toFixed(1)}`).join(' ');
  const [sx, sy] = d.split(' ')[0].split(',');
  return (
    <svg class="thumb" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx={sx} cy={sy} r="3" fill="var(--accent)" />
    </svg>
  );
}
