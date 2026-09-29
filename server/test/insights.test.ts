// Insights from check-ins (routes/insights.ts, insights.ts): patterns in a person's Temp check,
// goal checks and journal moods, next to chores, activity time, books and calendar busyness.
// Built on health data (AGENTS.md "Health data"): computed on request, nothing stored, never logged,
// only on the person's own device and parents' devices, and off for connected apps unless the
// family turned on aiHealthAccess. Journal text is never read.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { analyze, type InsightDay } from '../src/insights.ts';
import { sealTempCheck } from '../src/routes/temp-check.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const NOW = new Date('2026-09-27T05:00:00Z'); // Saturday 2026-09-26, 10 pm in Los Angeles (already the 27th in UTC)
const TODAY = '2026-09-26';
const SECRET = 'zz-secret-diary-line';
const TC = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '21:00', journal: true };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------- The analysis (pure) ----------

const blank = (date: string): InsightDay => ({
  date, checkedIn: false, sleep: null, feelings: [], goalSet: false, goalOutcome: null, journalEntries: 0, journalMoods: [],
  chores: 0, points: 0, activityMinutes: 0, booksFinished: 0, events: 0, lastEventEnd: null,
});
/** Consecutive days from 2026-08-01, each shaped by `f`, checked in unless it says otherwise. */
const series = (parts: Partial<InsightDay>[]) => parts.map((p, i) => ({ ...blank(addDays('2026-08-01', i)), checkedIn: true, ...p }));
const rep = (n: number, v: Partial<InsightDay>): Partial<InsightDay>[] => Array.from({ length: n }, () => v);
/** Sleep vs goal met: `a` good-sleep days (aHit met), `b` other days (bHit met), padded with plain check-ins to `total`. */
function sleepGoal(a: number, aHit: number, b: number, bHit: number, total = 21) {
  const days: Partial<InsightDay>[] = [
    ...rep(aHit, { sleep: 'good', goalSet: true, goalOutcome: 'yes' }), ...rep(a - aHit, { sleep: 'great', goalSet: true, goalOutcome: 'no' }),
    ...rep(bHit, { sleep: 'ok', goalSet: true, goalOutcome: 'yes' }), ...rep(b - bHit, { sleep: 'poorly', goalSet: true, goalOutcome: 'partly' }),
  ];
  return series([...days, ...rep(Math.max(0, total - days.length), { feelings: ['fine'] })]);
}
const ids = (days: InsightDay[]) => analyze(days).connections.list.map((c) => c.id);

test('connections: none under 21 days with check-ins, however strong the pattern', () => {
  const early = analyze(sleepGoal(9, 9, 8, 0, 20));
  assert.deepEqual([early.connections.ready, early.connections.daysWithCheckIns, early.connections.needed, early.connections.list], [false, 20, 21, []]);
  // Days without a check-in don't count toward the 21.
  assert.equal(analyze([...sleepGoal(9, 9, 8, 0, 20), { ...blank('2026-09-01'), chores: 3 }]).connections.ready, false);
  const ready = analyze(sleepGoal(9, 9, 8, 0, 21));
  assert.deepEqual([ready.connections.ready, ready.connections.daysWithCheckIns], [true, 21]);
  assert.deepEqual(ids(sleepGoal(9, 9, 8, 0, 21)), ['sleep-goal']);
});

test('connections: each side needs at least 5 days', () => {
  assert.deepEqual(ids(sleepGoal(4, 4, 12, 0)), [], '4 good-sleep days');
  assert.deepEqual(ids(sleepGoal(5, 5, 12, 0)), ['sleep-goal']);
  assert.deepEqual(ids(sleepGoal(12, 12, 4, 0)), [], '4 other days');
});

test('connections: the rates must differ by at least 20 points', () => {
  assert.deepEqual(ids(sleepGoal(5, 4, 21, 13, 30)), [], '80% vs 62%: 18 points');
  assert.deepEqual(ids(sleepGoal(5, 4, 10, 6)), ['sleep-goal'], '80% vs 60%: 20 points');
  assert.deepEqual(ids(sleepGoal(5, 1, 10, 6)), ['sleep-goal'], 'either direction: 20% vs 60%');
});

