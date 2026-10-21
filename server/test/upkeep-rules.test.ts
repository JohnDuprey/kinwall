// Home upkeep's dates (upkeep-rules.ts): the three ways a job repeats, month ends, snooze and skip,
// where a job stands today, and the morning notes each owed once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addInterval, dueNotes, nextDue, nextOnDate, scheduledDue, statusOf, suppliesDue, type JobFacts } from '../src/upkeep-rules.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const job = (p: Partial<JobFacts>): JobFacts => ({ repeatKind: 'after', every: 3, unit: 'month', onMonths: [], onDay: null, startOn: null, dueOn: null, headsUpDays: 7, snoozedUntil: null, skippedUntil: null, createdOn: '2026-10-01', ...p });

test('upkeep-rules: the copy in web/ is identical', () => {
  const read = (p: string) => readFileSync(path.join(HERE, p), 'utf8');
  assert.equal(read('../../web/src/upkeep-rules.ts'), read('../src/upkeep-rules.ts'), 'copy server/src/upkeep-rules.ts to web/src/upkeep-rules.ts');
});

test('addInterval keeps the day, or the month\'s last day', () => {
  assert.equal(addInterval('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(addInterval('2028-01-31', 1, 'month'), '2028-02-29', 'a leap year');
  assert.equal(addInterval('2026-11-15', 3, 'month'), '2027-02-15', 'across the year');
  assert.equal(addInterval('2028-02-29', 1, 'year'), '2029-02-28');
  assert.equal(addInterval('2026-10-21', 2, 'week'), '2026-11-04');
  assert.equal(addInterval('2026-10-21', 10, 'day'), '2026-10-31');
});

test('after: from the last time, else the start or the day it was added', () => {
  assert.equal(scheduledDue(job({}), null), '2026-10-01', 'never done: due the day it was added');
  assert.equal(scheduledDue(job({ startOn: '2026-12-01' }), null), '2026-12-01');
  assert.equal(scheduledDue(job({}), '2026-07-10'), '2026-10-10');
  assert.equal(scheduledDue(job({}), '2026-08-02'), '2026-11-02', 'done late: the next one moves too');
  assert.equal(scheduledDue(job({ every: null }), '2026-08-02'), null);
});

test('once: due once, then done', () => {
  assert.equal(scheduledDue(job({ repeatKind: 'once', dueOn: '2026-11-05' }), null), '2026-11-05');
  assert.equal(scheduledDue(job({ repeatKind: 'once', dueOn: '2026-11-05' }), '2026-11-01'), null);
  assert.equal(scheduledDue(job({ repeatKind: 'once' }), null), '2026-10-01');
});

test('on: fixed dates, and done a little early still counts', () => {
  const gutters = job({ repeatKind: 'on', onMonths: [9, 3], onDay: 15 });
  assert.equal(scheduledDue(gutters, null), '2027-03-15', 'added in October: next spring');
  assert.equal(scheduledDue(gutters, '2027-03-10'), '2027-09-15', 'done 5 days early covers March');
  assert.equal(scheduledDue(gutters, '2027-02-20'), '2027-03-15', 'done weeks early: March is still due');
  assert.equal(scheduledDue(gutters, '2027-04-02'), '2027-09-15', 'done late');
  assert.equal(nextOnDate([2], 31, '2026-10-21'), '2027-02-28', 'past the month\'s end: its last day');
  assert.equal(nextOnDate([], 1, '2026-10-21'), null);
  assert.equal(scheduledDue(job({ repeatKind: 'on', onMonths: [10], onDay: 1, startOn: '2026-09-01' }), null), '2026-10-01');
});

test('snooze moves only what shows; skip counts as done on that date', () => {
  assert.equal(nextDue(job({ snoozedUntil: '2026-10-08' }), null), '2026-10-08');
  assert.equal(nextDue(job({ snoozedUntil: '2026-09-01' }), null), '2026-10-01', 'an old snooze does nothing');
  assert.equal(nextDue(job({ skippedUntil: '2026-10-01' }), null), '2027-01-01', 'after: one interval on');
  assert.equal(nextDue(job({ skippedUntil: '2026-10-01' }), '2026-07-01'), '2027-01-01');
  assert.equal(nextDue(job({ skippedUntil: '2026-01-01' }), '2026-07-01'), '2026-10-01', 'done since the skip: that counts');
  assert.equal(nextDue(job({ repeatKind: 'on', onMonths: [3, 9], onDay: 15, skippedUntil: '2027-03-15' }), null), '2027-09-15');
});

test('statusOf: overdue, due, soon within the heads-up, later, done', () => {
  assert.equal(statusOf('2026-10-20', '2026-10-21', 7), 'overdue');
  assert.equal(statusOf('2026-10-21', '2026-10-21', 7), 'due');
  assert.equal(statusOf('2026-10-28', '2026-10-21', 7), 'soon');
  assert.equal(statusOf('2026-10-29', '2026-10-21', 7), 'later');
  assert.equal(statusOf(null, '2026-10-21', 7), 'done');
});

test('dueNotes: heads-up, due, three late ones, warranty', () => {
  const at = (due: string, today: string) => dueNotes([{ id: 'j', due, headsUpDays: 7 }], [], today).map((n) => n.key);
  assert.deepEqual(at('2026-10-28', '2026-10-20'), [], 'too early');
  assert.deepEqual(at('2026-10-28', '2026-10-21'), ['upkeep:heads-up:j:2026-10-28']);
  assert.deepEqual(at('2026-10-21', '2026-10-21'), ['upkeep:due:j:2026-10-21']);
  assert.deepEqual(at('2026-10-21', '2026-10-25'), ['upkeep:due:j:2026-10-21'], 'a missed morning catches up');
  assert.deepEqual(at('2026-10-01', '2026-10-08'), ['upkeep:late1:j:2026-10-01']);
  assert.deepEqual(at('2026-10-01', '2026-10-21'), ['upkeep:late1:j:2026-10-01'], 'still the first until 14 more days');
  assert.deepEqual(at('2026-10-01', '2026-10-22'), ['upkeep:late2:j:2026-10-01']);
  assert.deepEqual(at('2026-01-01', '2026-10-22'), ['upkeep:late3:j:2026-01-01'], 'three at most');
  const w = (until: string, archived = false) => dueNotes([], [{ id: 't', warrantyUntil: until, archived }], '2026-10-21').map((n) => n.key);
  assert.deepEqual(w('2026-11-20'), ['upkeep:warranty:t:2026-11-20']);
  assert.deepEqual(w('2026-11-21'), []);
  assert.deepEqual(w('2026-10-20'), [], 'already over');
  assert.deepEqual(w('2026-11-01', true), [], 'a thing that is gone');
});

test('suppliesDue: within the days before, and while late', () => {
  assert.equal(suppliesDue('2026-10-28', 7, '2026-10-21'), true);
  assert.equal(suppliesDue('2026-10-29', 7, '2026-10-21'), false);
  assert.equal(suppliesDue('2026-10-01', 7, '2026-10-21'), true);
  assert.equal(suppliesDue(null, 7, '2026-10-21'), false);
});
