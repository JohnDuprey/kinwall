// A parent's phone's widgets (and Watch) key is credited to that parent for "Added by" (auth.ts
// actorOf) without becoming their device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  return async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

test("a parent's phone's widgets and Watch keys credit the parent, and stay shared keys", async () => {
  const send = makeApp();
  const alex = (await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true })).json;
  const leo = (await send('POST', '/api/members', { name: 'Leo', color: '#993366' })).json;
  const phone = (await send('POST', '/api/keys', { name: "Alex's phone", scope: 'admin' })).json;
  assert.equal((await send('PATCH', `/api/keys/${phone.id}`, { kind: 'grownup', owner: alex.id })).status, 200);
  const widgets = (await send('POST', '/api/device-keys', { name: 'Widgets on iPhone' }, phone.key)).json;
  const watch = (await send('POST', '/api/device-keys', { name: 'Apple Watch' }, widgets.key)).json;
  const shared = (await send('POST', '/api/device-keys', { name: 'Widgets on iPad' })).json; // the admin key: nobody's

  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).json;
  const add = async (title: string, key: string) => (await send('POST', `/api/lists/${list.id}/items`, { title }, key)).json[0].addedBy;
  assert.equal((await add('Water', widgets.key)).memberId, alex.id);
  assert.equal((await add('Eggs', watch.key)).memberId, alex.id);
  assert.equal((await add('Bread', shared.key)).label, 'Widgets on iPad');

  const me = (await send('GET', '/api/me', undefined, widgets.key)).json;
  assert.equal(me.owner, 'shared'); // still a shared key: not Alex's device, no kid rules
  const leoItem = (await send('POST', `/api/lists/${list.id}/items`, { title: 'Juice', memberId: leo.id }, widgets.key));
  assert.equal(leoItem.status, 201); // acts for anyone, like before
});
