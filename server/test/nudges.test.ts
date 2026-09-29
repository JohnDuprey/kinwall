// Nudges (nudges.ts): varied, kind, escalating headlines for transition reminders and the app's
// leave-by / start-prep Live Activity, composed from parts (opener, core, hint, emoji).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calmNudge, compose, mealName, CORES, EMOJI, GENERAL_HINTS, HINT_SETS, hintSet, NUDGE_MEMORY, nudge, nudgeStage, OPENERS, pickNudge, rememberNudge, stepHint, type Nudge, type NudgeKind, type NudgeSeen, type NudgeStage } from '../src/nudges.ts';

const KINDS: NudgeKind[] = ['leave', 'prep', 'start'];
const STAGES: NudgeStage[] = ['early', 'mid', 'soon', 'now'];
const TITLES = ['Soccer', 'Soccer practice', 'Dinner · Tuesday Tacos'];
const SEEDS = ['m1:e1:2030-03-04', 'm2:e7:2030-03-05', 'm3:meal:2030-03-06', 'm4:e9:2030-03-07', 'x'];
const MINUTES = [60, 30, 20, 15, 10, 5, 4, 3, 2, 1, 0];
const BANNED = /\b(late|again|lazy|hurry|fail\w*|bad|forg[eo]t\w*|should|why|disappoint\w*|shame\w*|never|always|ugh|seriously|missed|behind|slow)\b/i;
const MEDICAL = /\b(pill|medic\w*|dose|shot|vaccin\w*|meds|prescription|symptom\w*|sick|diagnos\w*|blood|needle)\b/i;
// Grammatical by construction: no doubled or stray spacing and punctuation, sentences start with a
// capital (or a number, an emoji or the title), and after a colon or comma the core is lowercase.
const grammatical = (line: string) =>
  !/\s{2}|\s[,.!?:]|[,:][.!?]|[.!?]{2}|^\s|\s$/.test(line) && /^[^a-z]/.test(line) && !/[.!?] [a-z]/.test(line) && !/[{}]/.test(line);

// The emoji with the most code points stands in for all of them in the length check.
const WIDEST = [...Object.values(EMOJI).flat(), ...HINT_SETS.flatMap((s) => s.emoji)].sort((a, b) => [...b].length - [...a].length)[0];
const hintsFor = (kind: NudgeKind, set: string | null) => [...(set ? HINT_SETS.find((s) => s.key === set)!.hints : []), ...GENERAL_HINTS[kind], 'Rinse the rice', ''];

test('nudges: stages escalate as time runs out', () => {
  assert.deepEqual([30, 16, 15, 6, 5, 1, 0, -2].map(nudgeStage), ['early', 'early', 'mid', 'mid', 'soon', 'soon', 'now', 'now']);
});

test('nudges: every composed combination has the what and the when, is grammatical, kind and fits a lock screen', () => {
  let n = 0;
  for (const kind of KINDS) for (const stage of STAGES) for (const title of TITLES) for (const [o] of OPENERS.entries()) for (const [c, core] of CORES[kind][stage].entries()) {
    for (const set of [null, ...HINT_SETS.map((s) => s.key)]) for (const hint of hintsFor(kind, set)) for (const emoji of [WIDEST]) {
      const minutes = stage === 'now' ? 0 : stage === 'soon' ? 5 : stage === 'mid' ? 15 : 45;
      const { line } = compose(kind, stage, { opener: o, core: c, hint, emoji }, { t: title, m: `${minutes} min`, at: '12:45 PM', n: 'Maya' });
      n++;
      assert.ok(line.includes(title), line);
      assert.ok(line.includes(`${minutes} min`) || line.includes('12:45 PM') || (stage === 'now' && /\bnow\b/i.test(line)), `no when: ${line}`);
      assert.ok([...line].length <= 60, `too long (${[...line].length}): ${line}`);
      assert.ok(grammatical(line), `${kind} ${stage} ${core}: ${line}`);
      assert.ok((line.match(/!/g) ?? []).length <= 1, `two "!": ${line}`);
    }
  }
  assert.ok(n > 50000, `enumerated ${n}`);
});

test('nudges: hundreds of combinations per kind and stage, fewer and plainer at "now"', () => {
  for (const kind of KINDS) for (const stage of STAGES) {
    const openers = OPENERS.filter((o) => stage !== 'now' || o.now).length;
    const combos = openers * CORES[kind][stage].length * (GENERAL_HINTS[kind].length + 1) * EMOJI[kind].length;
    assert.ok(combos >= (stage === 'now' ? 100 : 500), `${kind} ${stage}: ${combos}`);
    assert.ok(CORES[kind][stage].filter((l) => !l.includes('{m}')).length >= 2, `${kind} ${stage}: 2 cores for a Live Activity`);
  }
  for (const kind of KINDS) assert.ok(Math.max(...CORES[kind].now.map((c) => c.length)) <= 26, `${kind}: short "now" cores`);
});

