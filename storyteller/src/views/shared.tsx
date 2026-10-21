import type { ParseIssue } from '../format/types';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function IssueList({ issues, onPick }: { issues: ParseIssue[]; onPick?: (line: number) => void }) {
  if (issues.length === 0) return null;
  return (
    <ul class="issues" data-testid="issues">
      {issues.slice(0, 50).map((i, n) => (
        <li key={n} class={i.severity}>
          <button type="button" class="ghost" onClick={() => onPick?.(i.line)}>
            Line {i.line}
          </button>{' '}
          {i.message}
        </li>
      ))}
      {issues.length > 50 && <li class="muted">…and {issues.length - 50} more</li>}
    </ul>
  );
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString();
}
