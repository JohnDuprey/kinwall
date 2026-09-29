// Remote Night screen: parents and Home Assistant start it on wall screens (all, or chosen ones) and
// wake them again; wall screens read it from GET /api/rev, which they already poll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'ns_test_admin';
const HOUR = 3600e3;

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const req = async (method: string, p: string, body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const display = async (name: string) => (await req('POST', '/api/keys', { name, scope: 'display' })).body as { id: string; key: string };
  const set = (body: unknown, key = ADMIN) => req('POST', '/api/displays/night-screen', body, key);
  const rev = async (key: string) => (await req('GET', '/api/rev', undefined, key)).body as { rev: number; nightScreen: { on: boolean; since: string; until: string } | null };
  // Moves every stored night-screen expiry into the past, as if the time had run out.
  const expire = () => db.prepare("UPDATE settings SET value = json_set(value, '$.until', '2000-01-01T00:00:00.000Z') WHERE key LIKE 'nightScreen%'").run();
  return { req, display, set, rev, expire };
}

test('night screen: on for every wall screen, seen on /api/rev, off wakes them', async () => {
  const { display, set, rev, req } = setup();
  const hall = await display('Hallway'), kitchen = await display('Kitchen');
  assert.equal((await rev(hall.key)).nightScreen, null, 'off by default');
  const before = (await rev(hall.key)).rev;

  const on = await set({ on: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.all.on, true);
  const until = Date.parse(on.body.all.until) - Date.parse(on.body.all.since);
  assert.ok(Math.abs(until - 12 * HOUR) < 5000, 'expires after 12 hours by default');
  for (const d of [hall, kitchen]) {
    const r = await rev(d.key);
    assert.equal(r.nightScreen?.on, true);
    assert.ok(r.rev > before, 'rev bumps so walls pick it up on their next check');
  }
  const state = (await req('GET', '/api/displays/night-screen')).body;
  assert.deepEqual(state.displays.map((d: { name: string; on: boolean }) => [d.name, d.on]), [['Hallway', true], ['Kitchen', true]]);

  assert.equal((await set({ on: false })).status, 200);
  assert.equal((await rev(hall.key)).nightScreen, null);
  assert.equal((await req('GET', '/api/displays/night-screen')).body.all, null);
});

test('night screen: targets chosen wall screens only; an all-screens call replaces them', async () => {
  const { display, set, rev } = setup();
  const hall = await display('Hallway'), kitchen = await display('Kitchen');
  const r = await set({ on: true, displays: [hall.id], hours: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.all, null);
  const until = Date.parse(r.body.displays[0].until) - Date.parse(r.body.displays[0].since);
  assert.ok(Math.abs(until - 2 * HOUR) < 5000);
  assert.equal((await rev(hall.key)).nightScreen?.on, true);
  assert.equal((await rev(kitchen.key)).nightScreen, null);

  // Everyone on, then one woken: the others stay asleep.
  await set({ on: true });
  await set({ on: false, displays: [kitchen.id] });
  assert.equal((await rev(hall.key)).nightScreen?.on, true);
  assert.equal((await rev(kitchen.key)).nightScreen, null);
  // An all-screens call starts fresh, dropping the per-screen choices.
  await set({ on: true });
  assert.equal((await rev(kitchen.key)).nightScreen?.on, true);

  assert.equal((await set({ on: true, displays: ['nope'] })).status, 400, 'unknown display');
  assert.equal((await set({ on: true, displays: [] })).status, 400, 'an empty list is a mistake, not "all"');
  assert.equal((await set({ on: true, hours: 0 })).status, 400);
});

test('night screen: a forgotten "on" runs out, without any write on the poll', async () => {
  const { display, set, rev, req, expire } = setup();
  const hall = await display('Hallway');
  await set({ on: true });
  const r = await rev(hall.key);
  assert.equal(r.nightScreen?.on, true);
  expire();
  const after = await rev(hall.key);
  assert.equal(after.nightScreen, null);
  assert.equal(after.rev, r.rev, 'reading it changes nothing');
  assert.equal((await req('GET', '/api/displays/night-screen')).body.all, null);
});

test('night screen: parents, admin keys and connected apps may; wall screens and kids\' devices may not', async () => {
  const { display, set, req } = setup();
  const wall = await display('Hallway');
  const kid = (await req('POST', '/api/device-keys', { name: "Sam's tablet" }, wall.key)).body.key as string;
  for (const key of [wall.key, kid]) {
    assert.equal((await set({ on: true }, key)).status, 403);
    assert.equal((await req('GET', '/api/displays/night-screen', undefined, key)).status, 403);
  }
  assert.equal((await req('POST', '/api/displays/night-screen', { on: true }, ADMIN, { 'X-Kinwall-Source': 'mcp' })).status, 200, 'not health data: connected apps may');
  const parent = (await req('POST', '/api/keys', { name: 'Home Assistant', scope: 'admin' })).body.key as string;
  assert.equal((await set({ on: false }, parent)).status, 200);
});

test('night screen: the set_night_screen MCP tool', async () => {
  const { display, req } = setup();
  const hall = await display('Hallway');
  await display('Kitchen');
  const mcp = async (args: Record<string, unknown>) => (await req('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_night_screen', arguments: args } }, ADMIN, { Accept: 'application/json, text/event-stream' })).body.result;
  const r = await mcp({ on: true, displays: ['hallway'] });
  assert.notEqual(r.isError, true, JSON.stringify(r.content));
  assert.match(r.content[0].text, /Hallway/);
  assert.deepEqual(r.structuredContent.displays.map((d: { id: string; on: boolean }) => [d.id, d.on]), [[hall.id, true], [r.structuredContent.displays[1].id, false]]);
  assert.equal((await mcp({ on: true, displays: ['Garage'] })).isError, true);
  assert.equal((await mcp({ on: false })).structuredContent.all, null);
});
