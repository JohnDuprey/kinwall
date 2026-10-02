// What a member's own device (a kid's tablet) can read about siblings, and the small abuse paths a
// display key had: Maya's tablet can't read Leo's reward requests, decline notes, points ledger or
// activity saves; a shared wall and a parent's key are unchanged; made-up newscast reactions,
// piles of Live Activity tokens and over-full color-scheme lists are refused or capped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const ctx = { waitUntil: () => {}, passThroughOnException() {}, props: {} };
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx as never);
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
  };
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const deviceKey = async (name: string, owner: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope: 'display' })).json;
    assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const mayaKey = await deviceKey('maya-tablet', maya.id);
  const leoKey = await deviceKey('leo-tablet', leo.id);
  const wallKey = await deviceKey('wall', 'shared');
  const today = new Date().toISOString().slice(0, 10);
  const earn = async (memberId: string, points: number) => {
    const chore = (await req('/api/chores', 'POST', { title: `Job ${Math.random()}`, points, memberId, dueDate: today })).json;
    assert.equal((await req(`/api/chores/${chore.id}/complete`, 'POST', { date: today, memberId })).status, 200);
  };
  return { db, req, maya, leo, mayaKey, leoKey, wallKey, today, earn };
}

test('rewards: a kid device reads only its own requests; a wall and a parent read everyone\'s', async () => {
  const t = await setup();
  await t.earn(t.leo.id, 100);
  await t.earn(t.maya.id, 100);
  const reward = (await t.req('/api/rewards', 'POST', { title: 'Movie night', emoji: '🍿', cost: 50 })).json;
  const leoReq = (await t.req(`/api/rewards/${reward.id}/redeem`, 'POST', { memberId: t.leo.id }, t.leoKey)).json.redemption;
  const mayaReq = (await t.req(`/api/rewards/${reward.id}/redeem`, 'POST', { memberId: t.maya.id }, t.mayaKey)).json.redemption;
  assert.equal((await t.req(`/api/rewards/redemptions/${leoReq.id}/decline`, 'POST', { note: 'Not before homework' })).status, 200);

  const ids = async (qs: string, key: string) => (await t.req(`/api/rewards/redemptions${qs}`, 'GET', undefined, key)).json.map((r: any) => r.id).sort();
  // Maya's tablet: no member asked = its own; Leo's = refused; its own = fine.
  assert.deepEqual(await ids('', t.mayaKey), [mayaReq.id]);
  assert.deepEqual(await ids('?status=pending', t.mayaKey), [mayaReq.id]);
  assert.deepEqual(await ids(`?memberId=${t.maya.id}`, t.mayaKey), [mayaReq.id]);
  const peek = await t.req(`/api/rewards/redemptions?memberId=${t.leo.id}`, 'GET', undefined, t.mayaKey);
  assert.equal(peek.status, 403);
  assert.ok(!JSON.stringify(peek.json).includes('homework'));
  // Leo's own device still reads his declined request and the note.
  const mine = (await t.req('/api/rewards/redemptions', 'GET', undefined, t.leoKey)).json;
  assert.deepEqual(mine.map((r: any) => [r.id, r.status, r.note]), [[leoReq.id, 'declined', 'Not before homework']]);
  // The wall (the Rewards screen, a member picked) and a parent are unchanged.
  assert.deepEqual(await ids('', t.wallKey), [leoReq.id, mayaReq.id].sort());
  assert.deepEqual(await ids(`?memberId=${t.leo.id}`, t.wallKey), [leoReq.id]);
  assert.equal((await t.req(`/api/rewards/redemptions?memberId=${t.leo.id}`, 'GET', undefined, t.wallKey)).json[0].note, 'Not before homework');
  assert.deepEqual(await ids('', ADMIN), [leoReq.id, mayaReq.id].sort());
});

test('points: a kid device gets a sibling\'s balance but not the itemized ledger', async () => {
  const t = await setup();
  await t.earn(t.leo.id, 30);
  const r = (await t.req('/api/rewards', 'POST', { title: 'Sticker', cost: 10, needsApproval: false })).json;
  assert.equal((await t.req(`/api/rewards/${r.id}/redeem`, 'POST', { memberId: t.leo.id }, t.leoKey)).status, 201);
  const own = (await t.req(`/api/members/${t.leo.id}/points`, 'GET', undefined, t.leoKey)).json;
  assert.equal(own.balance, 20);
  assert.ok(own.entries.length > 0);
  const sib = await t.req(`/api/members/${t.leo.id}/points`, 'GET', undefined, t.mayaKey);
  assert.equal(sib.status, 200);
  assert.deepEqual([sib.json.balance, sib.json.earnedTotal, sib.json.spentTotal, sib.json.entries], [20, 30, 10, []]);
  assert.equal((await t.req(`/api/members/${t.leo.id}/points`, 'GET', undefined, t.wallKey)).json.entries.length, own.entries.length);
  assert.equal((await t.req(`/api/members/${t.leo.id}/points`)).json.entries.length, own.entries.length);
  assert.equal((await t.req('/api/members/nobody/points', 'GET', undefined, t.mayaKey)).status, 404);
});

