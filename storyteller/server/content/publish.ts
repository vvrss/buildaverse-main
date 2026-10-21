import { storyRefs } from '../../src/format/images';
import { parseStory } from '../../src/format/parser';
import { serializeStory } from '../../src/format/serializer';
import { HttpError } from '../http/errors';
import { cleanText, wordCount } from '../util';

export const MAX_EPISODE_CHARS = 400_000;
const MAX_BLOCKS = 10_000;

export interface Prepared {
  /** The episode as published: normalized `.story` text without notes or private header keys. */
  body: string;
  /** Picture codes the episode uses (pictures, portraits, cover in its header). */
  refs: string[];
  words: number;
}

/**
 * Turns an author's `.story` text into what readers get. Notes (`//`) and
 * any header keys other than the title, cover and cast never leave the
 * author's device; text is cleaned of control and direction-override
 * characters. The result is re-serialized, so readers always get valid text.
 */
export function preparePublish(text: string): Prepared {
  if (text.length > MAX_EPISODE_CHARS) {
    throw new HttpError(413, 'episode_too_long', 'An episode can be at most 400,000 characters. Split it into two.');
  }
  const { story, issues } = parseStory(text);
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    throw new HttpError(422, 'bad_story', 'The episode text has problems to fix first.', {
      issues: errors.map(({ line, message }) => ({ line, message })),
    });
  }
  story.meta = [];
  story.title = cleanText(story.title).slice(0, 120) || 'Untitled';
  story.characters = story.characters.map((c) => ({ ...c, name: cleanText(c.name).slice(0, 60) || c.id }));
  story.blocks = story.blocks
    .filter((b) => b.kind !== 'note')
    .map((b) => {
      const clean = cleanText(b.text, { multiline: b.kind !== 'heading' && b.kind !== 'image' });
      return b.kind === 'line' && b.direction ? { ...b, text: clean, direction: cleanText(b.direction).slice(0, 80) } : { ...b, text: clean };
    })
    .filter((b) => b.kind === 'image' || b.text.length > 0 || (b.kind === 'line' && !!b.direction));
  if (story.blocks.length === 0) throw new HttpError(422, 'empty_episode', 'There is nothing to publish yet.');
  if (story.blocks.length > MAX_BLOCKS) throw new HttpError(413, 'episode_too_long', 'An episode can have at most 10,000 lines.');
  return {
    body: serializeStory(story),
    refs: storyRefs(story),
    words: story.blocks.reduce((n, b) => n + wordCount(b.text), 0),
  };
}
