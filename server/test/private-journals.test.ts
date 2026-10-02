// Private journals: an entry written while a journal is private opens only on a device that
// belongs to that person. Everyone else (the other parent's phone, an unowned admin key, the
// recovery session, another member's device, connected apps even with aiHealthAccess) sees the
// mood and that it exists, never the words. The same goes for that day's goal-check notes.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const NOW = new Date('2026-09-27T05:00:00Z'); // 10 pm in Los Angeles, 2026-09-26
const SECRET = 'zz-private-diary-line';
const EVENING = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '21:00', journal: true };

async function setup() {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY } as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles' });
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#5B8DEF', grownUp: true, tempCheck: EVENING })).json;
  const sam = (await req('/api/members', 'POST', { name: 'Sam', color: '#F29E4C', grownUp: true })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#7ED9A6', tempCheck: EVENING })).json;
  // A parent's phone: a full-access key that belongs to them (Settings → Access).
  const adminFor = async (owner: string) => {
    const k = (await req('/api/keys', 'POST', { name: `phone-${owner}`, scope: 'admin' })).json;
    const set = await req(`/api/keys/${k.id}`, 'PATCH', { owner });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    return k.key as string;
  };
  const displayFor = async (owner: string) => {
    const k = (await req('/api/keys', 'POST', { name: `device-${owner}`, scope: 'display' })).json;
    assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const alexPhone = await adminFor(alex.id);
  const samPhone = await adminFor(sam.id);
  const leoDevice = await displayFor(leo.id);
  const feed = async (key = ADMIN) => (await req('/api/notifications', 'GET', undefined, key)).json as { id: string; kind: string; title: string; body: string | null }[];
  const security = async () => ((await req('/api/security-events?limit=100')).json as { kind: string; summary: string }[]);
  return { env, db, req, alex, sam, leo, alexPhone, samPhone, leoDevice, adminFor, displayFor, feed, security };
}

const jr = (id: string, rest = '') => `/api/members/${id}/journal${rest}`;
const entries = (j: any) => j.days.flatMap((d: any) => d.entries);

test("a grown-up's journal is private by default: only their own device reads the words", async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, alex, alexPhone, samPhone, leoDevice } = await setup();
  assert.deepEqual(alex.privateJournal, { on: true, allowed: true });
  const own = await req(jr(alex.id), 'GET', undefined, alexPhone);
  assert.deepEqual(own.json.privacy, { on: true, mine: true, canChange: true, allowed: true });
  const made = await req(jr(alex.id), 'POST', { text: SECRET, mood: '😊' }, alexPhone);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.private, true);
  assert.equal(entries((await req(jr(alex.id), 'GET', undefined, alexPhone)).json)[0].text, SECRET);

  // The other parent's phone, an unowned admin key and a connected app with health access on.
  const claude = (await createApiKey(db as any, 'Claude', 'admin', { kind: 'oauth' })).key;
  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  for (const [who, key] of [['other parent', samPhone], ['unowned admin', ADMIN], ['connected app', claude]] as const) {
    const res = await req(jr(alex.id), 'GET', undefined, key);
    assert.equal(res.status, 200, who);
    const [e] = entries(res.json);
    assert.deepEqual([e.text, e.mood, e.private], [null, '😊', true], who);
    assert.equal(res.json.privacy.mine, false, who);
    assert.ok(!JSON.stringify(res.json).includes(SECRET), who);
  }
  assert.equal((await req(jr(alex.id), 'GET', undefined, leoDevice)).status, 403, "another member's device");

  // Only Alex's own devices write, change or delete in a private journal.
  const id = made.json.id;
  assert.equal((await req(jr(alex.id, `/${id}`), 'PATCH', { text: 'overwritten' }, samPhone)).status, 403);
  assert.equal((await req(jr(alex.id, `/${id}`), 'DELETE', undefined, ADMIN)).status, 403);
  assert.equal((await req(jr(alex.id), 'POST', { text: 'from Sam' }, samPhone)).status, 403);
  assert.equal((await req(jr(alex.id, `/${id}`), 'PATCH', { mood: '😴' }, alexPhone)).json.text, SECRET);

  // Insights still count the mood.
  const ins = await req(`/api/members/${alex.id}/insights?range=4w`, 'GET', undefined, samPhone);
  assert.equal(ins.status, 200);
  assert.ok(!JSON.stringify(ins.json).includes(SECRET));
});

