// Input a wall screen or kid's device (a display key) can send must never break reads for the rest
// of the family: event times and repeats are checked on write and bad stored rows are skipped on
// read, event ranges and repeats are bounded, a hidden event is gone by id too, and a tracker
// entry can't be typed to look like sealed health data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { expand, isValidRrule, rruleOccurs } from '../src/recurrence.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const OCTOBER = '/api/events?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const json = async (p: string, method = 'GET', body?: unknown, key = ADMIN_KEY) => {
    const res = await app.request(p, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).body;
  const wall = (await json('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' })).body.key as string;
  const event = (extra: object, key = wall) =>
    json('/api/events', 'POST', { calendarId: cal.id, title: 'Soccer', start: '2026-10-02T16:00:00Z', end: '2026-10-02T17:00:00Z', allDay: false, ...extra }, key);
  // A row as an older server, an import or a sync could have left it.
  const stored = (id: string, cols: { start: string; end: string; all_day?: number; rrule?: string | null; travel_minutes?: number | null }) =>
    db.prepare('INSERT INTO events (id, calendar_id, title, start, end, all_day, rrule, member_ids, updated_at, travel_minutes) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, cal.id, `Stored ${id}`, cols.start, cols.end, cols.all_day ?? 0, cols.rrule ?? null, '[]', '2026-10-01T00:00:00.000Z', cols.travel_minutes ?? null).run();
  return { json, cal, wall, event, stored, db };
}

test('events: a start, end or repeat that is not a real one is refused on create and edit', async () => {
  const { json, wall, event } = await setup();
  for (const bad of [
    { rrule: 'FREQ=NOPE' },
    { rrule: 'garbage' },
    { start: '2026-10-02Tgarbage', travelMinutes: 15 },
    { end: 'later' },
    { start: '2026-10-02', end: '2026-10-03' }, // a timed event needs a time
    { start: '2026-10-02T16:00:00', end: '2026-10-02T17:00:00' }, // and a UTC offset: an instant, not a wall-clock time
    { start: '2026-02-30T16:00:00Z', end: '2026-03-02T17:00:00Z' }, // no such day
    { allDay: true }, // all-day takes dates
    { allDay: true, start: '2026-02-30', end: '2026-03-01' },
    { allDay: true, start: '2026-10-03', end: '2026-10-02' },
    { start: '2026-10-02T18:00:00Z' }, // ends before it starts
  ]) assert.equal((await event(bad)).status, 400, JSON.stringify(bad));

  // What the app, the phone app and synced calendars use is still fine.
  for (const good of [
    {},
    { start: '2026-10-02T16:00:00.000Z', end: '2026-10-02T17:00:00.000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261030' },
    { start: '2026-10-02T12:00:00-04:00', end: '2026-10-02T13:00:00-04:00' },
    { start: '2026-10-02T16:00:00Z', end: '2026-10-02T16:00:00Z' },
    { allDay: true, start: '2026-10-02', end: '2026-10-03', rrule: 'FREQ=MONTHLY' },
    { allDay: true, start: '2026-10-02', end: '2026-10-02' },
    { rrule: null },
  ]) assert.equal((await event(good)).status, 201, JSON.stringify(good));

  const ev = (await event({})).body;
  const patch = async (body: object) => (await json(`/api/events/${ev.id}`, 'PATCH', body, wall)).status;
  assert.equal(await patch({ rrule: 'FREQ=NOPE' }), 400);
  assert.equal(await patch({ start: '2026-10-02Tgarbage' }), 400);
  assert.equal(await patch({ end: '2026-10-02T15:00:00Z' }), 400, 'before the start it already has');
  assert.equal(await patch({ allDay: true }), 400, 'its times are not dates');
  assert.equal(await patch({ allDay: true, start: '2026-10-02', end: '2026-10-03', rrule: 'FREQ=DAILY;COUNT=3' }), 200);
  assert.equal(await patch({ title: 'Soccer practice' }), 200);
  assert.equal((await json(OCTOBER)).status, 200);
});

