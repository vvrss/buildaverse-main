export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

export interface DiffSummary {
  ops: DiffOp[];
  added: number;
  removed: number;
  /** True when the inputs were too large for a line-by-line diff. */
  truncated: boolean;
}

const MAX_CELLS = 4_000_000;

/** Line-based LCS diff, used to preview AI edits before they replace a story. */
export function diffLines(before: string, after: string): DiffSummary {
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');

  // Trim the common prefix and suffix so typical edits stay cheap.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const head: DiffOp[] = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const tail: DiffOp[] = a.slice(endA).map((text) => ({ type: 'same', text }));

  if (midA.length * midB.length > MAX_CELLS) {
    const ops: DiffOp[] = [
      ...head,
      ...midA.map((text): DiffOp => ({ type: 'del', text })),
      ...midB.map((text): DiffOp => ({ type: 'add', text })),
      ...tail,
    ];
    return { ops, added: midB.length, removed: midA.length, truncated: true };
  }

  const n = midA.length;
  const m = midB.length;
  const table = new Uint32Array((n + 1) * (m + 1));
  for (let x = n - 1; x >= 0; x -= 1) {
    for (let y = m - 1; y >= 0; y -= 1) {
      table[x * (m + 1) + y] =
        midA[x] === midB[y]
          ? table[(x + 1) * (m + 1) + y + 1] + 1
          : Math.max(table[(x + 1) * (m + 1) + y], table[x * (m + 1) + y + 1]);
    }
  }

  const mid: DiffOp[] = [];
  let x = 0;
  let y = 0;
  let added = 0;
  let removed = 0;
  while (x < n && y < m) {
    if (midA[x] === midB[y]) {
      mid.push({ type: 'same', text: midA[x] });
      x += 1;
      y += 1;
    } else if (table[(x + 1) * (m + 1) + y] >= table[x * (m + 1) + y + 1]) {
      mid.push({ type: 'del', text: midA[x] });
      x += 1;
      removed += 1;
    } else {
      mid.push({ type: 'add', text: midB[y] });
      y += 1;
      added += 1;
    }
  }
  for (; x < n; x += 1, removed += 1) mid.push({ type: 'del', text: midA[x] });
  for (; y < m; y += 1, added += 1) mid.push({ type: 'add', text: midB[y] });

  return { ops: [...head, ...mid, ...tail], added, removed, truncated: false };
}
