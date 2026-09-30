// Medication reminders (routes/medications.ts, notify.ts runMedicationReminders). Health data end to
// end (AGENTS.md "Health data"): off until a parent turns it on; names, doses, times and the
// taken/skipped log sealed at rest with the family key (fail closed without it); never logged, never
// in a webhook; generic push text unless a device opts in; "Meds" on shared screens unless the family
// turns names on; nothing for other members' devices; connected apps only with aiHealthAccess.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runNotifications } from '../src/notify.ts';
import { seal, unseal } from '../src/crypto.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const TODAY = '2026-09-28'; // a Monday
const at = (local: string, date = TODAY) => new Date(`${date}T${local}:00-07:00`); // Los Angeles (PDT)
const NAME = 'zz-sleepy-syrup'; // must never show up raw
const DOSE = 'zz-two-drops';
const APP = { 'X-Kinwall-Source': 'mcp' };

async function setup(opts: { extra?: Partial<Env>; now?: Date; on?: boolean } = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: opts.now ?? at('07:00') });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY, ...opts.extra } as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env, ctx);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles', ...(opts.on === false ? {} : { medications: true }) });
  const sam = (await req('/api/members', 'POST', { name: 'Sam', color: '#FF8FA3', grownUp: true })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#F5A65B' })).json;
  // Straight into the table: a grown-up's (Sam's) paired device can't be made any more (auth.ts
  // validOwner), but ones paired before that keep working for their medications.
  const key = async (owner?: string, scope: 'admin' | 'display' = 'display') =>
    (await createApiKey(db as never, `k-${owner ?? (scope === 'display' ? 'wall' : scope)}`, scope, { owner: owner ?? null })).key;
  const add = (memberId: string, body: Record<string, unknown> = {}, k = ADMIN) => req('/api/medications', 'POST', { memberId, name: NAME, dose: DOSE, times: ['08:00'], ...body }, k);
  const mark = (medId: string, action: string, k = ADMIN, time = '08:00', date = TODAY) => req(`/api/medications/${medId}/doses`, 'POST', { date, time, action }, k);
  const raw = (table: 'medications' | 'medication_log' | 'sent_notifications') => db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>().results;
  const settle = () => Promise.all(pending.splice(0));
  return { env, db, req, sam, maya, leo, key, add, mark, raw, settle };
}

// ---- push capture: a subscriber's keys, and an independent RFC 8291 decryptor to read what was sent ----
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}
const expand = async (prk: Uint8Array, info: Uint8Array, n: number) => (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, n);
type Sub = { privateKey: CryptoKey; p256dh: string; auth: string };
async function readPush(body: Uint8Array, sub: Sub): Promise<{ title: string; body: string; url: string }> {
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

/** Push subscriptions by device name, and a tick that returns what each device was sent (decrypted). */
async function devices(s: Awaited<ReturnType<typeof setup>>, list: [name: string, key: string, prefs?: Record<string, unknown>][]) {
  const subs = new Map<string, Sub>();
  for (const [name, key, prefs] of list) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const sub = { privateKey: pair.privateKey, p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
    const res = await s.req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: sub.p256dh, auth: sub.auth } }, deviceName: name, prefs }, key);
    assert.equal(res.status, 201, JSON.stringify(res.json));
    subs.set(name, sub);
  }
  return async (when: Date): Promise<Record<string, { title: string; body: string }[]>> => {
    const realFetch = globalThis.fetch;
    const sent: { url: string; body: Uint8Array }[] = [];
    globalThis.fetch = (async (u: unknown, init: RequestInit = {}) => { sent.push({ url: String(u), body: init.body as Uint8Array }); return new Response('', { status: 201 }); }) as typeof fetch;
    try { await runNotifications(s.env, when); } finally { globalThis.fetch = realFetch; }
    const out: Record<string, { title: string; body: string }[]> = {};
    for (const p of sent) {
      const name = p.url.split('/').pop()!;
      const { title, body } = await readPush(p.body, subs.get(name)!);
      (out[name] ??= []).push({ title, body });
    }
    return out;
  };
}
const feed = (db: Awaited<ReturnType<typeof setup>>['db']) =>
  db.prepare("SELECT title, body, member_ids FROM notifications WHERE kind = 'medication' ORDER BY at, rowid").all<{ title: string; body: string | null; member_ids: string }>().results.map((r) => ({ ...r }));

test('medications: off by default; every route is 404 until a parent turns it on, and off keeps the data', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, leo, key, add } = await setup({ on: false });
  const s = (await req('/api/settings')).json;
  assert.deepEqual([s.medications, s.medicationNamesOnWalls], [false, false]);
  const wall = await key();
  const routes: [string, string, unknown?][] = [
    ['/api/medications', 'GET'], ['/api/medications', 'POST', { memberId: leo.id, name: 'x', dose: 'y', times: ['08:00'] }], ['/api/medications/due', 'GET'],
    [`/api/members/${leo.id}/medications`, 'GET'], ['/api/medications/nope/doses', 'POST', { date: TODAY, time: '08:00', action: 'taken' }],
    ['/api/medications/nope', 'PATCH', { name: 'x' }], ['/api/medications/nope', 'DELETE'],
  ];
  for (const [p, m, b] of routes) assert.equal((await req(p, m, b)).status, 404, `${m} ${p}`);
  assert.equal((await req('/api/medications/due', 'GET', undefined, wall)).status, 404, 'a wall too');

  await req('/api/settings', 'PATCH', { medications: true });
  assert.equal((await add(leo.id)).status, 201);
  await req('/api/settings', 'PATCH', { medications: false });
  assert.equal((await req('/api/medications')).status, 404);
  await req('/api/settings', 'PATCH', { medications: true });
  assert.equal((await req('/api/medications')).json.length, 1, 'kept while off');
  assert.equal((await req('/api/settings', 'PATCH', { medications: false }, ADMIN, APP)).status, 403, 'a connected app cannot switch it');
  assert.equal((await req('/api/settings', 'PATCH', { medicationNamesOnWalls: true }, ADMIN, APP)).status, 403);
});

test('medications: part of the Health tracker; off (routes, reminders) while the Health tracker is off, data kept', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.leo.id);
  const features = (await s.req('/api/settings')).json.features;
  await s.req('/api/settings', 'PATCH', { features: { ...features, trackersHealth: false } });
  assert.equal((await s.req('/api/settings')).json.medications, false, 'reads as off');
  assert.equal((await s.req('/api/medications')).status, 404);
  const tick = await devices(s, [['leo-tablet', await s.key(s.leo.id)]]);
  assert.deepEqual(await tick(at('08:02')), {}, 'no reminders');
  await s.req('/api/settings', 'PATCH', { features: { ...features, trackersHealth: true } });
  assert.equal((await s.req('/api/medications')).json.length, 1, 'back with the Health tracker');
});

