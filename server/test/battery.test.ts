// The energy battery (battery.ts, routes/insights.ts, notify.ts runBatteryHeadsUp): a rough daily
// guess at how much energy a person has, from sleep and feelings (Temp check) against what the
// calendar and chores ask of them, with a heads-up before heavy days. Derived from health data
// (AGENTS.md "Health data"): computed on request, nothing stored but the insert-once push claim,
// never logged, only on the person's own device and parents' devices, and off for connected apps
// unless the family turned on aiHealthAccess. Push text never mentions sleep or feelings.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { battery, calibrate, type BatteryInput } from '../src/battery.ts';
import { sealTempCheck } from '../src/routes/temp-check.ts';
import { runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const TODAY = '2026-09-26'; // a Saturday
const at = (local: string, date = TODAY) => new Date(`${date}T${local}:00-07:00`); // Los Angeles (PDT)
const SECRET = 'zz-secret-feeling';
const TC = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: false, eveningTime: '21:00', journal: true, battery: true };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------- The model (pure) ----------

const day = (date: string, p: Partial<BatteryInput> = {}): BatteryInput => ({ date, sleep: null, feelings: [], goalSet: false, chores: 0, choreDone: 0, choreDue: 0, events: [], ...p });
const ev = (title: string, start: string, end: string) => ({ title, start, end });
const hourly = (n: number, first = 9) => Array.from({ length: n }, (_, i) => ev(`Thing ${i + 1}`, `${String(first + i * 2).padStart(2, '0')}:00`, `${String(first + i * 2 + 1).padStart(2, '0')}:00`));
const only = (inputs: BatteryInput[], date = TODAY) => battery(inputs, TODAY).days.find((d) => d.date === date)!;

test('battery: the start charge comes from sleep, with a usual night when there is no answer', () => {
  for (const [sleep, start] of [['great', 90], ['good', 75], ['ok', 60], ['poorly', 40], ['terrible', 25]] as const) {
    assert.deepEqual(only([day(TODAY, { sleep })]), { date: TODAY, forecast: false, start, drain: 0, level: start, reasons: [{ text: `Sleep: ${sleep}`, points: start }], lowBefore: null });
  }
  assert.deepEqual(only([day(TODAY)]).reasons, [{ text: 'Sleep: no answer yet', points: 65 }], 'nothing to go on');
  // Their usual night: the average of the answered nights in the last 7 days.
  const usual = only([day(addDays(TODAY, -8), { sleep: 'terrible' }), day(addDays(TODAY, -2), { sleep: 'good' }), day(addDays(TODAY, -1), { sleep: 'great' }), day(TODAY)]);
  assert.deepEqual([usual.start, usual.reasons[0].text], [83, 'Sleep: no answer yet']);
  const tomorrow = only([day(TODAY, { sleep: 'ok' }), day(addDays(TODAY, 1))], addDays(TODAY, 1));
  assert.deepEqual([tomorrow.forecast, tomorrow.start, tomorrow.reasons[0].text], [true, 60, 'Sleep: usual']);
});

test("battery: tired, sore, bad or awful lower the start; other feelings don't", () => {
  const d = only([day(TODAY, { sleep: 'good', feelings: ['Tired', 'sore', 'good', SECRET] })]);
  assert.equal(d.start, 60);
  assert.deepEqual(d.reasons, [{ text: 'Sleep: good', points: 75 }, { text: 'Feeling tired', points: -10 }, { text: 'Feeling sore', points: -5 }]);
  assert.equal(only([day(TODAY, { sleep: 'terrible', feelings: ['awful', 'tired', 'bad', 'sore'] })]).start, 0, 'never below empty');
});

test('battery: drains with events (longer, back to back, late), chore points and a goal', () => {
  const d = only([day(TODAY, {
    sleep: 'good', goalSet: true, chores: 2, choreDue: 12,
    events: [ev('Soccer', '19:30', '20:30'), ev('School pickup', '15:00', '15:30'), ev('Piano', '15:40', '17:10')], // any order
  })]);
  assert.deepEqual(d.reasons.slice(1), [
    { text: '3 events', points: -30 },
    { text: 'Long events', points: -5 }, // Piano runs 90 minutes: one hour past the first
    { text: '1 back-to-back', points: -5 }, // 10 minutes from pickup to Piano
    { text: 'Late evening', points: -10 }, // Soccer ends after 8 PM
    { text: 'Chores: 12 points', points: -6 },
    { text: 'Goal for today', points: -5 },
  ]);
  assert.deepEqual([d.start, d.drain, d.level], [75, 61, 14]);
  assert.equal(d.lowBefore, 'Soccer', 'the event that takes the battery under 25%');
  const one = only([day(TODAY, { sleep: 'ok', chores: 1, choreDue: 5, events: [ev('Swim', '10:00', '15:00')] })]);
  assert.deepEqual(one.reasons.slice(1), [{ text: '1 event', points: -10 }, { text: 'Long events', points: -15 }, { text: 'Chores: 5 points', points: -3 }], 'long events count up to 3 extra hours');
  assert.equal(only([day(TODAY, { sleep: 'ok', events: [ev('Party', '18:00', '20:00')] })]).reasons.some((r) => r.text === 'Late evening'), false, '8 PM exactly is not late');
  assert.equal(only([day(TODAY, { sleep: 'ok', events: [ev('Sleepover', '19:00', '24:00')] })]).reasons.some((r) => r.text === 'Late evening'), true, 'past midnight');
});

