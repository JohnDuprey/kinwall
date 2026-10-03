// Bonus points: a parent gives a member points outside a chore (POST /api/points/awards). They
// count everywhere chore points do (balance, today/week, leaderboard, profile) but aren't a chore:
// no completions, no streak. Parent devices only; chores off turns them off; a parent can take one back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const background: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => background.push(p), passThroughOnException() {}, props: {} };
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx as never);
    return { status: res.status, json: (await res.json()) as any };
  };
  const flush = async () => {
    while (background.length) await Promise.all(background.splice(0));
  };
  const sent: { url: string; body: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    sent.push({ url: String(url), body: typeof init.body === 'string' ? init.body : '' });
    return new Response('', { status: 201 });
  }) as typeof fetch;
  const restore = async () => {
    await flush();
    globalThis.fetch = realFetch;
  };
  const events = () => sent.filter((s) => s.url.startsWith('https://hooks.example.com')).map((s) => JSON.parse(s.body) as { type: string; data: any });
  const pushes = (device: string) => sent.filter((s) => s.url === `https://fcm.googleapis.com/fcm/send/${device}`).length;

  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const deviceKey = async (name: string, owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope: 'display' })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
    assert.ok((await req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh, auth } }, deviceName: name }, k.key)).status < 300);
    return k.key as string;
  };
  const leoKey = await deviceKey('leo-tablet', leo.id);
  const wallKey = await deviceKey('wall', 'shared');
  assert.equal((await req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const give = (body: Record<string, unknown>, key = ADMIN) => req('/api/points/awards', 'POST', body, key);
  return { db, req, flush, restore, events, pushes, leo, maya, leoKey, wallKey, today, yesterday, give };
}

test('bonus points: a parent gives points; they count like chore points but not as a chore', async () => {
  const t = await setup();
  try {
    // A chore Leo did today, so there's a streak to keep.
    const chore = (await t.req('/api/chores', 'POST', { title: 'Feed the cat', points: 5, memberId: t.leo.id, dueDate: t.today })).json;
    assert.equal((await t.req(`/api/chores/${chore.id}/complete`, 'POST', { date: t.today, memberId: t.leo.id })).status, 200);
    const before = (await t.req('/api/leaderboard?period=week')).json.find((e: any) => e.memberId === t.leo.id);
    const revBefore = (await t.req('/api/rev')).json;

    const r = await t.give({ memberId: t.leo.id, points: 10, note: '  Helped carry groceries ' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual([r.json.award.memberId, r.json.award.points, r.json.award.note, r.json.award.date, r.json.balance], [t.leo.id, 10, 'Helped carry groceries', t.today, 15]);

    const leo = (await t.req('/api/members')).json.find((m: any) => m.id === t.leo.id);
    assert.deepEqual([leo.balance, leo.pointsToday, leo.pointsWeek], [15, 15, 15]);
    const points = (await t.req(`/api/members/${t.leo.id}/points`)).json;
    assert.deepEqual([points.balance, points.earnedTotal, points.spentTotal], [15, 15, 0]);
    assert.deepEqual(points.entries.map((e: any) => [e.reason, e.amount, e.note, e.ref]), [['bonus', 10, 'Helped carry groceries', t.today]]);

    const after = (await t.req('/api/leaderboard?period=week')).json.find((e: any) => e.memberId === t.leo.id);
    assert.deepEqual([after.points, after.completed, after.streak], [15, before.completed, before.streak], 'points up; chores and streak unchanged');
    const stats = (await t.req(`/api/members/${t.leo.id}/stats?period=week`)).json;
    assert.deepEqual([stats.pointsEarned, stats.choresDone], [15, 1]);

    const list = (await t.req(`/api/points/awards?memberId=${t.leo.id}`)).json;
    assert.deepEqual(list.map((a: any) => a.id), [r.json.award.id]);
    assert.deepEqual((await t.req(`/api/points/awards?memberId=${t.maya.id}`)).json, []);

    const revAfter = (await t.req('/api/rev')).json;
    assert.ok(revAfter.rev > revBefore.rev && revAfter.revs.chores > revBefore.revs.chores, 'chores rev bumps');
    await t.flush();
    const ev = t.events().find((e) => e.type === 'points.awarded');
    assert.deepEqual(ev?.data, { id: r.json.award.id, memberId: t.leo.id, points: 10, note: 'Helped carry groceries', date: t.today });
    assert.equal(t.pushes('leo-tablet'), 1, "Leo's own device is told");
    assert.equal(t.pushes('wall'), 0);
    const note = (await t.req('/api/notifications')).json.find((n: any) => n.title.includes('bonus'));
    assert.deepEqual([note?.title, note?.body], ['🎉 You got 10 bonus points', 'Helped carry groceries']);
  } finally {
    await t.restore();
  }
});

test('bonus points: an earlier date counts on that day, not today', async () => {
  const t = await setup();
  try {
    assert.equal((await t.give({ memberId: t.maya.id, points: 4, date: t.yesterday })).status, 201);
    const maya = (await t.req('/api/members')).json.find((m: any) => m.id === t.maya.id);
    assert.equal(maya.balance, 4);
    assert.equal(maya.pointsToday, 0);
    assert.equal((await t.req('/api/leaderboard?period=today')).json.find((e: any) => e.memberId === t.maya.id).points, 0);
    assert.equal((await t.req(`/api/members/${t.maya.id}/stats?period=today`)).json.previous.pointsEarned, 4);
  } finally {
    await t.restore();
  }
});

test("bonus points: parent devices only; kids' devices and wall screens get 403", async () => {
  const t = await setup();
  try {
    const ok = (await t.give({ memberId: t.leo.id, points: 5 })).json.award;
    for (const key of [t.leoKey, t.wallKey]) {
      assert.equal((await t.give({ memberId: t.leo.id, points: 5 }, key)).status, 403);
      assert.equal((await t.req(`/api/points/awards/${ok.id}`, 'DELETE', undefined, key)).status, 403);
      assert.equal((await t.req('/api/points/awards', 'GET', undefined, key)).status, 403);
    }
    assert.equal((await t.req(`/api/members/${t.leo.id}/points`)).json.balance, 5);
  } finally {
    await t.restore();
  }
});

test('bonus points: off with chores', async () => {
  const t = await setup();
  try {
    const features = (await t.req('/api/settings')).json.features;
    assert.equal((await t.req('/api/settings', 'PATCH', { features: { ...features, chores: false } })).status, 200);
    assert.equal((await t.give({ memberId: t.leo.id, points: 5 })).status, 403);
    assert.equal((await t.req('/api/points/awards')).status, 403);
  } finally {
    await t.restore();
  }
});

test('bonus points: whole points 1-500, a short note, no future dates, a real member', async () => {
  const t = await setup();
  try {
    for (const points of [0, -5, 501, 2.5]) assert.equal((await t.give({ memberId: t.leo.id, points })).status, 400, `points ${points}`);
    assert.equal((await t.give({ memberId: t.leo.id, points: 5, note: 'x'.repeat(81) })).status, 400);
    assert.equal((await t.give({ memberId: t.leo.id, points: 5, date: '2026-13-01' })).status, 400);
    assert.equal((await t.give({ memberId: t.leo.id, points: 5, date: '2999-01-01' })).status, 400);
    assert.equal((await t.give({ memberId: 'nobody', points: 5 })).status, 404);
    const blank = await t.give({ memberId: t.leo.id, points: 500, note: '   ' });
    assert.deepEqual([blank.status, blank.json.award.note], [201, null]);
  } finally {
    await t.restore();
  }
});

test('bonus points: a parent can take one back; only bonus entries', async () => {
  const t = await setup();
  try {
    const a = (await t.give({ memberId: t.leo.id, points: 10 })).json.award;
    const del = await t.req(`/api/points/awards/${a.id}`, 'DELETE');
    assert.deepEqual([del.status, del.json.balance], [200, 0]);
    assert.equal((await t.req(`/api/points/awards/${a.id}`, 'DELETE')).status, 404);
    assert.equal((await t.req(`/api/members/${t.leo.id}/points`)).json.entries.length, 0);
    await t.flush();
    assert.deepEqual(t.events().find((e) => e.type === 'points.removed')?.data, { id: a.id, memberId: t.leo.id, points: 10 });

    // A sticker-pack purchase isn't an award, so it can't be removed here.
    t.db.prepare("INSERT INTO point_entries (id, member_id, amount, reason, ref, at) VALUES ('buy', ?, -5, 'sticker_pack', 'sweets', ?)").bind(t.leo.id, new Date().toISOString()).run();
    assert.equal((await t.req('/api/points/awards/buy', 'DELETE')).status, 404);
  } finally {
    await t.restore();
  }
});

test('bonus points: export and import keep the note', async () => {
  const t = await setup();
  try {
    await t.give({ memberId: t.leo.id, points: 7, note: 'Kind to his sister' });
    const file = (await t.req('/api/export')).json;
    const entry = file.pointEntries.find((e: any) => e.reason === 'bonus');
    assert.equal(entry.note, 'Kind to his sister');
    t.db.prepare('DELETE FROM point_entries').run();
    assert.ok((await t.req('/api/import', 'POST', file)).status < 300);
    const back = (await t.req(`/api/points/awards?memberId=${t.leo.id}`)).json;
    assert.deepEqual(back.map((a: any) => [a.points, a.note]), [[7, 'Kind to his sister']]);
  } finally {
    await t.restore();
  }
});
