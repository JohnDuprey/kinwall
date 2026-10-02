// Medicine notes in the bell's feed (notify.ts runMedicationReminders, kind 'medication'): health data
// at rest (AGENTS.md "Health data"). The note's text and exact time are sealed with the family key;
// only the kind, the day and whose note it is stay plain. Parents read the same text as before; kids'
// devices, walls and connected apps without aiHealthAccess still don't get parent-facing notes.
// Notes saved before this are sealed when the server starts (createKinwall), and a tick without a
// key writes no medicine note at all while the other reminders still go out.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { createKinwall } from '../src/entry.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { MED_LATE, recordNotification, runNotifications, sealMedicationNotes } from '../src/notify.ts';
import { unseal } from '../src/crypto.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const at = (local: string) => new Date(`2026-09-28T${local}:00-07:00`); // Los Angeles (PDT), a Monday
const NAME = 'zz-sleepy-syrup';
const APP = { 'X-Kinwall-Source': 'mcp' };
const DUE = "Time for Leo's medicine";
const LATE = `Leo's 8:00 AM${MED_LATE}`;

async function setup(now = at('06:00')) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY } as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}, e: Env = env) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, e, ctx);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles', medications: true });
  const sam = (await req('/api/members', 'POST', { name: 'Sam', color: '#FF8FA3', grownUp: true })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#F5A65B' })).json;
  const key = async (owner?: string) => (await createApiKey(db as never, `k-${owner ?? 'wall'}`, 'display', { owner: owner ?? null })).key;
  const med = (await req('/api/medications', 'POST', { memberId: leo.id, name: NAME, dose: '5 mg', times: ['08:00'] })).json;
  const raw = () => db.prepare("SELECT id, at, title, body, member_ids FROM notifications WHERE kind = 'medication' ORDER BY rowid").all<{ id: string; at: string; title: string; body: string | null; member_ids: string }>().results.map((r) => ({ ...r }));
  const titles = async (k = ADMIN, headers = {}, qs = '') => ((await req(`/api/notifications${qs}`, 'GET', undefined, k, headers)).json as any[]).filter((n) => n.kind === 'medication').map((n) => n.title);
  return { env, db, req, sam, leo, key, med, raw, titles };
}

test('medicine notes: sealed at rest (text and exact time); only kind, day and member stay plain; parents read them as before', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await runNotifications(s.env, at('08:02'));
  await runNotifications(s.env, at('08:31'));
  const rows = s.raw();
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.match(r.title, /^enc:v1:/);
    assert.equal(r.body, null);
    assert.equal(r.at, '2026-09-28T00:00:00.000Z', 'only the day');
    assert.deepEqual(JSON.parse(r.member_ids), [s.leo.id]);
    for (const secret of ['Leo', 'medicine', '8:00', 'marked', NAME, '15:02', '15:31']) assert.ok(!JSON.stringify(r).includes(secret), secret);
  }
  const feed = ((await s.req('/api/notifications')).json as any[]).filter((n) => n.kind === 'medication');
  assert.deepEqual(feed.map((n) => [n.title, n.body, n.at, n.memberIds]), [
    [LATE, null, at('08:31').toISOString(), [s.leo.id]],
    [DUE, null, at('08:02').toISOString(), [s.leo.id]],
  ]);
  // MCP list_notifications re-enters this route, so it reads the same.
});

test("medicine notes: kids' devices and walls still don't get the parent-facing note; connected apps without aiHealthAccess get none", async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await runNotifications(s.env, at('08:02'));
  await runNotifications(s.env, at('08:31'));
  await recordNotification(s.db as never, { kind: 'message', title: 'Dinner at 6', source: 'api', at: at('08:40') });
  assert.deepEqual(await s.titles(), [LATE, DUE], 'parent');
  assert.deepEqual(await s.titles(await s.key(s.leo.id)), [DUE], "Leo's own device");
  assert.deepEqual(await s.titles(await s.key()), [DUE], 'shared wall');
  assert.deepEqual(await s.titles(ADMIN, APP), [], 'connected app');
  // A hidden note doesn't shorten the page: the wall's newest two are the message and the due note.
  const wall = await s.key();
  assert.deepEqual(((await s.req('/api/notifications?limit=2', 'GET', undefined, wall)).json as any[]).map((n) => n.title), ['Dinner at 6', DUE]);
  await s.req('/api/settings', 'PATCH', { aiHealthAccess: true });
  assert.deepEqual(await s.titles(ADMIN, APP), [LATE, DUE], 'connected app with aiHealthAccess');
});

test('medicine notes: a sealed note that will not open fails loudly instead of reading as empty', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await runNotifications(s.env, at('08:02'));
  await runNotifications(s.env, at('08:31'));
  const [a, b] = s.raw();
  s.db.prepare('UPDATE notifications SET title = ? WHERE id = ?').bind(b.title, a.id).run(); // another row's ciphertext
  const saved = console.error;
  console.error = () => {};
  try {
    assert.equal((await s.req('/api/notifications')).status, 500);
  } finally {
    console.error = saved;
  }
});