test('battery: several busy days in a row and a late evening lower the next start', () => {
  const busy = (date: string, extra: BatteryInput['events'] = []) => day(date, { events: [...hourly(4), ...extra] }); // 40: a busy day
  const d = only([
    busy(addDays(TODAY, -4)), busy(addDays(TODAY, -3)), busy(addDays(TODAY, -2)), busy(addDays(TODAY, -1), [ev('Movie', '19:00', '21:00')]),
    day(TODAY, { sleep: 'ok' }),
  ]);
  assert.deepEqual(d.reasons, [{ text: 'Sleep: ok', points: 60 }, { text: 'Late evening yesterday', points: -10 }, { text: '3 busy days before', points: -15 }], 'only the last 3 days count');
  assert.equal(d.start, 35);
  const calm = only([day(addDays(TODAY, -1), { events: hourly(3), chores: 1, choreDone: 5 }), day(TODAY, { sleep: 'ok' })]); // 33: not busy
  assert.equal(calm.start, 60);
});

test('battery: a heads-up for today and the next days when the forecast runs low, with its reasons', () => {
  const tomorrow = addDays(TODAY, 1);
  const r = battery([
    day(TODAY, { sleep: 'good' }),
    day(tomorrow, { events: [...hourly(4), ev('Soccer practice', '19:00', '20:30')] }),
    day(addDays(TODAY, 2), { events: hourly(1) }),
  ], TODAY);
  const t = r.days.find((d) => d.date === tomorrow)!;
  assert.deepEqual([t.forecast, t.start, t.drain, t.level, t.lowBefore], [true, 75, 65, 10, 'Soccer practice']);
  assert.deepEqual(r.warnings, [{
    date: tomorrow,
    text: 'Tomorrow looks full: 5 events and a late evening. Maybe plan a rest or move something?',
    suggestions: ['Rest before Soccer practice', 'Pick one thing to skip'],
  }]);
  const after = r.days.find((d) => d.date === addDays(TODAY, 2))!;
  assert.deepEqual([after.start, after.level], [60, 50], 'a late, busy day before: 75 - 10 - 5');
  const monday = battery([day(TODAY, { sleep: 'good' }), day(tomorrow), day(addDays(TODAY, 2), { events: hourly(5), chores: 2, choreDue: 10 })], TODAY);
  assert.equal(monday.warnings[0].text, 'Monday looks full: 5 events and 2 chores. Maybe plan a rest or move something?');
  const past = battery([day(addDays(TODAY, -1), { sleep: 'terrible', events: hourly(5) }), day(TODAY, { sleep: 'great' })], TODAY);
  assert.deepEqual([past.days[0].level, past.warnings], [0, []], 'no heads-up for a day that has gone');
});

test('battery: the heads-up threshold is under 25%, and only when something is planned', () => {
  const at25 = battery([day(TODAY, { sleep: 'ok', goalSet: true, events: hourly(3) })], TODAY); // 60 - 35
  assert.deepEqual([at25.days[0].level, at25.warnings], [25, []]);
  const at22 = battery([day(TODAY, { sleep: 'ok', goalSet: true, chores: 1, choreDue: 5, events: hourly(3) })], TODAY);
  assert.equal(at22.days[0].level, 22);
  assert.deepEqual(at22.warnings.map((w) => [w.text, w.suggestions]), [['Today looks full: 3 events and 1 chore. Maybe plan a rest or move something?', ['Rest before Thing 3', 'Pick one thing to skip']]]);
  const tiredNothingPlanned = battery([day(TODAY, { sleep: 'terrible', feelings: ['tired', 'sore'] })], TODAY);
  assert.deepEqual([tiredNothingPlanned.days[0].level, tiredNothingPlanned.warnings], [10, []]);
  const choresOnly = battery([day(TODAY, { sleep: 'terrible', chores: 3, choreDue: 15 })], TODAY);
  assert.deepEqual(choresOnly.warnings.map((w) => [w.text, w.suggestions]), [['Today looks full: 3 chores. Maybe plan a rest or move something?', ['Plan a rest in the middle of the day', 'Pick one thing to skip']]]);
});

