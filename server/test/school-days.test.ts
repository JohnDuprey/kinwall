// School days (school-days.ts): the day rules, how a kid's day is sorted, the last day and the countdown;
// the routes (several calendars, GET /api/school/days, a grown-up's mark), schoolwork left out on days
// off, and the bus and pickup reminders (school-reminders.ts, notify.ts runSchoolTravel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classifyDay, DEFAULT_DAY_RULES, eventDays, lastDayOf, matchRules, schoolDaysLeft, type KidDays } from '../src/school-days.ts';
import { dueTravel, travelLegs } from '../src/school-reminders.ts';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { runNotifications } from '../src/notify.ts';

const tz = 'America/New_York', rules = DEFAULT_DAY_RULES;
const allDay = (title: string, start: string, end: string) => ({ title, start, end, allDay: true });
const kid = (over: Partial<KidDays> = {}): KidDays => ({ schoolDays: [1, 2, 3, 4, 5], yearStart: '08-15', lastDay: null, events: [], marks: {}, ...over });

test('school days: rules match whole words, any case, and several at once', () => {
  assert.deepEqual([...matchRules('Teacher In-Service (No School)', rules)], ['off']);
  assert.deepEqual([...matchRules('WINTER BREAK', rules)], ['off']);
  assert.deepEqual([...matchRules('Breakfast with Santa', rules)], [], 'Break is a whole word');
  assert.deepEqual([...matchRules('Early release - 12:30 dismissal', rules)], ['half']);
  assert.deepEqual([...matchRules('Last Day of School - Early Dismissal', rules)].sort(), ['half', 'last']);
  assert.deepEqual([...matchRules('Picture day', rules)], []);
});

test('school days: an all-day event covers each day to its end; a timed one its day', () => {
  assert.deepEqual(eventDays(allDay('Winter Break', '2026-12-24', '2026-12-29'), tz), ['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28']);
  assert.deepEqual(eventDays({ title: 'Early Release', start: '2026-11-25T17:30:00Z', end: '2026-11-25T18:00:00Z', allDay: false }, tz), ['2026-11-25']);
});

test('school days: marks win, then summer, weekends, days off and half days', () => {
  const k = kid({
    events: [allDay('Thanksgiving Recess', '2026-11-26', '2026-11-28'), { title: 'Early Dismissal', start: '2026-11-25T17:00:00Z', end: '2026-11-25T17:30:00Z', allDay: false }, allDay('Last Day of School', '2027-06-17', '2027-06-18')],
    marks: { '2026-11-30': 'off', '2026-11-27': 'school' },
  });
  const kind = (d: string) => classifyDay(k, d, rules, tz);
  assert.equal(kind('2026-11-24').kind, 'school');
  assert.deepEqual([kind('2026-11-25').kind, kind('2026-11-25').reason], ['half', 'Early Dismissal']);
  assert.deepEqual([kind('2026-11-26').kind, kind('2026-11-26').reason], ['off', 'Thanksgiving Recess']);
  assert.deepEqual([kind('2026-11-27').kind, kind('2026-11-27').marked], ['school', true], 'a make-up day a grown-up marked');
  assert.equal(kind('2026-11-28').kind, 'weekend');
  assert.equal(kind('2026-11-30').kind, 'off', 'a snow day a grown-up marked');
  assert.equal(kind('2027-06-17').last, true);
  assert.equal(kind('2027-06-18').kind, 'summer');
  assert.equal(kind('2027-08-16').kind, 'school', 'a new school year');
});

test('school days: the last day is the kid’s own, else the year’s last "last day" event, in that school year only', () => {
  const k = kid({ events: [allDay('Last Day of School', '2026-06-12', '2026-06-13'), allDay('Last Day for Students', '2027-06-16', '2027-06-17')] });
  assert.equal(lastDayOf(k, '2026-11-17', rules, tz), '2027-06-16');
  assert.equal(lastDayOf({ ...k, lastDay: '2027-06-10' }, '2026-11-17', rules, tz), '2027-06-10');
  assert.equal(lastDayOf(kid(), '2026-11-17', rules, tz), null);
});

