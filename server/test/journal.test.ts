// Goal follow-up (an evening "did you finish your goal?" on Temp check) and the personal journal.
// Follow-up answers and journal entries are sensitive, like sleep and feelings (AGENTS.md "Health
// data"): sealed at rest, never logged, never in a webhook, off shared wall screens and other
// members' devices, and kept from connected apps unless the family turned on aiHealthAccess.
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
const NOW = new Date('2026-09-27T05:00:00Z'); // Saturday 2026-09-26, 10 pm in Los Angeles
const TODAY = '2026-09-26';
const SECRET = 'zz-secret-diary-line'; // must never show up raw
const EVENING = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '21:00', journal: true };
const at = (local: string) => new Date(`${TODAY}T${local}:00-07:00`); // a time on TODAY in Los Angeles (PDT)

async function setup(extra: Partial<Env> = {}, now = NOW) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY, ...extra } as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env, ctx);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles' });
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', tempCheck: EVENING })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#5B8DEF' })).json;
  const key = async (owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name: `k-${owner ?? 'wall'}`, scope: 'display' })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const raw = (table: 'temp_checks' | 'journal_entries') => db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>().results;
  const settle = () => Promise.all(pending.splice(0));
  return { env, db, req, maya, leo, key, raw, settle };
}

// A browser's push subscription (a real P-256 key, so the push can be encrypted for it).
async function subscription(name: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', (pair as CryptoKeyPair).publicKey)));
  return { subscription: { endpoint: `https://push.example/${name}`, keys: { p256dh, auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } }, deviceName: name };
}

const tc = (id: string, date?: string) => `/api/members/${id}/temp-check${date ? `?date=${date}` : ''}`;
const jr = (id: string, rest = '') => `/api/members/${id}/journal${rest}`;

test('evening check settings: off by default, 9:00 PM, answers kept in the journal; half-hour times only', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo } = await setup();
  assert.deepEqual(leo.tempCheck, { on: false, sleep: true, feelings: true, goal: true, showGoal: true, evening: false, eveningTime: '21:00', journal: true, battery: false });
  assert.deepEqual(maya.tempCheck, { ...EVENING, battery: false });
  const set = (tempCheck: unknown) => req(`/api/members/${leo.id}`, 'PATCH', { tempCheck });
  assert.equal((await set({ ...EVENING, eveningTime: '22:30', journal: false })).json.tempCheck.eveningTime, '22:30');
  for (const eveningTime of ['22:15', '24:00', '9pm']) assert.equal((await set({ ...EVENING, eveningTime })).status, 400, eveningTime);
});