test('battery: chores drain by their points, a little, and capped', () => {
  const yesterday = addDays(TODAY, -1), tomorrow = addDays(TODAY, 1);
  const r = battery([
    day(yesterday, { sleep: 'good', chores: 3, choreDone: 7, choreDue: 20 }), // what they did, not what was left
    day(TODAY, { sleep: 'good', chores: 2, choreDone: 6, choreDue: 4 }), // done so far plus still to do
    day(tomorrow, { chores: 2, choreDue: 12 }), // ahead: what's due
    day(addDays(TODAY, 2), { chores: 9, choreDue: 45 }),
    day(addDays(TODAY, 3), { chores: 1, choreDue: 1 }),
  ], TODAY).days;
  const line = (i: number) => r[i].reasons.find((x) => x.text.startsWith('Chores'));
  assert.deepEqual(line(0), { text: 'Chores: 7 points', points: -4 }, '1 per 2 points, rounded up');
  assert.deepEqual(line(1), { text: 'Chores: 10 points', points: -5 });
  assert.deepEqual(line(2), { text: 'Chores: 12 points', points: -6 });
  assert.deepEqual(line(3), { text: 'Chores: 45 points', points: -15 }, 'never more than 15 a day');
  assert.deepEqual(line(4), { text: 'Chores: 1 point', points: -1 });
  assert.equal(only([day(TODAY, { sleep: 'good', chores: 2 })]).reasons.some((x) => x.text.startsWith('Chores')), false, 'no points, no drain');
});

// ---------- Calibration: how drained they felt ----------

const lvl = (date: string, level: number) => ({ date, forecast: date > TODAY, start: 100, drain: 100 - level, level, reasons: [], lowBefore: null });
const answered = (n: number, level: number, felt: string, from = 0) => {
  const days = Array.from({ length: n }, (_, i) => lvl(addDays(TODAY, -from - i), level));
  return { days, felt: Object.fromEntries(days.map((d) => [d.date, felt])) as Record<string, any> };
};

test('calibration: needs 10 answered days in the last 28; skips, older and later days do not count', () => {
  const nine = answered(9, 60, 'low');
  assert.deepEqual(calibrate(nine.days, nine.felt, TODAY), { answered: 9, adjust: null });
  const old = answered(10, 60, 'low', 20); // 20-29 days back: two of them are too old
  assert.deepEqual(calibrate(old.days, old.felt, TODAY), { answered: 8, adjust: null });
  const skipped = answered(10, 60, 'low');
  skipped.felt[TODAY] = 'skip';
  assert.deepEqual(calibrate(skipped.days, skipped.felt, TODAY).answered, 9);
  const ahead = answered(10, 60, 'low');
  ahead.days.push(lvl(addDays(TODAY, 1), 60));
  ahead.felt[addDays(TODAY, 1)] = 'empty';
  assert.equal(calibrate(ahead.days, ahead.felt, TODAY).answered, 10);
});

test('calibration: the average gap to how they felt, shrunk toward 0 with few answers, within ±25', () => {
  // Predicted 60 by evening, felt Low (25-49): 11 short each day.
  const ten = answered(10, 60, 'low');
  assert.deepEqual(calibrate(ten.days, ten.felt, TODAY), { answered: 10, adjust: -7 }, '-11 x 10/15');
  const full = answered(28, 60, 'low');
  assert.deepEqual(calibrate(full.days, full.felt, TODAY), { answered: 28, adjust: -9 }, '-11 x 28/33');
  const inside = answered(12, 60, 'ok'); // OK is 50-74: right
  assert.deepEqual(calibrate(inside.days, inside.felt, TODAY), { answered: 12, adjust: 0 });
  const better = answered(28, 10, 'full'); // felt Full (75+) on days it said 10%
  assert.deepEqual(calibrate(better.days, better.felt, TODAY), { answered: 28, adjust: 25 }, 'clamped');
  const worse = answered(28, 100, 'empty');
  assert.deepEqual(calibrate(worse.days, worse.felt, TODAY), { answered: 28, adjust: -25 }, 'clamped');
});

