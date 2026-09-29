// Temp check: a person's daily questions at the end of their day (sleep, feelings, a goal). Sleep and
// feelings are health data (AGENTS.md "Health data"): sealed at rest, never logged, never in a
// webhook, withheld from shared wall screens after answering and from connected apps unless the
// family turned on aiHealthAccess. The goal is family content.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const NOW = new Date('2026-09-27T05:00:00Z'); // Saturday 2026-09-26, 10 pm in Los Angeles
const TODAY = '2026-09-26';
const SECRET = 'zz-secret-tummy-ache'; // a custom feeling that must never show up raw

async function setup(extra: Partial<Env> = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY, ...extra } as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env, ctx);
    return { status: res.status, json: (await res.json()) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles' });
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', tempCheck: { on: true, sleep: true, feelings: true, goal: true, showGoal: true } })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#5B8DEF' })).json;
  const key = async (owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name: `k-${owner ?? 'wall'}`, scope: 'display' })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const raw = () => db.prepare('SELECT * FROM temp_checks').all<Record<string, unknown>>().results;
  const rawMember = (id: string) => db.prepare('SELECT temp_check, temp_check_feelings FROM members WHERE id = ?').bind(id).first<{ temp_check: string | null; temp_check_feelings: string | null }>()!;
  const settle = () => Promise.all(pending.splice(0));
  return { env, db, req, maya, leo, key, raw, rawMember, settle };
}

const url = (id: string, date?: string) => `/api/members/${id}/temp-check${date ? `?date=${date}` : ''}`;

test('temp check: off by default; settings live on the member', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo } = await setup();
  assert.deepEqual(leo.tempCheck, { on: false, sleep: true, feelings: true, goal: true, showGoal: true, evening: false, eveningTime: '21:00', journal: true, battery: false });
  assert.equal(maya.tempCheck.on, true);
  assert.equal((await req(url(leo.id), 'PUT', { sleep: 'good' })).status, 400); // off for Leo
  const patched = (await req(`/api/members/${leo.id}`, 'PATCH', { tempCheck: { on: true, sleep: false, feelings: true, goal: true, showGoal: false } })).json;
  assert.deepEqual(patched.tempCheck, { on: true, sleep: false, feelings: true, goal: true, showGoal: false, evening: false, eveningTime: '21:00', journal: true, battery: false });
  const got = (await req(url(leo.id))).json;
  assert.deepEqual([got.date, got.sleep, got.feelings, got.goal, got.goalSkipped, got.custom], [TODAY, null, null, null, false, []]);
  assert.deepEqual(got.answered, { sleep: false, feelings: false, goal: false, followup: false, drained: false });
});

test('temp check: one row per member per day, updated in place; custom feelings join their options', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, raw } = await setup();
  const a = await req(url(maya.id), 'PUT', { sleep: 'great' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.deepEqual([a.json.date, a.json.sleep, a.json.private], [TODAY, 'great', false]);
  const b = (await req(url(maya.id), 'PUT', { feelings: ['good', 'tired', SECRET] })).json;
  assert.deepEqual([b.sleep, b.feelings, b.custom], ['great', ['good', 'tired', SECRET], [SECRET]]);
  const c = (await req(url(maya.id), 'PUT', { sleep: 'ok', goalSkipped: true })).json;
  assert.deepEqual([c.sleep, c.goal, c.goalSkipped, c.answered], ['ok', null, true, { sleep: true, feelings: true, goal: true, followup: false, drained: false }]);
  const d = (await req(url(maya.id), 'PUT', { goal: '  Finish my book report  ' })).json;
  assert.deepEqual([d.goal, d.goalSkipped], ['Finish my book report', false]);
  assert.equal(raw().length, 1);
  // Same custom feeling again (any case): not added twice. Removing it from the options keeps today's answer.
  assert.deepEqual((await req(url(maya.id), 'PUT', { feelings: [SECRET.toUpperCase()] })).json.custom, [SECRET]);
  assert.deepEqual((await req(url(maya.id), 'PUT', { custom: [] })).json.custom, []);
  assert.equal((await req(url(maya.id), 'PUT', { goal: 'x'.repeat(141) })).status, 400);
  assert.equal((await req(url(maya.id), 'PUT', { sleep: 'meh' })).status, 400);
  // Another day is another row; a day with no answers reads empty.
  assert.equal((await req(url(maya.id, '2026-09-25'))).json.sleep, null);
  assert.equal((await req(url(maya.id, 'yesterday'))).status, 400);
  assert.equal((await req(url('ghost'))).status, 404);
});

