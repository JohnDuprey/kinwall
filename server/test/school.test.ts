// School (routes/school.ts): off until a family turns it on; parents set up subjects and which kids
// are in school; anyone logs time for one kid or several (one row per kid, one group); a kid whose
// settings ask for approval gets pending rows from a wall or their own device, which count only
// once a parent approves; a kid's device logs only for its kid; the export brings it all back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';

async function setup({ on = true } = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const background: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => background.push(p), passThroughOnException() {}, props: {} };
  const flush = async () => { while (background.length) await Promise.all(background.splice(0)); };
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx as never);
    return { status: res.status, json: (await res.json()) as any };
  };
  const device = async (name: string, kind: 'kid' | 'wall', owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope: 'display' })).json;
    assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  if (on) {
    const features = (await req('/api/settings')).json.features;
    assert.equal((await req('/api/settings', 'PATCH', { features: { ...features, school: true } })).status, 200);
  }
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#336699', grownUp: true })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#339966' })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#996633' })).json;
  const photo = async () => (await (await app.request('/api/photos?family=0', { method: 'POST', body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'image/jpeg', 'X-Photo-Width': '4', 'X-Photo-Height': '3' } }, env, ctx as never)).json() as any).id as string;
  const photoExists = async (id: string) => (await app.request(`/api/photos/${id}/image`, { headers: { Authorization: `Bearer ${ADMIN}` } }, env, ctx as never)).status === 200;
  return { req, flush, photo, photoExists, alex, maya, leo, mayaKey: await device("Maya's tablet", 'kid', maya.id), wallKey: await device('Kitchen wall', 'wall') };
}

test('school: off by default, and every route answers 404 until it is on', async () => {
  const t = await setup({ on: false });
  assert.equal((await t.req('/api/settings')).json.features.school, false);
  for (const p of ['/api/school/subjects', '/api/school/kids', '/api/school/logs', '/api/school/summary']) assert.equal((await t.req(p)).status, 404, p);
  assert.equal((await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id], minutes: 30 })).status, 404);
});

test('school: subjects and kids are for parents; a wall reads them', async () => {
  const t = await setup();
  const subjects = (await t.req('/api/school/subjects')).json;
  assert.deepEqual(subjects.map((s: any) => s.name), ['Math', 'Reading', 'Writing', 'Science', 'History', 'Art', 'Music', 'PE']);
  const latin = await t.req('/api/school/subjects', 'POST', { name: 'Latin', emoji: '🏺', color: '#884422' });
  assert.equal(latin.status, 201);
  assert.equal(latin.json.sort, 8);
  assert.equal((await t.req(`/api/school/subjects/${latin.json.id}`, 'PATCH', { archived: true })).json.archived, true);
  assert.equal((await t.req('/api/school/subjects')).json.length, 8, 'archived ones are left out');
  assert.equal((await t.req('/api/school/subjects?archived=all')).json.length, 9);
  assert.equal((await t.req('/api/school/subjects', 'POST', { name: 'Art 2', color: '#123456' }, t.wallKey)).status, 403);

  const put = await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', grade: '3rd', approveLogs: false });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json, { memberId: t.maya.id, mode: 'enrolled', grade: '3rd', approveLogs: false, dayStart: null, dayEnd: null, schoolDays: [1, 2, 3, 4, 5], calendarId: null, schoolContactId: null, teacherName: null, teacherEmail: null, teacherLink: null, contactIds: [], terms: 3, yearGoalHours: null, yearGoalDays: null, dailyGoalMinutes: null, yearStart: '08-15', toSchoolBy: null, toSchoolTime: null, fromSchoolBy: null, fromSchoolTime: null });
  assert.equal((await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home' }, t.wallKey)).status, 403);
  assert.equal((await t.req('/api/school/kids/nobody', 'PUT', { mode: 'home' })).status, 404);
  assert.deepEqual((await t.req('/api/school/kids', 'GET', undefined, t.wallKey)).json.map((k: any) => k.memberId), [t.maya.id]);
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await t.req('/api/school/kids')).json, []);
});