test('calibration: the adjustment drains each day with its reason; until then, how many check-ins so far', () => {
  const inputs = [day(addDays(TODAY, -1), { sleep: 'good', events: hourly(1) }), day(TODAY, { sleep: 'good', events: hourly(2) }), day(addDays(TODAY, 1))];
  const less = battery(inputs, TODAY, { answered: 12, adjust: -8 }).days;
  assert.deepEqual(less.map((d) => d.reasons.at(-1)), [
    { text: "Adjusted for how you've felt lately", points: -8 }, { text: "Adjusted for how you've felt lately", points: -8 }, { text: "Adjusted for how you've felt lately", points: -8 },
  ]);
  assert.deepEqual([less[1].drain, less[1].level], [28, 47]);
  const more = battery(inputs, TODAY, { answered: 12, adjust: 15 }).days;
  assert.deepEqual(more[1].reasons.at(-1), { text: "Adjusted for how you've felt lately", points: 15 });
  assert.deepEqual([more[1].drain, more[1].level], [5, 70]);
  assert.deepEqual(more[2].reasons.at(-1), { text: 'Sleep: usual', points: 75 }, 'never below no drain');
  const learning = battery(inputs, TODAY, { answered: 4, adjust: null }).days;
  assert.deepEqual(learning.map((d) => d.reasons.filter((r) => r.text.startsWith('Learning'))), [[], [{ text: 'Learning: 4 of 10 check-ins', points: 0 }], []], 'on today');
  assert.deepEqual([learning[1].drain, learning[1].level], [20, 55]);
  assert.equal(battery(inputs, TODAY).days.some((d) => d.reasons.some((r) => r.text.startsWith('Learning'))), false, 'no answers yet: nothing to say');
});

// ---------- The endpoint ----------

async function setup(now = at('22:00')) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY } as Env;
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
  const check = async (memberId: string, date: string, v: { sleep?: string; feelings?: string[]; goal?: string; drained?: string }) => {
    const s = await sealTempCheck(env, memberId, date, { sleep: v.sleep ?? null, feelings: v.feelings ?? null, drained: v.drained ?? null });
    await db.prepare('INSERT INTO temp_checks (member_id, date, sleep, feelings, goal, goal_skipped, followup, drained, created_at, updated_at) VALUES (?,?,?,?,?,0,NULL,?,?,?)')
      .bind(memberId, date, s.sleep, s.feelings, v.goal ?? null, s.drained, now.toISOString(), now.toISOString()).run();
  };
  const dump = () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>().results.map((r) => r.name);
    return Object.fromEntries(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}"`).all().results]));
  };
  return { env, db, req, maya, leo, key, check, dump };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Tomorrow (Sunday the 27th in Los Angeles): five of the family's events, the last one ending late, and a daily chore for Maya. */
