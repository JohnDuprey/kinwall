// Nudges (nudges.ts): varied, kind, escalating headlines for transition reminders and the app's
// leave-by / start-prep Live Activity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calmNudge, nudge, nudgeStage, POOLS, type NudgeKind } from '../src/nudges.ts';

const KINDS: NudgeKind[] = ['leave', 'prep', 'start'];
const TITLES = ['Soccer', 'Soccer practice', 'Dinner · Tuesday Tacos'];
const SEEDS = ['m1:e1:2030-03-04', 'm2:e7:2030-03-05', 'm3:meal:2030-03-06', 'm4:e9:2030-03-07', 'x'];
const MINUTES = [60, 30, 20, 15, 10, 5, 4, 3, 2, 1, 0];

test('nudges: stages escalate as time runs out', () => {
  assert.deepEqual([30, 16, 15, 6, 5, 1, 0, -2].map(nudgeStage), ['early', 'early', 'mid', 'mid', 'soon', 'soon', 'now', 'now']);
});

test('nudges: the same person, event and day give the same line (a restart never reshuffles)', () => {
  const n = { kind: 'leave' as const, title: 'Soccer', minutes: 10, at: '3:40 PM', seed: 'm1:e1:2030-03-04', ordinal: 2, name: 'Sam' };
  assert.equal(nudge(n), nudge({ ...n }));
  assert.notEqual(new Set(SEEDS.map((seed) => nudge({ ...n, seed }))).size, 1, 'different events vary');
});

test('nudges: never the same line twice in a row', () => {
  for (const kind of KINDS) for (const seed of SEEDS) for (const name of ['Maya', null]) {
    const lines = MINUTES.map((minutes, ordinal) => nudge({ kind, title: 'Soccer', minutes, at: '3:40 PM', seed, ordinal, name }));
    for (let i = 1; i < lines.length; i++) assert.notEqual(lines[i], lines[i - 1], `${kind} ${seed}: ${lines[i]}`);
  }
});

test('nudges: every line has the what and the when, and fits a lock screen', () => {
  for (const kind of KINDS) for (const title of TITLES) for (const seed of SEEDS) for (const [ordinal, minutes] of MINUTES.entries()) for (const name of ['Maya', null]) {
    const line = nudge({ kind, title, minutes, at: '12:45 PM', seed, ordinal, name });
    assert.ok(line.includes(title), line);
    assert.ok(line.includes(`${minutes} min`) || line.includes('12:45 PM') || (minutes <= 0 && /\bnow\b/.test(line)), `no when: ${line}`);
    assert.ok([...line].length <= 60, `too long (${[...line].length}): ${line}`);
  }
});

test('nudges: every template in every pool is used and filled', () => {
  for (const kind of KINDS) for (const [stage, pool] of Object.entries(POOLS[kind])) {
    assert.ok(pool.filter((l) => !l.includes('{n}')).length >= 3, `${kind} ${stage}: at least 3 lines without a name`);
    for (const line of pool) assert.ok(line.includes('{t}') && line.includes('{e}'), `${kind} ${stage}: ${line}`);
  }
  assert.doesNotMatch(nudge({ kind: 'prep', title: 'Tacos', minutes: 8, at: '5:15 PM', seed: 's', name: 'Leo' }), /[{}]/);
});

test('nudges: a Live Activity headline never has minutes in it (its own countdown ticks)', () => {
  for (const kind of KINDS) for (const [stage, pool] of Object.entries(POOLS[kind])) {
    assert.ok(pool.filter((l) => !l.includes('{m}') && !l.includes('{n}')).length >= 2, `${kind} ${stage}: 2 lines for a Live Activity`);
  }
  for (const kind of KINDS) for (const seed of SEEDS) for (const minutes of MINUTES) {
    const line = nudge({ kind, title: 'Soccer', minutes, at: '3:40 PM', seed, name: 'Sam', live: true });
    assert.doesNotMatch(line, /\d+ min/, line);
    assert.ok(line.includes('3:40 PM') || /\bnow\b/.test(line), line);
  }
  assert.equal(nudge({ kind: 'prep', title: 'Tacos', minutes: 12, at: '5:15 PM', seed: 's', live: true, calm: true }), 'Start prep for Tacos at 5:15 PM');
});

test('nudges: kind words only (kids read these)', () => {
  const banned = /\b(late|again|lazy|hurry|fail\w*|bad|forg[eo]t\w*|should|why|disappoint\w*|shame\w*|never|always|ugh|seriously|missed|behind|slow)\b/i;
  for (const kind of KINDS) for (const pool of Object.values(POOLS[kind])) for (const line of pool) assert.doesNotMatch(line, banned, line);
});

test('nudges: low stimulation is one plain line', () => {
  assert.equal(nudge({ kind: 'leave', title: 'Soccer', minutes: 10, at: '3:40 PM', seed: 'a', calm: true }), 'Leave for Soccer in 10 min');
  assert.equal(nudge({ kind: 'leave', title: 'Soccer', minutes: 10, at: '3:40 PM', seed: 'b', ordinal: 3, calm: true }), 'Leave for Soccer in 10 min');
  assert.equal(calmNudge('prep', 'Tacos', 0), 'Start prep for Tacos now');
  assert.equal(calmNudge('start', 'Piano', 5), 'Piano in 5 min');
});

test('nudges: the web app\'s copy is identical', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.equal(read('../../web/src/nudges.ts'), read('../src/nudges.ts'), 'copy server/src/nudges.ts to web/src/nudges.ts');
});