test('medications: parents add, edit and delete; name, dose, times and weekdays are checked', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, leo, sam, add, mark, raw } = await setup({ now: at('08:05') });
  const res = await add(leo.id, { name: '  Allergy medicine ', dose: ' 1 tablet ', times: ['20:00', '08:00', '08:00'], days: [5, 1, 3] });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const { id, memberId, name, dose, times, days } = res.json;
  assert.deepEqual({ memberId, name, dose, times, days }, { memberId: leo.id, name: 'Allergy medicine', dose: '1 tablet', times: ['08:00', '20:00'], days: [1, 3, 5] });
  assert.deepEqual((await add(sam.id)).json.days, [0, 1, 2, 3, 4, 5, 6], 'every day by default');
  assert.equal((await req('/api/medications')).json.length, 2);
  assert.deepEqual((await req(`/api/medications?memberId=${leo.id}`)).json.map((m: any) => m.id), [id]);

  const patched = await req(`/api/medications/${id}`, 'PATCH', { times: ['09:30'], days: [0, 1, 2, 3, 4, 5, 6] });
  assert.deepEqual([patched.status, patched.json.name, patched.json.times, patched.json.days.length], [200, 'Allergy medicine', ['09:30'], 7]);

  for (const bad of [{ name: '' }, { name: 'x'.repeat(61) }, { dose: 'x'.repeat(41) }, { times: [] }, { times: ['8am'] }, { times: ['24:00'] }, { times: Array.from({ length: 9 }, (_, i) => `0${i}:00`) }, { days: [] }, { days: [7] }]) {
    assert.equal((await add(leo.id, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await add('ghost')).status, 404);
  assert.equal((await req('/api/medications/ghost', 'PATCH', { name: 'x' })).status, 404);

  const med = (await add(leo.id)).json;
  assert.equal((await mark(med.id, 'taken')).status, 200);
  assert.equal(raw('medication_log').length, 1);
  assert.equal((await req(`/api/medications/${med.id}`, 'DELETE')).status, 204);
  assert.equal(raw('medication_log').length, 0, 'its log goes with it');
  assert.equal((await req(`/api/medications/${med.id}`, 'DELETE')).status, 404);
});

test('medications: a course ends on its end date or after its total doses are taken', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  const due = async () => ((await s.req('/api/medications/due')).json.doses as { medicationId: string; date: string; time: string }[]);
  // End date: due through that day, nothing after.
  const ended = (await s.add(s.leo.id, { name: 'Ear drops', endDate: TODAY })).json;
  assert.equal(ended.endDate, TODAY);
  assert.equal((await s.req('/api/medications', 'POST', { memberId: s.leo.id, name: 'x', times: ['08:00'], endDate: '28-09-2026' })).status, 400);
  // Total doses: two a day, 3 in all; stops once 3 are taken (skips don't count).
  const course = (await s.add(s.maya.id, { name: 'Antibiotic', times: ['08:00', '20:00'], totalDoses: 3 })).json;
  assert.deepEqual([course.totalDoses, course.dosesLeft], [3, 3]);
  mock.timers.setTime(at('08:05').getTime());
  assert.deepEqual((await due()).map((d) => d.medicationId).sort(), [course.id, ended.id].sort());
  await s.mark(course.id, 'taken');
  await s.mark(course.id, 'skipped', ADMIN, '20:00');
  mock.timers.setTime(at('08:05', '2026-09-29').getTime());
  assert.deepEqual((await due()).map((d) => d.medicationId), [course.id], 'the ear drops ended yesterday');
  await s.mark(course.id, 'taken', ADMIN, '08:00', '2026-09-29');
  assert.equal((await s.req('/api/medications')).json.find((m: { id: string }) => m.id === course.id).dosesLeft, 1);
  mock.timers.setTime(at('20:05', '2026-09-29').getTime());
  await s.mark(course.id, 'taken', ADMIN, '20:00', '2026-09-29');
  assert.equal((await s.req('/api/medications')).json.find((m: { id: string }) => m.id === course.id).dosesLeft, 0);
  mock.timers.setTime(at('08:05', '2026-09-30').getTime());
  assert.deepEqual(await due(), [], 'course done');
  const tick = await devices(s, [['maya-phone', await s.key(s.maya.id)]]);
  assert.deepEqual(await tick(at('08:02', '2026-09-30')), {}, 'no reminder after the course');
  // Clearing the limit brings it back.
  await s.req(`/api/medications/${course.id}`, 'PATCH', { totalDoses: null });
  assert.equal((await due()).length, 1);
});

test('medications: sealed at rest (names, doses, times, the log); without ENCRYPTION_KEY nothing is stored', async (t) => {
  t.after(() => mock.timers.reset());
  const { env, req, leo, add, mark, raw } = await setup({ now: at('08:05') });
  const med = (await add(leo.id, { times: ['08:00', '19:45'] })).json;
  assert.equal((await mark(med.id, 'taken')).status, 200);
  await runNotifications(env, at('08:06')); // claims a reminder: its key must not say what or when either
  const [row] = raw('medications');
  assert.match(String(row.data), /^enc:v1:/);
  const [log] = raw('medication_log');
  assert.match(String(log.log), /^enc:v1:/);
  const stored = JSON.stringify([raw('medications'), raw('medication_log'), raw('sent_notifications')]);
  for (const s of [NAME, DOSE, '08:00', '19:45', 'taken', 'k-']) assert.equal(stored.includes(s), false, s);

  const noKey = await setup({ extra: { ENCRYPTION_KEY: undefined } });
  assert.equal((await noKey.add(noKey.leo.id)).status, 500);
  assert.deepEqual(noKey.raw('medications'), []);
});

