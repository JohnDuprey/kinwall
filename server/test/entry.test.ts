import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/d1-sqlite.ts';
import { createKinwall } from '../src/entry.ts';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));

const ADMIN_KEY = 'kw_test_admin_key';

test('createKinwall: lazy migrations, public + authed fetch, scheduled tick', async () => {
  // Fresh, unmigrated DB: the first call must migrate it (the Worker / embedded path).
  const kinwall = createKinwall(
    { DB: openDb(':memory:'), ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    { migrations },
  );

  const health = await kinwall.fetch(new Request('http://x/api/health'));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  assert.equal((await kinwall.fetch(new Request('http://x/api/members'))).status, 401);
  const members = await kinwall.fetch(new Request('http://x/api/members', { headers: { Authorization: `Bearer ${ADMIN_KEY}` } }));
  assert.equal(members.status, 200);
  assert.deepEqual(await members.json(), []);

  // No assets binding: non-API paths are a plain 404, not a crash.
  assert.equal((await kinwall.fetch(new Request('http://x/some/page'))).status, 404);

  await kinwall.scheduled(new Date());
});

// A Durable Object per family runs this tick from its alarm: a part that throws must not fail the
// alarm (and so have it re-run) or stop the parts after it.
test('createKinwall: a failing part of the scheduled tick is logged and the rest still run', async () => {
  const db = openDb(':memory:');
  const kinwall = createKinwall({ DB: db, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, { migrations });
  await kinwall.scheduled(new Date()); // migrates
  await db.prepare("INSERT INTO sent_notifications (key, sent_at) VALUES ('old', '2020-01-01T00:00:00.000Z')").run();
  await db.prepare("DELETE FROM settings WHERE key = 'notifyLastTick'").run();
  // Event reminders, the reconnect note and calendar sync all read calendars first: make that read fail.
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    if (/FROM calendars WHERE/.test(sql)) throw new Error('disk I/O error');
    return prepare(sql);
  }) as typeof db.prepare;
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.join(' ')); };
  try {
    await kinwall.scheduled(new Date()); // resolves
  } finally {
    console.error = realError;
  }
  assert.deepEqual(logged.sort(), ['calendar reconnect skipped: Error', 'calendar sync tick failed: Error', 'event reminders skipped: Error']);
  assert.equal(await db.prepare("SELECT 1 FROM sent_notifications WHERE key = 'old'").first(), null, 'the prune after it ran');
  assert.ok(await db.prepare("SELECT 1 FROM settings WHERE key = 'notifyLastTick'").first(), 'and the window moved (event reminders keep their own lookback)');
});
