// The trail around private journals can't be erased or sidestepped by another parent's device:
// - a device that says it's someone's can't remove the privacy note about that (routes/push.ts);
// - a flood of other security events can't push out the ones about a person (routes/security-events.ts);
// - marking a grown-up as a kid is logged, told to them, not open to connected apps, and never hands
//   what they wrote in private to an everyday-access device (routes/members.ts, journal-privacy.ts);
// - an import can't write into a journal that's private to someone else (routes/data.ts).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import { deviceOwnerEvent, recordSecurityEvent, SECURITY_KEEP } from '../src/routes/security-events.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const NOW = new Date('2026-09-27T05:00:00Z'); // 10 pm in Los Angeles, 2026-09-26
const SECRET = 'zz-private-diary-line';
const EVENING = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '21:00', journal: true };
const MINUTES = 60_000;

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
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#7ED9A6' })).json;
  const keyFor = async (owner: string, scope: 'admin' | 'display', name = `${scope}-${owner}`) => {
    const k = (await req('/api/keys', 'POST', { name, scope })).json;
    const set = await req(`/api/keys/${k.id}`, 'PATCH', { owner });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    return k.key as string;
  };
  const alexPhone = await keyFor(alex.id, 'admin', "Alex's phone");
  const samPhone = await keyFor(sam.id, 'admin', "Sam's phone");
  const notes = () => db.prepare("SELECT id, title FROM notifications WHERE kind = 'privacy' ORDER BY at, rowid").all<{ id: string; title: string }>().results;
  const security = async () => ((await req('/api/security-events?limit=100')).json as { kind: string; summary: string }[]);
  return { env, db, req, alex, sam, leo, alexPhone, samPhone, keyFor, notes, security };
}

const jr = (id: string, rest = '') => `/api/members/${id}/journal${rest}`;
const entries = (j: any) => j.days.flatMap((d: any) => d.entries);

test("a device that says it's Alex's can't remove the note about that; a device already Alex's can", async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, alex, sam, alexPhone, samPhone, keyFor, notes } = await setup();
  mock.timers.tick(5 * MINUTES);
  const before = new Set(notes().map((n) => n.id));

  // Sam's phone says it's Alex's: Alex gets a note. That phone can't remove it, one at a time or all at once.
  assert.equal((await req('/api/me/owner', 'PUT', { owner: alex.id }, samPhone)).status, 200);
  const claim = notes().find((n) => !before.has(n.id))!;
  assert.match(claim.title, /Sam's phone now belongs to Alex/);
  assert.equal((await req(`/api/notifications/${claim.id}`, 'DELETE', undefined, samPhone)).status, 403);
  assert.equal((await req('/api/notifications', 'DELETE', undefined, samPhone)).status, 200);
  assert.ok(notes().some((n) => n.id === claim.id), 'clearing the feed leaves it');

  // Nor a second key made to be Alex's (PATCH /api/keys), then or later; nor Sam's phone, later.
  mock.timers.tick(5 * MINUTES);
  const second = await keyFor(alex.id, 'admin', 'Second');
  mock.timers.tick(5 * MINUTES);
  for (const key of [second, samPhone]) {
    assert.equal((await req(`/api/notifications/${claim.id}`, 'DELETE', undefined, key)).status, 403);
    await req('/api/notifications', 'DELETE', undefined, key);
  }
  assert.ok(notes().some((n) => n.id === claim.id));
  // Nor after handing the phone back and claiming again.
  await req('/api/me/owner', 'PUT', { owner: sam.id }, samPhone);
  await req('/api/me/owner', 'PUT', { owner: alex.id }, samPhone);
  assert.equal((await req(`/api/notifications/${claim.id}`, 'DELETE', undefined, samPhone)).status, 403);

  // A passkey's fresh sign-in is as old as the passkey's claim, not as the session.
  db.prepare("INSERT INTO passkeys (id, credential_id, public_key, name, created_at) VALUES ('pk1', 'cred', 'pub', 'Laptop', ?)").bind(NOW.toISOString()).run();
  const session = async () => (await createApiKey(db as any, 'Passkey: Laptop', 'admin', { kind: 'session', passkeyId: 'pk1', expiresAt: '2030-01-01T00:00:00Z', owner: db.prepare("SELECT owner FROM passkeys WHERE id = 'pk1'").first<{ owner: string | null }>()!.owner })).key;
  assert.equal((await req('/api/me/owner', 'PUT', { owner: alex.id }, await session())).status, 200);
  mock.timers.tick(5 * MINUTES);
  assert.equal((await req(`/api/notifications/${claim.id}`, 'DELETE', undefined, await session())).status, 403, 'the passkey became Alex\'s after the note');

  // Alex's own phone, Alex's since before any of this, reads the note and removes it.
  assert.equal((await req(`/api/notifications/${claim.id}`, 'DELETE', undefined, alexPhone)).status, 200);
  assert.ok(!notes().some((n) => n.id === claim.id));
});