test('medications: who may do what, by device', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, leo, maya, key, add, mark } = await setup({ now: at('08:05') });
  const med = (await add(leo.id)).json;
  const wall = await key();
  const leos = await key(leo.id);
  const mayas = await key(maya.id);
  const history = (id: string, k = ADMIN, h = {}) => req(`/api/members/${id}/medications`, 'GET', undefined, k, h);

  // Add, edit, delete: parent devices only.
  for (const [who, k, h] of [['wall', wall, {}], ["Leo's device", leos, {}], ['connected app', ADMIN, APP]] as const) {
    assert.equal((await req('/api/medications', 'POST', { memberId: leo.id, name: 'x', dose: 'y', times: ['09:00'] }, k, h)).status, 403, `${who}: add`);
    assert.equal((await req(`/api/medications/${med.id}`, 'PATCH', { name: 'x' }, k, h)).status, 403, `${who}: edit`);
    assert.equal((await req(`/api/medications/${med.id}`, 'DELETE', undefined, k, h)).status, 403, `${who}: delete`);
    assert.equal((await req('/api/medications', 'DELETE', undefined, k, h)).status, 403, `${who}: delete all`);
  }
  // Their list and history: their own device and parents'.
  assert.equal((await req('/api/medications', 'GET', undefined, leos)).json[0].name, NAME);
  assert.deepEqual((await req('/api/medications', 'GET', undefined, mayas)).json, [], "Maya's device: nothing about Leo's");
  assert.equal((await req('/api/medications', 'GET', undefined, wall)).status, 403, 'no list on a shared wall');
  assert.equal((await req('/api/medications', 'GET', undefined, ADMIN, APP)).status, 403);
  assert.equal((await history(leo.id)).status, 200);
  assert.equal((await history(leo.id, leos)).status, 200);
  for (const [who, k, h] of [['wall', wall, {}], ["Maya's device", mayas, {}], ['connected app', ADMIN, APP]] as const) assert.equal((await history(leo.id, k, h)).status, 403, `${who}: history`);
  // Marking a dose: the wall (families give meds in the kitchen), their own device, parents.
  assert.equal((await mark(med.id, 'snooze', mayas)).status, 403, "Maya's device can't mark Leo's");
  assert.equal((await mark(med.id, 'snooze', ADMIN, '08:00', TODAY)).status, 200);
  assert.equal((await req(`/api/medications/${med.id}/doses`, 'POST', { date: TODAY, time: '08:00', action: 'taken' }, ADMIN, APP)).status, 403);
  assert.equal((await mark(med.id, 'skipped', wall)).status, 200);
  assert.equal((await mark(med.id, 'taken', leos)).status, 200, 'a kid can mark their own');

  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  assert.equal((await history(leo.id, ADMIN, APP)).status, 200, 'connected apps once the family allows it');
  assert.equal((await req('/api/medications', 'GET', undefined, ADMIN, APP)).status, 200);
});

test('Take now: due from its time for 3 hours; "Meds" on a shared wall unless names are on; own devices see only theirs', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, leo, maya, sam, key, add, mark } = await setup({ now: at('08:10') });
  const leoMed = (await add(leo.id)).json;
  const mayaMed = (await add(maya.id, { name: 'Vitamin', dose: '1 gummy' })).json;
  await add(sam.id, { times: ['20:00'] });
  const wall = await key();
  const leos = await key(leo.id);
  const mayas = await key(maya.id);
  const due = async (k = ADMIN) => (await req('/api/medications/due', 'GET', undefined, k)).json;
  const who = (d: any) => d.doses.map((x: any) => [x.memberId, x.time, x.name, x.dose]);

  assert.deepEqual(who(await due(wall)), [[maya.id, '08:00', null, null], [leo.id, '08:00', null, null]], 'in family order');
  assert.equal((await due(wall)).names, false);
  assert.deepEqual(who(await due()), [[maya.id, '08:00', 'Vitamin', '1 gummy'], [leo.id, '08:00', NAME, DOSE]]);
  assert.deepEqual(who(await due(leos)), [[leo.id, '08:00', NAME, DOSE]]);
  assert.deepEqual(who(await due(mayas)), [[maya.id, '08:00', 'Vitamin', '1 gummy']]);
  assert.equal((await req('/api/medications/due', 'GET', undefined, ADMIN, APP)).status, 403);
  await req('/api/settings', 'PATCH', { medicationNamesOnWalls: true });
  assert.deepEqual(who(await due(wall))[1], [leo.id, '08:00', NAME, DOSE]);

  const taken = await mark(leoMed.id, 'taken', wall);
  assert.deepEqual([taken.json.status, taken.json.by, taken.json.at], ['taken', 'k-wall', at('08:10').toISOString()]);
  const snoozed = await mark(mayaMed.id, 'snooze', mayas);
  assert.deepEqual([snoozed.json.status, snoozed.json.snoozedUntil], ['due', at('08:20').toISOString()]);
  assert.deepEqual((await due(wall)).doses, [], 'taken, and snoozed for 10 minutes');
  mock.timers.setTime(at('08:21').getTime());
  assert.deepEqual(who(await due(wall)), [[maya.id, '08:00', 'Vitamin', '1 gummy']]);
  mock.timers.setTime(at('11:01').getTime());
  assert.deepEqual((await due(wall)).doses, [], 'three hours on it leaves the wall');
  const day = (await req(`/api/members/${maya.id}/medications`)).json.days.at(-1);
  assert.deepEqual(day.doses.map((d: any) => [d.time, d.status]), [['08:00', 'missed']]);

  assert.equal((await mark(mayaMed.id, 'taken', ADMIN, '09:00')).status, 400, 'not one of its times');
  assert.equal((await mark(mayaMed.id, 'taken', ADMIN, '08:00', '2026-09-20')).status, 400, 'today or yesterday only');
  assert.equal((await mark(mayaMed.id, 'maybe')).status, 400);
  assert.equal((await mark(leoMed.id, 'snooze')).status, 400, 'nothing to snooze once it is taken');
});

test('late window per medicine: up to 3 hours (default), until 8 PM, until the end of the day, or 1 hour when it shouldn\'t be taken late', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('07:00') });
  const due = async () => ((await s.req('/api/medications/due')).json.doses as { medicationId: string; time: string }[]).map((d) => d.medicationId).sort();
  const plain = (await s.add(s.leo.id)).json;
  assert.equal(plain.lateWindow, '3h', 'existing behavior by default');
  const evening = (await s.add(s.leo.id, { lateWindow: 'evening' })).json;
  const allDay = (await s.add(s.maya.id, { lateWindow: 'endOfDay' })).json;
  const strict = (await s.add(s.maya.id, { lateWindow: 'none' })).json;
  const supper = (await s.add(s.sam.id, { times: ['19:00'], lateWindow: 'evening' })).json; // after 5 PM: still 3 hours
  assert.equal((await s.add(s.leo.id, { lateWindow: 'someday' })).status, 400);
  assert.equal((await s.req(`/api/medications/${plain.id}`, 'PATCH', { lateWindow: 'tomorrow' })).status, 400);
  mock.timers.setTime(at('08:59').getTime());
  assert.deepEqual(await due(), [plain.id, evening.id, allDay.id, strict.id].sort());
  mock.timers.setTime(at('09:01').getTime());
  assert.deepEqual(await due(), [plain.id, evening.id, allDay.id].sort(), "don't take late: 1 hour");
  mock.timers.setTime(at('11:01').getTime());
  assert.deepEqual(await due(), [evening.id, allDay.id].sort());
  mock.timers.setTime(at('19:59').getTime());
  assert.deepEqual(await due(), [evening.id, allDay.id, supper.id].sort());
  mock.timers.setTime(at('20:01').getTime());
  assert.deepEqual(await due(), [allDay.id, supper.id].sort(), 'until 8 PM');
  mock.timers.setTime(at('21:59').getTime());
  assert.deepEqual(await due(), [allDay.id, supper.id].sort(), 'a 7 PM dose still gets its 3 hours');
  mock.timers.setTime(at('23:59').getTime());
  assert.deepEqual(await due(), [allDay.id]);
  mock.timers.setTime(at('00:01', '2026-09-29').getTime());
  assert.deepEqual(await due(), [], 'until the end of the day');
  const statuses = async (id: string) => (await s.req(`/api/members/${id}/medications`)).json.days.at(-2).doses.map((d: any) => [d.medicationId, d.status]);
  assert.deepEqual((await statuses(s.maya.id)).map((d: string[]) => d[1]), ['missed', 'missed']);
  const patched = await s.req(`/api/medications/${plain.id}`, 'PATCH', { lateWindow: 'none' });
  assert.deepEqual([patched.status, patched.json.lateWindow], [200, 'none']);
  assert.equal(JSON.stringify(s.raw('medications')).includes('evening'), false, 'sealed with the rest');
});

