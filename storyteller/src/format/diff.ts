export type DiffOp = { type: 'same' | 'add' | 'del'; text: string };

export interface DiffSummary {
  ops: DiffOp[];
  added: number;
  removed: number;
  /** True when the two texts differed too much for a line-by-line comparison. */
  truncated: boolean;
}

/** Edit-distance budget: beyond this many changed lines the diff gives up. */
const MAX_EDITS = 1500;

/**
 * Line-based diff (Myers' O(ND) algorithm), used to preview AI edits before
 * they replace a story. It stays fast for long stories with few changes,
 * which is the normal case for an AI edit.
 */
export function diffLines(before: string, after: string): DiffSummary {
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');

  // Trim the common prefix and suffix first.
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

  const mid = myers(midA, midB);
  if (!mid) {
    const ops: DiffOp[] = [
      ...head,
      ...midA.map((text): DiffOp => ({ type: 'del', text })),
      ...midB.map((text): DiffOp => ({ type: 'add', text })),
      ...tail,
    ];
    return { ops, added: midB.length, removed: midA.length, truncated: true };
  }
  const added = mid.filter((o) => o.type === 'add').length;
  const removed = mid.filter((o) => o.type === 'del').length;
  return { ops: [...head, ...mid, ...tail], added, removed, truncated: false };
}

/** Shortest edit script between two line arrays, or null past the edit budget. */
function myers(a: string[], b: string[]): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ type: 'add', text }));
  if (m === 0) return a.map((text) => ({ type: 'del', text }));
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    // Round d only reads diagonals -d-1..d+1, so that window is all backtracking needs.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    const next = v;
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && next[offset + k - 1] < next[offset + k + 1])
          ? next[offset + k + 1]
          : next[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
    v = next;
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], dEnd: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d > 0; d -= 1) {
    const w = trace[d];
    const v = (k: number) => w[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && v(k - 1) < v(k + 1)) ? k + 1 : k - 1;
    const prevX = v(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'same', text: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (x === prevX) {
      ops.push({ type: 'add', text: b[y - 1] });
      y -= 1;
    } else {
      ops.push({ type: 'del', text: a[x - 1] });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ type: 'same', text: a[x - 1] });
    x -= 1;
    y -= 1;
  }
  return ops.reverse();
}
