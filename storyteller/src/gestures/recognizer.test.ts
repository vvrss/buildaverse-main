import { describe, expect, it } from 'vitest';
import type { Point } from '../store/db';
import { BUILTIN_GESTURES } from './defaults';
import { makeTemplates, rank, recognize } from './recognizer';

const templates = BUILTIN_GESTURES.flatMap((g) => makeTemplates(g.action, [g.stroke]));
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
