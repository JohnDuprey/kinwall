// Parent approval for chores: pending completions from wall screens / kids' devices, approve
// ("points exactly as a normal completion"), "Not yet" with a note, and who gets told.
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
  // Every outbound fetch (webhooks, web push) is captured instead of sent.
  const sent: { url: string; body: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    sent.push({ url: String(url), body: typeof init.body === 'string' ? init.body : '' });
    return new Response('', { status: 201 });
  }) as typeof fetch;
  const restore = async () => {
    await flush(); // nothing in the background may reach the next test's fetch
    globalThis.fetch = realFetch;
  };
  const events = () => sent.filter((s) => new URL(s.url).origin === 'https://hooks.example.com').map((s) => JSON.parse(s.body) as { type: string; data: any });
  const pushes = (device: string) => sent.filter((s) => s.url === `https://fcm.googleapis.com/fcm/send/${device}`).length;

  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const deviceKey = async (name: string, scope: 'display' | 'admin', owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    // A push subscription on this device.
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
    assert.equal((await req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh, auth } }, deviceName: name }, k.key)).status < 300, true);
    return k.key as string;
  };
  const leoKey = await deviceKey('leo-tablet', 'display', leo.id);
  const mayaKey = await deviceKey('maya-tablet', 'display', maya.id);
  await deviceKey('parent-phone', 'admin');
  assert.equal((await req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const chore = async (body: Record<string, unknown>) => (await req('/api/chores', 'POST', { rrule: 'FREQ=DAILY', dueDate: yesterday, points: 10, memberId: leo.id, ...body })).json;
  const day = async (id: string, date = today, key = ADMIN) => (await req(`/api/chores/day?date=${date}`, 'GET', undefined, key)).json.find((c: any) => c.id === id);
  const tick = (id: string, key: string, date = today) => req(`/api/chores/${id}/complete`, 'POST', { date }, key);
  return { db, req, flush, restore, events, pushes, leo, maya, leoKey, mayaKey, today, yesterday, chore, day, tick };
}

test('approval: pending vs approved by key scope, chore setting (both ways) and the person default', async () => {
  const t = await setup();
  try {
    const needs = await t.chore({ title: 'Make bed', needsApproval: true });
    assert.equal(needs.needsApproval, true);
    assert.equal((await t.tick(needs.id, t.leoKey)).json.pending, true);
    assert.deepEqual([(await t.day(needs.id)).completed, (await t.day(needs.id)).pending], [false, true]);

    // A parent's device is approved straight away.
    const parent = await t.chore({ title: 'Feed cat', needsApproval: true });
    assert.equal((await t.tick(parent.id, 'kw_test_admin')).json.pending, false);
    assert.equal((await t.day(parent.id)).completed, true);

    // null follows the person: Leo's default is off, then on.
    const follows = await t.chore({ title: 'Brush teeth' });
    assert.equal(follows.needsApproval, null);
    assert.equal((await t.tick(follows.id, t.leoKey)).json.pending, false);
    const member = await t.req(`/api/members/${t.leo.id}`, 'PATCH', { needsApproval: true });
    assert.equal(member.json.needsApproval, true);
    const follows2 = await t.chore({ title: 'Tidy desk' });
    assert.equal((await t.tick(follows2.id, t.leoKey)).json.pending, true);
    // The chore's own "no" beats the person's "yes".
    const never = await t.chore({ title: 'Water plants', needsApproval: false });
    assert.equal((await t.tick(never.id, t.leoKey)).json.pending, false);
  } finally {
    await t.restore();
  }
});

test('approval: pending earns nothing and counts nowhere; approve awards once and emits chore.completed only then', async () => {
  const t = await setup();
  try {
    const c = await t.chore({ title: 'Make bed', needsApproval: true });
    await t.tick(c.id, t.leoKey);
    await t.flush();
    const leo = async () => (await t.req('/api/members')).json.find((m: any) => m.id === t.leo.id);
    const board = async () => (await t.req('/api/leaderboard?period=week')).json.find((e: any) => e.memberId === t.leo.id);
    assert.deepEqual([(await leo()).pointsToday, (await leo()).balance], [0, 0]);
    assert.deepEqual([(await board()).points, (await board()).completed, (await board()).streak], [0, 0, 0]);
    assert.deepEqual(t.events().map((e) => e.type).filter((x) => x.startsWith('chore.')), ['chore.changed', 'chore.pending']);
    assert.equal((await t.req('/api/board')).json.chores.find((r: any) => r.memberId === t.leo.id).pending, 1);
    const snap = (await t.req(`/api/snapshot?member=${t.leo.id}`)).json;
    assert.deepEqual([snap.chores[0].done, snap.chores[0].pending], [false, true]);

    const pending = (await t.req('/api/chores/pending')).json;
    assert.deepEqual(pending.map((p: any) => [p.choreId, p.memberId, p.points]), [[c.id, t.leo.id, 10]]);
    const ok = await t.req(`/api/chores/${c.id}/approve`, 'POST', { date: t.today });
    assert.deepEqual(ok.json, { ok: true, points: 10 });
    assert.equal((await t.req(`/api/chores/${c.id}/approve`, 'POST', { date: t.today })).status, 404, 'approves once');
    await t.flush();
    const completed = t.events().filter((e) => e.type === 'chore.completed');
    assert.equal(completed.length, 1);
    assert.deepEqual(completed[0].data, { id: c.id, date: t.today, title: 'Make bed', memberId: t.leo.id, points: 10 });
    assert.deepEqual([(await leo()).pointsToday, (await leo()).balance], [10, 10]);
    assert.deepEqual([(await board()).points, (await board()).completed, (await board()).streak], [10, 1, 1]);
    assert.equal((await t.day(c.id)).completed, true);
  } finally {
    await t.restore();
  }
});

test('approval: late credit is judged by when it was ticked, not when it was approved', async () => {
  const t = await setup();
  try {
    const c = await t.chore({ title: 'Make bed', needsApproval: true });
    // Ticked yesterday, on the day (a parent approves it today): full points.
    await t.tick(c.id, t.leoKey, t.yesterday);
    t.db.prepare('UPDATE chore_completions SET completed_at = ? WHERE chore_id = ?').bind(`${t.yesterday}T18:00:00.000Z`, c.id).run();
    assert.equal((await t.req('/api/chores/pending')).json[0].points, 10);
    assert.equal((await t.req(`/api/chores/${c.id}/approve`, 'POST', { date: t.yesterday })).json.points, 10);
    // Ticked today for yesterday: late, 50% by default.
    const d = await t.chore({ title: 'Tidy desk', needsApproval: true });
    await t.tick(d.id, t.leoKey, t.yesterday);
    assert.equal((await t.req(`/api/chores/${d.id}/approve`, 'POST', { date: t.yesterday })).json.points, 5);
  } finally {
    await t.restore();
  }
});

test('approval: parents are told about a pending chore (once per chore and day); "Not yet" removes it, keeps the note and tells only the kid', async () => {
  const t = await setup();
  try {
    const c = await t.chore({ title: 'Make bed', needsApproval: true });
    await t.tick(c.id, t.leoKey);
    await t.req(`/api/chores/${c.id}/complete?date=${t.today}`, 'DELETE', undefined, t.leoKey); // the kid can untick while pending
    assert.deepEqual((await t.req('/api/chores/pending')).json, []);
    await t.tick(c.id, t.leoKey);
    await t.flush();
    assert.deepEqual([t.pushes('parent-phone'), t.pushes('leo-tablet'), t.pushes('maya-tablet')], [1, 0, 0]);
    const feed = (await t.req('/api/notifications')).json;
    assert.ok(JSON.stringify(feed).includes('Leo finished Make bed. Approve?'));

    // Display keys can't approve or reject.
    assert.equal((await t.req(`/api/chores/${c.id}/approve`, 'POST', { date: t.today }, t.leoKey)).status, 403);
    assert.equal((await t.req(`/api/chores/${c.id}/reject`, 'POST', { date: t.today }, t.leoKey)).status, 403);
    assert.equal((await t.req('/api/chores/pending', 'GET', undefined, t.leoKey)).status, 403);

    assert.equal((await t.req(`/api/chores/${c.id}/reject`, 'POST', { date: t.today, note: 'Please make the bed properly' })).status, 200);
    await t.flush();
    const card = await t.day(c.id, t.today, t.leoKey);
    assert.deepEqual([card.completed, card.pending, card.rejection?.note], [false, false, 'Please make the bed properly']);
    assert.deepEqual([t.pushes('parent-phone'), t.pushes('leo-tablet'), t.pushes('maya-tablet')], [1, 1, 0]);
    const rejected = t.events().find((e) => e.type === 'chore.rejected');
    assert.deepEqual(rejected?.data, { id: c.id, date: t.today, title: 'Make bed', memberId: t.leo.id, note: 'Please make the bed properly' });
    assert.equal(t.events().some((e) => e.type === 'chore.completed'), false);
    assert.equal((await t.req(`/api/chores/${c.id}/reject`, 'POST', { date: t.today })).status, 404, 'nothing waiting any more');

    // Ticking again clears the note.
    await t.tick(c.id, t.leoKey);
    assert.deepEqual([(await t.day(c.id)).pending, (await t.day(c.id)).rejection], [true, null]);
  } finally {
    await t.restore();
  }
});

test('approval: activity chores auto-approve timed play unless the chore says otherwise', async () => {
  const t = await setup();
  try {
    const now = new Date().toISOString();
    t.db.prepare("INSERT INTO plugins (id, name, version, manifest, enabled, installed_at, updated_at) VALUES ('words', 'Sight words', '1.0.0', '{}', 1, ?, ?)").bind(now, now).run();
    const auto = await t.chore({ title: 'Words', needsApproval: true, pluginId: 'words', pluginMinutes: 1 });
    const strict = await t.chore({ title: 'More words', pluginId: 'words', pluginMinutes: 1, approveTimedPlay: true });
    assert.equal(strict.approveTimedPlay, true);
    const play = (await t.req('/api/plugins/words/playtime', 'POST', { member: t.leo.id, seconds: 60 }, t.leoKey)).json;
    assert.deepEqual(play.map((p: any) => [p.title, p.justCompleted]), [['Words', true], ['More words', true]]);
    assert.deepEqual([(await t.day(auto.id)).completed, (await t.day(strict.id)).pending], [true, true]);
    // "Not yet" sticks: more play doesn't send it straight back.
    assert.equal((await t.req(`/api/chores/${strict.id}/reject`, 'POST', { date: t.today })).status, 200);
    const again = (await t.req('/api/plugins/words/playtime', 'POST', { member: t.leo.id, seconds: 30 }, t.leoKey)).json;
    assert.equal(again.find((p: any) => p.title === 'More words').justCompleted, false);
    assert.equal((await t.day(strict.id)).pending, false);
  } finally {
    await t.restore();
  }
});

test("approval: an activity chore whose activity is removed or turned off waits for a parent's OK off a parent's device", async () => {
  const t = await setup();
  try {
    const now = new Date().toISOString();
    for (const id of ['gone', 'off']) t.db.prepare("INSERT INTO plugins (id, name, version, manifest, enabled, installed_at, updated_at) VALUES (?, ?, '1.0.0', '{}', 1, ?, ?)").bind(id, id, now, now).run();
    const gone = await t.chore({ title: 'Spelling', pluginId: 'gone', pluginMinutes: 1 });
    const off = await t.chore({ title: 'Math', pluginId: 'off', pluginMinutes: 1 });
    const parent = await t.chore({ title: 'Reading', pluginId: 'gone', pluginMinutes: 1 });
    t.db.prepare("DELETE FROM plugins WHERE id = 'gone'").run();
    t.db.prepare("UPDATE plugins SET enabled = 0 WHERE id = 'off'").run();
    assert.equal((await t.day(gone.id)).activity.available, false);
    // A kid's device: no free points for an activity that isn't there; a parent okays it.
    assert.equal((await t.tick(gone.id, t.leoKey)).json.pending, true);
    assert.equal((await t.tick(off.id, t.leoKey)).json.pending, true);
    assert.deepEqual([(await t.day(gone.id)).completed, (await t.day(off.id)).completed], [false, false]);
    // A parent's device ticks it off as usual.
    assert.equal((await t.tick(parent.id, 'kw_test_admin')).json.pending, false);
    assert.equal((await t.day(parent.id)).completed, true);
  } finally {
    await t.restore();
  }
});

test('approval: settings and completion status survive export -> import', async () => {
  const t = await setup();
  try {
    await t.req(`/api/members/${t.leo.id}`, 'PATCH', { needsApproval: true });
    const c = await t.chore({ title: 'Make bed', needsApproval: false, approveTimedPlay: true });
    const d = await t.chore({ title: 'Tidy desk' });
    await t.tick(d.id, t.leoKey);
    const file = (await t.req('/api/export')).json;
    assert.equal(file.members.find((m: any) => m.id === t.leo.id).needsApproval, true);
    assert.deepEqual(file.chores.map((ch: any) => [ch.id, ch.needsApproval, ch.approveTimedPlay]), [[c.id, false, true], [d.id, null, false]]);
    assert.equal(file.choreCompletions[0].status, 'pending');

    const u = await setup();
    try {
      assert.equal((await u.req('/api/import', 'POST', file)).status, 200);
      const again = (await u.req('/api/export')).json;
      assert.deepEqual(again.chores.map((ch: any) => [ch.id, ch.needsApproval, ch.approveTimedPlay]), file.chores.map((ch: any) => [ch.id, ch.needsApproval, ch.approveTimedPlay]));
      assert.equal(again.members.find((m: any) => m.id === t.leo.id).needsApproval, true);
      assert.deepEqual(again.choreCompletions.map((cc: any) => [cc.choreId, cc.status, cc.pointsAwarded]), [[d.id, 'pending', 0]]);
    } finally {
      await u.restore();
    }
  } finally {
    await t.restore();
  }
});

test('completing: only a real day the chore is due on, and from a wall or kid device only a recent one', async () => {
  const t = await setup();
  try {
    const points = async () => (await t.req(`/api/members/${t.leo.id}/points`)).json.balance;
    const c = await t.chore({ title: 'Make bed' });
    const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

    // Not dates: nothing is written, whoever asks.
    for (const date of ['zzz', `${t.today} `, '2026-13-45', '']) {
      assert.equal((await t.tick(c.id, t.leoKey, date)).status, 400, `leo ${JSON.stringify(date)}`);
      assert.equal((await t.tick(c.id, ADMIN, date)).status, 400, `admin ${JSON.stringify(date)}`);
    }
    // Far ahead or long ago from a kid's device: refused (a parent's device may still fix up an old day).
    assert.equal((await t.tick(c.id, t.leoKey, '2099-01-01')).status, 400);
    assert.equal((await t.tick(c.id, t.leoKey, day(30))).status, 400);
    assert.equal((await t.tick(c.id, t.leoKey, day(-30))).status, 400);
    assert.equal(await points(), 0);
    // A day the chore isn't due on (before it started): refused for everyone.
    assert.equal((await t.tick(c.id, ADMIN, day(-30))).status, 400);
    const once = await t.chore({ title: 'Wash car', rrule: null, dueDate: t.today });
    assert.equal((await t.tick(once.id, t.leoKey, t.yesterday)).status, 400);
    assert.equal((await t.tick(once.id, ADMIN, t.yesterday)).status, 400);
    // A paused chore: refused.
    const paused = await t.chore({ title: 'Rake leaves', active: false });
    assert.equal((await t.tick(paused.id, t.leoKey)).status, 400);
    assert.equal(await points(), 0);

    // Today and yesterday (late credit) still work.
    assert.equal((await t.tick(c.id, t.leoKey)).status, 200);
    assert.equal((await t.tick(c.id, t.leoKey, t.yesterday)).status, 200);
    assert.equal(await points(), 15);
    // Undo takes a real date too.
    assert.equal((await t.req(`/api/chores/${c.id}/complete?date=zzz`, 'DELETE', undefined, t.leoKey)).status, 400);
  } finally {
    await t.restore();
  }
});

test('approval: a wall screen can\'t get a kid an approved completion by ticking first as nobody or as someone else', async () => {
  const t = await setup();
  try {
    await t.req(`/api/members/${t.leo.id}`, 'PATCH', { needsApproval: true });
    const wall = (await t.req('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' })).json.key as string;
    const points = async () => (await t.req(`/api/members/${t.leo.id}/points`)).json.balance;
    const tickAs = (id: string, memberId?: string) => t.req(`/api/chores/${id}/complete`, 'POST', { date: t.today, memberId }, wall);

    // An Anyone chore: ticked as nobody (approved, nobody's points), then re-ticked as Leo.
    const anyone = await t.chore({ title: 'Take out trash', memberId: null });
    assert.equal((await tickAs(anyone.id)).json.pending, false);
    assert.equal((await tickAs(anyone.id, t.leo.id)).json.pending, true);
    assert.deepEqual([(await t.day(anyone.id)).completed, (await t.day(anyone.id)).pending], [false, true]);
    // Ticked as Maya (no approval needed), then re-ticked as Leo.
    const swap = await t.chore({ title: 'Set table', memberId: null });
    assert.equal((await tickAs(swap.id, t.maya.id)).json.pending, false);
    assert.equal((await tickAs(swap.id, t.leo.id)).json.pending, true);
    assert.equal(await points(), 0);

    // What a parent approved stays approved when the same kid's tick comes in again.
    const done = await t.chore({ title: 'Make bed' });
    assert.equal((await t.tick(done.id, ADMIN)).json.pending, false);
    assert.equal((await tickAs(done.id, t.leo.id)).json.pending, false);
    assert.equal(await points(), 10);
  } finally {
    await t.restore();
  }
});
