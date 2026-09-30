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

const db = openDb(':memory:');
applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
const plan = (sql: string) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>().results.map((r) => r.detail).join('\n');

test('points totals (GET /api/members) sum each member through an index', () => {
  for (const sql of [POINT_TOTALS_SQL, `${POINT_TOTALS_SQL} WHERE m.id = 'm1'`]) {
    const p = plan(sql);
    assert.match(p, /SEARCH chore_completions USING (COVERING )?INDEX idx_chore_completions_member/, p);
    assert.doesNotMatch(p, /SCAN chore_completions/, p);
  }
});

test('pending approvals (the parent badge) read only pending completions', () => {
  const p = plan(PENDING_SQL);
  assert.match(p, /chore_completions USING INDEX idx_chore_completions_pending|cc USING INDEX idx_chore_completions_pending/, p);
});

test("today's and this week's points read only this week's completions", () => {
  const p = plan(PERIOD_POINTS_SQL.replace(/\?/g, "'2026-09-30'"));
  assert.match(p, /SEARCH cc USING INDEX idx_chore_completions_date/, p);
});