async function busyTomorrow(s: S) {
  const family = (await s.req('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).json;
  const leos = (await s.req('/api/calendars', 'POST', { kind: 'local', name: 'Leo', memberIds: [s.leo.id] })).json;
  const add = async (calendarId: string, title: string, start: string, end: string, allDay = false) =>
    assert.equal((await s.req('/api/events', 'POST', { calendarId, title, start, end, allDay })).status, 201);
  await add(family.id, 'Swim', '2026-09-27T16:00:00.000Z', '2026-09-27T17:00:00.000Z'); // 9-10 AM
  await add(family.id, 'Library', '2026-09-27T18:00:00.000Z', '2026-09-27T19:00:00.000Z');
  await add(family.id, 'Party', '2026-09-27T20:00:00.000Z', '2026-09-27T21:00:00.000Z');
  await add(family.id, 'Art class', '2026-09-27T22:00:00.000Z', '2026-09-27T23:00:00.000Z');
  await add(family.id, 'Soccer practice', '2026-09-28T02:00:00.000Z', '2026-09-28T03:30:00.000Z'); // 7-8:30 PM on the 27th
  await add(leos.id, 'Leo only', '2026-09-27T17:00:00.000Z', '2026-09-27T18:00:00.000Z');
  await add(family.id, 'Fair', '2026-09-27', '2026-09-28', true); // all day: not a busy hour
  assert.equal((await s.req('/api/chores', 'POST', { title: 'Feed the cat', points: 5, memberId: s.maya.id, rrule: 'FREQ=DAILY' })).status, 201);
  assert.equal((await s.req('/api/chores', 'POST', { title: 'Walk the dog', points: 5, memberId: s.leo.id, rrule: 'FREQ=DAILY' })).status, 201);
  assert.equal((await s.req('/api/chores', 'POST', { title: 'Anyone: dishes', points: 5, rrule: 'FREQ=DAILY' })).status, 201);
}
const TOMORROW_TEXT = 'Tomorrow looks full: 5 events, 1 chore and a late evening. Maybe plan a rest or move something?';
const bat = (id: string) => `/api/members/${id}/battery`;

test('battery endpoint: a week back and 3 days ahead, from sealed check-ins, the calendar and chores in household time', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await busyTomorrow(s);
  await s.check(s.maya.id, TODAY, { sleep: 'great', feelings: ['tired'], goal: 'Read' });
  await s.check(s.maya.id, addDays(TODAY, -1), { sleep: 'poorly' });
  const res = await s.req(bat(s.maya.id));
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const b = res.json;
  assert.deepEqual([b.memberId, b.on, b.today, b.days.length, b.days[0].date, b.days.at(-1).date], [s.maya.id, true, TODAY, 10, '2026-09-20', '2026-09-29']);
  assert.deepEqual(b.days.map((d: any) => d.forecast), [false, false, false, false, false, false, false, true, true, true]);
  const today = b.days[6];
  assert.deepEqual(today.reasons, [{ text: 'Sleep: great', points: 90 }, { text: 'Feeling tired', points: -10 }, { text: 'Chores: 5 points', points: -3 }, { text: 'Goal for today', points: -5 }]);
  assert.equal(today.level, 72);
  assert.deepEqual([b.days[5].start, b.days[5].level], [40, 40], 'yesterday: slept poorly');
  const tomorrow = b.days[7];
  assert.deepEqual(tomorrow.reasons, [
    { text: 'Sleep: usual', points: 65 }, // great and poorly, averaged
    { text: '5 events', points: -50 }, { text: 'Long events', points: -5 }, { text: 'Late evening', points: -10 }, { text: 'Chores: 5 points', points: -3 },
  ]);
  assert.deepEqual([tomorrow.level, tomorrow.lowBefore], [0, 'Art class']);
  assert.deepEqual(b.warnings, [{ date: '2026-09-27', text: TOMORROW_TEXT, suggestions: ['Rest before Art class', 'Pick one thing to skip'] }]);
  assert.equal(JSON.stringify(b).includes('Read'), false, 'never the goal itself');
  assert.equal(JSON.stringify(b).includes('Leo only'), false);

  // Chores turned off for the family: they don't count.
  const { features } = (await s.req('/api/settings')).json;
  assert.equal((await s.req('/api/settings', 'PATCH', { features: { ...features, chores: false } })).status, 200);
  assert.equal((await s.req(bat(s.maya.id))).json.days[7].reasons.some((r: any) => /chore/i.test(r.text)), false);
});

test('battery endpoint: chore points they did on days gone, done plus still due today, due ahead', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await busyTomorrow(s);
  const chores = (await s.req('/api/chores')).json as { id: string; title: string }[];
  const id = (title: string) => chores.find((c) => c.title === title)!.id;
  // Yesterday she helped with the dishes (an Anyone chore, 5 points) and walked Leo's dog for him (5).
  for (const title of ['Anyone: dishes', 'Walk the dog']) assert.equal((await s.req(`/api/chores/${id(title)}/complete`, 'POST', { date: addDays(TODAY, -1), memberId: s.maya.id })).status, 200);
  // Today she did the dishes; feeding the cat (hers, 5) is still to do.
  assert.equal((await s.req(`/api/chores/${id('Anyone: dishes')}/complete`, 'POST', { date: TODAY, memberId: s.maya.id })).status, 200);
  const days = (await s.req(bat(s.maya.id))).json.days;
  const line = (i: number) => days[i].reasons.find((r: any) => r.text.startsWith('Chores'));
  assert.deepEqual(line(5), { text: 'Chores: 10 points', points: -5 }, 'yesterday: what she did');
  assert.deepEqual(line(6), { text: 'Chores: 10 points', points: -5 }, 'today: 5 done, 5 to go');
  assert.deepEqual(line(7), { text: 'Chores: 5 points', points: -3 }, 'tomorrow: her own chore due');
  assert.equal(await s.req(`/api/chores/${id('Feed the cat')}/complete`, 'POST', { date: TODAY, memberId: s.maya.id }).then((r) => r.status), 200);
  assert.deepEqual((await s.req(bat(s.maya.id))).json.days[6].reasons.find((r: any) => r.text.startsWith('Chores')), { text: 'Chores: 10 points', points: -5 }, 'finishing it never adds more');
});

test('battery endpoint: how drained she felt calibrates it after 10 check-ins, and each day says how she felt', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  // Quiet days she slept OK (predicted 60% by evening) but felt Low: 4 check-ins so far.
  for (let i = 1; i <= 4; i++) await s.check(s.maya.id, addDays(TODAY, -i), { sleep: 'ok', drained: 'low' });
  await s.check(s.maya.id, addDays(TODAY, -5), { sleep: 'ok', drained: 'skip' });
  let b = (await s.req(bat(s.maya.id))).json;
  assert.deepEqual(b.days[6].reasons.at(-1), { text: 'Learning: 4 of 10 check-ins', points: 0 });
  assert.deepEqual(b.days.slice(0, 7).map((d: any) => d.felt), [null, null, 'low', 'low', 'low', 'low', null], 'Skip is no answer');
  assert.equal(b.days[7].felt, null);
  for (let i = 6; i <= 11; i++) await s.check(s.maya.id, addDays(TODAY, -i), { sleep: 'ok', drained: 'low' });
  b = (await s.req(bat(s.maya.id))).json;
  // 10 answers, each 11 under what it said: -11 x 10/15.
  assert.deepEqual(b.days[6].reasons.at(-1), { text: "Adjusted for how you've felt lately", points: -7 });
  assert.deepEqual(b.days[9].reasons.at(-1), { text: "Adjusted for how you've felt lately", points: -7 }, 'days ahead too');
  assert.equal(JSON.stringify(s.dump()).includes('"low"'), false, 'nothing derived is stored, and the answers are sealed');
});

