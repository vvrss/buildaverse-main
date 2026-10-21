/**
 * Helpers for the "Copy for AI" / "Paste from AI" round trip. The story goes
 * out inside a fenced block with a short reminder of the rules, and anything
 * pasted back is unwrapped from fences and chatty preambles before parsing.
 */

export const AI_PREAMBLE = `This is a story in the ".story" format. Keep the format exactly:
- Header between --- lines: title, and characters as "id: Display Name #color".
- Dialog: "@id: text" or "@id (stage direction): text". Only use ids from the header, or add new ones there.
- Narration: "> text". Chapter/scene heading: "# text". Author note: "// text".
- A line indented by two spaces continues the line above it.
Reply with the complete story in one \`\`\`story code block, and nothing outside it.`;

export function storyForAi(storyText: string, request = ''): string {
  const ask = request.trim() ? `\n\nWhat I want: ${request.trim()}` : '';
  return `${AI_PREAMBLE}${ask}\n\n\`\`\`story\n${storyText.trimEnd()}\n\`\`\`\n`;
}

/** Pulls the story text out of an AI reply (fenced block, or from the first "---"). */
export function extractStoryText(raw: string): string {
  const text = raw.replace(/\r\n?/g, '\n');
  // Fences of ``` or ~~~ (three or more), with any info string ("story", " story", none),
  // indented by up to 3 spaces as AIs do under a list item; the body loses that indent.
  const fences = [...text.matchAll(/^( {0,3})(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\2[`~]*[ \t]*$/gm)].map((m) =>
    m[1] ? m[3].replace(new RegExp(`^ {0,${m[1].length}}`, 'gm'), '') : m[3],
  );
  if (fences.length > 0) {
    const scored = fences
      .map((body) => ({ body, score: (body.match(/^\s*(@|>|#|---)/gm) ?? []).length }))
      .sort((x, y) => y.score - x.score || y.body.length - x.body.length);
    return scored[0].body;
  }
  const lines = text.split('\n');
  const headerAt = lines.findIndex((l) => l.trim() === '---');
  if (headerAt > 0) {
    // An unclosed fence after the story ends it; drop the chat that follows.
    const rest = lines.slice(headerAt);
    const end = rest.findIndex((l, i) => i > 0 && /^\s*(`{3,}|~{3,})\s*$/.test(l));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
  }
  return text;
}
