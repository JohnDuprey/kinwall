// Last night's check-in: the evening check (goal check, "How drained do you feel?") for day D stays
// open after midnight until noon on D+1, their morning Temp check, or a skip, whichever comes first.
// Answers stay on D. A missed one gets one generic morning push to their own devices.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const D = '2026-09-29'; // last night
const NEXT = '2026-09-30';
// Household time in New York (EDT, UTC-4): 23:30 on D is already NEXT in UTC, so the household
// day, never the UTC one, decides which night is "last night".
const at = (date: string, local: string) => new Date(`${date}T${local}:00-04:00`);
const PARENTS = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '23:00', journal: true, battery: false };
const KIDS = { ...PARENTS, eveningTime: '21:00', battery: true };
const SECRET = 'zz-secret-note';

async function setup() {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: at(D, '18:00') });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY } as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#5B8DEF', grownUp: true, tempCheck: PARENTS })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', tempCheck: KIDS })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#F5A623' })).json;
  // A kid's paired device, a shared wall (no owner), or a grown-up's own phone (full access).
  const key = async (owner?: string, scope = 'display') => {
    const k = (await req('/api/keys', 'POST', { name: `k-${owner ?? 'wall'}`, scope })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const rows = () => db.prepare('SELECT member_id, date, followup, drained, private FROM temp_checks ORDER BY date').all<Record<string, unknown>>().results;
  const clock = (date: string, local: string) => mock.timers.setTime(at(date, local).getTime());
  return { env, db, req, alex, maya, leo, key, rows, clock };
}
const tc = (id: string, date?: string) => `/api/members/${id}/temp-check${date ? `?date=${date}` : ''}`;

test('last night: after midnight the evening check stays open for D, answers are stored under D', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, maya, rows, clock, key } = await setup();
  const alexs = await key(alex.id, 'admin'); // grown-ups' journals are private by default: his own phone
  await req(tc(alex.id), 'PUT', { goal: 'Call the plumber' });
  await req(tc(maya.id), 'PUT', { goal: 'Read 20 pages' });
  clock(D, '23:30');
  assert.equal((await req(tc(alex.id))).json.followupOpen, true, '23:00 evening: open before midnight');
  assert.equal((await req(tc(alex.id))).json.lastNight, null);

  clock(NEXT, '00:40');
  const today = (await req(tc(alex.id))).json;
  assert.deepEqual([today.date, today.followupOpen, today.lastNight], [NEXT, false, { date: D, pending: true }]);
  const lastNight = (await req(tc(alex.id, D))).json;
  assert.deepEqual([lastNight.date, lastNight.goal, lastNight.followupOpen], [D, 'Call the plumber', true]);
  const saved = await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'yes', helped: 'Called at lunch' } }, alexs);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual([saved.json.date, saved.json.followup.outcome, saved.json.followupOpen], [D, 'yes', true]);
  assert.deepEqual(rows().map((r) => [r.member_id, r.date]).sort(), [[alex.id, D], [maya.id, D]].sort(), 'nothing written for the new day');
  assert.deepEqual((await req(tc(alex.id))).json.lastNight, { date: D, pending: false }, 'answered: still editable, nothing to remind');
  assert.equal((await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'partly' } }, alexs)).json.followup.outcome, 'partly', 'editable');

  // 21:00 evening with the battery: the goal check and "How drained?" both carry over.
  assert.deepEqual((await req(tc(maya.id))).json.lastNight, { date: D, pending: true });
  assert.equal((await req(tc(maya.id, D), 'PUT', { drained: 'low' })).status, 200);
  assert.deepEqual((await req(tc(maya.id))).json.lastNight, { date: D, pending: true }, 'the goal check is still waiting');
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'no' } })).status, 200);
  assert.deepEqual((await req(tc(maya.id))).json.lastNight, { date: D, pending: false });
  const journal = (await req(`/api/members/${maya.id}/journal?to=${NEXT}&days=2`)).json;
  assert.equal(journal.days.find((d: any) => d.date === D).tempCheck.followup.outcome, 'no', 'the journal shows it on D');
});

