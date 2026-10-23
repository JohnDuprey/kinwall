import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import { publish } from '../src/bus.ts';
import type { Env } from '../src/env.ts';
import type { NativePushRequest } from '../src/native-push.ts';

test('routine changes wake only current child devices, including when routine mode is disabled', async () => {
  const DB = openDb(':memory:');
  applyMigrations(DB, fileURLToPath(new URL('../migrations', import.meta.url)));
  const sent: NativePushRequest[] = [], pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
  const env: Env = { DB, ADMIN_API_KEY: 'parent', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', NATIVE_PUSH_SEND: async request => { sent.push(request); return { ok: true, gone: false }; } };
  const app = createApp();
  const request = (path: string, body: unknown, key = 'parent', method = 'PUT') => app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env, ctx);
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  const maya = await (await request('/api/members', { name: 'Maya', color: '#557799' }, 'parent', 'POST')).json() as any;
  const leo = await (await request('/api/members', { name: 'Leo', color: '#779955' }, 'parent', 'POST')).json() as any;
  const child = await createApiKey(DB, 'Maya iPad', 'display', { owner: maya.id, deviceKind: 'kid' });
  const sibling = await createApiKey(DB, 'Leo iPad', 'display', { owner: leo.id, deviceKind: 'kid' });
  const grownup = await createApiKey(DB, 'Parent phone', 'admin', { owner: maya.id });
  const policy = { enabled: false, start: '07:30', cutoff: '20:00' };
  await request(`/api/routine-mode/${maya.id}`, policy);
  await request(`/api/routine-mode/${leo.id}`, policy);
  for (const [key, token] of [[child.key, 'ab'.repeat(32)], [sibling.key, 'cd'.repeat(32)], [grownup.key, 'ef'.repeat(32)]]) {
    assert.equal((await request('/api/push/native', { token }, key)).status, 200);
  }
  await drain(); sent.length = 0;
  assert.equal((await request(`/api/routine-mode/${maya.id}`, policy)).status, 200);
  await drain();
  assert.deepEqual(sent, [{ type: 'background', token: 'ab'.repeat(32) }], 'targeted parent settings change wakes only this child, even for Off');
  sent.length = 0;
  publish(env, ctx, 'chore.completed', { memberId: maya.id }); await drain();
  assert.deepEqual(new Set(sent.map(s => s.token)), new Set(['ab'.repeat(32), 'cd'.repeat(32)]));
  sent.length = 0;
  publish(env, ctx, 'journal.changed', {}); await drain();
  assert.deepEqual(sent, []);
  await DB.prepare('UPDATE api_keys SET owner=? WHERE id=?').bind('shared', child.id).run();
  await DB.prepare('DELETE FROM api_keys WHERE id=?').bind(sibling.id).run();
  publish(env, ctx, 'chore.uncompleted', {}); await drain();
  assert.deepEqual(sent, [], 'reassigned or revoked child devices are excluded at send time');
});
