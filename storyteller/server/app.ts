import { Hono } from 'hono';
import type { Health } from '../src/shared/api';
import { sessionMiddleware } from './auth/sessions';
import type { AppEnv, Deps } from './context';
import { HttpError } from './http/errors';
import { apiGuards, securityHeaders } from './http/security';
import { staticFiles } from './http/static';
import { authRoutes } from './routes/auth';
import { episodeRoutes } from './routes/episodes';
import { imageRoutes, mediaRoutes } from './routes/images';
import { moderationRoutes } from './routes/moderation';
import { shareRoutes } from './routes/share';
import { socialRoutes } from './routes/social';
import { storyRoutes } from './routes/stories';
import { userRoutes } from './routes/users';

/**
 * The whole server as one Hono app: /api (JSON), /media (pictures),
 * /s and /e (link previews) and the built app itself.
 */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    c.set('user', null);
    c.set('slot', null);
    c.set('sessionHash', null);
    c.set('ip', 'unknown');
    await next();
  });
  app.use('*', securityHeaders());

  const api = new Hono<AppEnv>();
  api.use('*', apiGuards(), sessionMiddleware());
  api.get('/health', (c) => {
    const body: Health = { ok: true, version: deps.config.version, registrationOpen: deps.config.registrationOpen };
    return c.json(body);
  });
  for (const routes of [authRoutes(), imageRoutes(), storyRoutes(), episodeRoutes(), socialRoutes(), userRoutes(), moderationRoutes()]) {
    api.route('/', routes);
  }
  api.all('*', (c) => c.json(new HttpError(404, 'not_found', 'There is no such API route.').body(), 404));

  app.route('/api', api);
  app.route('/', mediaRoutes());
  app.route('/', shareRoutes());
  app.use('*', staticFiles(deps.config.distDir));

  app.notFound((c) => c.text('Not found', 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      if (err.status === 429) c.header('Retry-After', String(Number(/\d+/.exec(err.message)?.[0] ?? 60)));
      return c.json(err.body(), err.status as 400);
    }
    console.error(`[error] ${c.req.method} ${c.req.path}`, err);
    return c.json(new HttpError(500, 'server_error', 'Something went wrong on the server.').body(), 500);
  });

  return app;
}
