import { describe, expect, it } from 'vitest';
import type { Point } from '../store/db';
import { BUILTIN_GESTURES, strokesOf } from './defaults';
import { makeTemplates, rank, recognize } from './recognizer';

const templates = BUILTIN_GESTURES.flatMap((g) => makeTemplates(g.action, strokesOf(g)));
const actionOf = (symbol: string) => BUILTIN_GESTURES.find((g) => g.symbol === symbol)!.action;

/** Deterministic pseudo-random numbers, so noisy strokes are reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Densifies a polyline and applies scale, rotation, offset and jitter, like a finger would. */
function humanize(stroke: Point[], opts: { scale?: number; angle?: number; jitter?: number; seed?: number; sx?: number } = {}) {
  const { scale = 2.5, angle = 0, jitter = 3, seed = 1, sx = 1 } = opts;
  const rand = rng(seed);
  const dense: Point[] = [];
  for (let i = 1; i < stroke.length; i += 1) {
    for (let t = 0; t < 1; t += 0.05) {
      dense.push({ x: stroke[i - 1].x + t * (stroke[i].x - stroke[i - 1].x), y: stroke[i - 1].y + t * (stroke[i].y - stroke[i - 1].y) });
    }
  }
  dense.push(stroke[stroke.length - 1]);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return dense.map((p) => {
    const x = (p.x - 50) * scale * sx;
    const y = (p.y - 50) * scale;
    return {
      x: 300 + x * cos - y * sin + (rand() - 0.5) * 2 * jitter,
      y: 400 + x * sin + y * cos + (rand() - 0.5) * 2 * jitter,
    };
  });
}

describe('gesture recognizer', () => {
  for (const g of BUILTIN_GESTURES) {
    it(`recognizes a hand-drawn ${g.symbol}`, () => {
      for (const [i, opts] of [
        { scale: 1.5 },
        { scale: 3, angle: 0.15, seed: 7 },
        { scale: 2, angle: -0.2, jitter: 5, seed: 42 },
        { scale: 2, sx: 1.4, seed: 3 },
      ].entries()) {
        const match = recognize(humanize(g.stroke, opts), templates);
        expect(match?.action, `variant ${i}`).toBe(g.action);
      }
    });
  }

  it('tells < and > apart', () => {
    const [top, second] = rank(humanize(BUILTIN_GESTURES[0].stroke, { seed: 9 }), templates);
    expect(top.action).toBe(actionOf('<'));
    expect(second.score).toBeLessThan(top.score - 0.1);
  });

  it('forgives drawing direction', () => {
    const reversed = [...BUILTIN_GESTURES.find((g) => g.symbol === '○')!.stroke].reverse();
    expect(recognize(humanize(reversed), templates)?.action).toBe(actionOf('○'));
  });

  it('ignores taps', () => {
    expect(recognize([{ x: 10, y: 10 }, { x: 12, y: 11 }], templates)).toBeNull();
  });

  it('learns a custom gesture from samples', () => {
    const letterA: Point[] = [{ x: 0, y: 100 }, { x: 50, y: 0 }, { x: 100, y: 100 }, { x: 75, y: 50 }, { x: 25, y: 50 }];
    const custom = makeTemplates('voice.set:ana', [
      humanize(letterA, { seed: 1 }),
      humanize(letterA, { seed: 2, angle: 0.1 }),
      humanize(letterA, { seed: 3, scale: 1.8 }),
    ]);
    const all = [...templates, ...custom];
    expect(recognize(humanize(letterA, { seed: 99, angle: -0.1 }), all)?.action).toBe('voice.set:ana');
    // Built-ins still win for their own shapes.
    expect(recognize(humanize(BUILTIN_GESTURES[2].stroke, { seed: 5 }), all)?.action).toBe(actionOf('Z'));
  });
});

describe('gesture recognizer edge cases', () => {
  const circle = (startDeg: number, dir: 1 | -1): Point[] =>
    Array.from({ length: 41 }, (_, i) => {
      const a = -Math.PI / 2 + (startDeg * Math.PI) / 180 + dir * (i / 40) * Math.PI * 1.95;
      return { x: 50 + 50 * Math.cos(a), y: 50 + 50 * Math.sin(a) };
    });

  it('recognizes a circle started anywhere, in either direction', () => {
    for (const start of [0, 45, 90, 135, 180, 225, 270, 315]) {
      for (const dir of [1, -1] as const) {
        expect(recognize(humanize(circle(start, dir), { seed: start + dir }), templates)?.action, `${start} ${dir}`).toBe(
          actionOf('○'),
        );
      }
    }
  });

  it('recognizes a heading line drawn at a slant, and narrow < >', () => {
    for (const deg of [0, 10, 17, 20, 22]) {
      const line = humanize([{ x: 0, y: 50 }, { x: 100, y: 50 }], { angle: (deg * Math.PI) / 180 });
      expect(recognize(line, templates)?.action, `${deg}°`).toBe(actionOf('—'));
    }
    for (const w of [20, 28]) {
      const lt = humanize([{ x: 50 + w / 2, y: 0 }, { x: 50 - w / 2, y: 50 }, { x: 50 + w / 2, y: 100 }], { jitter: 2 });
      expect(recognize(lt, templates)?.action, `<${w}`).toBe(actionOf('<'));
    }
  });

  it('keeps rotated, noisy Z strokes', () => {
    for (const angle of [-0.2, 0.2]) {
      expect(recognize(humanize(BUILTIN_GESTURES[2].stroke, { scale: 2, angle, jitter: 5, seed: 42 }), templates)?.action).toBe(
        actionOf('Z'),
      );
    }
  });

  it('ignores look-alike scribbles at the default strictness', () => {
    const shapes: Record<string, Point[]> = {
      U: [{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 20, y: 100 }, { x: 80, y: 100 }, { x: 100, y: 80 }, { x: 100, y: 0 }],
      check: [{ x: 0, y: 60 }, { x: 35, y: 100 }, { x: 100, y: 0 }],
      L: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }],
      triangle: [{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 50, y: 0 }],
      caret: [{ x: 0, y: 100 }, { x: 50, y: 0 }, { x: 100, y: 100 }],
    };
    for (const [name, pts] of Object.entries(shapes)) {
      expect(recognize(humanize(pts, { seed: 7 }), templates), name).toBeNull();
    }
  });

  it('accepts uneven, hand-drawn < > and Z at the default strictness', () => {
    const shapes: Record<string, Point[]> = {
      '<': [{ x: 100, y: 0 }, { x: 0, y: 50 }, { x: 80, y: 90 }],
      '>': [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 20, y: 90 }],
      Z: [{ x: 10, y: 0 }, { x: 90, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }],
      'Z (short bars)': [{ x: 15, y: 0 }, { x: 85, y: 0 }, { x: 0, y: 100 }, { x: 70, y: 100 }],
    };
    for (const [name, pts] of Object.entries(shapes)) {
      expect(recognize(humanize(pts, { scale: 1.2, seed: 3 }), templates)?.action, name).toBe(actionOf(name[0]));
    }
  });

  it('survives degenerate input', () => {
    expect(rank([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }], templates)).toEqual([]);
    expect(rank([{ x: NaN, y: 1 }, { x: 0, y: 0 }, { x: 200, y: 0 }], templates)[0]?.action).toBe(actionOf('—'));
  });
});
