import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/d1-sqlite.ts';
import { runMigrations, sqlStatements } from '../src/migrate.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const migrations = files.map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));

test('worker runtime migrations: apply every file once, then no-op', async () => {
  const db = openDb(':memory:') as unknown as D1Database;
  await runMigrations(db, migrations);
  const applied = (await db.prepare('SELECT name FROM _migrations ORDER BY name').all<{ name: string }>()).results.map((r) => r.name);
  assert.deepEqual(applied, files);
  await runMigrations(db, migrations); // second run must not re-apply (ALTER TABLE would fail)
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()).results.map((r) => r.name);
  for (const t of ['members', 'events', 'chores', 'api_keys', 'passkeys', 'event_series_member_overrides']) assert.ok(tables.includes(t), t);
});

test('sqlStatements drops comments and empty statements', () => {
  assert.deepEqual(sqlStatements('-- note; with semicolon\nCREATE TABLE a (x);\n\nCREATE TABLE b (y); -- trailing\n'), ['CREATE TABLE a (x)', 'CREATE TABLE b (y)']);
});

test('worker-migrations.ts lists every migration file', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worker-migrations.ts'), 'utf8');
  for (const f of files) assert.ok(src.includes(`name: '${f}'`) && src.includes(`/migrations/${f}'`), `${f} missing from src/worker-migrations.ts`);
});
