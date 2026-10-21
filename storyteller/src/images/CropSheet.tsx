import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet, closeSheet, showSheet } from '../ui/overlay';
import type { Crop } from './compress';

interface View {
  s: number;
  tx: number;
  ty: number;
}

const FRAME_MAX = 300;

/**
 * Lets the person choose the part of a picture to keep, with a fixed shape
 * (square for portraits, 3:2 for covers). Drag to move, pinch, scroll or use
 * the slider to zoom; arrow keys and + / - work too.
 */
function Cropper({ file, aspect, onDone }: { file: File; aspect: number; onDone: (crop: Crop | null) => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const frameW = Math.min(FRAME_MAX, (typeof window !== 'undefined' ? window.innerWidth : 360) - 64);
  const frameH = Math.round(frameW / aspect);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; view: View } | null>(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const minScale = size ? Math.max(frameW / size.w, frameH / size.h) : 1;

  const clamp = (v: View): View => {
    if (!size) return v;
    const s = Math.min(Math.max(v.s, minScale), minScale * 6);
    return {
      s,
      tx: Math.min(0, Math.max(frameW - size.w * s, v.tx)),
      ty: Math.min(0, Math.max(frameH - size.h * s, v.ty)),
    };
  };

  /** Zooms to scale `s` keeping the frame point (fx, fy) still. */
  const zoomTo = (v: View, s: number, fx = frameW / 2, fy = frameH / 2): View => {
    const k = s / v.s;
    return clamp({ s, tx: fx - (fx - v.tx) * k, ty: fy - (fy - v.ty) * k });
  };

  const onLoad = (e: Event) => {
    const img = e.currentTarget as HTMLImageElement;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setSize({ w, h });
    const s = Math.max(frameW / w, frameH / h);
    setView({ s, tx: (frameW - w * s) / 2, ty: (frameH - h * s) / 2 });
  };

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), view };
    }
  };

  const onMove = (e: PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const start = pinch.current;
      setView(zoomTo(start.view, start.view.s * (dist / start.dist), (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top));
      return;
    }
    setView((v) => clamp({ ...v, tx: v.tx + now.x - last.x, ty: v.ty + now.y - last.y }));
  };

  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setView((v) => zoomTo(v, v.s * Math.exp(-e.deltaY / 400), e.clientX - rect.left, e.clientY - rect.top));
  };

  const onKey = (e: KeyboardEvent) => {
    const step = 12;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setView((v) => clamp({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (e.key === '+' || e.key === '=') setView((v) => zoomTo(v, v.s * 1.15));
    else if (e.key === '-') setView((v) => zoomTo(v, v.s / 1.15));
  };

  const done = () => {
    if (!size) return;
    onDone({ x: -view.tx / view.s, y: -view.ty / view.s, w: frameW / view.s, h: frameH / view.s });
  };

  return (
    <>
      <div
        class="crop-frame"
        style={`width:${frameW}px;height:${frameH}px`}
        tabIndex={0}
        role="application"
        aria-label="Picture position. Drag or use the arrow keys to move, + and - to zoom."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        onKeyDown={onKey}
        data-testid="crop-frame"
      >
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={onLoad}
          style={size ? `width:${size.w * view.s}px;height:${size.h * view.s}px;transform:translate(${view.tx}px,${view.ty}px)` : 'opacity:0'}
        />
      </div>
      <label class="crop-zoom">
        <span class="muted small">Zoom</span>
        <input
          type="range"
          min={1}
          max={6}
          step={0.01}
          value={size ? view.s / minScale : 1}
          onInput={(e) => setView((v) => zoomTo(v, minScale * Number((e.currentTarget as HTMLInputElement).value)))}
        />
      </label>
      <div class="sheet-actions">
        <button type="button" class="btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="button" class="btn primary" data-autofocus onClick={done} disabled={!size} data-testid="crop-done">
          Use picture
        </button>
      </div>
    </>
  );
}

/** Asks for the part of `file` to keep; null when cancelled. */
export function cropPicture(file: File, aspect: number, title: string): Promise<Crop | null> {
  return new Promise((resolve) => {
    let id = 0;
    const finish = (crop: Crop | null) => {
      closeSheet(id);
      resolve(crop);
    };
    id = showSheet(
      <Sheet title={title} onClose={() => finish(null)}>
        <Cropper file={file} aspect={aspect} onDone={finish} />
      </Sheet>,
    );
  });
}