test('school: one log for several kids, edited and deleted together', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home' });
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home' });
  assert.equal((await t.req('/api/school/logs', 'POST', { memberIds: [t.alex.id], subjectId: 'ss-math', minutes: 30 })).status, 400, 'only kids in school');
  assert.equal((await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id], subjectId: 'nope', minutes: 30 })).status, 400);

  const made = await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id, t.leo.id], subjectId: 'ss-science', date: '2026-11-16', minutes: 30, title: 'Seed jars' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.logs.length, 2);
  const [a, b] = made.json.logs;
  assert.equal(a.groupId, b.groupId);
  assert.deepEqual([a.pending, a.minutes, a.title, a.date], [false, 30, 'Seed jars', '2026-11-16']);

  assert.equal((await t.req(`/api/school/logs/${a.id}?all=1`, 'PATCH', { minutes: 45 })).status, 200);
  assert.equal((await t.req(`/api/school/logs/${b.id}`, 'PATCH', { notes: 'Leo planted beans' })).status, 200);
  const logs = (await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json;
  assert.deepEqual(logs.map((l: any) => [l.minutes, l.notes]).sort(), [[45, null], [45, 'Leo planted beans']]);
  assert.equal((await t.req(`/api/school/logs/${a.id}`, 'PATCH', { minutes: 5 }, t.wallKey)).status, 403, 'parents fix logs');

  const summary = (await t.req('/api/school/summary?from=2026-11-10&to=2026-11-16')).json;
  assert.deepEqual(summary.rows.map((r: any) => [r.memberId, r.subjectId, r.minutes]).sort(), [[t.leo.id, 'ss-science', 45], [t.maya.id, 'ss-science', 45]].sort());

  assert.equal((await t.req(`/api/school/logs/${a.id}?all=1`, 'DELETE')).status, 200);
  assert.deepEqual((await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json, []);
});

test('school: kids log from a wall or their own device; approval holds hours until a parent says yes', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home', approveLogs: true });
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home' });

  assert.equal((await t.req('/api/school/logs', 'POST', { memberIds: [t.leo.id], subjectId: 'ss-pe', minutes: 20 }, t.mayaKey)).status, 403, "Maya's tablet logs only for Maya");
  const mine = await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id], subjectId: 'ss-math', date: '2026-11-16', minutes: 40 }, t.mayaKey);
  assert.equal(mine.status, 201);
  assert.equal(mine.json.logs[0].pending, true);

  const wall = await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id, t.leo.id], subjectId: 'ss-art', date: '2026-11-16', minutes: 30 }, t.wallKey);
  assert.equal(wall.status, 201);
  const byKid = Object.fromEntries(wall.json.logs.map((l: any) => [l.memberId, l.pending]));
  assert.deepEqual(byKid, { [t.maya.id]: true, [t.leo.id]: false }, 'only the kid who needs approval waits');
  assert.equal((await t.req('/api/school/logs', 'POST', { memberIds: [t.leo.id], subjectId: 'ss-art', minutes: 10 })).json.logs[0].pending, false, "a parent's own log never waits");

  const before = (await t.req('/api/school/summary?from=2026-11-16&to=2026-11-16')).json.rows;
  assert.equal(before.some((r: any) => r.memberId === t.maya.id), false, 'pending time does not count');
  assert.equal((await t.req('/api/school/logs?pending=1')).json.length, 2);

  assert.equal((await t.req(`/api/school/logs/${mine.json.logs[0].id}/approve`, 'POST', undefined, t.wallKey)).status, 403);
  assert.equal((await t.req(`/api/school/logs/${mine.json.logs[0].id}/approve`, 'POST')).status, 200);
  const after = (await t.req('/api/school/summary?from=2026-11-16&to=2026-11-16')).json.rows;
  assert.deepEqual(after.filter((r: any) => r.memberId === t.maya.id).map((r: any) => [r.subjectId, r.minutes]), [['ss-math', 40]]);
});

