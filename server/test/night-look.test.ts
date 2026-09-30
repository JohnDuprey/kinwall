// The family's Night screen default (settings.nightLook): what wall screens show during quiet
// hours unless a screen picks its own. Checked like any setting, and carried by export / import.
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
  return { request };
}

const look = { sources: ['google', 'drawings'], every: 10, brightness: 'medium', clock: false, clockPosition: 'top-left' };

test('nightLook: the plain clock by default, a PATCH round-trips, bad values are refused', async () => {
  const { request } = setup();
  const get = async () => ((await (await request('/api/settings')).json()) as any).nightLook;
  assert.deepEqual(await get(), { sources: [], every: 5, brightness: 'low', clock: true, clockPosition: null });

  const res = await request('/api/settings', 'PATCH', { nightLook: look });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as any).nightLook, look);
  assert.deepEqual(await get(), look);

  const bad = (patch: object) => request('/api/settings', 'PATCH', { nightLook: { ...look, ...patch } });
  assert.equal((await bad({ sources: ['movies'] })).status, 400, 'an unknown source');
  assert.equal((await bad({ sources: ['art', 'art'] })).status, 400, 'a source twice');
  assert.equal((await bad({ every: 7 })).status, 400, 'an interval the app does not offer');
  assert.equal((await bad({ brightness: 'high' })).status, 400);
  assert.equal((await bad({ clockPosition: 'middle' })).status, 400);
  assert.deepEqual(await get(), look, 'nothing changed');
});

test('nightLook: a wall screen reads it but cannot change it', async () => {
  const { request } = setup();
  const wall = ((await (await request('/api/keys', 'POST', { name: 'Kitchen', scope: 'display' })).json()) as any).key;
  assert.equal((await request('/api/settings', 'PATCH', { nightLook: look }, wall)).status, 403);
  assert.equal(((await (await request('/api/settings', 'GET', undefined, wall)).json()) as any).nightLook.clock, true);
});

test('nightLook: travels with export and import; the remote Night screen state does not collide', async () => {
  const source = setup();
  await source.request('/api/settings', 'PATCH', { nightLook: look });
  await source.request('/api/displays/night-screen', 'POST', { on: true });
  const file = (await (await source.request('/api/export')).json()) as any;
  assert.deepEqual(file.settings.nightLook, look);

  const target = setup();
  assert.equal((await target.request('/api/import', 'POST', file)).status, 200);
  assert.deepEqual(((await (await target.request('/api/settings')).json()) as any).nightLook, look);
});
