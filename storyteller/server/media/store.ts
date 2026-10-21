import { mkdirSync, renameSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const BLOB_RE = /^[0-9a-f]{64}$/;

export type MediaFormat = 'webp' | 'avif';

/**
 * Processed pictures on disk: DATA_DIR/media/<ab>/<blob>/<width>.<webp|avif>.
 * Paths are built only from validated hex ids, known widths and formats.
 */
export class MediaStore {
  private readonly mediaDir: string;
  private readonly tmpDir: string;

  constructor(dataDir: string) {
    this.mediaDir = join(dataDir, 'media');
    this.tmpDir = join(dataDir, 'tmp');
    mkdirSync(this.mediaDir, { recursive: true });
    mkdirSync(this.tmpDir, { recursive: true });
  }

  private dir(blob: string): string {
    if (!BLOB_RE.test(blob)) throw new Error('bad blob id');
    return join(this.mediaDir, blob.slice(0, 2), blob);
  }

  file(blob: string, width: number, format: MediaFormat = 'webp'): string {
    if (!Number.isInteger(width) || width <= 0 || width > 4000) throw new Error('bad width');
    if (format !== 'webp' && format !== 'avif') throw new Error('bad format');
    return join(this.dir(blob), `${width}.${format}`);
  }

  /** Writes all variants through a temp file each, so a crash never leaves half a picture. */
  write(blob: string, variants: { w: number; format: MediaFormat; data: Buffer }[]) {
    const dir = this.dir(blob);
    mkdirSync(dir, { recursive: true });
    for (const v of variants) {
      const tmp = join(this.tmpDir, `${blob}-${v.w}-${v.format}-${randomBytes(4).toString('hex')}`);
      writeFileSync(tmp, v.data);
      renameSync(tmp, this.file(blob, v.w, v.format));
    }
  }

  read(blob: string, width: number, format: MediaFormat = 'webp'): Promise<Buffer> {
    return readFile(this.file(blob, width, format));
  }

  remove(blob: string) {
    rmSync(this.dir(blob), { recursive: true, force: true });
  }

  /** Free bytes on the data disk, or Infinity when unknown. */
  freeBytes(): number {
    try {
      const s = statfsSync(this.mediaDir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
}
