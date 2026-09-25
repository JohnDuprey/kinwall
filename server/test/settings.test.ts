import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeRequest() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  return (body?: unknown) => app.request('/api/settings', body === undefined ? { headers: { Authorization: `Bearer ${ADMIN_KEY}` } } : {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env);
}

test('settings: quiet hours default off, set together, clear together', async () => {
  const req = makeRequest();
  let s = await (await req()).json() as any;
  assert.equal(s.quietFrom, null);
  assert.equal(s.quietTo, null);

  const set = await req({ quietFrom: '22:00', quietTo: '06:30' });
  assert.equal(set.status, 200);
  s = await set.json();
  assert.equal(s.quietFrom, '22:00');
  assert.equal(s.quietTo, '06:30');

  for (const clear of [{ quietFrom: null, quietTo: null }, { quietFrom: '', quietTo: '' }]) {
    await req({ quietFrom: '22:00', quietTo: '06:30' });
    s = await (await req(clear)).json();
    assert.equal(s.quietFrom, null);
    assert.equal(s.quietTo, null);
  }
});

test('settings: quiet hours reject bad times and half-set pairs', async () => {
  const req = makeRequest();
  for (const bad of [
    { quietFrom: '25:00', quietTo: '06:00' },
    { quietFrom: '10pm', quietTo: '06:00' },
    { quietFrom: '22:00' },
    { quietFrom: '22:00', quietTo: null },
  ]) assert.equal((await req(bad)).status, 400, JSON.stringify(bad));
  // Unrelated patches don't need the pair.
  assert.equal((await req({ familyName: 'X' })).status, 200);
});
