import { useMemo, useState } from 'preact/hooks';
import { extractStoryText, storyForAi } from '../format/ai';
import { type DiffOp, diffLines } from '../format/diff';
import { parseStory } from '../format/parser';
import { serializeStory } from '../format/serializer';
import { go, storyPath } from '../router';
import { replaceFromText, showToast, story, storyId } from '../store/storyStore';
import { IssueList, copyText } from './shared';

/** Collapses long unchanged runs so only edits and a little context show. */
function compact(ops: DiffOp[], context = 2): (DiffOp | { type: 'gap'; count: number })[] {
  const out: (DiffOp | { type: 'gap'; count: number })[] = [];
  const near = (i: number) => ops.slice(Math.max(0, i - context), i + context + 1).some((o) => o.type !== 'same');
  let gap = 0;
  ops.forEach((op, i) => {
    if (op.type === 'same' && !near(i)) {
      gap += 1;
      return;
    }
    if (gap) out.push({ type: 'gap', count: gap });
    gap = 0;
    out.push(op);
  });
  if (gap) out.push({ type: 'gap', count: gap });
  return out;
}

export function AiExchange() {
  const [request, setRequest] = useState('');
  const [reply, setReply] = useState('');
  const current = serializeStory(story.value);

  const preview = useMemo(() => {
    if (!reply.trim()) return null;
    const extracted = extractStoryText(reply);
    const parsed = parseStory(extracted);
    const normalized = serializeStory(parsed.story);
    return { extracted, issues: parsed.issues, diff: diffLines(current, normalized), blocks: parsed.story.blocks.length };
  }, [reply, current]);

  const copy = async () => {
    const ok = await copyText(storyForAi(current, request));
    showToast(ok ? 'Copied. Paste it into your AI chat.' : 'Copy failed');
  };

  const apply = () => {
    if (!preview) return;
    replaceFromText(preview.extracted);
    setReply('');
    showToast('AI edit applied. ↶ to undo.');
    if (storyId.value) go(storyPath(storyId.value));
  };

  const unchanged = preview && preview.diff.added === 0 && preview.diff.removed === 0;

  return (
    <div class="page ai">
      <section>
        <h2>1. Send to an AI</h2>
        <p class="muted small">
          Copies the story in its plain-text format with a short reminder of the rules, so ChatGPT, Claude or any other AI
          answers in the same format.
        </p>
        <input
          type="text"
          placeholder="What should the AI do? e.g. make Tom more sarcastic"
          value={request}
          onInput={(e) => setRequest((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" class="primary" onClick={copy} data-testid="copy-ai">
          Copy for AI
        </button>
      </section>

      <section>
        <h2>2. Paste the reply</h2>
        <textarea
          class="raw short"
          placeholder="Paste the AI's whole answer here. Extra chat text around the story is ignored."
          value={reply}
          onInput={(e) => setReply((e.currentTarget as HTMLTextAreaElement).value)}
          data-testid="ai-reply"
        />
        {preview && (
          <>
            <p class="diff-summary" data-testid="diff-summary">
              {unchanged ? (
                'No changes compared to your story.'
              ) : (
                <>
                  <span class="add">+{preview.diff.added}</span> <span class="del">−{preview.diff.removed}</span> lines ·{' '}
                  {preview.blocks} blocks after applying
                </>
              )}
            </p>
            <IssueList issues={preview.issues} />
            {!unchanged && (
              <pre class="diff">
                {compact(preview.diff.ops).map((op, i) =>
                  op.type === 'gap' ? (
                    <div key={i} class="gap">
                      ⋯ {op.count} unchanged
                    </div>
                  ) : (
                    <div key={i} class={op.type}>
                      {op.type === 'add' ? '+ ' : op.type === 'del' ? '− ' : '  '}
                      {op.text}
                    </div>
                  ),
                )}
              </pre>
            )}
            <div class="actions">
              <button type="button" class="primary" disabled={!!unchanged} onClick={apply} data-testid="apply-ai">
                Apply changes
              </button>
              <button type="button" onClick={() => setReply('')}>
                Discard
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