test("catch-up: a dose past its window (yesterday's too) can still be marked, with the time it was actually marked; a course counts it", async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('07:00', '2026-09-27') });
  const med = (await s.add(s.leo.id, { totalDoses: 5 })).json;
  const wall = await s.key();
  const leos = await s.key(s.leo.id);
  const mayas = await s.key(s.maya.id);
  mock.timers.setTime(at('21:30').getTime()); // yesterday's and today's 8 AM doses both not marked
  const days = async () => (await s.req(`/api/members/${s.leo.id}/medications`)).json.days.slice(-2).map((d: any) => d.doses.map((x: any) => [x.status, x.at, x.by]));
  assert.deepEqual(await days(), [[['missed', null, null]], [['missed', null, null]]]);
  assert.equal((await s.mark(med.id, 'taken', mayas, '08:00', '2026-09-27')).status, 403, "not from someone else's device");
  const late = await s.mark(med.id, 'taken', leos, '08:00', '2026-09-27');
  assert.deepEqual([late.status, late.json.status, late.json.at], [200, 'taken', at('21:30').toISOString()]);
  assert.equal((await s.mark(med.id, 'skipped', wall)).status, 200, 'a shared wall can catch up too');
  assert.deepEqual(await days(), [[['taken', at('21:30').toISOString(), 'k-' + s.leo.id]], [['skipped', at('21:30').toISOString(), 'k-wall']]]);
  assert.equal((await s.req('/api/medications')).json[0].dosesLeft, 4, 'a dose taken late counts toward the course');
  assert.equal((await s.mark(med.id, 'snooze', ADMIN, '08:00', '2026-09-27')).status, 400, 'nothing to snooze');
});

test('catch-up with `at`: when a forgotten dose was really taken; not in the future, not before its day; stored as the taken time', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('07:00', '2026-09-27') });
  const med = (await s.add(s.leo.id, { totalDoses: 5 })).json; // 8 AM, up to 3 hours late
  const strict = (await s.add(s.leo.id, { times: ['08:00'], lateWindow: 'none' })).json; // 1 hour
  const leos = await s.key(s.leo.id);
  mock.timers.setTime(at('21:30').getTime());
  const markAt = (id: string, when: Date | string, date = TODAY, action = 'taken') => s.req(`/api/medications/${id}/doses`, 'POST', { date, time: '08:00', action, at: typeof when === 'string' ? when : when.toISOString() }, leos);
  assert.equal((await markAt(med.id, at('21:40'))).status, 400, 'not in the future');
  assert.equal((await markAt(med.id, at('23:59', '2026-09-27'))).status, 400, "not before the start of the dose's day");
  assert.equal((await markAt(med.id, at('23:59', '2026-09-26'), '2026-09-27')).status, 400, "a yesterday dose: not before yesterday's day start");
  assert.equal((await markAt(med.id, 'noon')).status, 400, 'an ISO time');
  assert.equal((await markAt(med.id, at('08:00'), TODAY, 'snooze')).status, 400, 'only for taken or skipped');
  assert.deepEqual((await s.req(`/api/members/${s.leo.id}/medications`)).json.days.slice(-2).map((d: any) => d.doses.map((x: any) => x.status)), [['missed', 'missed'], ['missed', 'missed']], 'nothing stored');

  const yesterday = await markAt(med.id, at('08:10', '2026-09-27'), '2026-09-27');
  assert.deepEqual([yesterday.status, yesterday.json.status, yesterday.json.at, yesterday.json.late], [200, 'taken', at('08:10', '2026-09-27').toISOString(), false], "yesterday's dose, backdated: taken on time");
  const skew = await markAt(med.id, new Date(Date.now() + 60_000));
  assert.deepEqual([skew.status, skew.json.at], [200, at('21:30').toISOString()], "a minute ahead is the phone's clock: stored as now");
  const early = await markAt(strict.id, at('07:45'));
  assert.deepEqual([early.status, early.json.late], [200, false], 'taken a little early is on time');
  const late = await markAt(strict.id, at('09:30'), '2026-09-27');
  assert.deepEqual([late.status, late.json.late], [200, true], 'past its 1-hour window: taken late');

  const h = (await s.req(`/api/members/${s.leo.id}/medications`)).json;
  const row = (date: string, id: string) => h.days.find((d: any) => d.date === date).doses.find((x: any) => x.medicationId === id);
  assert.deepEqual([row('2026-09-27', med.id).at, row('2026-09-27', med.id).late], [at('08:10', '2026-09-27').toISOString(), false], 'history has the time it was taken');
  assert.deepEqual([row(TODAY, med.id).late, row(TODAY, strict.id).at, row('2026-09-27', strict.id).late], [true, at('07:45').toISOString(), true], 'stored as 9:30 PM: late');
  assert.equal((await s.req('/api/medications')).json.find((m: any) => m.id === med.id).dosesLeft, 3, 'the course counts them');
});

test('history: today plus the last 6 days from each medicine\'s schedule, on its weekdays only', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, leo, add, mark } = await setup({ now: at('07:00', '2026-09-21') });
  const med = (await add(leo.id, { days: [1, 3, 5] })).json; // Mon, Wed, Fri
  mock.timers.setTime(at('08:30', '2026-09-23').getTime());
  assert.equal((await mark(med.id, 'taken', ADMIN, '08:00', '2026-09-23')).status, 200);
  mock.timers.setTime(at('07:00').getTime());
  const h = (await req(`/api/members/${leo.id}/medications`)).json;
  assert.equal(h.today, TODAY);
  assert.deepEqual(h.medications.map((m: any) => m.id), [med.id]);
  assert.deepEqual(h.days.map((d: any) => [d.date, d.doses.map((x: any) => x.status)]), [
    ['2026-09-22', []], ['2026-09-23', ['taken']], ['2026-09-24', []], ['2026-09-25', ['missed']], ['2026-09-26', []], ['2026-09-27', []], [TODAY, ['upcoming']],
  ]);
  assert.equal(h.days[1].doses[0].by, 'ADMIN_API_KEY');
});