test('school: the export brings subjects, kids and logs back', async () => {
  const a = await setup();
  await a.req(`/api/school/kids/${a.maya.id}`, 'PUT', { mode: 'enrolled', grade: '3rd' });
  await a.req('/api/school/subjects', 'POST', { name: 'Latin', color: '#884422' });
  await a.req('/api/school/logs', 'POST', { memberIds: [a.maya.id], subjectId: 'ss-math', date: '2026-11-16', minutes: 25, notes: 'Times tables' });
  const file = (await a.req('/api/export')).json;
  assert.deepEqual([file.schoolSubjects.length, file.schoolKids.length, file.schoolLogs.length], [9, 1, 1]);

  const b = await setup();
  const imported = await b.req('/api/import', 'POST', file);
  assert.equal(imported.status, 200, JSON.stringify(imported.json));
  assert.equal(imported.json.imported.school, 11);
  assert.equal((await b.req('/api/school/subjects')).json.some((s: any) => s.name === 'Latin'), true);
  const [log] = (await b.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json;
  assert.deepEqual([log.memberId, log.minutes, log.notes], [file.schoolLogs[0].memberId, 25, 'Times tables']);
});

test('school: schoolwork is a chore with a subject; ticking it logs its minutes, undoing takes them back', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home', approveLogs: true });
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home' });
  assert.equal((await t.req('/api/chores', 'POST', { title: 'Math', memberIds: [t.maya.id], schoolSubjectId: 'nope', schoolKind: 'lesson' })).status, 400);
  const made = await t.req('/api/chores', 'POST', { title: 'Math lesson', memberIds: [t.maya.id, t.leo.id], rrule: 'FREQ=DAILY', dueDate: '2026-11-01', schoolSubjectId: 'ss-math', schoolKind: 'lesson', schoolMinutes: 20 });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual([made.json.schoolSubjectId, made.json.schoolKind, made.json.schoolMinutes, made.json.points], ['ss-math', 'lesson', 20, 0]);
  const copies = (await t.req('/api/chores')).json.filter((c: any) => c.groupId === made.json.groupId);
  assert.equal(copies.length, 2);
  const mayaCopy = copies.find((c: any) => c.memberId === t.maya.id), leoCopy = copies.find((c: any) => c.memberId === t.leo.id);

  assert.equal((await t.req(`/api/chores/${mayaCopy.id}`, 'PATCH', { schoolMinutes: 25 })).json.schoolMinutes, 25);
  assert.equal((await t.req('/api/chores')).json.find((c: any) => c.id === leoCopy.id).schoolMinutes, 25, 'the group follows');

  assert.equal((await t.req(`/api/chores/${leoCopy.id}/complete`, 'POST', { date: '2026-11-16' })).status, 200);
  let logs = (await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json;
  assert.deepEqual(logs.map((l: any) => [l.memberId, l.subjectId, l.minutes, l.title, l.pending, l.choreId]), [[t.leo.id, 'ss-math', 25, 'Math lesson', false, leoCopy.id]]);
  assert.equal((await t.req(`/api/chores/${leoCopy.id}/complete`, 'POST', { date: '2026-11-16' })).status, 200, 're-ticking');
  assert.equal((await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json.length, 1, 'logs once');

  // From Maya's tablet: her settings ask for a grown-up, so her time waits; the chore itself is done.
  assert.equal((await t.req(`/api/chores/${mayaCopy.id}/complete`, 'POST', { date: '2026-11-16' }, t.mayaKey)).json.pending, false);
  logs = (await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json;
  assert.equal(logs.find((l: any) => l.memberId === t.maya.id).pending, true);

  assert.equal((await t.req(`/api/chores/${leoCopy.id}/complete?date=2026-11-16`, 'DELETE')).status, 200);
  assert.deepEqual((await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json.map((l: any) => l.memberId), [t.maya.id]);

  // A chore that needs approval logs once a parent approves it.
  const essay = (await t.req('/api/chores', 'POST', { title: 'Essay', memberId: t.leo.id, dueDate: '2026-11-16', needsApproval: true, schoolSubjectId: 'ss-writing', schoolKind: 'homework' })).json;
  assert.equal((await t.req(`/api/chores/${essay.id}/complete`, 'POST', { date: '2026-11-16' }, t.wallKey)).json.pending, true);
  assert.equal((await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json.some((l: any) => l.choreId === essay.id), false);
  assert.equal((await t.req(`/api/chores/${essay.id}/approve`, 'POST', { date: '2026-11-16' })).status, 200);
  assert.equal((await t.req('/api/school/logs?from=2026-11-16&to=2026-11-16')).json.find((l: any) => l.choreId === essay.id).minutes, 30, 'no minutes set: 30');

  const file = (await t.req('/api/export')).json;
  assert.equal(file.chores.find((c: any) => c.id === essay.id).schoolKind, 'homework');
});

test('school: unfinished schoolwork is never a late chore on the Board', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home' });
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await t.req('/api/chores', 'POST', { title: 'Feed the cat', memberId: t.leo.id, dueDate: yesterday });
  await t.req('/api/chores', 'POST', { title: 'Phonics', memberId: t.leo.id, dueDate: yesterday, schoolSubjectId: 'ss-reading', schoolKind: 'lesson' });
  assert.deepEqual((await t.req('/api/board')).json.overdueChores.map((c: any) => c.title), ['Feed the cat']);
});

test('school: a kid who goes to a school has hours, days, a calendar, contacts and terms', async () => {
  const t = await setup();
  const cal = (await t.req('/api/calendars', 'POST', { name: 'Oak Hill', kind: 'local' })).json;
  const office = (await t.req('/api/contacts', 'POST', { kind: 'organization', name: 'Oak Hill Elementary', memberIds: [t.maya.id] })).json;
  assert.ok(cal.id && office.id, JSON.stringify([cal, office]));
  const ride = await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', toSchoolBy: 'bus', toSchoolTime: '07:35', fromSchoolBy: t.alex.id, fromSchoolTime: '15:05' });
  assert.deepEqual([ride.json.toSchoolBy, ride.json.toSchoolTime, ride.json.fromSchoolBy, ride.json.fromSchoolTime], ['bus', '07:35', t.alex.id, '15:05'], 'the bus there, Alex picks her up');
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', toSchoolTime: '7:35am' })).status, 400);
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', fromSchoolBy: t.leo.id })).status, 400, 'a grown-up, not a kid');
  const put = await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', grade: '3rd', dayStart: '08:15', dayEnd: '15:05', schoolDays: [1, 2, 3, 4, 5], calendarId: cal.id, schoolContactId: office.id, teacherName: 'Ms. Patel', contactIds: [], terms: 4 });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.deepEqual([put.json.dayStart, put.json.dayEnd, put.json.schoolDays, put.json.calendarId, put.json.schoolContactId, put.json.teacherName, put.json.terms], ['08:15', '15:05', [1, 2, 3, 4, 5], cal.id, office.id, 'Ms. Patel', 4]);
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', schoolContactId: 'nope' })).status, 400);
  const reach = await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', teacherEmail: 'patel@example.org', teacherLink: 'https://www.classdojo.com/' });
  assert.deepEqual([reach.json.teacherEmail, reach.json.teacherLink], ['patel@example.org', 'https://www.classdojo.com/']);
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', teacherEmail: 'not an email' })).status, 400);
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', teacherLink: 'javascript:alert(1)' })).status, 400);
  const onWall = (await t.req('/api/school/kids', 'GET', undefined, t.wallKey)).json[0];
  assert.deepEqual([onWall.teacherName, onWall.teacherEmail, onWall.teacherLink], ['Ms. Patel', null, null], "a wall gets the teacher's name, not how to reach them");
  assert.equal((await t.req('/api/school/kids', 'GET', undefined, t.mayaKey)).json[0].teacherEmail, null, "nor Maya's tablet");
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', teacherEmail: '' })).json.teacherEmail, null, 'empty clears it');
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', calendarId: 'nope' })).status, 400);
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', contactIds: ['nope'] })).status, 400);
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', dayStart: '8am' })).status, 400);
  const kept = (await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', grade: '4th' })).json;
  assert.deepEqual([kept.dayStart, kept.calendarId, kept.schoolContactId, kept.teacherName, kept.terms, kept.grade, kept.toSchoolTime], ['08:15', cal.id, office.id, 'Ms. Patel', 4, '4th', '07:35'], 'fields left out stay');
  await t.req(`/api/contacts/${office.id}`, 'DELETE');
  assert.equal((await t.req('/api/school/kids')).json[0].schoolContactId, null, 'a deleted contact is no longer the school');
  assert.equal((await t.req('/api/school/kids', 'GET', undefined, t.wallKey)).json[0].dayStart, '08:15', 'a wall sees the hours');
});

test('school: report card grades are for parents only, saved per kid, year, term and subject', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', terms: 3 });
  const save = (b: object, key?: string) => t.req('/api/school/grades', 'PUT', { memberId: t.maya.id, year: 2026, ...b }, key);
  assert.equal((await save({ term: 1, subjectId: 'ss-math', grade: 'A-' })).status, 200);
  assert.equal((await save({ term: 1, subjectId: 'ss-reading', grade: 'A' })).status, 200);
  assert.equal((await save({ term: 1, subjectId: 'ss-math', grade: 'A' })).status, 200, 'changing it');
  assert.equal((await save({ term: 4, subjectId: 'ss-math', grade: 'B' })).status, 400, 'past her terms');
  assert.equal((await save({ term: 1, subjectId: 'nope', grade: 'B' })).status, 400);
  assert.equal((await t.req('/api/school/grades', 'PUT', { memberId: t.alex.id, year: 2026, term: 1, subjectId: 'ss-math', grade: 'A' })).status, 400, 'only kids in school');
  let grades = (await t.req(`/api/school/grades?memberId=${t.maya.id}&year=2026`)).json;
  assert.deepEqual(grades.map((g: any) => [g.term, g.subjectId, g.grade]).sort(), [[1, 'ss-math', 'A'], [1, 'ss-reading', 'A']]);
  assert.equal((await save({ term: 1, subjectId: 'ss-reading', grade: '' })).status, 200, 'empty clears it');
  grades = (await t.req(`/api/school/grades?memberId=${t.maya.id}&year=2026`)).json;
  assert.deepEqual(grades.map((g: any) => g.subjectId), ['ss-math']);

  assert.equal((await t.req(`/api/school/grades?memberId=${t.maya.id}`, 'GET', undefined, t.wallKey)).status, 403, 'never on a wall');
  assert.equal((await t.req(`/api/school/grades?memberId=${t.maya.id}`, 'GET', undefined, t.mayaKey)).status, 403, "nor on Maya's own tablet");
  assert.equal((await save({ term: 2, subjectId: 'ss-math', grade: 'A' }, t.wallKey)).status, 403);

  const file = (await t.req('/api/export')).json;
  assert.equal(file.schoolGrades.length, 1);
  assert.equal(file.schoolKids[0].terms, 3);
});

test('school: a year of records: hours and days against goals, by subject and month, with the portfolio', async () => {
  const t = await setup();
  const kid = await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home', yearGoalHours: 900, yearGoalDays: 180, dailyGoalMinutes: 180 });
  assert.deepEqual([kid.json.yearGoalHours, kid.json.yearGoalDays, kid.json.dailyGoalMinutes], [900, 180, 180]);
  assert.equal((await t.req('/api/school/subjects/ss-math', 'PATCH', { goalHours: 150 })).json.goalHours, 150);
  const jar = await t.photo();
  const log = (date: string, subjectId: string, minutes: number, extra: object = {}) => t.req('/api/school/logs', 'POST', { memberIds: [t.leo.id], subjectId, date, minutes, ...extra });
  await log('2026-09-01', 'ss-math', 60);
  await log('2026-09-01', 'ss-science', 30, { title: 'Seed jars', photoId: jar });
  await log('2026-10-05', 'ss-math', 45);
  await log('2026-06-30', 'ss-math', 99); // last school year
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home', approveLogs: true });
  await t.req('/api/school/logs', 'POST', { memberIds: [t.leo.id], subjectId: 'ss-art', date: '2026-10-06', minutes: 20 }, t.wallKey); // waiting: not counted

  const r = await t.req(`/api/school/records?memberId=${t.leo.id}&year=2026`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.from, r.json.to, r.json.minutes, r.json.days], ['2026-08-15', '2027-08-14', 135, 2]);
  assert.deepEqual(r.json.bySubject, [{ subjectId: 'ss-math', minutes: 105 }, { subjectId: 'ss-science', minutes: 30 }]);
  assert.deepEqual(r.json.byMonth, [{ month: '2026-09', minutes: 90, days: 1 }, { month: '2026-10', minutes: 45, days: 1 }]);
  assert.deepEqual(r.json.photos.map((p: any) => [p.photoId, p.date, p.title, p.subjectId]), [[jar, '2026-09-01', 'Seed jars', 'ss-science']]);
  assert.equal((await t.req(`/api/school/records?memberId=${t.leo.id}&year=2026`, 'GET', undefined, t.wallKey)).status, 403, 'records are for parents');
});

test('school: a log photo or report card photo goes when nothing uses it any more', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', terms: 3 });
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'home' });
  const jar = await t.photo();
  assert.equal((await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id], minutes: 5, photoId: 'nope' })).status, 400);
  const both = (await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id, t.leo.id], subjectId: 'ss-science', minutes: 30, photoId: jar })).json.logs;
  assert.ok(both.every((l: any) => l.photoId === jar), 'both copies share the photo');
  await t.req(`/api/school/logs/${both[0].id}`, 'DELETE');
  assert.equal(await t.photoExists(jar), true, "still on Leo's copy");
  await t.req(`/api/school/logs/${both[1].id}`, 'DELETE');
  assert.equal(await t.photoExists(jar), false, 'the last one took it');

  const card = await t.photo(), card2 = await t.photo();
  assert.equal((await t.req('/api/school/report-cards', 'PUT', { memberId: t.maya.id, year: 2026, term: 1, photoId: card })).status, 200);
  assert.equal((await t.req('/api/school/report-cards', 'PUT', { memberId: t.maya.id, year: 2026, term: 4, photoId: card2 })).status, 400, 'past her terms');
  assert.equal((await t.req('/api/school/report-cards', 'PUT', { memberId: t.maya.id, year: 2026, term: 1, photoId: card2 })).status, 200, 'a new photo');
  assert.equal(await t.photoExists(card), false, 'the replaced one goes');
  const rec = (await t.req(`/api/school/records?memberId=${t.maya.id}&year=2026`)).json;
  assert.deepEqual(rec.reportCards, [{ term: 1, photoId: card2 }]);
  assert.equal((await t.req('/api/school/report-cards', 'PUT', { memberId: t.maya.id, year: 2026, term: 1, photoId: null })).status, 200);
  assert.equal(await t.photoExists(card2), false);
  assert.equal((await t.req('/api/school/report-cards', 'PUT', { memberId: t.maya.id, year: 2026, term: 1, photoId: card2 }, t.wallKey)).status, 403);

  const file = (await t.req('/api/export')).json;
  assert.ok('schoolReportCards' in file);
});

