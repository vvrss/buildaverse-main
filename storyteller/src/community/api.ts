import { signal } from '@preact/signals';
import type { ApiErrorBody, Health, Me } from '../shared/api';
import { profileId } from '../store/session';

/**
 * Talking to the Community server. Every request says which app version it
 * comes from; requests made by a profile carry that profile's slot, which
 * picks its own session cookie on the server (several profiles can share a
 * browser) and is also the server's guard against requests from other sites.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly data: ApiErrorBody['error'] | null = null,
  ) {
    super(message);
  }
}

/** "ready": the server answered; "unavailable": there is no Community here (e.g. the preview page). */
export const community = signal<'unknown' | 'checking' | 'ready' | 'unavailable' | 'outdated'>('unknown');
export const registrationOpen = signal(true);

/** The signed-in Community account of the current profile: undefined while unknown. */
export const me = signal<Me | null | undefined>(undefined);

/** A stable 16-hex slot for a profile id. */
export function slotOf(id: string): string {
  const hex = id.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length >= 16) return hex.slice(0, 16);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const ch of id) {
    a = Math.imul(a ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    b = Math.imul(b ^ ch.charCodeAt(0), 0x01000195) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

interface Options {
  /** Raw bytes (picture uploads) instead of JSON. */
  raw?: Blob;
  signal?: AbortSignal;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Storyteller-Client': __APP_VERSION__ };
  const pid = profileId.value;
  if (pid) headers['X-Storyteller-Slot'] = slotOf(pid);
  let payload: BodyInit | undefined;
  if (opts.raw) {
    payload = opts.raw;
    headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'offline', "Can't reach the Community right now. Check your connection and try again.");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: an error page from something in between.
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error ?? null;
    if (res.status === 426) community.value = 'outdated';
    if (res.status === 401 && pid === profileId.value) me.value = null;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? `Something went wrong (${res.status}). Try again.`, err);
  }
  return data as T;
}

export const get = <T>(path: string, opts?: Options) => api<T>('GET', path, undefined, opts);
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const put = <T>(path: string, body: unknown = {}) => api<T>('PUT', path, body);
export const patch = <T>(path: string, body: unknown = {}) => api<T>('PATCH', path, body);
export const del = <T>(path: string, body?: unknown) => api<T>('DELETE', path, body);

let checking: Promise<void> | null = null;

/** Finds out once whether a Community server is behind this page. */
export function checkCommunity(force = false): Promise<void> {
  if (checking && !force) return checking;
  community.value = 'checking';
  checking = (async () => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 6000);
    try {
      const h = await get<Health>('/health', { signal: timeout.signal });
      if (h?.ok !== true) throw new Error('not a Storyteller server');
      registrationOpen.value = h.registrationOpen;
      community.value = 'ready';
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 426)) community.value = 'unavailable';
    } finally {
      clearTimeout(timer);
    }
  })();
  return checking;
}

/** Reads the signed-in account for the current profile (null when signed out). */
export async function refreshMe(): Promise<Me | null> {
  const pid = profileId.value;
  if (!pid || community.value !== 'ready') {
    me.value = null;
    return null;
  }
  try {
    const m = await get<Me>('/me');
    if (profileId.value === pid) me.value = m;
    return m;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && profileId.value === pid) me.value = null;
    return me.value ?? null;
  }
}

/** A message to show for any error. */
export const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Something went wrong. Try again.';

export const isOffline = (err: unknown) => err instanceof ApiError && err.code === 'offline';