test('reminders: once per dose at its household time, to their own devices; weekday filtered; generic unless the device opts in', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.leo.id);
  await s.add(s.sam.id, { days: [2] }); // Tuesdays: not today
  const tick = await devices(s, [
    ['leo-tablet', await s.key(s.leo.id)], ['leo-phone', await s.key(s.leo.id), { medicationNames: true }],
    ['maya-phone', await s.key(s.maya.id)], ['wall', await s.key()], ['parent', await s.key(undefined, 'admin')],
  ]);
  assert.deepEqual(await tick(at('07:55')), {});
  assert.deepEqual(await tick(new Date(`${TODAY}T08:02:00Z`)), {}, "8:00 in UTC isn't 8:00 at home");
  const sent = await tick(at('08:02'));
  assert.deepEqual(Object.keys(sent).sort(), ['leo-phone', 'leo-tablet']);
  assert.deepEqual(sent['leo-tablet'], [{ title: "Time for Leo's medicine", body: 'Tap to mark it taken.' }]);
  assert.deepEqual(sent['leo-phone'], [{ title: "Time for Leo's medicine", body: `${NAME} · ${DOSE}` }]);
  assert.deepEqual(feed(s.db), [{ title: "Time for Leo's medicine", body: null, member_ids: JSON.stringify([s.leo.id]) }]);
  assert.deepEqual(await tick(at('08:05')), {}, 'once');
  await s.db.prepare("DELETE FROM settings WHERE key = 'notifyLastTick'").run(); // a restart
  assert.deepEqual(await tick(at('08:06')), {}, 'still once');
  assert.equal(feed(s.db).length, 1);
});

test('reminders: snooze 10 minutes re-sends once per snooze; taken stops them', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  const med = (await s.add(s.leo.id)).json;
  const leos = await s.key(s.leo.id);
  const tick = await devices(s, [['leo-tablet', leos]]);
  assert.equal((await tick(at('08:02')))['leo-tablet'].length, 1);
  mock.timers.setTime(at('08:03').getTime());
  assert.equal((await s.mark(med.id, 'snooze', leos)).status, 200);
  assert.deepEqual(await tick(at('08:10')), {});
  assert.deepEqual(await tick(at('08:14')), { 'leo-tablet': [{ title: "Time for Leo's medicine", body: 'Tap to mark it taken.' }] });
  assert.deepEqual(await tick(at('08:16')), {}, 'once per snooze');
  mock.timers.setTime(at('08:16').getTime());
  await s.mark(med.id, 'snooze', leos);
  mock.timers.setTime(at('08:20').getTime());
  await s.mark(med.id, 'taken', leos);
  assert.deepEqual(await tick(at('08:27')), {}, 'taken: no more');
});

test("reminders: a kid's dose not marked in 30 minutes tells parents' devices once; grown-ups' doses don't", async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.leo.id);
  await s.add(s.sam.id);
  const mayaMed = (await s.add(s.maya.id)).json;
  const tick = await devices(s, [['parent', await s.key(undefined, 'admin')], ['parent-names', await s.key(undefined, 'admin'), { medicationNames: true }], ['sams-device', await s.key(s.sam.id)]]);
  assert.deepEqual(Object.keys(await tick(at('08:02'))), ['sams-device'], 'the due reminder goes to their own devices only');
  mock.timers.setTime(at('08:20').getTime());
  await s.mark(mayaMed.id, 'taken');
  assert.deepEqual(await tick(at('08:29')), {});
  const late = await tick(at('08:31'));
  assert.deepEqual(late, {
    parent: [{ title: "Leo's 8:00 AM medicine hasn't been marked yet", body: 'Tap to check.' }],
    'parent-names': [{ title: "Leo's 8:00 AM medicine hasn't been marked yet", body: `${NAME} · ${DOSE}` }],
  });
  assert.deepEqual(await tick(at('08:35')), {}, 'once');
  assert.deepEqual(feed(s.db).map((f) => f.title).filter((x) => x.includes('marked')), ["Leo's 8:00 AM medicine hasn't been marked yet"]);
});

test('reminders: a late window longer than 3 hours gets one kind follow-up halfway through, once, never for a marked dose', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.sam.id, { lateWindow: 'evening' }); // 8 AM to 8 PM: halfway is 2 PM
  const allDay = (await s.add(s.leo.id, { lateWindow: 'endOfDay' })).json; // 8 AM to midnight: 4 PM
  await s.add(s.maya.id); // 3 hours: no follow-up
  await s.add(s.maya.id, { lateWindow: 'none' });
  const tick = await devices(s, [['sams-phone', await s.key(s.sam.id)], ['sams-tablet', await s.key(s.sam.id), { medicationNames: true }], ['leo-tablet', await s.key(s.leo.id)], ['maya-phone', await s.key(s.maya.id)], ['parent', await s.key(undefined, 'admin')]]);
  await tick(at('08:02'));
  assert.deepEqual(await tick(at('11:02')), {}, 'nothing for the 3-hour window');
  assert.deepEqual(await tick(at('13:58')), {});
  const sent = await tick(at('14:03'));
  assert.deepEqual(Object.keys(sent).sort(), ['sams-phone', 'sams-tablet']);
  const [{ title, body }] = sent['sams-phone'];
  assert.match(title, /Sam/);
  assert.match(title, /until 8 PM/);
  assert.doesNotMatch(title, /\b(missed|late|forg[eo]t\w*|again)\b/i);
  assert.equal(body, 'Tap to mark it taken.');
  assert.equal(sent['sams-tablet'][0].body, `${NAME} · ${DOSE}`, 'names only where the device opted in');
  assert.deepEqual(await tick(at('14:20')), {}, 'once');
  mock.timers.setTime(at('15:00').getTime());
  await s.mark(allDay.id, 'taken', ADMIN);
  assert.deepEqual(await tick(at('16:02')), {}, 'taken: no follow-up');
  assert.equal(feed(s.db).filter((f) => /until/.test(f.title)).length, 0, 'a nudge, not a feed row');
});

test("reminders: with a late window past 3 hours, a kid's parent note waits until about an hour is left", async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.leo.id, { lateWindow: 'evening' }); // until 8 PM: note at 7 PM
  await s.add(s.maya.id, { lateWindow: 'endOfDay' }); // until midnight: note at 11 PM
  await s.add(s.maya.id, { times: ['09:00'], lateWindow: 'none' }); // 1 hour: note at 30 minutes, as before
  const tick = await devices(s, [['parent', await s.key(undefined, 'admin')]]);
  const notes = async (when: Date) => ((await tick(when)).parent ?? []).map((p) => p.title);
  assert.deepEqual(await notes(at('08:31')), [], 'not at 30 minutes');
  assert.deepEqual(await notes(at('09:31')), ["Maya's 9:00 AM medicine hasn't been marked yet"]);
  assert.deepEqual(await notes(at('18:58')), []);
  assert.deepEqual(await notes(at('19:02')), ["Leo's 8:00 AM medicine hasn't been marked yet"]);
  assert.deepEqual(await notes(at('19:10')), [], 'once');
  assert.deepEqual(await notes(at('23:01')), ["Maya's 8:00 AM medicine hasn't been marked yet"]);
});