test('battery endpoint: off unless their Temp check and battery are both on', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  assert.deepEqual((await s.req(bat(s.leo.id))).json, { memberId: s.leo.id, on: false, today: TODAY, days: [], warnings: [] });
  await s.req(`/api/members/${s.maya.id}`, 'PATCH', { tempCheck: { ...TC, battery: false } });
  assert.equal((await s.req(bat(s.maya.id))).json.on, false);
  await s.req(`/api/members/${s.maya.id}`, 'PATCH', { tempCheck: { ...TC, on: false } });
  assert.equal((await s.req(bat(s.maya.id))).json.on, false, 'Temp check off');
  assert.equal((await s.req(bat('ghost'))).status, 404);
  assert.equal((await s.req('/api/members')).json.find((m: any) => m.id === s.leo.id).tempCheck.battery, false, 'off by default');
});

test('battery visibility: their own device and parents; never a shared wall, another member or a connected app (unless aiHealthAccess)', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await s.check(s.maya.id, TODAY, { sleep: 'terrible' });
  const app = { 'X-Kinwall-Source': 'mcp' };
  assert.equal((await s.req(bat(s.maya.id))).status, 200, 'a parent device');
  assert.equal((await s.req(bat(s.maya.id), 'GET', undefined, await s.key(s.maya.id))).status, 200, 'her own device');
  for (const [who, k, h] of [['wall', await s.key(), {}], ["Leo's device", await s.key(s.leo.id), {}], ['connected app', ADMIN, app]] as const) {
    const res = await s.req(bat(s.maya.id), 'GET', undefined, k, h);
    assert.equal(res.status, 403, who);
    assert.equal(JSON.stringify(res.json).includes('terrible'), false, who);
  }
  await s.req('/api/settings', 'PATCH', { aiHealthAccess: true });
  assert.equal((await s.req(bat(s.maya.id), 'GET', undefined, ADMIN, app)).status, 200, 'connected app with aiHealthAccess');
  assert.equal((await s.req(bat(s.maya.id), 'GET', undefined, await s.key())).status, 403, 'a wall, still');
});

test('battery: computed on request, nothing written; without the key nothing opens', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await busyTomorrow(s);
  await s.check(s.maya.id, TODAY, { sleep: 'good', feelings: [SECRET] });
  const before = JSON.stringify(s.dump());
  assert.equal((await s.req(bat(s.maya.id))).status, 200);
  assert.equal(JSON.stringify(s.dump()), before, 'no new rows, columns or tables');
  s.env.ENCRYPTION_KEY = undefined;
  assert.equal((await s.req(bat(s.maya.id))).status, 500, 'sealed answers are never read as empty');
});

test('battery: the logs never see the answers', async (t) => {
  t.after(() => mock.timers.reset());
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const s = await setup();
    await busyTomorrow(s);
    await s.check(s.maya.id, TODAY, { sleep: 'terrible', feelings: [SECRET] });
    assert.equal((await s.req(bat(s.maya.id))).status, 200);
    s.env.ENCRYPTION_KEY = undefined;
    assert.equal((await s.req(bat(s.maya.id))).status, 500);
    await runNotifications(s.env, at('19:02')); // the heads-up can't open her answers either
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  assert.ok(lines.length > 0, 'the failing request was logged');
  assert.equal(lines.join('\n').includes(SECRET), false);
  assert.equal(lines.join('\n').includes('terrible'), false);
});

// ---------- The heads-up push ----------

