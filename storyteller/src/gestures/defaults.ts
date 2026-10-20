import type { Point } from '../store/db';

/** Built-in gestures, drawn on a 100×100 grid (y grows downward). */
export interface BuiltinGesture {
  id: string;
  symbol: string;
  action: string;
  stroke: Point[];
}

const P = (x: number, y: number): Point => ({ x, y });

function circle(): Point[] {
  return Array.from({ length: 33 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 32) * Math.PI * 2;
    return P(50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a));
  });
}

export const BUILTIN_GESTURES: BuiltinGesture[] = [
  { id: 'lt', symbol: '<', action: 'nav.prev', stroke: [P(100, 0), P(0, 50), P(100, 100)] },
  { id: 'gt', symbol: '>', action: 'nav.next', stroke: [P(0, 0), P(100, 50), P(0, 100)] },
  { id: 'z', symbol: 'Z', action: 'history.undo', stroke: [P(0, 0), P(100, 0), P(0, 100), P(100, 100)] },
  { id: 'circle', symbol: '○', action: 'voice.narration', stroke: circle() },
  { id: 'line', symbol: '—', action: 'voice.heading', stroke: [P(0, 0), P(100, 0)] },
];