test('temp check: sleep, feelings and custom feelings are sealed at rest; the goal is not', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, raw, rawMember } = await setup();
  await req(url(maya.id), 'PUT', { sleep: 'terrible', feelings: ['sore', SECRET], goal: 'Practice piano' });
  const [row] = raw();
  assert.match(String(row.sleep), /^enc:v1:/);
  assert.match(String(row.feelings), /^enc:v1:/);
  assert.equal(row.goal, 'Practice piano');
  const m = rawMember(maya.id);
  assert.match(m.temp_check_feelings!, /^enc:v1:/);
  // Ciphertext is random base64, so a short word like 'sore' can turn up inside it by chance: look only outside it.
  for (const s of ['terrible', 'sore', SECRET]) assert.equal(JSON.stringify([row, m]).replace(/enc:v1:[^"\\]+/g, '').includes(s), false, s);
  assert.deepEqual((await req(url(maya.id))).json.feelings, ['sore', SECRET]);
});

test('temp check: without ENCRYPTION_KEY, health answers fail closed and nothing is stored', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, raw } = await setup({ ENCRYPTION_KEY: undefined });
  assert.equal((await req(url(maya.id), 'PUT', { sleep: 'good' })).status, 500);
  assert.equal((await req(url(maya.id), 'PUT', { feelings: [SECRET] })).status, 500);
  assert.deepEqual(raw(), []);
});

test("temp check: a shared wall answers but only sees flags; a person's own device sees their own; parents see all", async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo, key } = await setup();
  await req(`/api/members/${leo.id}`, 'PATCH', { tempCheck: { on: true, sleep: true, feelings: true, goal: true, showGoal: true } });
  const wall = await key();
  const mayas = await key(maya.id);
  const leos = await key(leo.id);

  const fresh = (await req(url(maya.id), 'GET', undefined, wall)).json;
  assert.deepEqual([fresh.private, fresh.custom], [true, []]);
  const answered = await req(url(maya.id), 'PUT', { sleep: 'good', feelings: ['happy-ish'], goal: 'Read 20 pages' }, wall);
  assert.equal(answered.status, 200);
  const w = (await req(url(maya.id), 'GET', undefined, wall)).json;
  assert.deepEqual([w.private, w.sleep, w.feelings, w.goal, w.answered], [true, null, null, 'Read 20 pages', { sleep: true, feelings: true, goal: true, followup: false, drained: false }]);
  assert.deepEqual(w.custom, ['happy-ish'], 'the wall still offers their options, so they can change an answer');
  assert.equal(answered.json.sleep, null, 'not even in the reply');
  assert.equal((await req(url(maya.id), 'PUT', { custom: [] }, wall)).status, 403, 'removing options is for their own or a parent device');
  assert.equal((await req(url(maya.id, '2026-09-25'), 'PUT', { sleep: 'ok' }, wall)).status, 403, 'a display changes today only');

  const own = (await req(url(maya.id), 'GET', undefined, mayas)).json;
  assert.deepEqual([own.private, own.sleep, own.feelings], [false, 'good', ['happy-ish']]);
  const other = await req(url(maya.id), 'GET', undefined, leos);
  assert.deepEqual([other.status, other.json.private, other.json.sleep, other.json.custom], [200, true, null, null]);
  assert.equal((await req(url(maya.id), 'PUT', { sleep: 'ok' }, leos)).status, 403);
  assert.equal((await req(url(leo.id), 'PUT', { sleep: 'ok' }, leos)).status, 200);

  const parent = (await req(url(maya.id))).json;
  assert.deepEqual([parent.private, parent.sleep], [false, 'good']);
});

test('temp check: connected apps get the goal, never sleep or feelings, unless the family turned on aiHealthAccess', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup();
  const app = { 'X-Kinwall-Source': 'mcp' };
  await req(url(maya.id), 'PUT', { sleep: 'poorly', feelings: [SECRET], goal: 'Tidy my room' });
  const hidden = (await req(url(maya.id), 'GET', undefined, ADMIN, app)).json;
  assert.deepEqual([hidden.private, hidden.sleep, hidden.feelings, hidden.custom, hidden.goal], [true, null, null, null, 'Tidy my room']);
  assert.equal((await req(url(maya.id), 'PUT', { sleep: 'good' }, ADMIN, app)).status, 403);
  assert.equal((await req(url(maya.id), 'PUT', { goal: 'Walk the dog' }, ADMIN, app)).status, 200);
  const exported = (await req('/api/export', 'GET', undefined, ADMIN, app)).json;
  assert.equal(JSON.stringify(exported).includes(SECRET), false);
  assert.equal(JSON.stringify(exported).includes('poorly'), false);

  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  const shown = (await req(url(maya.id), 'GET', undefined, ADMIN, app)).json;
  assert.deepEqual([shown.private, shown.sleep, shown.feelings, shown.goal], [false, 'poorly', [SECRET], 'Walk the dog']);
});

