import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env, defaultKey = ADMIN_KEY) {
  const app = createApp();
  return (p: string, init: RequestInit = {}, key = defaultKey): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !p.includes('key=')) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return Promise.resolve(app.request(p, { ...init, headers }, env));
  };
}

async function json(res: Response): Promise<any> {
  return res.json();
}


test('list items: who an item is for (forMemberIds)', async () => {
  const request = makeApp(makeEnv());
  const maya = await json(await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Maya', color: '#123456' }) }));
  const leo = await json(await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Leo', color: '#654321' }) }));
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Target', kind: 'shopping' }) }));
  const items = `/api/lists/${list.id}/items`;

  const [plain, band] = await json(await request(items, { method: 'POST', body: JSON.stringify([{ title: 'Milk' }, { title: 'Watch band', forMemberIds: [maya.id, maya.id] }]) }));
  assert.deepEqual(plain.forMemberIds, [], 'nobody picked = for everyone');
  assert.deepEqual(band.forMemberIds, [maya.id], 'deduped');

  const both = await json(await request(`${items}/${band.id}`, { method: 'PATCH', body: JSON.stringify({ forMemberIds: [maya.id, leo.id] }) }));
  assert.deepEqual(both.forMemberIds, [maya.id, leo.id]);
  const renamed = await json(await request(`${items}/${band.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Blue watch band' }) }));
  assert.deepEqual(renamed.forMemberIds, [maya.id, leo.id], 'left alone when not sent');
  const detail = await json(await request(`/api/lists/${list.id}`));
  assert.deepEqual(detail.items.find((i: any) => i.id === band.id).forMemberIds, [maya.id, leo.id]);

  assert.equal((await request(items, { method: 'POST', body: JSON.stringify({ title: 'Socks', forMemberIds: ['nope'] }) })).status, 400);
  assert.equal((await request(`${items}/${band.id}`, { method: 'PATCH', body: JSON.stringify({ forMemberIds: [maya.id, 'nope'] }) })).status, 400);
  const cleared = await json(await request(`${items}/${band.id}`, { method: 'PATCH', body: JSON.stringify({ forMemberIds: [] }) }));
  assert.deepEqual(cleared.forMemberIds, []);
});