test('follow-up: open after their time on a day with a goal; yes / partly / no with optional notes, editable today only', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup();
  assert.equal((await req(tc(maya.id))).json.followupOpen, false, 'no goal yet');
  assert.equal((await req(tc(maya.id), 'PUT', { followup: { outcome: 'yes' } })).status, 400, 'no goal to follow up on');
  await req(tc(maya.id), 'PUT', { goal: 'Finish my book report' });
  const open = (await req(tc(maya.id))).json;
  assert.deepEqual([open.followupOpen, open.followup, open.answered.followup], [true, null, false]);

  const saved = await req(tc(maya.id), 'PUT', { followup: { outcome: 'partly', helped: 'Music on', hindered: SECRET, next: '  Start earlier  ' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.followup, { outcome: 'partly', helped: 'Music on', hindered: SECRET, next: 'Start earlier' });
  assert.equal(saved.json.answered.followup, true);
  const edited = (await req(tc(maya.id), 'PUT', { followup: { outcome: 'yes', helped: '', hindered: null } })).json;
  assert.deepEqual(edited.followup, { outcome: 'yes', helped: null, hindered: null, next: null });
  assert.equal((await req(tc(maya.id), 'PUT', { goal: 'Finish my book report', sleep: 'good' })).json.followup.outcome, 'yes', 'other answers leave it be');

  assert.equal((await req(tc(maya.id), 'PUT', { followup: { outcome: 'maybe' } })).status, 400);
  assert.equal((await req(tc(maya.id), 'PUT', { followup: { outcome: 'yes', helped: 'x'.repeat(501) } })).status, 400);
  await req(tc(maya.id, '2026-09-25'), 'PUT', { goal: 'Old goal' });
  assert.equal((await req(tc(maya.id, '2026-09-25'), 'PUT', { followup: { outcome: 'yes' } })).status, 403, 'only until midnight');
  assert.equal((await req(tc(maya.id, '2026-09-25'))).json.followupOpen, false);
});

test('follow-up: not open before their time, with a skipped goal, or with the evening check off', async (t) => {
  t.after(() => mock.timers.reset());
  const early = await setup({}, at('20:30'));
  await early.req(tc(early.maya.id), 'PUT', { goal: 'Tidy my room' });
  assert.equal((await early.req(tc(early.maya.id))).json.followupOpen, false);

  const { req, maya } = await setup();
  await req(tc(maya.id), 'PUT', { goalSkipped: true });
  assert.equal((await req(tc(maya.id))).json.followupOpen, false);
  await req(tc(maya.id), 'PUT', { goal: 'Tidy my room' });
  await req(`/api/members/${maya.id}`, 'PATCH', { tempCheck: { ...EVENING, evening: false } });
  assert.equal((await req(tc(maya.id))).json.followupOpen, false);
  assert.equal((await req(tc(maya.id), 'PUT', { followup: { outcome: 'yes' } })).status, 400, 'evening check is off');
});

test('follow-up: "keep answers in my journal" off keeps the outcome but never the notes', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, raw } = await setup();
  await req(`/api/members/${maya.id}`, 'PATCH', { tempCheck: { ...EVENING, journal: false } });
  await req(tc(maya.id), 'PUT', { goal: 'Practice piano' });
  const saved = (await req(tc(maya.id), 'PUT', { followup: { outcome: 'no', helped: SECRET, next: SECRET } })).json;
  assert.deepEqual(saved.followup, { outcome: 'no', helped: null, hindered: null, next: null });
  assert.equal(JSON.stringify(raw('temp_checks')).includes(SECRET), false);
});

