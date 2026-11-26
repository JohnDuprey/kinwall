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

test('recipe types migration adds an empty column without rebuilding or changing existing family rows', async () => {
  const db = openDb(':memory:');
  await runMigrations(db, migrations.filter(m => m.name < '0160'));
  await db.prepare("INSERT INTO recipes (id,name,kind,default_servings,created_at,updated_at) VALUES ('main','Soup','meal',4,'2026-11-25','2026-11-25'),('basic','Dough','basic',4,'2026-11-25','2026-11-25')").run();
  await db.prepare("INSERT INTO recipe_ingredients (id,recipe_id,name,normalized_name) VALUES ('ingredient','main','Dough','dough')").run();
  const before = await db.prepare('SELECT * FROM recipes ORDER BY id').all();
  const migration = migrations.find(m => m.name === '0160_recipe_types.sql')!;
  assert.deepEqual(sqlStatements(migration.sql), ["ALTER TABLE recipes ADD COLUMN course TEXT CHECK(course IN ('side','dessert'))"]);
  await runMigrations(db, migrations);
  const after = await db.prepare('SELECT * FROM recipes ORDER BY id').all<Record<string, unknown>>();
  assert.deepEqual(after.results.map(({ course, ...recipe }) => { assert.equal(course, null); return recipe; }), before.results.map(recipe => ({ ...recipe })));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM recipe_ingredients').first<{ n: number }>())!.n, 1);
  assert.throws(() => db.prepare("UPDATE recipes SET course = 'other'").run(), /CHECK constraint/);
});

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

test('sqlStatements drops comments from CRLF files too', () => {
  assert.deepEqual(sqlStatements('-- note; with semicolon\r\nCREATE TABLE a (x); -- trailing; too\r\n'), ['CREATE TABLE a (x)']);
});

test('worker-migrations.ts lists every migration file', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worker-migrations.ts'), 'utf8');
  for (const f of files) assert.ok(src.includes(`name: '${f}'`) && src.includes(`/migrations/${f}'`), `${f} missing from src/worker-migrations.ts`);
});

test('sqlStatements keeps a trigger body in one statement', () => {
  assert.deepEqual(sqlStatements('CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE b SET n = n + 1;\nEND;\nCREATE INDEX i ON a(x);'), [
    'CREATE TRIGGER t AFTER INSERT ON a BEGIN\n  UPDATE b SET n = n + 1;\nEND',
    'CREATE INDEX i ON a(x)',
  ]);
});
