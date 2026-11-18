import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';
import type { KinwallDb } from '../src/db.ts';

// A host that counts rows read (hosted's Durable Object) gets each notification part's count logged,
// so a heavy part can be found; a host that doesn't (node:sqlite) logs nothing.
async function run(counting: boolean): Promise<{ what: string; rows: number }[]> {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  let rows = 0;
  const DB: KinwallDb = counting
    ? { prepare: (sql) => { rows += 150; return db.prepare(sql); }, batch: (s) => db.batch(s as Parameters<typeof db.batch>[0]), get rowsRead() { return rows; } }
    : db;
  const env = { DB, ADMIN_API_KEY: 'test-admin', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const logged: { what: string; rows: number }[] = [];
  const log = console.log;
  console.log = (line: unknown) => { try { const j = JSON.parse(String(line)); if (j.message === 'rows read') logged.push(j); } catch { /* other output */ } };
  try { await runNotifications(env, new Date('2030-03-04T14:01:00Z')); } finally { console.log = log; }
  return logged;
}

test('notification parts log the rows they read when the host counts them', async () => {
  const logged = await run(true);
  const names = logged.map((l) => l.what);
  assert.ok(names.includes('notifications: event reminders'), names.join(', '));
  assert.ok(names.includes('notifications: prune'), names.join(', '));
  assert.ok(logged.every((l) => l.rows >= 100));
});

test('notification parts log nothing when the host does not count rows', async () => {
  assert.deepEqual(await run(false), []);
});