test('last night: refused outside the window (noon, further back, the future, other fields from a display)', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, maya, key, clock } = await setup();
  await req(tc(alex.id), 'PUT', { goal: 'Call the plumber' });
  await req(tc(alex.id, '2026-09-28'), 'PUT', { goal: 'Older goal' });
  clock(NEXT, '00:40');
  assert.equal((await req(tc(alex.id, '2026-09-28'), 'PUT', { followup: { outcome: 'yes' } })).status, 403, 'two nights back');
  assert.equal((await req(tc(alex.id, '2026-10-01'), 'PUT', { followup: { outcome: 'yes' } })).status, 403, 'the future');
  assert.equal((await req(tc(alex.id, '2026-09-28'))).json.followupOpen, false);
  const wall = await key();
  assert.equal((await req(tc(maya.id, D), 'PUT', { sleep: 'good' }, wall)).status, 403, 'a display answers only the evening check for last night');
  clock(NEXT, '12:00');
  assert.equal((await req(tc(alex.id))).json.lastNight, null, 'closed at noon');
  assert.equal((await req(tc(alex.id, D))).json.followupOpen, false);
  assert.equal((await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403);
  assert.equal((await req(tc(alex.id, D), 'PUT', { lastNightSkipped: true })).status, 403, 'nothing to skip');
});

test('last night: the morning Temp check or a skip closes it for good', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, maya, clock } = await setup();
  await req(tc(alex.id), 'PUT', { goal: 'Call the plumber' });
  await req(tc(maya.id), 'PUT', { goal: 'Read 20 pages' });
  clock(NEXT, '07:30');
  // Answering last night doesn't count as this morning's check-in.
  await req(tc(maya.id, D), 'PUT', { drained: 'ok' });
  assert.deepEqual((await req(tc(maya.id))).json.answered, { sleep: false, feelings: false, goal: false, followup: false, drained: false });
  // The morning check-in starts their day: last night closes.
  assert.equal((await req(tc(maya.id), 'PUT', { sleep: 'good' })).status, 200);
  assert.equal((await req(tc(maya.id))).json.lastNight, null);
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403);
  // Skip: closed, and stays closed.
  const skipped = await req(tc(alex.id, D), 'PUT', { lastNightSkipped: true });
  assert.equal(skipped.status, 200, JSON.stringify(skipped.json));
  assert.equal(skipped.json.followupOpen, false);
  assert.equal((await req(tc(alex.id))).json.lastNight, null);
  assert.equal((await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403);
});

test('last night: owner and privacy rules are unchanged', async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, maya, leo, key, rows, clock } = await setup();
  await db.prepare('UPDATE members SET journal_private_allowed = 1, journal_private = 1 WHERE id = ?').bind(maya.id).run();
  await req(tc(maya.id), 'PUT', { goal: 'Read 20 pages' });
  const mayas = await key(maya.id), leos = await key(leo.id), wall = await key();
  clock(NEXT, '00:40');
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'yes' } }, leos)).status, 403, "someone else's device");
  assert.equal((await req(tc(maya.id, D), 'PUT', { drained: 'low' }, wall)).status, 403, 'drained never from a wall');
  assert.equal((await req(tc(maya.id), 'GET', undefined, wall)).json.lastNight?.pending, true, 'the wall may still ask the goal check');
  const own = await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'partly', hindered: SECRET } }, mayas);
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal(own.json.followup.hindered, SECRET);
  assert.equal(rows().find((r) => r.member_id === maya.id)!.private, 1, 'written in her private journal: the day is private');
  assert.doesNotMatch(JSON.stringify(rows()), /zz-secret/, 'sealed');
  const parent = (await req(tc(maya.id, D))).json;
  assert.deepEqual([parent.followupHidden, parent.followup.hindered], [true, null]);
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403, 'only her own devices change it');
});