test('turning privacy off never exposes what was written while it was on; only the owner can change it', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, alexPhone, samPhone, feed, security } = await setup();
  await req(jr(alex.id), 'POST', { text: SECRET }, alexPhone);
  assert.equal((await req(jr(alex.id, '/privacy'), 'PUT', { private: false }, samPhone)).status, 403, "the other parent can't");
  assert.equal((await req(jr(alex.id, '/privacy'), 'PUT', { private: false }, ADMIN)).status, 403, 'an unowned admin key can\'t');
  const off = await req(jr(alex.id, '/privacy'), 'PUT', { private: false }, alexPhone);
  assert.equal(off.status, 200, JSON.stringify(off.json));
  assert.equal(off.json.on, false);
  assert.ok((await feed(alexPhone)).some((n) => n.kind === 'privacy' && n.title.includes('Alex')), "Alex's own devices say so");
  assert.ok(!(await feed(samPhone)).some((n) => n.kind === 'privacy' && n.title.includes('Alex')), "not in Sam's bell");
  assert.ok((await security()).some((e) => e.kind === 'journal.privacy' && e.summary.includes('Alex')), 'the security log says so');
  await req(jr(alex.id), 'POST', { text: 'family can read this' }, alexPhone);
  const seen = entries((await req(jr(alex.id), 'GET', undefined, samPhone)).json).map((e: any) => e.text);
  assert.deepEqual(seen.sort(), [null, 'family can read this'].sort());
});

test("kids: a parent allows a private journal, the kid turns it on; disallowing keeps old entries private", async (t) => {
  t.after(() => mock.timers.reset());
  const { req, leo, leoDevice, samPhone, feed, security } = await setup();
  assert.deepEqual(leo.privateJournal, { on: false, allowed: false });
  assert.equal((await req(jr(leo.id, '/privacy'), 'PUT', { private: true }, leoDevice)).status, 403, 'not allowed yet');
  assert.equal((await req(jr(leo.id, '/privacy'), 'PUT', { allowed: true }, leoDevice)).status, 403, "a kid can't allow it");
  const allowed = await req(jr(leo.id, '/privacy'), 'PUT', { allowed: true }, samPhone);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.deepEqual([allowed.json.allowed, allowed.json.on], [true, false], 'allowed, still off until Leo turns it on');
  assert.equal((await req(jr(leo.id, '/privacy'), 'PUT', { private: true }, samPhone)).status, 403, "a parent can't turn it on for him");
  assert.equal((await req(jr(leo.id, '/privacy'), 'PUT', { private: true }, leoDevice)).json.on, true);
  await req(jr(leo.id), 'POST', { text: SECRET, mood: '😢' }, leoDevice);

  const parent = entries((await req(jr(leo.id), 'GET', undefined, samPhone)).json);
  assert.deepEqual([parent[0].text, parent[0].mood], [null, '😢']);

  // A parent turns it off: new entries are shared, the private one stays private.
  await req(jr(leo.id, '/privacy'), 'PUT', { allowed: false }, samPhone);
  const after = (await req(jr(leo.id), 'GET', undefined, leoDevice)).json;
  assert.equal(after.privacy.on, false);
  await req(jr(leo.id), 'POST', { text: 'shared now' }, leoDevice);
  const texts = entries((await req(jr(leo.id), 'GET', undefined, samPhone)).json).map((e: any) => e.text);
  assert.deepEqual(texts.sort(), [null, 'shared now'].sort());
  assert.equal(entries((await req(jr(leo.id), 'GET', undefined, leoDevice)).json).find((e: any) => e.private).text, SECRET, 'Leo still reads it');
  const log = (await feed(leoDevice)).filter((n) => n.kind === 'privacy').map((n) => n.title);
  assert.ok(log.some((l) => l.includes('Leo')) && log.length >= 3, `Leo's device tells him: ${JSON.stringify(log)}`);
  const seen = (await security()).filter((e) => e.kind === 'journal.privacy').map((e) => e.summary);
  assert.ok(seen.length >= 3 && seen.every((l) => l.includes('Leo')), JSON.stringify(seen));
});

