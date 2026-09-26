import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueOnDate } from '../src/routes/chores.ts';
import type { ChoreRow } from '../src/routes/chores.ts';

const row = (rrule: string | null, extra: Partial<ChoreRow> = {}): ChoreRow => ({
  id: 'c', title: 't', emoji: null, member_id: null, points: 1, rrule, due_date: null, due_time: null,
  active: 1, sort: 0, created_at: '2026-06-01T12:00:00Z', ...extra, // Mon 2026-06-01
});
const due = (r: ChoreRow, dates: string[], tz = 'America/New_York') => dates.map((d) => dueOnDate(r, d, tz));

test('chores: weekly BYDAY picks only those weekdays', () => {
  // Mon 1 .. Sun 7 June 2026
  const week = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'];
  assert.deepEqual(due(row('FREQ=WEEKLY;BYDAY=MO,WE,FR'), week), [true, false, true, false, true, false, false]);
  // Plain weekly anchors on the creation weekday.
  assert.deepEqual(due(row('FREQ=WEEKLY'), [...week, '2026-06-08']), [true, false, false, false, false, false, false, true]);
});

test('chores: date-only UNTIL is inclusive and ends the series', () => {
  assert.deepEqual(due(row('FREQ=DAILY;UNTIL=20260603'), ['2026-06-02', '2026-06-03', '2026-06-04']), [true, true, false]);
  assert.deepEqual(due(row('FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260608'), ['2026-06-08', '2026-06-10']), [true, false]);
  // West-of-UTC evening creation still anchors on the local day (2026-06-01 local), and UNTIL still holds.
  assert.deepEqual(due(row('FREQ=DAILY;UNTIL=20260601', { created_at: '2026-06-02T02:00:00Z' }), ['2026-06-01', '2026-06-02']), [true, false]);
});

test('chores: a malformed rrule is just not due, never a 500 for the whole day', () => {
  assert.equal(dueOnDate(row('FREQ=NOPE;BYDAY=XX'), '2026-06-01', 'UTC'), false);
});

test('chores: API rejects a malformed rrule with 400', async () => {
  const { createApp } = await import('../src/app.ts');
  const { openDb, applyMigrations } = await import('../src/d1-sqlite.ts');
  const path = await import('node:path');
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const req = (p: string, method: string, body: unknown) =>
    createApp().request(p, { method, body: JSON.stringify(body), headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' } }, env);
  assert.equal((await req('/api/chores', 'POST', { title: 'x', rrule: 'BYDAY=MO' })).status, 400);
  const ok = await req('/api/chores', 'POST', { title: 'x', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261030' });
  assert.equal(ok.status, 201);
  const { id } = await ok.json() as any;
  assert.equal((await req(`/api/chores/${id}`, 'PATCH', { rrule: 'garbage' })).status, 400);
});

test('chores: a linked checklist gates completion (409 until every item is ticked) and a reusable one resets afterwards', async () => {
  const { createApp } = await import('../src/app.ts');
  const { openDb, applyMigrations } = await import('../src/d1-sqlite.ts');
  const path = await import('node:path');
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const req = (p: string, method: string, body?: unknown) =>
    createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' } }, env);
  const json = async (r: Response) => (await r.json()) as any;

  const list = await json(await req('/api/lists', 'POST', { name: 'Clean room', kind: 'reusable' }));
  const items = await json(await req(`/api/lists/${list.id}/items`, 'POST', [{ title: 'Make bed' }, { title: 'Vacuum' }]));

  assert.equal((await req('/api/chores', 'POST', { title: 'x', dueDate: '2026-06-01', listId: 'nope' })).status, 400);
  const chore = await json(await req('/api/chores', 'POST', { title: 'Clean room', dueDate: '2026-06-01', points: 10, listId: list.id }));
  assert.equal(chore.listId, list.id);

  const day = await json(await req('/api/chores/day?date=2026-06-01', 'GET'));
  assert.deepEqual(day[0].checklist, { listId: list.id, name: 'Clean room', total: 2, done: 0 });

  const blocked = await req(`/api/chores/${chore.id}/complete`, 'POST', { date: '2026-06-01' });
  assert.equal(blocked.status, 409);
  assert.equal((await json(blocked)).remaining, 2);

  for (const it of items) await req(`/api/lists/${list.id}/items/${it.id}`, 'PATCH', { done: true });
  assert.equal((await json(await req('/api/chores/day?date=2026-06-01', 'GET')))[0].checklist.done, 2);
  assert.equal((await req(`/api/chores/${chore.id}/complete`, 'POST', { date: '2026-06-01' })).status, 200);

  // Reusable list: back to unticked for next time; the chore itself stays completed for that day.
  const after = await json(await req('/api/chores/day?date=2026-06-01', 'GET'));
  assert.equal(after[0].completed, true);
  assert.equal(after[0].checklist.done, 0);

  // Unlink via PATCH.
  assert.equal((await json(await req(`/api/chores/${chore.id}`, 'PATCH', { listId: null }))).listId, null);
});
