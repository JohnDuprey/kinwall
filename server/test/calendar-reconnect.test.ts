// A Google or Microsoft calendar whose sign-in was revoked (invalid_grant): plain words on the
// calendar, and one note to the grown-ups (bell + push to parent devices, never kids' devices),
// not repeated until the calendar has synced again and then fails again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { encryptConfig } from '../src/crypto.ts';
import { syncCalendarTick } from '../src/sync.ts';
import { runNotifications } from '../src/notify.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const NOON = new Date('2026-10-08T12:00:00Z'); // outside night hours

async function setup(kind: 'google' | 'microsoft' = 'google') {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  let token: { status: number; body: string } = { status: 400, body: '{"error":"invalid_grant"}' };
  const sent: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: unknown) => {
    const url = u instanceof Request ? u.url : String(u);
    if (url.startsWith('https://fcm.googleapis.com/')) { sent.push(url); return new Response('', { status: 201 }); }
    // A good refresh expires at once, so the next tick asks again.
    if (url.includes('oauth2.googleapis.com/token') || url.includes('login.microsoftonline.com')) {
      return token.status === 200 ? Response.json({ access_token: 'fresh', expires_in: 0 }) : new Response(token.body, { status: token.status });
    }
    if (url.includes('/calendarList')) return Response.json({ items: [{ id: 'cal1', accessRole: 'owner' }] });
    if (url.includes('/me/calendars')) return Response.json({ value: [{ id: 'cal1', name: 'Family', canEdit: true }] });
    if (url.includes('/events?') || url.includes('/calendarView')) return Response.json({ items: [], value: [] });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const restore = () => { globalThis.fetch = realFetch; };
  const pushes = (device: string) => sent.filter((s) => s === `https://fcm.googleapis.com/fcm/send/${device}`).length;

  const sam = (await req('/api/members', 'POST', { name: 'Sam', color: '#57e', grownUp: true })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const deviceKey = async (name: string, scope: 'display' | 'admin', owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
    assert.ok((await req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh, auth } }, deviceName: name }, k.key)).status < 300);
    return k.key as string;
  };
  const leoKey = await deviceKey('leo-tablet', 'display', leo.id);
  await deviceKey('parent-phone', 'admin');

  // An expired access token, so every tick asks the token endpoint first.
  await db.prepare("INSERT INTO accounts (id, kind, name, config, created_at) VALUES ('a1', ?, 'leo@example.com', ?, '2026-01-01')")
    .bind(kind, await encryptConfig(env, 'a1', { access_token: 'old', refresh_token: 'r', expires_at: 0 })).run();
  const addCalendar = async (id: string, name: string, memberIds: string[]) => {
    await db.prepare("INSERT INTO calendars (id, kind, account_id, remote_id, name, member_ids, config, writable, enabled) VALUES (?, ?, 'a1', 'cal1', ?, ?, ?, 1, 1)")
      .bind(id, kind, name, JSON.stringify(memberIds), await encryptConfig(env, id, {})).run();
  };
  const calendar = async (id: string) => (await req('/api/calendars')).json.find((c: any) => c.id === id);
  const bell = async (key = ADMIN) => (await req('/api/notifications', 'GET', undefined, key)).json.filter((n: any) => n.url === '/#/settings?tab=calendars');
  const setToken = (t: typeof token) => { token = t; };
  // Each tick: sync, then the notification ticker.
  const tick = async (id: string) => { await syncCalendarTick(env, id); await runNotifications(env, NOON); };
  return { db, env, req, restore, pushes, sam, leo, leoKey, addCalendar, calendar, bell, setToken, tick };
}

test('calendar reconnect: a revoked Google sign-in says so in plain words, with a reason code', async () => {
  const t = await setup();
  try {
    await t.addCalendar('c1', 'leo@example.com', [t.leo.id]);
    await t.addCalendar('c2', 'Soccer', []);
    await syncCalendarTick(t.env, 'c1');
    await syncCalendarTick(t.env, 'c2');
    const leo = await t.calendar('c1');
    assert.equal(leo.lastError, "Google stopped letting Kinwall see Leo's calendar. Reconnect it to start syncing again.");
    assert.equal(leo.lastErrorCode, 'revoked');
    assert.equal(leo.syncFailures, 1);
    assert.equal((await t.calendar('c2')).lastError, 'Google stopped letting Kinwall see the Soccer calendar. Reconnect it to start syncing again.');

    // A passing failure isn't "revoked".
    t.setToken({ status: 503, body: '' });
    await syncCalendarTick(t.env, 'c1');
    const down = await t.calendar('c1');
    assert.equal(down.lastErrorCode, null);
    assert.match(down.lastError, /HTTP 503/);
    assert.doesNotMatch(down.lastError, /Reconnect/);

    // Synced again: the error and its code are gone.
    t.setToken({ status: 200, body: '' });
    await syncCalendarTick(t.env, 'c1');
    const ok = await t.calendar('c1');
    assert.deepEqual([ok.lastError, ok.lastErrorCode, ok.syncFailures], [null, null, 0]);
  } finally {
    t.restore();
  }
});