test('connections: plain, never causal wording with the counts, and an honest confidence label', () => {
  const [c] = analyze(sleepGoal(9, 7, 8, 2)).connections.list;
  assert.equal(c.text, 'Goals were met more often after good sleep (7 of 9 vs 2 of 8)');
  assert.deepEqual([c.a, c.b, c.confidence], [{ hit: 7, n: 9 }, { hit: 2, n: 8 }, 'early']);
  assert.ok(c.detail.length > 0);
  const [less] = analyze(sleepGoal(9, 2, 8, 7)).connections.list;
  assert.equal(less.text, 'Goals were met less often after good sleep (2 of 9 vs 7 of 8)');
  // Clear: at least 10 days a side and 30 points apart.
  assert.equal(analyze(sleepGoal(10, 9, 10, 3)).connections.list[0].confidence, 'clear');
  assert.equal(analyze(sleepGoal(10, 9, 10, 7)).connections.list[0].confidence, 'early', '20 points: still early');
  assert.equal(analyze(sleepGoal(9, 9, 12, 0)).connections.list[0].confidence, 'early', '9 days a side: still early');
});

test('connections: late events, busy days and chores', () => {
  // Every third evening ends late (after 8 PM); the next day they feel tired and sleep less well.
  const late = series(Array.from({ length: 24 }, (_, i) => (i % 3 === 0
    ? { lastEventEnd: '21:30', events: 1, sleep: 'ok', feelings: ['fine'] }
    : i % 3 === 1 ? { sleep: 'poorly', feelings: ['tired'] } : { sleep: 'great', feelings: ['good'] })));
  const found = analyze(late).connections.list;
  assert.deepEqual(found.map((c) => c.id), ['late-sleep', 'late-tired']);
  assert.equal(found[0].text, 'Slept well less often after a late event (0 of 8 vs 8 of 15)');
  assert.equal(found[1].text, 'Felt tired more often the day after a late event (8 of 8 vs 0 of 15)');
  // 8 PM exactly isn't late.
  assert.deepEqual(ids(late.map((d) => (d.lastEventEnd ? { ...d, lastEventEnd: '20:00' } : d))), []);

  const busy = series([
    ...rep(6, { events: 3, goalSet: true, goalOutcome: 'no' }), ...rep(15, { events: 1, goalSet: true, goalOutcome: 'yes' }),
  ]);
  const [b] = analyze(busy).connections.list;
  assert.equal(b.text, 'Goals were met less often on busy days, with 3 or more events (0 of 6 vs 15 of 15)');

  const chores = series([...rep(10, { chores: 2, feelings: ['great'] }), ...rep(11, { feelings: ['tired', 'ok'] })]);
  assert.equal(analyze(chores).connections.list[0].text, 'Felt great or good more often on days with chores done (10 of 10 vs 0 of 11)');
});

test('summary: plain sentences for the range, only for what has data', () => {
  const days = series([
    { sleep: 'great', feelings: ['good', 'excited'], goalSet: true, goalOutcome: 'yes', chores: 2, points: 10, activityMinutes: 30, journalEntries: 1, journalMoods: ['🌈'], events: 3 },
    { sleep: 'good', feelings: ['good'], goalSet: true, goalOutcome: 'partly', chores: 1, points: 5, activityMinutes: 50, booksFinished: 1, events: 1 },
    { sleep: 'poorly', feelings: ['tired', 'good'], goalSet: true, goalOutcome: 'no' },
    { sleep: 'ok', goalSet: true },
    { checkedIn: false },
  ]);
  const a = analyze(days);
  assert.deepEqual(a.summary.map((s) => s.text), [
    'Checked in on 4 of 5 days',
    'Slept well or great on 2 of 4 nights',
    'Met 1 of 4 goals, and partly met 1 more',
    'Did 3 chores for 15 points',
    'Spent 1 h 20 min on activities',
    'Finished 1 book',
    '3 or more events on 1 day (busiest: 3)',
    'Wrote 1 journal entry',
  ]);
  assert.deepEqual(a.topFeelings, [{ feeling: 'good', days: 3 }, { feeling: 'excited', days: 1 }, { feeling: 'tired', days: 1 }]);
  assert.deepEqual(analyze(series([{ checkedIn: false }])).summary.map((s) => s.text), ['Checked in on 0 of 1 day']);
  assert.deepEqual(analyze(series([{ events: 2 }, { events: 1 }])).summary.map((s) => s.text).at(-1), 'Busiest day had 2 events', 'no busy days yet');
});

