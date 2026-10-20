/**
 * Snapshot undo/redo. Stories are immutable values with structural sharing,
 * so a snapshot is just a reference. Pushes with the same `key` within
 * `coalesceMs` merge into one step (for example, typing in Text mode).
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor(
    private readonly limit = 300,
    private readonly coalesceMs = 1200,
  ) {}

  push(previous: T, key?: string): void {
    const now = Date.now();
    if (key && key === this.lastKey && now - this.lastAt < this.coalesceMs) {
      this.lastAt = now;
      this.future = [];
      return;
    }
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.lastKey = key ?? null;
    this.lastAt = now;
  }

  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    this.lastKey = null;
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.lastKey = null;
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
