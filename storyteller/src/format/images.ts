import type { Story } from './types';

/**
 * Pictures in the `.story` format. A picture is never stored in the text:
 * the text holds a code (`img:` plus 16 hex digits, from a hash of the
 * picture) and the picture itself lives on the device, or on the server
 * once published.
 *
 *   ![The lighthouse at dusk](img:3fa94c0d1b2e7a55)   a picture in the story
 *   ana: Ana Reyes  img:9c1d2e3f4a5b6c7d  #e76f51      a character's portrait
 *   cover: img:0a1b2c3d4e5f6a7b                         the story's cover
 */

export const REF_RE = /^[0-9a-f]{16}$/;
/** `img:<ref>` as a whole value. */
export const IMAGE_REF = /^img:([0-9a-f]{16})$/;
/** A picture line: `![caption](img:<ref>)`. The caption may itself contain brackets. */
export const IMAGE_LINE = /^!\[(.*)\]\(img:([0-9a-f]{16})\)\s*$/;
/** A Markdown picture from the web, which the app never loads. */
export const WEB_IMAGE = /^!\[.*\]\((?:https?:|data:|\/\/)[^)]*\)\s*$/i;
/** The end of a cast line's name: `Ana Reyes  img:<ref>`. */
export const PORTRAIT_TAIL = /^(.*?)\s+img:([0-9a-f]{16})$/;

/** Every picture code a story uses: cover, portraits and pictures, each once. */
export function storyRefs(story: Story): string[] {
  const refs = new Set<string>();
  if (story.cover) refs.add(story.cover);
  for (const c of story.characters) if (c.portrait) refs.add(c.portrait);
  for (const b of story.blocks) if (b.kind === 'image') refs.add(b.ref);
  return [...refs];
}

/** Picture codes found anywhere in `.story` text, without parsing it. */
export function textRefs(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/img:([0-9a-f]{16})/g), (m) => m[1]))];
}
