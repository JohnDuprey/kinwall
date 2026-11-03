import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueDates } from '../src/routes/chores.ts';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { join } from 'node:path';

test('custom chore API: alternating full weeks, saved anchors, completion and history across DST', async () => {
  const db = openDb(':memory:');
  applyMigrations(db, join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const app = createApp();
  const req = async (path: string, method = 'GET', body?: unknown) => {
    const res = await app.request(path, { method, headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    assert.ok(res.ok, `${method} ${path}: ${res.status}`);
    return await res.json() as any;
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const maya = await req('/api/members', 'POST', { name: 'Maya', color: '#F28DB2' });
  const leo = await req('/api/members', 'POST', { name: 'Leo', color: '#7BCB94' });
  const rrule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR,SA,SU;WKST=MO';
  const first = await req('/api/chores', 'POST', { title: 'Dishes', memberId: maya.id, rrule, dueDate: '2026-10-19', points: 5 });
  const second = await req('/api/chores', 'POST', { title: 'Dishes', memberId: leo.id, rrule, dueDate: '2026-10-26', points: 5 });
  const edited = await req(`/api/chores/${first.id}`, 'PATCH', { title: 'Wash dishes' });
  assert.equal(edited.dueDate, '2026-10-19');
  assert.equal(edited.rrule, rrule);
  for (let offset = 0; offset < 28; offset++) {
    const date = new Date(Date.UTC(2026, 9, 19 + offset)).toISOString().slice(0, 10);
    const day = await req(`/api/chores/day?date=${date}`);
    assert.equal(day.length, 1, date);
    assert.equal(day[0].memberId, Math.floor(offset / 7) % 2 ? leo.id : maya.id, date);
    assert.equal(day[0].id, Math.floor(offset / 7) % 2 ? second.id : first.id, date);
  }
  await req(`/api/chores/${first.id}/complete`, 'POST', { date: '2026-10-19' });
  assert.equal((await req('/api/chores/day?date=2026-10-19'))[0].completed, true);
  assert.equal((await req('/api/chores/day?date=2026-11-02'))[0].completed, false);
});

test('custom chore dates: monthly ordinal, leap day and count with an explicit start', () => {
  const row = { id: 'c', title: 'Dishes', emoji: null, member_id: null, points: 5, due_date: '2026-10-01', due_time: null, active: 1, sort: 0, created_at: '2026-09-01T12:00:00Z', rrule: 'FREQ=MONTHLY;BYDAY=-1SU;COUNT=2' };
  assert.deepEqual([...dueDates(row, '2026-10-01', '2026-12-31', 'America/New_York')], ['2026-10-25', '2026-11-29']);
  assert.deepEqual([...dueDates({ ...row, due_date: '2024-02-29', rrule: 'FREQ=YEARLY' }, '2026-01-01', '2032-12-31', 'America/New_York')], ['2028-02-29', '2032-02-29']);
});

test('custom chore API: multiple monthly choices survive edits and complete only on scheduled dates', async () => {
  const db = openDb(':memory:');
  applyMigrations(db, join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const app = createApp();
  const req = async (path: string, method = 'GET', body?: unknown) => {
    const res = await app.request(path, { method, headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    assert.ok(res.ok, `${method} ${path}: ${res.status}`);
    return await res.json() as any;
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const chore = await req('/api/chores', 'POST', { title: 'Water plants', dueDate: '2026-10-01', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1,5,24', points: 5 });
  const edited = await req(`/api/chores/${chore.id}`, 'PATCH', { title: 'Water indoor plants' });
  assert.equal(edited.rrule, 'FREQ=MONTHLY;BYMONTHDAY=1,5,24');
  for (const date of ['2026-10-01', '2026-10-05', '2026-10-24', '2026-11-01']) {
    assert.equal((await req(`/api/chores/day?date=${date}`)).filter((c: any) => c.id === chore.id).length, 1, date);
  }
  assert.equal((await req('/api/chores/day?date=2026-10-06')).length, 0);
  await req(`/api/chores/${chore.id}/complete`, 'POST', { date: '2026-10-05' });
  assert.equal((await req('/api/chores/day?date=2026-10-05'))[0].completed, true);
  assert.equal((await req('/api/chores/day?date=2026-10-24'))[0].completed, false);

  const rule = 'FREQ=MONTHLY;BYDAY=1MO,-1FR;UNTIL=20261130';
  assert.equal((await req(`/api/chores/${chore.id}`, 'PATCH', { rrule: rule })).rrule, rule);
  for (const date of ['2026-10-05', '2026-10-30', '2026-11-02', '2026-11-27']) {
    assert.equal((await req(`/api/chores/day?date=${date}`)).length, 1, date);
  }
  for (const date of ['2026-10-02', '2026-10-12', '2026-12-07']) assert.equal((await req(`/api/chores/day?date=${date}`)).length, 0, date);

  await req(`/api/chores/${chore.id}`, 'PATCH', { dueDate: '2026-02-01', rrule: 'FREQ=MONTHLY;BYDAY=4MO,-1MO;COUNT=3' });
  assert.equal((await req('/api/chores/day?date=2026-02-23')).length, 1, 'overlapping choices only create one chore');
  assert.equal((await req('/api/chores/day?date=2026-03-30')).length, 1);
  assert.equal((await req('/api/chores/day?date=2026-04-27')).length, 0, 'COUNT counts distinct dates');
});