test('evening prompt: once per person per day at their time, to their own devices and the in-app feed', async (t) => {
  t.after(() => mock.timers.reset());
  const { env, req, db, maya, leo, key } = await setup({}, at('18:00'));
  await req(tc(maya.id), 'PUT', { goal: 'Finish my book report' });
  // Push subscriptions: Maya's phone, Leo's tablet, the shared wall, a parent's phone.
  const subscribe = async (k: string, name: string) => assert.equal((await req('/api/push/subscriptions', 'POST', await subscription(name), k)).status, 201);
  await subscribe(await key(maya.id), 'maya-phone');
  await subscribe(await key(leo.id), 'leo-tablet');
  await subscribe(await key(), 'wall');
  await subscribe(ADMIN, 'parent-phone');

  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (u: unknown) => { sent.push(String(u)); return new Response('', { status: 201 }); }) as typeof fetch;
  const feed = () => db.prepare("SELECT title, body, url, member_ids FROM notifications WHERE kind = 'goal'").all<{ title: string; body: string; url: string; member_ids: string }>().results.map((r) => ({ ...r }));
  const tick = async (local: string) => { sent.length = 0; await runNotifications(env, at(local)); return [...sent]; };
  try {
    assert.deepEqual(await tick('20:55'), [], 'not yet');
    assert.deepEqual(await tick('21:02'), ['https://push.example/maya-phone']);
    assert.deepEqual(feed(), [{ title: 'Did you finish your goal? 🎯', body: 'Finish my book report', url: `/#/journal/${maya.id}`, member_ids: JSON.stringify([maya.id]) }]);
    assert.deepEqual(await tick('21:05'), [], 'once');
    await db.prepare("DELETE FROM settings WHERE key = 'notifyLastTick'").run(); // a restart: the window starts over
    assert.deepEqual(await tick('21:06'), [], 'still once');
    assert.equal(feed().length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('evening prompt: still pushed during quiet hours', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup({}, at('18:00'));
  assert.equal((await s.req('/api/push/subscriptions', 'POST', await subscription('maya-phone'), await s.key(s.maya.id))).status, 201);
  await s.req(tc(s.maya.id), 'PUT', { goal: 'Read' });
  await s.req('/api/settings', 'PATCH', { quietFrom: '20:00', quietTo: '07:00' });
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (u: unknown) => { sent.push(String(u)); return new Response('', { status: 201 }); }) as typeof fetch;
  try { await runNotifications(s.env, at('21:02')); } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(sent, ['https://push.example/maya-phone']);
});

test('evening prompt: nothing when the goal was skipped or answered, the setting is off', async (t) => {
  t.after(() => mock.timers.reset());
  const cases: [string, (s: Awaited<ReturnType<typeof setup>>) => Promise<unknown>, number][] = [
    ['skipped', (s) => s.req(tc(s.maya.id), 'PUT', { goalSkipped: true }), 0],
    ['answered', async (s) => { await s.req(tc(s.maya.id), 'PUT', { goal: 'Read' }); mock.timers.setTime(at('21:01').getTime()); await s.req(tc(s.maya.id), 'PUT', { followup: { outcome: 'yes' } }); }, 0], // before the tick got to it
    ['off', async (s) => { await s.req(tc(s.maya.id), 'PUT', { goal: 'Read' }); await s.req(`/api/members/${s.maya.id}`, 'PATCH', { tempCheck: { ...EVENING, evening: false } }); }, 0],
    ['goal question off', async (s) => { await s.req(tc(s.maya.id), 'PUT', { goal: 'Read' }); await s.req(`/api/members/${s.maya.id}`, 'PATCH', { tempCheck: { ...EVENING, goal: false } }); }, 0],
  ];
  for (const [name, arrange, feedRows] of cases) {
    const s = await setup({}, at('18:00'));
    assert.equal((await s.req('/api/push/subscriptions', 'POST', await subscription('maya-phone'), await s.key(s.maya.id))).status, 201);
    await arrange(s);
    const realFetch = globalThis.fetch;
    const sent: string[] = [];
    globalThis.fetch = (async (u: unknown) => { sent.push(String(u)); return new Response('', { status: 201 }); }) as typeof fetch;
    try { await runNotifications(s.env, at('21:02')); } finally { globalThis.fetch = realFetch; }
    assert.deepEqual(sent, [], `${name}: no push`);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'goal'").first<{ n: number }>()!.n, feedRows, `${name}: feed`);
  }
});

test('journal: days with their temp check and follow-up, plus their own entries, newest first; add, edit, delete', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo } = await setup();
  await req(tc(maya.id, '2026-09-24'), 'PUT', { sleep: 'great', feelings: ['good'], goal: 'Walk the dog' });
  await req(tc(maya.id), 'PUT', { sleep: 'ok', goal: 'Finish my book report' });
  await req(tc(maya.id), 'PUT', { followup: { outcome: 'yes', helped: 'Mom quizzed me' } });

  const add = await req(jr(maya.id), 'POST', { date: '2026-09-25', text: '  We saw a double rainbow!  ', mood: '🌈' });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.deepEqual([add.json.date, add.json.text, add.json.mood, add.json.memberId], ['2026-09-25', 'We saw a double rainbow!', '🌈', maya.id]);
  const second = (await req(jr(maya.id), 'POST', { text: 'Pizza night' })).json;
  assert.deepEqual([second.date, second.mood], [TODAY, null], 'today by default');

  const j = (await req(jr(maya.id))).json;
  assert.deepEqual([j.memberId, j.to], [maya.id, TODAY]);
  assert.deepEqual(j.days.map((d: any) => d.date), [TODAY, '2026-09-25', '2026-09-24']);
  assert.deepEqual(j.days[0].tempCheck, { sleep: 'ok', feelings: null, goal: 'Finish my book report', goalSkipped: false, followup: { outcome: 'yes', helped: 'Mom quizzed me', hindered: null, next: null } });
  assert.deepEqual(j.days[0].entries.map((e: any) => e.text), ['Pizza night']);
  assert.equal(j.days[1].tempCheck, null);
  assert.equal(j.days[2].tempCheck.sleep, 'great');
  assert.equal((await req(jr(maya.id, '?to=2026-09-25&days=1'))).json.days.length, 1);

  const edited = await req(jr(maya.id, `/${add.json.id}`), 'PATCH', { text: 'A double rainbow over the park', mood: null });
  assert.deepEqual([edited.status, edited.json.text, edited.json.mood], [200, 'A double rainbow over the park', null]);
  assert.equal((await req(jr(leo.id, `/${add.json.id}`), 'PATCH', { text: 'x' })).status, 404, 'not under someone else');
  assert.equal((await req(jr(maya.id), 'POST', { text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await req(jr(maya.id), 'POST', { text: '   ' })).status, 400);
  assert.equal((await req(jr(maya.id), 'POST', { text: 'hi', date: 'someday' })).status, 400);
  assert.equal((await req(jr(maya.id, `/${add.json.id}`), 'DELETE')).status, 204);
  assert.equal((await req(jr(maya.id, `/${add.json.id}`), 'DELETE')).status, 404);
  assert.equal((await req(jr('ghost'))).status, 404);
});

test('journal visibility: their own device and parents; never a shared wall, another member or a connected app (unless aiHealthAccess)', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo, key } = await setup();
  await req(tc(maya.id), 'PUT', { goal: 'Finish my book report' });
  const entry = (await req(jr(maya.id), 'POST', { text: SECRET })).json;
  const wall = await key();
  const mayas = await key(maya.id);
  const leos = await key(leo.id);
  const app = { 'X-Kinwall-Source': 'mcp' };

  assert.equal((await req(jr(maya.id), 'GET', undefined, mayas)).json.days[0].entries[0].text, SECRET);
  assert.equal((await req(jr(maya.id), 'POST', { text: 'From my phone' }, mayas)).status, 201);
  assert.equal((await req(jr(maya.id, `/${entry.id}`), 'PATCH', { text: 'Edited on my phone' }, mayas)).status, 200);
  for (const [who, k, h] of [['wall', wall, {}], ["Leo's device", leos, {}], ['connected app', ADMIN, app]] as const) {
    assert.equal((await req(jr(maya.id), 'GET', undefined, k, h)).status, 403, `${who}: read`);
    assert.equal((await req(jr(maya.id), 'POST', { text: 'x' }, k, h)).status, 403, `${who}: add`);
    assert.equal((await req(jr(maya.id, `/${entry.id}`), 'PATCH', { text: 'x' }, k, h)).status, 403, `${who}: edit`);
    assert.equal((await req(jr(maya.id, `/${entry.id}`), 'DELETE', undefined, k, h)).status, 403, `${who}: delete`);
  }
  assert.equal((await req(jr(leo.id), 'GET', undefined, leos)).status, 200, 'Leo reads his own');

  // Follow-up on Temp check: a wall can answer today but sees only that it's answered; Leo's device can't.
  const answered = await req(tc(maya.id), 'PUT', { followup: { outcome: 'partly', next: SECRET } }, wall);
  assert.deepEqual([answered.status, answered.json.followup, answered.json.answered.followup, answered.json.followupOpen], [200, null, true, true]);
  assert.equal((await req(tc(maya.id), 'GET', undefined, leos)).json.followup, null);
  assert.equal((await req(tc(maya.id), 'PUT', { followup: { outcome: 'yes' } }, leos)).status, 403);
  assert.equal((await req(tc(maya.id), 'GET', undefined, ADMIN, app)).json.followup, null);
  assert.equal((await req(tc(maya.id), 'PUT', { followup: { outcome: 'yes' } }, ADMIN, app)).status, 403);
  assert.equal((await req(tc(maya.id), 'GET', undefined, mayas)).json.followup.next, SECRET);
  assert.equal((await req(tc(maya.id))).json.followup.outcome, 'partly', 'parents see it');

  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  assert.equal((await req(jr(maya.id), 'GET', undefined, ADMIN, app)).status, 200);
  assert.equal((await req(tc(maya.id), 'GET', undefined, ADMIN, app)).json.followup.outcome, 'partly');
});

