// node:sqlite -> D1 API subset adapter. Node-only (uses node:sqlite, node:fs, node:path).
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, unknown>;

class D1PreparedStatement {
  #db: DatabaseSync;
  #sql: string;
  #params: unknown[];

  constructor(db: DatabaseSync, sql: string, params: unknown[] = []) {
    this.#db = db;
    this.#sql = sql;
    this.#params = params;
  }

  bind(...params: unknown[]): D1PreparedStatement {
    return new D1PreparedStatement(this.#db, this.#sql, params);
  }

  all<T = Row>(): { results: T[] } {
    const stmt = this.#db.prepare(this.#sql);
    const results = stmt.all(...(this.#params as never[])) as T[];
    return { results };
  }

  first<T = unknown>(col?: string): T | null {
    const stmt = this.#db.prepare(this.#sql);
    const row = stmt.get(...(this.#params as never[])) as Row | undefined;
    if (!row) return null;
    return (col ? (row[col] as T) : (row as unknown as T)) ?? null;
  }

  run(): { meta: { changes: number; last_row_id: number | bigint } } {
    const stmt = this.#db.prepare(this.#sql);
    const info = stmt.run(...(this.#params as never[]));
    return { meta: { changes: Number(info.changes), last_row_id: info.lastInsertRowid } };
  }
}

export class D1Sqlite {
  #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this.#db, sql);
  }

  batch<T = unknown>(stmts: D1PreparedStatement[]): { results: T[] }[] {
    this.#db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.all<T>());
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

export function openDb(path: string): D1Sqlite {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  return new D1Sqlite(raw);
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
