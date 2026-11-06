// Queries that run on every refresh read through an index, not the whole table: hosted pays per
// SQLite row read, and these tables only grow (a few chore completions a day per person add up).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { POINT_TOTALS_SQL } from '../src/stickers.ts';
import { PENDING_SQL } from '../src/routes/chores.ts';
import { PERIOD_POINTS_SQL } from '../src/routes/members.ts';
import { NEWSCAST_SQL } from '../src/routes/newscast.ts';
import { ROUTINE_CHORES_SQL, ROUTINE_SELECTED_SQL } from '../src/routes/routine-mode.ts';
import { UNSEALED_NOTES_SQL } from '../src/notify.ts';
import { UNSHELVED_READING_SQL } from '../src/shelve.ts';
import { CURRENT_ANNOUNCEMENTS_SQL } from '../src/announcements.ts';

const db = openDb(':memory:');
applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
const plan = (sql: string) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>().results.map((r) => r.detail).join('\n');

test('points totals (GET /api/members) read maintained totals through an index', () => {
  for (const sql of [POINT_TOTALS_SQL, `${POINT_TOTALS_SQL} WHERE m.id = 'm1'`]) {
    const p = plan(sql);
    assert.match(p, /SEARCH t USING INDEX sqlite_autoindex_member_point_totals_1/, p);
    assert.doesNotMatch(p, /chore_completions|point_entries/, p);
  }
});

test('pending approvals (the parent badge) read only pending completions', () => {
  const p = plan(PENDING_SQL);
  assert.match(p, /chore_completions USING INDEX idx_chore_completions_pending|cc USING INDEX idx_chore_completions_pending/, p);
});

test("today's and this week's points read only this week's daily totals", () => {
  const p = plan(PERIOD_POINTS_SQL.replace(/\?\d/g, "'2026-09-30'"));
  assert.match(p, /SEARCH member_daily_points USING INDEX idx_member_daily_points_date/, p);
  assert.doesNotMatch(p, /chore_completions|point_entries/, p);
});

test('Newscast reads each source through an index, only over its window', () => {
  for (const [name, sql] of Object.entries(NEWSCAST_SQL)) {
    const p = plan(sql.replace(/\?/g, "'2026-09-30'"));
    assert.doesNotMatch(p, /SCAN (cc|chore_completions|reward_redemptions|photos|t|tracker_entries)\b/, `${name}: ${p}`);
  }
  const range = (sql: string) => plan(sql.replace(/\?/g, "'2026-09-30'"));
  assert.match(range(NEWSCAST_SQL.chores), /idx_chore_completions_date \(date>\? AND date<\?\)/);
  assert.match(range(NEWSCAST_SQL.rewards), /idx_reward_redemptions_given \(status=\? AND given_at>\? AND given_at<\?\)/);
  assert.match(range(NEWSCAST_SQL.photos), /idx_photos_created \(created_at>\? AND created_at<\?\)/);
  assert.match(range(NEWSCAST_SQL.memories), /idx_tracker_entries_kind_date \(kind=\? AND date>\? AND date<\?\)/);
});

test("routine mode (polled by a child's iPhone) reads only that child's live chores", () => {
  const p = plan(ROUTINE_CHORES_SQL);
  assert.match(p, /SEARCH c USING INDEX idx_chores_member_live/, p);
  assert.doesNotMatch(p, /SCAN (c|cc|done|chores|chore_completions)\b/, p);
  // Archived chores still in the saved selection: looked up by id, never by scanning the child's history.
  assert.match(plan(ROUTINE_SELECTED_SQL), /SEARCH c USING INDEX sqlite_autoindex_chores_1 \(id=\?\)/);
});

// These run once per server instance (each start): only rows still to fix are read.
test('startup sealing and shelving read only the rows they still have to change', () => {
  assert.match(plan(UNSEALED_NOTES_SQL), /SEARCH notifications USING INDEX idx_notifications_unsealed_medication/);
  assert.match(plan(UNSHELVED_READING_SQL), /SEARCH tracker_entries USING INDEX idx_tracker_entries_unshelved/);
});

test('the Board reads only announcements that have not expired', () => {
  assert.match(plan(CURRENT_ANNOUNCEMENTS_SQL), /SEARCH announcements USING INDEX idx_announcements_expires \(expires_at>\?\)/);
});

test('lists read their stored counts, and one list starts from its steps and notes', async () => {
  const { LISTS_SQL, LIST_STEPS_SQL, LIST_NOTE_COUNTS_SQL } = await import('../src/routes/lists.ts');
  assert.doesNotMatch(plan(LISTS_SQL), /list_items/);
  assert.match(plan(LIST_STEPS_SQL), /SCAN s\n.*SEARCH li USING INDEX sqlite_autoindex_list_items_1 \(id=\?\)/);
  assert.match(plan(LIST_NOTE_COUNTS_SQL), /SEARCH n USING COVERING INDEX idx_notes_target \(target_type=\?\)\n.*SEARCH li USING INDEX sqlite_autoindex_list_items_1/);
});

test('the notifications feed, reward requests and active chores read in index order', () => {
  assert.match(plan("SELECT * FROM notifications WHERE at < '9999' AND kind != 'medication' ORDER BY substr(at, 1, 10) DESC, rowid DESC LIMIT 50 OFFSET 0"), /SCAN notifications USING INDEX idx_notifications_day/);
  assert.match(plan('SELECT * FROM reward_redemptions ORDER BY requested_at DESC LIMIT 50'), /USING INDEX idx_reward_redemptions_requested/);
  assert.match(plan('SELECT * FROM chores WHERE active = 1 ORDER BY sort, created_at'), /SCAN chores USING INDEX idx_chores_active/);
});
