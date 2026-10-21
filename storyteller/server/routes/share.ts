import { Hono, type Context } from 'hono';
import type { MediaInfo } from '../../src/shared/api';
import { parseStory } from '../../src/format/parser';
import type { AppEnv } from '../context';
import { HttpError } from '../http/errors';
import { canSeeEpisode, canSeeStory, coverOf, episodeOrder } from '../queries';
import { isId } from '../util';
import { loadEpisode } from './social';
import { loadStory } from './stories';

/**
 * Link previews. A shared link (/s/<story> or /e/<episode>) answers with a
 * tiny page carrying Open Graph tags, so chat apps show the title, a line of
 * the story and the cover, then sends people on to the app's own route.
 * No script runs on it.
 */

const PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The first few lines of an episode as plain text, notes left out. */
export function excerpt(body: string, max = 200): string {
  const { story } = parseStory(body);
  const names = new Map(story.characters.map((ch) => [ch.id, ch.name]));
  const parts: string[] = [];
  for (const b of story.blocks) {
    if (b.kind === 'line') parts.push(`${names.get(b.speaker) ?? b.speaker}: ${b.text}`);
    else if (b.kind === 'narration') parts.push(b.text);
    if (parts.join(' ').length >= max) break;
  }
  return clip(parts.join(' ').replace(/\s+/g, ' ').trim(), max);
}

function originOf(c: Context<AppEnv>) {
  return c.var.deps.config.publicOrigin ?? new URL(c.req.url).origin;
}

function imageUrl(origin: string, m: MediaInfo | null): string | null {
  if (!m) return null;
  const w = m.widths.includes(960) ? 960 : Math.max(...m.widths);
  return `${origin}/media/${m.id}/${w}.webp`;
}

function page(
  c: Context<AppEnv>,
  p: { title: string; description: string; image: string | null; appPath: string; sharePath: string; type: string },
  status: 200 | 404 = 200,
) {
  const origin = originOf(c);
  const title = esc(clip(p.title, 120));
  const description = esc(clip(p.description, 300));
  const target = esc(`/#${p.appPath}`);
  const meta = [
    `<meta property="og:site_name" content="Storyteller">`,
    `<meta property="og:type" content="${p.type}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${esc(origin + p.sharePath)}">`,
    p.image ? `<meta property="og:image" content="${esc(p.image)}">` : '',
    `<meta name="twitter:card" content="${p.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="description" content="${description}">`,
  ]
    .filter(Boolean)
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Storyteller</title>
${meta}
<link rel="canonical" href="${esc(origin + p.sharePath)}">
<meta http-equiv="refresh" content="0; url=${target}">
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#faf8f5;color:#1d1a24}a{color:#5b3df5}</style>
</head>
<body><p><a href="${target}">Open “${title}” in Storyteller</a></p></body>
</html>`;
  c.header('Content-Security-Policy', PAGE_CSP);
  c.header('Cache-Control', 'public, max-age=300');
  return c.html(html, status);
}

function missing(c: Context<AppEnv>, sharePath: string) {
  return page(
    c,
    { title: 'Storyteller', description: 'Stories told in dialog.', image: null, appPath: '/c', sharePath, type: 'website' },
    404,
  );
}

export function shareRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/s/:id', (c) => {
    const deps = c.var.deps;
    const id = c.req.param('id');
    try {
      if (!isId(id)) throw new HttpError(404, 'not_found', '');
      const s = loadStory(deps, id);
      if (!canSeeStory(deps.db, s, null)) throw new HttpError(404, 'not_found', '');
      const author = deps.db.get<{ display_name: string }>('SELECT display_name FROM users WHERE id = ?', s.author_id)!;
      return page(c, {
        title: s.title,
        description: s.description || `A story by ${author.display_name}.`,
        image: imageUrl(originOf(c), coverOf(deps.db, s.author_id, s.cover_ref)),
        appPath: `/c/s/${s.id}`,
        sharePath: `/s/${s.id}`,
        type: 'book',
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return missing(c, `/s/${encodeURIComponent(id)}`);
      throw err;
    }
  });

  app.get('/e/:id', (c) => {
    const deps = c.var.deps;
    const id = c.req.param('id');
    try {
      if (!isId(id)) throw new HttpError(404, 'not_found', '');
      const { episode, story } = loadEpisode(deps, id);
      if (!canSeeEpisode(deps.db, story, episode, null)) throw new HttpError(404, 'not_found', '');
      const number = episodeOrder(deps.db, story, null).find((e) => e.id === episode.id)?.number ?? 0;
      const cover = coverOf(deps.db, story.author_id, episode.cover_ref) ?? coverOf(deps.db, story.author_id, story.cover_ref);
      return page(c, {
        title: `${story.title} · ${number ? `#${number} ` : ''}${episode.title}`,
        description: excerpt(episode.body) || story.description,
        image: imageUrl(originOf(c), cover),
        appPath: `/c/e/${episode.id}`,
        sharePath: `/e/${episode.id}`,
        type: 'article',
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return missing(c, `/e/${encodeURIComponent(id)}`);
      throw err;
    }
  });

  return app;
}