test("school: each kid's school year starts on their own day", async () => {
  const t = await setup();
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', yearStart: '02-30' })).status, 400, 'not a day');
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', yearStart: '08-24' })).json.yearStart, '08-24');
  const log = (date: string) => t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id], subjectId: 'ss-math', date, minutes: 10 });
  await log('2026-08-23'); // the 2025-26 year's last day
  await log('2026-08-24'); // 2026-27's first
  await log('2027-08-23'); // and its last
  const r = (await t.req(`/api/school/records?memberId=${t.maya.id}&year=2026`)).json;
  assert.deepEqual([r.from, r.to, r.minutes, r.days], ['2026-08-24', '2027-08-23', 20, 2]);
  const before = (await t.req(`/api/school/records?memberId=${t.maya.id}&year=2025`)).json;
  assert.deepEqual([before.from, before.to, before.minutes], ['2025-08-24', '2026-08-23', 10]);
});

test('school: the highest report card term with anything saved, so lowering terms can warn first', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', terms: 4 });
  assert.deepEqual((await t.req(`/api/school/kids/${t.maya.id}/terms-used`)).json, { highestTerm: 0 });
  await t.req('/api/school/grades', 'PUT', { memberId: t.maya.id, year: 2025, term: 2, subjectId: 'ss-math', grade: 'B' });
  const card = await t.photo();
  await t.req('/api/school/report-cards', 'PUT', { memberId: t.maya.id, year: 2026, term: 4, photoId: card });
  assert.deepEqual((await t.req(`/api/school/kids/${t.maya.id}/terms-used`)).json, { highestTerm: 4 }, 'any year, grades or report card photos');
  assert.equal((await t.req(`/api/school/kids/${t.maya.id}/terms-used`, 'GET', undefined, t.wallKey)).status, 403);
  // Lowering keeps what was saved; raising again brings it back.
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'enrolled', terms: 3 });
  assert.equal((await t.req(`/api/school/records?memberId=${t.maya.id}&year=2026`)).json.reportCards.length, 1, 'kept');
});