test("goal-check notes on a private day: the outcome shows, the notes don't", async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, alexPhone, samPhone } = await setup();
  const tc = `/api/members/${alex.id}/temp-check`;
  await req(tc, 'PUT', { goal: 'Run 5k' }, alexPhone);
  const saved = await req(tc, 'PUT', { followup: { outcome: 'partly', helped: SECRET, hindered: null, next: null } }, alexPhone);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.followup.helped, SECRET);

  const other = (await req(tc, 'GET', undefined, samPhone)).json;
  assert.deepEqual([other.followup, other.followupHidden], [{ outcome: 'partly', helped: null, hindered: null, next: null }, true]);
  const day = (await req(jr(alex.id), 'GET', undefined, ADMIN)).json.days[0];
  assert.deepEqual([day.tempCheck.followup.outcome, day.tempCheck.followup.helped, day.tempCheck.followupHidden], ['partly', null, true]);
  assert.equal((await req(tc, 'PUT', { followup: { outcome: 'no' } }, samPhone)).status, 403, "can't overwrite what they can't read");
  assert.equal((await req(tc, 'GET', undefined, alexPhone)).json.followup.helped, SECRET);
});

test('export leaves private words out (mood kept); importing it never overwrites or unseals a private entry', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, alexPhone } = await setup();
  const tc = `/api/members/${alex.id}/temp-check`;
  const e = (await req(jr(alex.id), 'POST', { text: SECRET, mood: '🙂' }, alexPhone)).json;
  await req(tc, 'PUT', { goal: 'Run 5k' }, alexPhone);
  await req(tc, 'PUT', { followup: { outcome: 'yes', helped: SECRET, hindered: null, next: null } }, alexPhone);

  const file = (await req('/api/export', 'GET', undefined, alexPhone)).json;
  assert.ok(!JSON.stringify(file).includes(SECRET), 'not even for the owner');
  const exported = file.journalEntries.find((x: any) => x.id === e.id);
  assert.deepEqual([exported.text, exported.mood, exported.private], [null, '🙂', true]);
  assert.equal(file.tempChecks.find((x: any) => x.memberId === alex.id).followup.outcome, 'yes');

  const back = await req('/api/import', 'POST', file);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  // An older file that still has the words must not overwrite or unmark the private entry either.
  const old = { ...file, journalEntries: [{ ...exported, text: 'changed by an old backup', private: undefined }] };
  delete old.journalEntries[0].private;
  assert.equal((await req('/api/import', 'POST', old)).status, 200);
  const mine = entries((await req(jr(alex.id), 'GET', undefined, alexPhone)).json).find((x: any) => x.id === e.id);
  assert.deepEqual([mine.text, mine.private], [SECRET, true]);
  assert.equal((await req(tc, 'GET', undefined, alexPhone)).json.followup.helped, SECRET);
});

