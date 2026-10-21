import type { ApiErrorBody } from '../../src/shared/api';

/** A request error with a stable code the app can branch on. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Omit<ApiErrorBody['error'], 'code' | 'message'> = {},
  ) {
    super(message);
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const badRequest = (message: string, extra?: HttpError['extra']) => new HttpError(400, 'bad_request', message, extra);
export const unauthorized = (message = 'Sign in to do that.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = "You can't do that.") => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'That') => new HttpError(404, 'not_found', `${what} doesn't exist or was removed.`);
export const conflict = (code: string, message: string, extra?: HttpError['extra']) => new HttpError(409, code, message, extra);
export const tooMany = (retryAfter: number) =>
  new HttpError(429, 'rate_limited', `Too many requests. Try again in ${retryAfter} seconds.`);
