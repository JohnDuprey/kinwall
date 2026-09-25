// node:sqlite -> D1 API subset adapter. Node-only (uses node:sqlite, node:fs, node:path).
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KinwallDb, KinwallStatement } from './db.ts';

type Row = Record<string, unknown>;

// Test-only round-trip counter: each standalone .all/.first/.run call ticks it once, and each
// batch() call ticks it once regardless of how many statements it carries - matching how a real
// D1 request is billed (one network round trip per prepared exec, one per batch).
export type RoundTripCounter = { count: number };

class D1PreparedStatement implements KinwallStatement {
  #db: DatabaseSync;
  #sql: string;
  #params: unknown[];
  #counter?: RoundTripCounter;

  constructor(db: DatabaseSync, sql: string, params: unknown[] = [], counter?: RoundTripCounter) {
    this.#db = db;
    this.#sql = sql;
    this.#params = params;
    this.#counter = counter;
  }

  bind(...params: unknown[]): D1PreparedStatement {
    return new D1PreparedStatement(this.#db, this.#sql, params, this.#counter);
  }

  // Non-counting execution, used internally by batch() so a batched statement isn't also
  // charged as its own round trip.
  rawAll<T = Row>(): { results: T[] } {
    const stmt = this.#db.prepare(this.#sql);
    const results = stmt.all(...(this.#params as never[])) as T[];
    return { results };
  }

  all<T = Row>(): { results: T[] } {
    if (this.#counter) this.#counter.count++;
    return this.rawAll<T>();
  }

  first<T = unknown>(col?: string): T | null {
    if (this.#counter) this.#counter.count++;
    const stmt = this.#db.prepare(this.#sql);
    const row = stmt.get(...(this.#params as never[])) as Row | undefined;
    if (!row) return null;
    return (col ? (row[col] as T) : (row as unknown as T)) ?? null;
  }

  run(): { meta: { changes: number; last_row_id: number | bigint } } {
    if (this.#counter) this.#counter.count++;
    const stmt = this.#db.prepare(this.#sql);
    const info = stmt.run(...(this.#params as never[]));
    return { meta: { changes: Number(info.changes), last_row_id: info.lastInsertRowid } };
  }
}

export class D1Sqlite implements KinwallDb {
  #db: DatabaseSync;
  #counter?: RoundTripCounter;

  constructor(db: DatabaseSync, counter?: RoundTripCounter) {
    this.#db = db;
    this.#counter = counter;
  }

  prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this.#db, sql, [], this.#counter);
  }

  batch<T = unknown>(stmts: D1PreparedStatement[]): { results: T[] }[] {
    if (this.#counter) this.#counter.count++;
    this.#db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.rawAll<T>());
      this.#db.exec('COMMIT');
      return out;
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  // Multi-statement raw exec, for migrations only.
  exec(sql: string): void {
    this.#db.exec(sql);
  }
}

export function openDb(path: string, counter?: RoundTripCounter): D1Sqlite {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  return new D1Sqlite(raw, counter);
}

export function applyMigrations(db: D1Sqlite, dir: string): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT)');
  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all<{ name: string }>().results.map((r) => r.name),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').bind(file, new Date().toISOString()).run();
  }
}
