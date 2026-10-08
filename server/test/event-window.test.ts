// Reading events by window (hosted is billed per SQLite row read): eventInstances reads only the rows
// that can have an instance in the asked range, not the whole events table. The output must stay what
// reading every row gave. GOLDEN holds, per window, the count and a hash of the output from the
// whole-table read (captured before the change): all-day and multi-day rows, a 100-day term, offsets,
// rows crossing the window's edges, local repeats (weekly, COUNT, UNTIL, yearly all-day), DST weekends,
// hidden occurrences and series, and member overrides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { KinwallDb } from '../src/db.ts';
import { eventInstances } from '../src/routes/events.ts';
import { runNotifications } from '../src/notify.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 86400000;

function seed() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const run = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).run();
  run("INSERT INTO settings (key, value) VALUES ('timezone', 'America/New_York')");
  run("INSERT INTO members (id, name, color, created_at) VALUES ('m1', 'Alex', '#111111', '2026-01-01'), ('m2', 'Maya', '#222222', '2026-01-01')");
  run("INSERT INTO calendars (id, kind, name, config, member_ids) VALUES ('local', 'local', 'Family', '{}', '[\"m1\"]'), ('g', 'google', 'Work', '', '[]'), ('ics', 'ics', 'School', '', '[\"m2\"]')");
  const ev = (id: string, cal: string, start: string, end: string, allDay = 0, rrule: string | null = null, extra: { series?: string; members?: string } = {}) =>
    run('INSERT INTO events (id, calendar_id, external_id, title, start, end, all_day, rrule, member_ids, updated_at, series_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, cal, cal === 'local' ? null : `x-${id}`, `Event ${id}`, start, end, allDay, rrule, extra.members ?? '[]', '2026-01-01T00:00:00.000Z', extra.series ?? null);
  // Synced rows spread over 2025-2027, pseudo-random but fixed.
  let s = 42;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const base = Date.parse('2025-06-01T00:00:00Z');
  for (let i = 0; i < 400; i++) {
    const cal = i % 3 === 0 ? 'ics' : 'g';
    const t = base + Math.floor(rnd() * 900) * DAY + Math.floor(rnd() * 96) * 15 * 60000;
    if (rnd() < 0.25) {
      const d = iso(t).slice(0, 10);
      const len = [1, 1, 2, 5, 7, 8][Math.floor(rnd() * 6)];
      ev(`s${i}`, cal, d, iso(Date.parse(d) + len * DAY).slice(0, 10), 1, null, { series: i % 7 === 0 ? 'series-a' : undefined });
    } else {
      const mins = [15, 30, 60, 90, 180, 60 * 30, 60 * 24 * 7, 60 * 24 * 9][Math.floor(rnd() * 8)];
      ev(`s${i}`, cal, iso(t), iso(t + mins * 60000), 0, null, { series: i % 7 === 0 ? 'series-a' : undefined });
    }
  }
  ev('term', 'ics', '2026-09-01', '2026-12-20', 1); // a school term: 110 days
  ev('trip', 'g', '2026-10-20T13:00:00.000Z', '2026-11-12T18:00:00.000Z'); // 23 days, timed
  ev('offset', 'g', '2026-10-05T23:30:00-04:00', '2026-10-06T00:30:00-04:00'); // stored with an offset
  ev('edge1', 'g', '2026-10-04T03:30:00.000Z', '2026-10-04T04:30:00.000Z'); // across local midnight
  ev('dst', 'local', '2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z'); // the repeated 1 AM hour
  ev('weekly', 'local', '2026-01-05T14:00:00.000Z', '2026-01-05T15:00:00.000Z', 0, 'FREQ=WEEKLY;BYDAY=MO,WE');
  ev('count', 'local', '2026-10-10T12:00:00.000Z', '2026-10-10T13:00:00.000Z', 0, 'FREQ=DAILY;COUNT=10');
  ev('until', 'local', '2026-02-01T23:00:00.000Z', '2026-02-02T01:00:00.000Z', 0, 'FREQ=WEEKLY;UNTIL=20261115T000000Z');
  ev('bday', 'local', '2020-05-04', '2020-05-05', 1, 'FREQ=YEARLY', { members: '["m2"]' });
  ev('longrep', 'local', '2026-03-01', '2026-03-11', 1, 'FREQ=MONTHLY'); // a 10-day repeat
  ev('future', 'local', '2027-03-01T15:00:00.000Z', '2027-03-01T16:00:00.000Z', 0, 'FREQ=DAILY');
  run("INSERT INTO event_hidden (id, calendar_id, scope, key, title, start, created_at) VALUES ('h1', 'local', 'occurrence', 'weekly@2026-10-07T14:00:00.000Z', 'x', 'x', 'x'), ('h2', 'g', 'series', 'series-a', 'x', 'x', 'x'), ('h3', 'ics', 'occurrence', 'x-s3', 'x', 'x', 'x')");
  run("INSERT INTO event_member_overrides (calendar_id, external_id, member_ids, updated_at) VALUES ('g', 'x-s1', '[\"m2\"]', 'x'), ('g', 'x-trip', '[\"m1\"]', 'x')");
  return db;
}

