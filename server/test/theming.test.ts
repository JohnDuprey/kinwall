import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { isSingleEmoji } from '../src/emoji.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return {
    DB: db as unknown as D1Database,
    ADMIN_API_KEY: ADMIN_KEY,
    PUBLIC_URL: 'http://localhost:8080',
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };
}

function makeApp(env: Env) {
  const app = createApp();
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !path.includes('key=')) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
  return request;
}

test('settings: defaults include the new appearance fields', async () => {
  const request = makeApp(makeEnv());
  const res = await request('/api/settings');
  const body = await res.json() as any;
  assert.equal(body.themeMode, 'light');
  assert.equal(body.accent, '#FF9E7A');
  assert.equal(body.backgroundLight, 'warm');
  assert.equal(body.backgroundDark, 'cocoa');
  assert.equal(body.textScale, 'm');
  assert.equal(body.darkFrom, '20:00');
  assert.equal(body.darkTo, '07:00');
  assert.equal(body.density, 'comfortable');
});

test('settings: PATCH accepts a valid density and rejects a bad one', async () => {
  const request = makeApp(makeEnv());
  const ok = await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ density: 'compact' }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json() as any).density, 'compact');
  const bad = await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ density: 'cozy' }) });
  assert.equal(bad.status, 400);
});

test('appearance: GET /api/appearance works with no auth and returns only appearance fields', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  // Set something identifying (familyName) plus an appearance field, to prove only appearance
  // fields make it into the public response.
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ familyName: 'The Secret Family', accent: '#123ABC', density: 'compact' }) });

  const app = createApp();
  const res = await app.request('/api/appearance', {}, env); // no Authorization header at all
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.accent, '#123ABC');
  assert.equal(body.density, 'compact');
  assert.deepEqual(Object.keys(body).sort(), ['accent', 'backgroundDark', 'backgroundLight', 'darkFrom', 'darkTo', 'density', 'textScale', 'themeMode']);
  assert.equal(body.familyName, undefined);
});

test('settings: PATCH accepts valid appearance fields', async () => {
  const request = makeApp(makeEnv());
  const res = await request('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ themeMode: 'scheduled', darkFrom: '22:15', darkTo: '06:30', accent: '#123ABC', backgroundLight: 'sage', backgroundDark: 'midnight', textScale: 'xl' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.themeMode, 'scheduled');
  assert.equal(body.darkFrom, '22:15');
  assert.equal(body.accent, '#123ABC');
  assert.equal(body.backgroundLight, 'sage');
  assert.equal(body.backgroundDark, 'midnight');
  assert.equal(body.textScale, 'xl');
});

test('settings: PATCH rejects a bad hex color, bad HH:MM, and unknown presets', async () => {
  const request = makeApp(makeEnv());
  assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ accent: 'orange' }) })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ accent: '#FFF' }) })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ darkFrom: '9:00' }) })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ darkFrom: '24:00' }) })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ backgroundLight: 'cocoa' }) })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ backgroundDark: 'warm' }) })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ textScale: 'huge' }) })).status, 400);
});

test('settings: legacy theme=light|dark maps into themeMode', async () => {
  const request = makeApp(makeEnv());
  const res = await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ theme: 'dark' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).themeMode, 'dark');
});

test('emoji: isSingleEmoji accepts ZWJ families, skin tones, flags, keycaps, plain emoji', () => {
  for (const e of ['👨‍👩‍👧', '👍🏽', '🇺🇸', '1️⃣', '🦄']) assert.equal(isSingleEmoji(e), true, e);
});

test('emoji: isSingleEmoji rejects letters, multiple emoji, and HTML', () => {
  for (const bad of ['ab', '😀😀', '<script>', '', 'A']) assert.equal(isSingleEmoji(bad), false, bad);
});

test('members: avatar validation accepts an emoji or short initial, rejects junk', async () => {
  const request = makeApp(makeEnv());
  const ok1 = await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ada', color: '#ff0000', avatar: '🦄' }) });
  assert.equal(ok1.status, 201);
  const ok2 = await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Sam', color: '#00ff00', avatar: 'SA' }) });
  assert.equal(ok2.status, 201);
  const bad = await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Bad', color: '#0000ff', avatar: '<script>' }) });
  assert.equal(bad.status, 400);
});

test('chores: emoji validation rejects non-emoji', async () => {
  const request = makeApp(makeEnv());
  const bad = await request('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Dishes', emoji: '😀😀' }) });
  assert.equal(bad.status, 400);
  const ok = await request('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Dishes', emoji: '🍽️' }) });
  assert.equal(ok.status, 201);
});
