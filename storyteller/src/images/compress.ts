/**
 * Shrinks a picture on the device before it is stored or uploaded:
 *  - decoded with the camera's rotation applied;
 *  - scenes and covers at most 1600 px on the long side, portraits a
 *    512×512 square;
 *  - always re-encoded (AVIF where the browser can, else WebP, else JPEG for
 *    Safari), which also drops EXIF data such as GPS position.
 */

export type PictureKind = 'scene' | 'cover' | 'portrait';

/** A crop rectangle in the picture's own pixels (after rotation). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Compressed {
  blob: Blob;
  width: number;
  height: number;
  ref: string;
  originalBytes: number;
}

export const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_SIDE: Record<PictureKind, number> = { scene: 1600, cover: 1600, portrait: 512 };
const QUALITY = { 'image/avif': 0.6, 'image/webp': 0.8, 'image/jpeg': 0.85 } as const;
type OutputType = keyof typeof QUALITY;

export class PictureError extends Error {}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Some browsers can't take the options or this format; try an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // <img> applies the EXIF orientation itself.
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PictureError("That picture couldn't be opened. Try a JPEG, PNG or WebP.");
  }
}

function canvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function encode(c: HTMLCanvasElement | OffscreenCanvas, type: OutputType): Promise<Blob | null> {
  try {
    if ('convertToBlob' in c) return await c.convertToBlob({ type, quality: QUALITY[type] });
    return await new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, QUALITY[type]));
  } catch {
    return null;
  }
}

const support = new Map<OutputType, Promise<boolean>>();

/** Whether this browser really encodes `type` (unsupported types silently come back as PNG). */
export function canEncode(type: OutputType): Promise<boolean> {
  let p = support.get(type);
  if (!p) {
    p = (async () => {
      const c = canvas(2, 2);
      const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
      if (!ctx) return false;
      ctx.fillRect(0, 0, 2, 2);
      const blob = await encode(c, type);
      return blob?.type === type;
    })();
    support.set(type, p);
  }
  return p;
}

/** Where to cut and how big the result is. */
export function plan(width: number, height: number, kind: PictureKind, crop?: Crop): { crop: Crop; w: number; h: number } {
  let rect: Crop = crop ?? { x: 0, y: 0, w: width, h: height };
  if (!crop && kind === 'portrait') {
    const side = Math.min(width, height);
    rect = { x: (width - side) / 2, y: (height - side) / 2, w: side, h: side };
  }
  rect = {
    x: Math.max(0, Math.min(rect.x, width - 1)),
    y: Math.max(0, Math.min(rect.y, height - 1)),
    w: Math.max(1, Math.min(rect.w, width)),
    h: Math.max(1, Math.min(rect.h, height)),
  };
  const scale = Math.min(1, MAX_SIDE[kind] / Math.max(rect.w, rect.h));
  return { crop: rect, w: Math.max(1, Math.round(rect.w * scale)), h: Math.max(1, Math.round(rect.h * scale)) };
}

/** Draws `src` into a w×h canvas, halving in steps for a sharp result on big downscales. */
function draw(src: CanvasImageSource, crop: Crop, w: number, h: number, background: string | null) {
  let current: CanvasImageSource = src;
  let rect = crop;
  while (rect.w / 2 >= w * 1.5 && rect.h / 2 >= h * 1.5) {
    const half = canvas(Math.round(rect.w / 2), Math.round(rect.h / 2));
    const hctx = half.getContext('2d') as CanvasRenderingContext2D;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(current, rect.x, rect.y, rect.w, rect.h, 0, 0, half.width, half.height);
    current = half as CanvasImageSource;
    rect = { x: 0, y: 0, w: half.width, h: half.height };
  }
  const out = canvas(w, h);
  const ctx = out.getContext('2d') as CanvasRenderingContext2D;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  return out;
}

/** The picture code for some bytes: 16 hex digits of their SHA-256. */
export async function refOf(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Insecure pages have no crypto.subtle: two 32-bit FNV-1a hashes with different seeds.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ bytes.length;
  for (const x of bytes) {
    a = Math.imul(a ^ x, 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x01000193 + 2) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export async function compressPicture(file: Blob, kind: PictureKind, crop?: Crop): Promise<Compressed> {
  if (file.type && !file.type.startsWith('image/')) throw new PictureError("That file isn't a picture.");
  if (file.size > MAX_INPUT_BYTES) throw new PictureError('That picture is over 40 MB. Pick a smaller one.');
  const decoded = await decode(file);
  try {
    const target = plan(decoded.width, decoded.height, kind, crop);
    // Only PNG, WebP and GIF can be transparent; JPEG output needs a background then.
    const transparent = /png|webp|gif|avif/.test(file.type);
    const types: OutputType[] = [];
    if (await canEncode('image/avif')) types.push('image/avif');
    if (await canEncode('image/webp')) types.push('image/webp');
    types.push('image/jpeg');
    let best: Blob | null = null;
    for (const type of types) {
      const c = draw(decoded.source, target.crop, target.w, target.h, type === 'image/jpeg' && transparent ? '#ffffff' : null);
      const blob = await encode(c, type);
      if (blob && blob.type === type && (!best || blob.size < best.size)) best = blob;
      // WebP or AVIF is good enough; JPEG is only the fallback.
      if (best && type !== 'image/jpeg') break;
    }
    if (!best) throw new PictureError("This browser couldn't shrink the picture.");
    return { blob: best, width: target.w, height: target.h, ref: await refOf(best), originalBytes: file.size };
  } finally {
    decoded.close();
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