test('events: one bad stored event is left out, never a 500 for the whole range, the board or the event itself', async () => {
  const { json, wall, event, stored } = await setup();
  const now = new Date();
  const soon = new Date(now.getTime() + 3600e3).toISOString();
  await event({ title: 'Science Fair', start: soon, end: new Date(now.getTime() + 7200e3).toISOString() });
  await stored('bad-rrule', { start: soon, end: soon, rrule: 'FREQ=NOPE' });
  await stored('bad-start', { start: `${soon.slice(0, 10)}Tgarbage`, end: soon, travel_minutes: 15 });
  await stored('bad-end', { start: soon, end: 'later', rrule: 'FREQ=DAILY' });
  await stored('bad-day', { start: 'someday', end: 'someday', all_day: 1, rrule: 'FREQ=DAILY' });
  await stored('bad-single-day', { start: `${soon.slice(0, 10)}-oops`, end: 'someday', all_day: 1 });

  const range = `/api/events?from=${new Date(now.getTime() - 86400e3).toISOString()}&to=${new Date(now.getTime() + 2 * 86400e3).toISOString()}`;
  for (const key of [ADMIN_KEY, wall]) {
    const list = await json(range, 'GET', undefined, key);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((e: any) => e.title), ['Science Fair']);
    assert.equal((await json('/api/board', 'GET', undefined, key)).status, 200);
  }
  assert.equal((await json(`${range}&includeHidden=true`)).status, 200);
  // Still there by id, so a parent can fix or delete it.
  const one = await json('/api/events/bad-start');
  assert.deepEqual([one.status, one.body.leaveAt], [200, null]);
  assert.equal((await json('/api/events/bad-start', 'DELETE')).status, 200);
});

test('events: repeats finer than daily are refused, and never expanded when one is already stored', async () => {
  const { json, wall, event, stored } = await setup();
  for (const rrule of ['FREQ=SECONDLY', 'FREQ=MINUTELY', 'FREQ=HOURLY', 'FREQ=DAILY;BYHOUR=1,2,3', 'FREQ=DAILY;BYMINUTE=0,1', 'FREQ=DAILY;BYSECOND=0,1']) {
    assert.equal(isValidRrule(rrule), false, rrule);
    assert.equal((await event({ rrule })).status, 400, rrule);
  }
  const ev = (await event({ rrule: 'FREQ=DAILY' })).body;
  assert.equal((await json(`/api/events/${ev.id}`, 'PATCH', { rrule: 'FREQ=SECONDLY' }, wall)).status, 400);

  await stored('every-second', { start: '2026-10-02T00:00:00.000Z', end: '2026-10-02T00:00:01.000Z', rrule: 'FREQ=SECONDLY' });
  const day = await json('/api/events?from=2026-10-02T00:00:00Z&to=2026-10-03T00:00:00Z');
  assert.equal(day.status, 200);
  assert.deepEqual(day.body.map((e: any) => e.title), ['Soccer']);
});

test('events: a series gives at most 1,000 instances per read', () => {
  const instances = expand('FREQ=DAILY', '2000-01-01T16:00:00.000Z', '2000-01-01T17:00:00.000Z', false, 'UTC', new Date('2000-01-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z'));
  assert.equal(instances.length, 1000);
  assert.equal(instances[0].start, '2000-01-01T16:00:00.000Z');
});

test('events: from and to must be dates, at most 400 days apart', async () => {
  const { json, wall, event } = await setup();
  await event({ rrule: 'FREQ=DAILY' });
  const get = (qs: string) => json(`/api/events?${qs}`, 'GET', undefined, wall);
  assert.equal((await get('from=x&to=2026-11-01')).status, 400);
  assert.equal((await get('from=2026-10-01&to=y')).status, 400);
  const wide = await get('from=1900-01-01T00:00:00Z&to=2300-01-01T00:00:00Z');
  assert.equal(wide.status, 400);
  assert.match(wide.body.error, /400 days/);
  assert.equal((await get('from=2026-01-01&to=2027-02-06')).status, 400, '401 days');

  const year = await get('from=2026-01-01&to=2027-02-05'); // 400 days: a year view with room to spare
  assert.equal(year.status, 200);
  assert.equal(year.body.length, 126, 'October 2 through February 4');
  assert.equal((await get('from=2026-10-01T00:00:00.000Z&to=2026-11-12T00:00:00.000Z')).body.length, 41);
  assert.deepEqual((await get('from=2026-11-01&to=2026-10-01')).body, [], 'a backwards range is just empty');
});

