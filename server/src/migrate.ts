// Applies server/migrations/*.sql on Workers at runtime (first request / cron in each isolate),
// tracked in the same _migrations table the Node entry uses, so git-connected Cloudflare builds
// need no separate `wrangler d1 migrations apply` step. Workers-compatible (no fs).

import type { KinwallDb } from './db.ts';

export type Migration = { name: string; sql: string };

/** Splits a migration file into statements. Migrations are plain DDL/DML (no string literals
 * containing ';'), so dropping `--` comments and splitting on ';' is enough, except inside a
 * trigger's BEGIN ... END, which is kept whole. */
export function sqlStatements(sql: string): string[] {
  const out: string[] = [];
  for (const part of sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n').split(';')) {
    const s = part.trim();
    if (!s) continue;
    const last = out.at(-1);
    if (last && /^CREATE\s+TRIGGER\b/i.test(last) && !/\bEND$/i.test(last)) out[out.length - 1] = `${last};\n${s}`;
    else out.push(s);
  }
  return out;
}

export async function runMigrations(db: KinwallDb, migrations: Migration[]): Promise<void> {
  // One round trip for the steady-state case (table already exists, nothing new to apply),
  // which is what every isolate after the first hits.
  const [, existing] = await db.batch<{ name: string }>([
    db.prepare('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT)'),
    db.prepare('SELECT name FROM _migrations'),
  ]);
  const applied = new Set(existing.results.map((r) => r.name));
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(m.name)) continue;
    // One atomic batch per file: its statements plus the bookkeeping row.
    await db.batch([
      ...sqlStatements(m.sql).map((s) => db.prepare(s)),
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').bind(m.name, new Date().toISOString()),
    ]);
  }
}