test('school: changing who completed schoolwork moves the time and rechecks approval', async () => {
  const t = await setup();
  for (const kid of [t.maya, t.leo]) await t.req(`/api/school/kids/${kid.id}`, 'PUT', { mode: 'home', approveLogs: kid.id === t.maya.id });
  const chore = (await t.req('/api/chores', 'POST', { title: 'Reading together', dueDate: '2026-11-17', schoolSubjectId: 'ss-reading', schoolMinutes: 25 })).json;
  const complete = (memberId: string, key = ADMIN) => t.req(`/api/chores/${chore.id}/complete`, 'POST', { date: '2026-11-17', memberId }, key);
  await complete(t.leo.id);
  const original = (await t.req('/api/school/logs')).json[0];
  await t.req(`/api/school/logs/${original.id}`, 'PATCH', { minutes: 40, notes: 'A parent corrected the duration' });
  await complete(t.leo.id, t.wallKey);
  assert.equal((await t.req('/api/school/logs')).json[0].minutes, 40, 'retry preserves corrections');
  await complete(t.maya.id, t.wallKey);
  let logs = (await t.req('/api/school/logs')).json;
  assert.equal(logs.length, 1);
  assert.deepEqual([logs[0].memberId, logs[0].pending, logs[0].minutes, logs[0].notes], [t.maya.id, true, 40, 'A parent corrected the duration']);
  await t.req(`/api/school/logs/${original.id}/approve`, 'POST');
  await complete(t.maya.id, t.wallKey);
  assert.equal((await t.req('/api/school/logs')).json[0].pending, false, 'retry does not undo approval');
  await t.req(`/api/chores/${chore.id}`, 'PATCH', { needsApproval: true });
  await complete(t.leo.id, t.wallKey);
  assert.deepEqual((await t.req('/api/school/logs')).json, [], 'a pending chore no longer credits its previous child');
  await t.req(`/api/chores/${chore.id}/approve`, 'POST', { date: '2026-11-17' });
  logs = (await t.req('/api/school/logs')).json;
  assert.deepEqual(logs.map((l: any) => [l.memberId, l.pending]), [[t.leo.id, false]]);
  await t.req(`/api/chores/${chore.id}`, 'PATCH', { needsApproval: false });
  await complete(t.alex.id);
  assert.deepEqual((await t.req('/api/school/logs')).json, [], 'credited to a grown-up (not in school): no kid keeps the time');
});

