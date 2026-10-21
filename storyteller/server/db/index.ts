import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

/**
 * A thin layer over node:sqlite: cached prepared statements, a transaction
 * helper and schema migrations. node:sqlite is synchronous, which keeps
 * request handling simple; image processing runs outside transactions.
 */
export class Db {
  readonly raw: DatabaseSync;
  private statements = new Map<string, StatementSync>();

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA synchronous = NORMAL');
    this.migrate();
  }

  private migrate() {
    const current = Number((this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    for (let v = current; v < MIGRATIONS.length; v += 1) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  private depth = 0;

  /** Runs `fn` in a transaction (nested calls join the outer one). `fn` must be synchronous. */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth += 1;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth -= 1;
    }
  }

  close() {
    this.raw.close();
  }
}