test('admin devices get an owner: only a grown-up; never the recovery session or a connected app; logged', async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, alex, leo, alexPhone: alexOld, feed, security } = await setup();
  mock.timers.tick(5 * 60_000); // Alex's phone has been Alex's for a while
  const k = (await req('/api/keys', 'POST', { name: 'Tablet', scope: 'admin' })).json;
  assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner: leo.id })).status, 400, 'a full-access device belongs to a grown-up');

  // "This is my device" from the device itself: a passkey session saves it on the passkey.
  db.prepare("INSERT INTO passkeys (id, credential_id, public_key, name, created_at) VALUES ('pk1', 'cred', 'pub', 'Alex phone', ?)").bind(NOW.toISOString()).run();
  const session = (await createApiKey(db as any, 'Passkey: Alex phone', 'admin', { kind: 'session', passkeyId: 'pk1', expiresAt: '2030-01-01T00:00:00Z' })).key;
  const claimed = await req('/api/me/owner', 'PUT', { owner: alex.id }, session);
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  assert.equal(db.prepare("SELECT owner FROM passkeys WHERE id = 'pk1'").first<{ owner: string }>()?.owner, alex.id);
  assert.equal((await req('/api/me', 'GET', undefined, session)).json.owner, alex.id);
  const line = (await feed(session)).find((n: any) => n.kind === 'privacy' && n.title.includes('Alex')) as any;
  assert.ok(line, "on Alex's own devices");
  assert.ok((await security()).some((e) => e.kind === 'device.owner' && e.summary.includes('now belongs to Alex')), 'in the security log');
  assert.equal((await req(`/api/notifications/${line.id}`, 'DELETE')).status, 403, 'an admin key with no owner can\'t remove it');
  await req('/api/notifications', 'DELETE');
  assert.ok((await feed(session)).some((n: any) => n.id === line.id), 'or clear it');
  assert.equal((await req(`/api/notifications/${line.id}`, 'DELETE', undefined, session)).status, 403, "not the sign-in the note is about: it wasn't Alex's before");
  await req('/api/notifications', 'DELETE', undefined, session);
  assert.ok((await feed(session)).some((n: any) => n.id === line.id), 'or clear it');
  assert.equal((await req(`/api/notifications/${line.id}`, 'DELETE', undefined, alexOld)).status, 200, 'Alex can, from a device that was already Alex\'s');
  assert.ok(!(await feed(session)).some((n: any) => n.id === line.id));
  assert.ok((await security()).some((e) => e.kind === 'device.owner' && e.summary.includes('now belongs to Alex')), 'the security log keeps it');

  const recovery = (await createApiKey(db as any, 'Recovery (support)', 'admin', { kind: 'session', expiresAt: '2030-01-01T00:00:00Z' })).key;
  assert.equal((await req('/api/me/owner', 'PUT', { owner: alex.id }, recovery)).status, 400);
  assert.equal((await req('/api/me/owner', 'PUT', { owner: alex.id }, ADMIN)).status, 400, 'the environment admin key has no owner');
  const claude = (await createApiKey(db as any, 'Claude', 'admin', { kind: 'oauth' })).key;
  assert.equal((await req('/api/me/owner', 'PUT', { owner: alex.id }, claude)).status, 403);
  // Even a connected app's key with an owner set in the database reads no private text.
  const sneaky = (await createApiKey(db as any, 'Claude', 'admin', { kind: 'oauth', owner: alex.id })).key;
  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  const alexPhone = (await createApiKey(db as any, 'phone', 'admin', { owner: alex.id })).key;
  await req(jr(alex.id), 'POST', { text: SECRET }, alexPhone);
  assert.equal(entries((await req(jr(alex.id), 'GET', undefined, sneaky)).json)[0].text, null);
});

test("migrations 0063 and 0086: grown-ups' existing entries become private to their full-access devices, kids' stay as they were", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kw-mig-'));
  for (const f of readdirSync(MIGRATIONS).filter((f) => f < '0063')) copyFileSync(path.join(MIGRATIONS, f), path.join(dir, f));
  const db = openDb(':memory:');
  applyMigrations(db, dir);
  const now = NOW.toISOString();
  db.prepare("INSERT INTO members (id, name, color, sort, created_at, grown_up) VALUES ('a', 'Alex', '#000', 0, ?, 1), ('l', 'Leo', '#000', 1, ?, 0)").bind(now, now).run();
  db.prepare("INSERT INTO journal_entries (id, member_id, date, text, mood, created_at, updated_at) VALUES ('ea', 'a', '2026-09-01', 'x', NULL, ?, ?), ('el', 'l', '2026-09-01', 'x', NULL, ?, ?)").bind(now, now, now, now).run();
  applyMigrations(db, MIGRATIONS);
  const rows = db.prepare('SELECT id, private FROM journal_entries ORDER BY id').all<{ id: string; private: number }>().results;
  assert.deepEqual(rows.map((r) => [r.id, r.private]), [['ea', 2], ['el', 0]]);
});

test("a paired device (everyday access) never opens a grown-up's private journal, even one paired as theirs before", async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, alex, alexPhone } = await setup();
  await req(jr(alex.id), 'POST', { text: SECRET, mood: '😊' }, alexPhone);
  const k = (await req('/api/keys', 'POST', { name: 'Alex tablet', scope: 'display' })).json;
  assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner: alex.id })).status, 400, "an admin can't make one a grown-up's now");
  // One paired as Alex's before that rule (or through an older app sign-in).
  const legacy = (await createApiKey(db as any, 'Alex tablet (old)', 'display', { owner: alex.id })).key;
  const res = await req(jr(alex.id), 'GET', undefined, legacy);
  assert.ok(!JSON.stringify(res.json).includes(SECRET), `status ${res.status}`);
  assert.equal((await req(jr(alex.id), 'POST', { text: 'from the tablet' }, legacy)).status, 403);
});
