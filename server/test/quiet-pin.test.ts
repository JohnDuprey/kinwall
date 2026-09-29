// PIN to wake the quiet-hours night screen: set from a parent's own device, stored only as a salted
// PBKDF2 hash, checked by POST /api/quiet-pin/verify (wall screens may call it), rate-limited per key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'qp_test_admin';
const PIN = '86420135'; // distinctive: must never show up in the database, a response or the logs

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const req = async (method: string, p: string, body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env);
    const text = await res.text();
    return { status: res.status, text, body: text ? JSON.parse(text) : null };
  };
  const display = async (name = 'Hallway') => (await req('POST', '/api/keys', { name, scope: 'display' })).body.key as string;
  const dump = () => JSON.stringify(db.prepare('SELECT key, value FROM settings').all().results);
  return { req, display, dump };
}

test('quiet pin: a parent sets it; only a salted hash is stored, and settings say just true/false', async () => {
  const { req, dump } = setup();
  assert.equal((await req('GET', '/api/settings')).body.quietPin, false, 'off by default');
  const set = await req('PUT', '/api/quiet-pin', { pin: PIN });
  assert.equal(set.status, 200);
  assert.equal(set.text.includes(PIN), false);
  const settings = await req('GET', '/api/settings');
  assert.equal(settings.body.quietPin, true);
  assert.equal(settings.text.includes('pbkdf2'), false, 'the hash never leaves the server');
  assert.equal(dump().includes(PIN), false, 'no plaintext in the database');
  assert.match(dump(), /pbkdf2-sha256\$/);
  // Same PIN, new salt: two families (or two sets) never share a hash.
  const first = dump();
  await req('PUT', '/api/quiet-pin', { pin: PIN });
  assert.notEqual(dump(), first);
  // The export says only that there is one.
  const exported = await req('GET', '/api/export');
  assert.equal(exported.text.includes('pbkdf2'), false);
  assert.equal(exported.text.includes(PIN), false);
});

test('quiet pin: 4 to 8 digits only', async () => {
  const { req } = setup();
  for (const pin of ['123', '123456789', '12a4', '', ' 1234']) assert.equal((await req('PUT', '/api/quiet-pin', { pin })).status, 400, pin);
  assert.equal((await req('PUT', '/api/quiet-pin', { pin: '1234' })).status, 200);
});

test('quiet pin: a wall screen verifies it; a wrong one is refused', async () => {
  const { req, display } = setup();
  const wall = await display();
  assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: '0000' }, wall)).body, { ok: true }, 'no PIN set: nothing to check');
  await req('PUT', '/api/quiet-pin', { pin: PIN });
  assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: PIN }, wall)).body, { ok: true });
  assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: '12345678' }, wall)).body, { ok: false });
  assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: PIN.slice(0, 4) }, wall)).body, { ok: false });
  // Removed (the forgotten-PIN path, from any parent device): nothing to check again.
  assert.equal((await req('DELETE', '/api/quiet-pin')).status, 200);
  assert.equal((await req('GET', '/api/settings')).body.quietPin, false);
  assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: '0000' }, wall)).body, { ok: true });
});

test('quiet pin: wall screens and connected apps cannot set or remove it', async () => {
  const { req, display } = setup();
  const wall = await display();
  assert.equal((await req('PUT', '/api/quiet-pin', { pin: '1234' }, wall)).status, 403);
  assert.equal((await req('DELETE', '/api/quiet-pin', undefined, wall)).status, 403);
  const app = { 'X-Kinwall-Source': 'mcp' };
  assert.equal((await req('PUT', '/api/quiet-pin', { pin: '1234' }, ADMIN, app)).status, 403);
  assert.equal((await req('DELETE', '/api/quiet-pin', undefined, ADMIN, app)).status, 403);
  assert.equal((await req('POST', '/api/quiet-pin/verify', { pin: '1234' }, ADMIN, app)).status, 403, 'nor guess it');
  assert.equal((await req('GET', '/api/settings')).body.quietPin, false);
  // Nor slip it in through the settings PATCH or an import.
  await req('PATCH', '/api/settings', { quietPin: true, quietPinHash: 'x' });
  assert.equal((await req('GET', '/api/settings')).body.quietPin, false);
});

test('quiet pin: guesses are rate-limited per key; a new PIN clears the wait', async () => {
  const { req, display } = setup();
  const wall = await display(), other = await display('Kitchen');
  await req('PUT', '/api/quiet-pin', { pin: PIN });
  for (let i = 0; i < 12; i++) assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: PIN }, wall)).body, { ok: true }, 'waking it often is fine');
  for (let i = 0; i < 10; i++) assert.equal((await req('POST', '/api/quiet-pin/verify', { pin: '1111' }, wall)).status, 200, `try ${i + 1}`);
  const blocked = await req('POST', '/api/quiet-pin/verify', { pin: PIN }, wall);
  assert.equal(blocked.status, 429, 'even the right PIN waits');
  assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: PIN }, other)).body, { ok: true }, 'another screen is not held up');
  await req('PUT', '/api/quiet-pin', { pin: '2468' });
  assert.deepEqual((await req('POST', '/api/quiet-pin/verify', { pin: '2468' }, wall)).body, { ok: true });
});

test('quiet pin: the PIN never reaches the logs', async () => {
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const { req, display } = setup();
    const wall = await display();
    await req('PUT', '/api/quiet-pin', { pin: PIN });
    await req('PUT', '/api/quiet-pin', { pin: `${PIN}9` }); // 400
    await req('PUT', '/api/quiet-pin', { pin: PIN }, wall); // 403
    await req('POST', '/api/quiet-pin/verify', { pin: PIN }, wall);
    await req('POST', '/api/quiet-pin/verify', { pin: `x${PIN}` }, wall); // 400
    for (let i = 0; i < 11; i++) await req('POST', '/api/quiet-pin/verify', { pin: PIN.slice(1) + '9' }, wall);
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  assert.equal(lines.join('\n').includes(PIN), false);
  assert.equal(lines.join('\n').includes(PIN.slice(1)), false);
});
