// Family Board presets (settings.boardPresets): parents save layouts that every screen can pick.
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

const hallway = {
  id: 'p_hallway', name: 'Hallway',
  layout: { tiles: true, columns: [[{ id: 'clock', size: 's', density: 'big' }, { id: 'today', size: 'l', density: 'normal' }], [{ id: 'coming', size: 'm', density: 'small' }]] },
};

test('board presets: none by default, a PATCH round-trips, bad ones are refused, a wall screen cannot change them', async () => {
  const { request } = setup();
  assert.deepEqual(((await (await request('/api/settings')).json()) as any).boardPresets, []);

  const res = await request('/api/settings', 'PATCH', { boardPresets: [hallway] });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as any).boardPresets, [hallway]);
  assert.deepEqual(((await (await request('/api/settings')).json()) as any).boardPresets, [hallway]);

  const bad = (p: unknown) => request('/api/settings', 'PATCH', { boardPresets: [p] });
  assert.equal((await bad({ ...hallway, layout: { ...hallway.layout, columns: [[{ id: 'nope', size: 's', density: 'big' }]] } })).status, 400, 'an unknown card');
  assert.equal((await bad({ ...hallway, layout: { tiles: true, columns: [[], [], [], [], []] } })).status, 400, 'five columns');
  assert.equal((await bad({ ...hallway, layout: { tiles: true, columns: [[hallway.layout.columns[0][0]], [hallway.layout.columns[0][0]]] } })).status, 400, 'a card twice');
  assert.equal((await bad({ ...hallway, name: '' })).status, 400, 'no name');
  assert.equal((await bad({ ...hallway, layout: { tiles: true, columns: [[{ id: 'checklist', size: 's', density: 'big', listId: '' }]] } })).status, 400, 'an empty list id');
  assert.equal((await request('/api/settings', 'PATCH', { boardPresets: [hallway, hallway] })).status, 400, 'the same id twice');

  const wall = ((await (await request('/api/keys', 'POST', { name: 'Kitchen', scope: 'display' })).json()) as any).key;
  assert.equal((await request('/api/settings', 'PATCH', { boardPresets: [] }, wall)).status, 403);
  assert.deepEqual(((await (await request('/api/settings', 'GET', undefined, wall)).json()) as any).boardPresets, [hallway], 'a wall screen reads them to pick one');
});

test('board presets: the Checklist card keeps the list it shows', async () => {
  const { request } = setup();
  const bedtime = { id: 'p_bedtime', name: 'Bedtime', layout: { tiles: false, columns: [[{ id: 'checklist', size: 'l', density: 'big', listId: 'l6' }, { id: 'clock', size: 's', density: 'normal' }]] } };
  const res = await request('/api/settings', 'PATCH', { boardPresets: [bedtime] });
  assert.equal(res.status, 200);
  assert.deepEqual(((await (await request('/api/settings')).json()) as any).boardPresets, [bedtime]);
});
