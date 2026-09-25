// Workers-compatible. The exact slice of D1Database the app uses - D1 itself, the node:sqlite
// adapter (d1-sqlite.ts) and any other host (e.g. a Durable Object's SQLite storage) implement it.
// Results may be returned sync or async: every call site awaits them.
type Awaitable<T> = T | Promise<T>;

export interface KinwallStatement {
  /** Positional `?` params. */
  bind(...values: unknown[]): KinwallStatement;
  /** First row as an object, or null when there are none. */
  first<T = Record<string, unknown>>(): Awaitable<T | null>;
  /** All rows as objects. */
  all<T = Record<string, unknown>>(): Awaitable<{ results: T[] }>;
  /** Write; `meta.changes` is the affected row count (routes 404 on 0). */
  run(): Awaitable<{ meta: { changes: number } }>;
}

export interface KinwallDb {
  prepare(sql: string): KinwallStatement;
  /** Runs all statements in one transaction (all-or-nothing), in order; one `{ results }` per
   * statement (rows for SELECTs, empty for writes). Statements come from this db's prepare(). */
  batch<T = unknown>(statements: KinwallStatement[]): Awaitable<{ results: T[] }[]>;
}
