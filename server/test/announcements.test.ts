import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const app = createApp();
  const send = async (path: string, method = 'GET', body?: unknown, key = 'k') => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const wall = (await send('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' })).body.key;
  const maya = (await send('/api/members', 'POST', { name: 'Maya', color: '#339966' })).body;
  const child = (await send('/api/keys', 'POST', { name: "Maya's tablet", scope: 'display' })).body;
  await send(`/api/keys/${child.id}`, 'PATCH', { kind: 'kid', owner: maya.id });
  return { send, db, wall, kid: child.key, app, env };
}
const announcement = { title: 'School closed tomorrow', details: 'Bring library books on Tuesday.', startsAt: '2026-11-01T17:00:00-05:00', expiresAt: '2026-11-02T12:00:00-05:00', priority: 'important' };

test('announcements: parents manage them; wall devices see only active messages', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T21:59:59Z') });
  const { send, wall, kid } = await setup();
  const created = await send('/api/announcements', 'POST', announcement);
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.startsAt, '2026-11-01T22:00:00.000Z');
  assert.equal((await send('/api/announcements', 'POST', announcement, wall)).status, 403);
  assert.equal((await send('/api/announcements?status=all', 'GET', undefined, wall)).status, 403);
  let visible = (await send('/api/announcements', 'GET', undefined, wall)).body;
  assert.deepEqual(visible.announcements, []);
  assert.equal(visible.nextChangeAt, '2026-11-01T22:00:00.000Z');
  t.mock.timers.setTime(Date.parse('2026-11-01T22:00:00Z'));
  visible = (await send('/api/announcements', 'GET', undefined, wall)).body;
  assert.equal(visible.announcements[0].title, announcement.title);
  assert.equal((await send('/api/announcements', 'GET', undefined, kid)).body.announcements[0].id, id);
  assert.equal((await send('/api/announcements?status=all', 'GET', undefined, kid)).status, 403);
  assert.equal((await send('/api/announcements', 'POST', announcement, kid)).status, 403);
  assert.equal((await send(`/api/announcements/${id}`, 'PATCH', { title: 'Changed' }, kid)).status, 403);
  assert.equal((await send(`/api/announcements/${id}`, 'DELETE', undefined, kid)).status, 403);
  assert.equal(visible.nextChangeAt, '2026-11-02T17:00:00.000Z');
  assert.equal((await send(`/api/announcements/${id}`, 'PATCH', { title: 'Changed' }, wall)).status, 403);
  assert.equal((await send(`/api/announcements/${id}`, 'DELETE', undefined, wall)).status, 403);
  assert.equal((await send(`/api/announcements/${id}`, 'PATCH', { details: 'No school Monday.' })).body.title, announcement.title);
  t.mock.timers.setTime(Date.parse('2026-11-02T17:00:00Z'));
  assert.deepEqual((await send('/api/announcements', 'GET', undefined, wall)).body.announcements, []);
  assert.equal((await send('/api/announcements?status=all')).body.announcements.length, 1, 'expiry keeps the record');
  assert.equal((await send(`/api/announcements/${id}`, 'DELETE')).status, 200);
  assert.equal((await send(`/api/announcements/${id}`, 'PATCH', { title: 'Gone' })).status, 404);
});

test('announcements: validate combined edits and order important messages first', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-02T08:00:00Z') });
  const { send } = await setup();
  for (const change of [{ title: '  ' }, { startsAt: 'not a date' }, { expiresAt: announcement.startsAt }, { priority: 'urgent' }, { expiresAt: '2026-10-01T12:00:00Z' }]) {
    assert.equal((await send('/api/announcements', 'POST', { ...announcement, ...change })).status, 400);
  }
  await send('/api/announcements', 'POST', { ...announcement, title: 'Library books', priority: 'normal' });
  const important = (await send('/api/announcements', 'POST', announcement)).body;
  assert.equal((await send('/api/announcements')).body.announcements[0].id, important.id);
  assert.equal((await send(`/api/announcements/${important.id}`, 'PATCH', { startsAt: '2026-12-01T12:00:00Z' })).status, 400);
  const edited = (await send(`/api/announcements/${important.id}`, 'PATCH', { title: '  Updated  ' })).body;
  assert.equal(edited.title, 'Updated');
  assert.equal(edited.priority, 'important');
  assert.equal(edited.details, announcement.details);
});

test('announcements: the feature switch hides every surface and backups restore saved schedules', async () => {
  const { send } = await setup();
  const created = (await send('/api/announcements', 'POST', announcement)).body;
  const backup = (await send('/api/export')).body;
  assert.equal(backup.announcements[0].id, created.id);
  await send(`/api/announcements/${created.id}`, 'DELETE');
  assert.equal((await send('/api/import', 'POST', backup)).body.imported.announcements, 1);
  assert.equal((await send('/api/announcements?status=all')).body.announcements[0].id, created.id);
  const features = (await send('/api/settings')).body.features;
  await send('/api/settings', 'PATCH', { features: { ...features, announcements: false } });
  assert.equal((await send('/api/announcements')).status, 404);
  assert.equal((await send('/api/announcements', 'POST', announcement)).status, 404);
  assert.equal((await send(`/api/announcements/${created.id}`, 'PATCH', { title: 'Hidden' })).status, 404);
  assert.equal((await send(`/api/announcements/${created.id}`, 'DELETE')).status, 404);
  await send('/api/settings', 'PATCH', { features });
  assert.equal((await send('/api/announcements?status=all')).body.announcements.length, 1);
});

test('announcements: MCP tools keep REST permissions and feature gating', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-02T08:00:00Z') });
  const { send, app, env, wall } = await setup();
  let id = 0;
  const call = async (name: string, args: object, key = 'k') => {
    const r = await app.request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) }, env);
    return (await r.json() as any).result;
  };
  const created = await call('create_announcement', announcement);
  assert.notEqual(created.isError, true);
  const saved = created.structuredContent.announcement;
  assert.equal((await call('list_announcements', {}, wall)).structuredContent.announcements[0].id, saved.id);
  assert.equal((await call('create_announcement', announcement, wall)).isError, true);
  assert.equal((await call('update_announcement', { id: saved.id, title: 'Blocked' }, wall)).isError, true);
  assert.equal((await call('delete_announcement', { id: saved.id }, wall)).isError, true);
  assert.equal((await call('list_announcements', { status: 'all' }, wall)).isError, true);
  assert.equal((await call('update_announcement', { id: saved.id, title: 'Updated' })).structuredContent.announcement.priority, 'important');
  const features = (await send('/api/settings')).body.features;
  await send('/api/settings', 'PATCH', { features: { ...features, announcements: false } });
  assert.equal((await call('list_announcements', {})).isError, true);
  await send('/api/settings', 'PATCH', { features });
  assert.equal((await call('delete_announcement', { id: saved.id })).structuredContent.ok, true);
});