test('school days: the countdown counts school and half days through the last day', () => {
  const k = kid({ lastDay: '2027-06-18', events: [allDay('No School', '2027-06-14', '2027-06-15'), allDay('Half Day', '2027-06-18', '2027-06-19')] });
  // Thu 10, Fri 11, (Mon 14 off), Tue 15 .. Fri 18 = 6
  assert.deepEqual(schoolDaysLeft(k, '2027-06-10', rules, tz), { lastDay: '2027-06-18', left: 6 });
  assert.equal(schoolDaysLeft(k, '2027-06-19', rules, tz), null);
  assert.equal(schoolDaysLeft(kid(), '2027-06-10', rules, tz), null);
});

test('school travel: kids on one bus at one time share a leg; days off, weekends and missing times have none', () => {
  const kids = [
    { memberId: 'maya', toSchoolBy: 'bus', toSchoolTime: '07:40', fromSchoolBy: 'bus', fromSchoolTime: '15:10', halfFromSchoolTime: '12:10' },
    { memberId: 'leo', toSchoolBy: 'bus', toSchoolTime: '07:40', fromSchoolBy: 'alex', fromSchoolTime: '15:00', halfFromSchoolTime: null },
    { memberId: 'sam', toSchoolBy: 'bus', toSchoolTime: '07:40', fromSchoolBy: null, fromSchoolTime: null, halfFromSchoolTime: null },
  ];
  const lead = { bus: 10, pickup: 15 };
  const school = travelLegs(kids, new Map([['maya', 'school'], ['leo', 'school'], ['sam', 'off']]), '2026-11-17', lead);
  assert.deepEqual(school.map(l => [l.leg, l.by, l.time, l.kidIds.join('+'), l.half]), [['to', 'bus', '07:40', 'maya+leo', false], ['from', 'bus', '15:10', 'maya', false], ['from', 'alex', '15:00', 'leo', false]]);
  const half = travelLegs(kids, new Map([['maya', 'half'], ['leo', 'half']]), '2026-11-25', lead);
  assert.deepEqual(half.filter(l => l.leg === 'from').map(l => [l.by, l.time, l.half]), [['bus', '12:10', true]], 'no half-day time for Leo: no reminder home');
  assert.deepEqual(travelLegs(kids, new Map([['maya', 'weekend'], ['leo', 'summer']]), '2026-11-21', lead), []);
  assert.deepEqual(travelLegs(kids, new Map([['maya', 'school']]), '2026-11-17', { bus: null, pickup: 15 }), [], 'bus reminders off');
  assert.deepEqual(dueTravel(school, '07:29').length, 0);
  assert.deepEqual(dueTravel(school, '07:30').map(l => l.key), ['school-travel:2026-11-17:to:bus:07:40']);
  assert.deepEqual(dueTravel(school, '14:45').map(l => l.by), ['alex']);
  assert.deepEqual(dueTravel(school, '07:40').length, 0, 'not after the time');
});

// ---- Through the API ----------------------------------------------------------------------------

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx as never);
    return { status: res.status, json: (await res.json()) as any };
  };
  const features = (await req('/api/settings')).json.features;
  await req('/api/settings', 'PATCH', { features: { ...features, school: true } });
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#336699', grownUp: true })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#339966' })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#996633' })).json;
  const wall = (await req('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' })).json;
  await req(`/api/keys/${wall.id}`, 'PATCH', { kind: 'wall', owner: 'shared' });
  const school = (await req('/api/calendars', 'POST', { kind: 'local', name: 'Lincoln Elementary' })).json;
  const district = (await req('/api/calendars', 'POST', { kind: 'local', name: 'District' })).json;
  const event = async (calendarId: string, title: string, start: string, end: string) => assert.equal((await req('/api/events', 'POST', { calendarId, title, start, end, allDay: true, reminders: [] })).status, 201);
  return { env, req, alex, maya, leo, wallKey: wall.key as string, school, district, event };
}