// ---------- The endpoint ----------

async function setup(extra: Partial<Env> = {}, now = NOW) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY, ...extra } as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env, ctx);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles' });
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', tempCheck: TC })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#5B8DEF' })).json;
  const key = async (owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name: `k-${owner ?? 'wall'}`, scope: 'display' })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  /** A stored Temp check row for any day (the API only takes goal checks for today). */
  const check = async (memberId: string, date: string, v: { sleep?: string; feelings?: string[]; goal?: string; outcome?: 'yes' | 'partly' | 'no'; note?: string }) => {
    const s = await sealTempCheck(env, memberId, date, {
      sleep: v.sleep ?? null, feelings: v.feelings ?? null,
      followup: v.outcome ? { outcome: v.outcome, helped: v.note ?? null, hindered: null, next: null } : null,
    });
    await db.prepare('INSERT INTO temp_checks (member_id, date, sleep, feelings, goal, goal_skipped, followup, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?,?)')
      .bind(memberId, date, s.sleep, s.feelings, v.goal ?? null, s.followup, NOW.toISOString(), NOW.toISOString()).run();
  };
  const dump = () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>().results.map((r) => r.name);
    return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}"`).all().results]));
  };
  return { env, db, req, maya, leo, key, check, dump };
}

const ins = (id: string, range?: string) => `/api/members/${id}/insights${range ? `?range=${range}` : ''}`;

test('insights: the per-day series for the range, ending today in the household timezone', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, db, maya, leo, check } = await setup();
  await check(maya.id, TODAY, { sleep: 'great', feelings: ['good', 'excited'], goal: 'Read', outcome: 'yes' });
  await check(maya.id, '2026-08-30', { sleep: 'ok' }); // the 4-week range's first day
  await check(maya.id, '2026-08-29', { sleep: 'poorly' }); // only in 3 months
  await check(leo.id, TODAY, { sleep: 'terrible' }); // someone else
  const chore = (await req('/api/chores', 'POST', { title: 'Feed the cat', points: 5, memberId: maya.id, rrule: 'FREQ=DAILY' })).json;
  await db.prepare("INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, status, points_awarded) VALUES ('c1', ?, ?, ?, ?, 'approved', 5)").bind(chore.id, TODAY, maya.id, NOW.toISOString()).run();
  await db.prepare("INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, status, points_awarded) VALUES ('c2', ?, '2026-09-25', ?, ?, 'pending', 0)").bind(chore.id, maya.id, NOW.toISOString()).run();
  await db.prepare("INSERT INTO plugin_playtime (date, member_id, plugin_id, seconds) VALUES (?, ?, 'paint', 1500), (?, ?, 'blocks', 330)").bind(TODAY, maya.id, TODAY, maya.id).run();
  await req('/api/trackers', 'POST', { kind: 'reading', memberId: maya.id, date: TODAY, title: 'The Wild Robot', data: { status: 'finished', finishedOn: TODAY } });
  await req(`/api/members/${maya.id}/journal`, 'POST', { text: SECRET, mood: '🌈' });

  const res = await req(ins(maya.id));
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const r = res.json;
  assert.deepEqual([r.memberId, r.range, r.from, r.to, r.days.length], [maya.id, '4w', '2026-08-30', TODAY, 28]);
  const today = r.days.at(-1);
  assert.deepEqual(today, {
    date: TODAY, checkedIn: true, sleep: 'great', feelings: ['good', 'excited'], goalSet: true, goalOutcome: 'yes', journalEntries: 1, journalMoods: ['🌈'],
    chores: 1, points: 5, activityMinutes: 31, booksFinished: 1, events: 0, lastEventEnd: null,
  });
  assert.equal(r.days[0].sleep, 'ok');
  assert.equal(r.days[1].checkedIn, false);
  assert.equal(r.days.find((d: any) => d.date === '2026-09-25').chores, 0, 'waiting for approval: not done yet');
  assert.ok(r.summary.some((s: any) => s.text === 'Slept well or great on 1 of 2 nights'));
  assert.equal(r.connections.ready, false);
  assert.equal(JSON.stringify(r).includes(SECRET), false, 'never the journal text');
  assert.equal(JSON.stringify(r).includes('Read'), false, 'nor the goal itself');

  const long = (await req(ins(maya.id, '3m'))).json;
  assert.deepEqual([long.from, long.days.length, long.days.find((d: any) => d.date === '2026-08-29').sleep], ['2026-06-28', 91, 'poorly']);
  assert.equal((await req(ins(maya.id, '1y'))).json.days.length, 364);
  assert.equal((await req(ins(maya.id, '2w'))).status, 400);
  assert.equal((await req(ins('ghost'))).status, 404);
});

