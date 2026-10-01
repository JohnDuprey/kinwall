// GET /api/me's householdId (routes/me.ts): one stable id per household, the same for every key, so
// the phone app can tell whether its widgets' key still opens the family it's signed in to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_KEY = 'fc_test_admin_key';

function household() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(__dirname, '..', 'migrations'));
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  return async (p: string, method = 'GET', key = ADMIN_KEY, body?: unknown) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await app.request(p, { method, headers, body: body ? JSON.stringify(body) : undefined }, env);
    return (await res.json()) as any;
  };
}

test('GET /api/me: householdId is stable, the same for a widget key, and differs between households', async () => {
  const req = household();
  const first = (await req('/api/me')).householdId;
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal((await req('/api/me')).householdId, first);
  const widgets = await req('/api/device-keys', 'POST', ADMIN_KEY, { name: 'Widgets on iPhone' });
  assert.equal((await req('/api/me', 'GET', widgets.key)).householdId, first);
  assert.notEqual((await household()('/api/me')).householdId, first);
});