test("hidden events: gone by id for wall screens and kids' devices, with their notes and linked tasks", async () => {
  const { json, cal, wall, event } = await setup();
  const fair = (await event({ title: 'Surprise party', description: 'Shh' }, ADMIN_KEY)).body;
  const list = (await json('/api/lists', 'POST', { name: 'To do', kind: 'todo' })).body;
  await json(`/api/lists/${list.id}/items`, 'POST', { title: 'Order the cake', eventId: fair.id });
  await json('/api/notes', 'POST', { target: `event:${fair.id}`, body: 'Balloons are in the garage' });

  const seen = async (key: string) => {
    const [one, items, notes] = await Promise.all([`/api/events/${fair.id}`, `/api/events/${fair.id}/items`, `/api/notes?target=event:${fair.id}`].map((p) => json(p, 'GET', undefined, key)));
    return [one.status, one.body.title ?? null, items.body.length, notes.body.length];
  };
  assert.deepEqual(await seen(wall), [200, 'Surprise party', 1, 1]);

  await json(`/api/events/${fair.id}/hidden`, 'PUT', { scope: 'occurrence' });
  assert.deepEqual(await seen(wall), [404, null, 0, 0]);
  assert.deepEqual(await seen(ADMIN_KEY), [200, 'Surprise party', 1, 1], 'parents still reach it');
  assert.equal((await json(`/api/events/${fair.id}`, 'PATCH', { title: 'Found it' }, wall)).status, 404);
  assert.equal((await json(`/api/events/${fair.id}`, 'DELETE', undefined, wall)).status, 404);
  assert.equal((await json(`/api/events/${fair.id}`)).body.title, 'Surprise party');

  await json(`/api/events/${fair.id}/hidden?scope=occurrence`, 'DELETE');
  assert.deepEqual(await seen(wall), [200, 'Surprise party', 1, 1], 'shown again');

  // A calendar filter hides it the same way.
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: { mode: 'except', keywords: ['surprise'], allDay: 'any', categoryIds: [] } });
  assert.deepEqual(await seen(wall), [404, null, 0, 0]);
  assert.deepEqual(await seen(ADMIN_KEY), [200, 'Surprise party', 1, 1]);
});

test('hidden events: one hidden occurrence leaves a repeating event reachable; its hidden series does not', async () => {
  const { json, wall, event } = await setup();
  const piano = (await event({ title: 'Piano', rrule: 'FREQ=WEEKLY;COUNT=3' }, ADMIN_KEY)).body;
  const status = async (key = wall) => (await json(`/api/events/${piano.id}`, 'GET', undefined, key)).status;
  await json(`/api/events/${piano.id}/hidden`, 'PUT', { scope: 'occurrence', occurrenceStart: '2026-10-09T16:00:00.000Z' });
  assert.equal(await status(), 200, 'the other weeks still show');
  await json(`/api/events/${piano.id}/hidden`, 'PUT', { scope: 'series' });
  assert.equal(await status(), 404);
  assert.equal(await status(ADMIN_KEY), 200);
});

test('trackers: a title typed to look sealed is refused, and one already stored never breaks the list or the export', async () => {
  const { json, wall, db } = await setup();
  const maya = (await json('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' })).body;
  const fake = 'enc:v1:AAAA:AAAA';
  assert.equal((await json('/api/trackers', 'POST', { kind: 'reading', title: fake, data: {} }, wall)).status, 400);
  assert.equal((await json('/api/trackers', 'POST', { kind: 'memory', title: fake, data: { text: 'Beach day' } }, wall)).status, 400);
  assert.equal((await json('/api/trackers', 'POST', { kind: 'health', memberId: maya.id, title: fake, data: { type: 'checkup' } })).status, 400);
  const book = (await json('/api/trackers', 'POST', { kind: 'reading', memberId: maya.id, title: 'Matilda', data: {} }, wall)).body;
  assert.equal((await json(`/api/trackers/${book.id}`, 'PATCH', { title: fake }, wall)).status, 400);
  assert.equal((await json(`/api/trackers/${book.id}`)).body.title, 'Matilda');

  // Stored before this check (or written straight to the database): read as the text it is.
  await db.prepare("INSERT INTO tracker_entries (id, kind, member_id, date, title, data, created_at, updated_at) VALUES ('old', 'reading', ?, '2026-01-01', ?, '{}', '', '')").bind(maya.id, fake).run();
  for (const p of ['/api/trackers', '/api/trackers?kind=reading', '/api/trackers?q=matilda', '/api/trackers/old', '/api/export']) {
    assert.equal((await json(p)).status, 200, p);
  }
  assert.equal((await json('/api/trackers', 'GET', undefined, wall)).status, 200);
  assert.equal((await json('/api/trackers/old')).body.title, fake);
  assert.equal((await json('/api/trackers/old', 'PATCH', { title: 'The BFG' }, wall)).body.title, 'The BFG');

  // An export file can't bring one in either.
  const file = (await json('/api/export')).body;
  file.trackers[0].title = fake;
  const other = await setup();
  assert.equal((await other.json('/api/import', 'POST', file)).status, 400);
});