test('school days: several calendars per kid, the days they make, a grown-up’s mark and the countdown', async () => {
  const t = await setup();
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', calendarIds: [t.school.id, 'nope'] })).status, 400);
  const kid = (await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', calendarIds: [t.school.id, t.district.id], halfDayEnd: '12:00', halfFromSchoolTime: '12:20', lastDay: '2027-06-18' })).json;
  assert.deepEqual([kid.calendarIds, kid.halfDayEnd, kid.halfFromSchoolTime, kid.lastDay], [[t.school.id, t.district.id], '12:00', '12:20', '2027-06-18']);
  await t.event(t.school.id, 'Early Release', '2026-11-25', '2026-11-26');
  await t.event(t.district.id, 'Thanksgiving Recess', '2026-11-26', '2026-11-28');
  const days = async (key = ADMIN) => (await t.req('/api/school/days?from=2026-11-24&to=2026-11-30', 'GET', undefined, key)).json;
  const kinds = (d: any) => d.days.filter((x: any) => x.memberId === t.maya.id).map((x: any) => x.kind);
  assert.deepEqual(kinds(await days(t.wallKey)), ['school', 'half', 'off', 'off', 'weekend', 'weekend', 'school'], 'a wall reads them');
  assert.equal((await t.req(`/api/school/days/${t.maya.id}/2026-11-30`, 'PUT', { kind: 'off' }, t.wallKey)).status, 403, 'marks are for parents');
  assert.equal((await t.req(`/api/school/days/${t.maya.id}/2026-11-30`, 'PUT', { kind: 'off' })).status, 200);
  assert.equal((await t.req(`/api/school/days/${t.maya.id}/2026-11-27`, 'PUT', { kind: 'school' })).status, 200);
  assert.deepEqual(kinds(await days()), ['school', 'half', 'off', 'school', 'weekend', 'weekend', 'off']);
  await t.req(`/api/school/days/${t.maya.id}/2026-11-27`, 'PUT', { kind: null });
  assert.equal(kinds(await days())[3], 'off', 'clearing a mark goes back to the calendars');
  // A family's own words.
  const settings = (await t.req('/api/settings')).json.school;
  assert.equal(settings.busMinutes, 10);
  assert.equal((await t.req('/api/settings', 'PATCH', { school: { ...settings, rules: [{ words: 'Conference Day', kind: 'off' }] } })).status, 200);
  await t.event(t.school.id, 'Parent Conference Day', '2026-11-24', '2026-11-25');
  assert.deepEqual(kinds(await days()).slice(0, 3), ['off', 'school', 'school'], 'only the family’s rules count now');
  // The countdown, from today to the kid's last day.
  const left = (await days()).left.find((l: any) => l.memberId === t.maya.id);
  assert.equal(left.lastDay, '2027-06-18');
  assert.ok(left.left > 100 && left.left < 200);
  // Leo's last day comes from a district event (back on the default rules): the countdown, then summer after it.
  await t.req('/api/settings', 'PATCH', { school: settings });
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'enrolled', calendarIds: [t.district.id] });
  await t.event(t.district.id, 'Last Day of School - Early Dismissal', '2027-06-16', '2027-06-17');
  const leoLeft = (await days()).left.find((l: any) => l.memberId === t.leo.id);
  assert.equal(leoLeft.lastDay, '2027-06-16');
  const june = (await t.req('/api/school/days?from=2027-06-15&to=2027-06-18')).json.days.filter((d: any) => d.memberId === t.leo.id);
  assert.deepEqual(june.map((d: any) => [d.kind, d.last]), [['school', false], ['half', true], ['summer', false], ['summer', false]]);
  // Export carries the marks and calendars.
  const exported = (await t.req('/api/export')).json;
  assert.deepEqual(exported.schoolDayMarks.map((m: any) => [m.date, m.kind]), [['2026-11-30', 'off']]);
  assert.deepEqual(exported.schoolKids.find((k: any) => k.memberId === t.maya.id).calendarIds, [t.school.id, t.district.id]);
});