test("temp check: today's goal rides on the member for the Board and calendar", async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup();
  assert.equal((await req('/api/members')).json.find((m: any) => m.id === maya.id).todayGoal, null);
  await req(url(maya.id), 'PUT', { goal: 'Finish my book report' });
  await req(url(maya.id, '2026-09-25'), 'PUT', { goal: 'Old goal' });
  assert.equal((await req('/api/members')).json.find((m: any) => m.id === maya.id).todayGoal, 'Finish my book report');
  await req(url(maya.id), 'PUT', { goalSkipped: true });
  assert.equal((await req('/api/members')).json.find((m: any) => m.id === maya.id).todayGoal, null);
  await req(url(maya.id), 'PUT', { goal: 'Finish my book report' });
  await req(`/api/members/${maya.id}`, 'PATCH', { tempCheck: { on: true, sleep: true, feelings: true, goal: false, showGoal: true } });
  assert.equal((await req('/api/members')).json.find((m: any) => m.id === maya.id).todayGoal, null, 'goal question off: no goal');
});

test('temp check: webhooks and the logs never see sleep, feelings or custom feelings', async (t) => {
  t.after(() => mock.timers.reset());
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_u: unknown, init: RequestInit = {}) => { sent.push(String(init.body)); return new Response('ok'); }) as typeof fetch;
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const { req, maya, settle } = await setup();
    assert.equal((await req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
    await req(url(maya.id), 'PUT', { sleep: 'terrible', feelings: [SECRET] });
    await req(url(maya.id), 'PUT', { feelings: [SECRET, 'x'.repeat(100)] }); // 400
    await req(url(maya.id), 'PUT', { sleep: SECRET }); // 400
    const noKey = await setup({ ENCRYPTION_KEY: undefined });
    await noKey.req(url(noKey.maya.id), 'PUT', { sleep: 'terrible', feelings: [SECRET] }); // 500
    await settle();
    const hooks = sent.filter((b) => b.includes('tempcheck.changed'));
    assert.equal(hooks.length, 1);
    assert.deepEqual(JSON.parse(hooks[0]).data, { memberId: maya.id, date: TODAY });
    assert.ok(lines.length > 0, 'the failing request was logged');
  } finally {
    globalThis.fetch = realFetch;
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  for (const s of [SECRET, 'terrible']) {
    assert.equal(sent.join('\n').includes(s), false, `webhook: ${s}`);
    assert.equal(lines.join('\n').includes(s), false, `logs: ${s}`);
  }
});

test('temp check: export has the answers in plaintext; import seals them again', async (t) => {
  t.after(() => mock.timers.reset());
  const source = await setup();
  await source.req(url(source.maya.id), 'PUT', { sleep: 'good', feelings: ['fine', SECRET], goal: 'Practice piano' });
  const file = (await source.req('/api/export')).json;
  const m = file.members.find((x: any) => x.id === source.maya.id);
  assert.deepEqual([m.tempCheck.on, m.tempCheckFeelings], [true, [SECRET]]);
  assert.deepEqual(file.tempChecks.map((r: any) => [r.memberId, r.date, r.sleep, r.feelings, r.goal, r.goalSkipped]), [[source.maya.id, TODAY, 'good', ['fine', SECRET], 'Practice piano', false]]);

  const target = await setup();
  const res = await target.req('/api/import', 'POST', file);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.imported.tempChecks, 1);
  const [row] = target.raw();
  assert.match(String(row.sleep), /^enc:v1:/);
  assert.match(target.rawMember(source.maya.id).temp_check_feelings!, /^enc:v1:/);
  assert.equal(JSON.stringify(target.raw()).includes(SECRET), false);
  const back = (await target.req(url(source.maya.id))).json;
  assert.deepEqual([back.sleep, back.feelings, back.goal, back.custom], ['good', ['fine', SECRET], 'Practice piano', [SECRET]]);
  assert.equal((await target.req('/api/import', 'POST', file)).status, 200); // again: still one row
  assert.equal(target.raw().length, 1);

  // Without a key the import is refused before anything is written.
  const c = await setup({ ENCRYPTION_KEY: undefined });
  assert.equal((await c.req('/api/import', 'POST', file)).status, 500);
  assert.deepEqual(c.raw(), []);
});
