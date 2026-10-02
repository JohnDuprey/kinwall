import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const FRIENDLY = 'Something went wrong. Please try again.';
const SCARY = 'SQLITE_ERROR: no such table: secret_table_name (SELECT * FROM api_keys)';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (p: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
  return { env, request };
}

async function withLog<T>(fn: () => T | Promise<T>): Promise<{ result: T; logged: string[] }> {
  const real = console.error;
  const logged: string[] = [];
  console.error = (...a: unknown[]) => { logged.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(' ')); };
  try { return { result: await fn(), logged }; } finally { console.error = real; }
}

test('an unexpected throw is a calm 500 with a reference; the real error is only in the log', async () => {
  const { env, request } = setup();
  const real = env.DB.prepare.bind(env.DB);
  (env.DB as { prepare: unknown }).prepare = (sql: string) => { if (/FROM members/i.test(sql)) throw new Error(SCARY); return real(sql); };
  const { result: res, logged } = await withLog(() => request('/api/members'));
  assert.equal(res.status, 500);
  const text = await res.clone().text();
  const body = (await res.json()) as { error: string; ref: string };
  assert.equal(body.error, FRIENDLY);
  assert.match(body.ref, /^[a-z0-9]{8}$/);
  assert.ok(!text.includes('secret_table_name') && !text.includes('SQLITE') && !text.includes('api_keys'));
  const line = logged.join('\n');
  assert.ok(line.includes(SCARY), 'the log has the real error');
  assert.ok(line.includes(body.ref), 'the log carries the reference');
});

test('malformed JSON still gets its own 400', async () => {
  const { request } = setup();
  const { result: res } = await withLog(() => request('/api/members', { method: 'POST', body: '{nope' }));
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.notEqual(body.error, FRIENDLY);
  assert.match(body.error, /JSON/);
});

test('a too-large body still gets its 413 message', async () => {
  const { request } = setup();
  const { result: res } = await withLog(() => request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(3 * 1024 * 1024) }) }));
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { error: string }).error, 'Request body is larger than 2 MB');
});

test('a deliberate 4xx message is unchanged', async () => {
  const { request } = setup();
  const res = await request('/api/members', { method: 'POST', body: JSON.stringify({ name: '' }) });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /^name: /);
});

test('a missing encryption key is still explained to the parent (operator guidance, no internals)', async () => {
  const { env, request } = setup();
  delete (env as { ENCRYPTION_KEY?: string }).ENCRYPTION_KEY;
  const { result: res } = await withLog(() => request('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/hook', events: [] }) }));
  assert.equal(res.status, 500);
  assert.match(((await res.json()) as { error: string }).error, /ENCRYPTION_KEY/);
});