// From/to pairs: every 5 days through 2026 at four lengths and odd hours, plus the DST weekends.
function windows(): [string, string][] {
  const out: [string, string][] = [];
  for (let t = Date.parse('2025-12-20T04:00:00Z'); t < Date.parse('2027-01-10T00:00:00Z'); t += 5 * DAY) {
    for (const len of [3600000, DAY, 7 * DAY, 35 * DAY]) out.push([iso(t + (len === 3600000 ? 13 * 3600000 : 0)), iso(t + len)]);
  }
  out.push(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'], ['2026-10-31T04:00:00.000Z', '2026-11-02T05:00:00.000Z'], ['2026-11-01T04:00:00.000Z', '2026-11-01T06:30:00.000Z']);
  return out;
}

const digest = (rows: unknown[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
// Ties on start come back in table order, which the query plan decides; the contract is sorted by start.
const canonical = (rows: { start: string; id: string }[]) => [...rows].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

async function outputs(db: KinwallDb) {
  const all: Record<string, string> = {};
  for (const [from, to] of windows()) {
    for (const includeHidden of [false, true]) {
      const rows = canonical(await eventInstances(db, new Date(from), new Date(to), undefined, { includeHidden }));
      all[`${from}|${to}|${includeHidden}`] = `${rows.length}:${digest(rows)}`;
    }
  }
  const one = canonical(await eventInstances(db, new Date('2026-09-27T04:00:00Z'), new Date('2026-11-08T05:00:00Z'), 'g'));
  all.oneCalendar = `${one.length}:${digest(one)}`;
  return all;
}

test('eventInstances by window gives what reading every row gave', async () => {
  const got = await outputs(seed() as unknown as KinwallDb);
  const total = createHash('sha256').update(JSON.stringify(got)).digest('hex').slice(0, 16);
  const instances = Object.values(got).reduce((n, v) => n + Number(v.split(':')[0]), 0);
  assert.equal(`${instances}:${total}`, GOLDEN);
});

// Years of past synced rows (Google slices never delete them) that a week never needs.
function withOldRows() {
  const db = seed();
  const stmt = db.prepare("INSERT INTO events (id, calendar_id, external_id, title, start, end, updated_at) VALUES (?, 'g', ?, 'Old', ?, ?, 'x')");
  for (let i = 0; i < 2000; i++) {
    const t = Date.parse('2023-01-01T15:00:00Z') + i * 12 * 3600000;
    db.batch([stmt.bind(`old${i}`, `o${i}`, iso(t), iso(t + 3600000))]);
  }
  return db;
}

// Counts the event rows statements return (an index read returns what it reads) and how many
// statements read events.
function counting(db: ReturnType<typeof seed>) {
  const n = { rows: 0, reads: 0 };
  type St = ReturnType<typeof db.prepare>;
  type Wrapped = { sql: string; st: St; bind(...v: unknown[]): Wrapped; all(): unknown; first(): unknown; run(): unknown };
  const note = <R extends { results: unknown[] }>(sql: string, r: R) => { if (/FROM events\b/.test(sql)) { n.rows += r.results.length; n.reads++; } return r; };
  const wrap = (sql: string, st: St): Wrapped => ({ sql, st, bind: (...v) => wrap(sql, st.bind(...v)), all: () => note(sql, st.all()), first: () => st.first(), run: () => st.run() });
  return { n, db: { prepare: (sql: string) => wrap(sql, db.prepare(sql)), batch: (sts: Wrapped[]) => db.batch(sts.map((s) => s.st)).map((r, i) => note(sts[i].sql, r)) } as unknown as KinwallDb };
}

test('a week reads the rows near it, not the whole events table', async () => {
  const { n, db } = counting(withOldRows());
  const week = await eventInstances(db, new Date('2026-10-04T04:00:00Z'), new Date('2026-10-11T04:00:00Z'));
  assert.ok(week.length > 0);
  assert.ok(n.rows < 60, `read ${n.rows} event rows for one week`);
});

test('a notification tick reads the events once, near now', async () => {
  const { n, db } = counting(withOldRows());
  await runNotifications({ DB: db }, new Date('2026-10-06T14:00:00Z'));
  assert.equal(n.reads, 2, 'one batch: rows starting near now, and the repeating or long ones');
  assert.ok(n.rows < 40, `read ${n.rows} event rows`);
});

const GOLDEN = '6579:1acc465ef3e398c4'; // captured from the whole-table read (re-captured when instances gained busy, then meal; same rows otherwise)
