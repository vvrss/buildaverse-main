import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

/** Server settings, all from environment variables (see DEPLOY.md). */
export interface Config {
  port: number;
  host: string;
  /** Holds the database file and processed pictures. */
  dataDir: string;
  /** Temporary data dir that is removed on exit (tests). */
  ephemeral: boolean;
  /** The public https origin, e.g. https://stories.example.com. Required in production. */
  publicOrigin: string | null;
  adminUsername: string | null;
  adminPassword: string | null;
  registrationOpen: boolean;
  /** Read the client address from X-Forwarded-For / Fly-Client-IP (behind a proxy). */
  trustProxy: boolean;
  rateLimits: boolean;
  /** Clients older than this get 426 and are asked to update. */
  minClient: string;
  production: boolean;
  /** The built app (vite build output). */
  distDir: string;
  version: string;
  /** Per-user picture storage limit in bytes. */
  quotaBytes: number;
}

const flag = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const Env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().optional(),
  STORYTELLER_EPHEMERAL: flag,
  PUBLIC_ORIGIN: z.string().url().optional(),
  ADMIN_USERNAME: z
    .string()
    .regex(/^[a-z0-9_]{3,24}$/, 'ADMIN_USERNAME must be 3-24 lowercase letters, digits or _')
    .optional(),
  ADMIN_PASSWORD: z.string().min(8).max(200).optional(),
  REGISTRATION_OPEN: flag,
  TRUST_PROXY: flag,
  RATE_LIMITS: z.enum(['on', 'off']).default('on'),
  MIN_CLIENT: z.string().regex(/^\d+\.\d+\.\d+$/).default('0.3.0'),
  NODE_ENV: z.string().optional(),
  DIST_DIR: z.string().optional(),
  QUOTA_MB: z.coerce.number().int().min(1).default(250),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env, defaults: { distDir: string; version: string }): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  if (production && e.RATE_LIMITS === 'off') throw new Error('RATE_LIMITS=off is not allowed in production');
  if ((e.ADMIN_USERNAME && !e.ADMIN_PASSWORD) || (!e.ADMIN_USERNAME && e.ADMIN_PASSWORD)) {
    throw new Error('Set both ADMIN_USERNAME and ADMIN_PASSWORD, or neither');
  }
  const ephemeral = e.STORYTELLER_EPHEMERAL === true;
  const dataDir = ephemeral
    ? mkdtempSync(join(tmpdir(), 'storyteller-'))
    : resolve(e.DATA_DIR ?? (production ? '/data' : '.dev-data'));
  return {
    port: e.PORT,
    host: e.HOST,
    dataDir,
    ephemeral,
    publicOrigin: e.PUBLIC_ORIGIN ? new URL(e.PUBLIC_ORIGIN).origin : null,
    adminUsername: e.ADMIN_USERNAME ?? null,
    adminPassword: e.ADMIN_PASSWORD ?? null,
    registrationOpen: e.REGISTRATION_OPEN ?? true,
    trustProxy: e.TRUST_PROXY ?? false,
    rateLimits: e.RATE_LIMITS === 'on',
    minClient: e.MIN_CLIENT,
    production,
    distDir: resolve(e.DIST_DIR ?? defaults.distDir),
    version: defaults.version,
    quotaBytes: e.QUOTA_MB * 1024 * 1024,
  };
}

/** Compares "1.2.3" versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