// Push capture: a subscriber's keys, and an independent RFC 8291 decryptor to read what was sent.
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
async function devices(s: S, list: [name: string, key: string][]) {
  const subs = new Map<string, Sub>();
  for (const [name, key] of list) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const sub = { privateKey: pair.privateKey, p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
    const res = await s.req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://push.example/${name}`, keys: { p256dh: sub.p256dh, auth: sub.auth } }, deviceName: name }, key);
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
const everyDevice = async (s: S) => devices(s, [['maya-phone', await s.key(s.maya.id)], ['leo-tablet', await s.key(s.leo.id)], ['wall', await s.key()], ['parent-phone', ADMIN]]);

test('heads-up push: the evening before a heavy day, once, to their own devices only; nothing in the feed', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup(at('18:00'));
  await busyTomorrow(s);
  await s.check(s.maya.id, TODAY, { sleep: 'poorly', feelings: ['tired', SECRET] });
  const tick = await everyDevice(s);
  assert.deepEqual(await tick(at('18:55')), {}, 'not yet');
  const sent = await tick(at('19:02'));
  assert.deepEqual(Object.keys(sent), ['maya-phone']);
  assert.equal(sent['maya-phone'][0].title, '🔋 Heads-up for tomorrow');
  assert.match(sent['maya-phone'][0].body, /^Tomorrow looks full: 5 events, 1 chore and a late evening\./);
  assert.doesNotMatch(JSON.stringify(sent), /sleep|poorly|tired|feel|zz-secret/i, 'never sleep or feelings');
  assert.deepEqual(await tick(at('19:10')), {}, 'once');
  await s.db.prepare("DELETE FROM settings WHERE key = 'notifyLastTick'").run(); // a restart
  assert.deepEqual(await tick(at('20:50')), {}, 'still once');
  const claims = s.db.prepare('SELECT key FROM sent_notifications').all<{ key: string }>().results.map((r) => r.key).filter((k) => k.startsWith('battery:'));
  assert.equal(claims.length, 1);
  assert.match(claims[0], /^battery:[0-9a-f]{64}$/, 'the claim never says who or which day');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>()!.n, 0, 'personal: not in the family feed');
});

test('heads-up push: held through quiet hours until the morning, then "today"', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup(at('18:00'));
  await busyTomorrow(s);
  await s.req('/api/settings', 'PATCH', { quietFrom: '18:00', quietTo: '07:00' });
  const tick = await devices(s, [['maya-phone', await s.key(s.maya.id)]]);
  assert.deepEqual(await tick(at('19:02')), {}, 'quiet hours');
  assert.deepEqual(await tick(at('06:55', '2026-09-27')), {}, 'still quiet');
  assert.deepEqual(await tick(at('07:03', '2026-09-27')), {
    'maya-phone': [{ title: '🔋 Heads-up for today', body: 'Today looks full: 5 events, 1 chore and a late evening. Maybe plan a rest or move something?' }],
  });
  assert.deepEqual(await tick(at('07:30', '2026-09-27')), {}, 'once');
});

test('heads-up push: nothing when the day ahead looks fine, battery is off, or they have no device', async (t) => {
  t.after(() => mock.timers.reset());
  const calm = await setup(at('18:00'));
  const calmTick = await devices(calm, [['maya-phone', await calm.key(calm.maya.id)]]);
  assert.deepEqual(await calmTick(at('19:02')), {}, 'a calm day ahead');

  const off = await setup(at('18:00'));
  await busyTomorrow(off);
  await off.req(`/api/members/${off.maya.id}`, 'PATCH', { tempCheck: { ...TC, battery: false } });
  const offTick = await devices(off, [['maya-phone', await off.key(off.maya.id)], ['parent-phone', ADMIN]]);
  assert.deepEqual(await offTick(at('19:02')), {}, 'battery off');

  const none = await setup(at('18:00'));
  await busyTomorrow(none);
  const noneTick = await devices(none, [['parent-phone', ADMIN], ['wall', await none.key()]]);
  assert.deepEqual(await noneTick(at('19:02')), {}, 'no device of her own');
  assert.equal(none.db.prepare("SELECT COUNT(*) AS n FROM sent_notifications WHERE key LIKE 'battery:%'").first<{ n: number }>()!.n, 0);
});

// ---------- "How drained do you feel?" (the evening check) ----------

const tcPath = (id: string, date?: string) => `/api/members/${id}/temp-check${date ? `?date=${date}` : ''}`;

test('drained: saved sealed from her own device or a parent, today only, while her battery is on', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup(); // 10 PM, past her 9 PM evening time
  const mine = await s.key(s.maya.id);
  const res = await s.req(tcPath(s.maya.id), 'PUT', { drained: 'empty' }, mine);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual([res.json.drained, res.json.answered.drained, res.json.drainedOpen], ['empty', true, true]);
  const raw = s.db.prepare('SELECT drained FROM temp_checks').first<{ drained: string }>()!.drained;
  assert.ok(raw && !raw.includes('empty'), 'sealed at rest');
  assert.equal((await s.req(tcPath(s.maya.id))).json.drained, 'empty', 'a parent sees it');
  assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { drained: 'skip' })).json.drained, 'skip', 'Skip');
  assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { drained: 'ok' })).json.drained, 'ok', 'changed until midnight');
  assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { sleep: 'good' })).json.drained, 'ok', 'other answers leave it be');
  assert.equal((await s.req(tcPath(s.maya.id, addDays(TODAY, -1)), 'PUT', { drained: 'low' })).status, 403, 'today only');
  assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { drained: 'tired' })).status, 400);

  // A wall, Leo's device and a connected app (without aiHealthAccess): can't answer or see it.
  const app = { 'X-Kinwall-Source': 'mcp' };
  for (const [who, k, h] of [['wall', await s.key(), {}], ["Leo's device", await s.key(s.leo.id), {}], ['connected app', ADMIN, app]] as const) {
    assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { drained: 'low' }, k, h)).status, 403, who);
    const got = (await s.req(tcPath(s.maya.id), 'GET', undefined, k, h)).json;
    assert.deepEqual([got.drained, got.drainedOpen], [null, false], who);
  }
  await s.req('/api/settings', 'PATCH', { aiHealthAccess: true });
  assert.equal((await s.req(tcPath(s.maya.id), 'GET', undefined, ADMIN, app)).json.drained, 'ok', 'connected app with aiHealthAccess');

  // Battery off: no question.
  await s.req(`/api/members/${s.maya.id}`, 'PATCH', { tempCheck: { ...TC, battery: false } });
  assert.equal((await s.req(tcPath(s.maya.id))).json.drainedOpen, false);
  assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { drained: 'low' })).status, 400);
});

