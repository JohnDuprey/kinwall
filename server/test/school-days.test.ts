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
import { nextSchoolTravelAt, runNotifications, runSchoolReminders } from '../src/notify.ts';

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

test('school days: numeric and written half days use the saved Half Day rule', () => {
  const saved = [{ words: 'Half Day', kind: 'half' as const }];
  for (const title of ['Half Day', 'Half-day', '1/2 Day', '1 / 2 DAY', '½ Day', '1⁄2-day']) {
    assert.deepEqual([...matchRules(title, saved)], ['half'], title);
  }
  assert.deepEqual([...matchRules('1/20 Day', saved)], []);
  assert.deepEqual([...matchRules('1/2 Day', [])], [], 'a removed rule stays removed');
});

test('school days: half days win over days off in one title or across calendars', () => {
  const date = '2026-12-23', end = '2026-12-24';
  for (const title of ['Holiday Recess Begins - 1/2 Day', '1/2 Day - Professional Development In-Service', 'Holiday Recess Begins - Early Release', '1/2 Day for Grades K-8 - Parent Conferences']) {
    for (const events of [[allDay(title, date, end), allDay('Holiday Event', date, end)], [allDay('Holiday Event', date, end), allDay(title, date, end)]]) {
      const k = kid({ events });
      assert.deepEqual(classifyDay(k, date, rules, tz), { date, kind: 'half', reason: title, last: false, marked: false }, title);
      assert.equal(classifyDay({ ...k, marks: { [date]: 'off' } }, date, rules, tz).kind, 'off', 'a parent can still mark a closure');
    }
  }
  assert.equal(classifyDay(kid({ events: [allDay('No School - Holiday Recess', date, end)] }), date, rules, tz).kind, 'off');
});

test('school days: an all-day event covers each day to its end; a timed one its day', () => {
  assert.deepEqual(eventDays(allDay('Winter Break', '2026-12-24', '2026-12-29'), tz), ['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28']);
  assert.deepEqual(eventDays({ title: 'Early Release', start: '2026-11-25T17:30:00Z', end: '2026-11-25T18:00:00Z', allDay: false }, tz), ['2026-11-25']);
});

