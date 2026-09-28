// Health data and connected apps (AGENTS.md "Health data"): the Health tracker stays out of MCP and
// connected apps' OAuth tokens until a parent turns on aiHealthAccess. The family's own devices
// (admin API keys, passkey sessions, Kinwall's own phone app) are unaffected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const PRIVATE = "Health entries are private to the family's own devices. A parent can allow connected apps to see them in Settings → Connected apps.";

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'https://kinwall.example', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const req = (p: string, init: RequestInit = {}, key = ADMIN_KEY) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${key}`);
    if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await req(p, { method, body: body === undefined ? undefined : JSON.stringify(body) }, key);
    return { status: res.status, body: (await res.json()) as any };
  };
  const tool = async (name: string, args: Record<string, unknown> = {}, key = ADMIN_KEY) => {
    const res = await req('/mcp', { method: 'POST', headers: { Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }, key);
    return ((await res.json()) as any).result;
  };
  // An OAuth sign-in: Claude's callback (a connected app) or Kinwall's own phone app link.
  const signIn = async (redirect: string) => {
    const reg = (await (await req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'App', redirect_uris: [redirect] }) })).json()) as any;
    const verifier = Buffer.from(randomBytes(32)).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const approved = (await (await req('/api/authorizations/approve', {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', scope: 'admin', owner: 'shared' }),
    })).json()) as any;
    const code = new URL(approved.redirect).searchParams.get('code')!;
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirect });
    const tok = (await (await app.request('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, env)).json()) as any;
    return tok.access_token as string;
  };
  return { env, req, send, tool, signIn };
}

async function seed(t: ReturnType<typeof setup>) {
  const book = (await t.send('POST', '/api/trackers', { kind: 'reading', title: 'Charlotte\'s Web', data: {} })).body;
  const visit = (await t.send('POST', '/api/trackers', { kind: 'health', title: 'Checkup at Dr. Green', data: { type: 'checkup', notes: 'All good' } })).body;
  return { book, visit };
}

test('ai health access: off by default, including for families that saved settings before it existed', async () => {
  const t = setup();
  assert.equal((await t.send('GET', '/api/settings')).body.aiHealthAccess, false);
  await t.send('PATCH', '/api/settings', { familyName: 'Our Family' });
  assert.equal((await t.send('GET', '/api/settings')).body.aiHealthAccess, false);
});

test('ai health access: MCP leaves health out while off, and sees it once a parent turns it on', async () => {
  const t = setup();
  const { book, visit } = await seed(t);

  const all = await t.tool('list_tracker_entries');
  assert.deepEqual(all.structuredContent.entries.map((e: any) => e.id), [book.id]);
  assert.doesNotMatch(JSON.stringify(all), /Dr\. Green|All good/);
  const searched = await t.tool('list_tracker_entries', { q: 'green' });
  assert.equal(searched.structuredContent.entries.length, 0, 'search never matches a hidden entry');

  const asked = await t.tool('list_tracker_entries', { kind: 'health' });
  assert.equal(asked.isError, true);
  assert.equal(asked.content[0].text, PRIVATE);

  const add = await t.tool('add_tracker_entry', { kind: 'health', title: 'Dentist', data: { type: 'dentist' } });
  assert.equal(add.isError, true);
  assert.equal(add.content[0].text, PRIVATE);
  const update = await t.tool('update_tracker_entry', { entryId: visit.id, title: 'Changed' });
  assert.equal(update.isError, true);
  assert.equal(update.content[0].text, PRIVATE);
  const del = await t.tool('delete_tracker_entry', { entryId: visit.id });
  assert.equal(del.isError, true);
  assert.equal(del.content[0].text, PRIVATE);
  assert.equal((await t.send('GET', `/api/trackers/${visit.id}`)).body.title, 'Checkup at Dr. Green', 'untouched');

  await t.send('PATCH', '/api/settings', { aiHealthAccess: true });
  const on = await t.tool('list_tracker_entries', { kind: 'health' });
  assert.deepEqual(on.structuredContent.entries.map((e: any) => e.title), ['Checkup at Dr. Green']);
  const edited = await t.tool('update_tracker_entry', { entryId: visit.id, title: 'Checkup' });
  assert.equal(edited.structuredContent.entry.title, 'Checkup');
});

test('ai health access: other MCP reads carry no health data', async () => {
  const t = setup();
  const maya = (await t.send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  await t.send('POST', '/api/trackers', { kind: 'health', memberId: maya.id, title: 'Checkup at Dr. Green', data: { type: 'checkup', notes: 'All good' } });
  for (const [name, args] of [['get_household', {}], ['get_member_profile', { member: 'Maya' }], ['get_snapshot', { member: 'Maya' }], ['get_board', {}], ['list_notifications', {}]] as const) {
    const out = await t.tool(name, args);
    assert.notEqual(out.isError, true, `${name}: ${JSON.stringify(out)}`);
    assert.doesNotMatch(JSON.stringify(out), /Dr\. Green|All good/, name);
  }
});

test('ai health access: a connected app\'s OAuth token on REST is filtered; the family\'s own keys and app are not', async () => {
  const t = setup();
  const { visit } = await seed(t);
  const claude = await t.signIn('https://claude.ai/api/mcp/auth_callback');
  const phone = await t.signIn('family.kinwall.app:/oauth');

  const list = await t.send('GET', '/api/trackers', undefined, claude);
  assert.deepEqual(list.body.map((e: any) => e.kind), ['reading']);
  assert.deepEqual(await t.send('GET', '/api/trackers?kind=health', undefined, claude), { status: 403, body: { error: PRIVATE } });
  assert.equal((await t.send('GET', `/api/trackers/${visit.id}`, undefined, claude)).status, 403);
  assert.equal((await t.send('PATCH', `/api/trackers/${visit.id}`, { title: 'x' }, claude)).status, 403);
  assert.equal((await t.send('DELETE', `/api/trackers/${visit.id}`, undefined, claude)).status, 403);
  assert.equal((await t.send('POST', '/api/trackers', { kind: 'health', title: 'x', data: { type: 'sick' } }, claude)).status, 403);
  const exported = await t.send('GET', '/api/export', undefined, claude);
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.trackers.map((e: any) => e.kind), ['reading']);
  // Nor can it slip health in (or turn the switch on) through an import.
  const file = (await t.send('GET', '/api/export')).body;
  file.settings.aiHealthAccess = true;
  file.trackers = file.trackers.map((e: any) => (e.kind === 'health' ? { ...e, title: 'Overwritten' } : e));
  file.trackers.push({ ...file.trackers[0], id: 'new-visit', kind: 'health', title: 'Added', data: { type: 'sick' } });
  assert.equal((await t.send('POST', '/api/import', file, claude)).status, 200);
  assert.deepEqual((await t.send('GET', '/api/trackers?kind=health')).body.map((e: any) => e.title), ['Checkup at Dr. Green']);
  assert.equal((await t.send('GET', '/api/settings')).body.aiHealthAccess, false);
  // A connected app can't turn the switch on for itself.
  assert.equal((await t.send('PATCH', '/api/settings', { aiHealthAccess: true }, claude)).status, 403);
  assert.equal((await t.send('GET', '/api/settings')).body.aiHealthAccess, false);

  for (const key of [ADMIN_KEY, phone]) {
    assert.deepEqual((await t.send('GET', '/api/trackers?kind=health', undefined, key)).body.map((e: any) => e.title), ['Checkup at Dr. Green']);
    assert.equal((await t.send('GET', '/api/export', undefined, key)).body.trackers.length, 2);
  }

  await t.send('PATCH', '/api/settings', { aiHealthAccess: true });
  assert.equal((await t.send('GET', '/api/trackers', undefined, claude)).body.length, 2);
});
