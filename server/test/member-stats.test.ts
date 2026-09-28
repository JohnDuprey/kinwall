// GET /api/members/{id}/stats: a member profile's numbers for a period, in the household timezone.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import type { ChoreRow } from '../src/routes/chores.ts';
import { computeStreak, streakStats } from '../src/routes/leaderboard.ts';
import { BADGES, earnedBadges } from '../src/badges.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';

// Saturday 2026-09-26, 10 pm in Los Angeles (already Sunday in UTC). Weeks start on Sunday.
const NOW = new Date('2026-09-27T05:00:00Z');

async function setup(now = NOW) {
  mock.timers.enable({ apis: ['Date'], now });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  const sql = (q: string, ...args: unknown[]) => db.prepare(q).bind(...args).run();
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles', weekStart: 0 });
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', birthday: '2018-11-02' })).json;
  const chore = (await req('/api/chores', 'POST', { title: 'Feed Pepper', emoji: '🐶', memberId: maya.id, points: 1 })).json;
  let n = 0;
  const done = (date: string, points: number, status = 'approved', choreId = chore.id) =>
    sql('INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, points_awarded, status) VALUES (?,?,?,?,?,?,?)', `cc${n++}`, choreId, date, maya.id, `${date}T18:00:00Z`, points, status);
  const entry = (amount: number, reason: string, at: string) => sql('INSERT INTO point_entries (id, member_id, amount, reason, ref, at) VALUES (?,?,?,?,NULL,?)', `pe${n++}`, maya.id, amount, reason, at);
  return { req, sql, maya, chore, done, entry };
}

test('stats: every period uses household-day boundaries, and compares with the same stretch before', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, done, entry } = await setup();
  const other = (await req('/api/chores', 'POST', { title: 'Tidy room', memberId: maya.id, points: 9 })).json;
  await done('2026-09-26', 3); // today
  await done('2026-09-26', 9, 'pending', other.id); // waiting for a parent: not counted
  await done('2026-09-20', 2); // this week's first day
  await done('2026-09-19', 4); // last week
  await done('2026-09-01', 1);
  await done('2026-08-31', 5);
  await done('2026-01-01', 7);
  await done('2025-12-31', 6);
  await entry(-15, 'sticker_pack', '2026-09-26T06:00:00Z'); // 11 pm on the 25th in Los Angeles: yesterday
  await entry(-20, 'reward', '2026-09-26T08:00:00Z'); // 1 am on the 26th: today
  await entry(-10, 'reward', '2026-09-02T12:00:00Z');
  await entry(10, 'reward_refund', '2026-09-03T12:00:00Z'); // declined: nets out

  const get = async (period: string) => {
    const r = await req(`/api/members/${maya.id}/stats?period=${period}`);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const today = await get('today');
  assert.deepEqual([today.from, today.to, today.choresDone, today.pointsEarned], ['2026-09-26', '2026-09-26', 1, 3]);
  assert.deepEqual(today.previous, { from: '2026-09-25', to: '2026-09-25', choresDone: 0, pointsEarned: 0 });
  assert.deepEqual(today.pointsSpent, { stickers: 0, rewards: 20 });

  const week = await get('week');
  assert.deepEqual([week.from, week.choresDone, week.pointsEarned], ['2026-09-20', 2, 5]);
  assert.deepEqual(week.previous, { from: '2026-09-13', to: '2026-09-19', choresDone: 1, pointsEarned: 4 });
  assert.deepEqual(week.pointsSpent, { stickers: 15, rewards: 20 });
  assert.deepEqual(week.chart, [
    { key: '2026-09-20', count: 1 }, { key: '2026-09-21', count: 0 }, { key: '2026-09-22', count: 0 }, { key: '2026-09-23', count: 0 },
    { key: '2026-09-24', count: 0 }, { key: '2026-09-25', count: 0 }, { key: '2026-09-26', count: 1 },
  ]);

  const month = await get('month');
  assert.deepEqual([month.from, month.choresDone, month.pointsEarned], ['2026-09-01', 4, 10]);
  assert.deepEqual(month.previous, { from: '2026-08-01', to: '2026-08-26', choresDone: 0, pointsEarned: 0 });
  assert.deepEqual(month.pointsSpent, { stickers: 15, rewards: 20 });
  assert.equal(month.chart.length, 30); // the whole month, days ahead at 0
  assert.deepEqual(month.chart.at(-1), { key: '2026-09-30', count: 0 });

  const year = await get('year');
  assert.deepEqual([year.from, year.choresDone, year.pointsEarned], ['2026-01-01', 6, 22]);
  assert.deepEqual(year.previous, { from: '2025-01-01', to: '2025-09-26', choresDone: 0, pointsEarned: 0 });
  assert.deepEqual(year.chart.map((b: { key: string }) => b.key), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.deepEqual(year.chart.slice(7, 9).map((b: { count: number }) => b.count), [1, 4]);

  const all = await get('all');
  assert.deepEqual([all.from, all.to, all.choresDone, all.pointsEarned, all.previous], ['2025-12-31', '2026-09-26', 7, 28, null]);
  assert.equal(all.chart[0].key, '2025-12');
  assert.deepEqual(all.favoriteChore, { choreId: all.favoriteChore.choreId, title: 'Feed Pepper', emoji: '🐶', count: 7 });
  assert.equal(all.busiestWeekday !== null, true);
  assert.equal((await req(`/api/members/${maya.id}/stats?period=decade`)).status, 400);
});