test('school days: schoolwork is left out on a day off unless it’s still due on days off or already done', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', calendarIds: [t.school.id] });
  await t.event(t.school.id, 'No School', '2026-11-26', '2026-11-27');
  const lesson = (await t.req('/api/chores', 'POST', { title: 'Math lesson', memberId: t.maya.id, rrule: 'FREQ=DAILY', dueDate: '2026-11-24', schoolSubjectId: 'ss-math' })).json;
  const homework = (await t.req('/api/chores', 'POST', { title: 'Reading log', memberId: t.maya.id, rrule: 'FREQ=DAILY', dueDate: '2026-11-24', schoolSubjectId: 'ss-reading', schoolKind: 'homework', schoolDaysOff: true })).json;
  const dishes = (await t.req('/api/chores', 'POST', { title: 'Dishes', memberId: t.maya.id, rrule: 'FREQ=DAILY', dueDate: '2026-11-24' })).json;
  assert.equal(homework.schoolDaysOff, true);
  const day = async (d: string) => (await t.req(`/api/chores/day?date=${d}`)).json.map((c: any) => c.title).sort();
  assert.deepEqual(await day('2026-11-25'), ['Dishes', 'Math lesson', 'Reading log']);
  assert.deepEqual(await day('2026-11-26'), ['Dishes', 'Reading log'], 'no school: the lesson is left out, the homework stays');
  await t.req(`/api/chores/${lesson.id}/complete`, 'POST', { date: '2026-11-26' });
  assert.deepEqual(await day('2026-11-26'), ['Dishes', 'Math lesson', 'Reading log'], 'done anyway: it shows done');
  assert.equal((await t.req(`/api/chores/${homework.id}`, 'PATCH', { schoolDaysOff: false })).json.schoolDaysOff, false);
  assert.ok(dishes.id);
});

test('school travel: one bus reminder for kids on the same bus, once, and none on a day off', async () => {
  const t = await setup();
  for (const k of [t.maya, t.leo]) await t.req(`/api/school/kids/${k.id}`, 'PUT', { mode: 'enrolled', calendarIds: [t.school.id], toSchoolBy: 'bus', toSchoolTime: '07:40', fromSchoolBy: t.alex.id, fromSchoolTime: '15:00' });
  await t.event(t.school.id, 'Teacher In-Service', '2026-11-18', '2026-11-19');
  const read = async () => (await t.env.DB.prepare("SELECT title, body, member_ids FROM notifications WHERE kind = 'reminder' ORDER BY at").all<{ title: string; body: string; member_ids: string }>()).results;
  await runNotifications(t.env, new Date('2026-11-17T07:25:00Z'));
  assert.deepEqual(await read(), [], 'not yet');
  await runNotifications(t.env, new Date('2026-11-17T07:31:00Z'));
  await runNotifications(t.env, new Date('2026-11-17T07:35:00Z'));
  const bus = await read();
  assert.equal(bus.length, 1, 'once, for both kids');
  assert.equal(bus[0].title, '🚌 Bus at 7:40 AM');
  assert.equal(bus[0].body, 'Time to get Maya and Leo to the bus stop.');
  assert.deepEqual(JSON.parse(bus[0].member_ids).sort(), [t.maya.id, t.leo.id, t.alex.id].sort());
  await runNotifications(t.env, new Date('2026-11-17T14:50:00Z'));
  const pickup = (await read())[1];
  assert.deepEqual([pickup.title, pickup.body, JSON.parse(pickup.member_ids)], ['School pickup at 3:00 PM', 'Pick up Maya and Leo from school.', [t.alex.id]]);
  await runNotifications(t.env, new Date('2026-11-18T07:35:00Z'));
  assert.equal((await read()).length, 2, 'no school: no bus reminder');
});