test("the Kinwall app's sign-in made Alex's from Settings can't remove the note about it either", async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, alex, notes } = await setup();
  const at = NOW.toISOString();
  db.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES ('c1', 'Kinwall for iPhone', '[]', ?)").bind(at).run();
  db.prepare("INSERT INTO oauth_grants (id, client_id, scope, created_at, owner, device_app) VALUES ('g1', 'c1', 'admin', ?, 'shared', 1)").bind(at).run();
  const app = await createApiKey(db as any, 'Kinwall for iPhone', 'admin', { kind: 'oauth', owner: 'shared' });
  db.prepare("UPDATE api_keys SET oauth_grant_id = 'g1' WHERE id = ?").bind(app.id).run();
  mock.timers.tick(5 * MINUTES);
  assert.equal((await req('/api/authorizations/g1', 'PATCH', { owner: alex.id })).status, 200);
  const note = notes().find((n) => n.title.includes('Kinwall for iPhone'))!;
  mock.timers.tick(5 * MINUTES);
  assert.equal((await req(`/api/notifications/${note.id}`, 'DELETE', undefined, app.key)).status, 403);
});

test("security activity: a flood of other events, or of events about someone else, can't push out one about Alex", async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, alex, sam, samPhone, security } = await setup();
  await req('/api/me/owner', 'PUT', { owner: alex.id }, samPhone);
  for (let i = 0; i < SECURITY_KEEP + 10; i++) {
    await recordSecurityEvent(db as any, { kind: 'key.created', summary: `key ${i}` });
    await recordSecurityEvent(db as any, { kind: 'key.removed', summary: `key ${i}` });
    await recordSecurityEvent(db as any, await deviceOwnerEvent(db as any, 'Spare', i % 2 ? sam.id : 'shared', null, null));
  }
  const kept = db.prepare("SELECT summary FROM security_events WHERE kind = 'device.owner'").all<{ summary: string }>().results.map((r) => r.summary);
  assert.ok(kept.some((s) => s.includes("Sam's phone") && s.includes('now belongs to Alex')), 'the claim on Alex is still there');
  assert.ok((await security()).length > 0);
  const count = (where: string) => db.prepare(`SELECT COUNT(*) AS n FROM security_events WHERE ${where}`).first<{ n: number }>()!.n;
  assert.equal(count("kind = 'key.created'"), SECURITY_KEEP, 'each kind keeps its newest 500');
  assert.ok(count('1') <= 5 * SECURITY_KEEP, 'still bounded');
});