test('stats: month and year comparisons clamp to the last day of a shorter month', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup(new Date('2026-03-31T20:00:00Z'));
  const month = (await req(`/api/members/${maya.id}/stats?period=month`)).json;
  assert.deepEqual([month.previous.from, month.previous.to], ['2026-02-01', '2026-02-28']);
});

test('stats: all-time counts survive a deleted chore', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, chore, done } = await setup();
  await done('2026-09-24', 2);
  await req(`/api/chores/${chore.id}`, 'DELETE');
  const all = (await req(`/api/members/${maya.id}/stats?period=all`)).json;
  assert.deepEqual([all.choresDone, all.pointsEarned], [1, 2]);
});

test('stats: the streak matches the leaderboard (grace days included) and best streak covers all history', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, sql, maya } = await setup();
  const daily = (await req('/api/chores', 'POST', { title: 'Make bed', memberId: maya.id, points: 1, rrule: 'FREQ=DAILY', dueDate: '2026-06-01' })).json;
  // Done every day from Jun 1 to Jul 15 (45 days), then one miss, then Jul 17 to Sep 25 except Sep 1 and 2.
  const d = new Date(Date.UTC(2026, 5, 1));
  for (; d.toISOString() < '2026-09-26'; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (['2026-07-16', '2026-09-01', '2026-09-02'].includes(day)) continue;
    await sql("INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, points_awarded, status) VALUES (?,?,?,?,?,1,'approved')", day, daily.id, day, maya.id, `${day}T18:00:00Z`);
  }
  const board = (await req('/api/leaderboard')).json.find((e: { memberId: string }) => e.memberId === maya.id);
  const stats = (await req(`/api/members/${maya.id}/stats?period=week`)).json;
  // Grace 1 (the default): the Sep 1-2 pair breaks it (two misses in 7 days); Jul 16 alone is forgiven.
  assert.equal(stats.streak.current, board.streak);
  assert.equal(stats.streak.current, 23); // Sep 3 .. Sep 25; today isn't done yet and isn't a miss
  assert.equal(stats.streak.best, 91); // Jun 1 .. Aug 31 with Jul 16 forgiven
  await req('/api/settings', 'PATCH', { streakGraceDays: 0 });
  const strict = (await req(`/api/members/${maya.id}/stats?period=week`)).json;
  assert.deepEqual(strict.streak, { current: 23, best: 46 }); // Jul 17 .. Aug 31
});

