import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
}

function makeApp(env: Env, defaultKey: string | null = ADMIN_KEY) {
  const app = createApp();
  return (p: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (defaultKey && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${defaultKey}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
}

const login = (anon: ReturnType<typeof makeApp>, code: string, ip = '203.0.113.7') =>
  anon('/api/recovery/login', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify({ code }) });

test('recovery codes: generate, single-use login mints an admin session, regenerate invalidates', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const anon = makeApp(env, null);

  const { codes } = (await (await admin('/api/recovery-codes', { method: 'POST' })).json()) as { codes: string[] };
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

  const status = (await (await admin('/api/recovery-codes')).json()) as any;
  assert.equal(status.total, 8);
  assert.equal(status.remaining, 8);
  assert.ok(status.createdAt);

  // Case and dashes are forgiven.
  const ok = await login(anon, codes[0].toLowerCase().replace(/-/g, ' '));
  assert.equal(ok.status, 200);
  const session = (await ok.json()) as any;
  assert.equal(session.remaining, 7);
  assert.ok(session.expiresAt > new Date().toISOString());
  const reached = await anon('/api/keys', { headers: { Authorization: `Bearer ${session.key}` } });
  assert.equal(reached.status, 200); // admin-only route

  assert.equal((await login(anon, codes[0])).status, 401); // second use
  assert.equal((await login(anon, 'AAAA-BBBB-CCCC')).status, 401); // wrong code
  assert.equal(((await (await admin('/api/recovery-codes')).json()) as any).remaining, 7);

  await admin('/api/recovery-codes', { method: 'POST' });
  assert.equal((await login(anon, codes[1])).status, 401); // old set gone
  assert.equal(((await (await admin('/api/recovery-codes')).json()) as any).remaining, 8);
});

test('recovery login: 10 per hour per address, 30 per hour overall, then 429', async () => {
  const env = makeEnv();
  const anon = makeApp(env, null);
  for (let i = 0; i < 10; i++) assert.equal((await login(anon, 'AAAA-BBBB-CCCC')).status, 401);
  assert.equal((await login(anon, 'AAAA-BBBB-CCCC')).status, 429);
  // Over-cap attempts from the first address didn't burn global tries: 20 more from others fit.
  for (let i = 0; i < 20; i++) assert.equal((await login(anon, 'AAAA-BBBB-CCCC', `198.51.100.${i}`)).status, 401);
  assert.equal((await login(anon, 'AAAA-BBBB-CCCC', '192.0.2.1')).status, 429);
});

test('recovery codes: display keys get 403', async () => {
  const env = makeEnv();
  const { key } = await createApiKey(env.DB, 'wall', 'display');
  const display = makeApp(env, key);
  assert.equal((await display('/api/recovery-codes', { method: 'POST' })).status, 403);
  assert.equal((await display('/api/recovery-codes')).status, 403);
});