test('school: disabling School hides schoolwork and refuses ticks without changing saved time', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home' });
  const today = new Date().toISOString().slice(0, 10);
  const schoolwork = (await t.req('/api/chores', 'POST', { title: 'Math lesson', memberId: t.maya.id, dueDate: today, schoolSubjectId: 'ss-math', schoolMinutes: 25, needsApproval: true })).json;
  const ordinary = (await t.req('/api/chores', 'POST', { title: 'Feed the cat', memberId: t.maya.id, dueDate: today })).json;
  await t.req(`/api/chores/${schoolwork.id}/complete`, 'POST', { date: today });
  const schoolOn = (await t.req(`/api/chores/counts?from=${today}&to=${today}`)).json;
  assert.equal(schoolOn.reduce((n: number, c: any) => n + c.total, 0), 1, "the Chores tab's counts leave out schoolwork");
  const before = (await t.req('/api/school/logs')).json;
  const pending = (await t.req('/api/chores', 'POST', { title: 'Writing', memberId: t.maya.id, dueDate: today, schoolSubjectId: 'ss-writing', needsApproval: true })).json;
  await t.req(`/api/chores/${pending.id}/complete`, 'POST', { date: today }, t.wallKey);
  assert.equal((await t.req('/api/chores/pending')).json.length, 1);
  const features = (await t.req('/api/settings')).json.features;
  await t.req('/api/settings', 'PATCH', { features: { ...features, school: false } });
  assert.deepEqual((await t.req('/api/chores')).json.map((c: any) => c.id), [ordinary.id]);
  assert.deepEqual((await t.req(`/api/chores/day?date=${today}`)).json.map((c: any) => c.id), [ordinary.id]);
  const counts = (await t.req(`/api/chores/counts?from=${today}&to=${today}`)).json;
  assert.equal(counts.reduce((n: number, c: any) => n + c.total, 0), 1);
  const board = (await t.req('/api/board')).json;
  assert.equal(board.chores.reduce((n: number, c: any) => n + c.total, 0), 1);
  const snapshot = (await t.req(`/api/snapshot?member=${t.maya.id}&range=day`)).json;
  assert.equal(JSON.stringify(snapshot).includes('Math lesson'), false);
  assert.equal((await t.req(`/api/chores/${schoolwork.id}/complete`, 'POST', { date: today }, t.wallKey)).status, 404);
  assert.equal((await t.req(`/api/chores/${schoolwork.id}/complete?date=${today}`, 'DELETE')).status, 404);
  assert.equal((await t.req('/api/chores', 'POST', { title: 'Science', schoolSubjectId: 'ss-science' })).status, 400);
  assert.deepEqual((await t.req('/api/chores/pending')).json, []);
  assert.equal((await t.req(`/api/chores/${pending.id}/approve`, 'POST', { date: today })).status, 404);
  const routine = await t.req(`/api/routine-mode/${t.maya.id}`);
  assert.equal(routine.status, 200);
  assert.deepEqual(routine.json.availableChores.map((c: any) => c.id), [ordinary.id]);
  await t.req('/api/settings', 'PATCH', { features });
  assert.deepEqual((await t.req('/api/school/logs')).json, before, 'turning School off keeps its records');
  assert.equal((await t.req('/api/chores')).json.length, 3);
  assert.equal((await t.req('/api/chores/pending')).json.length, 1);
});