test('reminders: medicine pushes still go out during quiet hours', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.leo.id);
  await s.req('/api/settings', 'PATCH', { quietFrom: '07:00', quietTo: '09:00' });
  const tick = await devices(s, [['leo-tablet', await s.key(s.leo.id)], ['parent', await s.key(undefined, 'admin')]]);
  assert.deepEqual(Object.keys(await tick(at('08:02'))), ['leo-tablet']);
  assert.deepEqual(Object.keys(await tick(at('08:31'))), ['parent']);
  assert.equal(feed(s.db).length, 2);
  mock.timers.setTime(at('08:40').getTime());
  assert.equal((await s.req('/api/medications/due', 'GET', undefined, await s.key())).json.doses.length, 1);
});

test("the bell's feed: medicine rows for parents, shared walls and that person's devices only", async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.leo.id);
  await runNotifications(s.env, at('08:02'));
  const rows = async (k = ADMIN, h = {}) => ((await s.req('/api/notifications', 'GET', undefined, k, h)).json as any[]).filter((n) => n.kind === 'medication').length;
  assert.equal(await rows(), 1);
  assert.equal(await rows(await s.key()), 1, 'shared wall');
  assert.equal(await rows(await s.key(s.leo.id)), 1, "Leo's device");
  assert.equal(await rows(await s.key(s.maya.id)), 0, "Maya's device");
  assert.equal(await rows(ADMIN, APP), 0, 'connected app');
  await s.req('/api/settings', 'PATCH', { medications: false });
  assert.equal(await rows(), 0, 'hidden while off');
});

test('delete all medication data: parents only; medicines, their log and their feed rows go', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  const med = (await s.add(s.leo.id)).json;
  await runNotifications(s.env, at('08:02'));
  mock.timers.setTime(at('08:05').getTime());
  await s.mark(med.id, 'taken');
  await s.req('/api/settings', 'PATCH', { medications: false }); // works while off too
  const res = await s.req('/api/medications', 'DELETE');
  assert.deepEqual([res.status, res.json], [200, { deleted: 1 }]);
  assert.deepEqual([s.raw('medications'), s.raw('medication_log'), feed(s.db)], [[], [], []]);
});

test('medications: no webhooks at all, and the logs never see names or doses', async (t) => {
  t.after(() => mock.timers.reset());
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_u: unknown, init: RequestInit = {}) => { sent.push(String(init.body)); return new Response('ok'); }) as typeof fetch;
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const s = await setup({ now: at('08:05') });
    assert.equal((await s.req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
    const med = (await s.add(s.leo.id)).json;
    await s.req(`/api/medications/${med.id}`, 'PATCH', { dose: `${DOSE} again` });
    await s.mark(med.id, 'snooze');
    await s.mark(med.id, 'taken');
    await s.add(s.leo.id, { name: NAME.repeat(10) }); // 400
    await s.add(s.leo.id, { dose: DOSE, times: [NAME] }); // 400
    await s.req(`/api/medications/${med.id}`, 'DELETE');
    await s.req('/api/medications', 'DELETE');
    const noKey = await setup({ extra: { ENCRYPTION_KEY: undefined } });
    await noKey.add(noKey.leo.id); // 500
    await runNotifications(s.env, at('08:06'));
    await s.settle();
  } finally {
    globalThis.fetch = realFetch;
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  assert.ok(lines.length > 0, 'the failing request was logged');
  assert.deepEqual(sent.filter((b) => /medic/i.test(b)), [], 'no medication webhook events');
  for (const s of [NAME, DOSE]) {
    assert.equal(sent.join('\n').includes(s), false, `webhook: ${s}`);
    assert.equal(lines.join('\n').includes(s), false, `logs: ${s}`);
  }
});

test('medications: the export has them in plain form (it is their backup); import seals them again', async (t) => {
  t.after(() => mock.timers.reset());
  const source = await setup({ now: at('08:05') });
  const id = source.leo.id;
  const med = (await source.add(id, { days: [1, 3], endDate: '2026-10-05', totalDoses: 4, lateWindow: 'evening' })).json;
  await source.mark(med.id, 'taken');
  const file = (await source.req('/api/export')).json;
  assert.equal(file.settings.medications, true);
  assert.deepEqual(file.medications.map((m: any) => [m.id, m.memberId, m.name, m.dose, m.times, m.days, m.endDate, m.totalDoses, m.lateWindow]), [[med.id, id, NAME, DOSE, ['08:00'], [1, 3], '2026-10-05', 4, 'evening']]);
  assert.deepEqual(file.medicationLog.map((d: any) => [d.medicationId, d.date, d.time, d.status, d.by]), [[med.id, TODAY, '08:00', 'taken', 'ADMIN_API_KEY']]);
  const hidden = (await source.req('/api/export', 'GET', undefined, ADMIN, APP)).json;
  assert.deepEqual([hidden.medications, hidden.medicationLog], [[], []], 'a connected app without aiHealthAccess gets neither');
  assert.equal(JSON.stringify(hidden).includes(NAME), false);

  const target = await setup({ now: at('08:05'), on: false });
  const res = await target.req('/api/import', 'POST', file);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([res.json.imported.medications, res.json.imported.medicationLog], [1, 1]);
  assert.match(String(target.raw('medications')[0].data), /^enc:v1:/);
  assert.match(String(target.raw('medication_log')[0].log), /^enc:v1:/);
  assert.equal(JSON.stringify([target.raw('medications'), target.raw('medication_log')]).includes(NAME), false);
  const back = (await target.req(`/api/members/${id}/medications`)).json;
  assert.deepEqual([back.medications[0].name, back.medications[0].endDate, back.medications[0].dosesLeft, back.medications[0].lateWindow, back.days.at(-1).doses[0].status], [NAME, '2026-10-05', 3, 'evening', 'taken']);
  const old = await setup({ now: at('08:05'), on: false });
  const { lateWindow: _, ...before } = file.medications[0];
  assert.equal((await old.req('/api/import', 'POST', { ...file, medications: [before] })).status, 200, 'a file from before late windows');
  assert.equal((await old.req(`/api/members/${id}/medications`)).json.medications[0].lateWindow, '3h');
  assert.equal((await target.req('/api/import', 'POST', file)).status, 200); // again: no duplicates
  assert.deepEqual([target.raw('medications').length, target.raw('medication_log').length], [1, 1]);
  const refused = await target.req('/api/import', 'POST', { ...file, medications: [{ ...file.medications[0], id: 'other' }] }, ADMIN, APP);
  assert.equal(refused.json?.imported?.medications ?? 0, 0, 'a connected app without aiHealthAccess brings none in');
});