test('insights: events per day and late evenings in household time; theirs and the family\'s, timed only', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo } = await setup();
  const family = (await req('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).json;
  const leos = (await req('/api/calendars', 'POST', { kind: 'local', name: 'Leo', memberIds: [leo.id] })).json;
  const ev = async (calendarId: string, start: string, end: string, allDay = false) =>
    assert.equal((await req('/api/events', 'POST', { calendarId, title: 'x', start, end, allDay })).status, 201);
  await ev(family.id, '2026-09-20T03:30:00.000Z', '2026-09-20T04:30:00.000Z'); // 8:30-9:30 PM on the 19th in LA (the 20th in UTC)
  await ev(family.id, '2026-09-19T16:00:00.000Z', '2026-09-19T17:00:00.000Z'); // 9-10 AM on the 19th
  await ev(family.id, '2026-09-21T02:00:00.000Z', '2026-09-21T03:00:00.000Z'); // 7-8 PM on the 20th: not late
  await ev(family.id, '2026-09-22T05:00:00.000Z', '2026-09-22T08:00:00.000Z'); // 10 PM on the 21st to 1 AM
  await ev(leos.id, '2026-09-23T17:00:00.000Z', '2026-09-23T18:00:00.000Z'); // Leo's alone
  await ev(family.id, '2026-09-24', '2026-09-25', true); // all day: not a busy hour
  const days = new Map((await req(ins(maya.id))).json.days.map((d: any) => [d.date, [d.events, d.lastEventEnd]]));
  assert.deepEqual(days.get('2026-09-19'), [2, '21:30']);
  assert.deepEqual(days.get('2026-09-20'), [1, '20:00']);
  assert.deepEqual(days.get('2026-09-21'), [1, '24:00'], 'past midnight');
  assert.deepEqual(days.get('2026-09-22'), [0, null]);
  assert.deepEqual(days.get('2026-09-23'), [0, null]);
  assert.deepEqual(days.get('2026-09-24'), [0, null]);
});

test('insights: a connection once there are 3 weeks of check-ins', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, check } = await setup();
  for (let i = 0; i < 20; i++) {
    const good = i % 2 === 0;
    await check(maya.id, addDays(TODAY, -i), { sleep: good ? 'good' : 'poorly', goal: 'Practice', outcome: good ? 'yes' : i % 4 === 1 ? 'partly' : 'no' });
  }
  const early = (await req(ins(maya.id))).json.connections;
  assert.deepEqual([early.ready, early.daysWithCheckIns, early.list], [false, 20, []]);
  await check(maya.id, addDays(TODAY, -20), { sleep: 'great', goal: 'Practice', outcome: 'yes' });
  const ready = (await req(ins(maya.id))).json.connections;
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.list.map((c: any) => [c.text, c.confidence]), [['Goals were met more often after good sleep (11 of 11 vs 0 of 10)', 'clear']]);
});

