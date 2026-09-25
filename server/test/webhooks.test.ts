import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { isSafeWebhookUrl } from '../src/bus.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  return (p: string, init: RequestInit = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env);
}

test('webhooks: private/loopback targets are refused on create and update; public ones are accepted', async () => {
  const request = makeApp();
  const create = (url: string) => request('/api/webhooks', { method: 'POST', body: JSON.stringify({ url, events: [] }) });

  const bad = await create('http://169.254.169.254/latest/meta-data');
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as any).error, /public https\/http address/);

  const ok = await create('https://hooks.example.com/kinwall');
  assert.equal(ok.status, 201);
  const { id } = (await ok.json()) as any;
  assert.equal((await request(`/api/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify({ url: 'http://localhost:8123/api/webhook' }) })).status, 400);
});

test('isSafeWebhookUrl', () => {
  for (const url of [
    'ftp://example.com/', 'http://localhost/', 'http://ha.localhost/', 'http://homeassistant.local/', 'http://svc.internal/',
    'http://127.0.0.1/', 'http://2130706433/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://192.168.1.10:8123/',
    'http://0.0.0.0/', 'http://224.0.0.1/', 'http://100.64.0.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/', 'not a url',
  ]) assert.equal(isSafeWebhookUrl(url), false, url);
  for (const url of ['https://example.com/hook', 'http://8.8.8.8/', 'http://172.32.0.1/', 'http://[2001:db8::1]/'])
    assert.equal(isSafeWebhookUrl(url), true, url);
});