test('events: a repeat that can never occur is refused, and costs nothing to read when one is already stored', () => {
  const week = [new Date('2026-10-01T00:00:00Z'), new Date('2026-10-08T00:00:00Z')] as const;
  // Day-by-day rules narrowed to days that may never come aren't rules here: refused on write, never expanded on read.
  for (const rule of ['FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30', 'FREQ=WEEKLY;BYMONTH=2;BYMONTHDAY=30', 'FREQ=DAILY;BYMONTH=13', 'FREQ=DAILY;BYDAY=MO;BYSETPOS=3', 'FREQ=DAILY;BYYEARDAY=366;BYMONTH=1', 'FREQ=DAILY;BYWEEKNO=60']) {
    const began = performance.now();
    assert.equal(isValidRrule(rule), false, rule);
    assert.deepEqual(expand(rule, '2026-10-01', '2026-10-02', true, 'UTC', ...week), [], rule);
    assert.ok(performance.now() - began < 250, `${rule} took ${Math.round(performance.now() - began)} ms`);
  }
  // What the app makes still works: weekdays, months, the 15th or the 2nd Tuesday of a month.
  for (const rule of ['FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,WE', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'FREQ=DAILY;BYMONTH=6,7,8', 'FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=MONTHLY;BYDAY=+2TU', 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1', 'FREQ=YEARLY']) assert.equal(isValidRrule(rule), true, rule);
  // The range's end doesn't change what a rule with its own COUNT or UNTIL gives.
  assert.equal(expand('FREQ=DAILY;COUNT=3', '2026-10-06', '2026-10-07', true, 'UTC', ...week).length, 2);
  assert.equal(expand('FREQ=DAILY;UNTIL=20261003T000000Z', '2026-10-01', '2026-10-02', true, 'UTC', ...week).length, 3);
});

test('events and chores: a monthly or yearly repeat that never happens is refused, and one already stored costs one scan', async () => {
  const { json, event, stored } = await setup();
  const NEVER = 'That repeat never happens. Check the day and month.';
  const refused = async (res: ReturnType<typeof event>) => {
    const r = await res;
    assert.equal(r.status, 400);
    assert.equal(r.body.error, NEVER);
  };
  // Never-occurring shapes: on their own, and ones that depend on the day the event starts.
  for (const [rrule, start] of [
    ['FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30', '2026-10-02T16:00:00Z'],
    ['FREQ=MONTHLY;BYDAY=MO;BYSETPOS=6', '2026-10-02T16:00:00Z'],
    ['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30', '2026-10-02T16:00:00Z'],
    ['FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31', '2026-10-02T16:00:00Z'],
    ['FREQ=MONTHLY;BYMONTH=2', '2026-10-30T16:00:00Z'], // the 30th of February
  ] as const) {
    const began = performance.now();
    await refused(event({ rrule, start, end: start }));
    console.log(`  write check: ${rrule} on ${start.slice(0, 10)} refused in ${Math.round(performance.now() - began)} ms`);
  }
  // Moving an event with a fine repeat onto a day the repeat can't use is refused too.
  const made = await event({ rrule: 'FREQ=MONTHLY;BYMONTH=2', start: '2026-10-02T16:00:00Z', end: '2026-10-02T17:00:00Z' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const moved = await json(`/api/events/${made.body.id}`, 'PATCH', { start: '2026-10-30T16:00:00Z', end: '2026-10-30T17:00:00Z' }, ADMIN_KEY);
  assert.equal(moved.status, 400);
  assert.equal(moved.body.error, NEVER);
  assert.equal((await json(`/api/events/${made.body.id}`, 'PATCH', { rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30' }, ADMIN_KEY)).body.error, NEVER);
  assert.equal((await json(`/api/events/${made.body.id}`, 'PATCH', { title: 'Retitled' }, ADMIN_KEY)).status, 200);

  // Chores anchor on the due date.
  for (const body of [
    { rrule: 'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30', dueDate: '2026-10-02' },
    { rrule: 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31', dueDate: '2026-10-02' },
    { rrule: 'FREQ=MONTHLY;BYMONTH=2', dueDate: '2026-10-30' },
  ]) {
    const r = await json('/api/chores', 'POST', { title: 'Water plants', points: 1, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, NEVER);
  }
  const chore = await json('/api/chores', 'POST', { title: 'Water plants', points: 1, rrule: 'FREQ=MONTHLY;BYMONTH=2', dueDate: '2026-10-02' });
  assert.equal(chore.status, 201);
  assert.equal((await json(`/api/chores/${chore.body.id}`, 'PATCH', { dueDate: '2026-10-30' })).body.error, NEVER);
  const lib = await json('/api/chore-library', 'POST', { title: 'Wash windows', points: 3 });
  assert.equal((await json(`/api/chore-library/${lib.body.id}/assign`, 'POST', { date: '2026-10-30', rrule: 'FREQ=MONTHLY;BYMONTH=2' })).body.error, NEVER);

  // Sparse but real repeats are fine, as is one whose repeats are all in the past (judged against its own start).
  for (const [rule, start] of [
    ['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '2026-10-02T16:00:00Z'],
    ['FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', '2096-10-02T16:00:00Z'], // 8 years between, around 2100
    ['FREQ=YEARLY;INTERVAL=10', '2026-10-02T16:00:00Z'],
    ['FREQ=YEARLY;INTERVAL=10;BYMONTH=2', '2026-10-02T16:00:00Z'],
    ['FREQ=MONTHLY;COUNT=1', '2026-10-02T16:00:00Z'],
    ['FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=29;COUNT=1', '2026-10-02T16:00:00Z'],
    ['FREQ=MONTHLY;UNTIL=20200101', '2019-10-02T16:00:00Z'],
    ['FREQ=MONTHLY;BYMONTHDAY=31', '2026-10-31T16:00:00Z'],
  ] as const) {
    assert.equal(rruleOccurs(rule, start, false, 'UTC'), true, `${rule} ${start}`);
    const r = await event({ rrule: rule, start, end: start });
    assert.equal(r.status, 201, `${rule} ${start}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(rruleOccurs('FREQ=MONTHLY;UNTIL=20190101', '2019-10-02T16:00:00Z', false, 'UTC'), false); // ends before it starts

  // Already stored (an older server, import or sync): expanded slowly at most once, then cheap.
  stored('bad1', { start: '2026-10-02', end: '2026-10-03', all_day: 1, rrule: 'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30' });
  stored('bad2', { start: '2026-10-02', end: '2026-10-03', all_day: 1, rrule: 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31' });
  stored('bad3', { start: '2026-10-30T10:00:00.000Z', end: '2026-10-30T11:00:00.000Z', rrule: 'FREQ=MONTHLY;BYMONTH=2' });
  stored('ok1', { start: '2026-10-02', end: '2026-10-03', all_day: 1, rrule: 'FREQ=MONTHLY;BYMONTHDAY=2' });
  const timings: number[] = [];
  for (let i = 0; i < 3; i++) {
    const began = performance.now();
    const res = await json(OCTOBER);
    timings.push(Math.round(performance.now() - began));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.filter((e: any) => e.title.startsWith('Stored')).map((e: any) => e.title), ['Stored ok1']);
  }
  console.log(`  stored bad rules, calendar read ms (1st, 2nd, 3rd): ${timings.join(', ')}`);
  assert.ok(timings[1] < 20 && timings[2] < 20, `later reads took ${timings.join(', ')} ms`);
});