test('medicine notes: notes saved in plaintext before this are sealed when the server starts, once, safely twice', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  const when = at('08:31').toISOString();
  s.db.prepare("INSERT INTO notifications (id, at, kind, title, body, url, member_ids, source) VALUES ('old', ?, 'medication', ?, NULL, ?, ?, 'system')")
    .bind(when, LATE, `/#/medications/${s.leo.id}`, JSON.stringify([s.leo.id])).run();
  s.db.prepare("INSERT INTO notifications (id, at, kind, title, body, url, member_ids, source) VALUES ('msg', ?, 'message', 'Dinner at 6', NULL, NULL, '[]', 'api')").bind(when).run();
  assert.deepEqual(await s.titles(await s.key()), [], 'before sealing too, a wall never gets the plaintext late note');
  const kinwall = createKinwall(s.env);
  await kinwall.fetch(new Request('http://x/api/rev', { headers: { Authorization: `Bearer ${ADMIN}` } }));
  const [row] = s.raw();
  assert.match(row.title, /^enc:v1:/);
  assert.equal(row.at, '2026-09-28T00:00:00.000Z');
  assert.ok(!JSON.stringify(row).includes('Leo'));
  assert.deepEqual(JSON.parse(await unseal(s.env, row.title, 'old:title')), { title: LATE, body: null, at: when });
  assert.equal((s.db.prepare("SELECT title FROM notifications WHERE id = 'msg'").first() as any).title, 'Dinner at 6', 'other notes untouched');
  assert.equal(await sealMedicationNotes(s.env), 0, 'nothing left; a second run changes nothing');
  assert.deepEqual(s.raw(), [row]);
  const feed = ((await s.req('/api/notifications')).json as any[]).find((n) => n.id === 'old');
  assert.deepEqual([feed.title, feed.at], [LATE, when]);
});

test('medicine notes: without ENCRYPTION_KEY none is written, nothing in plaintext, and the other reminders still go out', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  // A medicine still in plaintext (as before sealing) so the tick reaches the note itself.
  const row = s.db.prepare('SELECT data FROM medications WHERE id = ?').bind(s.med.id).first<{ data: string }>()!;
  s.db.prepare('UPDATE medications SET data = ? WHERE id = ?').bind(await unseal(s.env, row.data, `${s.med.id}:data`), s.med.id).run();
  const cal = (await s.req('/api/calendars', 'POST', { kind: 'local', name: 'Home' })).json;
  await s.req('/api/events', 'POST', { calendarId: cal.id, title: 'Soccer', start: at('08:31').toISOString(), end: at('09:31').toISOString(), allDay: false, reminders: [30] });
  const noKey = { ...s.env, ENCRYPTION_KEY: undefined } as Env;
  await assert.rejects(recordNotification(s.db as never, { kind: 'medication', title: DUE, source: 'system' }, noKey), { name: 'EncryptionKeyMissingError' });
  const lines: string[] = [];
  const saved = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await runNotifications(noKey, at('08:01'));
  } finally {
    console.error = saved;
  }
  assert.deepEqual(s.raw(), [], 'no medicine note');
  assert.deepEqual(s.db.prepare("SELECT title FROM notifications WHERE kind = 'reminder'").all<{ title: string }>().results.map((r) => r.title), ['Soccer']);
  assert.deepEqual(lines, ['medication reminders skipped: EncryptionKeyMissingError']);
});

test('medicine notes: the logs never see their text, through a tick, the feed, a note that will not open and the sweep', async (t) => {
  t.after(() => mock.timers.reset());
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const s = await setup();
    await runNotifications(s.env, at('08:02'));
    await runNotifications(s.env, at('08:31'));
    await s.req('/api/notifications');
    await s.req('/api/notifications', 'GET', undefined, await s.key());
    s.db.prepare("INSERT INTO notifications (id, at, kind, title, member_ids, source) VALUES ('old', ?, 'medication', ?, '[]', 'system')").bind(at('07:31').toISOString(), LATE).run();
    await sealMedicationNotes(s.env);
    const [a, b] = s.raw();
    s.db.prepare('UPDATE notifications SET title = ? WHERE id = ?').bind(b.title, a.id).run();
    assert.equal((await s.req('/api/notifications')).status, 500);
    await runNotifications({ ...s.env, ENCRYPTION_KEY: undefined } as Env, at('08:03'));
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  assert.ok(lines.length > 0, 'the failing request was logged');
  for (const secret of ['Leo', 'medicine', 'marked', NAME, '5 mg']) assert.ok(!lines.join('\n').includes(secret), secret);
});
