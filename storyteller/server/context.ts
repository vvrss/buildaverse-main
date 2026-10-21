import type { Config } from './config';
import type { Db } from './db';
import type { RateLimiter } from './http/ratelimit';
import type { MediaStore } from './media/store';
import type { Clock } from './util';

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  color: string;
  bio: string;
  role: 'user' | 'moderator' | 'admin';
  banned_at: number | null;
  created_at: number;
  password_hash: string;
}

/** Everything a route needs, created once in createApp (tests make their own). */
export interface Deps {
  db: Db;
  config: Config;
  clock: Clock;
  limits: RateLimiter;
  media: MediaStore;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    /** The signed-in account for this request's device profile, if any. */
    user: UserRow | null;
    /** The device-profile slot from X-Storyteller-Slot, if sent. */
    slot: string | null;
    sessionHash: string | null;
    ip: string;
  };
};