test('drained: asked from her evening time, not before', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup(at('20:30'));
  assert.equal((await s.req(tcPath(s.maya.id))).json.drainedOpen, false);
  mock.timers.setTime(at('21:00').getTime());
  assert.equal((await s.req(tcPath(s.maya.id))).json.drainedOpen, true);
});

test('drained: in the data export for a parent, and back in sealed on import', async (t) => {
  t.after(() => mock.timers.reset());
  const s = await setup();
  await s.req(tcPath(s.maya.id), 'PUT', { drained: 'low' });
  const exported = (await s.req('/api/export')).json;
  assert.equal(exported.tempChecks.find((x: any) => x.memberId === s.maya.id).drained, 'low');
  const back = await s.req('/api/import', 'POST', exported);
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal((await s.req(tcPath(s.maya.id))).json.drained, 'low');
  const raw = s.db.prepare('SELECT drained FROM temp_checks').first<{ drained: string }>()!.drained;
  assert.ok(raw.length > 20 && !JSON.stringify(s.db.prepare('SELECT * FROM temp_checks').all().results).includes('"low"'), 'sealed again');
});

const EVENING_TC = { ...TC, evening: true };
test('evening push: one, whether she has a goal, the battery, or both', async (t) => {
  t.after(() => mock.timers.reset());
  // A goal and the battery: the goal check's push, just once.
  const both = await setup(at('18:00'));
  await both.req(`/api/members/${both.maya.id}`, 'PATCH', { tempCheck: EVENING_TC });
  await both.req(tcPath(both.maya.id), 'PUT', { goal: 'Read' });
  const bothTick = await everyDevice(both);
  assert.deepEqual(await bothTick(at('21:02')), { 'maya-phone': [{ title: 'Did you finish your goal? 🎯', body: 'Read' }] });
  assert.deepEqual(await bothTick(at('21:10')), {});

  // No goal today: the battery's question, at the same time, to her devices only; not in the family feed.
  const only = await setup(at('18:00'));
  const onlyTick = await everyDevice(only);
  assert.deepEqual(await onlyTick(at('20:55')), {}, 'not yet');
  assert.deepEqual(await onlyTick(at('21:02')), { 'maya-phone': [{ title: 'How drained do you feel? 🔋', body: 'A quick check-in before bed.' }] });
  assert.deepEqual(await onlyTick(at('21:10')), {}, 'once');
  assert.equal(only.db.prepare('SELECT COUNT(*) AS n FROM notifications').first<{ n: number }>()!.n, 0);

  // Answered already, or the battery off (and no goal): nothing.
  const done = await setup(at('18:00'));
  mock.timers.setTime(at('21:01').getTime());
  await done.req(tcPath(done.maya.id), 'PUT', { drained: 'ok' });
  assert.deepEqual(await (await everyDevice(done))(at('21:02')), {}, 'answered');
  const off = await setup(at('18:00'));
  await off.req(`/api/members/${off.maya.id}`, 'PATCH', { tempCheck: { ...EVENING_TC, battery: false } });
  assert.deepEqual(await (await everyDevice(off))(at('21:02')), {}, 'battery off');
});

test('drained: the logs never see the answer', async (t) => {
  t.after(() => mock.timers.reset());
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const s = await setup();
    assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { drained: 'empty' })).status, 200);
    s.env.ENCRYPTION_KEY = undefined;
    assert.equal((await s.req(tcPath(s.maya.id), 'PUT', { drained: 'empty' })).status, 500, 'no key: nothing written');
    assert.equal((await s.req(bat(s.maya.id))).status, 500);
    await runNotifications(s.env, at('21:02'));
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  assert.ok(lines.length > 0);
  assert.doesNotMatch(lines.join("\n"), /\bempty\b|drained"/i, "never the answer (the stack may name openDrained)");
});