test('marking a grown-up as a kid: logged, told to them, kept from connected apps, and their private entries stay shut', async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, alex, leo, alexPhone, samPhone, keyFor, notes, security } = await setup();
  const made = (await req(jr(alex.id), 'POST', { text: SECRET, mood: '😊' }, alexPhone)).json;
  const tc = `/api/members/${alex.id}/temp-check`;
  await req(tc, 'PUT', { goal: 'Run 5k' }, alexPhone);
  assert.equal((await req(tc, 'PUT', { followup: { outcome: 'partly', helped: SECRET, hindered: null, next: null } }, alexPhone)).status, 200);

  // A connected app can't change who is a grown-up (REST with its token, or through an import).
  const claude = (await createApiKey(db as any, 'Claude', 'admin', { kind: 'oauth' })).key;
  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  assert.equal((await req(`/api/members/${alex.id}`, 'PATCH', { grownUp: false }, claude)).status, 403);
  assert.equal((await req(`/api/members/${alex.id}`, 'PATCH', { grownUp: true, color: '#5B8DEE' }, claude)).status, 200, 'unchanged is fine');
  const file = (await req('/api/export')).json;
  const flipped = { ...file, members: file.members.map((m: any) => (m.id === alex.id ? { ...m, grownUp: false } : m)) };
  assert.equal((await req('/api/import', 'POST', flipped, claude)).status, 200);
  assert.equal((await req('/api/members')).json.find((m: any) => m.id === alex.id).grownUp, true, "an app's import leaves it");
  assert.ok(!(await security()).some((e) => e.kind === 'member.grown_up'));

  // Sam's phone does it: one line in Security activity, one note for Alex.
  mock.timers.tick(5 * MINUTES);
  const down = await req(`/api/members/${alex.id}`, 'PATCH', { grownUp: false }, samPhone);
  assert.equal(down.status, 200, JSON.stringify(down.json));
  assert.deepEqual((await security()).filter((e) => e.kind === 'member.grown_up').map((e) => e.summary), ['Alex is no longer marked as a grown-up']);
  assert.ok(notes().some((n) => n.title === 'Alex is no longer marked as a grown-up'));
  assert.deepEqual(down.json.privateJournal, { on: true, allowed: true }, 'the journal stays private');

  // An everyday-access device made "Alex's" now opens nothing Alex wrote as a grown-up.
  const tablet = await keyFor(alex.id, 'display', 'Tablet');
  const seen = await req(jr(alex.id), 'GET', undefined, tablet);
  assert.equal(seen.status, 200);
  assert.ok(!JSON.stringify(seen.json).includes(SECRET));
  assert.deepEqual([entries(seen.json)[0].text, entries(seen.json)[0].private, seen.json.days[0].tempCheck.followupHidden], [null, true, true]);
  assert.ok(!JSON.stringify((await req(tc, 'GET', undefined, tablet)).json).includes(SECRET));
  assert.equal((await req(jr(alex.id, `/${made.id}`), 'PATCH', { text: 'overwritten' }, tablet)).status, 403);
  assert.equal((await req(jr(alex.id, `/${made.id}`), 'DELETE', undefined, tablet)).status, 403);
  assert.equal((await req(tc, 'PUT', { followup: { outcome: 'no' } }, tablet)).status, 403);
  // Nor do parents' devices read what's written meanwhile: the tablet's entries are private too.
  assert.equal((await req(jr(alex.id), 'POST', { text: 'from the tablet' }, tablet)).json.private, true);
  assert.equal((await req(jr(alex.id), 'POST', { text: 'from Sam' }, samPhone)).status, 403);

  // The same through an import from a parent's device: logged and noted, never silent.
  await req(`/api/members/${alex.id}`, 'PATCH', { grownUp: true }, samPhone);
  assert.equal((await req('/api/import', 'POST', flipped, samPhone)).status, 200);
  assert.equal((await req('/api/members')).json.find((m: any) => m.id === alex.id).grownUp, false);
  assert.deepEqual((await security()).filter((e) => e.kind === 'member.grown_up').map((e) => e.summary).reverse(),
    ['Alex is no longer marked as a grown-up', 'Alex is now marked as a grown-up', 'Alex is no longer marked as a grown-up']);
  assert.equal((await req(`/api/members/${leo.id}`, 'PATCH', { name: 'Leo', grownUp: false }, samPhone)).status, 200);
  assert.equal((await security()).filter((e) => e.kind === 'member.grown_up').length, 3, 'nothing when it did not change');

  // Back to a grown-up: Alex's phone reads everything again and sees every note; the tablet can't remove them.
  await req(`/api/members/${alex.id}`, 'PATCH', { grownUp: true }, samPhone);
  const mine = (await req(jr(alex.id), 'GET', undefined, alexPhone)).json;
  assert.equal(entries(mine).find((e: any) => e.id === made.id).text, SECRET);
  assert.equal((await req(tc, 'GET', undefined, alexPhone)).json.followup.helped, SECRET);
  const bell = ((await req('/api/notifications', 'GET', undefined, alexPhone)).json as { title: string }[]).map((n) => n.title);
  assert.ok(bell.includes('Alex is no longer marked as a grown-up') && bell.includes('Alex is now marked as a grown-up') && bell.includes('Tablet now belongs to Alex'), JSON.stringify(bell));
});

test("an import can't add to or overwrite a journal that's private to someone else", async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, leo, alexPhone, samPhone } = await setup();
  await req(jr(alex.id, '/privacy'), 'PUT', { private: false }, alexPhone);
  const open = (await req(jr(alex.id), 'POST', { text: 'written while shared' }, alexPhone)).json;
  await req(jr(alex.id, '/privacy'), 'PUT', { private: true }, alexPhone);
  assert.equal((await req(jr(alex.id), 'POST', { text: 'from Sam' }, samPhone)).status, 403, 'the route refuses');

  const file = (await req('/api/export')).json;
  const entry = (id: string, memberId: string, text: string) => ({ id, memberId, date: '2026-09-25', text, mood: null, private: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
  const planted = { ...file, journalEntries: [entry('p-alex', alex.id, 'planted'), entry(open.id, leo.id, 'overwritten'), entry('p-leo', leo.id, 'for Leo')] };
  const back = await req('/api/import', 'POST', planted, samPhone);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const texts = async (id: string, key: string) => entries((await req(jr(id), 'GET', undefined, key)).json).map((e: any) => e.text).sort();
  assert.deepEqual(await texts(alex.id, alexPhone), ['written while shared'], "nothing added to Alex's journal, nothing in it changed");
  assert.deepEqual(await texts(leo.id, samPhone), ['for Leo'], "a kid's journal still imports");

  // Alex's own device restores into Alex's journal.
  assert.equal((await req('/api/import', 'POST', planted, alexPhone)).status, 200);
  assert.deepEqual(await texts(alex.id, alexPhone), ['overwritten', 'planted']);
});
