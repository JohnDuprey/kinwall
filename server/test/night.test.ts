// Night (Settings -> For the whole family -> Night): one schedule (quietFrom / quietTo, the night
// hours) with two effects the family can each turn off: wall screens rest (nightRest) and
// reminders are held (nightHoldReminders). Dark mode can follow the same hours (darkWithNight).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const request = (p: string, method = 'GET', body?: unknown, key = ADMIN_KEY) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  const settings = async () => (await (await request('/api/settings')).json()) as any;
  return { db, request, settings };
}

test('night: a family with quiet hours from before keeps both effects on, so nothing changes', async () => {
  const { db, settings } = setup();
  // Saved by an older version: only the window, no switches.
  db.prepare("INSERT INTO settings (key, value) VALUES ('quietFrom', '22:00'), ('quietTo', '06:00')").run();
  const s = await settings();
  assert.deepEqual([s.quietFrom, s.quietTo, s.nightRest, s.nightHoldReminders, s.darkWithNight], ['22:00', '06:00', true, true, false]);
});

test('night: each effect turns off on its own, is checked, and travels with export and import', async () => {
  const { request, settings } = setup();
  const res = await request('/api/settings', 'PATCH', { quietFrom: '21:30', quietTo: '06:30', nightRest: false, nightHoldReminders: false });
  assert.equal(res.status, 200);
  assert.deepEqual([(await settings()).nightRest, (await settings()).nightHoldReminders], [false, false]);
  assert.equal((await request('/api/settings', 'PATCH', { nightRest: 'no' })).status, 400);

  const wall = ((await (await request('/api/keys', 'POST', { name: 'Kitchen', scope: 'display' })).json()) as any).key;
  assert.equal((await request('/api/settings', 'PATCH', { nightRest: true }, wall)).status, 403, "a wall screen can't wake itself up for good");

  const file = (await (await request('/api/export')).json()) as any;
  const target = setup();
  assert.equal((await target.request('/api/import', 'POST', file)).status, 200);
  const s = await target.settings();
  assert.deepEqual([s.quietFrom, s.nightRest, s.nightHoldReminders], ['21:30', false, false]);
});

test('night: dark mode can use the night hours, falling back to its own when they are off', async () => {
  const { request, settings } = setup();
  await request('/api/settings', 'PATCH', { themeMode: 'scheduled', darkFrom: '20:00', darkTo: '07:00', darkWithNight: true });
  let s = await settings();
  assert.deepEqual([s.darkFrom, s.darkTo], ['20:00', '07:00'], 'no night hours yet: its own');
  await request('/api/settings', 'PATCH', { quietFrom: '21:30', quietTo: '06:15' });
  s = await settings();
  assert.deepEqual([s.darkWithNight, s.darkFrom, s.darkTo], [true, '21:30', '06:15']);
  const appearance = (await (await request('/api/appearance')).json()) as any;
  assert.deepEqual([appearance.darkFrom, appearance.darkTo], ['21:30', '06:15'], 'the pre-pairing screen too');
  await request('/api/settings', 'PATCH', { darkWithNight: false });
  s = await settings();
  assert.deepEqual([s.darkFrom, s.darkTo], ['20:00', '07:00'], 'its own times come back');
});