test("school: removing a kid keeps their logged time, grades and report cards under their name", async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.leo.id}`, 'PUT', { mode: 'enrolled' });
  await t.req('/api/school/logs', 'POST', { memberIds: [t.leo.id, t.maya.id], subjectId: 'ss-math', date: '2026-11-16', minutes: 30 }).catch(() => {});
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home' });
  await t.req('/api/school/logs', 'POST', { memberIds: [t.leo.id], subjectId: 'ss-art', date: '2026-11-17', minutes: 20 });
  await t.req('/api/school/grades', 'PUT', { memberId: t.leo.id, year: 2026, term: 1, subjectId: 'ss-math', grade: 'A' });
  const card = await t.photo();
  await t.req('/api/school/report-cards', 'PUT', { memberId: t.leo.id, year: 2026, term: 1, photoId: card });
  assert.equal((await t.req(`/api/members/${t.leo.id}`, 'DELETE')).status, 200);

  const logs = (await t.req('/api/school/logs')).json;
  assert.ok(logs.length >= 1 && logs.every((l: any) => l.memberId === null && l.formerMember === 'Leo'), JSON.stringify(logs));
  const file = (await t.req('/api/export')).json;
  assert.deepEqual(file.schoolGrades.map((g: any) => [g.memberId, g.formerMember, g.grade]), [[null, 'Leo', 'A']]);
  assert.deepEqual(file.schoolReportCards.map((r: any) => [r.memberId, r.formerMember, r.photoId]), [[null, 'Leo', card]]);
  assert.equal(await t.photoExists(card), true, 'the report card photo stays too');
  assert.equal((await t.req('/api/school/kids')).json.some((k: any) => k.memberId === t.leo.id), false, 'no longer in school');

  // And the export brings them back the same way.
  const b = await setup();
  const imported = await b.req('/api/import', 'POST', file);
  assert.equal(imported.status, 200, JSON.stringify(imported.json));
  assert.ok((await b.req('/api/school/logs')).json.some((l: any) => l.memberId === null && l.formerMember === 'Leo'));
});

test('school: time a kid logs that needs a grown-up goes to the bell and grown-ups\' devices', async () => {
  const t = await setup();
  await t.req(`/api/school/kids/${t.maya.id}`, 'PUT', { mode: 'home', approveLogs: true });
  await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id], subjectId: 'ss-science', minutes: 30 }, t.mayaKey);
  await t.flush();
  const bell = (await t.req('/api/notifications')).json;
  const n = bell.find((x: any) => /Maya logged/.test(x.title));
  assert.ok(n, JSON.stringify(bell));
  assert.match(n.title, /30 min of Science/);
  assert.equal(n.url, '/#/school');
  await t.req('/api/school/logs', 'POST', { memberIds: [t.maya.id], subjectId: 'ss-art', minutes: 10 });
  await t.flush();
  assert.equal((await t.req('/api/notifications')).json.filter((x: any) => /logged/.test(x.title)).length, 1, "a grown-up's own log never asks");
});