test('plugins: a kid device reads its own and the shared saves, not a sibling\'s', async () => {
  const t = await setup();
  await t.db.prepare("INSERT INTO plugins (id, name, version, manifest, source, enabled, installed_at, updated_at) VALUES ('words','Words','1.0.0','{}',NULL,1,'x','x')").run();
  const save = (member: string, key: string) => t.req('/api/plugins/words/data', 'PUT', { member, key, value: { by: member || 'family' } });
  await save(t.leo.id, 'progress');
  await save(t.maya.id, 'progress');
  await save('', 'best');
  const read = (member: string | null, key: string) => t.req(`/api/plugins/words/data${member === null ? '' : `?member=${member}`}`, 'GET', undefined, key);
  assert.deepEqual((await read(t.maya.id, t.mayaKey)).json, { progress: { by: t.maya.id } });
  assert.deepEqual((await read('', t.mayaKey)).json, { best: { by: 'family' } });
  assert.deepEqual((await read(null, t.mayaKey)).json, { best: { by: 'family' } }, 'no member = the shared data');
  const peek = await read(t.leo.id, t.mayaKey);
  assert.equal(peek.status, 403);
  assert.ok(!JSON.stringify(peek.json).includes(t.leo.id + '"'));
  // The wall and a parent read anyone's.
  assert.deepEqual((await read(t.leo.id, t.wallKey)).json, { progress: { by: t.leo.id } });
  assert.deepEqual((await read(t.leo.id, ADMIN)).json, { progress: { by: t.leo.id } });
});

test('newscast: reactions only on items in the feed window', async () => {
  const t = await setup();
  const react = (itemKey: string, key = t.mayaKey) => t.req('/api/newscast/reactions', 'PUT', { itemKey, emoji: '👏', on: true }, key);
  const rows = async () => (await t.db.prepare('SELECT COUNT(*) AS n FROM newscast_reactions').first<{ n: number }>())!.n;
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
  for (const k of ['post:nope', 'reward:nope', 'book:nope', 'memory:nope', `chores:${t.leo.id}:${t.today}`, `chores:nobody:${t.today}`, `photos:nobody:${t.today}`, `photos:family:${old}`, `birthday:${t.leo.id}:${t.today}`]) {
    assert.equal((await react(k)).status, 404, k);
  }
  assert.equal(await rows(), 0);
  // Real ones still work: an announcement, an approved chore day, a family photo day.
  const post = (await t.req('/api/newscast/posts', 'POST', { text: 'Fort built' }, t.leoKey)).json.post.id;
  assert.equal((await react(`post:${post}`)).status, 200);
  await t.db.prepare("INSERT INTO chores (id, title, emoji, member_id, points, created_at) VALUES ('c1','Make bed','🧹',?,1,'2020-01-01T00:00:00Z')").bind(t.leo.id).run();
  await t.db.prepare("INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, status, points_awarded) VALUES ('cc1','c1',?,?,?,'approved',1)").bind(t.today, t.leo.id, `${t.today}T01:00:00.000Z`).run();
  assert.equal((await react(`chores:${t.leo.id}:${t.today}`)).status, 200);
  assert.equal((await react(`photos:family:${t.today}`)).status, 200);
  assert.equal(await rows(), 3);
  // Taking a reaction back never needs the item to exist.
  assert.equal((await t.req('/api/newscast/reactions', 'PUT', { itemKey: 'post:gone', emoji: '👏', on: false }, t.mayaKey)).status, 200);
});

test('live activities: a device keeps a handful of tokens, newest first', async () => {
  const t = await setup();
  const put = (body: object, key = t.mayaKey) => t.req('/api/live-activities/tokens', 'PUT', body, key);
  const hex = (n: number) => n.toString(16).padStart(32, '0');
  assert.equal((await put({ kind: 'start', token: hex(1) })).status, 200);
  for (let i = 0; i < 30; i++) assert.equal((await put({ kind: 'update', token: hex(100 + i), activity: `leaveBy:e${i}@2026-01-01T00:00:00Z` })).status, 200);
  const rows = (await t.db.prepare('SELECT kind, activity FROM live_activity_tokens').all<{ kind: string; activity: string }>()).results;
  assert.ok(rows.length <= 8, `kept ${rows.length}`);
  assert.ok(rows.some((r) => r.activity.startsWith('leaveBy:e29@')), 'the newest is kept');
  assert.ok(!rows.some((r) => r.activity.startsWith('leaveBy:e0@')), 'the oldest went');
  // Another device is counted on its own.
  assert.equal((await put({ kind: 'start', token: hex(2) }, t.leoKey)).status, 200);
  assert.equal((await t.db.prepare('SELECT COUNT(*) AS n FROM live_activity_tokens').first<{ n: number }>())!.n, rows.length + 1);
});

test('color schemes: the family cap holds under parallel posts; the emoji must be one emoji', async () => {
  const t = await setup();
  const scheme = (i: number, emoji = '🧱') => ({
    id: `custom-s${String(i).padStart(4, '0')}`, name: `S${i}`, emoji,
    light: { bg: '#FFFBF5', card: '#FFFFFF', text: '#3A2E27', accent: '#FF9E7A' },
    dark: { bg: '#1C1712', card: '#2A221B', text: '#F3EAE0', accent: '#FF9E7A' },
  });
  const post = (s: object, key = t.mayaKey) => t.req('/api/settings/color-schemes', 'POST', s, key);
  for (const bad of ['abc', '😀😀', 'x😀', '<b>']) assert.equal((await post(scheme(99, bad))).status, 400, bad);
  assert.equal((await post(scheme(98, ''))).status, 201, 'no emoji is fine (the app shows a palette)');
  assert.equal((await post(scheme(97, '👨‍👩‍👧'))).status, 201, 'a ZWJ family is one emoji');
  assert.equal((await post(scheme(97))).status, 409);

  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => post(scheme(i), i % 2 ? t.mayaKey : t.wallKey)));
  assert.ok(results.every((r) => [201, 400].includes(r.status)));
  const list = (await t.req('/api/settings')).json.customSchemes;
  assert.equal(list.length, 10, 'exactly the cap, never over');
  assert.equal(results.filter((r) => r.status === 201).length, 8, '10 minus the two added first');
  assert.equal((await post(scheme(50))).status, 400);
  assert.equal((await post(scheme(50), ADMIN)).status, 400);
});
