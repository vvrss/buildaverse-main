import type { Context } from 'hono';
import type { z } from 'zod';
import { HttpError, badRequest } from './errors';

/** Reads and validates a JSON body; anything else is a 4xx with field messages. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const type = c.req.header('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send JSON.');
  }
  let data: unknown;
  try {
    data = await c.req.json();
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw badRequest('Some fields are not valid.', { fields });
  }
  return parsed.data;
}

/** Page size from ?limit=, clamped. */
export function limitParam(c: Context, fallback = 20, max = 50): number {
  const n = Number(c.req.query('limit'));
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
