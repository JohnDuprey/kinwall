// The field rules of to-do app sync (tasks/map.ts): priorities, due dates, and merging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changed, fromGoogleDue, fromMsDue, fromMsImportance, fromTodoistDue, fromTodoistPriority, mergeFields, msImportance, todoistPriority, toGoogleDue, type Priority, type TaskFields } from '../src/tasks/map.ts';

test('task map: Todoist priority is numbered backwards (4 = P1) and maps one to one', () => {
  assert.equal(todoistPriority('urgent'), 4); // red P1
  assert.equal(todoistPriority('high'), 3); // P2
  assert.equal(todoistPriority('low'), 2); // P3
  assert.equal(todoistPriority('normal'), 1); // P4, no priority: Todoist's default is Kinwall's
  for (const p of ['low', 'normal', 'high', 'urgent'] as Priority[]) assert.equal(fromTodoistPriority(todoistPriority(p)), p);
  assert.equal(fromTodoistPriority(undefined), 'normal');
});

test('task map: Microsoft To Do has three levels, urgent goes as high', () => {
  assert.equal(msImportance('urgent'), 'high');
  assert.equal(msImportance('low'), 'low');
  assert.equal(fromMsImportance('high'), 'high');
  assert.equal(fromMsImportance('normal'), 'normal');
  assert.equal(fromMsImportance(undefined), 'normal');
});

test('task map: Todoist due dates, all-day, floating and fixed times', () => {
  assert.equal(fromTodoistDue(null, 'UTC'), null);
  assert.equal(fromTodoistDue({ date: '2026-10-20' }, 'America/New_York'), '2026-10-20');
  // A floating time is the day as written, whatever the zone.
  assert.equal(fromTodoistDue({ date: '2026-10-20T23:30:00' }, 'Asia/Tokyo'), '2026-10-20');
  // A fixed time is the day it falls on at home: 02:00Z on the 21st is still the 20th in New York.
  assert.equal(fromTodoistDue({ date: '2026-10-21T02:00:00Z' }, 'America/New_York'), '2026-10-20');
  assert.equal(fromTodoistDue({ date: '2026-10-21', datetime: '2026-10-21T02:00:00.000000Z' }, 'America/New_York'), '2026-10-20');
  assert.equal(fromTodoistDue({ date: '2026-10-20T23:00:00+00:00' }, 'Europe/Berlin'), '2026-10-21');
});

test('task map: Google and Microsoft keep a day, never moved by the time zone', () => {
  assert.equal(fromGoogleDue('2026-10-20T00:00:00.000Z'), '2026-10-20');
  assert.equal(toGoogleDue('2026-10-20'), '2026-10-20T00:00:00.000Z');
  assert.equal(toGoogleDue(null), null);
  assert.equal(fromMsDue({ dateTime: '2026-10-20T00:00:00.0000000' }), '2026-10-20');
  assert.equal(fromMsDue(null), null);
});

const item = (over: Partial<TaskFields> = {}): TaskFields => ({ title: 'Rake leaves', notes: null, due: null, done: false, priority: 'normal', ...over });

test('task map: merging takes each side’s own changes, field by field', () => {
  const base = item();
  const local = item({ title: 'Rake the leaves' });
  const remote = item({ done: true, due: '2026-10-20' });
  assert.deepEqual(mergeFields(base, local, remote, false), item({ title: 'Rake the leaves', done: true, due: '2026-10-20' }));
});

test('task map: a field changed on both sides goes to the side changed last (a tie is Kinwall’s)', () => {
  const base = item();
  const local = item({ title: 'Kinwall title' });
  const remote = item({ title: 'App title' });
  assert.equal(mergeFields(base, local, remote, true).title, 'Kinwall title');
  assert.equal(mergeFields(base, local, remote, false).title, 'App title');
  // Never synced (paired by title): the same rule for every field that differs.
  assert.deepEqual(mergeFields(null, item({ notes: 'a' }), item({ notes: 'b', due: '2026-10-21' }), false), item({ notes: 'b', due: '2026-10-21' }));
  // ...but a field set on one side only is kept, whichever is newer.
  assert.deepEqual(mergeFields(null, item({ priority: 'high' }), item({ notes: 'Two' }), false), item({ priority: 'high', notes: 'Two' }));
});

test('task map: only the fields an app keeps are merged, and changed() lists the differences', () => {
  const merged = mergeFields(item(), item({ priority: 'high' }), item({ priority: null }), false, ['title', 'notes', 'due', 'done']);
  assert.equal(merged.priority, 'high');
  assert.deepEqual(changed(item(), item({ title: 'X', done: true })), { title: 'X', done: true });
});
