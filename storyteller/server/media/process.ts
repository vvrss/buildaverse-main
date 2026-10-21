import sharp, { type Metadata } from 'sharp';
import { HttpError } from '../http/errors';

sharp.cache(false);
sharp.concurrency(1);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
/** Widths served to readers; the largest never exceeds 1600 px. */
export const WIDTHS = [160, 480, 960, 1600];
const QUALITY = 78;
/** AVIF is smaller at the same look; effort 2 keeps it to well under a second per picture. */
const AVIF = { quality: 50, effort: 2 };

/** Checks the real file type from its first bytes, whatever the request claims. */
export function sniff(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'avif' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buf.toString('ascii', 8, 12))) return 'avif';
  return null;
}

export interface Processed {
  width: number;
  height: number;
  widths: number[];
  avif: boolean;
  variants: { w: number; format: 'webp' | 'avif'; data: Buffer }[];
}

const options = { limitInputPixels: MAX_PIXELS, animated: false, failOn: 'error' as const };

/**
 * Re-encodes an uploaded picture: applies the camera rotation, strips all
 * metadata (EXIF, GPS, color profiles become sRGB) and writes WebP at each
 * width up to the picture's own size. Re-encoding also defuses files that
 * are valid images and something else at the same time.
 */
export async function processImage(buf: Buffer): Promise<Processed> {
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'unsupported_image', 'Only JPEG, PNG, WebP and AVIF pictures can be uploaded.');
  let meta: Metadata;
  try {
    meta = await sharp(buf, options).metadata();
  } catch {
    throw new HttpError(422, 'bad_image', "That picture couldn't be read.");
  }
  const known = ['jpeg', 'png', 'webp'].includes(meta.format ?? '') || (meta.format === 'heif' && meta.compression === 'av1');
  if (!meta.width || !meta.height || !known) {
    throw new HttpError(415, 'unsupported_image', 'Only JPEG, PNG, WebP and AVIF pictures can be uploaded.');
  }
  if (meta.width * meta.height > MAX_PIXELS) {
    throw new HttpError(413, 'image_too_large', 'That picture has too many pixels.');
  }
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = rotated ? meta.height : meta.width;
  const height = rotated ? meta.width : meta.height;
  const top = Math.min(width, WIDTHS[WIDTHS.length - 1]);
  const widths = [...new Set([...WIDTHS.filter((w) => w < top), top])].sort((a, b) => a - b);

  const variants: Processed['variants'] = [];
  try {
    for (const w of widths) {
      const resized = sharp(buf, options).rotate().resize({ width: w, withoutEnlargement: true });
      variants.push({ w, format: 'webp', data: await resized.clone().webp({ quality: QUALITY, effort: 4 }).toBuffer() });
      variants.push({ w, format: 'avif', data: await resized.clone().avif(AVIF).toBuffer() });
    }
  } catch {
    throw new HttpError(422, 'bad_image', "That picture couldn't be processed.");
  }
  return { width: top, height: Math.round((height * top) / width), widths, avif: true, variants };
}

/** At most two pictures are processed at once; more than 16 waiting is refused. */
export class JobQueue {
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(
    private readonly max = 2,
    private readonly cap = 16,
  ) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      if (this.waiting.length >= this.cap) {
        throw new HttpError(503, 'busy', 'The server is busy processing pictures. Try again in a moment.');
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running += 1;
    try {
      return await job();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}
