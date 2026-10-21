import type { Clock } from '../util';
import { tooMany } from './errors';

/**
 * Fixed-window rate limits kept in memory. The server runs as one instance
 * (SQLite, local files), so memory is the right place.
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private sweeper: ReturnType<typeof setInterval>;

  constructor(
    private readonly clock: Clock,
    private readonly enabled: boolean,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  /** Throws 429 when `key` went over `max` hits within `windowMs`. */
  hit(bucket: string, key: string, max: number, windowMs: number) {
    if (!this.enabled) return;
    const now = this.clock.now();
    const id = `${bucket}:${key}`;
    const w = this.windows.get(id);
    if (!w || w.resetAt <= now) {
      this.windows.set(id, { count: 1, resetAt: now + windowMs });
      return;
    }
    w.count += 1;
    if (w.count > max) throw tooMany(Math.max(1, Math.ceil((w.resetAt - now) / 1000)));
  }

  private sweep() {
    const now = this.clock.now();
    for (const [id, w] of this.windows) if (w.resetAt <= now) this.windows.delete(id);
  }

  stop() {
    clearInterval(this.sweeper);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