test('insights visibility: their own device and parents; never a shared wall, another member or a connected app (unless aiHealthAccess)', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo, key, check } = await setup();
  await check(maya.id, TODAY, { sleep: 'good' });
  const app = { 'X-Kinwall-Source': 'mcp' };
  assert.equal((await req(ins(maya.id))).status, 200, 'a parent device');
  assert.equal((await req(ins(maya.id), 'GET', undefined, await key(maya.id))).status, 200, 'her own device');
  assert.equal((await req(ins(leo.id), 'GET', undefined, await key(leo.id))).status, 200, 'Leo, his own');
  for (const [who, k, h] of [['wall', await key(), {}], ["Leo's device", await key(leo.id), {}], ['connected app', ADMIN, app]] as const) {
    const res = await req(ins(maya.id), 'GET', undefined, k, h);
    assert.equal(res.status, 403, who);
    assert.equal(JSON.stringify(res.json).includes('good'), false, who);
  }
  await req('/api/settings', 'PATCH', { aiHealthAccess: true });
  assert.equal((await req(ins(maya.id), 'GET', undefined, ADMIN, app)).status, 200, 'connected app with aiHealthAccess');
  assert.equal((await req(ins(maya.id), 'GET', undefined, await key())).status, 403, 'a wall, still');
});

test('insights: journal text is never read, only the count and mood', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, db, maya } = await setup();
  await req(`/api/members/${maya.id}/journal`, 'POST', { text: SECRET, mood: '🙂' });
  await req(`/api/members/${maya.id}/journal`, 'POST', { text: SECRET });
  // Text that can't be opened: the journal fails, insights don't touch it.
  await db.prepare("UPDATE journal_entries SET text = 'enc:v1:not-a-real-blob'").run();
  assert.equal((await req(`/api/members/${maya.id}/journal`)).status, 500);
  const res = await req(ins(maya.id));
  assert.equal(res.status, 200);
  assert.deepEqual([res.json.days.at(-1).journalEntries, res.json.days.at(-1).journalMoods], [2, ['🙂']]);
});

test('insights: computed on request, nothing written; without the key nothing opens', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, check, dump, env } = await setup();
  await check(maya.id, TODAY, { sleep: 'good', feelings: ['tired'], goal: 'Read', outcome: 'partly', note: SECRET });
  await req(`/api/members/${maya.id}/journal`, 'POST', { text: SECRET, mood: '🙂' });
  const before = JSON.stringify(dump());
  for (const range of ['4w', '3m', '1y']) assert.equal((await req(ins(maya.id, range))).status, 200);
  assert.equal(JSON.stringify(dump()), before, 'no new rows, columns or tables');
  env.ENCRYPTION_KEY = undefined;
  assert.equal((await req(ins(maya.id))).status, 500, 'sealed answers are never read as empty');
});

test('insights: the logs never see the answers', async (t) => {
  t.after(() => mock.timers.reset());
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const { req, maya, check, env } = await setup();
    await check(maya.id, TODAY, { sleep: 'terrible', feelings: [SECRET], goal: 'Read', outcome: 'no', note: SECRET });
    await req(`/api/members/${maya.id}/journal`, 'POST', { text: SECRET, mood: '🙂' });
    assert.equal((await req(ins(maya.id))).status, 200);
    assert.equal((await req(ins(maya.id, SECRET))).status, 400);
    env.ENCRYPTION_KEY = undefined;
    assert.equal((await req(ins(maya.id))).status, 500);
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  assert.ok(lines.length > 0, 'the failing request was logged');
  assert.equal(lines.join('\n').includes(SECRET), false);
  assert.equal(lines.join('\n').includes('terrible'), false);
});
