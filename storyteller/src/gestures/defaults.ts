import type { Point } from '../store/db';

/** Built-in gestures, drawn on a 100×100 grid (y grows downward). */
export interface BuiltinGesture {
  id: string;
  symbol: string;
  action: string;
  /** The stroke shown in previews. */
  stroke: Point[];
  /** Extra variants recognized as the same gesture. */
  variants?: Point[][];
}

const P = (x: number, y: number): Point => ({ x, y });

/** A circle starting `startDeg` degrees clockwise from 12 o'clock. */
function circle(startDeg = 0): Point[] {
  const start = -Math.PI / 2 + (startDeg * Math.PI) / 180;
  return Array.from({ length: 33 }, (_, i) => {
    const a = start + (i / 32) * Math.PI * 2;
    return P(50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a));
  });
}

export const BUILTIN_GESTURES: BuiltinGesture[] = [
  { id: 'lt', symbol: '<', action: 'nav.prev', stroke: [P(100, 0), P(0, 50), P(100, 100)] },
  { id: 'gt', symbol: '>', action: 'nav.next', stroke: [P(0, 0), P(100, 50), P(0, 100)] },
  { id: 'z', symbol: 'Z', action: 'history.undo', stroke: [P(0, 0), P(100, 0), P(0, 100), P(100, 100)] },
  // People start circles anywhere, so there is one template every 45°.
  {
    id: 'circle',
    symbol: '○',
    action: 'voice.narration',
    stroke: circle(),
    variants: [45, 90, 135, 180, 225, 270, 315].map(circle),
  },
  { id: 'line', symbol: '—', action: 'voice.heading', stroke: [P(0, 0), P(100, 0)] },
];

export const strokesOf = (g: BuiltinGesture): Point[][] => [g.stroke, ...(g.variants ?? [])];
