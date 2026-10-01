// PUT /api/members/{id}/avatar: a kid's own device picks its own avatar; parents anyone's; wall
// screens, the app's widget keys and other kids' devices can't; nothing else about a member changes.
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
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57', avatar: '🦊' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
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

test("avatar: a kid's own device changes its own avatar, and only that", async () => {
  const t = await setup();
  const res = await t.req(`/api/members/${t.leo.id}/avatar`, 'PUT', { avatar: '🐉' }, t.leoKey);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { avatar: '🐉' });
  const after = await t.member(t.leo.id);
  assert.deepEqual([after.avatar, after.name, after.color], ['🐉', 'Leo', '#e57']);
  assert.equal((await t.req(`/api/members/${t.leo.id}/avatar`, 'PUT', { avatar: null }, t.leoKey)).status, 200, 'back to their initial');
  assert.equal((await t.member(t.leo.id)).avatar, null);
  // Everything else stays with parents.
  assert.equal((await t.req(`/api/members/${t.leo.id}`, 'PATCH', { color: '#000' }, t.leoKey)).status, 403);
  assert.equal((await t.req(`/api/members/${t.leo.id}/avatar`, 'PUT', { avatar: '🐉', color: '#000' }, t.leoKey)).status, 200, 'extra fields are ignored');
  assert.equal((await t.member(t.leo.id)).color, '#e57');
});

test("avatar: not a sibling's, not from a wall screen or the app's widgets", async () => {
  const t = await setup();
  assert.equal((await t.req(`/api/members/${t.maya.id}/avatar`, 'PUT', { avatar: '🐉' }, t.leoKey)).status, 403, "Maya's");
  assert.equal((await t.req(`/api/members/${t.leo.id}/avatar`, 'PUT', { avatar: '🐉' }, t.wallKey)).status, 403, 'wall');
  const widgets = (await t.req('/api/device-keys', 'POST', { name: 'Widgets on iPhone' }, t.leoKey)).json.key as string;
  assert.equal((await t.req(`/api/members/${t.leo.id}/avatar`, 'PUT', { avatar: '🐉' }, widgets)).status, 403, "Leo's widgets");
  assert.equal((await t.member(t.leo.id)).avatar, '🦊');
  assert.equal((await t.member(t.maya.id)).avatar, null);
});

test('avatar: validated like the members PATCH; parents set anyone; unknown member 404', async () => {
  const t = await setup();
  for (const avatar of ['🐉🐉', 'abc', '', 'x'.repeat(50)]) assert.equal((await t.req(`/api/members/${t.leo.id}/avatar`, 'PUT', { avatar }, t.leoKey)).status, 400, avatar);
  assert.equal((await t.req(`/api/members/${t.leo.id}/avatar`, 'PUT', {}, t.leoKey)).status, 400, 'avatar is required (null to clear)');
  assert.equal((await t.req(`/api/members/${t.maya.id}/avatar`, 'PUT', { avatar: 'MJ' })).status, 200, 'a parent, an initial');
  assert.equal((await t.member(t.maya.id)).avatar, 'MJ');
  assert.equal((await t.req('/api/members/nope/avatar', 'PUT', { avatar: '🐉' })).status, 404);
});