test('streakStats: best is the longest run under the same rule; current is what the leaderboard shows', () => {
  const TODAY = '2026-06-30';
  const addDays = (date: string, n: number) => { const x = new Date(`${date}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const cases: [pattern: string, grace: number, current: number, best: number][] = [
    ['xx..xxxxx', 0, 2, 5],
    ['xx..xxxxx', 1, 2, 5],
    ['xx.xxxxx.xxx', 1, 7, 7], // misses 6 days apart share a window: the older one ends it, 3 left after
    ['.xxx..xxxx.x', 1, 3, 5],
    ['----', 1, 0, 0],
  ];
  for (const [pattern, grace, current, best] of cases) {
    const chores: ChoreRow[] = [];
    const done = new Set<string>();
    [...pattern].forEach((ch, i) => {
      if (ch === '-') return;
      const date = addDays(TODAY, -i);
      chores.push({ id: `c${i}`, title: 't', emoji: null, member_id: 'm', points: 1, rrule: null, due_date: date, due_time: null, active: 1, sort: 0, created_at: '2026-01-01' });
      if (ch === 'x') done.add(`c${i}:${date}`);
    });
    const s = streakStats(chores, done, 'UTC', TODAY, grace, pattern.length);
    assert.deepEqual(s, { current, best }, `${pattern} grace ${grace}`);
    assert.equal(computeStreak(chores, done, 'UTC', TODAY, grace), current);
  }
});

test('stats: books, sticker book, activity time, birthday and badges', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, sql, maya, done } = await setup();
  const book = (title: string, data: object, id = title) =>
    sql("INSERT INTO tracker_entries (id, kind, member_id, date, title, data, created_at, updated_at) VALUES (?, 'reading', ?, '2026-01-01', ?, ?, '', '')", id, maya.id, title, JSON.stringify(data));
  await book('Comet Club', { status: 'finished', finishedOn: '2026-09-24', totalPages: 104, rating: 5 });
  await book('Owls After Dark', { status: 'finished', finishedOn: '2025-07-03', totalPages: 88 });
  await book('The Clockwork Fox', { status: 'reading', pagesRead: 53, totalPages: 212 });
  await sql("INSERT INTO tracker_entries (id, kind, member_id, date, title, data, created_at, updated_at) VALUES ('h', 'health', ?, '2026-09-20', 'Checkup', '{\"type\":\"checkup\"}', '', '')", maya.id);
  await sql("INSERT INTO member_sticker_packs (member_id, pack_id, unlocked_at) VALUES (?, 'sweets', '2026-04-02T12:00:00Z')", maya.id);
  await sql("INSERT INTO scrapbook_stickers (id, member_id, sticker, x, y, placed_at) VALUES ('s1', ?, '🦄', 0.5, 0.5, '')", maya.id);
  await sql("INSERT INTO plugins (id, name, version, manifest, installed_at, updated_at) VALUES ('math-stars', 'Math Stars', '1', '{\"emoji\":\"🔢\"}', '', '')");
  await sql("INSERT INTO plugin_playtime (date, member_id, plugin_id, seconds) VALUES ('2026-09-25', ?, 'math-stars', 600), ('2026-08-01', ?, 'math-stars', 300)", maya.id, maya.id);
  await sql("INSERT INTO reward_redemptions (id, member_id, title, cost, status, date, requested_at) VALUES ('r1', ?, 'Pick the movie', 20, 'given', '2026-09-10', '')", maya.id);
  await done('2026-09-26', 3);

  const week = (await req(`/api/members/${maya.id}/stats?period=week`)).json;
  assert.deepEqual(week.books, {
    finished: 1, pages: 104, shelfScope: 'year',
    shelf: [{ id: 'Comet Club', title: 'Comet Club', pages: 104, rating: 5, finishedOn: '2026-09-24' }],
    reading: [{ id: 'The Clockwork Fox', title: 'The Clockwork Fox', percent: 25 }],
  });
  const all = (await req(`/api/members/${maya.id}/stats?period=all`)).json;
  assert.deepEqual([all.books.finished, all.books.shelfScope, all.books.shelf.length], [2, 'all', 2]);
  assert.equal(JSON.stringify(all).includes('Checkup'), false); // health never shows up
  assert.deepEqual(week.stickers, { packsOwned: 2, packsTotal: 8, placed: 1 }); // animals is free
  assert.deepEqual(week.activities, [{ pluginId: 'math-stars', name: 'Math Stars', emoji: '🔢', seconds: 600 }]);
  assert.equal(all.activities[0].seconds, 900);
  assert.deepEqual(week.birthday, { date: '2018-11-02', daysUntil: 37, turning: 8 });
  assert.equal(week.joined, '2026-09-26');
  const earned = week.badges.filter((b: { earned: boolean }) => b.earned).map((b: { id: string }) => b.id);
  assert.deepEqual(earned, ['first-chore', 'first-reward', 'first-pack', 'first-book']);
  assert.equal(week.badges.length, BADGES.length);
});

test('stats: birthdays without a year, on the day, and none', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup();
  const bday = async (birthday: string | null) => {
    await req(`/api/members/${maya.id}`, 'PATCH', { birthday });
    return (await req(`/api/members/${maya.id}/stats?period=today`)).json.birthday;
  };
  assert.deepEqual(await bday('--09-27'), { date: '--09-27', daysUntil: 1, turning: null });
  assert.deepEqual(await bday('2020-09-26'), { date: '2020-09-26', daysUntil: 0, turning: 6 });
  assert.deepEqual(await bday('2020-02-29'), { date: '2020-02-29', daysUntil: 155, turning: 7 }); // Feb 28 in a common year, as on the Board
  assert.equal(await bday(null), null);
});

test('stats: wall screens and kids\' devices can read any profile; unknown member is 404', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup();
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#F5A65B' })).json;
  const key = (await req('/api/keys', 'POST', { name: 'leo-tablet', scope: 'display' })).json;
  await req(`/api/keys/${key.id}`, 'PATCH', { owner: leo.id });
  assert.equal((await req(`/api/members/${maya.id}/stats?period=week`, 'GET', undefined, key.key)).status, 200);
  assert.equal((await req('/api/members/nope/stats?period=week')).status, 404);
});

test('badges: a fixed set, each earned from all-time totals', () => {
  assert.equal(BADGES.length, 12);
  assert.equal(new Set(BADGES.map((b) => b.id)).size, 12);
  const none = { chores: 0, bestStreak: 0, rewards: 0, packsBought: 0, packsOwned: 1, packsTotal: 8, books: 0 };
  assert.deepEqual(earnedBadges(none).filter((b) => b.earned), []);
  const lots = { chores: 500, bestStreak: 30, rewards: 1, packsBought: 7, packsOwned: 8, packsTotal: 8, books: 10 };
  assert.equal(earnedBadges(lots).every((b) => b.earned), true);
  const edge = earnedBadges({ ...none, chores: 49, bestStreak: 7 });
  assert.deepEqual(edge.filter((b) => b.earned).map((b) => b.id), ['first-chore', 'chores-10', 'streak-7']);
});