test('calendar reconnect: Microsoft words it the same way', async () => {
  const t = await setup('microsoft');
  try {
    await t.addCalendar('c1', 'Family', [t.sam.id]);
    await syncCalendarTick(t.env, 'c1');
    const cal = await t.calendar('c1');
    assert.equal(cal.lastError, "Microsoft stopped letting Kinwall see Sam's calendar. Reconnect it to start syncing again.");
    assert.equal(cal.lastErrorCode, 'revoked');
  } finally {
    t.restore();
  }
});

test('calendar reconnect: grown-ups are told once, not on the 2nd or 3rd failure; again after it recovers and fails again', async () => {
  const t = await setup();
  try {
    await t.addCalendar('c1', 'leo@example.com', [t.leo.id]);
    await t.tick('c1');
    assert.equal(t.pushes('parent-phone'), 1, "the parent's phone");
    assert.equal(t.pushes('leo-tablet'), 0, "never Leo's own device");
    const feed = await t.bell();
    assert.deepEqual(feed.map((n: any) => [n.title, n.body]), [["Leo's calendar stopped syncing", 'Tap to reconnect it.']]);
    assert.deepEqual(feed[0].memberIds, [t.sam.id], 'the grown-ups');
    assert.deepEqual(await t.bell(t.leoKey), [], "not in the bell on Leo's device");

    await t.tick('c1');
    await t.tick('c1');
    assert.equal((await t.calendar('c1')).syncFailures, 3);
    assert.equal(t.pushes('parent-phone'), 1, 'no repeat on the 2nd or 3rd failure');
    assert.equal((await t.bell()).length, 1);

    // A passing failure in between doesn't count as recovering.
    t.setToken({ status: 503, body: '' });
    await t.tick('c1');
    t.setToken({ status: 400, body: '{"error":"invalid_grant"}' });
    await t.tick('c1');
    assert.equal(t.pushes('parent-phone'), 1, 'still not synced since: no repeat');

    t.setToken({ status: 200, body: '' });
    await t.tick('c1');
    t.setToken({ status: 400, body: '{"error":"invalid_grant"}' });
    await t.tick('c1');
    assert.equal(t.pushes('parent-phone'), 2, 'synced, then revoked again: a new note');
    assert.equal(t.pushes('leo-tablet'), 0);
    assert.equal((await t.bell()).length, 2);
  } finally {
    t.restore();
  }
});

test('calendar reconnect: a passing failure tells no one; night hours hold the note until morning', async () => {
  const t = await setup();
  try {
    await t.addCalendar('c1', 'Soccer', []);
    t.setToken({ status: 503, body: '' });
    await t.tick('c1');
    await t.tick('c1');
    assert.equal(t.pushes('parent-phone'), 0);
    assert.deepEqual(await t.bell(), []);

    await t.req('/api/settings', 'PATCH', { quietFrom: '22:00', quietTo: '07:00' });
    t.setToken({ status: 400, body: '{"error":"invalid_grant"}' });
    await syncCalendarTick(t.env, 'c1');
    await runNotifications(t.env, new Date('2026-10-08T02:00:00Z'));
    assert.equal(t.pushes('parent-phone'), 0, 'held at night');
    assert.deepEqual(await t.bell(), []);
    await runNotifications(t.env, NOON);
    assert.equal(t.pushes('parent-phone'), 1, 'sent once night hours end');
    assert.deepEqual((await t.bell()).map((n: any) => n.title), ['The Soccer calendar stopped syncing']);
  } finally {
    t.restore();
  }
});

test('calendar reconnect: a turned-off calendar tells no one', async () => {
  const t = await setup();
  try {
    await t.addCalendar('c1', 'Soccer', []);
    await syncCalendarTick(t.env, 'c1');
    await t.db.prepare("UPDATE calendars SET enabled = 0 WHERE id = 'c1'").run();
    await runNotifications(t.env, NOON);
    assert.equal(t.pushes('parent-phone'), 0);
  } finally {
    t.restore();
  }
});

test('calendar reconnect: signing in again syncs the account calendars at once, and the message clears', async () => {
  const t = await setup();
  try {
    await t.addCalendar('c1', 'leo@example.com', [t.leo.id]);
    await t.tick('c1');
    const { saveOAuthAccount } = await import('../src/routes/oauth.ts');
    const { syncAccountCalendars } = await import('../src/sync.ts');
    t.setToken({ status: 200, body: '' });
    assert.equal(await saveOAuthAccount(t.env, 'google', 'Leo@example.com', { access_token: 'new', refresh_token: 'r2', expires_at: 0 }), 'a1', 'the same account, its tokens replaced');
    await syncAccountCalendars(t.env, 'a1');
    const cal = await t.calendar('c1');
    assert.deepEqual([cal.lastError, cal.lastErrorCode], [null, null]);
  } finally {
    t.restore();
  }
});
