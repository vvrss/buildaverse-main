import { createHash, randomBytes } from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A random public id, e.g. "7Qf3kZp01mXa" (12 base62 characters, ~71 bits). */
export function newId(length = 12): string {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i += 1) {
    // Rejection sampling keeps the distribution uniform.
    if (bytes[i] < 248) out += BASE62[bytes[i] % 62];
  }
  return out.length === length ? out : newId(length);
}

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

export const isId = (value: string) => /^[0-9A-Za-z]{12}$/.test(value);

/** Clock injected into the app so tests can move time. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * Cleans user text: NFC, no control characters except new lines (and tabs
 * turned into spaces), no bidirectional override characters, trimmed.
 */
export function cleanText(value: string, { multiline = false } = {}): string {
  let s = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  s = s.replace(/[‪-‮⁦-⁩]/g, '');
  s = multiline ? s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : s.replace(/[\u0000-\u001f\u007f]/g, ' ');
  if (multiline) s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export function wordCount(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/** Opaque keyset cursor: base64url JSON of [time, id]. */
export function encodeCursor(time: number, id: string | number): string {
  return Buffer.from(JSON.stringify([time, id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): [number, string | number] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && ['string', 'number'].includes(typeof v[1])) {
      return [v[0], v[1]];
    }
  } catch {
    // Invalid cursors read as "from the start".
  }
  return null;
}
