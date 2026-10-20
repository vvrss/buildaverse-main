import type { Point } from '../store/db';

/**
 * Single-stroke gesture recognizer, based on the $1 Unistroke Recognizer
 * (Wobbrock, Wilson & Li, 2007) with two changes that suit shortcuts:
 *  - Orientation matters ("<" and ">" must differ), so strokes are not
 *    rotated to a canonical angle; only a small rotation search is done.
 *  - Thin strokes (lines) are scaled uniformly so they don't blow up into
 *    noise, as in the $1 "1D gesture" extension.
 * Each template is also stored reversed, so drawing direction is forgiven.
 */

const SAMPLES = 64;
const SIZE = 250;
const ONE_D_RATIO = 0.3;
const ANGLE_RANGE = deg(25);
const ANGLE_STEP = deg(2);
const PHI = 0.5 * (-1 + Math.sqrt(5));
const HALF_DIAGONAL = 0.5 * Math.sqrt(SIZE * SIZE + SIZE * SIZE);

/** Strokes shorter than this (in px) are taps, not gestures. */
export const MIN_STROKE_LENGTH = 30;
export const DEFAULT_THRESHOLD = 0.78;

export interface Template {
  action: string;
  points: Point[];
}

export interface Match {
  action: string;
  score: number;
}

function deg(d: number) {
  return (d * Math.PI) / 180;
}

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function pathLength(points: Point[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i += 1) d += dist(points[i - 1], points[i]);
  return d;
}

function resample(points: Point[], n: number): Point[] {
  const interval = pathLength(points) / (n - 1);
  const pts = points.map((p) => ({ ...p }));
  const out: Point[] = [{ ...pts[0] }];
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= interval && d > 0) {
      const t = (interval - acc) / d;
      const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
      out.push(q);
      pts.splice(i, 0, q);
      acc = 0;
    } else {
      acc += d;
    }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, n);
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function scaleAndCenter(points: Point[]): Point[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const uniform = Math.min(w, h) / Math.max(w, h) < ONE_D_RATIO;
  const sx = uniform ? SIZE / Math.max(w, h) : SIZE / w;
  const sy = uniform ? SIZE / Math.max(w, h) : SIZE / h;
  const scaled = points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  const c = centroid(scaled);
  return scaled.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

function rotate(points: Point[], angle: number): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}

function pathDistance(a: Point[], b: Point[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += dist(a[i], b[i]);
  return d / a.length;
}

function distanceAtBestAngle(candidate: Point[], template: Point[]): number {
  let a = -ANGLE_RANGE;
  let b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = pathDistance(rotate(candidate, x1), template);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = pathDistance(rotate(candidate, x2), template);
  while (Math.abs(b - a) > ANGLE_STEP) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = pathDistance(rotate(candidate, x1), template);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = pathDistance(rotate(candidate, x2), template);
    }
  }
  return Math.min(f1, f2);
}

/** Normalizes a raw stroke; null when it is too short to be a gesture. */
export function normalize(stroke: Point[]): Point[] | null {
  if (stroke.length < 2 || pathLength(stroke) < MIN_STROKE_LENGTH * 0.5) return null;
  return scaleAndCenter(resample(stroke, SAMPLES));
}

/** Builds templates (forward and reversed) for one action from raw strokes. */
export function makeTemplates(action: string, strokes: Point[][]): Template[] {
  const out: Template[] = [];
  for (const stroke of strokes) {
    const fwd = normalize(stroke);
    const rev = normalize([...stroke].reverse());
    if (fwd) out.push({ action, points: fwd });
    if (rev) out.push({ action, points: rev });
  }
  return out;
}

/** Ranks actions by best-matching template, highest score first. */
export function rank(stroke: Point[], templates: Template[]): Match[] {
  const candidate = normalize(stroke);
  if (!candidate) return [];
  const best = new Map<string, number>();
  for (const t of templates) {
    const score = 1 - distanceAtBestAngle(candidate, t.points) / HALF_DIAGONAL;
    if (score > (best.get(t.action) ?? -Infinity)) best.set(t.action, score);
  }
  return [...best.entries()].map(([action, score]) => ({ action, score })).sort((a, b) => b.score - a.score);
}

export function recognize(stroke: Point[], templates: Template[], threshold = DEFAULT_THRESHOLD): Match | null {
  const [top] = rank(stroke, templates);
  return top && top.score >= threshold ? top : null;
}