// Push capture: an RFC 8291 decryptor so the test reads what each device was sent.
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}
const expand = async (prk: Uint8Array, info: Uint8Array, n: number) => (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, n);
type Sub = { privateKey: CryptoKey; p256dh: string; auth: string };
async function readPush(body: Uint8Array, sub: Sub): Promise<{ title: string; body: string; url: string; tag?: string }> {
  const salt = body.slice(0, 16), idlen = body[20], keyid = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asPub = await crypto.subtle.importKey('raw', keyid as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asPub }, sub.privateKey, 256));
  const ikm = await expand(await hmac(fromB64u(sub.auth), secret), concat(new TextEncoder().encode('WebPush: info\0'), fromB64u(sub.p256dh), keyid), 32);
  const prk = await hmac(salt, ikm);
  const cek = await crypto.subtle.importKey('raw', (await expand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)) as BufferSource, 'AES-GCM', false, ['decrypt']);
  const nonce = await expand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cek, ct as BufferSource));
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  return JSON.parse(new TextDecoder().decode(padded.slice(0, end - 1)));
}
type S = Awaited<ReturnType<typeof setup>>;
async function devices(s: S, list: [name: string, key: string][]) {
  const subs = new Map<string, Sub>();
  for (const [name, key] of list) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const sub = { privateKey: pair.privateKey, p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
    const res = await s.req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: sub.p256dh, auth: sub.auth } }, deviceName: name }, key);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    subs.set(name, sub);
  }
  return async (when: Date): Promise<Record<string, { title: string; body: string; url: string; tag?: string }[]>> => {
    mock.timers.setTime(when.getTime());
    const realFetch = globalThis.fetch;
    const sent: { url: string; body: Uint8Array }[] = [];
    globalThis.fetch = (async (u: unknown, init: RequestInit = {}) => { sent.push({ url: String(u), body: init.body as Uint8Array }); return new Response('', { status: 201 }); }) as typeof fetch;
    try { await runNotifications(s.env, when); } finally { globalThis.fetch = realFetch; }
    const out: Record<string, { title: string; body: string; url: string; tag?: string }[]> = {};
    for (const p of sent) {
      const name = p.url.split('/').pop()!;
      (out[name] ??= []).push(await readPush(p.body, subs.get(name)!));
    }
    return out;
  };
}

test('morning reminder: once, generic, to their own devices only, after quiet hours; not when finished or skipped', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await s.req(tc(s.alex.id), 'PUT', { goal: 'Call the plumber' });
  await s.req(tc(s.maya.id), 'PUT', { goal: SECRET });
  await s.req('/api/settings', 'PATCH', { quietFrom: '22:00', quietTo: '07:30' });
  const tick = await devices(s, [['alex-phone', await s.key(s.alex.id, 'admin')], ['maya-phone', await s.key(s.maya.id)], ['wall', await s.key()], ['parent-phone', ADMIN]]);
  s.clock(NEXT, '00:40');
  await s.req(tc(s.alex.id, D), 'PUT', { followup: { outcome: 'yes' } }); // Alex finished after midnight
  const morning = async (local: string) => {
    const sent = await tick(at(NEXT, local));
    for (const k of Object.keys(sent)) sent[k] = sent[k].filter((p) => p.title.includes('Last night'));
    return Object.fromEntries(Object.entries(sent).filter(([, v]) => v.length));
  };
  assert.deepEqual(await morning('06:50'), {}, 'too early');
  assert.deepEqual(await morning('07:10'), {}, 'quiet hours');
  const sent = await morning('07:35');
  assert.deepEqual(Object.keys(sent), ['maya-phone'], 'Maya only (Alex finished), her own device only');
  assert.deepEqual(sent['maya-phone'], [{ title: "Last night's check-in is still open 🌙", body: 'Finish it or skip it.', url: `/#/journal/${s.maya.id}`, tag: `lastnight:${s.maya.id}` }]);
  assert.doesNotMatch(JSON.stringify(sent), /zz-secret|drained|goal|low|sleep/i, 'no health details or goal');
  assert.deepEqual(await morning('08:00'), {}, 'once');
  await s.db.prepare("DELETE FROM settings WHERE key = 'notifyLastTick'").run(); // a restart
  assert.deepEqual(await morning('09:00'), {}, 'still once');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE title LIKE 'Last night%'").first<{ n: number }>()!.n, 0, 'not in the family feed');

  // Skipped, or the morning Temp check done: no reminder.
  for (const close of [(x: S) => x.req(tc(x.maya.id, D), 'PUT', { lastNightSkipped: true }), (x: S) => x.req(tc(x.maya.id), 'PUT', { goalSkipped: true })]) {
    const x = await setup();
    await x.req(tc(x.maya.id), 'PUT', { goal: 'Read' });
    const tk = await devices(x, [['maya-phone', await x.key(x.maya.id)]]);
    x.clock(NEXT, '06:00');
    assert.equal((await close(x)).status, 200);
    const got = await tk(at(NEXT, '07:05'));
    assert.equal(JSON.stringify(got).includes('Last night'), false);
  }
});