// ---- "When I start my day" doses ----
const WAKE = { wake: true, latest: '12:00' };
const started = (s: Awaited<ReturnType<typeof setup>>, id: string, k: string) => s.req(`/api/members/${id}/day-started`, 'POST', undefined, k);
const dueDoses = async (s: Awaited<ReturnType<typeof setup>>) => ((await s.req('/api/medications/due')).json.doses as any[]).map((d) => [d.memberId, d.date, d.time, d.startedAt, d.dueAt, d.until]);

test('start of day: due when their own device first opens the app, pushed once from then; the late window runs from there', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  const med = (await s.add(s.sam.id, { times: [WAKE, '20:00', '20:00'] })).json;
  assert.deepEqual(med.times, [WAKE, '20:00'], 'a start-of-day dose first, then the clock times');
  const sams = await s.key(s.sam.id);
  const tick = await devices(s, [['sams-phone', sams]]);
  assert.deepEqual(await tick(at('07:00')), {});
  assert.deepEqual(await dueDoses(s), []);
  const today = async () => (await s.req(`/api/members/${s.sam.id}/medications`)).json.days.at(-1).doses.map((d: any) => [d.time, d.status, d.startedAt]);
  assert.deepEqual(await today(), [['wake', 'upcoming', null], ['20:00', 'upcoming', null]]);

  mock.timers.setTime(at('09:40').getTime());
  assert.equal((await started(s, s.sam.id, sams)).status, 204);
  mock.timers.setTime(at('09:50').getTime());
  assert.equal((await started(s, s.sam.id, sams)).status, 204, 'again: no change');
  const nine40 = at('09:40').toISOString();
  assert.deepEqual(await dueDoses(s), [[s.sam.id, TODAY, 'wake', nine40, nine40, at('12:40').toISOString()]]);
  assert.deepEqual(await today(), [['wake', 'due', nine40], ['20:00', 'upcoming', null]]);
  assert.deepEqual(await tick(at('09:52')), { 'sams-phone': [{ title: "Time for Sam's medicine", body: 'Tap to mark it taken.' }] });
  assert.deepEqual(await tick(at('09:55')), {}, 'once');
  assert.deepEqual(await tick(at('12:02')), {}, 'no second push at the latest time');
  mock.timers.setTime(at('12:41').getTime());
  assert.deepEqual(await dueDoses(s), [], '3 hours from when the day started');
  mock.timers.setTime(at('12:45').getTime());
  const marked = await s.mark(med.id, 'taken', sams, 'wake');
  assert.deepEqual([marked.status, marked.json.status, marked.json.startedAt], [200, 'taken', nine40]);
  assert.equal((await s.mark(med.id, 'taken', sams, '12:00')).status, 400, 'its latest time is not a dose of its own');
});

test('start of day: with no signal, the latest time; a signal after it changes nothing', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.sam.id, { times: [{ wake: true, latest: '11:30' }], lateWindow: 'evening' });
  const sams = await s.key(s.sam.id);
  const tick = await devices(s, [['sams-phone', sams]]);
  assert.deepEqual(await tick(at('11:20')), {});
  assert.equal((await tick(at('11:32')))['sams-phone'].length, 1, 'due at 11:30');
  mock.timers.setTime(at('11:45').getTime());
  assert.equal((await started(s, s.sam.id, sams)).status, 204);
  assert.deepEqual(await dueDoses(s), [[s.sam.id, TODAY, 'wake', null, at('11:30').toISOString(), at('20:00').toISOString()]]);
  assert.deepEqual(await tick(at('11:47')), {}, 'no double push');
});

test('start of day: the earliest of Temp check, check-in and their own device; for a kid, never a parent device', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.req('/api/settings', 'PATCH', { checkInPoints: 3 });
  for (const m of [s.leo, s.maya, s.sam]) await s.req(`/api/members/${m.id}`, 'PATCH', { tempCheck: { on: true, sleep: true, feelings: true, goal: true, showGoal: true } });
  for (const m of [s.leo, s.maya, s.sam]) await s.add(m.id, { times: [WAKE] });
  const [leos, mayas, wall] = [await s.key(s.leo.id), await s.key(s.maya.id), await s.key()];
  const startOf = async (id: string) => ((await s.req(`/api/members/${id}/medications`)).json.days.at(-1).doses[0].startedAt as string | null);

  // A parent's device opening a kid's day, answering or checking in for them: not their start.
  mock.timers.setTime(at('06:30').getTime());
  assert.equal((await started(s, s.leo.id, ADMIN)).status, 403, 'own device only');
  assert.equal((await started(s, s.leo.id, mayas)).status, 403);
  assert.equal((await started(s, s.leo.id, wall)).status, 403);
  assert.equal((await s.req(`/api/members/${s.leo.id}/temp-check`, 'PUT', { sleep: 'good' })).status, 200);
  assert.equal((await s.req(`/api/members/${s.leo.id}/check-in`, 'POST')).status, 200);
  assert.equal(await startOf(s.leo.id), null);
  // Leo's own Temp check answer (on the wall or his device) is.
  mock.timers.setTime(at('07:10').getTime());
  assert.equal((await s.req(`/api/members/${s.leo.id}/temp-check`, 'PUT', { feelings: ['happy'] }, wall)).status, 200);
  mock.timers.setTime(at('07:30').getTime());
  await started(s, s.leo.id, leos);
  assert.equal(await startOf(s.leo.id), at('07:10').toISOString(), 'the earliest wins');
  // Maya: her check-in from her own device, before she opens the app.
  mock.timers.setTime(at('07:05').getTime());
  assert.equal((await s.req(`/api/members/${s.maya.id}/check-in`, 'POST', undefined, mayas)).status, 200);
  mock.timers.setTime(at('08:00').getTime());
  await started(s, s.maya.id, mayas);
  assert.equal(await startOf(s.maya.id), at('07:05').toISOString());
  // A grown-up answering their own Temp check on a parent device counts.
  assert.equal((await s.req(`/api/members/${s.sam.id}/temp-check`, 'PUT', { sleep: 'ok' })).status, 200);
  assert.equal(await startOf(s.sam.id), at('08:00').toISOString());
});