test('nudges: kind words only, in every part and hint (kids read these), and nothing medical', () => {
  const parts = [...OPENERS.map((o) => o.text), ...KINDS.flatMap((k) => Object.values(CORES[k]).flat()), ...Object.values(GENERAL_HINTS).flat(), ...HINT_SETS.flatMap((s) => s.hints)];
  for (const part of parts) assert.doesNotMatch(part, BANNED, part);
  for (const part of parts) assert.doesNotMatch(part, MEDICAL, part);
  assert.deepEqual(HINT_SETS.find((s) => s.key === 'doctor')!.hints.filter((h) => /card/i.test(h)), ['Insurance card?']);
});

test('nudges: the same person, event, day and history give the same line (a restart never reshuffles)', () => {
  const n = { kind: 'leave' as const, title: 'Soccer', minutes: 10, at: '3:40 PM', seed: 'm1:e1:2030-03-04', ordinal: 2, name: 'Sam' };
  const seen: NudgeSeen[] = [{ id: 'a', combo: 'leave.mid.0.-', opener: 1 }];
  assert.equal(nudge(n, seen), nudge({ ...n }, [...seen]));
  assert.notEqual(new Set(SEEDS.map((seed) => nudge({ ...n, seed }))).size, 1, 'different events vary');
});

test('nudges: a daily event over 30 days never repeats a core and hint within the last 10, nor an opener twice in a row', () => {
  for (const [kind, title, category] of [['leave', 'School bus', 'School 🏫'], ['start', 'Bedtime', null], ['prep', 'Dinner · Tuesday Tacos', null]] as const) for (const name of ['Maya', null]) {
    let seen: NudgeSeen[] = [];
    const shown: NudgeSeen[] = [];
    for (let day = 1; day <= 30; day++) for (const [ordinal, minutes] of [15, 10, 5, 0].entries()) {
      const p = pickNudge({ kind, title, minutes, at: '7:40 AM', seed: `m3:e2:2030-04-${String(day).padStart(2, '0')}`, ordinal, name, category }, seen);
      assert.ok(p.seen && p.fresh);
      const recent = shown.slice(-NUDGE_MEMORY);
      assert.ok(!recent.some((s) => s.combo === p.seen!.combo), `day ${day}: ${p.line} repeats within ${NUDGE_MEMORY}`);
      if (shown.length) assert.notEqual(p.seen.opener, shown[shown.length - 1].opener, `day ${day}: ${p.line}`);
      shown.push(p.seen);
      seen = rememberNudge(seen, p.seen);
    }
  }
});

test('nudges: history keeps the last 10 and a seen id gives back the same line', () => {
  let seen: NudgeSeen[] = [];
  for (let i = 0; i < 25; i++) seen = rememberNudge(seen, { id: `x${i}`, combo: `leave.mid.${i}.-`, opener: i % 3 });
  assert.equal(seen.length, NUDGE_MEMORY);
  assert.deepEqual(seen.map((s) => s.id), Array.from({ length: 10 }, (_, i) => `x${i + 15}`), 'oldest dropped');
  assert.equal(rememberNudge(seen, seen[3]).length, NUDGE_MEMORY, 'the same one twice is kept once');
  const n: Nudge = { kind: 'leave', title: 'Soccer practice', minutes: 20, at: '3:40 PM', seed: 's', live: true, category: 'Soccer ⚽' };
  const first = pickNudge(n, seen);
  const again = pickNudge({ ...n, minutes: 18 }, rememberNudge(seen, first.seen!));
  assert.equal(again.line, first.line, 'a Live Activity headline holds for its stage');
  assert.equal(again.fresh, false);
});

test('nudges: an event\'s category or title picks its hints', () => {
  assert.equal(hintSet('leave', 'Soccer practice', null)?.key, 'soccer');
  assert.equal(hintSet('leave', 'Practice', 'Soccer ⚽')?.key, 'soccer');
  assert.equal(hintSet('start', 'Lessons', '🎹 Piano')?.key, 'music');
  assert.equal(hintSet('leave', 'Swim team', null)?.key, 'swim');
  assert.equal(hintSet('leave', 'School bus', null)?.key, 'school');
  assert.equal(hintSet('leave', 'Checkup', 'Dentist 🦷')?.key, 'dentist');
  assert.equal(hintSet('leave', 'Dr. Patel', null)?.key, 'doctor');
  assert.equal(hintSet('leave', "Leo's birthday party", null)?.key, 'party');
  assert.equal(hintSet('leave', 'Grandma visit', null), null);
  assert.equal(hintSet('prep', 'Soccer snacks', 'Soccer ⚽'), null, 'prep is always about cooking');
  const lines = (n: Omit<Nudge, 'seed'>) => SEEDS.flatMap((seed) => MINUTES.map((minutes, ordinal) => nudge({ ...n, minutes, seed, ordinal }))).join('\n');
  const soccer = lines({ kind: 'leave', title: 'Soccer practice', minutes: 0, at: '3:40 PM', category: 'Sports ⚽' });
  assert.match(soccer, /Cleats on\?|Shin guards\?/);
  const bus = lines({ kind: 'leave', title: 'School bus', minutes: 0, at: '7:40 AM' });
  assert.match(bus, /Backpack and lunch\?|Homework in the bag\?/);
  assert.doesNotMatch(bus, /Cleats|Shin/);
  const tacos = lines({ kind: 'prep', title: 'Dinner · Tuesday Tacos', minutes: 0, at: '5:15 PM', step: 'Brown the beef' });
  assert.match(tacos, /Brown the beef/);
  assert.match(tacos, /Wash your hands|Apron on/);
});