test('school days: marks win, then summer, weekends, half days and days off', () => {
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

test('school days API: existing saved rules recognize half days and keep schoolwork due', async () => {
  const t = await setup();
  const school = (await t.req('/api/settings')).json.school;
  assert.equal(school.rules.some((r: any) => r.words === '1/2 Day'), false, 'no settings rewrite needed');
  await t.req('/api/settings', 'PATCH', { school });
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', calendarIds: [t.school.id, t.district.id], lastDay: '2027-06-18' });
  await t.event(t.school.id, 'Holiday Event', '2026-12-23', '2026-12-24');
  await t.event(t.district.id, 'Holiday Recess Begins - 1/2 Day', '2026-12-23', '2026-12-24');
  await t.event(t.district.id, 'No School - Holiday Recess', '2026-12-24', '2026-12-25');
  const work = (await t.req('/api/chores', 'POST', { title: 'Reading lesson', memberId: t.maya.id, dueDate: '2026-12-23', rrule: 'FREQ=DAILY', schoolSubjectId: 'ss-reading' })).json;
  const days = (await t.req('/api/school/days?from=2026-12-23&to=2026-12-24')).json.days.filter((d: any) => d.memberId === t.maya.id);
  assert.deepEqual(days.map((d: any) => [d.kind, d.reason]), [['half', 'Holiday Recess Begins - 1/2 Day'], ['off', 'No School - Holiday Recess']]);
  assert.ok((await t.req('/api/chores/day?date=2026-12-23')).json.some((c: any) => c.id === work.id));
  assert.ok(!(await t.req('/api/chores/day?date=2026-12-24')).json.some((c: any) => c.id === work.id));
  assert.deepEqual((await t.req('/api/settings')).json.school, school, 'classification leaves saved rules untouched');
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
  const counts = (await t.req('/api/chores/counts?from=2026-11-25&to=2026-11-26')).json;
  assert.deepEqual(counts.map((c: any) => [c.date, c.total]), [['2026-11-25', 3], ['2026-11-26', 2]], 'date strip agrees with the cards, including days off');
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

test('away school travel: filter absent children before grouping and exact-wake scheduling', async () => {
  const t = await setup();
  for (const k of [t.maya, t.leo]) await t.req(`/api/school/kids/${k.id}`, 'PUT', { mode: 'enrolled', toSchoolBy: 'bus', toSchoolTime: '07:40', fromSchoolBy: t.alex.id, fromSchoolTime: '15:00' });
  const away = async (memberId: string, from: string, to: string) => {
    const draft = { label: 'Family visit', tripId: null, people: [{ memberId, startDate: from, endDate: to, leaveDayAway: true, returnDayAway: true }], handoffs: [], keepDue: [] };
    const preview = await t.req('/api/away/preview', 'POST', draft);
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    const saved = await t.req('/api/away', 'POST', { ...draft, token: preview.json.token });
    assert.equal(saved.status, 201, JSON.stringify(saved.json));
  };
  await away(t.maya.id, '2026-11-17', '2026-11-18');
  await away(t.leo.id, '2026-11-18', '2026-11-18');
  const before = new Date('2026-11-17T07:20:00Z');
  assert.equal(await nextSchoolTravelAt(t.env, before, new Date('2026-11-17T07:39:00Z')), Date.parse('2026-11-17T07:30:00Z'));
  await runSchoolReminders(t.env, new Date('2026-11-17T07:31:00Z'));
  const notes = (await t.env.DB.prepare("SELECT body, member_ids FROM notifications WHERE kind = 'reminder'").all<{ body: string; member_ids: string }>()).results;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, 'Time to get Leo to the bus stop.');
  assert.deepEqual(JSON.parse(notes[0].member_ids).sort(), [t.leo.id, t.alex.id].sort());
  assert.equal(await nextSchoolTravelAt(t.env, new Date('2026-11-18T07:20:00Z'), new Date('2026-11-18T23:00:00Z')), null, 'all riders away: no exact wake');
  await runSchoolReminders(t.env, new Date('2026-11-18T07:31:00Z'));
  assert.equal((await t.env.DB.prepare("SELECT id FROM notifications WHERE kind = 'reminder'").all()).results.length, 1, 'all riders away: no reminder');
  assert.equal(await nextSchoolTravelAt(t.env, new Date('2026-11-19T07:20:00Z'), new Date('2026-11-19T07:39:00Z')), Date.parse('2026-11-19T07:30:00Z'), 'ordinary schedule resumes after return');
  const driverDraft = {label:'Work trip', people:[{memberId:t.alex.id,startDate:'2026-11-19',endDate:'2026-11-19'}],handoffs:[],keepDue:[]};
  const driverReview = await t.req('/api/away/preview','POST',driverDraft);
  assert.ok(driverReview.json.conflicts.some((c:any)=>c.kind==='driver-away'&&!c.blocking),'ride warning does not require changing a permanent school setting');
  assert.equal((await t.req('/api/away','POST',{...driverDraft,token:driverReview.json.token})).status,201);
  assert.equal(await nextSchoolTravelAt(t.env,new Date('2026-11-19T14:00:00Z'),new Date('2026-11-19T16:00:00Z')),null,'away driver has no pickup exact wake');
  await runSchoolReminders(t.env,new Date('2026-11-19T14:51:00Z'));
  assert.equal((await t.env.DB.prepare("SELECT id FROM notifications WHERE kind='reminder'").all()).results.length,1,'away driver receives no pickup notice');
});

test('board: schoolwork is counted on its own, and a timed one is a row on Today like a chore', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home' });
  const today = new Date().toISOString().slice(0, 10);
  await t.req('/api/chores', 'POST', { title: 'Dishes', memberId: t.maya.id, dueDate: today });
  await t.req('/api/chores', 'POST', { title: 'Math lesson', memberId: t.maya.id, dueDate: today, schoolSubjectId: 'ss-math' });
  await t.req('/api/chores', 'POST', { title: 'Piano', memberId: t.maya.id, dueDate: today, dueTime: '16:00', schoolSubjectId: 'ss-music' });
  const board = (await t.req('/api/board')).json;
  assert.deepEqual(board.chores.map((c: any) => [c.memberId, c.total]), [[t.maya.id, 1]], 'chores leave schoolwork out');
  assert.deepEqual(board.schoolwork.map((c: any) => [c.memberId, c.total, c.remaining]), [[t.maya.id, 2, 2]]);
  assert.deepEqual(board.timedChores.map((c: any) => [c.title, c.school]), [['Piano', true]]);
  assert.deepEqual(board.otherChores.map((c: any) => [c.title, c.school]), [['Math lesson', true], ['Dishes', false]], 'the rest of today, schoolwork first, for Today’s spare room');
});

test('school days: kids at the same school share its hours, calendars and bus times; a pickup stays their own', async () => {
  const t = await setup();
  const school = (await t.req('/api/contacts', 'POST', { name: 'Maple Grove School', phones: [{ label: 'main', value: '555-010-2200' }] })).json;
  const other = (await t.req('/api/contacts', 'POST', { name: 'Hillside Middle' })).json;
  const put = (id: string, body: object) => t.req(`/api/school/kids/${id}`, 'PUT', { mode: 'enrolled', ...body });
  const kid = async (id: string) => (await t.req('/api/school/kids')).json.find((k: any) => k.memberId === id);
  await put(t.maya.id, { schoolContactId: school.id, dayStart: '08:15', dayEnd: '15:05', halfDayEnd: '12:05', calendarIds: [t.school.id], lastDay: '2027-06-11', toSchoolBy: 'bus', toSchoolTime: '07:35', fromSchoolBy: 'bus', fromSchoolTime: '15:25' });
  // Leo joins the same school: he takes its schedule and the bus there, but Alex picks him up.
  await put(t.leo.id, { toSchoolBy: 'bus', fromSchoolBy: t.alex.id, fromSchoolTime: '15:10' });
  await put(t.leo.id, { schoolContactId: school.id });
  let leo = await kid(t.leo.id);
  assert.deepEqual([leo.dayStart, leo.dayEnd, leo.halfDayEnd, leo.calendarIds, leo.lastDay, leo.toSchoolTime, leo.fromSchoolTime], ['08:15', '15:05', '12:05', [t.school.id], '2027-06-11', '07:35', '15:10'], 'the school’s schedule and bus, his own pickup');
  // A change on one kid's card is the school's: both change.
  await put(t.leo.id, { dayEnd: '15:00', calendarIds: [t.school.id, t.district.id] });
  let maya = await kid(t.maya.id);
  assert.deepEqual([maya.dayEnd, maya.calendarIds], ['15:00', [t.school.id, t.district.id]]);
  // The bus time is shared by those on the bus; Leo's pickup isn't Maya's bus.
  await put(t.maya.id, { toSchoolTime: '07:40', fromSchoolTime: '15:20' });
  leo = await kid(t.leo.id);
  assert.deepEqual([leo.toSchoolTime, leo.fromSchoolTime], ['07:40', '15:10']);
  await put(t.leo.id, { fromSchoolTime: '15:15' });
  assert.equal((await kid(t.maya.id)).fromSchoolTime, '15:20', 'a pickup time stays the kid’s own');
  // Leo starts riding the bus home: he takes its time.
  await put(t.leo.id, { fromSchoolBy: 'bus' });
  assert.equal((await kid(t.leo.id)).fromSchoolTime, '15:20');
  // A kid at another school keeps their own.
  await put(t.leo.id, { schoolContactId: other.id, dayEnd: '14:30' });
  maya = await kid(t.maya.id);
  assert.equal(maya.dayEnd, '15:00');
});

test('routine mode: schoolwork blocks free time like a chore, can be picked as a required one, and not on a day off', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled' });
  const today = new Date().toISOString().slice(0, 10);
  const homework = (await t.req('/api/chores', 'POST', { title: 'Reading log', memberId: t.maya.id, rrule: 'FREQ=DAILY', dueDate: today, schoolSubjectId: 'ss-reading', schoolKind: 'homework' })).json;
  const dishes = (await t.req('/api/chores', 'POST', { title: 'Dishes', memberId: t.maya.id, rrule: 'FREQ=DAILY', dueDate: today })).json;
  const policy = { enabled: true, appMode: 'all', start: '00:00', cutoff: '23:59', requiredChoreIds: null, allowedWebsitesOnly: false, allowedWebDomains: [] };
  assert.equal((await t.req(`/api/routine-mode/${t.maya.id}`, 'PUT', policy)).status, 200);
  const state = async () => (await t.req(`/api/routine-mode/${t.maya.id}`)).json;
  let s = await state();
  assert.deepEqual(s.remaining.map((c: any) => c.title).sort(), ['Dishes', 'Reading log'], 'every chore due today, homework too');
  assert.ok(s.availableChores.some((c: any) => c.id === homework.id), 'a parent can pick it');
  // Only the homework required: it alone holds free time until it's done.
  await t.req(`/api/routine-mode/${t.maya.id}`, 'PUT', { ...policy, requiredChoreIds: [homework.id] });
  s = await state();
  assert.deepEqual([s.remaining.map((c: any) => c.title), s.locked], [['Reading log'], true]);
  await t.req(`/api/chores/${homework.id}/complete`, 'POST', { date: today });
  s = await state();
  assert.deepEqual([s.remaining, s.locked], [[], false], 'done: free time');
  // A day with no school: schoolwork that's skipped doesn't hold free time.
  await t.req(`/api/chores/${homework.id}/complete?date=${today}`, 'DELETE');
  await t.req(`/api/school/days/${t.maya.id}/${today}`, 'PUT', { kind: 'off' });
  await t.req(`/api/routine-mode/${t.maya.id}`, 'PUT', policy);
  s = await state();
  assert.deepEqual(s.remaining.map((c: any) => c.title), ['Dishes']);
  assert.ok(dishes.id);
});

test('school travel: a host wakes at the reminder’s exact time, and that wake sends it', async () => {
  const t = await setup();
  for (const k of [t.maya, t.leo]) await t.req(`/api/school/kids/${k.id}`, 'PUT', { mode: 'enrolled', toSchoolBy: 'bus', toSchoolTime: '08:30', fromSchoolBy: t.alex.id, fromSchoolTime: '15:00' });
  const at = (iso: string) => new Date(iso).getTime();
  // 10 minutes before the 8:30 bus (UTC household), not the next 5-minute tick.
  assert.equal(await nextSchoolTravelAt(t.env, new Date('2026-11-17T08:00:00Z'), new Date('2026-11-17T08:23:00Z')), at('2026-11-17T08:20:00Z'));
  assert.equal(await nextSchoolTravelAt(t.env, new Date('2026-11-17T08:00:00Z'), new Date('2026-11-17T08:15:00Z')), null, 'not before the routine tick');
  await runSchoolReminders(t.env, new Date('2026-11-17T08:20:00Z'));
  const notes = (await t.env.DB.prepare("SELECT title FROM notifications WHERE kind = 'reminder'").all<{ title: string }>()).results;
  assert.deepEqual(notes.map(n => n.title), ['🚌 Bus at 8:30 AM'], 'sent on the exact wake');
  // Sent: the next one is the pickup, 15 minutes before 3:00.
  assert.equal(await nextSchoolTravelAt(t.env, new Date('2026-11-17T08:21:00Z'), new Date('2026-11-17T23:00:00Z')), at('2026-11-17T14:45:00Z'));
});