test("start of day: a grown-up's own full-access device (their phone) counts like their own device; not an unowned one or a connected app", async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  const alex = (await s.req('/api/members', 'POST', { name: 'Alex', color: '#6C8EF5', grownUp: true })).json;
  for (const m of [s.sam, alex]) await s.req(`/api/members/${m.id}`, 'PATCH', { tempCheck: { on: true, sleep: true, feelings: true, goal: true, showGoal: true } });
  for (const m of [s.sam, alex]) await s.add(m.id, { times: [WAKE] });
  const [samsPhone, shared] = [await s.key(s.sam.id, 'admin'), await s.key(undefined, 'admin')];
  const startOf = async (id: string) => ((await s.req(`/api/members/${id}/medications`)).json.days.at(-1).doses[0].startedAt as string | null);

  mock.timers.setTime(at('06:30').getTime());
  assert.equal((await started(s, alex.id, samsPhone)).status, 403, "Sam's phone isn't Alex's");
  assert.equal((await started(s, s.sam.id, shared)).status, 403, 'a full-access key nobody owns');
  const app = await s.req(`/api/members/${s.sam.id}/day-started`, 'POST', undefined, samsPhone, { 'X-Kinwall-Source': 'mcp' });
  assert.equal(app.status, 403, 'a connected app is never anyone\'s own device');
  // Sam's phone answering Alex's Temp check doesn't start Alex's day (it would on an unowned parent device).
  assert.equal((await s.req(`/api/members/${alex.id}/temp-check`, 'PUT', { sleep: 'ok' }, samsPhone)).status, 200);
  assert.equal(await startOf(alex.id), null);
  assert.equal(await startOf(s.sam.id), null);
  mock.timers.setTime(at('07:00').getTime());
  assert.equal((await started(s, s.sam.id, samsPhone)).status, 204);
  assert.equal(await startOf(s.sam.id), at('07:00').toISOString());
});

test("start of day: the household's day and clock, not UTC's", async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({ now: at('06:00') });
  await s.add(s.sam.id, { times: [{ wake: true, latest: '20:00' }] });
  const sams = await s.key(s.sam.id);
  mock.timers.setTime(at('17:30').getTime()); // already the 29th in UTC
  assert.equal(new Date().toISOString().slice(0, 10), '2026-09-29');
  await started(s, s.sam.id, sams);
  assert.deepEqual((await dueDoses(s)).map((d) => [d[1], d[3]]), [[TODAY, at('17:30').toISOString()]]);
  mock.timers.setTime(at('00:30', '2026-09-29').getTime());
  assert.equal((await started(s, s.sam.id, sams)).status, 204);
  const h = (await s.req(`/api/members/${s.sam.id}/medications`)).json.days;
  assert.deepEqual(h.slice(-2).map((d: any) => [d.date, d.doses[0].startedAt]), [[TODAY, at('17:30').toISOString()], ['2026-09-29', at('00:30', '2026-09-29').toISOString()]]);
});

test('start of day: sealed with the log, never logged; old plain times still read and are rewritten in the new shape; export and import keep it', async (t) => {
  t.after(() => mock.timers.reset());
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  let s: Awaited<ReturnType<typeof setup>>;
  let med: any;
  try {
    s = await setup({ now: at('06:00') });
    med = (await s.add(s.sam.id, { times: [WAKE] })).json;
    const sams = await s.key(s.sam.id);
    mock.timers.setTime(at('09:17').getTime());
    await started(s, s.sam.id, sams);
    await started(s, s.sam.id, ADMIN); // 403
    await s.req(`/api/members/${s.sam.id}/day-started`, 'POST', { at: '05:00' }, sams); // no body needed or used
    const noKey = await setup({ extra: { ENCRYPTION_KEY: undefined }, now: at('09:17') });
    await noKey.db.prepare('INSERT INTO medications (id, member_id, data, created_at, updated_at) VALUES (?,?,?,?,?)').bind('m1', noKey.sam.id, 'enc:v1:nope', 'x', 'x').run();
    assert.equal((await started(noKey, noKey.sam.id, await noKey.key(noKey.sam.id))).status, 500, 'no key: fails closed');
    await runNotifications(s.env, at('09:19'));
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  for (const x of [NAME, DOSE, '09:17', at('09:17').toISOString(), 'startedAt']) assert.equal(lines.join('\n').includes(x), false, `logs: ${x}`);
  const stored = JSON.stringify([s!.raw('medications'), s!.raw('medication_log'), s!.raw('sent_notifications')]);
  for (const x of ['09:17', at('09:17').toISOString(), 'startedAt', 'wake', '12:00']) assert.equal(stored.includes(x), false, `stored: ${x}`);

  // A medicine sealed before this change: plain "HH:MM" times, no late window.
  await s!.db.prepare('INSERT INTO medications (id, member_id, data, created_at, updated_at) VALUES (?,?,?,?,?)')
    .bind('old', s!.leo.id, await seal(s!.env, JSON.stringify({ name: 'Old', dose: '', times: ['08:00', '20:00'], days: [0, 1, 2, 3, 4, 5, 6] }), 'old:data'), at('06:00').toISOString(), at('06:00').toISOString()).run();
  const old = (await s!.req('/api/medications')).json.find((m: any) => m.id === 'old');
  assert.deepEqual([old.times, old.lateWindow], [['08:00', '20:00'], '3h']);
  await s!.req('/api/medications/old', 'PATCH', { dose: '1 tablet' });
  const row = s!.raw('medications').find((r) => r.id === 'old')!;
  assert.deepEqual(JSON.parse(await unseal(s!.env, String(row.data), 'old:data')).times, [{ at: '08:00' }, { at: '20:00' }], 'written in the new shape');

  const file = (await s!.req('/api/export')).json;
  assert.deepEqual(file.medications.find((m: any) => m.id === med.id).times, [WAKE]);
  assert.deepEqual(file.medications.find((m: any) => m.id === 'old').times, ['08:00', '20:00'], 'clock times stay plain strings in the file');
  assert.deepEqual(file.medicationLog.map((d: any) => [d.time, d.status, d.startedAt]), [['wake', null, at('09:17').toISOString()]]);
  const target = await setup({ now: at('09:30'), on: false });
  assert.equal((await target.req('/api/import', 'POST', file)).status, 200);
  await target.req('/api/settings', 'PATCH', { medications: true });
  const back = (await target.req(`/api/members/${s!.sam.id}/medications`)).json;
  assert.deepEqual([back.medications[0].times, back.days.at(-1).doses[0].startedAt], [[WAKE], at('09:17').toISOString()]);
});

test('start of day: times are checked (one start-of-day dose at most, a valid latest time)', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  for (const times of [[WAKE, { wake: true, latest: '10:00' }], [{ wake: true }], [{ wake: true, latest: '25:00' }], [{ wake: false, latest: '10:00' }], [{ at: '08:00' }]]) {
    assert.equal((await s.add(s.sam.id, { times })).status, 400, JSON.stringify(times));
  }
  assert.equal((await s.add(s.sam.id, { times: [WAKE] })).status, 201);
});