test('nudges: a meal\'s event goes by the meal\'s name', () => {
  assert.equal(mealName('Dinner · Tuesday Tacos'), 'Tuesday Tacos');
  assert.equal(mealName('Breakfast · Pancakes · with berries'), 'Pancakes · with berries');
  assert.equal(mealName('Soccer · finals'), 'Soccer · finals', 'only a meal slot');
});

test('nudges: "now" cores read right with any title (no "Dentist time!")', () => {
  for (const kind of KINDS) for (const core of CORES[kind].now) assert.doesNotMatch(core, /\{t\} time/, core);
});

test('nudges: a recipe\'s first step becomes a short hint, when it is short', () => {
  assert.equal(stepHint({ text: 'Cook the rice. Then set it aside.', bullets: [] }), 'Cook the rice');
  assert.equal(stepHint({ text: 'Prep the veggies', bullets: ['Dice the onion', 'Mince the garlic'] }), 'Dice the onion');
  assert.equal(stepHint({ title: 'Brown the beef', text: 'In a large skillet over medium-high heat, brown the beef.', bullets: [] }), 'Brown the beef');
  assert.equal(stepHint({ text: 'In a large skillet over medium-high heat, brown the ground beef until no pink remains', bullets: [] }), null, 'too long: skipped');
  assert.equal(stepHint(undefined), null);
});

test('nudges: a Live Activity headline never has minutes in it (its own countdown ticks)', () => {
  for (const kind of KINDS) for (const seed of SEEDS) for (const minutes of MINUTES) {
    const line = nudge({ kind, title: 'Soccer', minutes, at: '3:40 PM', seed, name: 'Sam', live: true });
    assert.doesNotMatch(line, /\d+ min/, line);
    assert.ok(line.includes('3:40 PM') || /\bnow\b/i.test(line), line);
  }
  assert.equal(nudge({ kind: 'prep', title: 'Tacos', minutes: 12, at: '5:15 PM', seed: 's', live: true, calm: true }), 'Start prep for Tacos at 5:15 PM');
});

test('nudges: sampled picks with names, hints and history stay within the rules', () => {
  for (const kind of KINDS) for (const title of TITLES) for (const category of [null, 'Soccer ⚽', 'Dentist 🦷', 'School']) for (const name of ['Maya', null]) {
    let seen: NudgeSeen[] = [];
    for (const seed of SEEDS) for (const [ordinal, minutes] of MINUTES.entries()) {
      const p = pickNudge({ kind, title, minutes, at: '12:45 PM', seed, ordinal, name, category, step: kind === 'prep' ? 'Rinse the rice' : null }, seen);
      assert.ok(p.line.includes(title) && [...p.line].length <= 60 && grammatical(p.line), p.line);
      assert.ok(p.line.includes(`${minutes} min`) || p.line.includes('12:45 PM') || (minutes <= 0 && /\bnow\b/i.test(p.line)), p.line);
      assert.ok(name || !p.line.includes('Maya'));
      seen = rememberNudge(seen, p.seen!);
    }
  }
});

test('nudges: low stimulation is one plain line', () => {
  assert.equal(nudge({ kind: 'leave', title: 'Soccer', minutes: 10, at: '3:40 PM', seed: 'a', calm: true, category: 'Soccer ⚽' }), 'Leave for Soccer in 10 min');
  assert.equal(nudge({ kind: 'leave', title: 'Soccer', minutes: 10, at: '3:40 PM', seed: 'b', ordinal: 3, calm: true }), 'Leave for Soccer in 10 min');
  assert.equal(pickNudge({ kind: 'leave', title: 'Soccer', minutes: 10, at: '3:40 PM', seed: 'b', calm: true }).seen, null, 'nothing to remember');
  assert.equal(calmNudge('prep', 'Tacos', 0), 'Start prep for Tacos now');
  assert.equal(calmNudge('start', 'Piano', 5), 'Piano in 5 min');
});

test('nudges: the web app\'s copy is identical', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.equal(read('../../web/src/nudges.ts'), read('../src/nudges.ts'), 'copy server/src/nudges.ts to web/src/nudges.ts');
});
