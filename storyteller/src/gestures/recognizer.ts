import type { Point } from '../store/db';

/**
 * Single-stroke gesture recognizer, based on the $1 Unistroke Recognizer
 * (Wobbrock, Wilson & Li, 2007) with changes that suit shortcuts:
 *  - Orientation matters ("<" and ">" must differ), so strokes are not
 *    rotated to a canonical angle; only a small rotation search is done.
 *  - Every stroke is compared both scaled uniformly and stretched to a
 *    square, and the better fit counts. Thin strokes (lines, measured along
 *    their own axis so a slanted line still counts as thin) are never
 *    stretched, so their jitter can't blow up into a shape (the $1 "1D"
 *    extension, made rotation-invariant).
 *  - A match must clearly beat the next-best action, so scribbles that
 *    half-resemble two gestures fire neither.
 * Each template is also stored reversed, so drawing direction is forgiven.
 */

const SAMPLES = 64;
const SIZE = 250;
/** Below this ratio of a stroke's minor to major axis, it is a line and never stretched. */
const THIN_RATIO = 0.12;
const ANGLE_RANGE = deg(25);
const ANGLE_STEP = deg(2);
const PHI = 0.5 * (-1 + Math.sqrt(5));
const HALF_DIAGONAL = 0.5 * Math.sqrt(SIZE * SIZE + SIZE * SIZE);

/** Strokes shorter than this (in px) are taps, not gestures. */
export const MIN_STROKE_LENGTH = 30;
export const DEFAULT_THRESHOLD = 0.92;
/** The best action must beat the second-best by this much. */
export const MIN_MARGIN = 0.04;

/** A normalized stroke: always a uniformly scaled version, plus a stretched one unless it is thin. */
export interface Shape {
  uniform: Point[];
  stretched: Point[] | null;
}

export interface Template {
  action: string;
  /** The uniform shape, also used for previews. */
  points: Point[];
  shape: Shape;
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

/** Ratio of the stroke's spread along its minor and major axes (0 = a straight line). */
function axisRatio(points: Point[]): number {
  const c = centroid(points);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const mean = (sxx + syy) / 2;
  const spread = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const major = mean + spread;
  const minor = Math.max(mean - spread, 0);
  return major > 0 ? Math.sqrt(minor / major) : 0;
}

/** Stretches a stroke to fill the square (non-uniform), centered on its centroid. */
function stretchToSquare(points: Point[]): Point[] {
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
  const sx = SIZE / Math.max(maxX - minX, 1e-6);
  const sy = SIZE / Math.max(maxY - minY, 1e-6);
  const scaled = points.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  const c = centroid(scaled);
  return scaled.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

/**
 * Scales a stroke uniformly so its average distance from the centroid is
 * fixed. Unlike a bounding box, that measure doesn't change when the stroke
 * is drawn slightly rotated, so the rotation search can fully correct it.
 */
function scaleUniform(points: Point[]): Point[] {
  const c = centroid(points);
  let sum = 0;
  for (const p of points) sum += (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
  const rms = Math.sqrt(sum / points.length) || 1e-6;
  const k = (SIZE * 0.4) / rms;
  return points.map((p) => ({ x: (p.x - c.x) * k, y: (p.y - c.y) * k }));
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
export function normalize(stroke: Point[]): Shape | null {
  const finite = stroke.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finite.length < 2 || pathLength(finite) < MIN_STROKE_LENGTH * 0.5) return null;
  const points = resample(finite, SAMPLES);
  return {
    uniform: scaleUniform(points),
    stretched: axisRatio(points) >= THIN_RATIO ? stretchToSquare(points) : null,
  };
}

function score(candidate: Shape, template: Shape): number {
  let d = distanceAtBestAngle(candidate.uniform, template.uniform);
  if (candidate.stretched && template.stretched) {
    d = Math.min(d, distanceAtBestAngle(candidate.stretched, template.stretched));
  }
  return 1 - d / HALF_DIAGONAL;
}

/** Builds templates (forward and reversed) for one action from raw strokes. */
export function makeTemplates(action: string, strokes: Point[][]): Template[] {
  const out: Template[] = [];
  for (const stroke of strokes) {
    for (const s of [stroke, [...stroke].reverse()]) {
      const shape = normalize(s);
      if (shape) out.push({ action, points: shape.uniform, shape });
    }
  }
  return out;
}

/** Ranks actions by best-matching template, highest score first. */
export function rank(stroke: Point[], templates: Template[]): Match[] {
  const candidate = normalize(stroke);
  if (!candidate) return [];
  const best = new Map<string, number>();
  for (const t of templates) {
    const value = score(candidate, t.shape);
    if (value > (best.get(t.action) ?? -Infinity)) best.set(t.action, value);
  }
  return [...best.entries()].map(([action, value]) => ({ action, score: value })).sort((a, b) => b.score - a.score);
}

export function recognize(stroke: Point[], templates: Template[], threshold = DEFAULT_THRESHOLD): Match | null {
  const [top, second] = rank(stroke, templates);
  if (!top || top.score < threshold) return null;
  if (second && top.score - second.score < MIN_MARGIN) return null;
  return top;
}
