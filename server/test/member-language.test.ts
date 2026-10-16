// Languages. Adapted from sudo-Foras666's tests in their German fork (sudo-Foras666/kinwall, #31).
// A member's language (members.language) works like the avatar: their own device for them, parents for
// anyone; wall screens, the app's widget keys and other kids' devices can't. null follows the device,
// then the family. The family's language (settings.language) is a family setting: parent devices only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_test_admin';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e', language: 'de' })).json;
  const display = async (name: string, owner: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope: 'display' })).json;
    assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const leoKey = await display('leo-tablet', leo.id);
  const wallKey = await display('wall', 'shared');
  const member = async (id: string) => ((await req('/api/members')).json as any[]).find((m) => m.id === id);
  return { req, leo, maya, leoKey, wallKey, member };
}

test('language: null by default, set on create and with PATCH', async () => {
  const t = await setup();
  assert.equal(t.leo.language, null);
  assert.equal(t.maya.language, 'de');
  assert.equal((await t.member(t.maya.id)).language, 'de');
  const res = await t.req(`/api/members/${t.leo.id}`, 'PATCH', { language: 'de' });
  assert.equal(res.status, 200);
  assert.equal(res.json.language, 'de');
  assert.equal((await t.req(`/api/members/${t.leo.id}`, 'PATCH', { name: 'Leo B' })).json.language, 'de', 'other edits keep it');
  assert.equal((await t.req(`/api/members/${t.leo.id}`, 'PATCH', { language: null })).json.language, null);
  assert.equal((await t.req(`/api/members/${t.leo.id}`, 'PATCH', { language: 'xx' })).status, 400);
});

test("language: a member's own device sets their own, and only that", async () => {
  const t = await setup();
  const res = await t.req(`/api/members/${t.leo.id}/language`, 'PUT', { language: 'de' }, t.leoKey);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { language: 'de' });
  assert.equal((await t.member(t.leo.id)).language, 'de');
  assert.equal((await t.req(`/api/members/${t.leo.id}/language`, 'PUT', { language: null }, t.leoKey)).status, 200, 'back to the device');
  assert.equal((await t.member(t.leo.id)).language, null);
  assert.equal((await t.req(`/api/members/${t.maya.id}/language`, 'PUT', { language: 'en' }, t.leoKey)).status, 403, "Maya's");
  assert.equal((await t.req(`/api/members/${t.leo.id}/language`, 'PUT', { language: 'en' }, t.wallKey)).status, 403, 'wall');
  const widgets = (await t.req('/api/device-keys', 'POST', { name: 'Widgets on iPhone' }, t.leoKey)).json.key as string;
  assert.equal((await t.req(`/api/members/${t.leo.id}/language`, 'PUT', { language: 'en' }, widgets)).status, 403, "Leo's widgets");
  assert.equal((await t.member(t.maya.id)).language, 'de');
});

test('language: validated; parents set anyone; unknown member 404', async () => {
  const t = await setup();
  for (const language of ['xx', '', 'german', 42]) assert.equal((await t.req(`/api/members/${t.leo.id}/language`, 'PUT', { language }, t.leoKey)).status, 400, String(language));
  assert.equal((await t.req(`/api/members/${t.leo.id}/language`, 'PUT', {}, t.leoKey)).status, 400, 'language is required (null to clear)');
  assert.equal((await t.req(`/api/members/${t.maya.id}/language`, 'PUT', { language: 'en' })).status, 200);
  assert.equal((await t.member(t.maya.id)).language, 'en');
  assert.equal((await t.req('/api/members/nope/language', 'PUT', { language: 'de' })).status, 404);
});

test('language: travels in the export and comes back on import', async () => {
  const t = await setup();
  const file = (await t.req('/api/export')).json;
  assert.equal(file.members.find((m: any) => m.id === t.maya.id).language, 'de');
  await t.req(`/api/members/${t.maya.id}`, 'PATCH', { language: null });
  assert.equal((await t.req('/api/import', 'POST', file)).status, 200);
  assert.equal((await t.member(t.maya.id)).language, 'de');
});

test("family language: English until a parent picks one; walls and kids' own devices can't change it", async () => {
  const t = await setup();
  assert.equal((await t.req('/api/settings')).json.language, 'en');
  assert.equal((await t.req('/api/settings', 'GET', undefined, t.wallKey)).json.language, 'en', 'a wall reads it');
  const res = await t.req('/api/settings', 'PATCH', { language: 'de' });
  assert.equal(res.status, 200);
  assert.equal(res.json.language, 'de');
  assert.equal((await t.req('/api/settings', 'PATCH', { language: 'en' }, t.wallKey)).status, 403, 'wall');
  assert.equal((await t.req('/api/settings', 'PATCH', { language: 'en' }, t.leoKey)).status, 403, "Leo's own tablet");
  assert.equal((await t.req('/api/settings', 'PATCH', { language: 'xx' })).status, 400);
  assert.equal((await t.req('/api/settings')).json.language, 'de');
});

test('family language: travels in the export and comes back on import', async () => {
  const t = await setup();
  await t.req('/api/settings', 'PATCH', { language: 'de' });
  const file = (await t.req('/api/export')).json;
  assert.equal(file.settings.language, 'de');
  await t.req('/api/settings', 'PATCH', { language: 'en' });
  assert.equal((await t.req('/api/import', 'POST', file)).status, 200);
  assert.equal((await t.req('/api/settings')).json.language, 'de');
  delete file.settings.language;
  for (const m of file.members) delete m.language;
  assert.equal((await t.req('/api/import', 'POST', file)).status, 200, 'an export from before languages still imports');
});