test('journal and follow-up are sealed at rest; without ENCRYPTION_KEY nothing is stored', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, raw } = await setup();
  await req(tc(maya.id), 'PUT', { goal: 'Practice piano' });
  await req(tc(maya.id), 'PUT', { followup: { outcome: 'partly', helped: SECRET } });
  await req(jr(maya.id), 'POST', { text: SECRET, mood: '🤫' });
  const [row] = raw('temp_checks');
  assert.match(String(row.followup), /^enc:v1:/);
  const [entry] = raw('journal_entries');
  assert.match(String(entry.text), /^enc:v1:/);
  assert.match(String(entry.mood), /^enc:v1:/);
  for (const s of [SECRET, 'partly', '🤫']) assert.equal(JSON.stringify([row, entry]).replace(/enc:v1:[^"\\]+/g, '').includes(s), false, s);

  const noKey = await setup({ ENCRYPTION_KEY: undefined });
  await noKey.req(tc(noKey.maya.id), 'PUT', { goal: 'Practice piano' });
  assert.equal((await noKey.req(tc(noKey.maya.id), 'PUT', { followup: { outcome: 'yes' } })).status, 500);
  assert.equal(noKey.raw('temp_checks')[0].followup, null);
  assert.equal((await noKey.req(jr(noKey.maya.id), 'POST', { text: SECRET })).status, 500);
  assert.deepEqual(noKey.raw('journal_entries'), []);
});

test('journal: webhooks say who and which day, and the logs never see the words', async (t) => {
  t.after(() => mock.timers.reset());
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_u: unknown, init: RequestInit = {}) => { sent.push(String(init.body)); return new Response('ok'); }) as typeof fetch;
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  let entryId = '';
  let mayaId = '';
  try {
    const { req, maya, settle } = await setup();
    mayaId = maya.id;
    assert.equal((await req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
    await req(tc(maya.id), 'PUT', { goal: 'Practice piano' });
    await req(tc(maya.id), 'PUT', { followup: { outcome: 'no', hindered: SECRET } });
    entryId = (await req(jr(maya.id), 'POST', { text: SECRET, date: '2026-09-25' })).json.id;
    await req(jr(maya.id, `/${entryId}`), 'PATCH', { text: `${SECRET} again` });
    await req(jr(maya.id), 'POST', { text: SECRET.repeat(200) }); // 400
    await req(tc(maya.id), 'PUT', { followup: { outcome: SECRET } }); // 400
    const noKey = await setup({ ENCRYPTION_KEY: undefined });
    await noKey.req(jr(noKey.maya.id), 'POST', { text: SECRET }); // 500
    await settle();
  } finally {
    globalThis.fetch = realFetch;
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  const hooks = sent.filter((b) => b.includes('journal.changed')).map((b) => JSON.parse(b).data);
  assert.deepEqual(hooks, [{ memberId: mayaId, date: '2026-09-25', id: entryId }, { memberId: mayaId, date: '2026-09-25', id: entryId }]);
  assert.ok(lines.length > 0, 'the failing request was logged');
  for (const s of [SECRET]) {
    assert.equal(sent.join('\n').includes(s), false, `webhook: ${s}`);
    assert.equal(lines.join('\n').includes(s), false, `logs: ${s}`);
  }
});

test('journal: export has entries and follow-ups in plain form; import seals them again', async (t) => {
  t.after(() => mock.timers.reset());
  const source = await setup();
  const id = source.maya.id;
  await source.req(tc(id), 'PUT', { goal: 'Practice piano' });
  await source.req(tc(id), 'PUT', { followup: { outcome: 'partly', helped: SECRET } });
  await source.req(jr(id), 'POST', { text: SECRET, mood: '🌈', date: '2026-09-25' });
  const file = (await source.req('/api/export')).json;
  assert.deepEqual(file.tempChecks[0].followup, { outcome: 'partly', helped: SECRET, hindered: null, next: null });
  assert.deepEqual(file.journalEntries.map((e: any) => [e.memberId, e.date, e.text, e.mood]), [[id, '2026-09-25', SECRET, '🌈']]);
  const hidden = (await source.req('/api/export', 'GET', undefined, ADMIN, { 'X-Kinwall-Source': 'mcp' })).json;
  assert.equal(JSON.stringify(hidden).includes(SECRET), false, 'a connected app without aiHealthAccess gets neither');

  const target = await setup();
  const res = await target.req('/api/import', 'POST', file);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.imported.journalEntries, 1);
  assert.match(String(target.raw('journal_entries')[0].text), /^enc:v1:/);
  assert.match(String(target.raw('temp_checks')[0].followup), /^enc:v1:/);
  assert.equal(JSON.stringify([target.raw('journal_entries'), target.raw('temp_checks')]).includes(SECRET), false);
  const back = (await target.req(jr(id))).json;
  assert.deepEqual(back.days.map((d: any) => [d.date, d.tempCheck?.followup?.helped ?? null, d.entries.map((e: any) => e.text)]), [[TODAY, SECRET, []], ['2026-09-25', null, [SECRET]]]);
  assert.equal((await target.req('/api/import', 'POST', file)).status, 200); // again: no duplicates
  assert.equal(target.raw('journal_entries').length, 1);
});
